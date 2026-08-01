(function () {
  "use strict";
  const day = window.ChemLabContent && window.ChemLabContent["day-01"];
  const quiz = window.ChemLabQuiz && window.ChemLabQuiz["day-01"];
  const app = document.querySelector("#app");
  if (!day || !quiz) {
    app.innerHTML = "<p class='loading'>课程内容未能加载，请检查文件是否完整。</p>";
    return;
  }

  const sections = day.sections.map((section) => `
    <section class="section">
      <h2>${section.title}</h2>
      ${section.body.map((paragraph) => `<p>${paragraph}</p>`).join("")}
    </section>`).join("");
  const questions = quiz.questions.map((q, index) => `
    <fieldset class="question" data-answer="${q.answer}" data-explanation="${q.explanation}">
      <legend><strong>${index + 1}. ${q.prompt}</strong></legend>
      ${q.options.map((option, optionIndex) => `<label class="option"><input type="radio" name="q${index}" value="${optionIndex}"> ${option}</label>`).join("")}
    </fieldset>`).join("");

  app.innerHTML = `
    <div class="page">
      <header class="hero">
        <p class="eyebrow">DAY ${day.dayNumber}</p>
        <h1>${day.title}</h1>
        <p class="meta">预计 ${day.duration} · 难度 ${day.difficulty}</p>
        <p><strong>今天的问题：</strong>${day.coreQuestion}</p>
      </header>
      ${sections}
      <section class="quiz"><h2>今日练习</h2><p class="hint">先独立作答，再查看解析。</p><form id="quiz-form">${questions}<button class="primary" type="submit">提交并查看解析</button></form><p id="result" class="result" aria-live="polite"></p></section>
    </div>`;

  document.querySelector("#quiz-form").addEventListener("submit", (event) => {
    event.preventDefault();
    let score = 0;
    const answers = [];
    document.querySelectorAll(".question").forEach((field, index) => {
      const selected = field.querySelector("input:checked");
      const correct = selected && selected.value === field.dataset.answer;
      if (correct) score += 1;
      answers[index] = selected ? selected.value : null;
      const note = document.createElement("p");
      note.className = "hint";
      note.textContent = `${correct ? "回答正确。" : "再想一想。"}${field.dataset.explanation}`;
      field.querySelector(".feedback")?.remove();
      note.classList.add("feedback");
      field.append(note);
    });
    localStorage.setItem("chemlab-g9:v3:day-01", JSON.stringify({ answers, score, completedAt: new Date().toISOString() }));
    document.querySelector("#result").textContent = `本次得分：${score} / ${quiz.questions.length}。已保存本地学习记录。`;
  });
}());
