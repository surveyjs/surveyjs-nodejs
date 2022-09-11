const dbConfig = require("../config/db.config");

const mongoose = require("mongoose");
mongoose.Promise = global.Promise;

const db = {};
db.mongoose = mongoose;
db.url = dbConfig.url;
db.surveys = require("./survey.model")(mongoose);
db.results = require("./results.model")(mongoose);

module.exports = db;