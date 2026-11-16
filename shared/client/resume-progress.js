// Resume Progress
import { mountSurvey, page, setDemoUser, setStoredQuery, show } from "./host.js";
import { Model } from "survey-core";

const formId = "onboarding";
const progressUrl = `/api/progress/${formId}`;
const jsonHeaders = { "Content-Type": "application/json", Accept: "application/json" };
const survey = new Model(page.definition);
const form = document.getElementById("form");
const reload = document.getElementById("reload");
const startOver = document.getElementById("start-over");
const respondent = document.getElementById("demo-user");
const retry = document.getElementById("retry-progress");
let ready = false, locked = false, recording = false;
let pendingProgress = null, saving = null, lastSnapshot = null;
let retryAction = null, submittedId = null, finishing = false;
const snapshot = () => ({ data: survey.data, uiState: survey.uiState });

// Demo only: status and controls stay visible beside the form
function setStatus(message, action = null) {
  show("saved", message);
  retryAction = action;
  retry.hidden = !action;
}
function setLocked(value) {
  locked = value;
  for (const control of [reload, startOver, respondent]) control.disabled = !ready || locked;
  retry.disabled = locked;
  form.inert = !ready || locked;
  form.setAttribute("aria-busy", String(!ready || locked));
}
function showSurvey(uiState) {
  return new Promise((resolve) => {
    const rendered = () => {
      survey.onAfterRenderSurvey.remove(rendered);
      ready = true;
      setLocked(false);
      if (uiState) survey.uiState = uiState;
      resolve();
    };
    survey.onAfterRenderSurvey.add(rendered);
    mountSurvey(survey);
  });
}

// Accept page names from drafts saved before pages and questions had distinct names
function restorePageNames(state) {
  if (!state) return state;
  const names = { company: "company-details", goals: "onboarding-goals" };
  if (state.currentPageName) state.currentPageName = names[state.currentPageName] ?? state.currentPageName;
  if (state.pages) state.pages = Object.fromEntries(Object.entries(state.pages).map(([name, value]) => [names[name] ?? name, value]));
  return state;
}

// #region sjs:resume-progress.restore
// Restore the draft before rendering so saved answers cannot overwrite new input
async function restoreProgress() {
  setStatus("Loading saved progress...");
  try {
    const response = await fetch(progressUrl, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Load failed");
    const saved = await response.json();
    if (saved !== null && (!saved.data || typeof saved.data !== "object" || Array.isArray(saved.data) ||
      !saved.uiState || typeof saved.uiState !== "object" || Array.isArray(saved.uiState))) throw new Error("Invalid progress");
    survey.data = saved?.data ?? {};
    const uiState = restorePageNames(saved?.uiState);
    if (uiState) survey.uiState = uiState;
    await showSurvey(uiState);
    lastSnapshot = JSON.stringify(snapshot());
    recording = true;
    setStatus(saved ? "Your saved progress has been restored" : "No saved progress");
  } catch {
    setStatus("Couldn't load saved progress. Retry to continue.", restoreProgress);
  }
}
// #endregion

// #region sjs:resume-progress.save
// Finish each save before sending a newer snapshot
async function persistProgress() {
  if (recording) setStatus("Saving progress...");
  while (pendingProgress !== null) {
    const body = pendingProgress;
    pendingProgress = null;
    try {
      const response = await fetch(progressUrl, {
        method: "PUT", headers: jsonHeaders, body, keepalive: true
      });
      if (!response.ok) throw new Error("Save failed");
    } catch (error) {
      pendingProgress ??= body;
      throw error;
    }
  }
  if (recording) setStatus(`Progress saved at ${new Date().toLocaleTimeString()}`);
}
// #endregion

// #region sjs:resume-progress.client
import debounce from "lodash/debounce";

const saveProgress = debounce(() => flushProgress().catch(showSaveError), 800);
function flushProgress() {
  saveProgress.cancel();
  if (pendingProgress === null) return saving ?? Promise.resolve();
  return saving ??= persistProgress().finally(() => { saving = null; });
}
function queueProgress() {
  if (!recording || locked) return;
  const body = JSON.stringify(snapshot());
  if (body === lastSnapshot) return;
  lastSnapshot = pendingProgress = body;
  setStatus("Changes will be saved automatically");
  saveProgress();
}
survey.onValueChanged.add(queueProgress);
survey.onUIStateChanged.add(queueProgress);   // Include page and focus changes
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && recording && !locked) {
    flushProgress().catch(showSaveError);
  }
});
// #endregion

