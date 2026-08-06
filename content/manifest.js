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
    "03": "科学探究方法",
    "04": "空气",
    "05": "氧气的性质",
    "06": "氧气的制取",
    "07": "单元复习：化学变化与空气",
    "08": "分子和原子",
    "09": "原子的结构",
    "10": "元素",
    "11": "离子",
    "12": "元素周期表简介",
    "13": "化学式与化合价",
    "14": "相对分子质量计算",
    "15": "单元复习：物质构成的奥秘",
    "16": "水的组成",
    "17": "水的净化",
    "18": "爱护水资源",
    "19": "质量守恒定律",
    "20": "化学方程式的书写",
    "21": "化学方程式的配平",
    "22": "有关化学方程式的计算",
    "23": "单元复习：化学方程式",
    "24": "碳单质",
    "25": "二氧化碳的制取",
    "26": "二氧化碳和一氧化碳的性质",
    "27": "单元复习：碳和碳的氧化物",
    "28": "燃烧和灭火",
    "29": "燃料、能源与环境",
    "30": "综合提升：全册知识网络"
  };

  const readyDays = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30"];

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
