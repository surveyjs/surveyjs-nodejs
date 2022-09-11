var db = require("../models");
var Survey = db.surveys;
//var Results = db.results;

// Create and Save a new Tutorial
exports.create = (req, res) => {
  // Create a survey
  const survey = new Survey({
    accessKey: req.query["accessKey"],
    name: req.query["name"],
    ownerId: req.query["ownerId"]
  });

  // Save survey in the database
  survey
    .save(survey)
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

// Find a single survey with an id
exports.getSurvey = (req, res) => {
  const surveyId = req.query["surveyId"]
  Survey.findById(surveyId)
    .then(data => {
      if (!data)
        res.status(404).send({ message: "Not found Survey with id " + surveyId });
      else res.send(data);
    })
    .catch(err => {
      res
        .status(500)
        .send({ message: "Error retrieving Survey with id=" + surveyId });
    });
};

// Update a survey by the id in the request
exports.changeJson = (req, res) => {
  if (!req.body) {
    return res.status(400).send({
      message: "Data to update can not be empty!"
    });
  }
  const accessKey = req.query["accessKey"];
  const id = req.body.id;
  const json = req.body.json;
  const text = req.body.text;

  Survey.findByIdAndUpdate(id, {json: req.body.json})
    .then(data => {
      if (!data) {
        res.status(404).send({
          message: `Cannot update Survey with id=${id}. Maybe Survey was not found!`
        });
      } else res.send({ message: "Survey was updated successfully." });
    })
    .catch(err => {
      res.status(500).send({
        message: "Error updating Survey with id=" + id
      });
    });
};

exports.changeName = (req, res) => {
    if (!req.body) {
      return res.status(400).send({
        message: "Data to update can not be empty!"
      });
    }
  
    const id = req.params.id;
    const accessKey = req.query["accessKey"];
    const name = req.query["name"];
  
    Survey.findByIdAndUpdate(id, {name: name})
      .then(data => {
        if (!data) {
          res.status(404).send({
            message: `Cannot update Survey with id=${id}. Maybe Survey was not found!`
          });
        } else res.send({ message: "Survey was updated successfully." });
      })
      .catch(err => {
        res.status(500).send({
          message: "Error updating Survey with id=" + id
        });
      });
  };

// Delete a Tutorial with the specified id in the request
exports.delete = (req, res) => {
  const id = req.params.id;
  const accessKey = req.query["accessKey"];

  Survey.findByIdAndRemove(id)
    .then(data => {
      if (!data) {
        res.status(404).send({
          message: `Cannot delete Survey with id=${id}. Maybe Survey was not found!`
        });
      } else {
        res.send(data);
      }
    })
    .catch(err => {
      res.status(500).send({
        message: "Could not delete Survey with id=" + id
      });
    });
};

exports.getActive = (req, res) => {
  accessKey: req.query["accessKey"];
  ownerId: req.query["ownerId"];
    Survey.find({})
    //.populate('data')
    .then(survey => {
        res.send(survey);
    })
    .catch(err => {
        res.status(500).send({
            message:
                err.message 
        });
    });
};

// exports.getResults = (req, res) => {
//   const id = req.query["postId"];

//   Results.find({postId: id})
//     .then(data => {
//       if (!data)
//         res.status(404).send({ message: "Not found Results with id " + id });
//       else res.send(data);
//     })
//     .catch(err => {
//       res
//         .status(500)
//         .send({ message: "Error retrieving Survey with id=" + id });
//     });
// };

// exports.postResults = (req, res) => {
//   if (!req.body) {
//     return res.status(400).send({
//       message: "Data to update can not be empty!"
//     });
//   }



//   const results = new Results({
//     postId: req.body.postId,
//     json: req.body.surveyResult
//   });

//   // Save survey in the database
//   results
//     .save(results)
//     .then(data => {
//       res.send(data);
//     })
//     .catch(err => {
//       res.status(500).send({
//         message:
//           err.message || "Some error occurred while creating the survey."
//       });
//     });

// };