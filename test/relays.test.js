// Both relays, in this process on the app's port: init fields, saving once, late joiners, presence, refused
// connections, sandbox room keys, and frames that would stop a process that didn't guard its handlers.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { roomKey, snapshotPath } from "../relay/room-key.js";
import { socket, startApp } from "./helpers.js";

let app;
before(async () => (app = await startApp()));
after(() => app.stop());

const ws = (path) => `${app.origin.replace(/^http/, "ws")}${path}`;
const open = async (path, cookie = "demo_user=alice") => {
  const s = socket(ws(path), cookie);
  await s.opened;
  return s;
};
const refused = async (path, cookie) => {
  const s = socket(ws(path), cookie);
  const event = await s.closed;
  return s.messages.length === 0 && event.code !== 1000;
};
const sheets = () => app.db().prepare("SELECT id, data FROM responses WHERE form_id = 'job-sheet' ORDER BY id").all();

test("fill: init carries every field, seeded from the saved job sheet", async () => {
  const [sheet] = sheets();
  const a = await open(`/ws/rooms/${sheet.id}?name=${encodeURIComponent("  Dispatcher (Alice Martin) with a very long name  ")}`);
  const init = await a.next("init");
  assert.deepEqual(Object.keys(init).sort(), ["clientId", "colorIndex", "name", "peers", "responseId", "seed", "sessionId", "type", "values"]);
  assert.equal(init.name, "Dispatcher (Alice Martin) with a");
  assert.match(init.sessionId, /^[0-9a-f]{32}$/);
  assert.equal(init.responseId, null);
  assert.deepEqual(init.values, JSON.parse(sheet.data));
  assert.ok(Array.isArray(init.seed.pages ?? init.seed.elements));
  await a.close();
});

test("fill: two clients completing at once save one row; both get the same id; a late joiner gets the responseId", async () => {
  const before = sheets().length;
  const a = await open("/ws/rooms/new-room?name=Ann");
  const b = await open("/ws/rooms/new-room?name=Ben");
  const initA = await a.next("init");
  await b.next("init");
  a.send({ type: "value", key: "q1", value: "draft" });
  assert.deepEqual(await b.next("value"), { type: "value", from: initA.clientId, key: "q1", value: "draft" });
  a.send({ type: "complete", data: { q1: "done" } });
  b.send({ type: "complete", data: { q1: "done" } });
  const [ca, cb] = await Promise.all([a.next("completed"), b.next("completed")]);
  assert.equal(ca.id, cb.id);
  assert.equal(sheets().length, before + 1);
  a.send({ type: "value", key: "q1", value: "after completing" });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.ok(!b.messages.some((m) => m.type === "value"), "values after completing are ignored");
  const c = await open("/ws/rooms/new-room?name=Cat");
  const init = await c.next("init");
  assert.equal(init.responseId, ca.id);
  assert.deepEqual(init.values, { q1: "done" });
  for (const socket of [a, b, c]) await socket.close();
});

