// Every error under /api is JSON { error }, also Express's own: unknown paths, wrong methods, bodies that aren't
// JSON or are too big, and exceptions. Repeated query keys never crash a handler.
import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import { aiTranslation } from "../integration/ai-translation.js";
import { startApp } from "./helpers.js";

let app;
before(async () => (app = await startApp({ AI_API_KEY: "test-key" })));
after(() => app.stop());

function assertError(r, status, message) {
  assert.equal(r.status, status, r.text);
  assert.match(r.headers.get("content-type"), /^application\/json/);
  assert.equal(typeof r.data?.error, "string", r.text);
  if (message) assert.equal(r.data.error, message);
}

test("400: invalid JSON, a text/plain body, a top-level null or string", async () => {
  assertError(await app.request("POST", "/api/responses", { json: "{not json", raw: true }), 400, "The request body is not valid JSON");
  assertError(await app.request("POST", "/api/responses", { body: "formId=contact", headers: { "Content-Type": "text/plain" } }), 400, "Expected { formId, data }");
  assertError(await app.request("POST", "/api/responses", { json: "null", raw: true }), 400, "Expected { formId, data }");
  assertError(await app.request("POST", "/api/responses", { json: '"text"', raw: true }), 400, "Expected { formId, data }");
  assertError(await app.request("POST", "/api/responses", { body: "formId=contact&data=x", headers: { "Content-Type": "application/x-www-form-urlencoded" } }), 400);
});

test("401, 403 and 422 from the examples", async () => {
  assertError(await app.request("GET", "/api/progress/onboarding", { user: null }), 401, "Sign in to load progress");
  assertError(await app.request("PUT", "/api/forms/support", { json: {}, user: "bob" }), 403, "You don't have editor rights: only editors can change forms");
  assertError(await app.request("POST", "/api/files", { body: new FormData() }), 422);
});

test("404 for an unknown /api path, 405 with Allow for a known path and another method", async () => {
  assertError(await app.request("GET", "/api/nothing-here"), 404, "Not found");
  const r = await app.request("DELETE", "/api/responses");
  assertError(r, 405, "Method not allowed");
  assert.equal(r.headers.get("allow"), "POST, GET, HEAD");
  assertError(await app.request("PATCH", "/api/forms/support"), 405);
});

test("413 for a body over 12 MB, 415 for a charset the parser can't read", async () => {
  const big = JSON.stringify({ formId: "contact", data: { a: "x".repeat(12 * 1024 * 1024) } });
  assertError(await app.request("POST", "/api/responses", { json: big, raw: true }), 413, "The request body is too large");
  assertError(await app.request("POST", "/api/responses", { json: "{}", raw: true, headers: { "Content-Type": "application/json; charset=koi8-r" } }), 415);
});

test("500 for an exception: logged with its stack, answered without it", async (t) => {
  const error = mock.method(console, "error", () => {});
  t.after(() => error.mock.restore());
  const translate = mock.method(aiTranslation, "translate", async () => {
    throw new TypeError("a bug with a secret in it");
  });
  t.after(() => translate.mock.restore());
  const r = await app.request("POST", "/api/translate", { json: { strings: ["Hi"], from: "en", to: "de" } });
  assertError(r, 500, "Internal server error");
  assert.doesNotMatch(r.text, /secret|stack|at /);
  assert.equal(error.mock.callCount(), 1);
  assert.match(String(error.mock.calls[0].arguments[0].stack), /a bug with a secret/);
});

test("429 after 20 AI calls a day in demo mode", async () => {
  const demo = await startApp({ DEMO_MODE: "true" });
  try {
    await demo.request("GET", "/demo/stored/ai-translation");   // takes demo_sid from the server
    for (let i = 0; i < 20; i++) assert.equal((await demo.request("POST", "/api/translate", { json: { strings: [] } })).status, 501);
    assertError(await demo.request("POST", "/api/translate", { json: { strings: [] } }), 429, "The demo allows 20 AI calls per visitor per day");
    assertError(await demo.request("POST", "/api/work-orders/extract", { body: new FormData() }), 429);
  } finally {
    await demo.stop();
  }
});

test("repeated query keys are arrays in Express 5: handlers treat them as missing, never 500", async () => {
  for (const path of ["/api/offices?region=europe&region=asia", "/api/customers/exists?email=a&email=b", "/api/shipping?postcode=10115&postcode=1",
    "/api/responses?formId=feedback&formId=x&limit=1&limit=2", "/api/forms/claim?record=1&record=2", "/demo/stored/save-response?id=1&id=2"]) {
    const r = await app.request("GET", path);
    assert.equal(r.status, 200, `${path}: ${r.text}`);
  }
  assert.deepEqual((await app.request("GET", "/api/offices?region=europe&region=asia")).data, []);
  assert.deepEqual((await app.request("GET", "/api/shipping?postcode=10115&postcode=1")).data, { price: null });
});

test("pages keep HTML errors", async () => {
  const r = await app.request("GET", "/examples/edit-together?form=bad%20id");
  assert.equal(r.status, 400);
  assert.match(r.headers.get("content-type"), /^text\/html/);
  assert.match(r.text, /Invalid form ID/);
  const missing = await app.request("GET", "/examples/no-such-example");
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get("content-type"), /^text\/html/);
});
