(function (global) {
  "use strict";

  var knowledge = (global.ChemLabKnowledge || {});

  var KnowledgeEngine = {
    get: function (id) {
      return knowledge[id] || null;
    },
    search: function (keyword) {
      return Object.keys(knowledge).map(function (k) { return knowledge[k]; }).filter(function (item) {
        return JSON.stringify(item).indexOf(keyword) >= 0;
      });
    },
    recommendByError: function (errorType) {
      return Object.keys(knowledge).map(function (k) { return knowledge[k]; }).filter(function (item) {
        return (item.errors || []).indexOf(errorType) >= 0;
      });
    },
    all: function () {
      return knowledge;
    }
  };

  global.KnowledgeEngine = KnowledgeEngine;
})(window);
