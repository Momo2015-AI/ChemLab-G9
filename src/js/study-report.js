(function (global) {
  "use strict";

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  var StudyReport = {
    generate: function () {
      var progress = global.LearningEngine && global.LearningEngine.getState
        ? global.LearningEngine.getState()
        : {};

      var weak = global.KnowledgeEngine && global.KnowledgeEngine.getWeakPoints
        ? global.KnowledgeEngine.getWeakPoints()
        : [];

      return {
        generatedAt: new Date().toISOString(),
        completedDays: progress.completedDays || 0,
        mastery: progress.mastery || {},
        weakPoints: safeArray(weak),
        suggestions: this.recommend(weak)
      };
    },

    recommend: function (weakPoints) {
      if (!weakPoints || !weakPoints.length) {
        return ["继续完成每日学习任务，建立知识体系"];
      }

      return weakPoints.slice(0, 3).map(function (item) {
        return "复习知识点：" + (item.name || item.id || "未命名知识点");
      });
    }
  };

  global.StudyReport = StudyReport;
})(window);
