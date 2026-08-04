(function () {
  "use strict";

  const app = document.querySelector("#app");
  const manifest = (window.ChemLabManifest && window.ChemLabManifest.days) || [];
  const params = new URLSearchParams(window.location.search);
  const requestedDay = params.get("day");

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function readJSON(key) {
    try {
      const raw = localStorage.getItem(key);
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

  function getProgress() {
    const progress = {};
    manifest.forEach(function (d) {
      const record = readJSON("chemlab-g9:v3:day-" + d.day);
      if (record) progress[d.day] = record;
    });
    return progress;
  }

  function getReviewQueue() {
    return readJSON("chemlab-g9:v3:review") || [];
  }

  // ---------- 首页：进度总览 + 学习日导航 ----------
  function renderHome() {
    const progress = getProgress();
    const completedCount = Object.keys(progress).length;
    const total = manifest.length;
    const percent = total ? Math.round((completedCount / total) * 100) : 0;
    const reviewQueue = getReviewQueue();

    const cards = manifest.map(function (d) {
      const record = progress[d.day];
      let statusText = "未开始";
      let stateClass = "day-card";
      if (!d.ready) {
        statusText = "开发中";
        stateClass = "day-card is-locked";
      } else if (record) {
        statusText = "已完成 · " + record.score + "/" + record.total;
        stateClass = "day-card is-done";
      }

      const label =
        '<span class="day-num">DAY ' + d.day + "</span>" +
        '<span class="day-title">' + escapeHtml(d.title) + "</span>" +
        '<span class="day-status">' + statusText + "</span>";

      if (d.ready) {
        return '<li class="' + stateClass + '"><a class="day-card-link" href="?day=' + d.day + '">' + label + "</a></li>";
      }
      return '<li class="' + stateClass + '"><span class="day-card-link is-disabled" aria-disabled="true">' + label + "</span></li>";
    }).join("");

    const moduleBars = renderModuleProgress(progress);

    app.innerHTML =
      '<div class="page">' +
        '<header class="hero">' +
          '<p class="eyebrow">CHEMLAB-G9</p>' +
          "<h1>九年级化学 · 30 天自学计划</h1>" +
          '<p class="meta">已完成 ' + completedCount + " / " + total + " 天</p>" +
          '<div class="progress-bar" role="img" aria-label="学习进度 ' + completedCount + " / " + total + ' 天">' +
            '<div class="progress-bar-fill" style="width:' + percent + '%"></div>' +
          "</div>" +
          (reviewQueue.length
            ? '<p class="hint">你有 ' + reviewQueue.length + " 道题值得再复习一次，可以打开对应的 Day 重新作答。</p>"
            : "") +
        "</header>" +
        (moduleBars ? '<section class="section"><h2>模块进度</h2>' + moduleBars + "</section>" : "") +
        '<section class="section">' +
          "<h2>选择学习日</h2>" +
          '<ul class="day-grid">' + cards + "</ul>" +
        "</section>" +
      "</div>";
  }

  // 按模块统计完成情况，渲染成小环形图 + 名称 + 已完成数。
  function renderModuleProgress(progress) {
    if (!window.ChemLabManifest || !window.ChemLabManifest.modules) return "";
    const modules = window.ChemLabManifest.modules;
    return modules.map(function (mod) {
      const daysInMod = manifest.filter(function (d) {
        return d.module === mod.name;
      });
      if (!daysInMod.length) return "";
      const done = daysInMod.filter(function (d) { return progress[d.day]; }).length;
      const frac = done / daysInMod.length;
      const R = 16, C = 2 * Math.PI * R;
      const ring =
        '<svg class="mod-ring" viewBox="0 0 40 40" role="img" aria-label="' +
        escapeHtml(mod.name) + " 完成 " + done + " / " + daysInMod.length + '">' +
          '<circle cx="20" cy="20" r="' + R + '" class="ring-bg"/>' +
          '<circle cx="20" cy="20" r="' + R + '" class="ring-fg" stroke-dasharray="' +
            (frac * C) + " " + C + '" transform="rotate(-90 20 20)"/>' +
        "</svg>";
      return (
        '<div class="mod-row">' + ring +
          '<span class="mod-name">' + escapeHtml(mod.name) + "</span>" +
          '<span class="mod-count">' + done + " / " + daysInMod.length + "</span>" +
        "</div>"
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
      const s = document.createElement("script");
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("加载失败：" + src)); };
      document.body.appendChild(s);
    });
  }

  // ---------- 内容配图：由内建 SVG 渲染器绘制，避免在数据里塞 HTML ----------
  // figure 统一结构：{ type, caption, ... }，type 决定用哪个渲染器。
  // 渲染器返回 HTML 字符串；需要交互/动画的，绘制后绑定事件。
  function renderFigure(fig) {
    const renderers = {
      "cylinder-reading": figCylinderReading,   // 量筒读数视角对比（可切换）
      "airtight-test": figAirtightTest,          // 检查装置气密性（气泡动画）
      "graduated-cylinder": figGraduatedCylinder // 量筒静态示意
    };
    const fn = renderers[fig.type];
    if (!fn) return "";
    const body = fn(fig);
    if (!body) return "";
    const caption = fig.caption
      ? '<figcaption class="fig-cap">' + escapeHtml(fig.caption) + "</figcaption>"
      : "";
    return '<figure class="chem-fig" role="group">' + body + caption + "</figure>";
  }

  function figSvg(w, h, inner) {
    return '<svg class="chem-svg" viewBox="0 0 ' + w + " " + h + '" aria-hidden="true" focusable="false">' + inner + "</svg>";
  }

  // 量筒静态示意：一个量筒 + 液面
  function figGraduatedCylinder(fig) {
    const r = 34, cx = 80, cy = 100;
    const grad = [
      '<linearGradient id="liq" x1="0" y1="0" x2="0" y2="1">',
      '<stop offset="0" stop-color="#bfe9e4"/><stop offset="1" stop-color="#7cc7bf"/>',
      "</linearGradient>"
    ].join("");
    const liqTop = 60;
    const body = [
      grad,
      '<rect x="' + (cx - r) + '" y="26" width="' + (2 * r) + '" height="140" rx="16" fill="none" stroke="#587073" stroke-width="3"/>',
      '<path d="M' + (cx - r + 2) + " " + liqTop + " L" + (cx + r - 2) + " " + liqTop +
        ' L' + (cx + r - 2) + " " + (26 + 136) + " L" + (cx - r + 2) + " " + (26 + 136) + ' Z" fill="url(#liq)"/>',
      '<ellipse cx="' + cx + '" cy="' + liqTop + '" rx="' + (r - 2) + '" ry="6" fill="#a7dcd5"/>',
      '<rect x="' + (cx - 14) + '" y="0" width="28" height="30" rx="6" fill="none" stroke="#587073" stroke-width="3"/>',
      '<text x="' + cx + '" y="19" fill="#173033" font-size="13" text-anchor="middle">mL</text>'
    ].join("");
    return figSvg(160, 176, body);
  }

  // 量筒读数：平视 / 俯视 / 仰视三种视角，可点击切换。
  // 用真实的视线几何：眼睛看向凹液面最低点，视线延长线在量筒刻度上投影出"读数"。
  function figCylinderReading(fig) {
    const cx = 92;          // 量筒中心 x
    const top = 34;         // 量筒内顶
    const bottom = 160;     // 量筒内底
    const meniscusY = 78;   // 凹液面最低点实际位置
    // 每种视角：眼睛坐标 + 看到的最低点(实际读数点) + 刻度上的错误投影点
    const states = {
      level: {
        label: "平视（正确）",
        eye: { x: 30, y: meniscusY },
        readAt: { x: cx, y: meniscusY },
        note: "视线与凹液面最低处保持水平，读数为 78 mL，正确。",
        correct: true
      },
      above: {
        label: "俯视",
        eye: { x: 26, y: meniscusY - 46 },
        readAt: { x: cx - 8, y: meniscusY + 14 }, // 视线从高处斜向下，液面像看起来更高
        note: "俯视时视线从上方斜向下，看到的最低点偏低处刻度，读数偏大。",
        correct: false
      },
      below: {
        label: "仰视",
        eye: { x: 26, y: meniscusY + 52 },
        readAt: { x: cx + 8, y: meniscusY - 16 }, // 视线从下方斜向上，液面像看起来更低
        note: "仰视时视线从下方斜向上，看到的最低点偏高处刻度，读数偏小。",
        correct: false
      }
    };
    const pills = Object.keys(states).map(function (k) {
      return '<button type="button" class="fig-pill" data-state="' + k + '">' + states[k].label + "</button>";
    }).join("");
    const svgId = "cyl-" + Math.random().toString(36).slice(2, 8);
    const gradId = svgId + "-liq";
    const defs =
      '<defs>' +
        '<linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#bfe9e4"/><stop offset="1" stop-color="#5bb7ae"/>' +
        "</linearGradient>" +
        '<clipPath id="' + svgId + '-clip"><rect x="' + (cx - 34) + '" y="' + top + '" width="68" height="' + (bottom - top) + '" rx="14"/></clipPath>' +
      "</defs>";
    const inner =
      defs +
      '<g data-cyl-stage>' +
        // 量筒外壁（透明玻璃感）
        '<rect x="' + (cx - 36) + '" y="26" width="72" height="144" rx="16" fill="rgba(255,255,255,.6)" stroke="#587073" stroke-width="3"/>' +
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
          let s = "";
          for (let v = 20; v <= 90; v += 10) {
            const y = bottom - ((v - 20) / 70) * (bottom - top);
            s += '<line class="cyl-scale" x1="' + (cx + 34) + '" y1="' + y + '" x2="' + (cx + 43) + '" y2="' + y + '" stroke="#587073" stroke-width="2"/>';
            s += '<text x="' + (cx + 47) + '" y="' + (y + 4) + '" fill="#587073" font-size="9" text-anchor="start">' + v + "</text>";
          }
          return s;
        }()) +
        // 量筒口
        '<rect x="' + (cx - 14) + '" y="0" width="28" height="30" rx="6" fill="none" stroke="#587073" stroke-width="3"/>' +
        '<text x="' + cx + '" y="19" fill="#173033" font-size="11" text-anchor="middle">mL</text>' +
        // 眼睛 + 视线
        '<g class="cyl-eye-group" data-eye-group>' +
          '<g class="cyl-eye" data-eye></g>' +
          '<g class="cyl-sight" data-sight></g>' +
          '<circle class="cyl-read" data-read r="5" fill="#e67b32" stroke="#fff" stroke-width="1.5"/>' +
          '<text class="cyl-note" data-note x="' + cx + '" y="' + (bottom + 26) + '" fill="#173033" font-size="13" text-anchor="middle"></text>' +
        "</g>" +
      "</g>";
    // 组装眼睛（需要用每个状态的坐标动态生成，先放空，由 bind 填充）
    const html =
      '<div class="fig-cyl">' +
        '<div class="fig-ctrl" role="group" aria-label="切换读数视角">' + pills + "</div>" +
        figSvg(220, 200, inner) +
      "</div>";
    return html;
  }

  // 检查装置气密性：手握试管，导管伸入水中，气泡沿导管冒出（可切换不漏气 / 漏气）。
  function figAirtightTest(fig) {
    const svgId = "air-" + Math.random().toString(36).slice(2, 8);
    const grad = svgId + "-water";
    const lip = svgId + "-lip";
    const pills =
      '<div class="fig-ctrl" role="group" aria-label="切换气密性状态">' +
        '<button type="button" class="fig-pill" data-air="ok">装置不漏气</button>' +
        '<button type="button" class="fig-pill" data-air="leak">装置漏气</button>' +
      "</div>";
    const inner =
      '<defs>' +
        '<linearGradient id="' + grad + '" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#bfe9e4"/><stop offset="1" stop-color="#4aa7a0"/>' +
        "</linearGradient>" +
        '<linearGradient id="' + lip + '" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#e8f6f3"/><stop offset="1" stop-color="#bcd9d4"/>' +
        "</linearGradient>" +
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
        '<path d="M126 178 L206 178 L201 210 L131 210 Z" fill="rgba(230,244,241,.5)" stroke="#587073" stroke-width="3"/>' +
        '<path d="M126 178 L206 178" stroke="#8fb6b0" stroke-width="4"/>' +
        // 水
        '<g clip-path="url(#' + svgId + '-waterclip)">' +
          '<rect class="air-water" data-water x="129" y="182" width="74" height="28" fill="url(#' + grad + ')" opacity="0.85"/>' +
          '<g class="air-bubbles" data-bubbles>' +
            '<circle class="bub" cx="152" cy="196" r="3" fill="#fff" opacity=".9"/>' +
            '<circle class="bub b2" cx="152" cy="188" r="2.2" fill="#fff" opacity=".9"/>' +
            '<circle class="bub b3" cx="152" cy="181" r="1.6" fill="#fff" opacity=".9"/>' +
          "</g>" +
        "</g>" +
        '<clipPath id="' + svgId + '-waterclip"><rect x="126" y="176" width="84" height="40"/></clipPath>' +
        // 结果说明
        '<text class="air-result" data-airnote x="166" y="228" fill="#173033" font-size="12.5" text-anchor="middle"></text>' +
      "</g>";
    const html =
      '<div class="fig-air">' +
        pills +
        figSvg(250, 240, inner) +
      "</div>";
    return html;
  }

  // ---------- 加载并渲染某一天 ----------
  function renderDay(dayKey) {
    const meta = manifest.filter(function (d) { return d.day === dayKey; })[0];
    if (!meta || !meta.ready) {
      renderMissing(dayKey);
      return;
    }

    app.innerHTML = '<p class="loading">正在准备 Day ' + escapeHtml(dayKey) + " 的化学课……</p>";

    Promise.all([
      loadScript("content/days/day-" + dayKey + ".js"),
      loadScript("quiz/day-" + dayKey + ".js")
    ]).then(function () {
      const day = window.ChemLabContent && window.ChemLabContent["day-" + dayKey];
      const quiz = window.ChemLabQuiz && window.ChemLabQuiz["day-" + dayKey];
      if (!day || !quiz) {
        app.innerHTML =
          "<p class='loading'>课程内容未能加载，请检查文件是否完整。</p><p><a href='?'>← 返回首页</a></p>";
        return;
      }
      renderLesson(dayKey, day, quiz);
    }).catch(function () {
      app.innerHTML =
        "<p class='loading'>课程内容未能加载，请检查文件是否完整。</p><p><a href='?'>← 返回首页</a></p>";
    });
  }

  function renderLesson(dayKey, day, quiz) {
    const saved = readJSON("chemlab-g9:v3:day-" + dayKey);

    const sections = day.sections.map(function (section) {
      const safetyBadge = section.safety
        ? '<span class="badge badge-safety">⚠️ 需成人陪同</span> '
        : "";
      const body = section.body.map(function (p) { return "<p>" + escapeHtml(p) + "</p>"; }).join("");
      const figure = section.figure ? renderFigure(section.figure) : "";
      return (
        '<section class="section">' +
          "<h2>" + safetyBadge + escapeHtml(section.title) + "</h2>" +
          body +
          figure +
        "</section>"
      );
    }).join("");

    const checkpoint = day.checkpoint
      ? '<section class="section checkpoint">' +
          "<h2>" + escapeHtml(day.checkpoint.title) + "</h2>" +
          '<p class="hint">点开每一条，先自己判断，再看解析。</p>' +
          day.checkpoint.items.map(function (item) {
            const mark = item.verdict === "对" ? "✔ 对。" : "✘ 错。";
            return (
              '<details class="checkpoint-item">' +
                "<summary>" + escapeHtml(item.statement) + "</summary>" +
                "<p>" + mark + escapeHtml(item.explanation) + "</p>" +
              "</details>"
            );
          }).join("") +
        "</section>"
      : "";

    const questions = quiz.questions.map(function (q, index) {
      const options = q.options.map(function (option, optionIndex) {
        return (
          '<label class="option"><input type="radio" name="q' + index + '" value="' + optionIndex + '"> ' +
          escapeHtml(option) + "</label>"
        );
      }).join("");
      return (
        '<fieldset class="question" data-answer="' + escapeHtml(q.answer) + '" data-explanation="' + escapeHtml(q.explanation) + '">' +
          "<legend><strong>" + (index + 1) + ". " + escapeHtml(q.prompt) + "</strong></legend>" +
          options +
        "</fieldset>"
      );
    }).join("");

    app.innerHTML =
      '<div class="page">' +
        '<p class="breadcrumb"><a href="?">← 返回首页</a></p>' +
        '<header class="hero">' +
          '<p class="eyebrow">DAY ' + escapeHtml(day.dayNumber) + "</p>" +
          "<h1>" + escapeHtml(day.title) + "</h1>" +
          '<p class="meta">预计 ' + escapeHtml(day.duration) + " · 难度 " + escapeHtml(day.difficulty) + "</p>" +
          "<p><strong>今天的问题：</strong>" + escapeHtml(day.coreQuestion) + "</p>" +
          (saved
            ? '<p class="hint">✔ 已完成 · 上次得分 ' + saved.score + " / " + saved.total +
              " · " + new Date(saved.completedAt).toLocaleDateString() + "</p>"
            : "") +
        "</header>" +
        sections +
        checkpoint +
        '<section class="quiz" id="quiz-section">' +
          "<h2>今日练习</h2>" +
          '<p class="hint">先独立作答，再查看解析。</p>' +
          '<form id="quiz-form" novalidate>' +
            questions +
            '<p id="quiz-warning" class="hint warning" hidden>还有题目未作答，请全部完成后再提交。</p>' +
            '<button class="primary" type="submit">提交并查看解析</button>' +
          "</form>" +
          '<p id="result" class="result" tabindex="-1" aria-live="polite"></p>' +
        "</section>" +
      "</div>";

    // :has() 选择器在部分旧版 iPad Safari 上不受支持，这里用 JS 兜底同步选中态。
    document.querySelectorAll(".option input").forEach(function (input) {
      input.addEventListener("change", function () {
        const fieldset = input.closest(".question");
        fieldset.querySelectorAll(".option").forEach(function (label) {
          label.classList.remove("selected");
        });
        input.closest(".option").classList.add("selected");
      });
    });

    // 配图交互：量筒读数视角切换（平视/俯视/仰视）。
    document.querySelectorAll(".fig-cyl").forEach(function (box) {
      const stage = box.querySelector("[data-cyl-stage]");
      if (!stage) return;
      const eyeGroup = box.querySelector("[data-eye]");
      const sight = box.querySelector("[data-sight]");
      const read = box.querySelector("[data-read]");
      const note = box.querySelector("[data-note]");

      const cx = 92, meniscusY = 78, bottom = 160;
      const states = {
        level: {
          eye: { x: 30, y: meniscusY },
          read: { x: cx, y: meniscusY },
          note: "视线与凹液面最低处保持水平，读数为 78 mL，正确。",
          correct: true
        },
        above: {
          eye: { x: 26, y: meniscusY - 46 },
          read: { x: cx - 6, y: meniscusY + 16 },
          note: "俯视：视线从上方斜向下，液面像是看到更低的刻度，读数偏大。",
          correct: false
        },
        below: {
          eye: { x: 26, y: meniscusY + 52 },
          read: { x: cx + 6, y: meniscusY - 18 },
          note: "仰视：视线从下方斜向上，液面像是看到更高的刻度，读数偏小。",
          correct: false
        }
      };
      const eyeSvg = function (ex, ey) {
        // 眼睛图形：白色眼球 + 瞳孔，瞳孔朝向液面
        const dx = cx - ex, dy = meniscusY - ey;
        const dist = Math.max(Math.hypot(dx, dy), 1);
        const px = ex + (dx / dist) * 3;
        const py = ey + (dy / dist) * 3;
        return (
          '<circle class="cyl-eye-body" cx="' + ex + '" cy="' + ey + '" r="8" fill="#fff" stroke="#173033" stroke-width="2"/>' +
          '<circle class="cyl-pupil" cx="' + px + '" cy="' + py + '" r="3" fill="#173033"/>' +
          '<text x="' + ex + '" y="' + (ey - 14) + '" fill="#e67b32" font-size="10" text-anchor="middle">视线</text>'
        );
      };
      const sightSvg = function (ex, ey) {
        // 虚线视线：眼睛 → 凹液面最低点
        return (
          '<line x1="' + ex + '" y1="' + ey + '" x2="' + cx + '" y2="' + meniscusY + '" stroke="#e67b32" stroke-width="2" stroke-dasharray="5 4"/>'
        );
      };
      function applyState(key) {
        const s = states[key];
        if (!s) return;
        box.querySelectorAll(".fig-pill").forEach(function (p) {
          p.classList.toggle("is-active", p.dataset.state === key);
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
      // 默认显示平视
      applyState("level");
    });

    // 配图交互：气密性检查状态切换（不漏气 / 漏气）。
    document.querySelectorAll(".fig-air").forEach(function (box) {
      const bubbles = box.querySelector("[data-bubbles]");
      const airnote = box.querySelector("[data-airnote]");
      const water = box.querySelector("[data-water]");
      function applyAir(key) {
        box.querySelectorAll(".fig-pill").forEach(function (p) {
          p.classList.toggle("is-active", p.dataset.air === key);
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

    document.querySelector("#quiz-form").addEventListener("submit", function (event) {
      event.preventDefault();

      const fields = document.querySelectorAll(".question");
      const unanswered = Array.prototype.some.call(fields, function (field) {
        return !field.querySelector("input:checked");
      });
      const warning = document.querySelector("#quiz-warning");
      if (unanswered) {
        warning.hidden = false;
        return;
      }
      warning.hidden = true;

      let score = 0;
      const answers = [];
      const wrongItems = [];

      fields.forEach(function (field, index) {
        const selected = field.querySelector("input:checked");
        const correct = selected && selected.value === field.dataset.answer;
        if (correct) {
          score += 1;
        } else {
          wrongItems.push({ day: dayKey, prompt: quiz.questions[index].prompt });
        }
        answers[index] = selected ? selected.value : null;

        const existing = field.querySelector(".feedback");
        if (existing) existing.remove();
        const note = document.createElement("p");
        note.className = "hint feedback";
        note.textContent = (correct ? "回答正确。" : "再想一想。") + field.dataset.explanation;
        field.append(note);
      });

      const record = {
        answers: answers,
        score: score,
        total: quiz.questions.length,
        completedAt: new Date().toISOString()
      };
      writeJSON("chemlab-g9:v3:day-" + dayKey, record);

      // 更新跨天错题复习队列：同一天重做会先清空旧记录，避免重复堆积。
      let review = getReviewQueue().filter(function (item) { return item.day !== dayKey; });
      review = review.concat(wrongItems);
      writeJSON("chemlab-g9:v3:review", review);

      const result = document.querySelector("#result");
      result.textContent = "本次得分：" + score + " / " + quiz.questions.length + "。已保存本地学习记录。";
      result.focus();
    });
  }

  if (requestedDay) {
    renderDay(requestedDay);
  } else {
    renderHome();
  }
}());
