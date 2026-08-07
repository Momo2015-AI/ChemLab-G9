window.ChemLabContent = window.ChemLabContent || {};
window.ChemLabContent["day-26"] = {
  dayNumber: "26",
  title: "二氧化碳和一氧化碳的性质",
  duration: "45--60 分钟",
  difficulty: "⭐⭐",
  coreQuestion: "同样是碳的氧化物，为什么性质差别这么大？",
  sections: [
    {
      title: "今天解决什么问题？",
      body: [
        "二氧化碳和一氧化碳都是由碳和氧组成的化合物，但性质截然不同。今天对比学习它们的性质。"
      ]
    },
    {
      title: "二氧化碳的性质",
      body: [
        "物理性质：无色无味气体，密度比空气大，能溶于水。",
        "化学性质：不燃烧也不支持燃烧；能与水反应生成碳酸（CO₂ + H₂O = H₂CO₃）；能与澄清石灰水反应。",
        "用途：灭火、人工降雨（干冰）、气体肥料、制作碳酸饮料。"
      ]
    },
    {
      title: "一氧化碳的性质",
      body: [
        "物理性质：无色无味气体，密度略小于空气，难溶于水。",
        "化学性质：可燃性（2CO + O₂ 点燃 2CO₂）；还原性（CO + CuO 加热 Cu + CO₂）；有毒性。",
        "毒性：CO 与血红蛋白结合能力比氧气强约 200 倍，导致人体缺氧。",
        { text: "冬天用煤炉取暖要注意通风，防止 CO 中毒。", kind: "note" },
        { text: "安全边界：CO 还原氧化铜、点燃 CO 等操作涉及有毒气体和加热，只能由教师在通风环境、成人监护下演示，切勿自行在家操作；吸入 CO 危险，用鼻子闻更绝对禁止。", kind: "note" }
      ]
    },
    {
      title: "CO 和 CO₂ 的性质对比",
      figure: { type: "co-vs-co2", caption: "分子构成不同（多一个氧原子），化学性质截然不同。" },
      body: [
        "组成：都由碳、氧元素组成，但分子构成不同（CO₂ 比 CO 多一个氧原子）。",
        "性质差异：CO₂ 不燃烧、不支持燃烧；CO 可燃、有毒。",
        "相互转化：2CO + O₂ 点燃 2CO₂；CO₂ + C 高温 2CO。",
        { text: "记住：分子构成不同，化学性质不同。", kind: "takeaway" }
      ]
    },
    {
      title: "中考链接",
      body: [
        "中考常考：CO 和 CO₂ 的性质对比、CO 的毒性及预防、CO 还原氧化铜的实验。",
        "易错点：混淆 CO 和 CO₂ 的性质，误认为 CO₂ 有毒。"
      ]
    },
    {
      title: "今日知识卡片",
      body: [
        "CO₂：不燃不支持燃、能溶于水、使石灰水变浑浊。CO：可燃、有毒、有还原性。两者性质差异源于分子构成不同。"
      ]
    }
  ],
  checkpoint: {
    title: "情境自测：这些说法哪些对？",
    items: [
      {
        statement: "二氧化碳和一氧化碳都是由碳元素和氧元素组成的，所以它们的性质相同。",
        verdict: "错",
        explanation: "分子构成不同，化学性质不同。CO₂ 不燃烧，CO 可燃。"
      },
      {
        statement: "CO 有毒，是因为它与血红蛋白结合能力强，导致人体缺氧。",
        verdict: "对",
        explanation: "CO 与血红蛋白结合能力比 O₂ 强约 200 倍，使血红蛋白失去携氧能力。"
      },
      {
        statement: "CO₂ 能使紫色石蕊试液变红，是因为 CO₂ 本身显酸性。",
        verdict: "错",
        explanation: "CO₂ 与水反应生成碳酸，碳酸使石蕊变红，CO₂ 本身不是酸。"
      },
      {
        statement: "CO 还原 CuO 的反应中，CO 是还原剂。",
        verdict: "对",
        explanation: "CO 夺取 CuO 中的氧，使 CuO 还原为 Cu，CO 是还原剂。"
      }
    ]
  }
};
