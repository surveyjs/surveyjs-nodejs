var demoData = require("./demo-surveys");

var currentId = demoData.surveys.length + 1;

function InMemoryDBAdapter(session) {
  function getTable(tableName) {
    var table = session[tableName];
    if (!table) {
      table = [];
      session[tableName] = table;
    }
    return table;
  }

  function getObjectsFromStorage(tableName, callback) {
    // var objects = {};
    var table = getTable(tableName);
    callback(table);
    // table.forEach(function(item) {
    //   objects[item.name] = item;
    // });
    // callback(objects);
  }

  function findById(objects, id) {
    return objects.filter(function (o) { return o.id === id; })[0];
  }

  function addSurvey(name, callback) {
    var table = getTable("surveys");
    var newObj = {
      id: '' + currentId++,
      name: name || demoData.defaultName + " " + currentId,
      json: "{}"
    };
    table.push(newObj);
    callback(newObj);
  }

  function postResults(postId, json, callback) {
    var table = getTable("results");
    var results = findById(table, postId);
    if (!results) {
      results = {
        id: postId,
        data: []
      }
      table.push(results);
    }
    results.data.push(json);
    callback({});
  }

  function getResults(postId, callback) {
    var table = getTable("results");
    var results = findById(table, postId);
    callback(results);
  }

  function deleteSurvey(surveyId, callback) {
    var table = getTable("surveys");
    var survey = findById(table, surveyId);
    table.splice(table.indexOf(survey), 1);
    callback(survey);
  }

  function storeSurvey(id, name, json, callback) {
    var table = getTable("surveys");
    var survey = findById(table, id);
    if (!!survey) {
      survey.json = json;
    } else {
      survey = {
        id: id,
        name: name || id,
        json: json
      };
      table.push(survey);
    }
    callback && callback(survey);
  }

  function changeName(id, name, callback) {
    var table = getTable("surveys");
    var survey = findById(table, id);
    if (!!survey) {
      survey.name = name;
    }
    callback && callback(survey);
  }

  function getSurveys(callback) {
    getObjectsFromStorage("surveys", function (objects) {
      if (objects.length > 0) {
        callback(objects);
      } else {
        var surveys = getTable("surveys");
        demoData.surveys.forEach(function (survey) {
          surveys.push(JSON.parse(JSON.stringify(survey)));
        })
        var results = getTable("results");
        demoData.results.forEach(function (result) {
          results.push(JSON.parse(JSON.stringify(result)));
        })
        getObjectsFromStorage("surveys", callback);
      }
    });
  }

  return {
    addSurvey: addSurvey,
    getSurvey: function (surveyId, callback) {
      getSurveys(function (surveys) {
        callback(findById(surveys, surveyId));
      });
    },
    storeSurvey: storeSurvey,
    getSurveys: getSurveys,
    deleteSurvey: deleteSurvey,
    postResults: postResults,
    getResults: getResults,
    changeName: changeName
  };
}

module.exports = InMemoryDBAdapter;
