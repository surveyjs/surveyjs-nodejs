var mysql = require('mysql');
var demoData = require("./demo-surveys");

var config = {
  host    : 'localhost',
  user    : 'root',
  password: 'password',
  database: 'surveyjs'
};

var db = mysql.createConnection(config);

function MySQLDBAdapter() {

  function getObjectFromStorage(tableName, callback) {

    db.query("SELECT * FROM " + tableName, function(err, result){
      if (err) console.log(err);
      console.log(result);
      var objects = {};
      (result || []).forEach(function(item) {
        objects[item.id] = item;
      });
      callback(objects);
    });
  }

  function addSurvey(name, callback) {
      var sql = "INSERT INTO surveys (name, json) VALUES(?, ?) ";
      db.query(sql, [name, "{}"], function (err, result) {
        if (err) throw err;
          db.query("SELECT * FROM surveys", function(err, result){
            console.log(JSON.stringify(result));
            callback(result);
          });
      });
  }

  function postResults(postId, json, callback) {
      var sql = "INSERT INTO results (postid, json) VALUES(?, ?) ";
      db.query(sql, [postId, json], function (err, result) {
        if (err) throw err;
          db.query("SELECT * FROM results WHERE postid = ?", [postId], function(err, result){
            console.log(JSON.stringify(result));
            callback(result);
          });
      });
  }

  function getResults(postId, callback) {

    db.query("SELECT * FROM results WHERE postid= ?", [postId], function(err, result){
      console.log(JSON.stringify(result));
      var results = (result || []).map(function(item) {
        return item["json"];
      });
      callback(results);
    });
  }
 
  function deleteSurvey(surveyId, callback) {
    var sql = "DELETE FROM surveys WHERE id = ?";
    con.query(sql, [id], function (err, result) {
      if (err) throw err;
      console.log("Number of records deleted: " + result.affectedRows);
      db.query("SELECT * FROM surveys", function(err, result){
        callback(result);
      });
    });
  }

  function changeName(id, name, callback) {
    var sql = "UPDATE surveys SET name = ? WHERE id = ? ";
    db.query(sql, [name, id], function (err, result) {
      if (err) throw err;

      db.query("SELECT * FROM surveys WHERE id = ?", [id], function(err, result){
        callback(result);
      });

    });
    
  }

  function storeSurvey(id, json, callback) {
    var sql = "UPDATE surveys SET json = ? WHERE id = ? ";
    db.query(sql, [json, id], function (err, result) {
      if (err) throw err;
      console.log("Number of records affected: " + JSON.stringify(result.affectedRows));
      db.query("SELECT * FROM surveys WHERE id = ?", [id], function(err, result){
        console.log(JSON.stringify(result));
        callback(result);
      });
    });
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
      logger.log({
        level: 'info',
        message: "callback getObjectFromStorage "+objects
      });
      if (Object.keys(objects).length > 0) {
        callback(objects);
      } else {
        callback(surveys);
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

module.exports = MySQLDBAdapter;
