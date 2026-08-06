(function (global) {
  "use strict";

  var AITutor = {
    analyzeMistake: function (mistake) {
      return {
        reason: mistake.reason || "需要加强知识理解",
        suggestion: "重新学习相关知识点并完成针对训练"
      };
    },
    recommendLesson: function (knowledgeId) {
      return {
        knowledgeId: knowledgeId,
        action: "review_and_practice"
      };
    },
    explainConcept: function (concept) {
      return "重新理解核心概念：" + concept;
    }
  };

  global.AITutor = AITutor;
})(window);
