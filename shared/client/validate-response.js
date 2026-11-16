// Validate Responses
import { mountSurvey, note, page, setStoredQuery } from "./host.js";
import { Model } from "survey-core";

const survey = mountSurvey(new Model(page.definition));
survey.completeText = "Submit claim";
const startOver = document.getElementById("start-over");
const buttons = [...document.querySelectorAll("[data-tamper], #sample-answers")];
const valid = { customer_email: "ann@example.com", amount: 120, incident: "theft", details: "My bicycle was stolen from the garage" };
const tampered = {
  "unknown-choice": { ...valid, incident: "meteor" },
  "wrong-type": { ...valid, amount: { much: true } },
  "missing-required": { amount: 120, incident: "theft" },
};

function describe(error) {
  const path = String(error.path ?? "").replace(/^\$\.?/, "");
  const question = survey.getAllQuestions().find(q => q.name === path || q.valueName === path);
  const detail = error.text || error.message || error.locTextValue?.values?.default || error.type || "Invalid answer";
  return `${question ? `${question.title}: ` : path ? `${path}: ` : ""}${detail}`;
}
function lock(locked) {
  for (const button of buttons) button.disabled = locked;
  startOver.disabled = locked;
}

// #region sjs:validate-response.request
// Inspect the submitted payload and the server's validation errors in Requests
async function submit(data) {
  const payload = { formId: "claim", data };
  const response = await fetch("/api/responses", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
  });
  const report = await response.json();
  if (response.status === 400 && Array.isArray(report.errors) && report.errors.length) {
    return { rejected: true, errors: report.errors };
  }
  if (!response.ok) throw new Error(report.error || "Couldn't validate the response. Please try again.");
  if (!Number.isInteger(report.id) || report.id < 1) throw new Error("The server didn't confirm a saved response. Please try again.");
  setStoredQuery({ id: report.id });
  return { id: report.id };
}
// #endregion

// #region sjs:validate-response.client
// Confirm a save only after the backend accepts the answers and returns a response ID
survey.onComplete.add(async (sender, options) => {
  lock(true);
  sender.completedHtml = "<h3>Submitting your claim...</h3>";
  options.showSaveInProgress();
  try {
    const result = await submit(sender.data);
    if (result.rejected) throw new Error(result.errors.map(describe).join("; "));
    sender.completedHtml = `<h3>Your claim has been saved.</h3><p>Response ID: ${result.id}</p>`;
    options.showSaveSuccess();
  } catch (error) {
    sender.completedHtml = "<h3>Your claim hasn't been saved.</h3>";
    const message = error instanceof TypeError ? "Couldn't validate the response. Please try again." : error.message;
    options.showSaveError(message);
  } finally { lock(false); }
});
// #endregion

document.getElementById("sample-answers").addEventListener("click", () => {
  survey.clear(true, true);
  survey.data = valid;
});
startOver.addEventListener("click", () => {
  survey.notifier.active = false;
  survey.clear(true, true);
  setStoredQuery({});
});
for (const button of document.querySelectorAll("[data-tamper]")) {
  button.addEventListener("click", async () => {
    lock(true);
    try {
      const result = await submit(tampered[button.dataset.tamper]);
      note(result.rejected ? "Invalid response rejected as expected. No data was saved."
        : `Invalid response was accepted and saved as #${result.id}.`, result.rejected ? "ok" : "error");
    } catch (error) {
      const message = error instanceof TypeError ? "Couldn't validate the response. Please try again." : error.message;
      note(message, "error");
    } finally { lock(false); }
  });
}
