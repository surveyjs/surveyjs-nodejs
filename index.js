var express = require("express");
var bodyParser = require("body-parser");
var dbadapter = require("./dbadapter");

var app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

var db = new dbadapter();

function sendJsonResult(res, obj) {
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(obj));
}

app.get("/getActive", function(req, res) {
  db.getSurveys(function(result) {
    sendJsonResult(res, result);
  });
});

app.get("/getSurvey", function(req, res) {
  var surveyId = req.query["surveyId"];
  db.getSurvey(surveyId, function(result) {
    sendJsonResult(res, result);
  });
});

app.get("/create", function(req, res) {
  var name = req.query["name"];
  db.addSurvey(name, function(result) {
    sendJsonResult(res, { Name: result.name, Id: result.id });
  });
});

app.post("/changeJson", function(req, res) {
  var id = req.body.Id;
  var json = req.body.Json;
  db.storeSurvey(id, json, function(result) {
    sendJsonResult(res, result.json);
  });
});

app.post("/post", function(req, res) {
  var postId = req.body.postId;
  var surveyResult = req.body.surveyResult;
  db.postResults(postId, surveyResult, function(result) {
    sendJsonResult(res, result.json);
  });
});

app.get("/delete", function(req, res) {
  var surveyId = req.query["id"];
  db.deleteSurvey(surveyId, function(result) {
    sendJsonResult(res, {});
  });
});

app.get("/results", function(req, res) {
  var postId = req.query["postId"];
  db.getResults(postId, function(result) {
    sendJsonResult(res, result);
  });
});

app.use(express.static(__dirname + "/public"));

app.listen(3000, function() {
  console.log("Listening on port 3000!");
});
