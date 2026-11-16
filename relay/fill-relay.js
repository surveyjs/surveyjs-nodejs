// Fill Forms Together: the relay behind CollaborationPlugin from survey-core/collaboration.
// Wire protocol: https://github.com/surveyjs/collaborative-form-filling (PROTOCOL.md).
// relay/index.js routes /ws/rooms/:recordId here after its sign-in check; rooms live in relay/fill-room.js.
import { randomBytes } from "node:crypto";
import { insertResponse } from "../integration/stored-json.js";
import { FillRoom, toValues } from "./fill-room.js";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const parse = (raw) => {
  try {
    return JSON.parse(raw);   // objects stay objects: {} is relayed as {}
  } catch {
    return null;
  }
};
const send = (ws, message) => ws.send(JSON.stringify(message));
/** The display name from ?name=, trimmed to 32 characters, or the user's name. */
const displayName = (name, fallback) => [...(name ?? "").trim()].slice(0, 32).join("") || fallback;

/** The job sheet definition, and the saved answers when the record exists (otherwise a blank sheet). */
function seed(database, recordId) {
  const form = database.prepare("SELECT json FROM forms WHERE key = 'job-sheet'").get();
  const saved = database.prepare("SELECT data FROM responses WHERE form_id = 'job-sheet' AND id = ?").get(recordId);
  return [form ? JSON.parse(form.json) : {}, saved ? JSON.parse(saved.data) : {}];
}

export function fillRelay() {
  // #region sjs:fill-together.server
  // The relay runs in this app's process, on its port, and relays JSON: it never parses the definition
  const rooms = new Map();   // room key => FillRoom { seed, values, clients }

  function connect(ws, { recordId, roomKey, user, database, name }) {   // relay/index.js checked who may open it
    let room = rooms.get(roomKey);
    if (!room) rooms.set(roomKey, (room = new FillRoom(...seed(database, recordId))));   // the definition + saved answers
    room.cancelDrop();                                                                    // back within 2 s: keep the room
    const client = { id: randomBytes(8).toString("hex"), name: displayName(name, user.name), slot: room.freeSlot() };
    ws.client = { ...client, state: null, roomKey, database };
    room.clients.add(ws);
    send(ws, {
      type: "init", clientId: client.id, name: client.name, colorIndex: FillRoom.colorIndex(client.slot), seed: room.seed,
      values: room.values, peers: room.roster(ws), sessionId: room.sessionId, responseId: room.responseId,
    });
  }

  function message(ws, raw) {
    const msg = parse(raw);
    const room = rooms.get(ws.client.roomKey);
    if (!room || !isObject(msg)) return;
    if (msg.type === "complete" && isObject(msg.data)) {
      complete(ws, room, msg.data);
    } else if (msg.type === "value" && typeof msg.key === "string" && room.responseId === null) {   // last write wins
      room.values[msg.key] = msg.value ?? null;
      room.broadcast(ws, { type: "value", from: ws.client.id, key: msg.key, value: msg.value ?? null });
    } else if (msg.type === "presence" && msg.state != null && raw.length <= 4096) {   // stamp identity, relay
      const retain = msg.retain !== false;
      if (retain) ws.client.state = msg.state;
      room.broadcast(ws, { type: "peer", retain, peer: FillRoom.peer(ws, msg.state) }, { droppable: !retain });
    }                                                                                   // unknown types: ignore
  }

  function close(ws) {
    const room = rooms.get(ws.client?.roomKey);
    if (!room) return;
    room.clients.delete(ws);
    room.broadcast(ws, { type: "peer-left", clientId: ws.client.id });
    if (room.clients.size === 0) room.dropAfter(2000, () => rooms.delete(ws.client.roomKey));   // 2 s after the last leaves
  }
  // #endregion

  // #region sjs:fill-together.complete
  // Save once per room session and send the same confirmation to every participant
  function complete(ws, room, data) {
    try {
      if (room.responseId === null) {
        room.responseId = insertResponse(ws.client.database, "job-sheet", data);   // as save-response stores it
        room.values = toValues(data);
      }
      for (const client of room.clients) send(client, { type: "completed", id: room.responseId, data: room.values });
    } catch (error) {
      console.error("fill-together: couldn't save the job sheet", error);
      send(ws, { type: "save-error", error: "Couldn't save the job sheet. Please try again." });
    }
  }
  // #endregion

  /** Demo only: the room a socket is in, for the Data panel's snapshot. */
  const roomOf = (ws) => rooms.get(ws.client?.roomKey);

  return { connect, message, close, roomOf };
}
