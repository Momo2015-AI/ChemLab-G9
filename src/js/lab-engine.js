(function (global) {
  "use strict";

  var LabEngine = {
    start: function (experiment) {
      return { experiment: experiment, step: 0, status: "started" };
    },
    checkStep: function (expected, answer) {
      return { correct: expected === answer, expected: expected, answer: answer };
    },
    evaluate: function (record) {
      return {
        score: record.correct ? 100 : 0,
        suggestion: record.correct ? "实验操作正确" : "请复习实验步骤"
      };
    }
  };

  global.LabEngine = LabEngine;
})(window);
