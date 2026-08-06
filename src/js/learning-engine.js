/*
 * ChemLab-G9 LAB1.0 Learning Engine
 * Offline-first learning state model.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "chemlab-g9:v4:learning-state";

  function readState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || createState();
    } catch (e) {
      return createState();
    }
  }

  function createState() {
    return {
      knowledge: {},
      lessons: {},
      mistakes: {},
      updatedAt: null
    };
  }

  function saveState(state) {
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function updateKnowledge(id, level) {
    var state = readState();
    state.knowledge[id] = {
      level: Math.max(0, Math.min(5, level)),
      updatedAt: new Date().toISOString()
    };
    saveState(state);
    return state.knowledge[id];
  }

  function finishLesson(day, score) {
    var state = readState();
    state.lessons[day] = {
      completed: true,
      score: score,
      completedAt: new Date().toISOString()
    };
    saveState(state);
    return state.lessons[day];
  }

  function addMistake(topic, questionId) {
    var state = readState();
    if (!state.mistakes[topic]) state.mistakes[topic] = [];
    if (state.mistakes[topic].indexOf(questionId) < 0) {
      state.mistakes[topic].push(questionId);
    }
    saveState(state);
  }

  window.ChemLabLearningEngine = {
    readState: readState,
    updateKnowledge: updateKnowledge,
    finishLesson: finishLesson,
    addMistake: addMistake
  };
})();
