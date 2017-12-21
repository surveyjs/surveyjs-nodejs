var express = require("express");
var dbadapter = require("./dbadapter");

var app = express();
var db = new dbadapter();

app.get("/getActive", function(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(db.getSurveys()));
});

app.get("/getSurvey", function(req, res) {
  var surveyId = req.param("surveyId");
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(db.getSurvey(surveyId)));
});

app.use(express.static(__dirname + "/public"));

app.listen(3000, function() {
  console.log("Listening on port 3000!");
});
