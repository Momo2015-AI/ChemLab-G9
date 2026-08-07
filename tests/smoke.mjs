#!/usr/bin/env node
// ChemLab-G9 冒烟测试：在 Node 中用最小 DOM 模拟运行构建产物，验证主要渲染路径。
// 用法：node tests/smoke.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const builtPath = join(root, "dist", "ChemLab-G9.html");

const html = readFileSync(builtPath, "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (!scripts.length) {
  console.error("构建产物中未找到内联脚本。请先运行 node scripts/build-single.mjs");
  process.exit(1);
}

let failures = 0;
function assert(cond, name) {
  if (cond) {
    console.log("  ✔ " + name);
  } else {
    failures += 1;
    console.log("  ✘ " + name);
  }
}

// 最小 DOM 模拟：任何选择器都返回可用的桩元素，事件绑定为 noop。
function makeEl() {
  return {
    innerHTML: "",
    textContent: "",
    style: {},
    dataset: {},
    hidden: false,
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    setAttribute() {},
    removeAttribute() {},
    getAttribute() { return null; },
    append() {},
    appendChild() {},
    addEventListener() {},
    focus() {},
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
    closest() { return makeEl(); }
  };
}
const appEl = makeEl();
const documentStub = {
  querySelector(sel) { return sel === "#app" ? appEl : makeEl(); },
  querySelectorAll() { return []; },
  createElement() { return makeEl(); },
  body: makeEl()
};
const localStorageStub = {
  _d: {},
  getItem(k) { return k in this._d ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); }
};

const context = {
  window: { location: { search: "" } },
  document: documentStub,
  localStorage: localStorageStub,
  location: { search: "" },
  URLSearchParams,
  console,
  Math,
  Object,
  Array,
  String,
  Number,
  JSON,
  Promise,
  Date,
  Error
};

function runApp() {
  const appCode = scripts[scripts.length - 1];
  vm.runInNewContext(appCode, context, { filename: "app.js" });
}

function setSearch(s) {
  context.location.search = s;
  context.window.location.search = s;
}

function questionCount(htmlStr) {
  return (htmlStr.match(/<fieldset class="question"/g) || []).length;
}

// 先加载 manifest + 各天内容，再单独运行 app.js（方便按场景重跑）。
scripts.slice(0, -1).forEach((code, i) => {
  vm.runInNewContext(code, context, { filename: "inline-script-" + i });
});

console.log("\n[首页]");
setSearch("");
runApp();
const home = appEl.innerHTML;
assert(home.includes("30 天自学计划"), "渲染 30 天学习计划标题");
assert((home.match(/<li class="day-card/g) || []).length === 30, "渲染 30 张学习日卡片");assert(home.includes("已完成 0 / 30 天"), "初始进度为 0/30");
assert(home.includes('class="stats-strip"'), "渲染统计条（连续天数/最高连对/待复习）");
assert(home.includes("成就徽章") && home.includes("badge-wall"), "渲染成就徽章墙");
assert(home.includes("模块进度") && home.includes("mod-block"), "渲染可展开模块进度");
assert(!home.includes("开始错题复习"), "空复习队列时不显示复习入口");

console.log("\n[Day01 学习页]");
setSearch("?day=01");
runApp();
let page = appEl.innerHTML;
assert(page.includes("今日练习") && page.includes("提交并查看解析"), "渲染练习表单");
assert(questionCount(page) === 10, "Day01 渲染 10 道题");
assert(page.includes("情境自测"), "渲染情境自测");
assert(page.includes("今日知识卡片"), "渲染今日知识卡片");

console.log("\n[Day02 配图渲染]");
setSearch("?day=02");
runApp();
page = appEl.innerHTML;
assert(page.includes("fig-cyl") && page.includes("量筒读数"), "Day02 渲染量筒读数交互图");
assert(page.includes("fig-air"), "Day02 渲染气密性检查图");
assert(questionCount(page) === 16, "Day02 渲染 16 道题");
assert(page.includes('data-diff="提升"'), "渲染题目难度标签");

console.log("\n[Day03-04 学习页]");
setSearch("?day=03");
runApp();
page = appEl.innerHTML;
assert(questionCount(page) === 6, "Day03 渲染 6 道题");
assert(page.includes("情境自测"), "Day03 渲染情境自测");
setSearch("?day=04");
runApp();
page = appEl.innerHTML;
assert(page.includes("air-wrap") && page.includes("空气成分"), "Day04 渲染空气成分环形图");
assert(questionCount(page) === 8, "Day04 渲染 8 道题");

console.log("\n[Day05-10 学习页]");
const expected = { "05": 8, "06": 9, "07": 10, "08": 8, "09": 9, "10": 9 };
Object.keys(expected).forEach((key) => {
  setSearch("?day=" + key);
  runApp();
  page = appEl.innerHTML;
  assert(questionCount(page) === expected[key], "Day" + key + " 渲染 " + expected[key] + " 道题");
  assert(page.includes("情境自测"), "Day" + key + " 渲染情境自测");
});

console.log("\n[Day09-10 配图渲染]");
setSearch("?day=09");
runApp();
page = appEl.innerHTML;
assert(page.includes("fig-atom") && page.includes("原子核"), "Day09 渲染原子结构模型图");
assert(page.includes("data-atomfig"), "Day09 原子模型绑定钩子");
setSearch("?day=10");
runApp();
page = appEl.innerHTML;
assert(page.includes("fig-element") && page.includes("element-cell"), "Day10 渲染元素周期表格子图");
assert(page.includes("data-elfig"), "Day10 元素格子绑定钩子");

console.log("\n[Day11-18 学习页]");
const expected11to18 = { "11": 8, "12": 6, "13": 7, "14": 7, "15": 8, "16": 8, "17": 7, "18": 6 };
Object.keys(expected11to18).forEach((key) => {
  setSearch("?day=" + key);
  runApp();
  page = appEl.innerHTML;
  assert(questionCount(page) === expected11to18[key], "Day" + key + " 渲染 " + expected11to18[key] + " 道题");
  assert(page.includes("情境自测"), "Day" + key + " 渲染情境自测");
});

console.log("\n[Day19-30 学习页]");
const expected19to30 = { "19": 8, "20": 10, "21": 10, "22": 10, "23": 8, "24": 8, "25": 8, "26": 8, "27": 8, "28": 8, "29": 8, "30": 8 };
Object.keys(expected19to30).forEach((key) => {
  setSearch("?day=" + key);
  runApp();
  page = appEl.innerHTML;
  assert(questionCount(page) === expected19to30[key], "Day" + key + " 渲染 " + expected19to30[key] + " 道题");
  assert(page.includes("情境自测"), "Day" + key + " 渲染情境自测");
});

console.log("\n[错题复习空状态]");
setSearch("?view=review");
runApp();
page = appEl.innerHTML;
assert(page.includes("当前没有待复习的错题"), "空队列显示复习空状态");

// 复习页有数据：写入一条错题记录后重新渲染（渲染是异步的，等待微任务）。
localStorageStub._d["chemlab-g9:v3:review"] = JSON.stringify([
  { day: "01", questionIndex: 2, prompt: "水加热沸腾时有气泡", answeredAt: new Date().toISOString() }
]);
runApp();
await new Promise((r) => setTimeout(r, 0));
page = appEl.innerHTML;
assert(page.includes("把答错的题再做一遍"), "有错题时渲染复习页");
assert(page.includes("提交复习"), "渲染复习提交按钮");

console.log(failures ? `\n冒烟测试失败：${failures} 项` : "\n冒烟测试全部通过。");
process.exit(failures ? 1 : 0);
