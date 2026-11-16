// Edit Forms Together: the relay behind CollaborationPlugin from survey-creator-core/collaboration.
// Wire protocol: https://github.com/surveyjs/collaborative-form-editing (PROTOCOL.md).
// relay/index.js routes /ws/forms/:formId here after its editor check; rooms live in relay/edit-room.js.
import { randomBytes } from "node:crypto";
import { EditRoom, PALETTE } from "./edit-room.js";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const parse = (raw) => {
  try {
    return JSON.parse(raw);   // records stay opaque: {} is relayed as {}
  } catch {
    return null;
  }
};
const send = (ws, message) => ws.send(JSON.stringify(message));
const displayName = (name, fallback) => [...(name ?? "").trim()].slice(0, 32).join("") || fallback;

/** The definition saved through creator-load-save, or an empty one for a new form. */
function savedDefinition(database, formId) {
  const form = database.prepare("SELECT json FROM forms WHERE key = ?").get(formId);
  return form ? JSON.parse(form.json) : {};
}

export function editRelay() {
  // #region sjs:edit-together.server
  // The same kind of relay as Fill Forms Together, keeping an append-only log instead of a value map:
  // Creator records must be replayed in order. It runs in this app's process, on its port.
  const rooms = new Map();   // room key => EditRoom { seed, log, clients }

  function connect(ws, { formId, roomKey, user, database, name }) {   // relay/index.js checked that the user may edit
    let room = rooms.get(roomKey);
    if (!room) rooms.set(roomKey, (room = new EditRoom(savedDefinition(database, formId))));   // seed = saved definition
    room.cancelDrop();                                                                         // back within 2 s: keep the room
    const client = { id: randomBytes(8).toString("hex"), name: displayName(name, user.name), slot: room.freeSlot() };
    ws.client = { ...client, state: null, roomKey };
    room.clients.add(ws);
    const { id, slot } = client;
    send(ws, { type: "init", clientId: id, colorIndex: slot, color: PALETTE[slot], seed: room.seed, log: room.log });   // first
    const peers = room.roster(ws);
    if (peers.length > 0) send(ws, { type: "presence-sync", peers });
  }

  function message(ws, raw) {
    const msg = parse(raw);
    const room = rooms.get(ws.client.roomKey);
    if (!room || !isObject(msg)) return;
    if (msg.type === "append" && msg.payload !== undefined && msg.payload !== null) {   // append, then fan out
      room.log.push(msg.payload);
      room.broadcast(ws, { type: "record", from: ws.client.id, payload: msg.payload });
    } else if (msg.type === "presence" && msg.state != null && raw.length <= 4096) {
      ws.client.state = msg.state;
      room.broadcast(ws, { type: "presence", peer: EditRoom.peer(ws) });
    }                                                                                   // unknown types: ignore
  }

  function close(ws) {
    const room = rooms.get(ws.client?.roomKey);
    if (!room) return;
    room.clients.delete(ws);
    room.broadcast(ws, { type: "presence-leave", clientId: ws.client.id });
    if (room.clients.size === 0) room.dropAfter(2000, () => rooms.delete(ws.client.roomKey));   // the log lives until then
  }
  // #endregion

  /** Demo only: the room a socket is in, for the Data panel's snapshot. */
  const roomOf = (ws) => rooms.get(ws.client?.roomKey);

  return { connect, message, close, roomOf };
}
