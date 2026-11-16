// Use Relational Storage
import { fill, mountSurvey, note, onStored, page, setStoredQuery, show } from "./host.js";

const definitionVersion = new URLSearchParams(location.search).get("version") === "v2" ? "v2" : "v1";
const definitions = { v1: page.definition, v2: page.definitionV2 };
let responseId = null;
let awaitingReadback = false;

// #region sjs:relational-storage.client
import { Model, Serializer } from "survey-core";

// Optional metadata describing the columns used by the server
Serializer.addProperty("question", { name: "dbColumn", category: "data" });

// Keep answer keys stable when question names change
const survey = new Model(definitions[definitionVersion]);
survey.completeText = "Submit claim";
// #endregion

// #region sjs:relational-storage.save
async function saveClaim(data, definitionVersion) {
  const response = await fetch("/api/claims", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data, definitionVersion })
  });
  if (!response.ok) throw new Error("Save failed");
  return response.json();
}
// #endregion

// Confirm the saved response ID before reporting that its columns were populated
survey.onComplete.add(async (sender, options) => {
  responseId = null;
  awaitingReadback = false;
  sender.completedHtml = "<h3>Saving your claim...</h3>";
  options.showSaveInProgress();
  try {
    const result = await saveClaim(sender.data, definitionVersion);
    if (!Number.isInteger(result?.id) || result.id < 1) throw new Error("Save failed");
    responseId = result.id;
    awaitingReadback = true;
    setStoredQuery({ id: responseId });
    sender.completedHtml = `<h3>Your claim has been saved.</h3><p>Response ID: ${responseId}</p>`;
    options.showSaveSuccess();
  } catch {
    sender.completedHtml = "<h3>Your claim hasn't been saved.</h3>";
    options.showSaveError("We couldn't save your claim. Please try again.");
  }
});
mountSurvey(survey);

// Demo only: show the mapping directly from the selected definition
const mapping = document.getElementById("mapping-rows");
for (const question of survey.getAllQuestions().filter(question => question.valueName)) {
  mapping.append(fill("mapping-row", { question: question.name, "value-name": question.valueName, column: question.dbColumn }));
}

// Confirm only the response and claim returned for this successful submission
onStored((stored) => {
  const claim = stored.claims?.find(row => row.response_id === responseId);
  const response = stored.responses?.find(row => row.id === responseId);
  if (!awaitingReadback || !claim || !response) return;
  awaitingReadback = false;
  const message = `Response #${response.id} (${response.definition_version}) saved. Database columns: customer_email = ${claim.customer_email}, amount = ${claim.amount}.`;
  show("mapping-status", message);
  note(message, "ok");
});

const startOver = document.getElementById("start-over");
survey.registerPropertyChangedHandlers(["completedState"], () => {
  startOver.disabled = survey.completedState === "saving";
  for (const link of document.querySelectorAll("[data-definition-version]")) link.setAttribute("aria-disabled", String(startOver.disabled));
});
for (const link of document.querySelectorAll("[data-definition-version]")) {
  link.addEventListener("click", event => { if (survey.completedState === "saving") event.preventDefault(); });
}
startOver?.addEventListener("click", () => {
  responseId = null;
  awaitingReadback = false;
  survey.clear(true, true);
  survey.notifier.active = false;
  setStoredQuery({});
  show("mapping-status", "");
});
