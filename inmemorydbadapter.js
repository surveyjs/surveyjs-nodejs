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
    var objects = {};
    var table = getTable(tableName);
    table.forEach(function(item) {
      objects[item.name] = item;
    });
    callback(objects);
  }

  function addSurvey(name, callback) {
    var table = getTable("surveys");
    var newObj = {
      name: name,
      json: "{}"
    };
    table.push(newObj);
    callback(newObj);
  }

  function postResults(postId, json, callback) {
    var table = getTable("results");
    var newObj = {
      postid: postId,
      json: json
    };
    table.push(newObj);
    callback(newObj);
  }

  function getResults(postId, callback) {
    var table = getTable("results");
    var results = table
      .filter(function(item) {
        return item.postid === postId;
      })
      .map(function(item) {
        return item.json;
      });
    callback(results);
  }

  function deleteSurvey(surveyId, callback) {
    var table = getTable("surveys");
    var result = table.filter(function(item) {
      return item.name === surveyId;
    })[0];
    table.splice(table.indexOf(result), 1);
    callback(result);
  }

  function storeSurvey(id, json, callback) {
    var table = getTable("surveys");
    var result = table.filter(function(item) {
      return item.name === id;
    })[0];
    if (!!result) {
      result.json = json;
    } else {
      result = {
        name: id,
        json: json
      };
      table.push(result);
    }
    callback && callback(result);
  }

  function changeName(id, name, callback) {
    var table = getTable("surveys");
    var result = table.filter(function(item) {
      return item.name === id;
    })[0];
    if (!!result) {
      result.name = name;
    }
    callback && callback(result);
  }

  function getSurveys(callback) {
    var surveys = {
      MySurvey1: {
        pages: [
          {
            name: "page1",
            elements: [
              {
                type: "radiogroup",
                choices: ["item1", "item2", "item3"],
                name: "question from survey1"
              }
            ]
          }
        ]
      },
      MySurvey2: {
        pages: [
          {
            name: "page1",
            elements: [
              {
                type: "checkbox",
                choices: ["item1", "item2", "item3"],
                name: "question from survey2"
              }
            ]
          }
        ]
      }
    };
    getObjectsFromStorage("surveys", function(objects) {
      if (Object.keys(objects).length > 0) {
        callback(objects);
      } else {
        storeSurvey("MySurvey1", JSON.stringify(surveys["MySurvey1"]));
        storeSurvey("MySurvey2", JSON.stringify(surveys["MySurvey2"]));
        getObjectsFromStorage("surveys", callback);
      }
    });
  }

  return {
    addSurvey: addSurvey,
    getSurvey: function(surveyId, callback) {
      getSurveys(function(result) {
        callback(JSON.parse(result[surveyId].json));
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
