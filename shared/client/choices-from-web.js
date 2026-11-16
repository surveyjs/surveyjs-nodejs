// Load Choices from Web
import { mountSurvey, page, setStoredQuery } from "./host.js";
import { Model } from "survey-core";

// Demo only: a stand-in for the access token your app already has
const token = "demo-token";

// #region sjs:choices-from-web.client
// Use choicesByUrl in the form definition to load lists from API endpoints
//   "choicesByUrl": { "url": "/api/offices?region={region}", "valueName": "id", "titleName": "name" }
//   "choicesByUrl": { "url": "/api/countries", "valueName": "code", "titleName": "name" }
// SurveyJS replaces {region} with the selected region and reloads the office list when the region changes

// Optional: add your auth header to every choices request
import { settings } from "survey-core";
settings.web.onBeforeRequestChoices = (_, options) => {
  options.request?.setRequestHeader("Authorization", `Bearer ${token}`);
};
// #endregion

const survey = mountSurvey(new Model(page.definition));

// Clear the previous selection immediately, before the new office list arrives
survey.onValueChanged.add((sender, { name }) => {
  if (name === "region") sender.clearValue("office");
});

// Save the selected values when the respondent completes the form
survey.onComplete.add(async (sender, options) => {
  sender.completedHtml = "<h3>Saving your response...</h3>";
  options.showSaveInProgress();
  try {
    const response = await fetch("/api/responses", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ formId: "visit", data: sender.data })
    });
    if (!response.ok) throw new Error("Save failed");
    const { id } = await response.json();
    if (!Number.isInteger(id) || id < 1) throw new Error("Missing response ID");
    setStoredQuery({ id });
    sender.completedHtml = `<h3>Your response has been saved.</h3><p>Response ID: ${id}</p><p>Open <strong>Data</strong> to inspect the saved answers.</p>`;
    options.showSaveSuccess();
  } catch {
    sender.completedHtml = "<h3>Your response hasn't been saved.</h3>";
    options.showSaveError("We couldn't save your response. Please try again.");
  }
});
const startOver = document.getElementById("start-over");
survey.registerPropertyChangedHandlers(["completedState"], () => {
  startOver.disabled = survey.completedState === "saving";
});
startOver.addEventListener("click", () => {
  survey.notifier.active = false;
  survey.clear(true, true);
  setStoredQuery({});
});