function showSaveError() {
  setStatus("Couldn't save progress. Retry to save your latest changes.", retrySave);
}
async function retrySave() {
  setLocked(true);
  try { await flushProgress(); } catch { showSaveError(); }
  finally { setLocked(false); }
}
async function deleteProgress() {
  const response = await fetch(progressUrl, { method: "DELETE", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Could not clear progress");
}

// Submit completed answers as in Save Responses, then remove the saved draft
survey.onComplete.add(async (sender, options) => {
  if (finishing) return;
  finishing = true;
  recording = false;
  setLocked(true);
  setStatus(submittedId === null ? "Submitting onboarding..." : "Clearing saved draft...");
  options.showSaveInProgress(submittedId === null ? "Submitting onboarding..." : "Clearing saved draft...");
  try {
    if (submittedId === null) {
      sender.completedHtml = "<h3>Submitting your onboarding...</h3>";
      pendingProgress = JSON.stringify(snapshot());
      await flushProgress().catch(() => {});
      const response = await fetch("/api/responses", {
        method: "POST", headers: jsonHeaders, body: JSON.stringify({ formId, data: sender.data })
      });
      if (!response.ok) throw new Error("Submission failed");
      const { id } = await response.json();
      if (!Number.isInteger(id) || id < 1) throw new Error("Missing response ID");
      submittedId = id;
      pendingProgress = null;
      setStoredQuery({ key: formId, id });
      sender.completedHtml = `<h3>Your onboarding has been submitted.</h3><p>Response ID: ${id}</p>`;
    }
    await deleteProgress();
    setStatus("Onboarding submitted. Saved draft cleared.");
    options.showSaveSuccess();
  } catch {
    const message = submittedId === null
      ? "Couldn't submit onboarding. Please try again."
      : "Onboarding was submitted, but the saved draft couldn't be cleared. Please try again.";
    if (submittedId === null) sender.completedHtml = "<h3>Your onboarding hasn't been submitted.</h3>";
    setStatus(message);
    options.showSaveError(message);
  } finally {
    finishing = false;
    setLocked(false);
  }
});

async function reloadPage() {
  if (!ready || locked) return;
  queueProgress();
  setLocked(true);
  try {
    if (submittedId !== null) await deleteProgress();
    else await flushProgress();
    location.reload();
  } catch {
    setStatus("Couldn't finish saving. Retry before reloading.", reloadPage);
  } finally { setLocked(false); }
}
async function resetProgress() {
  if (!ready || locked) return;
  const wasRecording = recording;
  recording = false;
  setLocked(true);
  setStatus("Clearing saved progress...");
  saveProgress.cancel();
  pendingProgress = null;
  try {
    await saving?.catch(() => {});
    pendingProgress = null;
    await deleteProgress();
    submittedId = null;
    survey.notifier.active = false;
    survey.clear(true, true);
    lastSnapshot = JSON.stringify(snapshot());
    recording = true;
    setStoredQuery({ key: formId });
    setStatus("No saved progress");
  } catch {
    recording = wasRecording;
    setStatus("Couldn't clear saved progress. Your answers are still available. Retry to start over.", resetProgress);
  } finally { setLocked(false); }
}

// Demo only: save the current user's draft before changing the demo-user cookie
respondent.addEventListener("change", async (event) => {
  event.stopImmediatePropagation();
  if (!ready || locked) return;
  const user = respondent.value;
  queueProgress();
  setLocked(true);
  try {
    if (submittedId !== null) await deleteProgress();
    else await flushProgress();
    setDemoUser(user);
    location.reload();
  } catch {
    respondent.value = page.demoUser;
    showSaveError();
  } finally { setLocked(false); }
}, { capture: true });
reload.addEventListener("click", reloadPage);
startOver.addEventListener("click", resetProgress);
retry.addEventListener("click", () => { if (retryAction && !locked) retryAction(); });
setStoredQuery({ key: formId });
setLocked(false);
await restoreProgress();