test("fill: a save that fails sends save-error to the sender only, and the room can try again", async (t) => {
  const { mock } = await import("node:test");
  const quiet = mock.method(console, "error", () => {});
  t.after(() => quiet.mock.restore());
  const a = await open("/ws/rooms/fail-room?name=Ann");
  const b = await open("/ws/rooms/fail-room?name=Ben");
  await a.next("init");
  await b.next("init");
  app.db().exec("ALTER TABLE responses RENAME TO responses_away");
  try {
    a.send({ type: "complete", data: { q1: "done" } });
    assert.deepEqual(await a.next("save-error"), { type: "save-error", error: "Couldn't save the job sheet. Please try again." });
  } finally {
    app.db().exec("ALTER TABLE responses_away RENAME TO responses");
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(!b.messages.some((m) => m.type === "save-error" || m.type === "completed"));
  a.send({ type: "complete", data: { q1: "done" } });
  assert.equal(typeof (await b.next("completed")).id, "number");
  for (const socket of [a, b]) await socket.close();
});

test("edit: init then presence-sync, records in order, presence-leave; Bob and signed-out connections are refused", async () => {
  const a = await open("/ws/forms/support-team?name=Ann");
  const initA = await a.next("init");
  assert.deepEqual(Object.keys(initA).sort(), ["clientId", "color", "colorIndex", "log", "seed", "type"]);
  assert.equal(initA.seed.title !== undefined, true);
  a.send({ type: "presence", state: { tab: "designer" } });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const b = await open("/ws/forms/support-team?name=Ben");
  assert.equal((await b.next(() => true)).type, "init");
  const sync = await b.next(() => true);
  assert.equal(sync.type, "presence-sync");
  assert.equal(sync.peers[0].clientId, initA.clientId);
  const records = [{ seq: 1, payload: {} }, { seq: 2, payload: { name: "title" } }];
  for (const record of records) a.send({ type: "append", payload: record });
  for (const record of records) assert.deepEqual((await b.next("record")).payload, record);
  await a.close();
  assert.equal((await b.next("presence-leave")).clientId, initA.clientId);
  await b.close();

  assert.ok(await refused("/ws/forms/support-team", "demo_user=bob"), "Bob (a viewer) is refused");
  assert.ok(await refused("/ws/forms/support-team", ""), "signed out is refused");
  assert.ok(await refused("/ws/rooms/1", "demo_user=none"), "signed out is refused on the fill relay too");
  assert.ok(await refused("/ws/other/1", "demo_user=alice"), "an unknown path is refused");
  assert.ok(await refused("/ws/forms/bad%20id", "demo_user=alice"), "an invalid id is refused");
});

test("malformed frames are ignored and the room keeps working", async () => {
  const a = await open("/ws/rooms/malformed?name=Ann");
  const b = await open("/ws/rooms/malformed?name=Ben");
  await a.next("init");
  await b.next("init");
  for (const frame of ["not json", "[]", "null", '"text"', '{"type":"value"}', '{"type":"complete","data":[1]}', '{"type":"presence"}', '{"type":"nonsense"}']) a.send(frame);
  a.ws.send(new Uint8Array([1, 2, 3]));
  a.send({ type: "value", key: "__proto__", value: { polluted: true } });
  a.send({ type: "value", key: "q1", value: "still here" });
  assert.equal((await b.next((m) => m.type === "value" && m.key === "q1")).value, "still here");
  assert.equal({}.polluted, undefined);
  const c = await open("/ws/rooms/malformed?name=Cat");
  const init = await c.next("init");
  assert.equal(init.values.q1, "still here");
  assert.deepEqual(init.values.__proto__, { polluted: true });
  for (const s of [a, b, c]) await s.close();
});

test("demo mode: room keys are <demo_sid>:<id>, rooms are per sandbox, snapshots are named by the key's hash", async () => {
  const demo = await startApp({ DEMO_MODE: "true" });
  try {
    await demo.request("GET", "/demo/stored/fill-together");
    const other = await startOtherVisitor(demo);
    const url = `${demo.origin.replace(/^http/, "ws")}/ws/rooms/shared-id?name=X`;
    assert.ok(await new Promise((resolve) => {
      const s = socket(url, "demo_user=alice");
      s.closed.then(() => resolve(s.messages.length === 0));
    }), "no demo_sid: refused");
    const mine = socket(url, `demo_sid=${demo.jar.sid}; demo_user=alice`);
    await mine.opened;
    await mine.next("init");
    mine.send({ type: "value", key: "q1", value: "mine" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const theirs = socket(url, `demo_sid=${other}; demo_user=alice`);
    await theirs.opened;
    assert.equal((await theirs.next("init")).values.q1, undefined);
    const path = snapshotPath(demo.config, roomKey(demo.jar.sid, "shared-id"), "fill");
    assert.ok(existsSync(path));
    assert.equal(JSON.parse(readFileSync(path, "utf8")).values.q1, "mine");
    const panel = await demo.request("GET", "/demo/stored/fill-together?room=shared-id");
    assert.equal(panel.data["relay room"].values.q1, "mine");
    await mine.close();
    await theirs.close();
  } finally {
    await demo.stop();
  }
});

/** A second visitor's demo_sid, issued by the server. */
async function startOtherVisitor(demo) {
  const r = await fetch(`${demo.origin}/demo/stored/fill-together`);
  return /demo_sid=([0-9a-f]{32})/.exec(r.headers.getSetCookie().join(";"))[1];
}
