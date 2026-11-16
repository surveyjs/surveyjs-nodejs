// Translate with AI
import { note } from "./host.js";
import { SurveyCreator, renderSurveyCreator } from "survey-creator-js";
import { createSchemaSaver, responseError } from "./schema-saver.js";
import "survey-core/i18n";

const formId = "support-translations";
const creator = new SurveyCreator({ showTranslationTab: true, showLogicTab: false });
const element = document.getElementById("creator");
const retryLoad = document.getElementById("retry-load");
const errorMessage = document.getElementById("creator-error");
let loaded = false, saving = false;

const saver = createSchemaSaver(() => creator.JSON, async json => {
  const response = await fetch(`/api/forms/${formId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: json });
  if (!response.ok) throw await responseError(response, "Couldn't save the translations. Please try again.");
}, ({ state, error }) => {
  if (!loaded) return;
  saving = state === "saving";
  showError(state === "error" ? `${error} Your translations remain in the editor.` : "");
  updateControls();
});
creator.saveSurveyFunc = (saveNo, callback) => saver.save().then(saved => {
  callback(saveNo, saved);
  // Creator says "not saved" in the callback; show the server's reason after it
  if (!saved) creator.notify(saver.error, "error");
});
creator.onModified.add(() => { if (loaded) saver.changed(); });

// #region sjs:ai-translation.client
// Return translated strings in the original order, and always finish the callback
creator.onMachineTranslate.add(async (_, options) => {
  showError("");
  try {
    const response = await fetch("/api/translate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ strings: options.strings, from: options.fromLocale, to: options.toLocale })
    });
    if (!response.ok) throw await responseError(response, "AI translation failed. Please try again.");
    const strings = await response.json();
    if (!Array.isArray(strings) || strings.length !== options.strings.length || strings.some(text => typeof text !== "string"))
      throw new Error("The translation provider returned an invalid result. Please try again.");
    options.callback(strings);
  } catch (error) {
    options.callback([]);
    showError(`${translationError(error)} Existing translations are kept.`);
    note(error.message, "error");
  }
});
// #endregion

function translationError(error) {
  return error instanceof TypeError ? "Couldn't reach the translation service. Please try again." : error.message;
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = !message;
}

function updateControls() {
  element.inert = !loaded || saving;
}
async function loadDefinition() {
  retryLoad.hidden = true;
  showError("");
  try {
    const response = await fetch(`/api/forms/${formId}`);
    if (!response.ok) throw await responseError(response, "Couldn't load the form schema. Please try again.");
    const { definition } = await response.json();
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) throw new Error("The server returned an invalid form schema.");
    creator.JSON = definition;
    renderSurveyCreator(creator, element);
    creator.switchTab("translation");
    loaded = true;
    saver.markSaved();
    creator.autoSaveEnabled = true;
    element.hidden = false;
  } catch (error) { showError(error.message); retryLoad.hidden = false; }
  updateControls();
}
retryLoad.addEventListener("click", loadDefinition);
updateControls();
await loadDefinition();
