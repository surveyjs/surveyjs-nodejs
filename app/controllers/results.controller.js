const { results } = require("../models");
var db = require("../models");
var Result = db.results;

exports.getResults = (req, res) => {
  const id = req.query["postId"];

  Result.findOne({postId: id}, 'data')
    .then(results => {
      if (!results)
        res.status(404).send({ message: "Not found Results with id " + id });
      else res.send(results);
    })
    .catch(err => {
      res
        .status(500)
        .send({ message: "Error retrieving Survey with id=" + id });
    });
};

exports.postResults = (req, res) => {
  
  if (!req.body) {
    return res.status(400).send({
      message: "Data to update can not be empty!"
    });
  }


    const result = new Result({
      postId: req.body.postId,
      surveyResult: req.body.surveyResult
    });
  
    // Save survey in the database
    result
      .save(result)
      .then(data => {
        res.send(data);
      })
      .catch(err => {
        res.status(500).send({
          message:
            err.message || "Some error occurred while creating the survey."
        });
      });
};
