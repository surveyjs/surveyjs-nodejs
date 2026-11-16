// Load JSON Schemas, Variables, and Answers
import { mountSurvey, note, onStored, setStoredQuery } from "./host.js";

// #region sjs:load-definition-variables-data.client
import { Model } from "survey-core";

async function createSurvey(recordId) {
  if (window.FORM_DEFINITION) {
    // Option A: Use the schema and user variables embedded in the HTML response
    const survey = new Model(window.FORM_DEFINITION);
    survey.setVariables(window.FORM_VARIABLES);
    return survey;
  }
  // Option B: Load the definition, variables, and previous answers in one request
  const { definition, variables, data } =
    await fetch(`/api/forms/claim-request?record=${encodeURIComponent(recordId)}`).then(r => r.json());
  const survey = new Model(definition);
  survey.setVariables(variables);   // Variables are available in expressions such as {user.name} and are excluded from survey.data
  survey.data = data;               // Restore previously saved answers for editing
  return survey;
}
// #endregion

const recordId = new URLSearchParams(location.search).get("record") ?? "";
const survey = mountSurvey(await createSurvey(recordId));

// Saving the finished response is in save-response: post survey.data, which holds answers only
let savedResponseId = null;
survey.onComplete.add(async (sender, options) => {
  savedResponseId = null;
  sender.completedHtml = "<h3>Submitting your claim...</h3>";
  options.showSaveInProgress("Submitting your claim...");
  try {
    const response = await fetch("/api/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ formId: "claim", data: sender.data })
    });
    if (!response.ok) throw new Error("Save failed");
    const { id } = await response.json();
    if (!Number.isInteger(id) || id < 1) throw new Error("Missing response ID");
    savedResponseId = id;
    setStoredQuery({ id });
    sender.completedHtml = `<h3>Your claim has been submitted.</h3><p>Response ID: ${id}</p>`;
    options.showSaveSuccess();
  } catch {
    sender.completedHtml = "<h3>Your claim hasn't been submitted.</h3>";
    options.showSaveError("Couldn't save the response. Please try again.");
  }
});

// Demo only: show that the stored response carries no variables
onStored((stored) => {
  const row = stored.responses?.find((response) => response.id === savedResponseId);
  if (!row) return;
  savedResponseId = null;
  const keys = Object.keys(row.data ?? {});
  const leaked = keys.filter((key) => ["user", "plan", "variables"].includes(key));
  note(leaked.length
    ? `Response #${row.id} contains ${leaked.join(", ")}: variables were saved.`
    : `Response #${row.id} saved. Only submitted answers were stored; form variables were excluded.`, leaked.length ? "error" : "ok");
});

const startOver = document.getElementById("start-over");
survey.registerPropertyChangedHandlers(["completedState"], () => {
  if (startOver) startOver.disabled = survey.completedState === "saving";
});
startOver?.addEventListener("click", () => {
  savedResponseId = null;
  setStoredQuery({});
  survey.notifier.active = false;
  survey.clear(true, true);
  const records = document.getElementById("record");
  if (records) records.value = "";
  const url = new URL(location.href);
  url.searchParams.delete("record");
  history.replaceState(history.state, "", url);
});
