var pgp = require("pg-promise")(/*options*/);

function PostgresDBAdapter() {
  var db = pgp("postgres://postgres:123456@postgresql-db:5432/surveyjs");

  function getSurveys() {
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
    // $result = $this->getObjectFromStorage('surveys');
    // if(count($result) == 0) {
    //     $id1 = $this->addSurvey('MySurvey1');
    //     $this->storeSurvey($id1, $surveys['MySurvey1']);
    //     $id2 = $this->addSurvey('MySurvey2');
    //     $this->storeSurvey($id2, $surveys['MySurvey2']);
    //     $result = surveys;
    // }
    return surveys;
  }

  return {
    getSurvey: function(surveyId) {
      return getSurveys()[surveyId];
    },
    getSurveys: getSurveys
  };
}

module.exports = PostgresDBAdapter;
