function getParams() {
  var url = window.location.href
    .split("#")[0]
    .slice(window.location.href.indexOf("?") + 1)
    .split("&");
  var result = {};
  url.forEach(function (item) {
    var param = item.split("=");
    result[param[0]] = param[1];
  });
  return result;
}

function SurveyManager(baseUrl, accessKey) {
  var self = this;
  self.activeTab = ko.observable(
    window.location.hash.replace("#", "") || "summary"
  );
  self.surveyId = decodeURI(getParams()["id"]);
  self.results = ko.observableArray();
  Survey.dxSurveyService.serviceUrl = "";
  var survey = new Survey.Model({
    surveyId: self.surveyId,
    surveyPostId: self.surveyId,
  });
  self.columns = ko.observableArray();

  self.loadResults = function () {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", baseUrl + "/results?postId=" + self.surveyId);
    xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
    xhr.onload = function () {
      var result = xhr.response ? JSON.parse(xhr.response) : [];
      self.results(
        result.map(function (r) {
          return JSON.parse(r || "{}");
        })
      );

      var json = new Survey.JsonObject().toJsonObject(survey);
      var windowSurvey = new Survey.SurveyWindow(json);
      windowSurvey.survey.mode = "display";
      windowSurvey.survey.title = self.surveyId;
      windowSurvey.show();

      var visPanel = (self.visPanel = new SurveyAnalytics.VisualizationPanel(
        survey.getAllQuestions(),
        self.results(),
        { haveCommercialLicense: true }
      ));
      visPanel.render(document.getElementById("summaryContainer"));

      SurveyAnalyticsTabulator.TableExtensions.registerExtension({
        location: "details",
        name: "showinsurvey",
        visibleIndex: 0,
        render: (table, opt) => {
          return SurveyAnalyticsTabulator.DocumentHelper.createElement(
            "button",
            "rounded-button",
            {
              innerHTML: "Show in Survey",
              onclick: (e) => {
                windowSurvey.survey.data =
                  table.data[opt.row.getDataPosition()];
                windowSurvey.isExpanded = true;
              },
            }
          );
        },
      });

      var table = (self.table = new SurveyAnalyticsTabulator.Tabulator(
        survey,
        self.results(),
        { haveCommercialLicense: true }
      ));
      table.render(document.getElementById("tableContainer"));
    };
    xhr.send();
  };

  survey.onLoadSurveyFromService = function () {
    self.loadResults();
  };

  self.showSummary = function () {
    var tab = "summary";
    self.activeTab(tab);
    self.visPanel.layout();
    window.location.hash = "#" + tab;
  };

  self.showTable = function () {
    var tab = "table";
    self.activeTab(tab);
    self.table.layout();
    window.location.hash = "#" + tab;
  };
}

ko.applyBindings(new SurveyManager(""), document.body);
