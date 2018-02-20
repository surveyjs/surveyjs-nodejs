function InmemoryDBAdapter(session) {
  function getObjectFromStorage(tableName, callback) {
    var objects = {};
    var result = session[tableName];
    (result || []).forEach(function(item) {
      objects[item.id] = item;
    });
    callback(objects);
  }

  function addSurvey(name, callback) {
    var table = session["surveys"];
    if (!table) {
      table = [];
      session["surveys"] = table;
    }
    var newObj = {
      name: name,
      json: "{}"
    };
    table.push(newObj);
    callback(newObj);
  }

  function postResults(postId, json, callback) {
    var table = session["results"];
    if (!table) {
      table = [];
      session["results"] = table;
    }
    var newObj = {
      postid: postId,
      json: json
    };
    table.push(newObj);
    callback(newObj);
  }

  function getResults(postId, callback) {
    var table = session["results"];
    if (!table) {
      table = [];
      session["results"] = table;
    }
    var results = (table || [])
      .filter(function(item) {
        item.postId === postId;
      })
      .map(function(item) {
        return item["json"];
      });
    callback(results);
  }

  function deleteSurvey(surveyId, callback) {
    var table = session["surveys"];
    if (!table) {
      table = [];
      session["surveys"] = table;
    }
    var result = table.filter(function(item) {
      return item.name === surveyId;
    })[0];
    table.splice(table.indexOf(result), 1);
    callback(result);
  }

  function storeSurvey(id, json, callback) {
    var table = session["surveys"];
    if (!table) {
      table = [];
      session["surveys"] = table;
    }
    var result = table.filter(function(item) {
      return item.name === id;
    })[0];
    if (!!result) {
      result.json = json;
    } else {
      table.push({
        name: id,
        json: json
      });
    }
    callback();
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
    getObjectFromStorage("surveys", function(objects) {
      if (Object.keys(objects).length > 0) {
        callback(objects);
      } else {
        this.storeSurvey("MySurvey1", JSON.stringify(surveys["MySurvey1"]));
        this.storeSurvey("MySurvey2", JSON.stringify(surveys["MySurvey2"]));
        getObjectFromStorage("surveys", callback);
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
    getResults: getResults
  };
}

module.exports = InmemoryDBAdapter;
