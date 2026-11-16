// Edit Forms Together
import { inviteLink, page, participantName, relayUrl, setStoredQuery } from "./host.js";
import { SurveyCreator, renderSurveyCreator } from "survey-creator-js";
import { CollaborationPlugin } from "survey-creator-core/collaboration";
import { createSchemaSaver, responseError } from "./schema-saver.js";

const formId = page.formId ?? "support-team";
const userName = participantName();
const editor = document.getElementById("creator");
const reconnect = document.getElementById("reconnect");
const retrySave = document.getElementById("retry-save");
const download = document.getElementById("download-local");
const formSelector = document.getElementById("shared-form");
const errorMessage = document.getElementById("creator-error");
let ws, creator, collab, saver, localCopy;
let ready = false;
setStoredQuery({ room: formId, key: formId });

function sharedFormLink() {
  const url = new URL(inviteLink());
  url.searchParams.set("form", formId);
  return url.href;
}
for (const link of document.querySelectorAll("[data-invite-link]")) link.href = sharedFormLink();
formSelector.addEventListener("change", event => {
  const url = new URL(location.href);
  url.searchParams.set("form", event.target.value || `team-${crypto.randomUUID()}`);
  location.assign(url);
});

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = !message;
}

function connected() { return ready && ws.readyState === WebSocket.OPEN; }
function send(message) { if (connected()) ws.send(JSON.stringify(message)); }

// #region sjs:edit-together.save
// Save the synchronized schema separately from the room's temporary edit log
function configureSaving() {
  saver = createSchemaSaver(() => creator.JSON, async json => {
    if (!connected()) throw new Error("Reconnect before saving the shared form.");
    const response = await fetch(`/api/forms/${formId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: json
    });
    if (!response.ok) throw await responseError(response, "Couldn't save the form schema. Please try again.");
  }, ({ state, error }) => {
    showError(state === "error" ? error : "");
    retrySave.hidden = state !== "error";
    formSelector.disabled = state === "saving";
  });
  creator.saveSurveyFunc = async (saveNo, callback) => {
    const saved = await saver.save();
    callback(saveNo, saved);
    // Creator says "not saved" in the callback; show the server's reason after it
    if (!saved) creator.notify(saver.error, "error");
  };
  creator.onModified.add(() => { if (ready && !collab.isApplying) saver.changed(); });
}
// #endregion

// #region sjs:edit-together.client
// Rebuild the shared form from its saved schema and ordered edit log
function initialize(message) {
  creator?.dispose();
  creator = new SurveyCreator({ showTranslationTab: true });
  creator.JSON = message.seed;
  collab = new CollaborationPlugin(creator, { roomId: formId, getInviteLink: sharedFormLink });
  creator.addPlugin("collaboration", collab);
  collab.setClientId(message.clientId);
  configureSaving();
  saver.markSaved();
  if (message.log.length) collab.apply(message.log);
  const append = (_, { record }) => send({ type: "append", payload: record });
  collab.onRecordAdded.add(append);
  collab.onRecordChanged.add(append);
  collab.onStateChanged.add(() => send({ type: "presence", state: collab.getState() }));
}
// #endregion

// Demo only: Show Version History lists the room's log and this window's edits, one entry per
// change: a record that updates an earlier change (same seq, op and target) replaces it
function trackHistory(log) {
  const history = new Map();
  function addHistory(records) {
    for (const record of records) history.set(`${record.seq}:${record.op}:${record.payload?.target ?? ""}`, record);
    collab.setHistory([...history.values()]);
  }
  addHistory(log);
  const local = (_, { record }) => addHistory([record]);
  collab.onRecordAdded.add(local);
  collab.onRecordChanged.add(local);
  return addHistory;
}

function connect() {
  if (ws && [WebSocket.CONNECTING, WebSocket.OPEN].includes(ws.readyState)) return;
  ready = false;
  editor.inert = true;
  reconnect.hidden = true;
  retrySave.disabled = true;
  showError("");
  collab?.setStatus("connecting");
  ws = new WebSocket(relayUrl("edit", `/ws/forms/${formId}?name=${encodeURIComponent(userName)}`));
  let addHistory;
  ws.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.type === "init") {
      initialize(message);
      addHistory = trackHistory(message.log);
      ready = true;
      saver.changed();
      if (saver.dirty) creator.setModified({ type: "COLLABORATION" });
      renderSurveyCreator(creator, editor);
      editor.hidden = false;
      editor.inert = false;
      retrySave.disabled = false;
      collab.setStatus("connected");
      send({ type: "presence", state: collab.getState() });
    } else if (ready) {
      if (message.type === "record") { collab.apply(message.payload); addHistory([message.payload]); saver.changed(); creator.setModified({ type: "COLLABORATION" }); }
      if (message.type === "presence-sync") collab.setPeers(message.peers);
      if (message.type === "presence") collab.upsertPeer(message.peer);
      if (message.type === "presence-leave") collab.removePeer(message.clientId);
    }
  });
  ws.addEventListener("close", () => {
    ready = false;
    editor.inert = true;
    retrySave.disabled = true;
    if (creator) { localCopy = structuredClone(creator.JSON); download.hidden = false; }
    collab?.clearPeers();
    collab?.setStatus("closed");
    reconnect.hidden = !page.user?.isEditor;
    showError(page.user?.isEditor
      ? "Disconnected. Reconnect to load the current shared form. Download a local copy to keep this window's edits."
      : "Editor access is required to join this session.");
  });
}
retrySave.addEventListener("click", () => creator.saveSurvey());
reconnect.addEventListener("click", connect);
download.addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(localCopy, null, 2)], { type: "application/json" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: "shared-form-local-copy.json" });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
window.addEventListener("pagehide", () => ws?.close());
connect();
