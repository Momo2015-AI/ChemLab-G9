window.ChemLabManifest = (function () {
  "use strict";

  // 模块划分与天数区间，来自 docs/CHEMISTRY_CURRICULUM.md 的教学地图。
  const modules = [
    { name: "开启化学之门", range: [1, 3] },
    { name: "我们周围的空气", range: [4, 8] },
    { name: "物质构成的奥秘", range: [9, 15] },
    { name: "自然界的水", range: [16, 18] },
    { name: "化学方程式", range: [19, 23] },
    { name: "碳和碳的氧化物", range: [24, 27] },
    { name: "燃料及其利用", range: [28, 29] },
    { name: "综合提升", range: [30, 30] }
  ];

  // 仅收录课程地图中已明确的单日主题；其余天数在内容产出前不编造具体标题。
  const knownTitles = {
    "01": "化学就在我们身边",
    "02": "化学实验室探秘",
    "03": "科学探究方法"
  };

  // 已完成内容开发、可以学习的天数。
  const readyDays = ["01"];

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function moduleFor(dayNum) {
    return modules.find((m) => dayNum >= m.range[0] && dayNum <= m.range[1]);
  }

  const days = [];
  for (let i = 1; i <= 30; i += 1) {
    const key = pad(i);
    const mod = moduleFor(i);
    const title = knownTitles[key] || (mod ? `${mod.name} · 待发布` : "待发布");
    days.push({ day: key, title: title, module: mod ? mod.name : "", ready: readyDays.indexOf(key) !== -1 });
  }

  return { modules: modules, days: days };
}());
