var express = require("express");
var app = express();

app.get("/getActive", function(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify([{ name: "Test", json: "" }]));
});

app.use(express.static(__dirname + "/public"));

app.listen(3000, function() {
  console.log("Listening on port 3000!");
});
