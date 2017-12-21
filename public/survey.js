function getParams() {
    var url = window.location.href.slice(window.location.href.indexOf('?') + 1).split('&');
    var result = {};
    url.forEach(function(item) {
        var param = item.split("=");
        result[param[0]] = param[1];
    });
    return result;
}
  
function init() {

    Survey.dxSurveyService.serviceUrl = "http://localhost:8000";
    Survey.defaultBootstrapCss.navigationButton = "btn btn-primary";
    Survey.Survey.cssType = "bootstrap";

    var surveyId = getParams()["id"];
    var model = new Survey.Model({ surveyId: surveyId, surveyPostId: surveyId });
    window.survey = model;
    model.render("surveyElement");
    
    // // Load survey by id from url
    // var xhr = new XMLHttpRequest();
    // xhr.open('GET', "http://localhost:8000" + '/survey?surveyId=' + surveyId);
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
