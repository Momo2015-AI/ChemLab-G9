#!/usr/bin/env node
// ChemLab-G9 科学正确性巡检：扫描 day / quiz 文本，核对常见高频考点与易错表述。
// 用法：node scripts/check-science.mjs   （--fatal 时把"错误"项变成非零退出）
// 说明：科学表述常常有否定词与误区辨析，本脚本采用"保守"策略——
//   - 明显的"正向错误断言"（把错误当正确说）作为 error；
//   - 需要人工/LLM 复核的敏感表述作为 warning，不阻断流水线。
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fatal = process.argv.includes("--fatal");

const errors = [];
const warnings = [];

function loadJS(relPath) {
  const full = join(root, relPath);
  if (!existsSync(full)) return null;
  const code = readFileSync(full, "utf8");
  const sandbox = { window: {} };
  try { vm.runInNewContext(code, sandbox, { filename: relPath }); }
  catch (e) { errors.push(`解析失败 ${relPath}: ${e.message}`); return null; }
  return sandbox;
}

// 向前看 12 个字符内是否有否定/纠正词。
function hasNegation(text, i) {
  const start = Math.max(0, i - 12);
  const before = text.slice(start, i);
  return /不|非|并非|不可以|不能|不是|难以|几乎不|不太/.test(before);
}

// 整句是否在"辨析误区/否定/范围限定"的语境里（此时即便出现目标词也不断为错误断言）。
function isMisconception(text) {
  return /误区|易错|常见|\b（错）|\(错\)|「错」|不是|不等于|不能|不可以|并非|不等于|不可能|不可燃|不燃|只助燃|不能降低|不降低|不可降低|下两点|以下/.test(text);
}

// 只扫描正文 body（不含 checkpoint"对/错"判断项，那些是有意标出错误说法）。
function bodyStatements(scope) {
  const arr = [];
  Object.keys(scope).forEach((dayKey) => {
    const day = scope[dayKey];
    if (!day.sections) return;
    day.sections.forEach((sec, si) => {
      (sec.body || []).forEach((p, pi) => {
        const t = typeof p === "string" ? p : (p && p.text);
        if (!t) return;
        arr.push({ text: t, where: `Day ${dayKey}:sections[${si}].body[${pi}]` });
      });
    });
  });
  return arr;
}

// ---- 加载全部已发布内容 ----
const days = {};
for (let i = 1; i <= 30; i += 1) {
  const key = String(i).padStart(2, "0");
  const c = loadJS(`content/days/day-${key}.js`);
  if (c && c.window && c.window.ChemLabContent) days[key] = c.window.ChemLabContent[`day-${key}`];
}

// ---- 保守规则表 ----
const RULES = [
  // 氧气只能助燃，不可自燃——若出现"氧气可/能/是燃烧/可燃"且无否定，则为错。
  { id: "oxygen-combustible", severity: "error", negationAware: true,
    pattern: /氧气[^。，；，！?]{0,10}?(是|能|可|可以)\s*(可燃物|燃烧)/g,
    message: "氧气不可燃、只助燃" },
  // 着火点是固有属性，不可被灭火"降低"。
  { id: "ignition-lower", severity: "error", negationAware: true,
    pattern: /(用水|冷水|降温|灭火)[^。；]{0,8}?(降低|减小)[^。；]{0,4}?着火点/g,
    message: "着火点不可被降" },
  // 质量守恒仅适用于化学反应。
  { id: "conservation-physical", severity: "error", negationAware: true,
    pattern: /质量守恒(定律)?[^。；]{0,8}?(适用于|能解释)[^。；]{0,6}(物理变化|一切变化)/g,
    message: "质量守恒只适用于化学变化" },
  // 燃烧三条件缺一不可；不能把"发光"当条件。
  { id: "combustion-hint", severity: "warn", negationAware: true,
    pattern: /发光.{0,12}(一定|说明|所以|就是).{0,6}(化学变化)/g,
    message: "发光是线索并非充要条件" }
];

const statements = bodyStatements(days);
statements.forEach((it) => {
  RULES.forEach((r) => {
    if (new RegExp(r.pattern.source).test(it.text)) {
      // 处于"误区辨析 / 否定 / 范围限定"语境时跳过（避免误伤刻意表达）。
      if (isMisconception(it.text)) return;
      r.pattern.lastIndex = 0;
      const re = new RegExp(r.pattern.source, "g");
      re.lastIndex = 0;
      let m;
      let flagged = false;
      while ((m = re.exec(it.text)) !== null) {
        if (r.negationAware && hasNegation(it.text, m.index)) continue;
        flagged = true;
      }
      if (flagged) (r.severity === "error" ? errors : warnings).push(`${it.where}: 「${it.text.slice(0, 40)}…」疑似违反「${r.message}」`);
    }
  });
});

// ---- 全册"关键科学要点"是否至少出现一次（警告型，防止内容缺失） ----
const KEYPOINTS = [
  { keys: ["氧气", "不可燃|助燃|不燃|支持燃烧"], label: "氧气助燃不可燃" },
  { keys: ["着火点", "固有属性|不能降低|不可降低"], label: "着火点不可降" },
  { keys: ["质量守恒"], label: "质量守恒定律出现" },
  { keys: ["现象", "结论|新物质", "事实"], label: "现象 vs 结论区分" },
  { keys: ["化学式", "化学方程式"], label: "化学用语" },
  { keys: ["分子构成不同"], label: "微观-性质联系（CO/CO2）" }
];
KEYPOINTS.forEach((kp) => {
  const found = Object.keys(days).some((key) => {
    const day = days[key];
    return JSON.stringify(day).includes(kp.keys[0]);
  });
  if (!found) warnings.push(`全册未出现要点「${kp.label}」（${kp.keys[0]}），请确认内容编排符合教学地图。`);
});

// ---- 安全边界抽查：仅看"实验/操作/装置/演示"类段落，涉及危险操作且无安全提示才提醒 ----
for (const key of Object.keys(days)) {
  const day = days[key];
  (day.sections || []).forEach((sec, i) => {
    const title = sec.title || "";
    const isHandsOn = /实验|探究|演示|操作|装置/.test(title);
    if (!isHandsOn) return;
    const text = (sec.body || []).map((p) => (typeof p === "string" ? p : (p && p.text))).join(" ");
    const risky = /加热|点燃|酒精灯|白磷|一氧化碳|CO|稀硫酸|燃烧/.test(text || "");
    if (risky && sec.safety !== "supervised" && !/注意|安全|监护|陪同|勿自行|通风/.test(text || "")) {
      warnings.push(`Day ${key}: 实验段落「${sec.title}」涉及加热/有毒，建议补 safety 标注或安全提示`);
    }
  });
}

if (warnings.length) {
  console.log(`\n科学巡检 · 待人工/LLM 复核（${warnings.length}）：`);
  warnings.forEach((w) => console.log("  - " + w));
}
if (errors.length) {
  console.log(`\n科学巡检：错误（${errors.length}）：`);
  errors.forEach((e) => console.log("  ✘ " + e));
  console.log("\n巡检未通过。");
  if (fatal) process.exit(1);
  else console.log("（提示：可用 --fatal 让错误阻断发布）");
} else {
  console.log(`\n科学巡检：没有硬性科学错误${warnings.length ? `，${warnings.length} 条待复核提醒` : "，全部通过"}。`);
}