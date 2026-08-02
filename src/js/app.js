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
        '<section class="section">' +
          "<h2>选择学习日</h2>" +
          '<ul class="day-grid">' + cards + "</ul>" +
        "</section>" +
      "</div>";
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
      return (
        '<section class="section">' +
          "<h2>" + safetyBadge + escapeHtml(section.title) + "</h2>" +
          body +
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
