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

  // 旧版记录（{score,total,...}）迁移为新版（{attempts:[...], best}）。
  function normalizeDayRecord(record) {
    if (!record) return null;
    if (Array.isArray(record.attempts)) {
      return { attempts: record.attempts, best: record.best != null ? record.best : bestOf(record.attempts) };
    }
    if (typeof record.score === "number") {
      var attempt = {
        score: record.score,
        total: record.total,
        answers: record.answers || [],
        completedAt: record.completedAt || new Date().toISOString()
      };
      return { attempts: [attempt], best: attempt.score };
    }
    return null;
  }

  function dayRecord(dayKey) {
    return normalizeDayRecord(readJSON(LS_DAY + dayKey));
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

  // 薄弱知识点：从错题队列聚合题目 topic，按数量排序。
  function getWeakTopics() {
    var queue = getReviewQueue();
    var counts = {};
    queue.forEach(function (item) {
      var quiz = getQuiz(item.day);
      var q = quiz && quiz.questions[item.questionIndex];
      var topic = (q && q.topic) || "未标注";
      counts[topic] = (counts[topic] || 0) + 1;
    });
    return Object.keys(counts).map(function (t) {
      return { topic: t, count: counts[t] };
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
    }
  };

  function figSvg(w, h, inner) {
    return svgParts.svg(w, h, inner);
  }

  // ---------- 首页：进度总览 + 激励区 + 学习日导航 ----------
  function renderHome() {
    var progress = getProgress();
    var completedCount = Object.keys(progress).length;
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
        var latest = record.attempts[record.attempts.length - 1];
        statusText = "最佳 " + record.best + "/" + latest.total +
          (record.attempts.length > 1 ? " · 尝试 " + record.attempts.length + " 次" : "");
        stateClass += " is-done";
        checkMark = '<span class="day-check" aria-hidden="true">✔</span>';
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
            return '<span class="weak-tag" role="listitem">薄弱：' + escapeHtml(w.topic) + " <b>" + w.count + "</b></span>";
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
          '<p class="meta">已完成 ' + completedCount + " / " + total + " 天 · 完成率 " + percent + "%</p>" +
          '<div class="progress-bar" role="progressbar" aria-label="学习进度" aria-valuemin="0" aria-valuemax="' + total + '" aria-valuenow="' + completedCount + '">' +
            '<div class="progress-bar-fill" style="width:' + percent + '%"></div>' +
          "</div>" +
          statsStrip +
        "</header>" +
        reviewBlock +
        badgeWall +
        (moduleBars ? '<section class="section mod-section"><h2>模块进度</h2>' + moduleBars + "</section>" : "") +
        '<section class="section">' +
          "<h2>选择学习日</h2>" +
          '<ul class="day-grid">' + cards + "</ul>" +
        "</section>" +
      "</div>";
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
      "science-inquiry": figScienceInquiry,  // 科学探究步骤拖拽排序
      "red-phosphorus": figRedPhosphorus,    // 红磷燃烧测氧气含量
      "oxygen-combustion": figOxygenCombustion, // 三种物质在氧气中燃烧
      "kmno4-setup": figKmno4Setup,          // 高锰酸钾制氧装置图
      "molecule-motion": figMoleculeMotion   // 分子运动模拟
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
          '<text class="cyl-note" data-note x="' + cx + '" y="' + (bottom + 26) + '" fill="#173033" font-size="13" text-anchor="middle"></text>' +
        "</g>" +
      "</g>";
    var html =
      '<div class="fig-cyl">' +
        '<div class="fig-ctrl" role="group" aria-label="切换读数视角">' + pills + "</div>" +
        figSvg(220, 200, inner) +
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
        // 结果说明
        '<text class="air-result" data-airnote x="166" y="228" fill="#173033" font-size="12.5" text-anchor="middle"></text>' +
      "</g>";
    var html =
      '<div class="fig-air">' +
        pills +
        figSvg(250, 240, inner) +
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
      '<text x="118" y="55" fill="#146c6e" font-size="11" font-weight="600">CO₂ + H₂O</text>' +
      '<text x="118" y="70" fill="#587073" font-size="9">新物质生成 → 化学变化</text>' +
      '<line x1="110" y1="60" x2="90" y2="68" stroke="#587073" stroke-width="1" opacity="0.5"/>' +
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

  // ---------- 科学探究步骤拖拽排序 ----------
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
      return '<div class="inq-slot" data-index="' + i + '"><span class="slot-num">' + (i + 1) + '</span><span class="slot-hint">拖放步骤到此处</span></div>';
    }).join("");
    var draggables = initialOrder.map(function (si) {
      return '<div class="inq-drag" data-id="' + steps[si].id + '" draggable="true">' + steps[si].text + '</div>';
    }).join("");
    var resetBtn = '<button type="button" class="fig-pill" id="inq-reset">重置</button>';
    var checkBtn = '<button type="button" class="fig-pill" id="inq-check">检查顺序</button>';
    var resultDiv = '<div class="inq-result" data-inqresult></div>';
    return '<div class="fig-inquiry" data-inquiry>' +
      '<p class="inq-instruct">将下列步骤拖放到正确位置（科学探究顺序）：</p>' +
      '<div class="inq-slots">' + slots + '</div>' +
      '<div class="inq-draggables" data-inqdrag>' + draggables + '</div>' +
      '<div class="fig-ctrl inq-ctrl">' + checkBtn + resetBtn + '</div>' +
      resultDiv +
    '</div>';
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

    app.innerHTML =
      '<div class="page">' +
        '<p class="breadcrumb"><a href="?">← 返回首页</a></p>' +
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
        '<p class="back-home"><a href="?">← 返回首页</a></p>' +
      "</div>";

    bindOptionSelection();

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

    // 科学探究步骤拖拽排序
    document.querySelectorAll("[data-inquiry]").forEach(function (box) {
      var steps = [
        { id: "ask", text: "提出问题" },
        { id: "hypo", text: "猜想与假设" },
        { id: "plan", text: "制定计划" },
        { id: "experiment", text: "进行实验" },
        { id: "evidence", text: "收集证据" },
        { id: "conclude", text: "得出结论" }
      ];
      var correctOrder = steps.map(function (s) { return s.id; });
      var initialOrder = [3, 0, 4, 1, 5, 2];
      var currentOrder = initialOrder.slice();
      var slots = box.querySelectorAll(".inq-slot");
      var draggables = box.querySelectorAll(".inq-drag");
      var resultDiv = box.querySelector("[data-inqresult]");
      var checkBtn = box.querySelector("#inq-check");
      var resetBtn = box.querySelector("#inq-reset");

      // 将 draggable 元素放入初始位置
      draggables.forEach(function (el, i) {
        slots[i].appendChild(el);
        el.addEventListener("dragstart", function (e) {
          e.dataTransfer.setData("text/plain", el.dataset.id);
          el.classList.add("is-dragging");
        });
        el.addEventListener("dragend", function () {
          el.classList.remove("is-dragging");
        });
      });

      slots.forEach(function (slot) {
        slot.addEventListener("dragover", function (e) {
          e.preventDefault();
          slot.classList.add("is-drop-target");
        });
        slot.addEventListener("dragleave", function () {
          slot.classList.remove("is-drop-target");
        });
        slot.addEventListener("drop", function (e) {
          e.preventDefault();
          slot.classList.remove("is-drop-target");
          var id = e.dataTransfer.getData("text/plain");
          var el = box.querySelector("[data-id='" + id + "']");
          if (!el) return;
          // 如果目标 slot 已有元素，交换
          if (slot.querySelector(".inq-drag")) {
            var existing = slot.querySelector(".inq-drag");
            var placeholder = slot.querySelector(".slot-hint");
            var parent = existing.parentNode;
            if (parent === slot) {
              parent.appendChild(existing);
            }
            slot.appendChild(existing);
          }
          slot.appendChild(el);
          // 更新 currentOrder
          var newOrder = [];
          slots.forEach(function (s) {
            var d = s.querySelector(".inq-drag");
            newOrder.push(d ? d.dataset.id : null);
          });
          currentOrder = newOrder;
        });
      });

      // 将 slot-hint 放入空 slot
      function refreshSlots() {
        slots.forEach(function (slot) {
          if (!slot.querySelector(".inq-drag")) {
            var hint = document.createElement("span");
            hint.className = "slot-hint";
            hint.textContent = "拖放步骤到此处";
            slot.appendChild(hint);
          }
        });
      }

      if (checkBtn) {
        checkBtn.addEventListener("click", function () {
          var placed = currentOrder.filter(Boolean);
          if (placed.length !== steps.length) {
            if (resultDiv) resultDiv.innerHTML = '<span class="hint fb-ko">请把全部步骤拖放到槽位中。</span>';
            return;
          }
          var isCorrect = placed.every(function (id, i) { return id === correctOrder[i]; });
          if (resultDiv) {
            resultDiv.innerHTML = isCorrect
              ? '<span class="hint fb-ok">✔ 正确！科学探究顺序：提出问题 → 猜想与假设 → 制定计划 → 进行实验 → 收集证据 → 得出结论。</span>'
              : '<span class="hint fb-ko">✘ 顺序有误，再想想。提示：先有问题和猜想，才能设计实验。</span>';
          }
        });
      }
      if (resetBtn) {
        resetBtn.addEventListener("click", function () {
          currentOrder = initialOrder.slice();
          slots.forEach(function (slot) { slot.innerHTML = ''; });
          draggables.forEach(function (el, i) {
            slots[i].appendChild(el);
          });
          refreshSlots();
          if (resultDiv) resultDiv.innerHTML = "";
        });
      }
      refreshSlots();
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
          answeredAt: new Date().toISOString()
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

  // ---------- 跨天错题复习页：重新作答答错的题 ----------
  function renderReview() {
    var queue = getReviewQueue();
    if (!queue.length) {
      app.innerHTML =
        '<div class="page">' +
          '<section class="section">' +
            '<p class="hint">当前没有待复习的错题。做新练习后答错的题会自动进入复习队列。</p>' +
            '<p><a href="?">← 返回首页</a></p>' +
          "</section>" +
        "</div>";
      return;
    }

    var byDay = {};
    queue.forEach(function (item) {
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
      renderReviewForm(days, byDay);
    }).catch(function () {
      app.innerHTML =
        '<div class="page">' +
          '<p class="loading">错题数据加载失败，请检查内容文件。</p>' +
          '<p><a href="?">← 返回首页</a></p>' +
        "</div>";
    });
  }

  function renderReviewForm(days, byDay) {
    var sectionsHtml = days.map(function (d) {
      var quiz = getQuiz(d);
      var meta = metaFor(d);
      var items = byDay[d];
      var qHtml = items.map(function (item) {
        var q = quiz && quiz.questions[item.questionIndex];
        if (!q) return "";
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

    app.innerHTML =
      '<div class="page">' +
        '<p class="breadcrumb"><a href="?">← 返回首页</a></p>' +
        '<header class="hero">' +
          '<p class="eyebrow">错题复习</p>' +
          "<h1>把答错的题再做一遍</h1>" +
          '<p class="hint">答对的题会移出复习队列；答错的会继续留在队列里，供下次再测。</p>' +
        "</header>" +
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

        // 无论对错都先移除旧错题；答错的重新入队。
        queue = queue.filter(function (item) {
          return !(item.day === d && item.questionIndex === qidx);
        });
        if (!correct && q) {
          queue.push({
            day: d,
            questionIndex: qidx,
            prompt: q.prompt,
            answeredAt: new Date().toISOString()
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
        note.textContent = (correct ? "回答正确。" : "再想一想。") + (q ? q.explanation : "");
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
