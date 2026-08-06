#!/usr/bin/env node
// ChemLab-G9 内容校验：检查 manifest / day / quiz 数据一致性。
// 用法：node scripts/validate-content.mjs
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const errors = [];
const warnings = [];

function err(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }

function loadJS(relPath, sandboxGlobals) {
  const full = join(root, relPath);
  if (!existsSync(full)) return null;
  const code = readFileSync(full, "utf8");
  const sandbox = { window: {} };
  if (sandboxGlobals) {
    Object.keys(sandboxGlobals).forEach((k) => { sandbox[k] = sandboxGlobals[k]; });
  }
  try {
    vm.runInNewContext(code, sandbox, { filename: relPath });
  } catch (e) {
    err(`${relPath}: 解析失败：${e.message}`);
    return null;
  }
  return sandbox;
}

// ---- 1. 载入 manifest ----
const s = loadJS("content/manifest.js");
const manifest = s && s.window.ChemLabManifest;
if (!manifest || !Array.isArray(manifest.days)) {
  err("content/manifest.js: 缺少 window.ChemLabManifest.days");
  process.exit(1);
}

const days = manifest.days;
const readyDays = days.filter((d) => d.ready).map((d) => d.day);
const byDay = {};
days.forEach((d) => { byDay[d.day] = d; });

if (days.length !== 30) warn(`manifest 天数为 ${days.length}，预期 30`);

// ---- 2. 天 / quiz 文件配对 ----
const dayFiles = new Set();
const quizFiles = new Set();
for (let i = 1; i <= 30; i += 1) {
  const key = String(i).padStart(2, "0");
  const dPath = `content/days/day-${key}.js`;
  const qPath = `quiz/day-${key}.js`;
  if (existsSync(join(root, dPath))) dayFiles.add(key);
  if (existsSync(join(root, qPath))) quizFiles.add(key);
}

readyDays.forEach((key) => {
  if (!dayFiles.has(key)) err(`Day ${key} 标记为 ready，但缺少 content/days/day-${key}.js`);
  if (!quizFiles.has(key)) err(`Day ${key} 标记为 ready，但缺少 quiz/day-${key}.js`);
});

dayFiles.forEach((key) => {
  if (!byDay[key]) err(`存在 content/days/day-${key}.js，但 manifest 中没有该天`);
  else if (!byDay[key].ready) warn(`Day ${key} 有内容文件但 manifest 未标记 ready`);
});
quizFiles.forEach((key) => {
  if (!dayFiles.has(key)) err(`存在 quiz/day-${key}.js，但缺少对应内容文件 content/days/day-${key}.js`);
});

// ---- 3. 校验每个已发布天的内容结构 ----
const DIFF_ALLOWED = ["基础", "提升", "挑战"];

const publishedDays = readyDays.filter((key) => dayFiles.has(key));
publishedDays.forEach((key) => {
  const c = loadJS(`content/days/day-${key}.js`);
  const day = c && c.window.ChemLabContent && c.window.ChemLabContent[`day-${key}`];
  if (!day) { err(`Day ${key}: content 未注册 ChemLabContent["day-${key}"]`); return; }

  if (day.dayNumber !== key) err(`Day ${key}: dayNumber 为 "${day.dayNumber}"，应与文件名一致`);
  if (!day.title) err(`Day ${key}: 缺少 title`);
  if (!day.coreQuestion) err(`Day ${key}: 缺少 coreQuestion`);
  if (!Array.isArray(day.sections) || !day.sections.length) {
    err(`Day ${key}: sections 必须为非空数组`);
  } else {
    day.sections.forEach((sec, i) => {
      if (!sec.title) err(`Day ${key}: sections[${i}] 缺少 title`);
      if (!Array.isArray(sec.body) || !sec.body.length) err(`Day ${key}: sections[${i}] body 必须为非空数组`);
      else {
        sec.body.forEach((p, j) => {
          if (typeof p === "string") return;
          if (p && typeof p === "object" && typeof p.text === "string") {
            if (p.kind !== undefined && !["takeaway", "note"].includes(p.kind)) {
              err(`Day ${key}: sections[${i}].body[${j}] kind 应为 takeaway 或 note`);
            }
          } else {
            err(`Day ${key}: sections[${i}].body[${j}] 应为字符串或 {text, kind?}`);
          }
        });
      }
      if (sec.safety !== undefined && sec.safety !== "supervised") {
        err(`Day ${key}: sections[${i}] safety 应为 "supervised"`);
      }
      if (sec.figure && typeof sec.figure.type !== "string") err(`Day ${key}: sections[${i}] figure 缺少 type`);
    });
  }

  if (day.checkpoint !== undefined) {
    if (!Array.isArray(day.checkpoint.items) || !day.checkpoint.items.length) {
      err(`Day ${key}: checkpoint.items 必须为非空数组`);
    } else {
      day.checkpoint.items.forEach((item, i) => {
        if (!item.statement) err(`Day ${key}: checkpoint.items[${i}] 缺少 statement`);
        if (!["对", "错"].includes(item.verdict)) err(`Day ${key}: checkpoint.items[${i}] verdict 应为 "对" 或 "错"`);
        if (!item.explanation) err(`Day ${key}: checkpoint.items[${i}] 缺少 explanation`);
      });
    }
  }

  // ---- 4. 校验当天题目 ----
  const q = loadJS(`quiz/day-${key}.js`);
  const quiz = q && q.window.ChemLabQuiz && q.window.ChemLabQuiz[`day-${key}`];
  if (!quiz) { err(`Day ${key}: quiz 未注册 ChemLabQuiz["day-${key}"]`); return; }
  if (!Array.isArray(quiz.questions) || !quiz.questions.length) {
    err(`Day ${key}: questions 必须为非空数组`);
    return;
  }
  quiz.questions.forEach((item, i) => {
    const where = `Day ${key} Q${i + 1}`;
    if (!item.prompt) err(`${where}: 缺少 prompt`);
    if (!Array.isArray(item.options) || item.options.length < 2) {
      err(`${where}: options 至少需要 2 项`);
      return;
    }
    const ans = Number(item.answer);
    if (!Number.isInteger(ans) || ans < 0 || ans >= item.options.length) {
      err(`${where}: answer "${item.answer}" 超出选项范围（0-${item.options.length - 1}）`);
    }
    if (!item.explanation) err(`${where}: 缺少 explanation`);
    if (item.difficulty !== undefined && !DIFF_ALLOWED.includes(item.difficulty)) {
      err(`${where}: difficulty "${item.difficulty}" 应为 基础/提升/挑战 之一`);
    }
    if (item.topic !== undefined && (typeof item.topic !== "string" || !item.topic.trim())) {
      err(`${where}: topic 应为非空字符串`);
    }
  });
});

// ---- 5. 报告 ----
if (warnings.length) {
  console.log(`\n警告（${warnings.length}）:`);
  warnings.forEach((w) => console.log("  - " + w));
}
if (errors.length) {
  console.log(`\n错误（${errors.length}）:`);
  errors.forEach((e) => console.log("  ✘ " + e));
  console.log("\n校验未通过。");
  process.exit(1);
}
console.log(`\n校验通过：${publishedDays.length} 个已发布天，${readyDays.length} 个标记为 ready。`);
