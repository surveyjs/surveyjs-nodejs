var surveyName = "";
function setSurveyName(name) {
  var $titleTitle = jQuery("#sjs_editor_title_show");
  $titleTitle.find("span:first-child").text(name);
}
function startEdit() {
  var $titleEditor = jQuery("#sjs_editor_title_edit");
  var $titleTitle = jQuery("#sjs_editor_title_show");
  $titleTitle.hide();
  $titleEditor.show();
  $titleEditor.find("input")[0].value = surveyName;
  $titleEditor.find("input").focus();
}
function cancelEdit() {
  var $titleEditor = jQuery("#sjs_editor_title_edit");
  var $titleTitle = jQuery("#sjs_editor_title_show");
  $titleEditor.hide();
  $titleTitle.show();
}
function postEdit() {
  cancelEdit();
  var oldName = surveyName;
  var $titleEditor = jQuery("#sjs_editor_title_edit");
  surveyName = $titleEditor.find("input")[0].value;
  setSurveyName(surveyName);
  jQuery
    .get("/changeName?id=" + surveyId + "&name=" + surveyName, function(data) {
      surveyId = data.Id;
    })
    .fail(function(error) {
      surveyName = oldName;
      setSurveyName(surveyName);
      alert(JSON.stringify(error));
    });
}

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

Survey.dxSurveyService.serviceUrl = "";
var accessKey = "";
var editor = new SurveyEditor.SurveyEditor("editor");
var surveyId = decodeURI(getParams()["id"]);
surveyName = decodeURI(getParams()["name"]);
editor.loadSurvey(surveyId);
editor.saveSurveyFunc = function(saveNo, callback) {
  var xhr = new XMLHttpRequest();
  xhr.open(
    "POST",
    Survey.dxSurveyService.serviceUrl + "/changeJson?accessKey=" + accessKey
  );
  xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
  xhr.onload = function() {
    var result = xhr.response ? JSON.parse(xhr.response) : null;
    if (xhr.status === 200) {
      callback(saveNo, true);
    }
  };
  xhr.send(
    JSON.stringify({ Id: surveyId, Json: editor.text, Text: editor.text })
  );
};
editor.isAutoSave = true;
editor.showState = true;
editor.showOptions = true;

setSurveyName(surveyName);
