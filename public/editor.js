function getParams() {
    var url = window.location.href.slice(window.location.href.indexOf('?') + 1).split('&');
    var result = {};
    url.forEach(function(item) {
        var param = item.split("=");
        result[param[0]] = param[1];
    });
    return result;
}
  
Survey.dxSurveyService.serviceUrl = "http://localhost:8000";
var accessKey = "";
var editor = new SurveyEditor.SurveyEditor("editor");
var surveyId = getParams()["id"];
editor.loadSurvey(surveyId);
editor.saveSurveyFunc = function (saveNo, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', Survey.dxSurveyService.serviceUrl + '/changeJson?accessKey=' + accessKey);
    xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
    xhr.onload = function () {
        var result = xhr.response ? JSON.parse(xhr.response) : null;
        if(xhr.status === 200) {
            callback(saveNo, true)
        }
    };
    xhr.send(JSON.stringify({ Id: surveyId, Json: editor.text, Text: editor.text }));
};
editor.isAutoSave = true;
editor.showState = true;
editor.showOptions = true;
