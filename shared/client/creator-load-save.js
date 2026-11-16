// Load and Save Form JSON Schemas
import { mountSurvey, page, show } from "./host.js";
import { Model, Serializer } from "survey-core";
import { createSchemaSaver, responseError } from "./schema-saver.js";
import { SurveyCreator, renderSurveyCreator } from "survey-creator-js";

const formId = "support";
const preview = new URLSearchParams(location.search).has("form");
const element = document.getElementById("creator");
const retryLoad = document.getElementById("retry-load");
const retrySave = document.getElementById("retry-save");
const openSaved = document.getElementById("open-saved-form");
const restore = document.getElementById("restore-sample");
let loaded = false;
let busy = false;
let saveDenied = !page.user?.isEditor;

// The relational-storage custom property: it shows in the property grid's Data category
Serializer.addProperty("question", { name: "dbColumn", category: "data" });

// #region sjs:creator-load-save.client
const creator = new SurveyCreator({ showTranslationTab: true });
// Queue writes so an older request cannot overwrite newer edits
const saver = createSchemaSaver(() => creator.JSON, async json => {
  const response = await fetch(`/api/forms/${formId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: json
  });
  if ([401, 403].includes(response.status)) saveDenied = true;
  if (!response.ok) throw await responseError(response, "Couldn't save the form schema. Please try again.");
}, updateSaveState);
creator.saveSurveyFunc = (saveNo, callback) => {
  saver.save().then(saved => {
    callback(saveNo, saved);
    // Creator says "not saved" in the callback; show the server's reason after it
    if (!saved) creator.notify(saver.error, "error");
  });
};
// #endregion

function setBusy(value) {
  busy = value;
  element.inert = value;
  for (const control of [restore, document.getElementById("demo-user")]) if (control) control.disabled = value || !loaded || (control === restore && saveDenied);
  if (openSaved) openSaved.setAttribute("aria-disabled", String(value || !loaded));
  retrySave.disabled = value;
}

function updateSaveState({ state, error }) {
  if (!loaded || preview) return;
  const message = state === "saving" ? "Saving changes..." : state === "saved" ? "All changes saved."
    : state === "error" ? `${error} Your changes remain in this editor.` : "Unsaved changes. Saving shortly...";
  show("schema-status", message);
  retrySave.hidden = state !== "error" || saveDenied;
  if (restore) restore.disabled = busy || state === "saving" || saveDenied;
}

// #region sjs:creator-load-save.load
// Render only after the backend returns a valid form schema
async function loadDefinition() {
  setBusy(true);
  retryLoad.hidden = true;
  show("schema-status", "Loading the saved form...");
  try {
    const response = await fetch(`/api/forms/${formId}`);
    if (!response.ok) throw await responseError(response, "Couldn't load the form schema. Please try again.");
    const { definition } = await response.json();
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) throw new Error("The server returned an invalid form schema.");
    creator.JSON = definition;
    loaded = true;
    saver.markSaved();
    if (preview) mountSurvey(new Model(definition), "creator");
    else { renderSurveyCreator(creator, element); creator.autoSaveEnabled = true; }
    element.hidden = false;
    if (preview) show("schema-status", "This form uses the saved schema.");
  } catch (error) { show("schema-status", error.message); retryLoad.hidden = false; }
  finally { setBusy(false); }
}
// #endregion

creator.onModified.add(() => { if (loaded) saver.changed(); });
retryLoad.addEventListener("click", loadDefinition);
retrySave.addEventListener("click", () => creator.saveSurvey());
openSaved?.addEventListener("click", async event => {
  event.preventDefault();
  if (busy || !loaded) return;
  const tab = window.open("", "_blank");
  if (!tab) { show("schema-status", "Allow pop-ups to open the saved form."); return; }
  if (saveDenied) { tab.location.href = new URL("?form", location.href).href; return; }
  setBusy(true);
  creator.saveSurvey();
  const saved = await saver.save();
  if (saved) tab.location.href = new URL("?form", location.href).href;
  else tab.close();
  setBusy(false);
});
restore?.addEventListener("click", async () => {
  setBusy(true);
  creator.autoSaveEnabled = false;
  creator.JSON = structuredClone(page.definition);
  await saver.save();
  creator.autoSaveEnabled = true;
  setBusy(false);
});
await loadDefinition();
