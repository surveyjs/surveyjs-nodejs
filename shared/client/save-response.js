// Save Responses
import { mountSurvey, note, onStored, show } from "./host.js";
import { Model } from "survey-core";

// #region sjs:save-response.client
// Define the form directly in the page - no database needed
const definition = {
  title: "Contact us", completeText: "Send message",
  elements: [
    { type: "text", name: "email", title: "Your email", inputType: "email", isRequired: true },
    { type: "comment", name: "message", title: "How can we help?", isRequired: true }
  ]
};
const survey = new Model(definition);
// Save after completion; SurveyJS offers a retry action if saving fails
survey.onComplete.add(async (sender, options) => {
  try {
    const response = await fetch("/api/responses", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ formId: "contact", data: sender.data })
    });
    const { id } = response.ok ? await response.json() : {};
    if (!Number.isInteger(id) || id < 1) throw new Error("Missing response ID");
    sender.setVariable("responseId", id);
    options.showSaveSuccess();
  } catch {
    options.showSaveError("We couldn't save your message. Please try again.");
  }
});
// #endregion

mountSurvey(survey);

// Demo only: the completion screen while the message is sent, after it is saved and when saving fails
survey.onComplete.add((sender, options) => {
  sender.setVariable("responseId", null);
  sender.completedHtml = "<h3>Sending your message...</h3>";
  options.showSaveInProgress("Sending your message...");
});
const completedHtml = {
  success: () => `<h3>Your message has been saved.</h3><p>Response ID: ${survey.getVariable("responseId")}</p>`,
  error: () => "<h3>Your message hasn't been saved.</h3>",
};

// Demo only: compare the posted body with what the server stored
let posted = null;
survey.onComplete.add((sender) => {
  posted = { formId: "contact", data: sender.data };
  show("posted", JSON.stringify(posted, null, 2));
});
onStored((stored) => {
  const row = stored.responses?.find((r) => r.id === survey.getVariable("responseId"));
  if (!posted || !row) return;
  const identical = JSON.stringify(row.data) === JSON.stringify(posted.data);
  show("identical", identical ? "identical ✓" : "different ✗");
  note(identical
    ? `Response #${row.id}: the server saved the submitted data without changes.`
    : `Response #${row.id}: the stored data differs from the posted data.`, identical ? "ok" : "error");
  posted = null;
});
const startOver = document.getElementById("start-over");
survey.registerPropertyChangedHandlers(["completedState"], () => {
  if (completedHtml[survey.completedState]) survey.completedHtml = completedHtml[survey.completedState]();
  if (startOver) startOver.disabled = survey.completedState === "saving";
});
startOver?.addEventListener("click", () => {
  posted = null;
  survey.notifier.active = false;
  survey.clear(true, true);
});
