function getParams() {
  var url = window.location.href
    .slice(window.location.href.indexOf("?") + 1)
    .split("&");
  var result = {};
  url.forEach(function(item) {
    var param = item.split("=");
    result[param[0]] = param[1];
  });
  return result;
}

function init() {
  Survey.dxSurveyService.serviceUrl = "";

  var css = {
    root: "sv_main sv_frame sv_default_css"
  };

  var surveyId = decodeURI(getParams()["id"]);
  var model = new Survey.Model({ surveyId: surveyId, surveyPostId: surveyId });
  model.css = css;
  window.survey = model;
  model.render("surveyElement");

  // // Load survey by id from url
  // var xhr = new XMLHttpRequest();
  // xhr.open('GET', "https://surveyjs-php.herokuapp.com" + '/survey?surveyId=' + surveyId);
  // xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
  // xhr.onload = function () {
  //     var result = JSON.parse(xhr.response);
  //     if(!!result) {
  //         var surveyModel = new Survey.Model(result);
  //         window.survey = surveyModel;
  //         ko.cleanNode(document.getElementById("surveyElement"));
  //         document.getElementById("surveyElement").innerText = "";
  //         surveyModel.render("surveyElement");
  //     }
  // };
  // xhr.send();
}

init();
