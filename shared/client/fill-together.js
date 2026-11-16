// Fill Forms Together
import { inviteLink, mountSurvey, note, page, relayUrl, setStoredQuery, show } from "./host.js";
import { Model } from "survey-core";
import { CollaborationPlugin } from "survey-core/collaboration";

const params = new URLSearchParams(location.search);
const recordId = params.get("record") ?? String(page.record ?? "new");
const role = params.get("role") === "technician" ? "Technician" : "Dispatcher";
const userName = `${role} (${page.user?.name ?? "Guest"})`;
let ws, survey, collab, sessionId, saveOptions, completionOptions;
let responseId = null;
let ready = false;
const reconnect = document.getElementById("reconnect");
const form = document.getElementById("form");

function partnerLink() {
  const url = new URL(inviteLink());
  url.searchParams.set("record", recordId);
  url.searchParams.set("role", role === "Dispatcher" ? "technician" : "dispatcher");
  return url.href;
}
for (const link of document.querySelectorAll("[data-invite-link]")) {
  link.href = partnerLink();
}
document.getElementById("participant-role").value = role.toLowerCase();
setStoredQuery({ room: recordId });

function setLocked(locked) {
  form.inert = locked;
  form.setAttribute("aria-busy", String(locked));
  for (const id of ["record", "participant-role"]) document.getElementById(id).disabled = locked;
}
function status(message, error = false) {
  show("connection-status", message);
  reconnect.hidden = !error;
  reconnect.disabled = false;
}
function confirmCompletion(id, data) {
  if (!Number.isInteger(id) || id < 1 || !survey) return;
  responseId = id;
  saveOptions = null;
  survey.data = data;
  if (survey.state !== "completed") survey.doComplete();
  else {
    survey.completedHtml = `<h3>The job sheet has been saved.</h3><p>Response ID: ${id}</p>`;
    completionOptions?.showSaveSuccess();
  }
  setLocked(false);
  setStoredQuery({ room: recordId, id });
  status(`Job sheet saved as response #${id}. Everyone in this session sees the same confirmation.`);
}

// #region sjs:fill-together.save
// Ask the relay to save once and confirm the result to every participant
function completeJobSheet(sender, options) {
  completionOptions = options;
  if (responseId !== null) {
    sender.completedHtml = `<h3>The job sheet has been saved.</h3><p>Response ID: ${responseId}</p>`;
    return options.showSaveSuccess();
  }
  if (!ready || ws.readyState !== WebSocket.OPEN) {
    sender.completedHtml = "<h3>The job sheet hasn't been saved.</h3>";
    return options.showSaveError("Reconnect to the shared session, then try again.");
  }
  sender.completedHtml = "<h3>Saving the job sheet...</h3>";
  options.showSaveInProgress();
  saveOptions = options;
  setLocked(true);
  ws.send(JSON.stringify({ type: "complete", data: sender.data }));
}
// #endregion

// #region sjs:fill-together.client
// Transport the plugin's answer and presence messages over a WebSocket
function applySharedState(message) {
  const draft = survey?.data;
  const previousSession = sessionId;
  if (!collab) {
    survey = new Model(message.seed);
    survey.completeText = "Finish job sheet";
    collab = new CollaborationPlugin(survey, { getInviteLink: partnerLink });
    collab.onEvent.add((_, { message }) => {
      if (ready && responseId === null && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    });
    survey.onComplete.add(completeJobSheet);
    mountSurvey(survey);
  }
  sessionId = message.sessionId;
  ready = true;
  collab.apply(message);
  // Restore the local draft if an empty session replaces the disconnected one
  if (previousSession && previousSession !== sessionId && !message.responseId && !message.peers.length) survey.data = draft;
  form.hidden = false;
  document.getElementById("collaboration-loading").hidden = true;
  setLocked(false);
  if (message.responseId) confirmCompletion(message.responseId, message.values);
}
// #endregion

function connect() {
  if (ws && [WebSocket.CONNECTING, WebSocket.OPEN].includes(ws.readyState)) return;
  ready = false;
  setLocked(true);
  status("Connecting to the shared job sheet...");
  reconnect.disabled = true;
  collab?.apply({ type: "status", status: "connecting" });
  ws = new WebSocket(relayUrl("fill", `/ws/rooms/${encodeURIComponent(recordId)}?name=${encodeURIComponent(userName)}`));
  ws.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.type === "init") {
      applySharedState(message);
      if (!responseId) status(`Connected as ${role}. Answers are shared live until someone finishes the job sheet.`);
    } else if (message.type === "completed") {
      confirmCompletion(message.id, message.data);
    } else if (message.type === "save-error") {
      survey.completedHtml = "<h3>The job sheet hasn't been saved.</h3>";
      saveOptions?.showSaveError(message.error);
      saveOptions = null;
      setLocked(false);
      status(message.error);
    } else collab?.apply(message);
  });
  ws.addEventListener("close", () => {
    ready = false;
    if (responseId) return;
    setLocked(true);
    collab?.apply({ type: "status", status: "closed" });
    if (saveOptions) {
      survey.completedHtml = "<h3>The job sheet hasn't been saved.</h3>";
      saveOptions.showSaveError("The connection was lost. Reconnect, then try again.");
      saveOptions = null;
    }
    status("Couldn't connect to the shared session. Check that the collaboration relay is running, then reconnect.", true);
    note("Collaboration disconnected. Reconnect to continue.", "error");
  });
}
reconnect.addEventListener("click", connect);
document.getElementById("participant-role").addEventListener("change", event => {
  const url = new URL(location.href);
  url.searchParams.set("role", event.target.value);
  location.assign(url);
});
document.getElementById("record").addEventListener("change", event => {
  const url = new URL(location.href);
  url.searchParams.set("record", event.target.value || `new-${crypto.randomUUID()}`);
  location.assign(url);
});
connect();
