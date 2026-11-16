// JSON is stored exactly as it arrives: the round-trip document (and a "__proto__" key) through every storing
// endpoint, read back from SQLite itself, not through the app.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ROUNDTRIP, socket, startApp } from "./helpers.js";

let app;
before(async () => (app = await startApp()));
after(() => app.stop());

const row = (sql, ...params) => ({ ...app.db().prepare(sql).get(...params) });   // node:sqlite rows have no prototype

test("save-response stores the round-trip document as it arrived, with an ISO 8601 UTC time without milliseconds", async () => {
  const r = await app.request("POST", "/api/responses", { json: { formId: "contact", data: ROUNDTRIP } });
  assert.equal(r.status, 201);
  const stored = row("SELECT data, created_at FROM responses WHERE id = ?", r.data.id);
  assert.deepEqual(JSON.parse(stored.data), ROUNDTRIP);
  assert.match(stored.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.match(row("SELECT created_at FROM responses WHERE form_id = 'feedback'").created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test('a "__proto__" key is stored as a key, not lost as a prototype', async () => {
  const body = '{"formId":"contact","data":{"__proto__":{"polluted":true},"constructor":{"prototype":1},"a":1}}';
  const r = await app.request("POST", "/api/responses", { json: body, raw: true });
  assert.equal(r.status, 201);
  const stored = row("SELECT data FROM responses WHERE id = ?", r.data.id).data;
  assert.equal(stored, '{"__proto__":{"polluted":true},"constructor":{"prototype":1},"a":1}');
  assert.equal({}.polluted, undefined);
});

test("1.0 becomes 1: JavaScript has one number type (README: Storing JSON exactly as it arrives)", async () => {
  const r = await app.request("POST", "/api/responses", { json: '{"formId":"contact","data":{"n":1.0,"m":1.5}}', raw: true });
  assert.equal(row("SELECT data FROM responses WHERE id = ?", r.data.id).data, '{"n":1,"m":1.5}');
});

test("resume-progress, relational-storage, creator-load-save and variable-presets keep the document", async () => {
  const progress = { data: ROUNDTRIP, uiState: { currentPageName: "page2" } };
  assert.equal((await app.request("PUT", "/api/progress/onboarding", { json: progress })).status, 204);
  assert.deepEqual(JSON.parse(row("SELECT json FROM progress WHERE key = '1:onboarding'").json), progress);

  const claim = { ...ROUNDTRIP, customer_email: "x@example.com", amount: 10 };
  const c = await app.request("POST", "/api/claims", { json: { data: claim, definitionVersion: "v1" } });
  assert.equal(c.status, 201);
  assert.deepEqual(JSON.parse(row("SELECT data FROM responses WHERE id = ?", c.data.id).data), claim);
  assert.deepEqual(row("SELECT customer_email, amount FROM claims WHERE response_id = ?", c.data.id), { customer_email: "x@example.com", amount: 10 });

  assert.equal((await app.request("PUT", "/api/forms/roundtrip", { json: ROUNDTRIP })).status, 204);
  assert.deepEqual(JSON.parse(row("SELECT json FROM forms WHERE key = 'roundtrip'").json), ROUNDTRIP);

  assert.equal((await app.request("PUT", "/api/variable-presets/roundtrip", { json: [ROUNDTRIP] })).status, 204);
  assert.deepEqual(JSON.parse(row("SELECT json FROM variable_presets WHERE key = 'roundtrip'").json), [ROUNDTRIP]);
});

test("the dashboard returns stored documents as stored, and a definition comes back as .definition", async () => {
  await app.request("POST", "/api/responses", { json: { formId: "roundtrip-dashboard", data: ROUNDTRIP } });
  const r = await app.request("GET", "/api/responses?formId=roundtrip-dashboard");
  assert.equal(r.text, JSON.stringify([ROUNDTRIP]));
  await app.request("PUT", "/api/forms/roundtrip-definition", { json: ROUNDTRIP });
  assert.deepEqual((await app.request("GET", "/api/forms/roundtrip-definition")).data.definition, ROUNDTRIP);
});

test("fill-together's complete stores the job sheet as it arrived", async () => {
  const room = socket(`${app.origin.replace("http", "ws")}/ws/rooms/roundtrip?name=Ann`, "demo_user=alice");
  await room.opened;
  await room.next("init");
  room.send({ type: "complete", data: ROUNDTRIP });
  const completed = await room.next("completed");
  assert.deepEqual(JSON.parse(row("SELECT data FROM responses WHERE id = ?", completed.id).data), ROUNDTRIP);
  assert.equal(row("SELECT form_id FROM responses WHERE id = ?", completed.id).form_id, "job-sheet");
  await room.close();
});
