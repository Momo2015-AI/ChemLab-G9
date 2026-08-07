(function () {
  "use strict";

  var app = document.querySelector("#app");
  var manifest = (window.ChemLabManifest && window.ChemLabManifest.days) || [];
  var params = new URLSearchParams(window.location.search);
  var requestedDay = params.get("day");
  var requestedView = params.get("view");

  var LS_DAY = "chemlab-g9:v3:day-";
  var LS_REVIEW = "chemlab-g9:v3:review";

  // ---------- 基础工具 ----------
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function readJSON(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* 本地存储不可用时静默失败，不影响当次学习 */
    }
  }

  function bestOf(attempts) {
    return attempts.reduce(function (m, a) {
      return Math.max(m, a.score);
    }, 0);
  }

  // 旧版记录（{score,total,...}）迁移为新版（{attempts, read, note, ...}）。
  function normalizeDayRecord(record) {
    if (!record) return null;
    var out = {};
    if (Array.isArray(record.attempts)) {
      out.attempts = record.attempts;
      out.best = record.best != null ? record.best : bestOf(record.attempts);
    } else if (typeof record.score === "number") {
      var attempt = {
        score: record.score,
        total: record.total,
        answers: record.answers || [],
        completedAt: record.completedAt || new Date().toISOString()
      };
      out.attempts = [attempt];
      out.best = attempt.score;
    } else {
      // 允许"仅读过 + 笔记"但没有作答记录的天也存在（read=true 或 note 非空）。
      if (!record.read && !record.note) return null;
      out.attempts = [];
      out.best = 0;
      out.read = !!record.read;
      out.readAt = record.readAt || null;
      out.note = typeof record.note === "string" ? record.note : "";
      return out;
    }
    // 附加字段：是否已读完、阅读时间、单课笔记。
    out.read = !!record.read;
    out.readAt = record.readAt || null;
    out.note = typeof record.note === "string" ? record.note : "";
    return out;
  }

  function dayRecord(dayKey) {
    return normalizeDayRecord(readJSON(LS_DAY + dayKey));
  }

  function saveDayRecord(dayKey, record) {
    writeJSON(LS_DAY + dayKey, record);
  }

  function getProgress() {
    var progress = {};
    manifest.forEach(function (d) {
      var record = dayRecord(d.day);
      if (record) progress[d.day] = record;
    });
    return progress;
  }

  function getReviewQueue() {
    return readJSON(LS_REVIEW) || [];
  }

  function getDay(dayKey) {
    return window.ChemLabContent && window.ChemLabContent["day-" + dayKey];
  }

  function getQuiz(dayKey) {
    return window.ChemLabQuiz && window.ChemLabQuiz["day-" + dayKey];
  }

  function metaFor(dayKey) {
    return manifest.filter(function (d) { return d.day === dayKey; })[0];
  }

  function moduleIndexFor(dayKey) {
    var meta = metaFor(dayKey);
    if (!meta || !meta.module || !window.ChemLabManifest || !window.ChemLabManifest.modules) return 0;
    var idx = window.ChemLabManifest.modules.findIndex(function (m) { return m.name === meta.module; });
    return idx < 0 ? 0 : idx;
  }

  // ---------- 激励层：连续学习天数 / 连击 / 成就 / 薄弱点 ----------
  var LS_STATS = "chemlab-g9:v3:stats";

  function getStats() {
    var s = readJSON(LS_STATS) || {};
    s.achievements = Array.isArray(s.achievements) ? s.achievements : [];
    s.bestCombo = typeof s.bestCombo === "number" ? s.bestCombo : 0;
    return s;
  }

  function saveStats(s) {
    writeJSON(LS_STATS, { achievements: s.achievements, bestCombo: s.bestCombo, reviewCleared: !!s.reviewCleared });
  }

  function localDateKey(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  // 连续学习天数：从今天（若今天未学则从昨天）往前数连续的自然日。
  function getStreak() {
    var active = {};
    manifest.forEach(function (md) {
      var rec = dayRecord(md.day);
      if (!rec) return;
      // 作答与"读完本课"都算当天的学习活动，利于连续天数激励。
      if (rec.read && rec.readAt) active[localDateKey(new Date(rec.readAt))] = true;
      rec.attempts.forEach(function (a) {
        if (a.completedAt) active[localDateKey(new Date(a.completedAt))] = true;
      });
    });
    if (!Object.keys(active).length) return 0;
    var cursor = new Date();
    if (!active[localDateKey(cursor)]) cursor.setDate(cursor.getDate() - 1);
    var streak = 0;
    while (active[localDateKey(cursor)]) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  // 薄弱知识点：从错题队列按题目 topic 聚合，附带命中的学习日便于跳转。
  function getWeakTopics() {
    var queue = getReviewQueue();
    var topics = {};
    queue.forEach(function (item) {
      var quiz = getQuiz(item.day);
      var q = quiz && quiz.questions[item.questionIndex];
      var topic = (q && q.topic) || "未标注";
      topics[topic] = topics[topic] || { count: 0, days: {}, samples: 0 };
      topics[topic].count += 1;
      topics[topic].days[item.day] = true;
    });
    return Object.keys(topics).map(function (t) {
      var o = topics[t];
      return { topic: t, count: o.count, days: Object.keys(o.days) };
    }).sort(function (a, b) { return b.count - a.count; }).slice(0, 5);
  }

  // 成就定义：全部基于本地数据判定，离线可用。
  var ACHIEVEMENTS = [
    { id: "first-step", ico: "★", name: "迈出第一步", desc: "完成任意一天的学习" },
    { id: "days-5",     ico: "◆", name: "坚持五关",   desc: "累计完成 5 天学习" },
    { id: "all-correct",ico: "✔", name: "一次全对",   desc: "某次测验拿到满分" },
    { id: "challenge",  ico: "♛", name: "挑战者",     desc: "全对且包含挑战题" },
    { id: "combo-5",    ico: "▲", name: "连击高手",   desc: "单次连对 5 题" },
    { id: "streak-3",   ico: "✦", name: "三天不断",   desc: "连续学习 3 天" },
    { id: "streak-7",   ico: "❖", name: "一周坚持",   desc: "连续学习 7 天" },
    { id: "review-clear", ico: "●", name: "错题清零", desc: "完成一轮错题复习" }
  ];

  function evaluateAchievements(progress, stats) {
    var unlocked = {};
    stats.achievements.forEach(function (id) { unlocked[id] = true; });
    var completedCount = Object.keys(progress).length;
    if (completedCount >= 1) unlocked["first-step"] = true;
    if (completedCount >= 5) unlocked["days-5"] = true;
    var hasFull = false, hasFullChallenge = false, maxCombo = stats.bestCombo;
    Object.keys(progress).forEach(function (key) {
      var rec = progress[key];
      rec.attempts.forEach(function (a) {
        if (a.score === a.total) {
          hasFull = true;
          var quiz = getQuiz(key);
          var hasChallenge = quiz && quiz.questions.some(function (q) { return q.difficulty === "挑战"; });
          if (hasChallenge) hasFullChallenge = true;
        }
      });
    });
    if (hasFull) unlocked["all-correct"] = true;
    if (hasFullChallenge) unlocked["challenge"] = true;
    if (maxCombo >= 5) unlocked["combo-5"] = true;
    if (getStreak() >= 3) unlocked["streak-3"] = true;
    if (getStreak() >= 7) unlocked["streak-7"] = true;
    if (stats.reviewCleared) unlocked["review-clear"] = true;

    // 更新已解锁列表（持久化，避免重复判定造成闪烁）。
    var changed = false;
    ACHIEVEMENTS.forEach(function (a) {
      if (unlocked[a.id] && stats.achievements.indexOf(a.id) === -1) {
        stats.achievements.push(a.id);
        changed = true;
      }
    });
    if (changed) saveStats(stats);
    return ACHIEVEMENTS.map(function (a) {
      return { id: a.id, ico: a.ico, name: a.name, desc: a.desc, unlocked: !!unlocked[a.id] };
    });
  }

  function miniChart(attempts, modClass) {
    if (attempts.length < 2) return "";
    var n = attempts.length;
    var w = 100, h = 20, pad = 3;
    var max = Math.max(1, attempts[0].total);
    var step = n > 1 ? (w - pad * 2) / (n - 1) : 0;
    var points = attempts.map(function (a, i) {
      var x = pad + i * step;
      var y = h - pad - (a.score / max) * (h - pad * 2);
      return x.toFixed(1) + "," + y.toFixed(1);
    });
    return '<svg class="mini-chart" viewBox="0 0 ' + w + " " + h + '" aria-hidden="true"><polyline points="' + points.join(" ") + '"/></svg>';
  }

  // 选项选中态兜底：部分旧版 iPad Safari 不支持 :has()；同时更新练习区进度条。
  function bindOptionSelection() {
    document.querySelectorAll(".option input").forEach(function (input) {
      input.addEventListener("change", function () {
        var fieldset = input.closest(".question, .review-q");
        if (!fieldset) return;
        fieldset.querySelectorAll(".option").forEach(function (label) {
          label.classList.remove("selected");
        });
        input.closest(".option").classList.add("selected");

        var form = document.querySelector("#quiz-form");
        if (form) {
          var checked = form.querySelectorAll("input:checked").length;
          var all = form.querySelectorAll(".question").length;
          var fill = document.querySelector("#qp-fill");
          var txt = document.querySelector("#qp-text");
          if (fill && all) fill.style.width = Math.round((checked / all) * 100) + "%";
          if (txt) txt.textContent = "已答 " + checked + " / " + all;
        }
      });
    });
  }

  // ---------- 量筒读数几何状态（单一事实源：渲染与交互共用） ----------
  var CYLINDER_STATES = {
    level: {
      label: "平视（正确）",
      eye: { x: 30, y: 78 },
      read: { x: 92, y: 78 },
      note: "视线与凹液面最低处保持水平，读数为 78 mL，正确。",
      correct: true
    },
    above: {
      label: "俯视",
      eye: { x: 26, y: 32 },
      read: { x: 86, y: 94 },
      note: "俯视时视线从上方斜向下，看到的最低点偏低处刻度，读数偏大。",
      correct: false
    },
    below: {
      label: "仰视",
      eye: { x: 26, y: 130 },
      read: { x: 98, y: 62 },
      note: "仰视时视线从下方斜向上，看到的最低点偏高处刻度，读数偏小。",
      correct: false
    }
  };

  // ---------- 可复用 SVG 图元库：新配图按需组装，不必每次手写整段 SVG ----------
  var svgParts = {
    svg: function (w, h, inner) {
      return '<svg class="chem-svg" viewBox="0 0 ' + w + " " + h + '" aria-hidden="true" focusable="false">' + inner + "</svg>";
    },
    liquidGradient: function (id, top, bottom) {
      return (
        '<linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="' + top + '"/><stop offset="1" stop-color="' + bottom + '"/>' +
        "</linearGradient>"
      );
    },
    vessel: function (x, y, w, h, rx) {
      return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + (rx || 16) + '" fill="rgba(255,255,255,.6)" stroke="#587073" stroke-width="3"/>';
    },
    beaker: function (x, y, w, h, fill) {
      return '<path d="M' + x + " " + y + " L" + (x + w) + " " + y + " L" + (x + w - 5) + " " + (y + h) + " L" + (x + 5) + " " + (y + h) + ' Z" fill="' + (fill || "rgba(230,244,241,.5)") + '" stroke="#587073" stroke-width="3"/>';
    },
    bubbles: function (cx, baseY, n) {
      var s = "";
      for (var i = 0; i < n; i += 1) {
        var r = 3 - i * 0.7;
        s += '<circle class="bub' + (i ? " b" + (i + 1) : "") + '" cx="' + cx + '" cy="' + (baseY - i * 8) + '" r="' + r.toFixed(1) + '" fill="#fff" opacity=".9"/>';
      }
      return s;
    },
    // 分子球（原子/离子示意）：cx, cy, r, fill, 可选 label 与描边
    ball: function (cx, cy, r, fill, label, extra) {
      var s = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + fill + '" stroke="#173033" stroke-width="1.5"' + (extra || "") + "/>";
      if (label) s += '<text x="' + cx + '" y="' + (cy + 3.5) + '" fill="#fff" font-size="' + Math.round(r * 0.7) + '" text-anchor="middle" font-weight="600">' + label + "</text>";
      return s;
    },
    // 原子核：一个带正电荷标记的实心球
    nucleus: function (cx, cy, r) {
      return (
        '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#c2534f" stroke="#8a3b38" stroke-width="1.5"/>' +
        '<text x="' + cx + '" y="' + (cy + 3.5) + '" fill="#fff" font-size="' + Math.round(r * 0.7) + '" text-anchor="middle" font-weight="600">+</text>'
      );
    },
    // 电子轨道（圆形虚线）
    orbit: function (cx, cy, r, extra) {
      return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#b0c4c1" stroke-width="1.5" stroke-dasharray="4,3"' + (extra || "") + "/>";
    },
    // 电子：带负号的小球
    electron: function (cx, cy, r) {
      r = r || 3;
      return (
        '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#4aa7a0" stroke="#2f7d76" stroke-width="1"/>' +
        '<text x="' + cx + '" y="' + (cy + r * 0.7) + '" fill="#fff" font-size="' + Math.round(r * 0.9) + '" text-anchor="middle">-</text>'
      );
    },
    // 试管（带开口）：x,y 为左上角，w 宽，h 高，可选旋转
    testTube: function (x, y, w, h, opts) {
      opts = opts || {};
      var rot = opts.rotate ? ' transform="rotate(' + opts.rotate + " " + (x + w / 2) + " " + (y + h / 2) + ')"' : "";
      var fill = opts.fill || "rgba(255,255,255,.6)";
      return (
        '<g' + rot + ">" +
          '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + (w / 2) + '" fill="' + fill + '" stroke="#587073" stroke-width="2"/>' +
          '<path d="M' + x + " " + y + " L" + (x + w) + " " + y + '" stroke="#587073" stroke-width="2" fill="none"/>' +
        "</g>"
      );
    },
    // 酒精灯：底部 x,y，宽 w 高 h
    alcoholBurner: function (x, y, w, h, flame) {
      var cx = x + w / 2;
      var s =
        '<path d="M' + x + " " + y + " L" + (x + w) + " " + y + " L" + (x + w - 3) + " " + (y + h) + " L" + (x + 3) + " " + (y + h) + ' Z" fill="#f5e6ca" stroke="#c9a96e" stroke-width="1.5"/>' +
        '<ellipse cx="' + cx + '" cy="' + (y - 2) + '" rx="' + (w / 2 - 2) + '" ry="3" fill="#f5e6ca" stroke="#c9a96e" stroke-width="1"/>' +
        '<line x1="' + cx + '" y1="' + (y - 2) + '" x2="' + cx + '" y2="' + (y - 8) + '" stroke="#5a4a32" stroke-width="1.5"/>';
      if (flame) {
        s += '<g class="flame-glow" filter="url(#' + (flame.filterId || "") + ')">' +
          '<ellipse cx="' + cx + '" cy="' + (y - 16) + '" rx="4" ry="9" fill="url(#' + flame.gradId + ')"/>' +
          '<ellipse cx="' + cx + '" cy="' + (y - 13) + '" rx="2" ry="5" fill="#fff4b8" opacity="0.7"/>' +
        "</g>";
      }
      return s;
    },
    // 漏斗
    funnel: function (x, y, w, h) {
      var cx = x + w / 2;
      return (
        '<path d="M' + cx + " " + y + " L" + (x + w) + " " + (y + h * 0.45) + " L" + (x + w - 4) + " " + (y + h * 0.45) + " L" + (x + w / 2 + 2) + " " + (y + h) + " L" + (x + w / 2 - 2) + " " + (y + h) + " L" + (x + 4) + " " + (y + h * 0.45) + " L" + x + " " + (y + h * 0.45) + ' Z" fill="rgba(255,255,255,.5)" stroke="#587073" stroke-width="2"/>' +
        '<line x1="' + cx + '" y1="' + (y + h * 0.45) + '" x2="' + cx + '" y2="' + (y + h - 2) + '" stroke="#587073" stroke-width="2"/>'
      );
    },
    // 滴管
    dropper: function (x, y, w, h) {
      return (
        '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h * 0.3 + '" rx="' + (w / 2) + '" fill="#e67b32" stroke="#a4560b" stroke-width="1.5"/>' +
        '<line x1="' + (x + w / 2) + '" y1="' + (y + h * 0.3) + '" x2="' + (x + w / 2) + '" y2="' + (y + h) + '" stroke="#587073" stroke-width="2"/>'
      );
    },
    // 单行箭头标注：从 x1,y1 指向 x2,y2 的虚线箭头
    arrow: function (x1, y1, x2, y2, color) {
      var a = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
      var len = 8;
      var a1 = (a + 160) * Math.PI / 180, a2 = (a - 160) * Math.PI / 180;
      var p1x = x2 + len * Math.cos(a1), p1y = y2 + len * Math.sin(a1);
      var p2x = x2 + len * Math.cos(a2), p2y = y2 + len * Math.sin(a2);
      return (
        '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + (color || "#587073") + '" stroke-width="1.5" stroke-dasharray="5,3"/>' +
        '<path d="M' + x2 + " " + y2 + " L" + p1x.toFixed(1) + " " + p1y.toFixed(1) + " L" + p2x.toFixed(1) + " " + p2y.toFixed(1) + ' Z" fill="' + (color || "#587073") + '"/>'
      );
    }
  };

  function figSvg(w, h, inner) {
    return svgParts.svg(w, h, inner);
  }

  // ---------- 快速索引：跨天关键词搜索（单文件内所有内容均已内联时最全） ----------
  // 惰性建立索引：只扫描已加载/内联的内容，分离模式下内容不足时退化到仅搜标题。
  var _indexCache = null;
  function buildIndex() {
    if (_indexCache) return _indexCache;
    var idx = [];
    var keywords = function (s) { return String(s).toLowerCase(); };
    manifest.forEach(function (d) {
      if (!d.ready) return;
      var day = getDay(d.day);
      var quiz = getQuiz(d.day);
      if (day) {
        day.sections.forEach(function (sec) {
          idx.push({ day: d.day, kind: "章节", text: sec.title });
          (sec.body || []).forEach(function (p) {
            idx.push({ day: d.day, kind: "内容", text: typeof p === "string" ? p : (p && p.text) });
          });
        });
        idx.push({ day: d.day, kind: "目标", text: day.coreQuestion });
        idx.push({ day: d.day, kind: "自测", text: (day.checkpoint && day.checkpoint.title) || "" });
      }
      if (quiz) {
        quiz.questions.forEach(function (q) {
          idx.push({ day: d.day, kind: "题干", text: q.prompt });
          idx.push({ day: d.day, kind: "解析", text: q.explanation });
        });
      }
    });
    _indexCache = idx;
    return idx;
  }

  function searchIndex(query) {
    var q = String(query).trim().toLowerCase();
    if (!q) return [];
    var meta = {};
    manifest.forEach(function (d) { meta[d.day] = d.title; });
    var out = [];
    var seen = {};
    buildIndex().forEach(function (item) {
      if (item.text && String(item.text).toLowerCase().indexOf(q) !== -1) {
        var key = item.day + item.text;
        if (seen[key]) return;
        seen[key] = true;
        out.push({ day: item.day, title: meta[item.day], kind: item.kind, text: item.text });
      }
    });
    return out.slice(0, 20);
  }

  // ---------- 数据备份：导出 / 导入（缓解本地记录丢失风险） ----------
  var BACKUP_KEY = "chemlab-g9:v3:backup-meta";
  function collectAllData() {
    var data = { system: "chemlab-g9", version: 3, exportedAt: new Date().toISOString(), days: {}, review: [], stats: null };
    manifest.forEach(function (d) {
      var rec = dayRecord(d.day);
      if (rec) data.days[d.day] = rec;
    });
    data.review = getReviewQueue();
    data.stats = readJSON(LS_STATS);
    return data;
  }

  function exportBackup() {
    var data = collectAllData();
    var blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    var d = new Date();
    a.download = "chemlab-g9-backup-" + d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function importBackup(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (data.system !== "chemlab-g9" || !data.days) throw new Error("备份文件格式不正确");
        manifest.forEach(function (d) {
          if (data.days[d.day]) saveDayRecord(d.day, data.days[d.day]);
        });
        if (Array.isArray(data.review)) writeJSON(LS_REVIEW, data.review);
        if (data.stats) {
          writeJSON(LS_STATS, { achievements: data.stats.achievements || [], bestCombo: data.stats.bestCombo || 0, reviewCleared: !!data.stats.reviewCleared });
        }
        writeJSON(BACKUP_KEY, { importedAt: new Date().toISOString() });
        window.location.reload();
      } catch (e) {
        window.alert("导入失败：备份文件无法识别。");
      }
    };
    reader.readAsText(file);
  }

  // ---------- 首页：进度总览 + 激励区 + 学习日导航 ----------
  function renderHome() {
    var progress = getProgress();
    var completedCount = Object.keys(progress).filter(function (k) { return progress[k].attempts.length > 0; }).length;
    var readCount = Object.keys(progress).filter(function (k) { return progress[k].read; }).length;
    var total = manifest.length;
    var percent = total ? Math.round((completedCount / total) * 100) : 0;
    var reviewQueue = getReviewQueue();
    var stats = getStats();
    var streak = getStreak();
    var weakTopics = getWeakTopics();
    var achievements = evaluateAchievements(progress, stats);

    var cards = manifest.map(function (d) {
      var record = progress[d.day];
      var statusText = "未开始";
      var stateClass = "day-card mod-" + moduleIndexFor(d.day);
      var checkMark = "";
      if (!d.ready) {
        statusText = "开发中";
        stateClass += " is-locked";
      } else if (record) {
        if (record.attempts.length) {
          var latest = record.attempts[record.attempts.length - 1];
          statusText = "最佳 " + record.best + "/" + latest.total +
            (record.attempts.length > 1 ? " · 尝试 " + record.attempts.length + " 次" : "");
          stateClass += " is-done";
          checkMark = '<span class="day-check" aria-hidden="true">✔</span>';
        } else if (record.read) {
          statusText = "已读完";
          stateClass += " is-read";
        }
      }

      var label =
        '<span class="day-num">DAY ' + d.day + "</span>" +
        '<span class="day-title">' + escapeHtml(d.title) + "</span>" +
        '<span class="day-status">' + statusText + "</span>" +
        miniChart(record ? record.attempts : [], "mod-" + moduleIndexFor(d.day));

      if (d.ready) {
        return '<li class="' + stateClass + '"><a class="day-card-link" href="?day=' + d.day + '">' + checkMark + label + "</a></li>";
      }
      return '<li class="' + stateClass + '"><span class="day-card-link is-disabled" aria-disabled="true">' + checkMark + label + "</span></li>";
    }).join("");

    var moduleBars = renderModuleProgress(progress);

    var weakBlock = weakTopics.length
      ? '<div class="weak-tags" role="list" aria-label="薄弱知识点">' +
          weakTopics.map(function (w) {
            var href = "?view=review&topic=" + encodeURIComponent(w.topic);
            return '<a class="weak-tag" role="listitem" href="' + href + '">薄弱：' + escapeHtml(w.topic) + " <b>" + w.count + "</b> →" + "</a>";
          }).join("") +
        "</div>"
      : "";

    var reviewBlock = reviewQueue.length
      ? '<section class="section">' +
          "<h2>错题复习</h2>" +
          '<p class="hint">你有 ' + reviewQueue.length + " 道答错的题。隔几天再测一次，能检验是否真的掌握了。</p>" +
          '<a class="primary" href="?view=review">开始错题复习（' + reviewQueue.length + " 道）</a>" +
        "</section>"
      : "";

    var achievedCount = achievements.filter(function (a) { return a.unlocked; }).length;
    var badgeWall =
      '<section class="section">' +
        "<h2>成就徽章 <span class='hint' style='font-weight:400;font-size:.85rem'>已点亮 " + achievedCount + " / " + achievements.length + "</span></h2>" +
        '<div class="badge-wall">' +
          achievements.map(function (a) {
            var cls = "badge-item" + (a.unlocked ? "" : " is-locked");
            var ico = a.unlocked ? a.ico : "?";
            return (
              '<div class="' + cls + '"' + (a.unlocked ? "" : ' aria-hidden="true"') + ">" +
                '<span class="b-ico b-ico-' + ACHIEVEMENTS.map(function (x) { return x.id; }).indexOf(a.id) + '">' + ico + "</span>" +
                '<span class="b-name">' + escapeHtml(a.name) + "</span>" +
                '<span class="b-desc">' + escapeHtml(a.desc) + "</span>" +
              "</div>"
            );
          }).join("") +
        "</div>" +
      "</section>";

    var statsStrip =
      '<div class="stats-strip">' +
        '<span class="stat-chip">连续学习 <b>' + streak + "</b> 天</span>" +
        '<span class="stat-chip">最高连对 <b>' + stats.bestCombo + "</b> 题</span>" +
        '<span class="stat-chip">待复习 <b>' + reviewQueue.length + "</b> 题</span>" +
      "</div>" + weakBlock;

app.innerHTML =
      '<div class="page">' +
        '<header class="hero">' +
          '<p class="eyebrow">CHEMLAB-G9</p>' +
          "<h1>九年级化学 · 30 天自学计划</h1>" +
          '<p class="meta">已完成 ' + completedCount + " / " + total + " 天 · 完成率 " + percent + "% · 已读完 " + readCount + " 课</p>" +
          '<div class="progress-bar" role="progressbar" aria-label="学习进度" aria-valuemin="0" aria-valuemax="' + total + '" aria-valuenow="' + completedCount + '">' +
            '<div class="progress-bar-fill" style="width:' + percent + '%"></div>' +
          "</div>" +
          statsStrip +
        "</header>" +
        reviewBlock +
        badgeWall +
        (moduleBars ? '<section class="section mod-section"><h2>模块进度</h2>' + moduleBars + "</section>" : "") +
        '<section class="section">' +
          "<h2>快速查找</h2>" +
          '<label class="search-field"><span>输入关键词（例如“氧气”“守恒”“灭火”）：</span>' +
            '<input type="search" id="search-input" placeholder="搜索 30 天内容 / 题目…" autocomplete="off" />' +
          "</label>" +
          '<div class="search-results" id="search-results" role="list" aria-live="polite"></div>' +
        "</section>" +
        '<section class="section">' +
          "<h2>选择学习日</h2>" +
          '<ul class="day-grid">' + cards + "</ul>" +
        "</section>" +
        '<section class="section backup-section">' +
          "<h2>学习数据</h2>" +
          '<p class="hint">学习记录只保存在本设备浏览器里。建议定期导出备份，换设备或清除数据时再导入恢复。</p>' +
          '<div class="backup-actions">' +
            '<button type="button" class="primary" id="btn-export">导出备份</button>' +
            '<label class="primary ghost" for="btn-import">导入备份' +
              '<input type="file" id="btn-import" accept="application/json,.json" hidden />' +
            "</label>" +
          "</div>" +
        "</section>" +
      "</div>";

    // 关键词搜索
    var searchInput = document.querySelector("#search-input");
    var searchResults = document.querySelector("#search-results");
    if (searchInput && searchResults) {
      searchInput.addEventListener("input", function () {
        var hits = searchIndex(searchInput.value);
        if (!searchInput.value.trim()) {
          searchResults.innerHTML = "";
        } else if (!hits.length) {
          searchResults.innerHTML = '<p class="search-empty">未找到相关内容。</p>';
        } else {
          searchResults.innerHTML = hits.map(function (h) {
            var snippet = h.kind === "章节" || h.kind === "目标" ? escapeHtml(h.text) : escapeHtml(h.text.slice(0, 46)) + (h.text.length > 46 ? "…" : "");
            return (
              '<a class="search-hit" role="listitem" href="?day=' + h.day + '">' +
                '<span class="sh-tag">' + escapeHtml(h.kind) + "</span>" +
                '<span class="sh-body"><b>DAY ' + h.day + " · " + escapeHtml(h.title) + "</b>" + snippet + "</span>" +
              "</a>"
            );
          }).join("");
        }
      });
    }

    // 导出 / 导入。
    var backupExport = document.querySelector("#btn-export");
    if (backupExport) backupExport.addEventListener("click", exportBackup);
    var backupImport = document.querySelector("#btn-import");
    if (backupImport) backupImport.addEventListener("change", function () {
      if (backupImport.files && backupImport.files[0]) importBackup(backupImport.files[0]);
      backupImport.value = "";
    });
  }

  // 按模块统计完成情况，渲染成可展开列表（环形图 + 名称 + 该模块每天明细）。
  function renderModuleProgress(progress) {
    if (!window.ChemLabManifest || !window.ChemLabManifest.modules) return "";
    var modules = window.ChemLabManifest.modules;
    return modules.map(function (mod, idx) {
      var daysInMod = manifest.filter(function (d) {
        return d.module === mod.name;
      });
      if (!daysInMod.length) return "";
      var done = daysInMod.filter(function (d) { return progress[d.day]; }).length;
      var frac = daysInMod.length ? done / daysInMod.length : 0;
      var R = 16, C = 2 * Math.PI * R;
      var ring =
        '<svg class="mod-ring" viewBox="0 0 40 40" role="img" aria-label="' +
        escapeHtml(mod.name) + " 完成 " + done + " / " + daysInMod.length + '">' +
          '<circle cx="20" cy="20" r="' + R + '" class="ring-bg"/>' +
          '<circle cx="20" cy="20" r="' + R + '" class="ring-fg" stroke-dasharray="' +
            (frac * C) + " " + C + '" transform="rotate(-90 20 20)"/>' +
        "</svg>";
      var dayList = daysInMod.map(function (d) {
        var rec = progress[d.day];
        var st = !d.ready ? "开发中" : (rec ? "最佳 " + rec.best + "/" + rec.attempts[0].total : "未开始");
        return "<li><span>DAY " + d.day + " · " + escapeHtml(d.title) + "</span><b>" + st + "</b></li>";
      }).join("");
      return (
        '<details class="mod-block mod-' + idx + '">' +
          "<summary>" + ring +
            '<span class="mod-name">' + escapeHtml(mod.name) + "</span>" +
            '<span class="mod-count">' + done + " / " + daysInMod.length + "</span>" +
          "</summary>" +
          '<ul class="mod-days">' + dayList + "</ul>" +
        "</details>"
      );
    }).join("");
  }

  // ---------- 内容尚未开发的天数 ----------
  function renderMissing(dayKey) {
    app.innerHTML =
      '<div class="page">' +
        '<section class="section">' +
          '<p class="loading">Day ' + escapeHtml(dayKey) + " 的内容还在开发中，请先返回首页选择已完成的学习日。</p>" +
          '<p><a href="?">← 返回首页</a></p>' +
        "</section>" +
      "</div>";
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("加载失败：" + src)); };
      document.body.appendChild(s);
    });
  }

  // ---------- 内容配图：由内建 SVG 渲染器绘制，避免在数据里塞 HTML ----------
  function renderFigure(fig) {
    var renderers = {
      "cylinder-reading": figCylinderReading,   // 量筒读数视角对比（可切换）
      "airtight-test": figAirtightTest,          // 检查装置气密性（气泡动画）
      "graduated-cylinder": figGraduatedCylinder, // 量筒静态示意
      "air-composition": figAirComposition,      // 空气成分环形图
      "candle-burn": figCandleBurn,          // 蜡烛燃烧动画 + 物化变化判断
      "change-judge": figChangeJudge,        // 物质变化类型判断器
      "science-inquiry": figScienceInquiry,  // 科学探究步骤排序（拖拽/按钮/键盘）
      "design-variable": figDesignVariable,  // 控制变量的实验设计练习
      "red-phosphorus": figRedPhosphorus,    // 红磷燃烧测氧气含量
      "oxygen-combustion": figOxygenCombustion, // 三种物质在氧气中燃烧
      "kmno4-setup": figKmno4Setup,          // 高锰酸钾制氧装置图
      "molecule-motion": figMoleculeMotion,  // 分子运动模拟
      "atom-model": figAtomModel,            // 原子结构模型
      "element-card": figElementCard,         // 元素周期表格子
      "water-electrolysis": figWaterElectrolysis, // 电解水实验
      "mass-conservation": figMassConservation,   // 质量守恒白磷燃烧实验
      "water-purification": figWaterPurification, // 水的净化/过滤
      "co2-setup": figCo2Setup,                  // 二氧化碳制取装置
      "ion-form": figIonForm,                     // 离子形成过程
      "water-resources": figWaterResources,       // 水资源分布饼图
      "co-vs-co2": figCoVsCo2Compare,            // CO与CO2性质对比
      "carbon-allotropes": figCarbonAllotropes,   // 碳同素异形体
      "combustion-triangle": figCombustionTriangle, // 燃烧三角
      "fossil-fuels": figFossilFuels,             // 化石燃料与新能源
      "mol-mass-calc": figMolMassCalc,            // 相对分子质量计算（Day14）
      "eqn-write": figEqnWrite,                   // 化学方程式书写步骤（Day20）
      "balancing": figBalancing,                  // 配平练习（Day21）
      "eqn-calc": figEqnCalc,                     // 方程式计算步骤（Day22）
      "knowledge-chain": figKnowledgeChain,       // 知识链条互动图（Day15）
      "carbon-compare": figCarbonCompare,         // 碳单质性质对比（Day24）
      "review-map": figReviewMap,                 // 单元复习知识地图（Day07）
      "valence-calc": figValenceCalc              // 化合价推化学式（Day13）
    };
    var fn = renderers[fig.type];
    if (!fn) return "";
    var body = fn(fig);
    if (!body) return "";
    var caption = fig.caption
      ? '<figcaption class="fig-cap">' + escapeHtml(fig.caption) + "</figcaption>"
      : "";
    return '<figure class="chem-fig" role="group">' + body + caption + "</figure>";
  }

  // 量筒静态示意：一个量筒 + 液面
  function figGraduatedCylinder(fig) {
    var r = 34, cx = 80, cy = 100;
    var gradId = "liq-" + uid();
    var liqTop = 60;
    var body = [
      svgParts.liquidGradient(gradId, "#bfe9e4", "#7cc7bf"),
      svgParts.vessel(cx - r, 26, 2 * r, 140, 16),
      '<path d="M' + (cx - r + 2) + " " + liqTop + " L" + (cx + r - 2) + " " + liqTop +
        ' L' + (cx + r - 2) + " " + (26 + 136) + " L" + (cx - r + 2) + " " + (26 + 136) + ' Z" fill="url(#' + gradId + ')"/>',
      '<ellipse cx="' + cx + '" cy="' + liqTop + '" rx="' + (r - 2) + '" ry="6" fill="#a7dcd5"/>',
      '<rect x="' + (cx - 14) + '" y="0" width="28" height="30" rx="6" fill="none" stroke="#587073" stroke-width="3"/>',
      '<text x="' + cx + '" y="19" fill="#173033" font-size="13" text-anchor="middle">mL</text>'
    ].join("");
    return figSvg(160, 176, body);
  }

  // 唯一性 id：配图在页面中可能多次出现，渐变/裁剪 id 不能冲突。
  function uid() {
    return Math.random().toString(36).slice(2, 8);
  }

  // 量筒读数：平视 / 俯视 / 仰视三种视角，可点击切换。
  // 状态几何全部来自 CYLINDER_STATES，此处只负责按当前状态拼装 SVG。
  function figCylinderReading(fig) {
    var cx = 92;          // 量筒中心 x
    var top = 34;         // 量筒内顶
    var bottom = 160;     // 量筒内底
    var meniscusY = 78;   // 凹液面最低点实际位置
    var pills = Object.keys(CYLINDER_STATES).map(function (k) {
      return '<button type="button" class="fig-pill" data-state="' + k + '" aria-pressed="false">' + CYLINDER_STATES[k].label + "</button>";
    }).join("");
    var svgId = "cyl-" + uid();
    var gradId = svgId + "-liq";
    var defs =
      '<defs>' +
        svgParts.liquidGradient(gradId, "#bfe9e4", "#5bb7ae") +
        '<clipPath id="' + svgId + '-clip"><rect x="' + (cx - 34) + '" y="' + top + '" width="68" height="' + (bottom - top) + '" rx="14"/></clipPath>' +
      "</defs>";
    var inner =
      defs +
      '<g data-cyl-stage>' +
        // 量筒外壁（透明玻璃感）
        svgParts.vessel(cx - 36, 26, 72, 144, 16) +
        // 底部液体（整块，用 clip）
        '<g clip-path="url(#' + svgId + '-clip)">' +
          '<rect class="cyl-liquid" data-liquid x="' + (cx - 34) + '" y="' + meniscusY + '" width="68" height="' + (bottom - meniscusY) + '" fill="url(#' + gradId + ')"/>' +
        "</g>" +
        // 凹液面（中间低两边高）
        '<path class="cyl-meniscus" data-meniscus d="M' + (cx - 34) + " " + (meniscusY - 4) +
          " Q " + cx + " " + (meniscusY + 6) + " " + (cx + 34) + " " + (meniscusY - 4) +
          '" fill="none" stroke="#2f7d76" stroke-width="2"/>' +
        // 刻度线 + 数字
        (function () {
          var s = "";
          for (var v = 20; v <= 90; v += 10) {
            var y = bottom - ((v - 20) / 70) * (bottom - top);
            s += '<line class="cyl-scale" x1="' + (cx + 34) + '" y1="' + y + '" x2="' + (cx + 43) + '" y2="' + y + '" stroke="#587073" stroke-width="2"/>';
            s += '<text x="' + (cx + 47) + '" y="' + (y + 4) + '" fill="#587073" font-size="9" text-anchor="start">' + v + "</text>";
          }
          return s;
        }()) +
        // 量筒口
        '<rect x="' + (cx - 14) + '" y="0" width="28" height="30" rx="6" fill="none" stroke="#587073" stroke-width="3"/>' +
        '<text x="' + cx + '" y="19" fill="#173033" font-size="11" text-anchor="middle">mL</text>' +
        // 眼睛 + 视线（占位，由事件绑定按 CYLINDER_STATES 填充）
        '<g class="cyl-eye-group" data-eye-group>' +
          '<g class="cyl-eye" data-eye></g>' +
          '<g class="cyl-sight" data-sight></g>' +
          '<circle class="cyl-read" data-read r="5" fill="#e67b32" stroke="#fff" stroke-width="1.5"/>' +
        "</g>" +
      "</g>";
    var html =
      '<div class="fig-cyl">' +
        '<div class="fig-ctrl" role="group" aria-label="切换读数视角">' + pills + "</div>" +
        figSvg(220, 200, inner) +
        '<p class="cyl-note" data-note role="status"></p>' +
      "</div>";
    return html;
  }

  // 检查装置气密性：手握试管，导管伸入水中，气泡沿导管冒出（可切换不漏气 / 漏气）。
  function figAirtightTest(fig) {
    var svgId = "air-" + uid();
    var grad = svgId + "-water";
    var lip = svgId + "-lip";
    var pills =
      '<div class="fig-ctrl" role="group" aria-label="切换气密性状态">' +
        '<button type="button" class="fig-pill" data-air="ok" aria-pressed="false">装置不漏气</button>' +
        '<button type="button" class="fig-pill" data-air="leak" aria-pressed="false">装置漏气</button>' +
      "</div>";
    var inner =
      '<defs>' +
        svgParts.liquidGradient(grad, "#bfe9e4", "#4aa7a0") +
        svgParts.liquidGradient(lip, "#e8f6f3", "#bcd9d4") +
      "</defs>" +
      '<g data-air-stage>' +
        // 试管（斜置，带玻璃质感）
        '<g class="air-tube">' +
          '<line x1="14" y1="26" x2="110" y2="148" stroke="#173033" stroke-width="9" stroke-linecap="round"/>' +
          '<line x1="10" y1="30" x2="104" y2="150" stroke="rgba(255,255,255,.55)" stroke-width="3"/>' +
          '<line x1="106" y1="139" x2="122" y2="157" stroke="#173033" stroke-width="9" stroke-linecap="round"/>' +
        "</g>" +
        // 手（握试管）
        '<g class="air-hand" fill="#f4c49a" stroke="#c98a5e" stroke-width="1.5">' +
          '<ellipse cx="58" cy="88" rx="16" ry="22" transform="rotate(-45 58 88)"/>' +
          '<ellipse cx="74" cy="104" rx="14" ry="20" transform="rotate(-30 74 104)"/>' +
          '<rect x="40" y="70" width="14" height="34" rx="7" transform="rotate(-50 47 87)"/>' +
        "</g>" +
        '<text x="30" y="20" fill="#173033" font-size="13" font-weight="600">手握试管外壁</text>' +
        // 导管
        '<path class="air-pipe" d="M116 150 L152 150 L152 176" stroke="#587073" stroke-width="5" fill="none" stroke-linecap="round"/>' +
        // 烧杯
        svgParts.beaker(126, 178, 80, 32) +
        '<path d="M126 178 L206 178" stroke="#8fb6b0" stroke-width="4"/>' +
        // 水
        '<g clip-path="url(#' + svgId + '-waterclip)">' +
          '<rect class="air-water" data-water x="129" y="182" width="74" height="28" fill="url(#' + grad + ')" opacity="0.85"/>' +
          '<g class="air-bubbles" data-bubbles>' + svgParts.bubbles(152, 196, 3) + "</g>" +
        "</g>" +
        '<clipPath id="' + svgId + '-waterclip"><rect x="126" y="176" width="84" height="40"/></clipPath>' +
        // 结果说明（SVG 外，HTML 可换行）
        "" +
      "</g>";
    var html =
      '<div class="fig-air">' +
        pills +
        figSvg(250, 214, inner) +
        '<p class="air-result" data-airnote role="status"></p>' +
      "</div>";
    return html;
  }

  // 空气成分环形图：按体积分数绘制，配图例。
  function figAirComposition(fig) {
    var cx = 90, cy = 90, r = 58;
    var C = 2 * Math.PI * r;
    var segs = [
      { label: "氮气", pct: "78%", v: 0.78, color: "#4aa7a0" },
      { label: "氧气", pct: "21%", v: 0.21, color: "#e67b32" },
      { label: "稀有气体", pct: "0.94%", v: 0.0094, color: "#8a9ba8" },
      { label: "二氧化碳", pct: "0.03%", v: 0.0003, color: "#6b5ba8" },
      { label: "其他气体和杂质", pct: "0.03%", v: 0.0003, color: "#c2534f" }
    ];
    var offset = 0;
    var rings = segs.map(function (s) {
      var len = Math.max(s.v * C, 0.5);
      var dash = len + " " + C;
      var seg = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + s.color +
        '" stroke-width="20" stroke-dasharray="' + dash + '" stroke-dashoffset="' + (-offset) +
        '" transform="rotate(-90 ' + cx + " " + cy + ')" opacity="0.92"/>';
      offset += len;
      return seg;
    }).join("");
    var legend = segs.map(function (s) {
      return (
        '<div class="air-legend"><span class="swatch" style="background:' + s.color + '"></span>' +
        "<span>" + s.label + " · " + s.pct + "</span></div>"
      );
    }).join("");
    return (
      '<div class="air-wrap">' +
        figSvg(180, 180, rings) +
        '<div class="air-legend-box" role="list" aria-label="空气成分">' + legend + "</div>" +
      "</div>"
    );
  }

  // ---------- 蜡烛燃烧动画：点燃/熄灭，展示熔化和燃烧两个过程 ----------
  function figCandleBurn(fig) {
    var id = "cnd-" + uid();
    var pills = '<div class="fig-ctrl">' +
      '<button type="button" class="fig-pill" data-action="light">点燃</button>' +
      '<button type="button" class="fig-pill" data-action="extinguish">熄灭</button>' +
      '</div>';
    var svgId = id + "-svg";
    var defs =
      '<defs>' +
        '<linearGradient id="' + id + '-flame" x1="0" y1="1" x2="0" y2="0">' +
          '<stop offset="0" stop-color="#f5a623"/><stop offset="60%" stop-color="#f7c948"/>' +
          '<stop offset="100%" stop-color="#fff4b8" stop-opacity="0.6"/>' +
        '</linearGradient>' +
        '<filter id="' + id + '-glow"><feGaussianBlur stdDeviation="3" result="blur"/>' +
          '<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      '</defs>';
    var candleBody =
      '<rect x="68" y="100" width="24" height="60" rx="3" fill="#f5e6ca" stroke="#c9a96e" stroke-width="1.5"/>' +
      '<rect x="72" y="100" width="4" height="60" rx="2" fill="#fff8e8" opacity="0.5"/>';
    var wick = '<line x1="80" y1="100" x2="80" y2="88" stroke="#5a4a32" stroke-width="2" stroke-linecap="round"/>';
    var flame = '<g class="candle-flame" data-flame opacity="0" filter="url(#' + id + '-glow)">' +
      '<ellipse cx="80" cy="74" rx="8" ry="16" fill="url(#' + id + '-flame)"/>' +
      '<ellipse cx="80" cy="78" rx="4" ry="10" fill="#fff4b8" opacity="0.7"/>' +
    '</g>';
    var smoke = '<g class="candle-smoke" data-smoke opacity="0">' +
      '<circle cx="76" cy="58" r="4" fill="#b0c4c1" opacity="0.4"/>' +
      '<circle cx="84" cy="52" r="5" fill="#b0c4c1" opacity="0.3"/>' +
      '<circle cx="80" cy="44" r="6" fill="#b0c4c1" opacity="0.2"/>' +
    '</g>';
    var waxDrip = '<path class="candle-wax" data-wax opacity="0" d="M92 105 Q96 115 93 125 Q91 130 94 132 L94 158 L90 158 L90 132 Q87 128 89 124 Q92 114 89 105 Z" fill="#f5e6ca" stroke="#c9a96e" stroke-width="1"/>';
    var products = '<g class="candle-products" data-products opacity="0">' +
      '<text x="148" y="55" fill="#146c6e" font-size="10" font-weight="600" text-anchor="end">CO₂ + H₂O</text>' +
      '<text x="148" y="68" fill="#587073" font-size="8" text-anchor="end">新物质生成 → 化学变化</text>' +
      '<line x1="140" y1="58" x2="92" y2="68" stroke="#587073" stroke-width="1" opacity="0.5"/>' +
    '</g>';
    var meltNote = '<g class="candle-melt" data-melt opacity="0">' +
      '<text x="48" y="130" fill="#e67b32" font-size="9" font-weight="600">熔化 → 物理变化</text>' +
      '<text x="48" y="142" fill="#587073" font-size="8">状态改变，无新物质</text>' +
    '</g>';
    var svgInner = defs +
      '<rect x="60" y="155" width="40" height="4" rx="2" fill="#d9e8e5" stroke="#b0c4c1" stroke-width="1"/>' +
      candleBody + wick + flame + smoke + waxDrip + products + meltNote;
    var html =
      '<div class="fig-candle" data-candle>' +
        pills +
        figSvg(160, 170, svgInner) +
        '<p class="candle-hint" data-hint>点击「点燃」观察蜡烛燃烧过程。</p>' +
      '</div>';
    return html;
  }

  // ---------- 物质变化类型判断器：给出描述，判断物理/化学变化 ----------
  function figChangeJudge(fig) {
    var items = [
      { text: "冰融化成水", type: "物理", note: "状态改变，没有新物质。" },
      { text: "铁钉生锈", type: "化学", note: "铁变成了铁锈（新物质）。" },
      { text: "玻璃破碎", type: "物理", note: "形状改变，没有新物质。" },
      { text: "食物腐败", type: "化学", note: "产生了新物质，有异味和变色。" }
    ];
    var pills = items.map(function (item, i) {
      return '<button type="button" class="fig-pill judge-btn" data-idx="' + i + '">' + item.text + "</button>";
    }).join("");
    var resultArea = '<div class="judge-result" data-result>点击上方卡片开始判断。</div>';
    return '<div class="fig-judge" data-judge>' +
      '<div class="fig-ctrl judge-grid">' + pills + '</div>' +
      resultArea +
    '</div>';
  }

  // ---------- 控制变量实验设计练习：点选正确做法，即时反馈 ----------
  function figDesignVariable(fig) {
    var scenarios = [
      {
        q: "探究「氧气浓度」是否影响铁丝燃烧的剧烈程度时，应怎么做？",
        options: [
          "同时改变氧气浓度、铁丝粗细和温度，观察铁丝燃烧",
          "只改变氧气浓度，其他因素（粗细、温度等）都相同，比较铁丝燃烧情况",
          "只改变铁丝粗细，氧气浓度等其他条件都不改"
        ],
        correct: 1,
        fb: "氧气浓度是被探究的变量，只改变它，其余变量保持相同，才能判断是不是氧气浓度在影响结果。"
      },
      {
        q: "探究「是否有催化剂」是否影响过氧化氢（双氧水）产生氧气快慢，正确做法是？",
        options: [
          "一组加、一组不加催化剂，其余条件（浓度、温度、液量）都一样，比较冒出气泡的快慢",
          "一组加催化剂，另一组加热，比较哪组更快",
          "只在加催化剂的一组里各放一点对付，不做对比"
        ],
        correct: 0,
        fb: "两组只在“有没有催化剂”这一个变量上不同，其余都相同，才能说明气泡快慢是不是催化剂引起的。"
      },
      {
        q: "想确认「水温」是否影响蔗糖溶解的快慢，探究时应该？",
        options: [
          "改变水温，同时保持糖量、水量、是否搅拌等其他条件相同，比较溶解快慢",
          "水温调高，同时还用力搅拌，想跑到处更快",
          "觉得水温越高一定越快，无需对比"
        ],
        correct: 0,
        fb: "温度是变量，糖量、水量、搅拌这些控制变量都要保持不变，结论才成立。"
      }
    ];
    var cards = scenarios.map(function (sc, si) {
      var opts = sc.options.map(function (o, oi) {
        return '<label class="option"><input type="radio" name="dv-' + si + '" value="' + oi + '"> ' + escapeHtml(o) + "</label>";
      }).join("");
      return (
        '<div class="dv-scenario" data-dvsp="' + si + '" data-answer="' + sc.correct + '" data-fb="' + escapeHtml(sc.fb) + '">' +
          "<h3 class='dv-q'>" + escapeHtml(sc.q) + "</h3>" +
          opts +
          '<p class="dv-fb" data-dvfb role="status" aria-live="polite"></p>' +
        "</div>"
      );
    }).join("");
    return (
      '<div class="fig-dv" data-dv>' +
        '<p class="inq-instruct">每题先自己判断，再点选；答题后即时看解析。</p>' +
        cards +
      "</div>"
    );
  }

  // ---------- 科学探究步骤排序（Pointer Events 触摸拖拽 + ↑↓ 按钮，两套并存） ----------
  function figScienceInquiry(fig) {
    var steps = [
      { id: "ask", text: "提出问题", correct: 0 },
      { id: "hypo", text: "猜想与假设", correct: 1 },
      { id: "plan", text: "制定计划", correct: 2 },
      { id: "experiment", text: "进行实验", correct: 3 },
      { id: "evidence", text: "收集证据", correct: 4 },
      { id: "conclude", text: "得出结论", correct: 5 }
    ];
    var initialOrder = [3, 0, 4, 1, 5, 2];
    var slots = steps.map(function (_, i) {
      var itemIndex = initialOrder[i];
      return (
        '<li class="inq-slot" data-index="' + i + '">' +
          '<span class="slot-num">' + (i + 1) + "</span>" +
          '<span class="inq-item" data-id="' + steps[itemIndex].id + '" tabindex="0" role="button" aria-describedby="inq-instruct">' + steps[itemIndex].text + "</span>" +
          '<span class="inq-arrows">' +
            '<button type="button" class="arrow-btn" data-shift="-1" aria-label="上移一步"' + (i === 0 ? " disabled" : "") + ">↑</button>" +
            '<button type="button" class="arrow-btn" data-shift="1" aria-label="下移一步"' + (i === steps.length - 1 ? " disabled" : "") + ">↓</button>" +
          "</span>" +
        "</li>"
      );
    }).join("");
    var resetBtn = '<button type="button" class="fig-pill" data-inq-reset>重置</button>';
    var checkBtn = '<button type="button" class="fig-pill" data-inq-check>检查顺序</button>';
    var resultDiv = '<div class="inq-result" data-inqresult role="status" aria-live="polite"></div>';
    return '<div class="fig-inquiry" data-inquiry>' +
      '<p class="inq-instruct" id="inq-in-hint">把下列六个步骤按正确顺序排好：可拖动卡片换位，或用每格右侧的 ↑↓ 按钮。顺序为 提出问题 → 猜想与假设 → 制定计划 → 进行实验 → 收集证据 → 得出结论。</p>' +
      '<ol class="inq-slots">' + slots + "</ol>" +
      '<p class="inq-keys hint">键盘操作：聚焦任一步骤后按 ↑/↓ 可换位。</p>' +
      '<div class="fig-ctrl inq-ctrl">' + checkBtn + resetBtn + "</div>" +
      resultDiv +
    "</div>";
  }

  // ---------- 红磷燃烧测定氧气含量 ----------
  function figRedPhosphorus(fig) {
    var id = "rp-" + uid();
    var pills = '<div class="fig-ctrl">' +
      '<button type="button" class="fig-pill" data-stage="setup">实验前</button>' +
      '<button type="button" class="fig-pill" data-stage="burn">燃烧中</button>' +
      '<button type="button" class="fig-pill" data-stage="result">冷却后</button>' +
      '</div>';
    var defs =
      '<defs>' +
        '<linearGradient id="' + id + '-water" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#bfe9e4"/><stop offset="1" stop-color="#7cc7bf"/>' +
        '</linearGradient>' +
      '</defs>';
    // Stage: setup
    var setupG =
      '<rect x="30" y="100" width="60" height="70" rx="4" fill="rgba(255,255,255,.5)" stroke="#587073" stroke-width="2"/>' +
      '<path d="M50 100 L50 70 Q50 60 60 60 L80 60 Q90 60 90 70 L90 100" fill="none" stroke="#587073" stroke-width="2"/>' +
      '<rect x="46" y="56" width="8" height="10" rx="2" fill="#e67b32" opacity="0.8"/>' +
      '<text x="60" y="140" fill="#587073" font-size="9" text-anchor="middle">钟罩</text>' +
      '<rect x="15" y="155" width="130" height="20" rx="3" fill="rgba(191,233,228,.4)" stroke="#587073" stroke-width="1.5"/>' +
      '<text x="80" y="169" fill="#587073" font-size="8" text-anchor="middle">水槽（水）</text>' +
      '<text x="60" y="120" fill="#146c6e" font-size="9" text-anchor="middle" data-rp-note>红磷在密闭容器内</text>';
    // Stage: burning
    var burnG =
      '<rect x="30" y="100" width="60" height="70" rx="4" fill="rgba(255,255,255,.5)" stroke="#587073" stroke-width="2"/>' +
      '<path d="M50 100 L50 70 Q50 60 60 60 L80 60 Q90 60 90 70 L90 100" fill="none" stroke="#587073" stroke-width="2"/>' +
      '<ellipse cx="60" cy="58" rx="6" ry="8" fill="#e67b32" opacity="0.9" class="rp-flame"/>' +
      '<ellipse cx="60" cy="54" rx="3" ry="5" fill="#f7c948" opacity="0.8"/>' +
      '<circle cx="55" cy="45" r="2" fill="#b0c4c1" opacity="0.5" class="rp-smoke1"/>' +
      '<circle cx="65" cy="42" r="2.5" fill="#b0c4c1" opacity="0.4" class="rp-smoke2"/>' +
      '<text x="60" y="120" fill="#c2534f" font-size="9" text-anchor="middle" data-rp-note">红磷燃烧，产生大量白烟</text>' +
      '<rect x="15" y="155" width="130" height="20" rx="3" fill="rgba(191,233,228,.4)" stroke="#587073" stroke-width="1.5"/>' +
      '<text x="80" y="169" fill="#587073" font-size="8" text-anchor="middle">水槽</text>';
    // Stage: result
    var resultG =
      '<rect x="30" y="100" width="60" height="70" rx="4" fill="rgba(255,255,255,.5)" stroke="#587073" stroke-width="2"/>' +
      '<path d="M50 100 L50 70 Q50 60 60 60 L80 60 Q90 60 90 70 L90 100" fill="none" stroke="#587073" stroke-width="2"/>' +
      '<rect x="32" y="120" width="56" height="48" fill="url(#' + id + '-water)"/>' +
      '<text x="60" y="150" fill="#146c6e" font-size="10" text-anchor="middle" font-weight="600" data-rp-note>水面上升约 1/5</text>' +
      '<text x="60" y="112" fill="#587073" font-size="8" text-anchor="middle">剩余气体（主要是氮气）</text>' +
      '<rect x="15" y="155" width="130" height="20" rx="3" fill="rgba(191,233,228,.4)" stroke="#587073" stroke-width="1.5"/>' +
      '<text x="80" y="169" fill="#587073" font-size="8" text-anchor="middle">水槽</text>';
    var stageMap = { setup: setupG, burn: burnG, result: resultG };
    var svgInner = defs +
      '<g class="rp-stage" data-rp-stage>' + setupG + '</g>';
    var html =
      '<div class="fig-rp" data-rp>' +
        pills +
        figSvg(160, 185, svgInner) +
        '<p class="rp-hint" data-rphint>点击按钮切换实验阶段。</p>' +
      '</div>';
    return html;
  }

  // ---------- 三种物质在氧气中燃烧 ----------
  function figOxygenCombustion(fig) {
    var subs = [
      { name: "木炭", color: "#f5f5f5", effect: "发出白光，放热", product: "CO₂（使石灰水变浑浊）", detail: "碳 + 氧气 → 二氧化碳" },
      { name: "硫", color: "#e67b32", effect: "蓝紫色火焰", product: "SO₂（刺激性气味）", detail: "硫 + 氧气 → 二氧化硫" },
      { name: "铁丝", color: "#587073", effect: "火星四射，黑色固体", product: "Fe₃O₄", detail: "铁 + 氧气 → 四氧化三铁" }
    ];
    var pills = subs.map(function (s, i) {
      return '<button type="button" class="fig-pill" data-sub="' + i + '">' + s.name + '</button>';
    }).join("");
    var id = "oc-" + uid();
    var defs =
      '<defs>' +
        '<radialGradient id="' + id + '-glow"><stop offset="0" stop-color="#f7c948" stop-opacity="0.6"/>' +
          '<stop offset="1" stop-color="#f7c948" stop-opacity="0"/></radialGradient>' +
      '</defs>';
    var svgId = id;
    var inner = defs +
      '<rect x="10" y="10" width="140" height="90" rx="6" fill="rgba(20,108,110,.06)" stroke="#146c6e" stroke-width="1.5"/>' +
      '<text x="80" y="26" fill="#146c6e" font-size="9" text-anchor="middle" font-weight="600">集气瓶（充满氧气）</text>' +
      '<line x1="30" y1="30" x2="130" y2="30" stroke="#d9e8e5" stroke-width="1"/>' +
      '<text x="80" y="78" fill="#587073" font-size="9" text-anchor="middle" data-oc-effect>点击上方按钮观察现象</text>' +
      '<text x="80" y="92" fill="#146c6e" font-size="9" text-anchor="middle" font-weight="600" data-oc-product></text>';
    var resultArea =
      '<div class="oc-result" data-ocresult>' +
        '<p class="oc-name" data-ocname></p>' +
        '<p class="oc-detail" data-ocdetail></p>' +
      '</div>';
    return '<div class="fig-oc" data-oc>' +
      '<div class="fig-ctrl">' + pills + '</div>' +
      figSvg(160, 108, inner) +
      resultArea +
    '</div>';
  }

  // ---------- 高锰酸钾制氧气装置（可点击标注） ----------
  function figKmno4Setup(fig) {
    var highlights = [
      { key: "tube", label: "试管（口略向下倾斜）", note: "防止冷凝水回流炸裂试管" },
      { key: "cotton", label: "棉花", note: "防止高锰酸钾粉末进入导管" },
      { key: "酒精灯", label: "酒精灯", note: "加热提供反应所需温度" },
      { key: "收集", label: "排水法收集", note: "氧气不易溶于水，可用排水法" }
    ];
    var pills = highlights.map(function (h) {
      return '<button type="button" class="fig-pill" data-part="' + h.key + '">' + h.label + '</button>';
    }).join("");
    var id = "km-" + uid();
    var svgInner =
      '<defs>' +
        '<linearGradient id="' + id + '-flame" x1="0" y1="1" x2="0" y2="0">' +
          '<stop offset="0" stop-color="#e67b32"/><stop offset="1" stop-color="#f7c948"/>' +
        '</linearGradient>' +
      '</defs>' +
      // 试管（略向下倾斜）
      '<g class="km-tube" data-part="tube">' +
        '<rect x="20" y="30" width="80" height="18" rx="3" fill="rgba(255,255,255,.6)" stroke="#587073" stroke-width="2" transform="rotate(-5 60 39)"/>' +
        '<rect x="22" y="32" width="12" height="14" rx="1" fill="#6b5ba8" opacity="0.7" transform="rotate(-5 60 39)"/>' +
        '<text x="28" y="43" fill="#fff" font-size="6" transform="rotate(-5 60 39)">KMnO₄</text>' +
      '</g>' +
      // 棉花
      '<g class="km-cotton" data-part="cotton">' +
        '<ellipse cx="100" cy="28" rx="5" ry="3" fill="#f5e6ca" stroke="#c9a96e" stroke-width="1"/>' +
      '</g>' +
      // 导管
      '<path d="M104 28 L120 28 L120 55 L145 55" fill="none" stroke="#587073" stroke-width="2" stroke-linejoin="round"/>' +
      // 酒精灯
      '<g class="km-heat" data-part="heat">' +
        '<path d="M30 85 L50 85 L48 100 L32 100 Z" fill="#f5e6ca" stroke="#c9a96e" stroke-width="1.5"/>' +
        '<ellipse cx="40" cy="82" rx="6" ry="10" fill="url(#' + id + '-flame)" class="km-flame"/>' +
      '</g>' +
      // 铁架台
      '<line x1="15" y1="100" x2="15" y2="50" stroke="#587073" stroke-width="3" stroke-linecap="round"/>' +
      '<rect x="8" y="55" width="14" height="4" rx="2" fill="#587073"/>' +
      // 集气瓶（排水法）
      '<g class="km-collect" data-part="收集">' +
        '<rect x="130" y="30" width="30" height="50" rx="4" fill="rgba(191,233,228,.3)" stroke="#587073" stroke-width="2"/>' +
        '<rect x="132" y="45" width="26" height="33" rx="2" fill="rgba(191,233,228,.5)"/>' +
        '<text x="145" y="65" fill="#146c6e" font-size="7" text-anchor="middle">O₂</text>' +
      '</g>' +
      '<text x="80" y="120" fill="#587073" font-size="8" text-anchor="middle" data-kmnote>点击按钮查看各部件作用</text>';
    var resultBox = '<div class="km-result" data-kmresult></div>';
    return '<div class="fig-km" data-km>' +
      '<div class="fig-ctrl">' + pills + '</div>' +
      figSvg(170, 135, svgInner) +
      resultBox +
    '</div>';
  }

  // ---------- 分子运动模拟：气体/液体/固体 + 温度控制 ----------
  function figMoleculeMotion(fig) {
    var states = [
      { key: "solid", label: "固态", color: "#4aa7a0", spacing: "紧密", motion: "振动", n: 16 },
      { key: "liquid", label: "液态", color: "#2f9aa8", spacing: "较近", motion: "滑动", n: 16 },
      { key: "gas", label: "气态", color: "#e67b32", spacing: "远", motion: "快速无规则", n: 16 }
    ];
    var pills = states.map(function (s) {
      return '<button type="button" class="fig-pill" data-state="' + s.key + '">' + s.label + '</button>';
    }).join("");
    var particles = states.map(function (s) {
      var cx = 40, cy = 40, r = 5, spacing = s.key === "solid" ? 12 : (s.key === "liquid" ? 14 : 28);
      var cols = s.key === "solid" ? 4 : (s.key === "liquid" ? 4 : 3);
      var dots = "";
      for (var i = 0; i < s.n; i++) {
        var col = i % cols, row = Math.floor(i / cols);
        var x = cx + col * spacing + (s.key === "liquid" ? Math.sin(i * 1.3) * 3 : 0);
        var y = cy + row * spacing + (s.key === "gas" ? (Math.random() - 0.5) * 10 : 0);
        dots += '<circle class="mol-particle" data-state="' + s.key + '" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="4" fill="' + s.color + '" opacity="0.85"/>';
      }
      return dots;
    }).join("");
    var svgInner =
      '<g class="mol-solid" data-mol="solid">' + particles.split('data-state="gas"')[0].split('data-state="liquid"')[0] + '</g>' +
      '<line x1="10" y1="72" x2="110" y2="72" stroke="#d9e8e5" stroke-width="1" stroke-dasharray="4,3"/>' +
      '<g class="mol-liquid" data-mol="liquid">' + particles.split('data-state="gas"')[0].split('data-state="liquid"')[1] + '</g>' +
      '<line x1="10" y1="120" x2="110" y2="120" stroke="#d9e8e5" stroke-width="1" stroke-dasharray="4,3"/>' +
      '<g class="mol-gas" data-mol="gas">' + particles.split('data-state="gas"')[1] + '</g>';
    var descBox = '<div class="mol-desc" data-moldesc>' +
      '<p class="mol-state-name" data-molname>固态</p>' +
      '<p class="mol-desc-text" data-moldtxt>分子排列紧密，只能在固定位置振动。</p>' +
    '</div>';
    return '<div class="fig-mol" data-molfig>' +
      '<div class="fig-ctrl">' + pills + '</div>' +
      figSvg(120, 155, svgInner) +
      descBox +
    '</div>';
  }

  // ---------- 原子结构模型：切换氢/氧/钠，查看质子·中子·电子与结构示意图 ----------
  function figAtomModel(fig) {
    var atoms = [
      {
        key: "h", symbol: "H", name: "氢", protons: 1, neutrons: 0,
        shells: [1],
        tip: "氢原子只有 1 个质子、1 个核外电子，无中子，最简单。"
      },
      {
        key: "o", symbol: "O", name: "氧", protons: 8, neutrons: 8,
        shells: [2, 6],
        tip: "氧原子：质子数 8 = 核外电子数 8，两层电子排布 2、6。"
      },
      {
        key: "na", symbol: "Na", name: "钠", protons: 11, neutrons: 12,
        shells: [2, 8, 1],
        tip: "钠原子：质子数 11 = 核外电子数 11，三层排布 2、8、1。"
      }
    ];
    var pills = atoms.map(function (a) {
      return '<button type="button" class="fig-pill" data-atom="' + a.key + '">' + a.name + " " + a.symbol + "</button>";
    }).join("");

    var nucleusInfo = '<g class="atom-nucleus" data-nucleus></g>';
    var shellsGroup = '<g class="atom-shells" data-shells></g>';
    var labels = '<g class="atom-labels" data-alabels></g>';

    var infoBox =
      '<div class="atom-info">' +
        '<p class="atom-tip" data-atip></p>' +
        '<table class="atom-table">' +
          "<tbody>" +
            '<tr><td>质子数</td><td data-ap=""></td></tr>' +
            '<tr><td>中子数</td><td data-an=""></td></tr>' +
            '<tr><td>核外电子数</td><td data-ae=""></td></tr>' +
            '<tr><td>相对原子质量</td><td data-am=""></td></tr>' +
            '<tr><td>电性</td><td data-acharge=""></td></tr>' +
          "</tbody>" +
        "</table>" +
      "</div>";

    return '<div class="fig-atom" data-atomfig>' +
      '<div class="fig-ctrl">' + pills + '</div>' +
      figSvg(200, 200, '<defs></defs>' + nucleusInfo + shellsGroup + labels) +
      infoBox +
    '</div>';
  }

  // ---------- 元素周期表格子：切换元素，解读格子里的四项信息 ----------
  function figElementCard(fig) {
    var elements = [
      { symbol: "H", name: "氢", num: 1, mass: "1.008", tip: "原子序数 1 = 质子数 1，位于周期表第一格。" },
      { symbol: "He", name: "氦", num: 2, mass: "4.003", tip: "原子序数 2 = 质子数 2，惰性气体，最外层 2 个电子。" },
      { symbol: "O", name: "氧", num: 8, mass: "16.00", tip: "原子序数 8 = 质子数 8，地壳中含量最多的元素。" },
      { symbol: "Na", name: "钠", num: 11, mass: "22.99", tip: "原子序数 11 = 质子数 11，金属元素，易失电子。" },
      { symbol: "Fe", name: "铁", num: 26, mass: "55.85", tip: "原子序数 26 = 质子数 26，生活中常见金属。" }
    ];
    var pills = elements.map(function (el, i) {
      return '<button type="button" class="fig-pill" data-element="' + i + '">' + el.symbol + "</button>";
    }).join("");

    var card =
      '<div class="element-cell" data-ecell>' +
        '<span class="el-num" data-ecell-num>1</span>' +
        '<span class="el-symbol" data-ecell-symbol>H</span>' +
        '<span class="el-name" data-ecell-name>氢</span>' +
        '<span class="el-mass" data-ecell-mass>1.008</span>' +
      "</div>";
    var legend =
      '<div class="el-legend">' +
        '<span class="el-legend-num">原子序数<br>= 质子数</span>' +
        '<span class="el-legend-symbol">元素符号</span>' +
        '<span class="el-legend-name">元素名称</span>' +
        '<span class="el-legend-mass">相对原子质量</span>' +
      "</div>";
    var tip = '<p class="el-tip" data-etip></p>';

    return '<div class="fig-element" data-elfig>' +
      '<div class="fig-ctrl">' + pills + '</div>' +
      '<div class="el-wrap">' + card + legend + '</div>' +
      tip +
    '</div>';
  }

  // ---------- 电解水实验动画：正氧负氢，氢二氧一 ----------
  function figWaterElectrolysis(fig) {
    var id = "ele-" + uid();
    var pills = '<div class="fig-ctrl">' +
      '<button type="button" class="fig-pill" data-stage="off">通电前</button>' +
      '<button type="button" class="fig-pill" data-stage="on" aria-pressed="true">通电</button>' +
      '</div>';
    var defs =
      '<defs>' +
        '<linearGradient id="' + id + '-h2" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#bfe9e4"/><stop offset="1" stop-color="#7cc7bf"/>' +
        '</linearGradient>' +
        '<linearGradient id="' + id + '-water" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#d4f1f0"/><stop offset="1" stop-color="#a7dcd5"/>' +
        '</linearGradient>' +
      '</defs>';
    var uShape =
      '<path d="M40 40 L40 120 Q40 150 70 150 L110 150 Q140 150 140 120 L140 40" fill="none" stroke="#587073" stroke-width="6" stroke-linecap="round"/>' +
      '<rect x="36" y="30" width="108" height="16" rx="4" fill="rgba(255,255,255,.6)" stroke="#587073" stroke-width="2"/>';
    var liquid =
      '<rect x="44" y="60" width="92" height="86" rx="2" fill="url(#' + id + '-water)" opacity="0.7"/>';
    var leftGas =
      '<rect class="ele-left-gas" data-stage-gas x="44" y="60" width="42" height="28" rx="2" fill="#bfe9e4" opacity="0.6"/>' +
      '<text x="65" y="78" fill="#146c6e" font-size="9" text-anchor="middle" data-left-label>H₂</text>';
    var rightGas =
      '<rect class="ele-right-gas" data-stage-gas x="86" y="60" width="50" height="14" rx="2" fill="#fdecd9" opacity="0.6"/>' +
      '<text x="111" y="72" fill="#a4560b" font-size="9" text-anchor="middle" data-right-label>O₂</text>';
    var electrodes =
      '<rect x="50" y="100" width="8" height="40" rx="2" fill="#8a9ba8" stroke="#587073" stroke-width="1"/>' +
      '<rect x="92" y="100" width="8" height="40" rx="2" fill="#8a9ba8" stroke="#587073" stroke-width="1"/>' +
      '<line x1="54" y1="140" x2="54" y2="160" stroke="#8a9ba8" stroke-width="2"/>' +
      '<line x1="96" y1="140" x2="96" y2="160" stroke="#8a9ba8" stroke-width="2"/>' +
      '<line x1="30" y1="160" x2="150" y2="160" stroke="#587073" stroke-width="2"/>';
    var bubbles =
      '<g class="ele-bubbles" data-bubbles opacity="0">' +
        '<circle cx="54" cy="130" r="2.5" fill="#fff" opacity="0.8"/>' +
        '<circle cx="54" cy="110" r="2" fill="#fff" opacity="0.7"/>' +
        '<circle cx="96" cy="128" r="2" fill="#fff" opacity="0.8"/>' +
        '<circle cx="96" cy="108" r="1.8" fill="#fff" opacity="0.7"/>' +
      '</g>';
    var labels =
      '<text x="54" y="175" fill="#146c6e" font-size="8" text-anchor="middle" font-weight="600">负极</text>' +
      '<text x="96" y="175" fill="#a4560b" font-size="8" text-anchor="middle" font-weight="600">正极</text>' +
      '<text x="65" y="200" fill="#587073" font-size="9" text-anchor="middle">体积比 H₂:O₂ ≈ 2:1</text>';
    var html =
      '<div class="fig-ele" data-ele>' +
        pills +
        figSvg(160, 214, defs + uShape + liquid + leftGas + rightGas + electrodes + bubbles + labels) +
        '<p class="ele-hint" data-eleh>点击「通电」观察两极气泡产生。</p>' +
      '</div>';
    return html;
  }

  // ---------- 质量守恒定律：白磷燃烧实验 ----------
  function figMassConservation(fig) {
    var id = "mc-" + uid();
    var pills = '<div class="fig-ctrl">' +
      '<button type="button" class="fig-pill" data-mc-stage="before">反应前</button>' +
      '<button type="button" class="fig-pill" data-mc-stage="during">燃烧中</button>' +
      '<button type="button" class="fig-pill" data-mc-stage="after">反应后</button>' +
      '</div>';
    var defs =
      '<defs>' +
        '<linearGradient id="' + id + '-smoke" x1="0" y1="1" x2="0" y2="0">' +
          '<stop offset="0" stop-color="#d4f1f0"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>' +
        '</linearGradient>' +
      '</defs>';
    var flask =
      '<path d="M60 160 L60 110 L30 50 Q28 40 38 38 L82 38 Q92 40 90 50 L60 110" fill="rgba(255,255,255,.5)" stroke="#587073" stroke-width="3" stroke-linejoin="round"/>' +
      '<path d="M38 38 L82 38" stroke="#587073" stroke-width="3" stroke-linecap="round"/>' +
      '<rect x="34" y="30" width="52" height="10" rx="3" fill="rgba(232,246,243,.8)" stroke="#587073" stroke-width="2"/>';
    var sand =
      '<path d="M48 155 Q65 148 82 155" fill="#d9e8e5" stroke="#b0c4c1" stroke-width="1"/>';
    var whiteP =
      '<ellipse cx="65" cy="152" rx="8" ry="4" fill="#fff8e8" stroke="#c9a96e" stroke-width="1"/>' +
      '<text x="65" y="145" fill="#587073" font-size="7" text-anchor="middle">白磷</text>';
    var balloon =
      '<ellipse class="mc-balloon" data-balloon cx="60" cy="20" rx="12" ry="16" fill="rgba(232,244,241,.7)" stroke="#587073" stroke-width="2"/>';
    var balance =
      '<line x1="10" y1="178" x2="110" y2="178" stroke="#587073" stroke-width="3"/>' +
      '<path d="M55 178 L55 190 L65 190" stroke="#587073" stroke-width="2" fill="none"/>' +
      '<rect x="20" y="172" width="20" height="6" rx="2" fill="#d9e8e5" stroke="#b0c4c1" stroke-width="1"/>' +
      '<rect x="80" y="172" width="20" height="6" rx="2" fill="#d9e8e5" stroke="#b0c4c1" stroke-width="1"/>' +
      '<text x="30" y="198" fill="#587073" font-size="7" text-anchor="middle">反应前</text>' +
      '<text x="90" y="198" fill="#587073" font-size="7" text-anchor="middle">反应后</text>';
    var smoke =
      '<g class="mc-smoke" data-smoke opacity="0">' +
        '<circle cx="55" cy="80" r="6" fill="#d4f1f0" opacity="0.4"/>' +
        '<circle cx="70" cy="70" r="8" fill="#d4f1f0" opacity="0.3"/>' +
        '<circle cx="62" cy="90" r="5" fill="#d4f1f0" opacity="0.35"/>' +
      '</g>';
    var flame =
      '<g class="mc-flame" data-flame opacity="0">' +
        '<ellipse cx="65" cy="140" rx="6" ry="10" fill="#f5a623" opacity="0.6"/>' +
        '<ellipse cx="65" cy="142" rx="3" ry="6" fill="#f7c948" opacity="0.7"/>' +
      '</g>';
    var resultText =
      '<text class="mc-result" data-mcresult x="60" y="60" fill="#146c6e" font-size="9" text-anchor="middle" font-weight="600"></text>';
    var html =
      '<div class="fig-mc" data-mc>' +
        pills +
        figSvg(120, 210, defs + flask + sand + whiteP + balloon + smoke + flame + balance + resultText) +
        '<p class="mc-hint" data-mch>点击「燃烧中」观察白磷燃烧，点击「反应后」查看质量关系。</p>' +
      '</div>';
    return html;
  }

  // ---------- 水的净化：过滤操作示意 ----------
  function figWaterPurification(fig) {
    var id = "wp-" + uid();
    var pills = '<div class="fig-ctrl">' +
      '<button type="button" class="fig-pill" data-purify-stage="mix">浑浊水</button>' +
      '<button type="button" class="fig-pill" data-purify-stage="filter">过滤</button>' +
      '<button type="button" class="fig-pill" data-purify-stage="clear">过滤后</button>' +
      '</div>';
    var defs =
      '<defs>' +
        '<linearGradient id="' + id + '-clear" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#d4f1f0"/><stop offset="1" stop-color="#a7dcd5"/>' +
        '</linearGradient>' +
        '<linearGradient id="' + id + '-dirty" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#c9b896"/><stop offset="1" stop-color="#a08060"/>' +
        '</linearGradient>' +
      '</defs>';
    var beaker1 =
      svgParts.beaker(8, 50, 50, 40) +
      '<rect x="10" y="58" width="46" height="28" rx="2" fill="url(#' + id + '-dirty)" opacity="0.8" data-dirty-water/>' +
      '<circle cx="20" cy="70" r="2" fill="#8b7355" opacity="0.6"/>' +
      '<circle cx="35" cy="65" r="1.5" fill="#8b7355" opacity="0.5"/>' +
      '<circle cx="45" cy="75" r="2" fill="#8b7355" opacity="0.6"/>' +
      '<text x="33" y="96" fill="#587073" font-size="7" text-anchor="middle">浑浊水</text>';
    var funnel =
      '<path d="M70 40 L90 40 L90 70 L80 100 L74 100 L64 70 L64 40 Z" fill="rgba(255,255,255,.5)" stroke="#587073" stroke-width="2"/>' +
      '<rect x="66" y="100" width="8" height="16" rx="2" fill="rgba(255,255,255,.5)" stroke="#587073" stroke-width="2"/>' +
      '<line x1="70" y1="44" x2="86" y2="44" stroke="#587073" stroke-width="1.5"/>';
    var filterPaper =
      '<path d="M67 42 L83 42 L83 72 L73 98 L63 72 Z" fill="rgba(255,255,240,.7)" stroke="#c9a96e" stroke-width="1.5"/>';
    var glassRod =
      '<line x1="55" y1="30" x2="72" y2="50" stroke="#587073" stroke-width="3" stroke-linecap="round"/>';
    var beaker2 =
      svgParts.beaker(88, 110, 50, 36) +
      '<rect x="90" y="118" width="46" height="22" rx="2" fill="url(#' + id + '-clear)" opacity="0" data-clear-water/>' +
      '<text x="113" y="148" fill="#587073" font-size="7" text-anchor="middle">滤液</text>';
    var stand =
      '<rect x="5" y="130" width="8" height="40" fill="#8a9ba8" stroke="#587073" stroke-width="1"/>' +
      '<rect x="2" y="168" width="14" height="6" rx="2" fill="#8a9ba8" stroke="#587073" stroke-width="1"/>' +
      '<line x1="13" y1="55" x2="64" y2="55" stroke="#8a9ba8" stroke-width="2"/>';
    var note =
      '<text class="wp-note" data-wpn x="60" y="195" fill="#146c6e" font-size="8" text-anchor="middle" font-weight="600"></text>';
    var html =
      '<div class="fig-wp" data-wp>' +
        pills +
        figSvg(145, 210, defs + beaker1 + stand + funnel + filterPaper + glassRod + beaker2 + note) +
        '<p class="wp-hint" data-wph>点击「过滤」观察过滤过程，注意「一贴二低三靠」。</p>' +
      '</div>';
    return html;
  }

  // ---------- 二氧化碳制取装置 ----------
  function figCo2Setup(fig) {
    var id = "co2-" + uid();
    var pills = '<div class="fig-ctrl">' +
      '<button type="button" class="fig-pill" data-co2-part="setup">装置</button>' +
      '<button type="button" class="fig-pill" data-co2-part="collection">收集</button>' +
      '<button type="button" class="fig-pill" data-co2-part="check">验满</button>' +
      '</div>';
    var defs =
      '<defs>' +
        '<linearGradient id="' + id + '-co2" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#d4f1f0"/><stop offset="1" stop-color="#a7dcd5"/>' +
        '</linearGradient>' +
      '</defs>';
    var flask =
      '<path d="M40 120 L40 80 L25 55 Q22 48 30 46 L70 46 Q78 48 75 55 L60 80 L60 120 Q60 135 45 135 L45 135 Q30 135 30 120 Z" fill="rgba(255,255,255,.6)" stroke="#587073" stroke-width="2"/>' +
      '<rect x="36" y="40" width="28" height="8" rx="3" fill="rgba(232,246,243,.8)" stroke="#587073" stroke-width="2"/>';
    var marble =
      '<ellipse cx="48" cy="118" rx="6" ry="4" fill="#c9c9c9" stroke="#8a9ba8" stroke-width="1"/>' +
      '<ellipse cx="58" cy="116" rx="5" ry="3" fill="#d9d9d9" stroke="#8a9ba8" stroke-width="1"/>' +
      '<text x="53" y="132" fill="#587073" font-size="7" text-anchor="middle">大理石</text>';
    var thistle =
      '<path d="M50 35 L50 70 L46 70 L46 105" stroke="#587073" stroke-width="4" fill="none" stroke-linecap="round"/>' +
      '<ellipse cx="50" cy="30" rx="8" ry="4" fill="rgba(255,255,255,.6)" stroke="#587073" stroke-width="2"/>' +
      '<text x="72" y="55" fill="#587073" font-size="7">长颈漏斗</text>';
    var liquid =
      '<rect x="47" y="72" width="6" height="30" rx="2" fill="url(#' + id + '-co2)" opacity="0.7"/>';
    var tube =
      '<path d="M60 50 L90 50 L90 85" stroke="#587073" stroke-width="4" fill="none" stroke-linecap="round"/>' +
      '<path d="M88 85 L100 85" stroke="#587073" stroke-width="4" fill="none" stroke-linecap="round"/>';
    var gasJar =
      '<rect x="100" y="45" width="40" height="60" rx="4" fill="rgba(255,255,255,.5)" stroke="#587073" stroke-width="2"/>' +
      '<text x="120" y="115" fill="#587073" font-size="7" text-anchor="middle">集气瓶</text>';
    var bubbles =
      '<g class="co2-bubbles" data-bubbles>' +
        '<circle cx="48" cy="110" r="2" fill="#bfe9e4" opacity="0.7"/>' +
        '<circle cx="56" cy="105" r="1.8" fill="#bfe9e4" opacity="0.6"/>' +
        '<circle cx="50" cy="95" r="2.2" fill="#bfe9e4" opacity="0.5"/>' +
      '</g>';
    var match =
      '<g class="co2-match" data-match opacity="0">' +
        '<line x1="115" y1="40" x2="135" y2="35" stroke="#c9a96e" stroke-width="3" stroke-linecap="round"/>' +
        '<ellipse cx="137" cy="33" rx="4" ry="6" fill="#e67b32" opacity="0.7"/>' +
      '</g>';
    var result =
      '<text class="co2-result" data-co2r x="72" y="160" fill="#146c6e" font-size="8" text-anchor="middle" font-weight="600"></text>';
    var html =
      '<div class="fig-co2" data-co2>' +
        pills +
        figSvg(150, 175, defs + flask + marble + thistle + liquid + tube + gasJar + bubbles + match + result) +
        '<p class="co2-hint" data-co2h>查看装置各部分：固液常温型发生装置 + 向上排空气法收集。</p>' +
      '</div>';
    return html;
  }

  // ---------- 离子形成过程：钠原子 → 钠离子 ----------
  function figIonForm(fig) {
    var pills = '<div class="fig-ctrl">' +
      '<button type="button" class="fig-pill" data-ion-type="na">Na → Na⁺</button>' +
      '<button type="button" class="fig-pill" data-ion-type="cl">Cl → Cl⁻</button>' +
      '</div>';
    var infoBox =
      '<div class="ion-info">' +
        '<table class="ion-table">' +
          '<thead><tr><th></th><th>原子</th><th>离子</th></tr></thead>' +
          '<tbody>' +
            '<tr><td>质子数</td><td data-i-p1></td><td data-i-p2></td></tr>' +
            '<tr><td>电子数</td><td data-i-e1></td><td data-i-e2></td></tr>' +
            '<tr><td>最外层</td><td data-i-o1></td><td data-i-o2></td></tr>' +
            '<tr><td>电性</td><td data-i-c1></td><td data-i-c2></td></tr>' +
          '</tbody>' +
        '</table>' +
        '<p class="ion-tip" data-ition></p>' +
      '</div>';
    return '<div class="fig-ion" data-ionfig>' +
      pills +
      figSvg(200, 170, '<defs></defs><g></g>') +
      infoBox +
    '</div>';
  }

  // ---------- 知识网络图 ----------
  function figKnowledgeNetwork(fig) {
    var modules = [
      { name: "化学变化与空气", color: "#146c6e", days: "Day01-08" },
      { name: "物质构成的奥秘", color: "#2a7ab5", days: "Day09-15" },
      { name: "自然界的水", color: "#2f9aa8", days: "Day16-18" },
      { name: "化学方程式", color: "#6b5ba8", days: "Day19-23" },
      { name: "碳和碳的氧化物", color: "#d9762b", days: "Day24-27" },
      { name: "燃料与能源", color: "#c2534f", days: "Day28-29" }
    ];
    var cards = modules.map(function (m, i) {
      return '<div class="kn-card" data-kn-module="' + i + '">' +
        '<div class="kn-header" style="background:' + m.color + '">' + m.name + '</div>' +
        '<div class="kn-body"><span class="kn-days">' + m.days + '</span></div>' +
      '</div>';
    }).join("");
    var html = '<div class="fig-kn" data-knfig>' +
      cards +
      '<p class="kn-hint">六个模块环环相扣，基础决定上限。反复刷错题，开学不慌。</p>' +
    '</div>';
    return html;
  }

  // ---------- 水资源分布饼图 ----------
  function figWaterResources(fig) {
    var cx = 80, cy = 80, r = 55;
    var C = 2 * Math.PI * r;
    var segs = [
      { label: "海洋咸水", pct: "97.5%", v: 0.975, color: "#2a7ab5" },
      { label: "冰川/地下水", pct: "2.4%", v: 0.024, color: "#8a9ba8" },
      { label: "可直接利用淡水", pct: "0.1%", v: 0.001, color: "#e67b32" }
    ];
    var offset = 0;
    var rings = segs.map(function (s) {
      var len = Math.max(s.v * C, 0.5);
      var dash = len + " " + C;
      var seg = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + s.color +
        '" stroke-width="28" stroke-dasharray="' + dash + '" stroke-dashoffset="' + (-offset) +
        '" transform="rotate(-90 ' + cx + " " + cy + ')" opacity="0.9"/>';
      offset += len;
      return seg;
    }).join("");
    var legend = segs.map(function (s) {
      return '<div class="wr-legend"><span class="swatch" style="background:' + s.color + '"></span><span>' + s.label + ' · ' + s.pct + '</span></div>';
    }).join("");
    var center = '<text x="' + cx + '" y="' + (cy - 4) + '" fill="#173033" font-size="11" text-anchor="middle" font-weight="700">地球</text>' +
      '<text x="' + cx + '" y="' + (cy + 10) + '" fill="#587073" font-size="9" text-anchor="middle">71% 被水覆盖</text>';
    return '<div class="fig-wr">' +
      figSvg(160, 160, rings + center) +
      '<div class="wr-legend-box" role="list" aria-label="水资源分布">' + legend + '</div>' +
      '<p class="wr-hint">可直接利用的淡水资源不足全球总水量的 1%。</p>' +
    '</div>';
  }

  // ---------- CO 与 CO2 性质对比 ----------
  function figCoVsCo2Compare(fig) {
    var pills = '<div class="fig-ctrl">' +
      '<button type="button" class="fig-pill" data-co-type="both">对比视图</button>' +
      '</div>';
    var table =
      '<table class="co2-comp-table">' +
        '<thead><tr><th></th><th>CO（一氧化碳）</th><th>CO₂（二氧化碳）</th></tr></thead>' +
        '<tbody>' +
          '<tr><td>颜色气味</td><td>无色无味</td><td>无色无味</td></tr>' +
          '<tr><td>毒性</td><td data-co-toxic>有毒</td><td data-co2-toxic>无毒</td></tr>' +
          '<tr><td>可燃性</td><td data-co-flame>可燃</td><td data-co2-flame>不可燃</td></tr>' +
          '<tr><td>还原性</td><td data-co-red>有</td><td data-co2-red>无</td></tr>' +
          '<tr><td>石灰水</td><td data-co-lime>不变浑</td><td data-co2-lime>变浑浊</td></tr>' +
          '<tr><td>密度</td><td>略小于空气</td><td>比空气大</td></tr>' +
          '<tr><td>水溶性</td><td>难溶</td><td>能溶</td></tr>' +
        '</tbody>' +
      '</table>';
    return '<div class="fig-co2comp" data-co2comp>' +
      pills +
      table +
      '<p class="co2comp-hint">分子构成不同（CO₂ 多一个氧原子），化学性质截然不同。</p>' +
    '</div>';
  }

  // ---------- 碳同素异形体 ----------
  function figCarbonAllotropes(fig) {
    var pills = '<div class="fig-ctrl">' +
      '<button type="button" class="fig-pill" data-carbon="diamond">金刚石</button>' +
      '<button type="button" class="fig-pill" data-carbon="graphite">石墨</button>' +
      '<button type="button" class="fig-pill" data-carbon="c60">C₆₀</button>' +
      '</div>';
    var structures = {
      diamond: {
        color: "#4aa7a0",
        desc: "正四面体空间网状结构，硬度最大，不导电。",
        svg: '<g class="car-structure"><circle cx="60" cy="50" r="8" fill="#4aa7a0" stroke="#2f7d76" stroke-width="1.5"/><circle cx="40" cy="80" r="6" fill="#7cc7bf" stroke="#2f7d76" stroke-width="1.5"/><circle cx="80" cy="80" r="6" fill="#7cc7bf" stroke="#2f7d76" stroke-width="1.5"/><circle cx="60" cy="100" r="6" fill="#7cc7bf" stroke="#2f7d76" stroke-width="1.5"/><line x1="60" y1="50" x2="40" y2="80" stroke="#587073" stroke-width="1.5"/><line x1="60" y1="50" x2="80" y2="80" stroke="#587073" stroke-width="1.5"/><line x1="60" y1="50" x2="60" y2="100" stroke="#587073" stroke-width="1.5"/><line x1="40" y1="80" x2="60" y2="100" stroke="#587073" stroke-width="1.5"/><line x1="80" y1="80" x2="60" y2="100" stroke="#587073" stroke-width="1.5"/></g>'
      },
      graphite: {
        color: "#8a9ba8",
        desc: "层状结构，层间作用力弱，质软滑腻，导电。",
        svg: '<g class="car-structure"><rect x="30" y="40" width="60" height="8" rx="2" fill="#b0c4c1" stroke="#587073" stroke-width="1.5"/><rect x="30" y="56" width="60" height="8" rx="2" fill="#b0c4c1" stroke="#587073" stroke-width="1.5"/><rect x="30" y="72" width="60" height="8" rx="2" fill="#b0c4c1" stroke="#587073" stroke-width="1.5"/><circle cx="50" cy="44" r="3" fill="#8a9ba8"/><circle cx="70" cy="44" r="3" fill="#8a9ba8"/><circle cx="90" cy="44" r="3" fill="#8a9ba8"/><circle cx="50" cy="60" r="3" fill="#8a9ba8"/><circle cx="70" cy="60" r="3" fill="#8a9ba8"/><circle cx="90" cy="60" r="3" fill="#8a9ba8"/></g>'
      },
      c60: {
        color: "#6b5ba8",
        desc: "足球状分子，60 个碳原子构成，不导电。",
        svg: '<g class="car-structure"><circle cx="60" cy="55" r="28" fill="none" stroke="#6b5ba8" stroke-width="2"/><circle cx="60" cy="55" r="18" fill="none" stroke="#8a9ba8" stroke-width="1.5"/><circle cx="60" cy="27" r="5" fill="#6b5ba8"/><circle cx="88" cy="55" r="5" fill="#6b5ba8"/><circle cx="60" cy="83" r="5" fill="#6b5ba8"/><circle cx="32" cy="55" r="5" fill="#6b5ba8"/><circle cx="75" cy="35" r="4" fill="#8a9ba8"/><circle cx="75" cy="75" r="4" fill="#8a9ba8"/><circle cx="45" cy="75" r="4" fill="#8a9ba8"/><circle cx="45" cy="35" r="4" fill="#8a9ba8"/></g>'
      }
    };
    var infoBox =
      '<div class="carbon-info">' +
        '<p class="carbon-desc" data-carbon-desc></p>' +
      '</div>';
    return '<div class="fig-carbon" data-carbonfig>' +
      pills +
      figSvg(120, 110, '<defs></defs><g data-carbon-svg></g>') +
      infoBox +
    '</div>';
  }

  // ---------- 燃烧三角互动图 ----------
  function figCombustionTriangle(fig) {
    var pills = '<div class="fig-ctrl">' +
      '<button type="button" class="fig-pill" data-comb-stage="all">三条件</button>' +
      '<button type="button" class="fig-pill" data-comb-stage="fuel">缺可燃物</button>' +
      '<button type="button" class="fig-pill" data-comb-stage="o2">缺氧气</button>' +
      '<button type="button" class="fig-pill" data-comb-stage="temp">缺温度</button>' +
      '</div>';
    var defs =
      '<defs>' +
        '<linearGradient id="comb-flame" x1="0" y1="1" x2="0" y2="0">' +
          '<stop offset="0" stop-color="#e67b32"/><stop offset="100%" stop-color="#f7c948"/>' +
        '</linearGradient>' +
      '</defs>';
    var triangle =
      '<polygon points="60,20 100,90 20,90" fill="none" stroke="#587073" stroke-width="2.5" stroke-linejoin="round"/>';
    var fuelLabel = '<text x="35" y="115" fill="#2a7ab5" font-size="9" text-anchor="middle" font-weight="600" data-cb-fuel">可燃物</text>';
    var o2Label = '<text x="85" y="115" fill="#e67b32" font-size="9" text-anchor="middle" font-weight="600" data-cb-o2">氧气</text>';
    var tempLabel = '<text x="60" y="10" fill="#c2534f" font-size="9" text-anchor="middle" font-weight="600" data-cb-temp">温度达着火点</text>';
    var flame = '<ellipse class="comb-flame-ell" data-comb-flame cx="60" cy="70" rx="12" ry="18" fill="url(#comb-flame)" opacity="0.8"/>';
    var checkMark = '<g class="comb-check" data-comb-check opacity="0"><circle cx="60" cy="60" r="20" fill="none" stroke="#2e9e63" stroke-width="3"/><path d="M50 60 L56 66 L72 52" fill="none" stroke="#2e9e63" stroke-width="2.5" stroke-linecap="round"/></g>';
    var xMark = '<g class="comb-x" data-comb-x opacity="0"><circle cx="60" cy="60" r="20" fill="none" stroke="#d0544e" stroke-width="3"/><line x1="50" y1="50" x2="70" y2="70" stroke="#d0544e" stroke-width="2.5" stroke-linecap="round"/><line x1="70" y1="50" x2="50" y2="70" stroke="#d0544e" stroke-width="2.5" stroke-linecap="round"/></g>';
    var resultText = '<text class="comb-result" data-comb-r x="60" y="140" fill="#146c6e" font-size="9" text-anchor="middle" font-weight="600"></text>';
    var html =
      '<div class="fig-comb" data-comb>' +
        pills +
        figSvg(120, 155, defs + triangle + fuelLabel + o2Label + tempLabel + flame + checkMark + xMark + resultText) +
        '<p class="comb-hint">点击按钮模拟破坏燃烧条件，观察是否还能燃烧。</p>' +
      '</div>';
    return html;
  }

  // ---------- 化石燃料与新能源 ----------
  function figFossilFuels(fig) {
    var pills = '<div class="fig-ctrl">' +
      '<button type="button" class="fig-pill" data-fuel-type="fossil">化石燃料</button>' +
      '<button type="button" class="fig-pill" data-fuel-type="new">新能源</button>' +
      '</div>';
    var fossil =
      '<div class="fuel-card fossil-card">' +
        '<div class="fuel-row"><span class="fuel-icon">煤</span><span>主要含碳，燃烧产生 SO₂、粉尘</span></div>' +
        '<div class="fuel-row"><span class="fuel-icon">石油</span><span>含碳氢，炼制汽油/柴油</span></div>' +
        '<div class="fuel-row"><span class="fuel-icon">天然气</span><span>主要 CH₄，相对清洁</span></div>' +
        '<p class="fuel-note">不可再生，储量有限，燃烧产生温室气体和污染物。</p>' +
      '</div>';
    var newEnergy =
      '<div class="fuel-card new-card">' +
        '<div class="fuel-row"><span class="fuel-icon">氢能</span><span>燃烧产物是水，热值最高</span></div>' +
        '<div class="fuel-row"><span class="fuel-icon">太阳能</span><span>取之不尽，无污染</span></div>' +
        '<div class="fuel-row"><span class="fuel-icon">风能</span><span>清洁可再生</span></div>' +
        '<div class="fuel-row"><span class="fuel-icon">核能</span><span>能量密度高，有辐射风险</span></div>' +
        '<p class="fuel-note">清洁可再生，是未来能源发展方向。</p>' +
      '</div>';
    return '<div class="fig-fuel" data-fuel>' +
      pills +
      '<div class="fuel-display" data-fuel-display>' + fossil + '</div>' +
      '<p class="fuel-hint">化石燃料不可再生，新能源是未来方向。</p>' +
    '</div>';
  }

  // ---------- 相对分子质量计算器（Day14） ----------
  function figMolMassCalc(fig) {
    var examples = [
      { name: "H₂O", text: "水", calc: "1×2 + 16 = 18", parts: [{el:"H",n:2,m:1},{el:"O",n:1,m:16}] },
      { name: "CO₂", text: "二氧化碳", calc: "12 + 16×2 = 44", parts: [{el:"C",n:1,m:12},{el:"O",n:2,m:16}] },
      { name: "KMnO₄", text: "高锰酸钾", calc: "39 + 55 + 16×4 = 158", parts: [{el:"K",n:1,m:39},{el:"Mn",n:1,m:55},{el:"O",n:4,m:16}] },
      { name: "CaCO₃", text: "碳酸钙", calc: "40 + 12 + 16×3 = 100", parts: [{el:"Ca",n:1,m:40},{el:"C",n:1,m:12},{el:"O",n:3,m:16}] }
    ];
    var pills = examples.map(function(ex, i) {
      return '<div class="fig-pill" data-mc-ex="' + i + '">' + ex.name + '</div>';
    }).join("");
    var infoBox = examples.map(function(ex, i) {
      var rows = ex.parts.map(function(p) {
        return '<div class="mc-row"><span class="mc-el">' + p.el + '</span>' +
          '<span class="mc-n">×</span><span>' + p.n + '</span>' +
          '<span class="mc-op">=</span><span class="mc-res">' + (p.m * p.n) + '</span></div>';
      }).join("");
      return '<div class="mc-detail" data-mc-detail="' + i + '">' +
        '<p class="mc-title">' + ex.name + '（' + ex.text + '）</p>' +
        rows +
        '<div class="mc-total">相对分子质量 = ' + ex.calc + '</div>' +
      '</div>';
    }).join("");
    return '<div class="fig-mc" data-mcfig>' +
      pills +
      infoBox +
    '</div>';
  }

  // ---------- 化学方程式书写步骤（Day20） ----------
  function figEqnWrite(fig) {
    var steps = [
      { n: "1", title: "写出化学式", desc: "左边写反应物，右边写生成物，中间画箭头", example: "H₂ + O₂ → H₂O", ok: false },
      { n: "2", title: "配平", desc: "在化学式前配化学计量数，使两边原子数相等", example: "2H₂ + O₂ → 2H₂O", ok: true },
      { n: "3", title: "标注条件", desc: "在箭头上方写反应条件（点燃、加热△、催化剂等）", example: "2H₂ + O₂ --点燃--> 2H₂O", ok: true },
      { n: "4", title: "标注状态", desc: "反应物无气体时，生成气体标↑；溶液反应生成沉淀标↓", example: "2H₂ + O₂ 点燃 2H₂O（无状态符号，因反应物有气体）", ok: true }
    ];
    var stepsHtml = steps.map(function(s, i) {
      var icon = s.ok ? "✅" : "⚠️";
      return '<div class="ew-step" data-ew-step="' + i + '">' +
        '<div class="ew-num">' + s.n + '</div>' +
        '<div class="ew-body">' +
          '<div class="ew-title">' + s.title + ' <span class="ew-badge">' + icon + '</span></div>' +
          '<div class="ew-desc">' + s.desc + '</div>' +
          '<div class="ew-example">' + s.example + '</div>' +
        '</div>' +
      '</div>';
    }).join("");
    return '<div class="fig-ew" data-ewfig>' +
      '<div class="ew-titlebar">化学方程式书写四步法</div>' +
      stepsHtml +
      '<p class="ew-hint">先写后配，条件不忘，气体沉淀要标注。</p>' +
    '</div>';
  }

  // ---------- 配平练习（Day21） ----------
  function figBalancing(fig) {
    var problems = [
      { react: "H₂ + O₂", prod: "H₂O", ans: [2, 1, 2], hint: "氧原子左边2个右边1个，最小公倍数2" },
      { react: "P + O₂", prod: "P₂O₅", ans: [4, 5, 2], hint: "氧原子左边2个右边5个，最小公倍数10" },
      { react: "Fe + O₂", prod: "Fe₃O₄", ans: [3, 2, 1], hint: "氧原子左边2个右边4个，最小公倍数4" }
    ];
    var pills = problems.map(function(p, i) {
      return '<div class="fig-pill" data-bl-problem="' + i + '">' + (i + 1) + '</div>';
    }).join("");
    var panels = problems.map(function(p, i) {
      var reactParts = p.react.split("+").map(function(s) { return s.trim(); });
      var prodParts = p.prod.split("+").map(function(s) { return s.trim(); });
      var inputs = "";
      reactParts.forEach(function(r, j) {
        inputs += '<div class="bl-input-row"><input type="number" class="bl-input" data-bl-r="' + j + '" min="1" max="10"><span>' + r + '</span></div>';
      });
      inputs += '<div class="bl-input-row"><input type="number" class="bl-input" data-bl-p="0" min="1" max="10"><span>' + prodParts[0] + '</span></div>';
      return '<div class="bl-panel" data-bl-panel="' + i + '">' +
        '<div class="bl-equation">' +
          inputs +
          '<span class="bl-arrow">→</span>' +
        '</div>' +
        '<div class="bl-check"><button class="bl-btn" data-bl-check="' + i + '">检查配平</button></div>' +
        '<div class="bl-result" data-bl-result="' + i + '"></div>' +
        '<div class="bl-hint" data-bl-hint="' + i + '">' + p.hint + '</div>' +
      '</div>';
    }).join("");
    return '<div class="fig-bl" data-blfig>' +
      pills +
      panels +
      '<p class="bl-hint2">输入化学计量数，点击检查配平结果。</p>' +
    '</div>';
  }

  // ---------- 方程式计算步骤可视化（Day22） ----------
  function figEqnCalc(fig) {
    var steps = [
      { n: "设", title: "设未知量", desc: "设要计算物质的质量为 x" },
      { n: "写", title: "写出方程式", desc: "写出正确的化学方程式（注意配平）" },
      { n: "找", title: "找相关量", desc: "写出相关物质的相对分子质量与已知量、未知量" },
      { n: "列", title: "列比例式", desc: "根据质量比列出比例式" },
      { n: "答", title: "写出答案", desc: "简明写出答案并带上单位" }
    ];
    var example = '<div class="ec-example">' +
      '<p class="ec-q">例：电解 36g 水，最多可得到多少克氢气？</p>' +
      '<div class="ec-solve">' +
        '<span class="ec-step-tag">设</span>可得到氢气的质量为 x<br>' +
        '<span class="ec-step-tag">写</span>2H₂O 通电 2H₂↑ + O₂↑<br>' +
        '<span class="ec-step-tag">找</span>36 &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 4<br>' +
        '<span class="ec-step-tag"></span>36g &nbsp;&nbsp;&nbsp;&nbsp; x<br>' +
        '<span class="ec-step-tag">列</span>36/36g = 4/x，解得 x = 4g<br>' +
        '<span class="ec-step-tag">答</span>可得到氢气 4g。' +
      '</div>' +
    '</div>';
    var stepsHtml = steps.map(function(s, i) {
      return '<div class="ec-step">' +
        '<div class="ec-step-n">' + s.n + '</div>' +
        '<div class="ec-step-body">' +
          '<div class="ec-step-title">' + s.title + '</div>' +
          '<div class="ec-step-desc">' + s.desc + '</div>' +
        '</div>' +
      '</div>';
    }).join("");
    return '<div class="fig-ec" data-ecfig>' +
      '<div class="ec-titlebar">化学方程式计算五步法</div>' +
      stepsHtml +
      example +
      '<p class="ec-hint">关键是：先正确写出并配平化学方程式。</p>' +
    '</div>';
  }

  // ---------- 知识链条互动图（Day15 单元复习） ----------
  function figKnowledgeChain(fig) {
    var chain = [
      { label: "分子", color: "#2f9aa8", detail: "保持物质化学性质的最小粒子，由原子构成" },
      { label: "原子", color: "#2a7ab5", detail: "化学变化中的最小粒子，可结合成分子或得失电子" },
      { label: "离子", color: "#e67b32", detail: "带电的原子或原子团，分阳离子和阴离子" },
      { label: "元素", color: "#6b5ba8", detail: "质子数相同的一类原子的总称，宏观概念" },
      { label: "周期表", color: "#c2534f", detail: "按原子序数排列，反映元素周期律" },
      { label: "化学式", color: "#146c6e", detail: "用元素符号表示物质组成的式子" },
      { label: "计算", color: "#52b6a4", detail: "相对分子质量、质量比、质量分数" }
    ];
    var pills = chain.map(function(c, i) {
      return '<div class="kc-pill" data-kc-i="' + i + '">' + c.label + '</div>';
    }).join("");
    var details = chain.map(function(c, i) {
      return '<div class="kc-detail" data-kc-detail="' + i + '">' +
        '<p class="kc-title">' + c.label + '</p>' +
        '<p class="kc-desc">' + c.detail + '</p>' +
      '</div>';
    }).join("");
    var arrows = chain.slice(0, -1).map(function() {
      return '<span class="kc-arrow">→</span>';
    }).join("");
    return '<div class="fig-kc" data-kcfig>' +
      '<div class="kc-pills">' + pills + arrows + '</div>' +
      details +
      '<p class="kc-hint">点击每个节点，查看它在知识链中的位置和关系。</p>' +
    '</div>';
  }

  // ---------- 碳单质性质对比（Day24） ----------
  function figCarbonCompare(fig) {
    var items = [
      { name: "金刚石", color: "#4aa7a0", hardness: "最硬", conductor: "不导电", use: "裁玻璃、钻头" },
      { name: "石墨", color: "#8a9ba8", hardness: "质软滑腻", conductor: "导电", use: "铅笔芯、电极" },
      { name: "C₆₀", color: "#6b5ba8", hardness: "较软", conductor: "不导电", use: "超导、材料科学" }
    ];
    var headers = '<div class="cc-row cc-hdr"><span class="cc-cell"></span><span class="cc-cell">性质</span><span class="cc-cell">导电性</span><span class="cc-cell">用途</span></div>';
    var rows = items.map(function(it, i) {
      return '<div class="cc-row" data-cc-i="' + i + '">' +
        '<div class="cc-cell cc-name"><span class="cc-dot" style="background:' + it.color + '"></span>' + it.name + '</div>' +
        '<div class="cc-cell">' + it.hardness + '</div>' +
        '<div class="cc-cell">' + it.conductor + '</div>' +
        '<div class="cc-cell">' + it.use + '</div>' +
      '</div>';
    }).join("");
    return '<div class="fig-cc" data-ccfig>' +
      headers + rows +
      '<p class="cc-hint">结构决定性质，性质决定用途。三种碳单质物理性质差异大，是因为碳原子排列方式不同。</p>' +
    '</div>';
  }

  // ---------- 单元复习知识地图（Day07） ----------
  function figReviewMap(fig) {
    var threads = [
      { label: "化学变化", color: "#2f9aa8", desc: "判断依据：是否生成新物质" },
      { label: "实验室操作", color: "#e67b32", desc: "仪器使用、加热、气密性检查" },
      { label: "科学探究", color: "#6b5ba8", desc: "提出问题、控制变量、证据结论" },
      { label: "空气与氧气", color: "#146c6e", desc: "成分、性质、制取方法" }
    ];
    var pills = threads.map(function(t, i) {
      return '<div class="rm-pill" data-rm-i="' + i + '">' + t.label + '</div>';
    }).join("");
    var details = threads.map(function(t, i) {
      return '<div class="rm-detail" data-rm-detail="' + i + '">' +
        '<p class="rm-title" style="color:' + t.color + '">' + t.label + '</p>' +
        '<p class="rm-desc">' + t.desc + '</p>' +
      '</div>';
    }).join("");
    return '<div class="fig-rm" data-rmfig>' +
      '<div class="rm-header">四根主线汇成一个目标</div>' +
      '<div class="rm-pills">' + pills + '</div>' +
      details +
      '<p class="rm-hint">点击每条主线，查看核心要点。能解释现象、会设计实验、敢下结论、说得清原因。</p>' +
    '</div>';
  }

  // ---------- 化合价推化学式（Day13） ----------
  function figValenceCalc(fig) {
    var examples = [
      { el: "Al³⁺  O²⁻", result: "Al₂O₃", steps: "铝+3、氧-2 → 交叉约简 → Al₂O₃" },
      { el: "Na⁺  Cl⁻", result: "NaCl", steps: "钠+1、氯-1 → 交叉 → NaCl" },
      { el: "Ca²⁺  OH⁻", result: "Ca(OH)₂", steps: "钙+2、氢氧根-1 → 交叉 → Ca(OH)₂（原子团加括号）" },
      { el: "Mg²⁺  Cl⁻", result: "MgCl₂", steps: "镁+2、氯-1 → 交叉 → MgCl₂" }
    ];
    var pills = examples.map(function(e, i) {
      return '<div class="fig-pill" data-vl-ex="' + i + '">' + e.el + '</div>';
    }).join("");
    var details = examples.map(function(e, i) {
      return '<div class="vl-detail" data-vl-detail="' + i + '">' +
        '<p class="vl-result">化学式：' + e.result + '</p>' +
        '<p class="vl-steps">推导过程：' + e.steps + '</p>' +
      '</div>';
    }).join("");
    return '<div class="fig-vl" data-vlfig>' +
      pills +
      details +
      '<p class="vl-hint">交叉法：正价左负价右，绝对值交叉约简作下标，原子团个数不为1加括号。</p>' +
    '</div>';
  }

  // ---------- 加载并渲染某一天 ----------
  function renderDay(dayKey) {
    var meta = metaFor(dayKey);
    if (!meta || !meta.ready) {
      renderMissing(dayKey);
      return;
    }

    // 单文件模式：内容已内联，直接渲染。
    var day = getDay(dayKey);
    var quiz = getQuiz(dayKey);
    if (day && quiz) {
      renderLesson(dayKey, day, quiz);
      return;
    }

    app.innerHTML = '<p class="loading">正在准备 Day ' + escapeHtml(dayKey) + " 的化学课……</p>";

    Promise.all([
      loadScript("content/days/day-" + dayKey + ".js"),
      loadScript("quiz/day-" + dayKey + ".js")
    ]).then(function () {
      var d = getDay(dayKey);
      var q = getQuiz(dayKey);
      if (!d || !q) {
        app.innerHTML =
          "<p class='loading'>课程内容未能加载，请检查文件是否完整。</p><p><a href='?'>← 返回首页</a></p>";
        return;
      }
      renderLesson(dayKey, d, q);
    }).catch(function () {
      app.innerHTML =
        "<p class='loading'>课程内容未能加载，请检查文件是否完整。</p><p><a href='?'>← 返回首页</a></p>";
    });
  }

  function renderLesson(dayKey, day, quiz) {
    var saved = dayRecord(dayKey);

    var sections = day.sections.map(function (section) {
      var safetyBadge = section.safety
        ? '<span class="badge badge-safety">⚠️ 需成人陪同</span> '
        : "";
      var body = section.body.map(function (p) {
        if (p && typeof p === "object" && p.text) {
          var kindClass = p.kind === "takeaway" ? " takeaway" : (p.kind === "note" ? " note-block" : "");
          return '<p class="' + kindClass.trim() + '">' + escapeHtml(p.text) + "</p>";
        }
        return "<p>" + escapeHtml(p) + "</p>";
      }).join("");
      var figure = section.figure ? renderFigure(section.figure) : "";
      return (
        '<section class="section">' +
          "<h2>" + safetyBadge + escapeHtml(section.title) + "</h2>" +
          body +
          figure +
        "</section>"
      );
    }).join("");

    var checkpoint = day.checkpoint
      ? '<section class="section checkpoint">' +
          "<h2>" + escapeHtml(day.checkpoint.title) + "</h2>" +
          '<p class="hint">点开每一条，先自己判断，再看解析。</p>' +
          day.checkpoint.items.map(function (item) {
            var mark = item.verdict === "对" ? "✔ 对。" : "✘ 错。";
            return (
              '<details class="checkpoint-item">' +
                "<summary>" + escapeHtml(item.statement) + "</summary>" +
                "<p>" + mark + escapeHtml(item.explanation) + "</p>" +
              "</details>"
            );
          }).join("") +
        "</section>"
      : "";

    var questions = quiz.questions.map(function (q, index) {
      var tags =
        '<span class="q-tags">' +
          (q.difficulty ? '<span class="q-diff" data-diff="' + escapeHtml(q.difficulty) + '">' + escapeHtml(q.difficulty) + "</span>" : "") +
          (q.topic ? '<span class="q-topic">' + escapeHtml(q.topic) + "</span>" : "") +
        "</span>";
      var options = q.options.map(function (option, optionIndex) {
        return (
          '<label class="option"><input type="radio" name="q' + index + '" value="' + optionIndex + '"> ' +
          escapeHtml(option) + "</label>"
        );
      }).join("");
      return (
        '<fieldset class="question" data-answer="' + escapeHtml(q.answer) + '" data-explanation="' + escapeHtml(q.explanation) + '">' +
          "<legend>" + tags + "<strong>" + (index + 1) + ". " + escapeHtml(q.prompt) + "</strong></legend>" +
          options +
        "</fieldset>"
      );
    }).join("");

    var totalQ = quiz.questions.length;

    // 上一课 / 回到首页 / 下一课（仅在 ready 天内流转，跳过未发布天）。页面上下各放一套。
    function dayNavHtml(mod) {
      var dayIndexes = [];
      manifest.forEach(function (d, i) { if (d.ready) dayIndexes.push(i); });
      var cur = dayIndexes.indexOf(parseInt(dayKey, 10) - 1);
      var prevReady = cur > 0 ? manifest[dayIndexes[cur - 1]] : null;
      var nextReady = cur >= 0 && cur < dayIndexes.length - 1 ? manifest[dayIndexes[cur + 1]] : null;
      return '<nav class="day-nav' + (mod ? " " + mod : "") + '" aria-label="课程流转">' +
        (prevReady
          ? '<a class="dn-prev" href="?day=' + prevReady.day + '" title="DAY ' + prevReady.day + " " + escapeHtml(prevReady.title) + '">← 上一课</a>'
          : '<span class="dn-prev is-dim">← 第一课</span>') +
        '<a class="dn-home" href="?">回到首页</a>' +
        (nextReady
          ? '<a class="dn-next" href="?day=' + nextReady.day + '" title="DAY ' + nextReady.day + " " + escapeHtml(nextReady.title) + '">下一课 →</a>'
          : '<span class="dn-next is-dim">已是最后一课</span>') +
        "</nav>";
    }

    app.innerHTML =
      '<div class="page">' +
        '<p class="breadcrumb"><a href="?">← 返回首页</a></p>' +
        dayNavHtml() +
        '<header class="hero">' +
          '<p class="eyebrow">DAY ' + escapeHtml(day.dayNumber) + "</p>" +
          "<h1>" + escapeHtml(day.title) + "</h1>" +
          '<p class="meta">预计 ' + escapeHtml(day.duration) + " · 难度 " + escapeHtml(day.difficulty) + "</p>" +
          "<p><strong>今天的问题：</strong>" + escapeHtml(day.coreQuestion) + "</p>" +
          (saved
            ? '<p class="hint">✔ 已完成 · 最佳 ' + saved.best + " / " + saved.attempts[0].total +
              " · 最近 " + new Date(saved.attempts[saved.attempts.length - 1].completedAt).toLocaleDateString() +
              (saved.attempts.length > 1 ? " · 共尝试 " + saved.attempts.length + " 次" : "") + "</p>"
            : "") +
        "</header>" +
        sections +
        checkpoint +
        '<section class="section reading">' +
          "<h2>本课记录</h2>" +
          '<p id="read-state" class="reading-state" role="status">' + (saved && saved.read ? "✔ 你已标记本课为已读。" : "还没标记为已读。") + "</p>" +
          '<button type="button" class="primary ghost" id="btn-mark-read">' + (saved && saved.read ? "标记为未读完" : "标记为已读完") + "</button>" +
          '<label class="note-label" for="day-note">我的笔记（保存在本机，便于回看）：</label>' +
          '<textarea id="day-note" rows="4" placeholder="写下你的疑问、要点或错题总结…">' + escapeHtml(saved && saved.note ? saved.note : "") + "</textarea>" +
          '<button type="button" class="primary" id="btn-save-note">保存笔记</button>' +
          '<p id="note-state" class="reading-state" role="status"></p>' +
        "</section>" +
        '<section class="quiz" id="quiz-section">' +
          "<h2>今日练习</h2>" +
          '<p class="hint">先独立作答，再查看解析。</p>' +
          '<form id="quiz-form" novalidate>' +
            '<div class="quiz-progress" aria-hidden="true">' +
              '<span class="qp-text" id="qp-text">已答 0 / ' + totalQ + "</span>" +
              '<span class="qp-bar"><span class="qp-fill" id="qp-fill" style="width:0%"></span></span>' +
            "</div>" +
            questions +
            '<p id="quiz-warning" class="hint warning" hidden>还有题目未作答，请全部完成后再提交。</p>' +
            '<button class="primary" type="submit">提交并查看解析</button>' +
          "</form>" +
          '<p id="result" class="result" tabindex="-1" aria-live="polite"></p>' +
        "</section>" +
        dayNavHtml("day-nav--bottom") +
      "</div>";

    bindOptionSelection();

    // 本课记录：标记已读 / 保存笔记（都写入当天记录）。
    var markRead = document.querySelector("#btn-mark-read");
    var readState = document.querySelector("#read-state");
    if (markRead && readState) {
      markRead.addEventListener("click", function () {
        var rec = dayRecord(dayKey) || { attempts: [], best: 0 };
        rec.read = !rec.read;
        rec.readAt = rec.read ? new Date().toISOString() : null;
        saveDayRecord(dayKey, rec);
        readState.textContent = rec.read ? "✔ 你已标记本课为已读。" : "未标记为已读。";
        markRead.textContent = rec.read ? "标记为未读完" : "标记为已读完";
      });
    }
    var saveNote = document.querySelector("#btn-save-note");
    var noteArea = document.querySelector("#day-note");
    var noteState = document.querySelector("#note-state");
    if (saveNote && noteArea && noteState) {
      saveNote.addEventListener("click", function () {
        var rec = dayRecord(dayKey) || { attempts: [], best: 0 };
        rec.note = noteArea.value;
        if (noteArea.value) rec.read = true; // 写笔记默认视为已读
        saveDayRecord(dayKey, rec);
        noteState.textContent = "笔记已保存。";
      });
    }

    // 配图交互：量筒读数视角切换。
    document.querySelectorAll(".fig-cyl").forEach(function (box) {
      var stage = box.querySelector("[data-cyl-stage]");
      if (!stage) return;
      var eyeGroup = box.querySelector("[data-eye]");
      var sight = box.querySelector("[data-sight]");
      var read = box.querySelector("[data-read]");
      var note = box.querySelector("[data-note]");

      var cx = 92, meniscusY = 78;
      var eyeSvg = function (ex, ey) {
        var dx = cx - ex, dy = meniscusY - ey;
        var dist = Math.max(Math.hypot(dx, dy), 1);
        var px = ex + (dx / dist) * 3;
        var py = ey + (dy / dist) * 3;
        return (
          '<circle class="cyl-eye-body" cx="' + ex + '" cy="' + ey + '" r="8" fill="#fff" stroke="#173033" stroke-width="2"/>' +
          '<circle class="cyl-pupil" cx="' + px + '" cy="' + py + '" r="3" fill="#173033"/>' +
          '<text x="' + ex + '" y="' + (ey - 14) + '" fill="#e67b32" font-size="10" text-anchor="middle">视线</text>'
        );
      };
      var sightSvg = function (ex, ey) {
        return (
          '<line x1="' + ex + '" y1="' + ey + '" x2="' + cx + '" y2="' + meniscusY + '" stroke="#e67b32" stroke-width="2" stroke-dasharray="5 4"/>'
        );
      };
      function applyState(key) {
        var s = CYLINDER_STATES[key];
        if (!s) return;
        box.querySelectorAll(".fig-pill").forEach(function (p) {
          var active = p.dataset.state === key;
          p.classList.toggle("is-active", active);
          p.setAttribute("aria-pressed", active ? "true" : "false");
        });
        if (eyeGroup) eyeGroup.innerHTML = eyeSvg(s.eye.x, s.eye.y);
        if (sight) sight.innerHTML = sightSvg(s.eye.x, s.eye.y);
        if (read) {
          read.setAttribute("cx", s.read.x);
          read.setAttribute("cy", s.read.y);
          read.classList.toggle("is-wrong", !s.correct);
        }
        if (note) note.textContent = s.note;
      }
      box.querySelectorAll(".fig-pill").forEach(function (pill) {
        pill.addEventListener("click", function () { applyState(pill.dataset.state); });
      });
      applyState("level");
    });

    // 配图交互：气密性检查状态切换（不漏气 / 漏气）。
    document.querySelectorAll(".fig-air").forEach(function (box) {
      var bubbles = box.querySelector("[data-bubbles]");
      var airnote = box.querySelector("[data-airnote]");
      var water = box.querySelector("[data-water]");
      function applyAir(key) {
        box.querySelectorAll(".fig-pill").forEach(function (p) {
          var active = p.dataset.air === key;
          p.classList.toggle("is-active", active);
          p.setAttribute("aria-pressed", active ? "true" : "false");
        });
        if (bubbles) bubbles.classList.toggle("is-leak", key === "leak");
        if (water) water.classList.toggle("is-leak", key === "leak");
        if (airnote) {
          airnote.textContent = key === "ok"
            ? "手捂试管外壁，导管口冒出气泡，移开手后导管口一段水柱上升 → 装置不漏气。"
            : "若装置漏气，手捂后导管口几乎无气泡冒出，说明气密性差。";
        }
      }
      box.querySelectorAll(".fig-pill").forEach(function (pill) {
        pill.addEventListener("click", function () { applyAir(pill.dataset.air); });
      });
      applyAir("ok");
    });

    // 蜡烛燃烧交互
    document.querySelectorAll("[data-candle]").forEach(function (box) {
      var flame = box.querySelector("[data-flame]");
      var smoke = box.querySelector("[data-smoke]");
      var wax = box.querySelector("[data-wax]");
      var products = box.querySelector("[data-products]");
      var melt = box.querySelector("[data-melt]");
      var hint = box.querySelector("[data-hint]");
      function setLit(on) {
        if (flame) flame.style.opacity = on ? "1" : "0";
        if (smoke) smoke.style.opacity = on ? "0" : "0.8";
        if (wax) wax.style.opacity = on ? "0.9" : "0";
        if (products) products.style.opacity = on ? "1" : "0";
        if (melt) melt.style.opacity = on ? "1" : "0";
        if (hint) hint.textContent = on
          ? "蜡烛燃烧：熔化（物理变化）+ 生成 CO₂/H₂O（化学变化），两者同时发生。"
          : "点击「点燃」观察蜡烛燃烧过程。";
      }
      box.querySelectorAll(".fig-pill").forEach(function (pill) {
        pill.addEventListener("click", function () {
          setLit(pill.dataset.action === "light");
        });
      });
    });

    // 物质变化判断器
    document.querySelectorAll("[data-judge]").forEach(function (box) {
      var items = [
        { type: "物理", note: "状态改变，没有新物质。" },
        { type: "化学", note: "铁变成了铁锈（新物质）。" },
        { type: "物理", note: "形状改变，没有新物质。" },
        { type: "化学", note: "产生了新物质，有异味和变色。" }
      ];
      box.querySelectorAll(".judge-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var idx = parseInt(btn.dataset.idx);
          var item = items[idx];
          var result = box.querySelector("[data-result]");
          btn.classList.add("is-active");
          box.querySelectorAll(".judge-btn").forEach(function (b) {
            if (b !== btn) b.classList.remove("is-active");
          });
          if (result) {
            result.innerHTML =
              '<strong>' + escapeHtml(item.type) + "变化</strong>： " +
              escapeHtml(item.note) +
              '<br><span class="hint">判断依据：是否有新物质生成。</span>';
          }
        });
      });
    });

    // 科学探究步骤排序：Pointer Events 触摸/鼠标拖拽 + ↑↓ 按钮 + 键盘，三种方式并存。
    document.querySelectorAll("[data-inquiry]").forEach(function (box) {
      var correctOrder = ["ask", "hypo", "plan", "experiment", "evidence", "conclude"];
      var slots = Array.prototype.slice.call(box.querySelectorAll(".inq-slot"));
      var resultDiv = box.querySelector("[data-inqresult]");
      var checkBtn = box.querySelector("[data-inq-check]");
      var resetBtn = box.querySelector("[data-inq-reset]");

      function currentOrder() {
        return slots.map(function (s) {
          var it = s.querySelector(".inq-item");
          return it ? it.dataset.id : null;
        });
      }
      function syncArrows() {
        slots.forEach(function (s, i) {
          var ups = s.querySelectorAll("[data-shift='-1']");
          var downs = s.querySelectorAll("[data-shift='1']");
          ups.forEach(function (b) { b.disabled = i === 0; });
          downs.forEach(function (b) { b.disabled = i === slots.length - 1; });
        });
      }
      // 与相邻槽位交换卡片。
      function swap(a, b) {
        if (a < 0 || b < 0 || a >= slots.length || b >= slots.length || a === b) return;
        var itA = slots[a].querySelector(".inq-item");
        var itB = slots[b].querySelector(".inq-item");
        if (itA) slots[b].appendChild(itA);
        if (itB) slots[a].appendChild(itB);
        syncArrows();
      }
      function feedback(html) {
        if (resultDiv) resultDiv.innerHTML = html;
      }

      // ↑↓ 按钮（也覆盖键盘可达性）。
      slots.forEach(function (slot, idx) {
        slot.querySelectorAll(".arrow-btn").forEach(function (btn) {
          btn.addEventListener("click", function () {
            swap(idx, idx + parseInt(btn.dataset.shift, 10));
            feedback("");
          });
        });
      });

      // 键盘：聚焦卡片后用 ↑/↓ 换位。
      box.querySelectorAll(".inq-item").forEach(function (item) {
        item.addEventListener("keydown", function (e) {
          var slot = item.closest(".inq-slot");
          var idx = parseInt(slot.dataset.index, 10);
          if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); swap(idx, idx - 1); }
          if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); swap(idx, idx + 1); }
        });
      });

      // 拖拽：Pointer Events（iPad Safari / 安卓 / 鼠标通用，不依赖 HTML5 DragEvent）。
      slots.forEach(function (slot) {
        var item = slot.querySelector(".inq-item");
        if (!item) return;
        var dragging = false;
        var moved = false;
        var dragSlot = null;
        var startX = 0, startY = 0;

        item.addEventListener("pointerdown", function (e) {
          if (e.button !== 0 && e.pointerType !== "touch") return;
          if (e.target.closest(".arrow-btn")) return;
          dragging = true;
          moved = false;
          dragSlot = slot;
          startX = e.clientX;
          startY = e.clientY;
          item.setPointerCapture(e.pointerId);
          item.classList.add("is-dragging");
          box.classList.add("is-dragging");
          e.preventDefault();
        });
        item.addEventListener("pointermove", function (e) {
          if (!dragging) return;
          if (!moved) {
            var dx = e.clientX - startX, dy = e.clientY - startY;
            if (dx * dx + dy * dy < 64) return; // 轻微位移视为点击，不启动拖拽
            moved = true;
          }
          e.preventDefault();
          clearTargets();
          var el = document.elementFromPoint(e.clientX, e.clientY);
          var target = null;
          while (el && el !== box) {
            if (el.classList && el.classList.contains("inq-slot")) { target = el; break; }
            el = el.parentNode;
          }
          if (target && target !== dragSlot) {
            target.classList.add("is-drop-target");
            swap(slots.indexOf(dragSlot), slots.indexOf(target));
            dragSlot = target;
          }
        });
        function endDrag(e) {
          if (!dragging) return;
          dragging = false;
          if (item) item.classList.remove("is-dragging");
          box.classList.remove("is-dragging");
          clearTargets();
          if (moved && item && item.setPointerCapture) {
            try { item.releasePointerCapture(e.pointerId); } catch (err) { /* 无关紧要 */ }
          }
        }
        item.addEventListener("pointerup", endDrag);
        item.addEventListener("pointercancel", endDrag);

        // 悬停高亮由 pointermove 的 elementFromPoint 判定。
        function clearTargets() {
          slots.forEach(function (s) { s.classList.remove("is-drop-target"); });
        }
      });

      if (checkBtn) {
        checkBtn.addEventListener("click", function () {
          var placed = currentOrder().filter(Boolean);
          if (placed.length !== correctOrder.length) {
            feedback('<span class="hint fb-ko">还有步骤没有排好，请先放齐六个步骤。</span>');
            return;
          }
          var ok = placed.every(function (id, i) { return id === correctOrder[i]; });
          feedback(ok
            ? '<span class="hint fb-ok">✔ 正确！提出问题 → 猜想与假设 → 制定计划 → 进行实验 → 收集证据 → 得出结论。</span>'
            : '<span class="hint fb-ko">✘ 顺序有误，再想想。提示：先有问题和猜想，才能设计实验。</span>');
        });
      }
      if (resetBtn) {
        resetBtn.addEventListener("click", function () {
          var initial = ["experiment", "ask", "evidence", "hypo", "conclude", "plan"];
          var byId = {};
          slots.forEach(function (s) {
            var it = s.querySelector(".inq-item");
            if (it) byId[it.dataset.id] = it;
          });
          slots.forEach(function (s, i) {
            var it = byId[initial[i]];
            if (it) s.appendChild(it);
          });
          syncArrows();
          feedback("");
        });
      }
      syncArrows();
    });

    // 红磷燃烧阶段切换
    document.querySelectorAll("[data-rp]").forEach(function (box) {
      var stageMap = {
        setup: 'setup', burn: 'burn', result: 'result'
      };
      function applyStage(key) {
        var stage = box.querySelector("[data-rp-stage]");
        if (!stage) return;
        // 重建 stage 内容（简单方式：隐藏所有，显示当前）
        var svgEl = box.querySelector(".chem-svg");
        if (!svgEl) return;
        var ns = "http://www.w3.org/2000/svg";
        // 保留 defs
        var defs = svgEl.querySelector("defs");
        // 清除 stage group
        var existing = svgEl.querySelector(".rp-stage");
        if (existing) existing.remove();
        var g = document.createElementNS(ns, "g");
        g.setAttribute("class", "rp-stage");
        g.setAttribute("data-rp-stage", "");
        var content = key === "setup"
          ? '<rect x="30" y="100" width="60" height="70" rx="4" fill="rgba(255,255,255,.5)" stroke="#587073" stroke-width="2"/><path d="M50 100 L50 70 Q50 60 60 60 L80 60 Q90 60 90 70 L90 100" fill="none" stroke="#587073" stroke-width="2"/><rect x="46" y="56" width="8" height="10" rx="2" fill="#e67b32" opacity="0.8"/><text x="60" y="140" fill="#587073" font-size="9" text-anchor="middle">钟罩</text><rect x="15" y="155" width="130" height="20" rx="3" fill="rgba(191,233,228,.4)" stroke="#587073" stroke-width="1.5"/><text x="80" y="169" fill="#587073" font-size="8" text-anchor="middle">水槽（水）</text><text x="60" y="120" fill="#146c6e" font-size="9" text-anchor="middle" data-rp-note>红磷在密闭容器内</text>'
          : (key === "burn"
            ? '<rect x="30" y="100" width="60" height="70" rx="4" fill="rgba(255,255,255,.5)" stroke="#587073" stroke-width="2"/><path d="M50 100 L50 70 Q50 60 60 60 L80 60 Q90 60 90 70 L90 100" fill="none" stroke="#587073" stroke-width="2"/><ellipse cx="60" cy="58" rx="6" ry="8" fill="#e67b32" opacity="0.9" class="rp-flame"/><ellipse cx="60" cy="54" rx="3" ry="5" fill="#f7c948" opacity="0.8"/><circle cx="55" cy="45" r="2" fill="#b0c4c1" opacity="0.5" class="rp-smoke1"/><circle cx="65" cy="42" r="2.5" fill="#b0c4c1" opacity="0.4" class="rp-smoke2"/><text x="60" y="120" fill="#c2534f" font-size="9" text-anchor="middle" data-rp-note>红磷燃烧，产生大量白烟</text><rect x="15" y="155" width="130" height="20" rx="3" fill="rgba(191,233,228,.4)" stroke="#587073" stroke-width="1.5"/><text x="80" y="169" fill="#587073" font-size="8" text-anchor="middle">水槽</text>'
            : '<rect x="30" y="100" width="60" height="70" rx="4" fill="rgba(255,255,255,.5)" stroke="#587073" stroke-width="2"/><path d="M50 100 L50 70 Q50 60 60 60 L80 60 Q90 60 90 70 L90 100" fill="none" stroke="#587073" stroke-width="2"/><rect x="32" y="120" width="56" height="48" fill="url(#' + (box.querySelector(".chem-svg") && box.querySelector(".chem-svg").querySelector("defs") ? box.querySelector(".chem-svg").querySelector("defs").getAttribute("id").replace("rp-", "") + '-water' : '') + ')"/><text x="60" y="150" fill="#146c6e" font-size="10" text-anchor="middle" font-weight="600" data-rp-note>水面上升约 1/5</text><text x="60" y="112" fill="#587073" font-size="8" text-anchor="middle">剩余气体（主要是氮气）</text><rect x="15" y="155" width="130" height="20" rx="3" fill="rgba(191,233,228,.4)" stroke="#587073" stroke-width="1.5"/><text x="80" y="169" fill="#587073" font-size="8" text-anchor="middle">水槽</text>');
        g.innerHTML = content;
        svgEl.appendChild(g);
        box.querySelectorAll(".fig-pill").forEach(function (pill) {
          var active = pill.dataset.stage === key;
          pill.classList.toggle("is-active", active);
          pill.setAttribute("aria-pressed", active ? "true" : "false");
        });
        var hint = box.querySelector("[data-rphint]");
        if (hint) {
          hint.textContent = key === "setup"
            ? "实验前：钟罩内充满空气，红磷未点燃。"
            : (key === "burn"
              ? "燃烧中：红磷与氧气反应生成五氧化二磷白烟，消耗氧气。"
              : "冷却后：水面上升约 1/5，证明氧气约占空气体积的 1/5。");
        }
      }
      box.querySelectorAll(".fig-pill").forEach(function (pill) {
        pill.addEventListener("click", function () { applyStage(pill.dataset.stage); });
      });
      applyStage("setup");
    });

    // 氧气助燃实验
    document.querySelectorAll("[data-oc]").forEach(function (box) {
      var subs = [
        { name: "木炭", effect: "发出白光，放热", product: "CO₂（使石灰水变浑浊）", detail: "C + O₂ → CO₂" },
        { name: "硫", effect: "蓝紫色火焰，放热", product: "SO₂（刺激性气味）", detail: "S + O₂ → SO₂" },
        { name: "铁丝", effect: "火星四射，生成黑色固体", product: "Fe₃O₄", detail: "3Fe + 2O₂ → Fe₃O₄" }
      ];
      box.querySelectorAll(".fig-pill").forEach(function (pill) {
        pill.addEventListener("click", function () {
          var idx = parseInt(pill.dataset.sub);
          var s = subs[idx];
          box.querySelectorAll(".fig-pill").forEach(function (p) {
            p.classList.toggle("is-active", p === pill);
          });
          var effectEl = box.querySelector("[data-oc-effect]");
          var productEl = box.querySelector("[data-oc-product]");
          var nameEl = box.querySelector("[data-ocname]");
          var detailEl = box.querySelector("[data-ocdetail]");
          if (effectEl) effectEl.textContent = s.effect;
          if (productEl) productEl.textContent = s.product;
          if (nameEl) nameEl.textContent = s.name + "在氧气中燃烧";
          if (detailEl) detailEl.textContent = s.detail;
        });
      });
    });

    // 高锰酸钾制氧装置
    document.querySelectorAll("[data-km]").forEach(function (box) {
      var parts = {
        tube: { note: "试管口略向下倾斜，防止冷凝水回流炸裂试管。" },
        cotton: { note: "试管口放一小团棉花，防止高锰酸钾粉末进入导管堵塞导管。" },
        heat: { note: "酒精灯加热，使高锰酸钾达到分解温度。" },
        "收集": { note: "氧气不易溶于水，用排水法收集，气体较纯净。" }
      };
      box.querySelectorAll(".fig-pill").forEach(function (pill) {
        pill.addEventListener("click", function () {
          var key = pill.dataset.part;
          box.querySelectorAll(".fig-pill").forEach(function (p) {
            p.classList.toggle("is-active", p === pill);
          });
          var result = box.querySelector("[data-kmresult]");
          if (result) {
            var p = parts[key];
            result.innerHTML = '<strong>' + escapeHtml(pill.textContent) + '</strong><br><span class="hint">' + escapeHtml(p.note) + '</span>';
          }
          var note = box.querySelector("[data-kmnote]");
          if (note) note.textContent = p ? p.note : "";
        });
      });
    });

    // 控制变量练习：点选后即时反馈。
    document.querySelectorAll("[data-dvsp]").forEach(function (card) {
      var answer = parseInt(card.dataset.answer, 10);
      var fb = card.querySelector("[data-dvfb]");
      card.querySelectorAll("input").forEach(function (input) {
        input.addEventListener("change", function () {
          card.querySelectorAll(".option").forEach(function (l, oi) {
            l.classList.remove("is-correct", "is-wrong");
            if (oi === answer) l.classList.add("is-correct");
          });
          var chosenVal = parseInt(input.value, 10);
          if (chosenVal !== answer) {
            var chosen = input.closest(".option");
            if (chosen) chosen.classList.add("is-wrong");
          }
          if (fb) {
            fb.innerHTML = (chosenVal === answer ? '<span class="hint fb-ok">✔ 回答正确。</span>' : '<span class="hint fb-ko">✘ 再想想。</span>') +
              "<br>" + escapeHtml(card.dataset.fb);
          }
        });
      });
    });

    // 分子运动状态切换
    document.querySelectorAll("[data-molfig]").forEach(function (box) {
      var stateInfo = {
        solid: { name: "固态", text: "分子排列紧密，只能在固定位置振动，有固定形状和体积。" },
        liquid: { name: "液态", text: "分子较近，可相对滑动，有固定体积但无固定形状。" },
        gas: { name: "气态", text: "分子间隔很大，快速无规则运动，无固定形状和体积，易压缩。" }
      };
      box.querySelectorAll(".fig-pill").forEach(function (pill) {
        pill.addEventListener("click", function () {
          var key = pill.dataset.state;
          box.querySelectorAll(".fig-pill").forEach(function (p) {
            p.classList.toggle("is-active", p === pill);
          });
          // 切换粒子动画
          box.querySelectorAll(".mol-particle").forEach(function (circle) {
            var st = circle.dataset.state;
            circle.classList.toggle("is-active", st === key);
          });
          var info = stateInfo[key];
          var nameEl = box.querySelector("[data-molname]");
          var txtEl = box.querySelector("[data-moldtxt]");
          if (nameEl) nameEl.textContent = info.name;
          if (txtEl) txtEl.textContent = info.text;
        });
      });
    });

    // 原子结构模型切换
    document.querySelectorAll("[data-atomfig]").forEach(function (box) {
      var atoms = [
        { key: "h", symbol: "H", name: "氢", protons: 1, neutrons: 0, shells: [1], tip: "氢原子只有 1 个质子、1 个核外电子，无中子，最简单。" },
        { key: "o", symbol: "O", name: "氧", protons: 8, neutrons: 8, shells: [2, 6], tip: "氧原子：质子数 8 = 核外电子数 8，两层电子排布 2、6。" },
        { key: "na", symbol: "Na", name: "钠", protons: 11, neutrons: 12, shells: [2, 8, 1], tip: "钠原子：质子数 11 = 核外电子数 11，三层排布 2、8、1。" }
      ];
      var svg = box.querySelector(".chem-svg");
      var nucleusEl = box.querySelector("[data-nucleus]");
      var shellsEl = box.querySelector("[data-shells]");
      var labelsEl = box.querySelector("[data-alabels]");
      var tipEl = box.querySelector("[data-atip]");
      var apEl = box.querySelector("[data-ap]");
      var anEl = box.querySelector("[data-an]");
      var aeEl = box.querySelector("[data-ae]");
      var amEl = box.querySelector("[data-am]");
      var achargeEl = box.querySelector("[data-acharge]");

      function shellSvg(shells) {
        var cx = 100, cy = 100;
        var radius = 24;
        var s = "";
        shells.forEach(function (count, idx) {
          radius += 18;
          s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + radius + '" fill="none" stroke="#b0c4c1" stroke-width="1.5" stroke-dasharray="4,3"/>';
          // 把电子摆在这层圆周上
          for (var i = 0; i < count; i += 1) {
            var angle = (360 / count) * i * Math.PI / 180;
            var ex = cx + radius * Math.cos(angle);
            var ey = cy + radius * Math.sin(angle);
            s += '<g class="atom-electron">' +
              '<circle cx="' + ex.toFixed(1) + '" cy="' + ey.toFixed(1) + '" r="5" fill="#4aa7a0" stroke="#2f7d76" stroke-width="1"/>' +
              '<text x="' + ex.toFixed(1) + '" y="' + (ey + 3).toFixed(1) + '" fill="#fff" font-size="8" text-anchor="middle">-</text>' +
            '</g>';
          }
          // 层数标注
          s += '<text x="' + cx + '" y="' + (cy + radius + 10) + '" fill="#587073" font-size="9" text-anchor="middle">第' + (idx + 1) + '层</text>';
        });
        return s;
      }

      function applyAtom(key) {
        var a = null;
        for (var i = 0; i < atoms.length; i += 1) if (atoms[i].key === key) a = atoms[i];
        if (!a) return;
        box.querySelectorAll(".fig-pill").forEach(function (p) {
          var active = p.dataset.atom === key;
          p.classList.toggle("is-active", active);
          p.setAttribute("aria-pressed", active ? "true" : "false");
        });
        if (nucleusEl) {
          var p = a.protons, n = a.neutrons;
          var np = "";
          for (var pi = 0; pi < p; pi += 1) {
            np += '<circle class="nuc-p" cx="' + (88 + (pi % 2) * 8) + '" cy="' + (96 + Math.floor(pi / 2) * 8) + '" r="4" fill="#c2534f"/>';
          }
          for (var ni = 0; ni < n; ni += 1) {
            np += '<circle class="nuc-n" cx="' + (104 + (ni % 2) * 8) + '" cy="' + (96 + Math.floor(ni / 2) * 8) + '" r="4" fill="#7a9bb5"/>';
          }
          nucleusEl.innerHTML =
            '<circle cx="100" cy="100" r="24" fill="#e8b7b4" stroke="#c2534f" stroke-width="2"/>' +
            '<text x="100" y="104" fill="#8a3b38" font-size="10" text-anchor="middle" font-weight="700">原子核</text>' +
            np;
        }
        if (shellsEl) shellsEl.innerHTML = shellSvg(a.shells);
        if (labelsEl) {
          var protonsLabel = '<text x="52" y="24" fill="#587073" font-size="9" text-anchor="middle">p⁺ ' + a.protons + "</text>";
          var neutronsLabel = '<text x="148" y="24" fill="#587073" font-size="9" text-anchor="middle">n⁰ ' + a.neutrons + "</text>";
          labelsEl.innerHTML = protonsLabel + neutronsLabel;
        }
        if (tipEl) tipEl.textContent = a.tip;
        var protons = a.protons;
        if (apEl) apEl.textContent = protons;
        if (anEl) anEl.textContent = a.neutrons;
        if (aeEl) aeEl.textContent = a.shells.reduce(function (s2, c2) { return s2 + c2; }, 0);
        if (amEl) amEl.textContent = protons + a.neutrons;
        if (achargeEl) achargeEl.textContent = "不显电性（正负电荷相等）";
      }

      box.querySelectorAll(".fig-pill").forEach(function (pill) {
        pill.addEventListener("click", function () { applyAtom(pill.dataset.atom); });
      });
      applyAtom("h");
    });

    // 元素周期表格子切换
    document.querySelectorAll("[data-elfig]").forEach(function (box) {
      var elements = [
        { symbol: "H", name: "氢", num: 1, mass: "1.008", tip: "原子序数 1 = 质子数 1，位于周期表第一格。" },
        { symbol: "He", name: "氦", num: 2, mass: "4.003", tip: "原子序数 2 = 质子数 2，惰性气体，最外层 2 个电子。" },
        { symbol: "O", name: "氧", num: 8, mass: "16.00", tip: "原子序数 8 = 质子数 8，地壳中含量最多的元素。" },
        { symbol: "Na", name: "钠", num: 11, mass: "22.99", tip: "原子序数 11 = 质子数 11，金属元素，易失电子。" },
        { symbol: "Fe", name: "铁", num: 26, mass: "55.85", tip: "原子序数 26 = 质子数 26，生活中常见金属。" }
      ];
      var numEl = box.querySelector("[data-ecell-num]");
      var symbolEl = box.querySelector("[data-ecell-symbol]");
      var nameEl = box.querySelector("[data-ecell-name]");
      var massEl = box.querySelector("[data-ecell-mass]");
      var tipEl = box.querySelector("[data-etip]");

      function applyElement(idx) {
        var el = elements[idx];
        box.querySelectorAll(".fig-pill").forEach(function (p) {
          var active = p.dataset.element === String(idx);
          p.classList.toggle("is-active", active);
          p.setAttribute("aria-pressed", active ? "true" : "false");
        });
        if (numEl) numEl.textContent = el.num;
        if (symbolEl) symbolEl.textContent = el.symbol;
        if (nameEl) nameEl.textContent = el.name;
        if (massEl) massEl.textContent = el.mass;
        if (tipEl) tipEl.textContent = el.tip;
      }

      box.querySelectorAll(".fig-pill").forEach(function (pill) {
        pill.addEventListener("click", function () { applyElement(parseInt(pill.dataset.element, 10)); });
      });
      applyElement(0);
    });

    // 水资源分布饼图 - 自动渲染，无需交互

    // CO/CO2 性质对比
    document.querySelectorAll("[data-co2comp]").forEach(function (box) {
      box.querySelectorAll(".fig-pill").forEach(function (pill) {
        pill.addEventListener("click", function () {
          box.querySelectorAll(".fig-pill").forEach(function (p) {
            p.classList.toggle("is-active", p === pill);
          });
        });
      });
    });

    // 碳同素异形体
    document.querySelectorAll("[data-carbonfig]").forEach(function (box) {
      var data = {
        diamond: { desc: "正四面体空间网状结构，硬度最大，不导电。用于切割玻璃、钻头。" },
        graphite: { desc: "层状结构，质软滑腻，导电。用于铅笔芯、电极、润滑剂。" },
        c60: { desc: "足球状分子，60 个碳原子构成，不导电。用于材料科学、医药。" }
      };
      box.querySelectorAll(".fig-pill").forEach(function (pill) {
        pill.addEventListener("click", function () {
          var type = pill.dataset.carbon;
          box.querySelectorAll(".fig-pill").forEach(function (p) {
            p.classList.toggle("is-active", p === pill);
          });
          var svgG = box.querySelector("[data-carbon-svg]");
          var descEl = box.querySelector("[data-carbon-desc]");
          if (svgG && data[type]) svgG.innerHTML = data[type].svg;
          if (descEl && data[type]) descEl.textContent = data[type].desc;
        });
      });
      var first = box.querySelector("[data-carbon]");
      if (first) first.click();
    });

    // 燃烧三角
    document.querySelectorAll("[data-comb]").forEach(function (box) {
      var stages = {
        all: { flame: 0.8, check: 0, x: 0, result: "三个条件同时满足 → 燃烧" },
        fuel: { flame: 0, check: 0, x: 1, result: "缺少可燃物 → 不能燃烧" },
        o2: { flame: 0, check: 0, x: 1, result: "缺少氧气 → 不能燃烧" },
        temp: { flame: 0, check: 0, x: 1, result: "温度未达着火点 → 不能燃烧" }
      };
      box.querySelectorAll(".fig-pill").forEach(function (pill) {
        pill.addEventListener("click", function () {
          var stage = pill.dataset.combStage;
          box.querySelectorAll(".fig-pill").forEach(function (p) {
            p.classList.toggle("is-active", p === pill);
          });
          var s = stages[stage];
          var flame = box.querySelector("[data-comb-flame]");
          var check = box.querySelector("[data-comb-check]");
          var xMark = box.querySelector("[data-comb-x]");
          var result = box.querySelector("[data-comb-r]");
          if (flame) flame.setAttribute("opacity", s.flame);
          if (check) check.setAttribute("opacity", s.check);
          if (xMark) xMark.setAttribute("opacity", s.x);
          if (result) result.textContent = s.result;
        });
      });
    });

    // 化石燃料/新能源
    document.querySelectorAll("[data-fuel]").forEach(function (box) {
      var fossilContent = box.querySelector(".fossil-card").outerHTML;
      var newContent = box.querySelector(".new-card").outerHTML;
      var display = box.querySelector("[data-fuel-display]");
      box.querySelectorAll(".fig-pill").forEach(function (pill) {
        pill.addEventListener("click", function () {
          var type = pill.dataset.fuelType;
          box.querySelectorAll(".fig-pill").forEach(function (p) {
            p.classList.toggle("is-active", p === pill);
          });
          if (display) {
            if (type === "fossil") display.innerHTML = fossilContent;
            else display.innerHTML = newContent;
          }
        });
      });
    });

    // 相对分子质量计算器
    document.querySelectorAll("[data-mcfig]").forEach(function (box) {
      var details = box.querySelectorAll("[data-mc-detail]");
      box.querySelectorAll("[data-mc-ex]").forEach(function (pill) {
        pill.addEventListener("click", function () {
          box.querySelectorAll("[data-mc-ex]").forEach(function (p) {
            p.classList.toggle("is-active", p === pill);
          });
          details.forEach(function (d, i) {
            d.style.display = pill.dataset.mcEx === String(i) ? "" : "none";
          });
        });
      });
      if (details.length > 0) details[0].style.display = "";
    });

    // 配平练习
    document.querySelectorAll("[data-blfig]").forEach(function (box) {
      var panels = box.querySelectorAll("[data-bl-panel]");
      var problems = [
        { ans: [2, 1, 2] },
        { ans: [4, 5, 2] },
        { ans: [3, 2, 1] }
      ];
      box.querySelectorAll("[data-bl-problem]").forEach(function (pill) {
        pill.addEventListener("click", function () {
          box.querySelectorAll("[data-bl-problem]").forEach(function (p) {
            p.classList.toggle("is-active", p === pill);
          });
          panels.forEach(function (p, i) {
            p.style.display = pill.dataset.blProblem === String(i) ? "" : "none";
          });
        });
      });
      box.querySelectorAll("[data-bl-check]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var idx = parseInt(btn.dataset.blCheck, 10);
          var panel = box.querySelector("[data-bl-panel=\"" + idx + "\"]");
          var resultEl = panel.querySelector("[data-bl-result]");
          var inputs = panel.querySelectorAll(".bl-input");
          var vals = Array.prototype.map.call(inputs, function (inp) { return parseInt(inp.value, 10) || 0; });
          var correct = problems[idx].ans.every(function (a, i) { return vals[i] === a; });
          if (resultEl) {
            resultEl.innerHTML = correct
              ? '<span class="bl-ok">配平正确！</span>'
              : '<span class="bl-no">不完全正确，再看看？</span>';
          }
        });
      });
      if (panels.length > 0) panels[0].style.display = "";
    });

    // 知识链条互动图（Day15）
    document.querySelectorAll("[data-kcfig]").forEach(function (box) {
      var details = box.querySelectorAll("[data-kc-detail]");
      box.querySelectorAll("[data-kc-i]").forEach(function (pill) {
        pill.addEventListener("click", function () {
          box.querySelectorAll("[data-kc-i]").forEach(function (p) {
            p.classList.toggle("is-active", p === pill);
          });
          details.forEach(function (d, i) {
            d.style.display = pill.dataset.kcI === String(i) ? "" : "none";
          });
        });
      });
      if (details.length > 0) details[0].style.display = "";
    });

    // 碳单质性质对比（Day24）- 点击行高亮
    document.querySelectorAll("[data-ccfig]").forEach(function (box) {
      box.querySelectorAll("[data-cc-i]").forEach(function (row) {
        row.addEventListener("click", function () {
          box.querySelectorAll("[data-cc-i]").forEach(function (r) {
            r.classList.toggle("is-active", r === row);
          });
        });
      });
    });

    // 单元复习知识地图（Day07）
    document.querySelectorAll("[data-rmfig]").forEach(function (box) {
      var details = box.querySelectorAll("[data-rm-detail]");
      box.querySelectorAll("[data-rm-i]").forEach(function (pill) {
        pill.addEventListener("click", function () {
          box.querySelectorAll("[data-rm-i]").forEach(function (p) {
            p.classList.toggle("is-active", p === pill);
          });
          details.forEach(function (d, i) {
            d.style.display = pill.dataset.rmI === String(i) ? "" : "none";
          });
        });
      });
      if (details.length > 0) details[0].style.display = "";
    });

    // 化合价推化学式（Day13）
    document.querySelectorAll("[data-vlfig]").forEach(function (box) {
      var details = box.querySelectorAll("[data-vl-detail]");
      box.querySelectorAll("[data-vl-ex]").forEach(function (pill) {
        pill.addEventListener("click", function () {
          box.querySelectorAll("[data-vl-ex]").forEach(function (p) {
            p.classList.toggle("is-active", p === pill);
          });
          details.forEach(function (d, i) {
            d.style.display = pill.dataset.vlEx === String(i) ? "" : "none";
          });
        });
      });
      if (details.length > 0) details[0].style.display = "";
    });

    document.querySelector("#quiz-form").addEventListener("submit", function (event) {
      event.preventDefault();

      var fields = document.querySelectorAll(".question");
      var unanswered = Array.prototype.some.call(fields, function (field) {
        return !field.querySelector("input:checked");
      });
      var warning = document.querySelector("#quiz-warning");
      if (unanswered) {
        warning.hidden = false;
        return;
      }
      warning.hidden = true;

      var score = 0;
      var answers = [];
      var wrongItems = [];
      var combo = 0, maxCombo = 0;

      fields.forEach(function (field, index) {
        var selected = field.querySelector("input:checked");
        var correct = selected && selected.value === field.dataset.answer;
        if (correct) {
          score += 1;
          combo += 1;
          if (combo > maxCombo) maxCombo = combo;
        } else {
          combo = 0;
          wrongItems.push({ day: dayKey, questionIndex: index });
        }
        answers[index] = selected ? selected.value : null;

        // 标记选项：正确项高亮、选错的项标红。
        field.querySelectorAll(".option").forEach(function (label, oi) {
          if (String(oi) === field.dataset.answer) label.classList.add("is-marked");
          var input = label.querySelector("input");
          if (selected && input && input.checked) {
            label.classList.add(correct ? "is-correct" : "is-wrong");
          }
          if (input) input.disabled = true;
        });

        var existing = field.querySelector(".feedback");
        if (existing) existing.remove();
        var note = document.createElement("p");
        note.className = "hint feedback " + (correct ? "fb-ok" : "fb-ko");
        note.setAttribute("role", "status");
        note.textContent = (correct ? "回答正确。" : "再想一想。") + field.dataset.explanation;
        field.append(note);
      });

      // 连击记录：更新本地最高连对。
      var stats = getStats();
      if (maxCombo > stats.bestCombo) {
        stats.bestCombo = maxCombo;
        saveStats(stats);
      }

      // 尝试历史：同一题多次作答记录为 attempts 数组，不再覆盖。
      var record = dayRecord(dayKey) || { attempts: [] };
      record.attempts.push({
        score: score,
        total: quiz.questions.length,
        answers: answers,
        completedAt: new Date().toISOString()
      });
      record.best = Math.max(record.best || 0, score);
      writeJSON(LS_DAY + dayKey, record);

      // 更新跨天错题复习队列：同一天重做先移除旧记录，再写入本次错题（含题号）。
      var review = getReviewQueue().filter(function (item) { return item.day !== dayKey; });
      wrongItems.forEach(function (item) {
        review.push({
          day: dayKey,
          questionIndex: item.questionIndex,
          prompt: quiz.questions[item.questionIndex].prompt,
          answeredAt: new Date().toISOString(),
          dueAt: new Date().toISOString(),
          wrongStreak: 1
        });
      });
      writeJSON(LS_REVIEW, review);

      var result = document.querySelector("#result");
      result.textContent = "本次得分：" + score + " / " + quiz.questions.length +
        "，连对 " + maxCombo + " 题。" + (wrongItems.length ? "有 " + wrongItems.length + " 道题进入复习队列。" : "全部答对！") +
        "已保存本地学习记录。";
      result.focus();
    });
  }

  // ---------- 跨天错题复习页：重新作答答错的题（支持按知识点筛选 + 简单间隔复习） ----------
  function renderReview() {
    var queue = getReviewQueue();
    var topic = params.get("topic");
    var showAll = params.get("all") === "1";

    // 汇总全部失效知识点（用于筛选芯片），不因筛选而丢失。
    var topics = {};
    queue.forEach(function (item) {
      var q = getQuiz(item.day);
      var qq = q && q.questions[item.questionIndex];
      var t = (qq && qq.topic) || "未标注";
      topics[t] = (topics[t] || 0) + 1;
    });

    // 到期判定：无 dueAt 的旧记录视为已到期。
    function isDue(item) {
      return !item.dueAt || new Date(item.dueAt).getTime() <= Date.now();
    }

    var list = queue.filter(function (item) {
      if (topic) {
        var q = getQuiz(item.day);
        var qq = q && q.questions[item.questionIndex];
        var t = (qq && qq.topic) || "未标注";
        if (t !== topic) return false;
      }
      if (!showAll && !isDue(item)) return false;
      return true;
    });

    if (!list.length) {
      var emptyMsg;
      if (topic) {
        emptyMsg = "「" + escapeHtml(topic) + "」相关的错题目前没有待复习项。" +
          (queue.length ? ' <a href="?view=review">查看全部错题</a>' : "");
      } else if (queue.length) {
        emptyMsg = "当前没有到期的错题，稍后再来复习即可。" +
          ' <a href="?view=review&amp;all=1">（想提前复习，可立即复习全部）</a>';
      } else {
        emptyMsg = "当前没有待复习的错题。做新练习后答错的题会自动进入复习队列。";
      }
      app.innerHTML =
        '<div class="page">' +
          '<section class="section">' +
            "<p class='hint'>" + emptyMsg + "</p>" +
            '<p><a href="?">← 返回首页</a></p>' +
          "</section>" +
        "</div>";
      return;
    }

    var byDay = {};
    list.forEach(function (item) {
      (byDay[item.day] = byDay[item.day] || []).push(item);
    });
    var days = Object.keys(byDay).sort();

    // 单文件模式下内容已内联；分离模式下按需加载涉及的天。
    var needLoad = days.filter(function (d) {
      return !getDay(d) || !getQuiz(d);
    });

    app.innerHTML = '<div class="page"><p class="loading">正在准备错题复习……</p></div>';

    var loadAll = Promise.all(needLoad.map(function (d) {
      return Promise.all([
        loadScript("content/days/day-" + d + ".js"),
        loadScript("quiz/day-" + d + ".js")
      ]);
    }));

    loadAll.then(function () {
      renderReviewForm(days, byDay, topics, topic, showAll);
    }).catch(function () {
      app.innerHTML =
        '<div class="page">' +
          '<p class="loading">错题数据加载失败，请检查内容文件。</p>' +
          '<p><a href="?">← 返回首页</a></p>' +
        "</div>";
    });
  }

  function renderReviewForm(days, byDay, topics, topic, showAll) {
    var sectionsHtml = days.map(function (d) {
      var quiz = getQuiz(d);
      var meta = metaFor(d);
      var items = byDay[d];
      var qHtml = items.map(function (item) {
        var q = quiz && quiz.questions[item.questionIndex];
        if (!q) return "";
        var dueMark = (!showAll) ? "" : "";
        var options = q.options.map(function (opt, i) {
          return (
            '<label class="option"><input type="radio" name="rq' + d + "-" + item.questionIndex + '" value="' + i + '"> ' +
            escapeHtml(opt) + "</label>"
          );
        }).join("");
        return (
          '<fieldset class="question review-q" data-day="' + d + '" data-qidx="' + item.questionIndex + '">' +
            "<legend><strong>" + escapeHtml(q.prompt) + "</strong></legend>" +
            options +
          "</fieldset>"
        );
      }).join("");
      return (
        '<section class="section">' +
          "<h2>DAY " + escapeHtml(d) + (meta ? " · " + escapeHtml(meta.title) : "") + "</h2>" +
          qHtml +
        "</section>"
      );
    }).join("");

    var chips = '<div class="topic-chips" role="group" aria-label="按知识点筛选">' +
      '<a class="chip' + (topic ? "" : " is-active") + '" href="?view=review' + (showAll ? "&amp;all=1" : "") + '">全部</a>' +
      Object.keys(topics).sort().map(function (t) {
        return '<a class="chip' + (t === topic ? " is-active" : "") + '" href="?view=review&amp;topic=' +
          encodeURIComponent(t) + (showAll ? "&amp;all=1" : "") + '">' + escapeHtml(t) + " (" + topics[t] + ")</a>";
      }).join("") +
    "</div>";

    var dueToggle = '<a class="hint due-toggle" href="?view=review' + (showAll ? "" : "&amp;all=1") + '">' +
      (showAll ? "只看待复习的题" : "复习全部错题（含间隔中的）") + "</a>";

    app.innerHTML =
      '<div class="page">' +
        '<p class="breadcrumb"><a href="?">← 返回首页</a></p>' +
        '<header class="hero">' +
          '<p class="eyebrow">错题复习</p>' +
          "<h1>把答错的题再做一遍</h1>" +
          '<p class="hint">答对的题会移出复习队列；答错的会延期再复习，避免过度刷题。</p>' +
        "</header>" +
        chips +
        dueToggle +
        '<form id="review-form" novalidate>' +
          sectionsHtml +
          '<p id="review-warning" class="hint warning" hidden>还有题目未作答，请全部完成后再提交。</p>' +
          '<button class="primary" type="submit">提交复习</button>' +
        "</form>" +
        '<p id="review-result" class="result" tabindex="-1" aria-live="polite"></p>' +
        '<p class="back-home"><a href="?">← 返回首页</a></p>' +
      "</div>";

    bindOptionSelection();

    document.querySelector("#review-form").addEventListener("submit", function (event) {
      event.preventDefault();

      var fields = document.querySelectorAll(".review-q");
      var unanswered = Array.prototype.some.call(fields, function (field) {
        return !field.querySelector("input:checked");
      });
      var warning = document.querySelector("#review-warning");
      if (unanswered) {
        warning.hidden = false;
        return;
      }
      warning.hidden = true;

      var queue = getReviewQueue();
      var correctCount = 0;

      fields.forEach(function (field) {
        var d = field.dataset.day;
        var qidx = parseInt(field.dataset.qidx, 10);
        var selected = field.querySelector("input:checked");
        var quiz = getQuiz(d);
        var q = quiz && quiz.questions[qidx];
        var correct = q && selected && selected.value === q.answer;
        if (correct) correctCount += 1;

        // 无论对错都先移除旧错题；答错的按间隔延期重新入队。
        var old = null;
        queue = queue.filter(function (item) {
          if (item.day === d && item.questionIndex === qidx) { old = item; return false; }
          return true;
        });
        if (!correct && q) {
          var streak = (old && typeof old.wrongStreak === "number" ? old.wrongStreak : 1) + 1;
          var gap = Math.min(streak, 3); // 越反复错，间隔拉到 1/2/3 天后到期
          var due = new Date(Date.now() + gap * 24 * 60 * 60 * 1000);
          queue.push({
            day: d,
            questionIndex: qidx,
            prompt: q.prompt,
            answeredAt: new Date().toISOString(),
            dueAt: due.toISOString(),
            wrongStreak: streak
          });
        }

        // 选项标记：正确项高亮、选错的项标红。
        field.querySelectorAll(".option").forEach(function (label, oi) {
          if (q && String(oi) === q.answer) label.classList.add("is-marked");
          var input = label.querySelector("input");
          if (selected && input && input.checked) {
            label.classList.add(correct ? "is-correct" : "is-wrong");
          }
          if (input) input.disabled = true;
        });

        var existing = field.querySelector(".feedback");
        if (existing) existing.remove();
        var note = document.createElement("p");
        note.className = "hint feedback " + (correct ? "fb-ok" : "fb-ko");
        note.setAttribute("role", "status");
        note.textContent = (correct ? "回答正确。" : "再想一想。答错的题 " + (Math.min(((old && typeof old.wrongStreak === "number" ? old.wrongStreak : 1)) + 1, 3)) + " 天后会再出现。") + (q ? q.explanation : "");
        field.append(note);
      });

      // 复习后错题清零 → 点亮"错题清零"成就。
      if (correctCount > 0 && !queue.length) {
        var rStats = getStats();
        if (!rStats.reviewCleared) {
          rStats.reviewCleared = true;
          saveStats(rStats);
        }
      }

      writeJSON(LS_REVIEW, queue);

      var result = document.querySelector("#review-result");
      result.textContent = "复习完成：" + correctCount + " 题答对已移出队列，剩余 " + queue.length + " 题继续复习。";
      result.focus();
    });
  }

  // ---------- 路由 ----------
  if (requestedView === "review") {
    renderReview();
  } else if (requestedDay) {
    renderDay(requestedDay);
  } else {
    renderHome();
  }
}());
