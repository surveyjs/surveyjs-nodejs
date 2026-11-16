// One fill-together room: the definition it hands out, the latest value of every answer and the people in it.
// Each socket keeps its own id, name, colour and presence in ws.client.
import { randomBytes } from "node:crypto";

/** A JSON object with no prototype: an answer keyed "__proto__" is just a key here. */
export const toValues = (object) => Object.assign(Object.create(null), object);

export class FillRoom {
  /** question key => latest value; last write wins */
  values;
  /** @type {Set<import("ws").WebSocket>} */
  clients = new Set();
  /** the response saved in this room session, once someone completes */
  responseId = null;
  /** 32 random hex characters per room instance */
  sessionId = randomBytes(16).toString("hex");
  #dropTimer = null;

  constructor(seed, values = {}) {
    this.seed = seed;
    this.values = toValues(values);
  }

  /** The lowest colour slot nobody in the room holds, from 1. */
  freeSlot() {
    const taken = new Set([...this.clients].map((ws) => ws.client.slot));
    let slot = 1;
    while (taken.has(slot)) slot++;
    return slot;
  }

  /** Shown as 1..9 (0 means "unknown"). */
  static colorIndex(slot) {
    return 1 + ((slot - 1) % 9);
  }

  /** Everyone else who has shared a retained presence: { clientId, name, colorIndex, state }. */
  roster(except) {
    return [...this.clients].filter((ws) => ws !== except && ws.client.state !== null).map((ws) => FillRoom.peer(ws, ws.client.state));
  }

  static peer(ws, state) {
    return { clientId: ws.client.id, name: ws.client.name, colorIndex: FillRoom.colorIndex(ws.client.slot), state };
  }

  /**
   * Send to everyone in the room except the sender: nobody gets their own echo. ws sends the messages to one socket
   * one at a time, in the order of send(), so no queue of our own is needed. A non-retained presence update (a cursor
   * move) may be dropped for a peer that is falling behind.
   */
  broadcast(from, message, { droppable = false } = {}) {
    const json = JSON.stringify(message);
    for (const ws of this.clients) {
      if (ws !== from && !(droppable && ws.bufferedAmount > 64 * 1024)) ws.send(json);
    }
  }

  /** Drop the room after ms unless someone joins first. */
  dropAfter(ms, drop) {
    this.#dropTimer = setTimeout(() => this.clients.size === 0 && drop(), ms);
  }

  /** Someone joined an emptied room before it was dropped: keep it. */
  cancelDrop() {
    clearTimeout(this.#dropTimer);
    this.#dropTimer = null;
  }
}
