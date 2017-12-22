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
  var id = db.addSurvey(name, function(result) {
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

app.use(express.static(__dirname + "/public"));

app.listen(3000, function() {
  console.log("Listening on port 3000!");
});
