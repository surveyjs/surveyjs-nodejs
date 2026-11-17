#!/usr/bin/env node
// Contract test for server-integration-v4: calls every endpoint of the Server Integration page
// and checks the documented shape. Zero dependencies, Node 22+. The same file in every platform repo.
//
//   BASE_URL=http://127.0.0.1:8000 node shared/contract-tests/run.mjs [--steps save-response,choices-from-web]
//
// Options (environment):
//   BASE_URL             the app (default http://127.0.0.1:8000)
//   SERVICE=off|on|in-process
//                        off: the SurveyJS service isn't running, so its examples expect 503 "not running"
//                        on: the app calls the SurveyJS service (php, aspnet, python): real answers, the status mapping's texts
//                        in-process: the SurveyJS libraries run in the app (nodejs, nextjs): the same checks as on, with the in-process mapping's texts
//   AI=off|stub          ai-translation and extract-from-paper: off expects 501 / 503, stub expects ai-stub.mjs answers
//   AI_BASE_URL          with AI=stub, the app's translation endpoint (http://127.0.0.1:3020/v1): its origin is the
//                        stub, whose GET /requests counts the provider calls
//   VALIDATE_RESPONSES   true when the app runs validate-response in place of save-response
//   LINT_DEFINITIONS     true when the app runs lint-definition in place of the creator-load-save PUT
//   DEMO_MODE            true when the app and relays run visitor sandboxes
//   RELAY_URL            ws://… of the fill-together relay (enables its checks)
//   EDIT_RELAY_URL       ws://… of the edit-together relay (enables its checks)
//
// Step checks read back through GET /demo/stored/:slug. Cross-step checks run only when every
// step they involve is selected. One line per check; the exit code is non-zero on any failure.
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isDeepStrictEqual } from "node:util";

const BASE_URL = (process.env.BASE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const SERVICE = process.env.SERVICE || "off";
if (!["off", "on", "in-process"].includes(SERVICE)) { console.error(`Unknown SERVICE=${SERVICE} (expected off, on or in-process)`); process.exit(2); }
const LIVE = SERVICE !== "off";           // on and in-process run the same checks; only TEXTS differ
const AI = process.env.AI === "stub" ? "stub" : "off";
const AI_STUB_URL = new URL(process.env.AI_BASE_URL || "http://127.0.0.1:3020").origin;
const flag = (name) => /^(1|true|on|yes)$/i.test(process.env[name] ?? "");
const VALIDATE = flag("VALIDATE_RESPONSES");
const LINT = flag("LINT_DEFINITIONS");
const DEMO = flag("DEMO_MODE");
const RELAY_URL = process.env.RELAY_URL?.replace(/\/$/, "");
const EDIT_RELAY_URL = process.env.EDIT_RELAY_URL?.replace(/\/$/, "");

// The answers that differ between the service mapping (on) and the in-process mapping. The same table is in
// the smoke test (shared/smoke/run.mjs): the two scripts don't import each other, so keep them in step.
const TEXTS = {
  on: { noAiProvider: "The SurveyJS service has no AI provider configured" },
  "in-process": { noAiProvider: "No AI provider is configured for document extraction" },
};

const ALL_STEPS = ["save-response", "load-definition-variables-data", "resume-progress", "store-files", "choices-from-web", "async-functions", "relational-storage", "fill-together", "dashboard", "creator-load-save", "creator-uploads", "ai-translation", "variable-presets", "edit-together", "validate-response", "lint-definition", "server-pdf", "extract-from-paper"];

const stepsArg = process.argv.slice(2).join(" ").match(/--steps[= ]([^\s]+)/)?.[1];
const SELECTED = new Set(stepsArg ? stepsArg.split(",").map((s) => s.trim()).filter(Boolean) : ALL_STEPS);
for (const s of SELECTED) if (!ALL_STEPS.includes(s)) { console.error(`Unknown step ${s}`); process.exit(2); }

const shared = new URL("../", import.meta.url);
const readShared = (path) => readFileSync(new URL(path, shared));
const ROUNDTRIP = { a: "  padded  ", b: "", c: null, d: {}, e: [{}], f: [], g: 1.5, h: "naïve — 東京", i: { j: { k: [1, "x", true] } } };
const unique = (prefix) => `${prefix}-${randomBytes(4).toString("hex")}`;

// ------------------------------------------------------------------------------------------------
// HTTP with a cookie jar: demo_sid comes from the server (never invented), demo_user is set here

class Jar {
  sid = null;
  absorb(response) {
    for (const line of response.headers.getSetCookie?.() ?? []) {
      const m = /^demo_sid=([^;]*)/.exec(line);
      if (m) this.sid = m[1] || null;
    }
  }
  header(user) {
    const parts = [];
    if (this.sid) parts.push(`demo_sid=${this.sid}`);
    if (user) parts.push(`demo_user=${user}`);
    return parts.join("; ");
  }
}
const jar = new Jar();

async function http(method, path, { body, json, user = "alice", headers = {}, jar: j = jar } = {}) {
  const init = { method, headers: { ...headers }, redirect: "manual" };
  const cookie = j.header(user);
  if (cookie) init.headers.Cookie = cookie;
  if (json !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = typeof json === "string" ? json : JSON.stringify(json);
  } else if (body !== undefined) {
    init.body = body;
  }
  const response = await fetch(BASE_URL + path, init);
  j.absorb(response);
  const bytes = Buffer.from(await response.arrayBuffer());
  const type = response.headers.get("content-type") ?? "";
  let data;
  if (type.includes("json") && bytes.length) {
    try { data = JSON.parse(bytes.toString("utf8")); } catch { data = undefined; }
  }
  return { status: response.status, headers: response.headers, bytes, data, text: () => bytes.toString("utf8") };
}

// The path is sent as written: fetch() would resolve "/shared/../.env" to "/.env" before sending it
function rawGet(path) {
  const url = new URL(BASE_URL);
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request({ host: url.hostname, port: url.port, path, headers: { Cookie: jar.header("alice") } }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end();
  });
}

const stored = async (slug, query = {}) => {
  const r = await http("GET", `/demo/stored/${slug}?${new URLSearchParams(query)}`);
  expect(r.status === 200, `GET /demo/stored/${slug} answered ${r.status}`);
  return r.data;
};
const rowCounts = async () => (await stored("extract-from-paper"))["row counts"];

// ------------------------------------------------------------------------------------------------
// Checks

class Failure extends Error {}
function expect(condition, message) { if (!condition) throw new Failure(message); }
function expectStatus(r, status, what) {
  const statuses = [].concat(status);
  expect(statuses.includes(r.status), `${what}: expected ${statuses.join(" or ")}, got ${r.status} ${r.text().slice(0, 300)}`);
}
function expectError(r, status, what, message) {
  expectStatus(r, status, what);
  expect(r.data && typeof r.data.error === "string", `${what}: expected { error }, got ${r.text().slice(0, 200)}`);
  if (message) expect(r.data.error.includes(message), `${what}: expected error "${message}", got "${r.data.error}"`);
}
function expectEqual(actual, expected, what) {
  expect(isDeepStrictEqual(actual, expected), `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const directives = (value) => (value ?? "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean).sort();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const checks = [];
const check = (name, steps, fn, { skip } = {}) => checks.push({ name, steps: [].concat(steps), fn, skip });

// ---------- save-response
check("save-response POST /api/responses stores the JSON exactly as it arrives", "save-response", async () => {
  const r = await http("POST", "/api/responses", { json: { formId: "contract", data: ROUNDTRIP } });
  expectStatus(r, 201, "POST /api/responses");
  expect(Number.isInteger(r.data?.id), `expected { id: number }, got ${r.text()}`);
  const s = await stored("save-response", { id: r.data.id });
  expectEqual(s.responses?.[0]?.data, ROUNDTRIP, "stored data");
}, { skip: VALIDATE && "VALIDATE_RESPONSES replaces save-response with validate-response" });

check("save-response bad JSON answers 400 { error }", "save-response", async () => {
  expectError(await http("POST", "/api/responses", { json: "{not json" }), 400, "POST /api/responses with bad JSON");
});

// ---------- load-definition-variables-data
check("load-definition-variables-data GET /api/forms/:id returns { definition, variables, data }", "load-definition-variables-data", async () => {
  const r = await http("GET", "/api/forms/claim");
  expectStatus(r, 200, "GET /api/forms/claim");
  expect(isObject(r.data?.definition) && Array.isArray(r.data.definition.elements ?? r.data.definition.pages), "definition is a survey JSON object");
  expect(typeof r.data.variables?.user?.name === "string", "variables.user.name is a string");
  expectEqual(r.data.variables.user.plan, "premium", "Alice's variables.user.plan");
  expect(isObject(r.data.data) && Object.keys(r.data.data).length === 0, `data is {} without a record, got ${JSON.stringify(r.data.data)}`);
  const bob = await http("GET", "/api/forms/claim", { user: "bob" });
  expectEqual(bob.data?.variables?.user?.plan, "basic", "Bob's variables.user.plan");
});

check("load-definition-variables-data ?record= returns the stored response as data", "load-definition-variables-data", async () => {
  const s = await stored("load-definition-variables-data");
  const row = s.responses?.[0];
  expect(row && Number.isInteger(row.id), "the stored panel lists a claim response");
  const r = await http("GET", `/api/forms/claim?record=${row.id}`);
  expectStatus(r, 200, "GET /api/forms/claim?record=");
  expectEqual(r.data?.data, row.data, "data for the record");
});

check("load-definition-variables-data an unknown form answers 404 { error }", "load-definition-variables-data", async () => {
  expectError(await http("GET", `/api/forms/${unique("missing")}`), 404, "GET /api/forms/<unknown>");
});

check("load-definition-variables-data GET /claim embeds window.FORM_DEFINITION and window.FORM_VARIABLES", "load-definition-variables-data", async () => {
  const r = await http("GET", "/claim");
  expectStatus(r, 200, "GET /claim");
  expect((r.headers.get("content-type") ?? "").startsWith("text/html"), `Content-Type ${r.headers.get("content-type")}`);
  for (const name of ["window.FORM_DEFINITION", "window.FORM_VARIABLES"]) expect(r.text().includes(name), `the page sets ${name}`);
});

check("load-definition-variables-data claim-request: the title uses the variables, another user's record gives data {}", "load-definition-variables-data", async () => {
  const r = await http("GET", "/api/forms/claim-request");
  expectStatus(r, 200, "GET /api/forms/claim-request");
  expectEqual(r.data?.definition?.title, "Insurance claim for {user.name} ({user.plan} plan)", "definition.title");
  const row = (await stored("load-definition-variables-data")).responses?.[0];   // Alice's claims only
  expect(row && Number.isInteger(row.id) && row.data?.customer_email === "alice@example.com", "the stored panel lists one of Alice's claims");
  expectEqual((await http("GET", `/api/forms/claim-request?record=${row.id}`)).data?.data, row.data, "Alice asking for her record");
  const bob = await http("GET", `/api/forms/claim-request?record=${row.id}`, { user: "bob" });
  expectStatus(bob, 200, "Bob asking for Alice's record");
  expectEqual(bob.data?.data, {}, "Bob asking for Alice's record");
});

// ---------- resume-progress
check("resume-progress: null before saving, stored as-is, the same document on GET, null after deletion", "resume-progress", async () => {
  const key = unique("contract");
  const empty = await http("GET", `/api/progress/${key}`);
  expectStatus(empty, 200, "GET /api/progress before any PUT");
  expectEqual(empty.data, null, "no saved progress");
  const doc = { data: ROUNDTRIP, uiState: { currentPageName: "page2", activeElementName: "q1" } };
  expectStatus(await http("PUT", `/api/progress/${key}`, { json: doc }), 204, "PUT /api/progress");
  const s = await stored("resume-progress", { key });
  expectEqual(s.progress?.json, doc, "stored progress");
  const r = await http("GET", `/api/progress/${key}`);
  expectStatus(r, 200, "GET /api/progress");
  expectEqual(r.data, doc, "GET /api/progress after PUT");
  expectStatus(await http("DELETE", `/api/progress/${key}`), 204, "DELETE /api/progress");
  const cleared = await http("GET", `/api/progress/${key}`);
  expectStatus(cleared, 200, "GET /api/progress after DELETE");
  expectEqual(cleared.data, null, "cleared progress");
});

check("resume-progress: 401 signed out, one draft per user, DELETE clears only the caller's", "resume-progress", async () => {
  const path = `/api/progress/${unique("contract")}`;
  const doc = (who) => ({ data: { who }, uiState: { currentPageName: "page1" } });
  expectError(await http("GET", path, { user: null }), 401, "GET signed out", "Sign in to load progress");
  expectError(await http("PUT", path, { user: null, json: doc("nobody") }), 401, "PUT signed out", "Sign in to save progress");
  expectError(await http("DELETE", path, { user: null }), 401, "DELETE signed out", "Sign in to clear progress");
  expectStatus(await http("PUT", path, { json: doc("alice") }), 204, "PUT as Alice");
  expectEqual((await http("GET", path, { user: "bob" })).data, null, "Bob's draft before he saves one");
  expectStatus(await http("PUT", path, { json: doc("bob"), user: "bob" }), 204, "PUT as Bob");
  expectEqual((await http("GET", path)).data, doc("alice"), "Alice's draft after Bob saved his");
  expectEqual((await http("GET", path, { user: "bob" })).data, doc("bob"), "Bob's draft");
  expectStatus(await http("DELETE", path, { user: "bob" }), 204, "DELETE as Bob");
  expectEqual((await http("GET", path, { user: "bob" })).data, null, "Bob's draft after his DELETE");
  expectEqual((await http("GET", path)).data, doc("alice"), "Alice's draft after Bob's DELETE");
  expectStatus(await http("DELETE", path), 204, "DELETE as Alice");
});

// ---------- store-files
check("store-files upload two files, download the same bytes and Content-Type", "store-files", async () => {
  const one = Buffer.from("%PDF-1.4\n% Demo receipt\n%%EOF\n");
  const two = readShared("samples/work-order-scan.png");
  const form = new FormData();
  form.append("files[]", new Blob([one], { type: "application/pdf" }), "one.pdf");
  form.append("files[]", new Blob([two], { type: "image/png" }), "two.png");
  const r = await http("POST", "/api/files", { body: form });
  expectStatus(r, 200, "POST /api/files");
  expect(Array.isArray(r.data) && r.data.length === 2 && r.data.every((id) => typeof id === "string" && id), `expected two ids, got ${r.text()}`);
  for (const [id, bytes, type] of [[r.data[0], one, "application/pdf"], [r.data[1], two, "image/png"]]) {
    const d = await http("GET", `/api/files/${encodeURIComponent(id)}`);
    expectStatus(d, 200, "GET /api/files/:id");
    expect(d.bytes.equals(bytes), "downloaded bytes equal the upload");
    expect((d.headers.get("content-type") ?? "").startsWith(type), `Content-Type ${d.headers.get("content-type")} for ${type}`);
  }
  const s = await stored("store-files");
  expect(JSON.stringify(s).includes(r.data[0]), "the stored panel lists the uploaded file");
  expectError(await http("GET", `/api/files/${encodeURIComponent(r.data[0])}`, { user: null }), 404, "GET /api/files/:id signed out");
  expectError(await http("GET", `/api/files/${unique("missing")}`), 404, "GET /api/files/<unknown>");
});

check("store-files: a batch with an HTML file or a file over 5 MB is refused and nothing is stored; downloads are nosniff and sandboxed", "store-files", async () => {
  const png = readShared("samples/work-order-scan.png");
  const html = Buffer.from("<!DOCTYPE html>\n<html><head><title>Not an image</title></head><body><script>alert(1)</script></body></html>\n");
  const big = Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024 + 1 - png.length)]);   // PNG bytes first, so only the size is wrong
  const before = (await stored("store-files")).files;
  for (const [what, file, type, name, status] of [
    ["an HTML file after a PNG", html, "text/html", "page.html", 422],
    ["a PNG over 5 MB after a PNG", big, "image/png", "big.png", DEMO ? 413 : 422],   // demo mode caps every upload first
  ]) {
    const form = new FormData();
    form.append("files[]", new Blob([png], { type: "image/png" }), "ok.png");
    form.append("files[]", new Blob([file], { type }), name);
    expectError(await http("POST", "/api/files", { body: form }), status, what);
    expectEqual((await stored("store-files")).files, before, `stored files after ${what}`);
  }
  const form = new FormData();
  form.append("files[]", new Blob([png], { type: "image/png" }), "scan.png");
  const [id] = (await http("POST", "/api/files", { body: form })).data ?? [];
  expect(typeof id === "string", "POST /api/files returned an id");
  const d = await http("GET", `/api/files/${encodeURIComponent(id)}`);
  expectStatus(d, 200, "GET /api/files/:id");
  expectEqual(d.headers.get("x-content-type-options"), "nosniff", "X-Content-Type-Options");
  expect(/(^|;)\s*sandbox\s*(;|$)/i.test(d.headers.get("content-security-policy") ?? ""),`Content-Security-Policy: ${d.headers.get("content-security-policy")}`);
});

// ---------- choices-from-web
check("choices-from-web GET /api/offices?region= returns [{ id, name }] ordered by name", "choices-from-web", async () => {
  const r = await http("GET", "/api/offices?region=europe");
  expectStatus(r, 200, "GET /api/offices");
  expect(Array.isArray(r.data) && r.data.length > 0 && r.data.every((o) => "id" in o && typeof o.name === "string"), `expected [{ id, name }], got ${r.text()}`);
  const names = r.data.map((o) => o.name);
  expectEqual(names, [...names].sort((a, b) => a.localeCompare(b)), "office names in order");
  const none = await http("GET", "/api/offices?region=nowhere");
  expectEqual(none.data, [], "offices of an unknown region");
});

check("choices-from-web GET /api/countries returns at least 100 { code, name }, cached for a day", "choices-from-web", async () => {
  const r = await http("GET", "/api/countries");
  expectStatus(r, 200, "GET /api/countries");
  expect(Array.isArray(r.data) && r.data.length >= 100, `expected at least 100 countries, got ${r.data?.length}`);
  expect(r.data.every((c) => typeof c.code === "string" && typeof c.name === "string"), "every country has code and name");
  expect(/max-age=86400/.test(r.headers.get("cache-control") ?? ""), `Cache-Control: ${r.headers.get("cache-control")}`);
});

// ---------- async-functions
check("async-functions GET /api/customers/exists trims and lower-cases the email", "async-functions", async () => {
  expectEqual((await http("GET", "/api/customers/exists?email=taken%40example.com")).data, { exists: true }, "seeded email");
  expectEqual((await http("GET", `/api/customers/exists?email=${encodeURIComponent("  Taken@Example.COM ")}`)).data, { exists: true }, "seeded email, padded and upper-case");
  expectEqual((await http("GET", `/api/customers/exists?email=${unique("new")}%40example.com`)).data, { exists: false }, "unknown email");
});

check("async-functions GET /api/shipping uses the longest matching postcode prefix, null when none matches or the postcode is malformed", "async-functions", async () => {
  for (const [postcode, price] of [["10115", 4.9], ["10999", 3.5], ["80331", 5.9], ["SW1A 1AA", 9.5], ["99999", null], ["111111111111", null], ["1", null], ["SW1", null]]) {
    const r = await http("GET", `/api/shipping?postcode=${encodeURIComponent(postcode)}`);
    expectStatus(r, 200, "GET /api/shipping");
    expect(price === null ? r.data?.price === null : Math.abs(Number(r.data?.price) - price) < 1e-9, `price for ${postcode}: expected ${price}, got ${r.text()}`);
  }
});

// ---------- relational-storage
check("relational-storage POST /api/claims keeps the JSON and the version, and fills the columns", "relational-storage", async () => {
  const data = { ...ROUNDTRIP, customer_email: "contract@example.com", amount: 1840.5, incident: "theft" };
  const r = await http("POST", "/api/claims", { json: { data, definitionVersion: "v2" } });
  expectStatus(r, 201, "POST /api/claims");
  expect(Number.isInteger(r.data?.id), `expected { id }, got ${r.text()}`);
  const s = await stored("relational-storage", { id: r.data.id });
  expectEqual(s.responses?.[0]?.data, data, "stored claim response");
  expectEqual(s.responses?.[0]?.definition_version, "v2", "definition_version");
  expectEqual(s.responses?.[0]?.form_id, "claim", "form_id");
  expectEqual(s.claims?.[0]?.customer_email, "contract@example.com", "claims.customer_email");
  expect(Number(s.claims?.[0]?.amount) === 1840.5, `claims.amount: ${s.claims?.[0]?.amount}`);
});

// ---------- dashboard
check("dashboard GET /api/responses returns the stored documents, filtered and paged", "dashboard", async () => {
  const all = await http("GET", "/api/responses?formId=feedback");
  expectStatus(all, 200, "GET /api/responses");
  expect(Array.isArray(all.data) && all.data.length >= 150 && all.data.every(isObject), `expected the seeded feedback responses, got ${all.data?.length}`);
  expectEqual((await http("GET", "/api/responses?formId=feedback&from=2999-01-01")).data, [], "from in the future");
  const page = await http("GET", "/api/responses?formId=feedback&limit=5&offset=2");
  expectEqual(page.data, all.data.slice(2, 7), "limit=5&offset=2");
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const recent = await http("GET", `/api/responses?formId=feedback&from=${since}`);
  expect(recent.data.length > 0 && recent.data.length < all.data.length, `from=${since} filters (${recent.data.length} of ${all.data.length})`);
});

check("dashboard GET /api/responses: includeCreatedAt=1 gives [{ data, createdAt }], to includes the whole day, limit is clamped to 1…5000", "dashboard", async () => {
  const all = (await http("GET", "/api/responses?formId=feedback&limit=5000")).data;
  const dated = await http("GET", "/api/responses?formId=feedback&limit=5000&includeCreatedAt=1");
  expectStatus(dated, 200, "GET /api/responses?includeCreatedAt=1");
  expect(Array.isArray(dated.data) && dated.data.every((r) => isObject(r) && Object.keys(r).sort().join() === "createdAt,data" && typeof r.createdAt === "string"), `expected [{ data, createdAt }], got ${dated.text().slice(0, 200)}`);
  expectEqual(dated.data.map((r) => r.data), all, "data with includeCreatedAt=1");
  const day = dated.data[Math.floor(dated.data.length / 2)].createdAt.slice(0, 10);   // a day with responses during it
  const until = (await http("GET", `/api/responses?formId=feedback&limit=5000&to=${day}`)).data;
  expectEqual(until, dated.data.filter((r) => r.createdAt.slice(0, 10) <= day).map((r) => r.data), `to=${day}`);
  expectEqual((await http("GET", "/api/responses?formId=feedback&limit=0")).data, all.slice(0, 1), "limit=0 (clamped to 1)");
  expectEqual((await http("GET", "/api/responses?formId=feedback&limit=-3&offset=-2")).data, all.slice(0, 1), "limit=-3&offset=-2 (clamped to 1 and 0)");
  const over = await http("GET", "/api/responses?formId=feedback&limit=5001");
  expectStatus(over, 200, "limit=5001");
  expectEqual(over.data, all.slice(0, 5000), "limit=5001 (clamped to 5000)");
});

check("save-response → dashboard: a posted response comes back as stored", ["save-response", "dashboard"], async () => {
  const formId = unique("contract");
  expectStatus(await http("POST", "/api/responses", { json: { formId, data: ROUNDTRIP } }), 201, "POST /api/responses");
  expectEqual((await http("GET", `/api/responses?formId=${formId}`)).data, [ROUNDTRIP], "GET /api/responses");
}, { skip: VALIDATE && "VALIDATE_RESPONSES replaces save-response with validate-response" });

// ---------- creator-load-save
check("creator-load-save PUT /api/forms/:id: 403 for Bob and signed out, saved as-is for Alice", "creator-load-save", async () => {
  const key = unique("contract");
  expectError(await http("PUT", `/api/forms/${key}`, { json: ROUNDTRIP, user: "bob" }), 403, "PUT as Bob");
  expectError(await http("PUT", `/api/forms/${key}`, { json: ROUNDTRIP, user: null }), 403, "PUT signed out");
  const definition = { title: "Contract", elements: [{ type: "text", name: "q1", title: "  padded  " }], pages: undefined };
  delete definition.pages;
  expectStatus(await http("PUT", `/api/forms/${key}`, { json: definition }), 204, "PUT as Alice");
  const s = await stored("creator-load-save", { key });
  expectEqual(s.forms?.json, definition, "stored definition");
  const support = await http("GET", "/api/forms/support");
  expect(isObject(support.data?.definition), "GET /api/forms/support has .definition");
});

check("creator-load-save → load-definition-variables-data: a saved definition comes back as .definition", ["creator-load-save", "load-definition-variables-data"], async () => {
  const key = unique("contract");
  expectStatus(await http("PUT", `/api/forms/${key}`, { json: ROUNDTRIP }), LINT ? [200, 204] : 204, "PUT /api/forms");
  expectEqual((await http("GET", `/api/forms/${key}`)).data?.definition, ROUNDTRIP, "GET /api/forms .definition");
});

// ---------- creator-uploads
check("creator-uploads → store-files: a Creator upload is served from the URL kept in the definition", ["creator-uploads", "store-files", "creator-load-save"], async () => {
  const form = new FormData();
  form.append("files[]", new Blob([readShared("samples/work-order-scan.png")], { type: "image/png" }), "logo.png");
  const [id] = (await http("POST", "/api/files", { body: form })).data ?? [];
  expect(typeof id === "string", "POST /api/files returned an id");
  const key = unique("contract");
  const definition = { logo: `/api/files/${id}`, elements: [{ type: "text", name: "q1" }] };
  expectStatus(await http("PUT", `/api/forms/${key}`, { json: definition }), LINT ? [200, 204] : 204, "PUT /api/forms with a logo");
  const logo = (await http("GET", `/api/forms/${key}`)).data?.definition?.logo;
  expectEqual(logo, `/api/files/${id}`, "definition.logo");
  const d = await http("GET", logo);
  expectStatus(d, 200, "GET the logo URL");
  expect(d.bytes.equals(readShared("samples/work-order-scan.png")), "logo bytes");
});

// ---------- ai-translation
check(`ai-translation POST /api/translate (AI=${AI})`, "ai-translation", async () => {
  const r = await http("POST", "/api/translate", { json: { strings: ["Hello", "Thank you, naïve user"], from: "en", to: "de" } });
  if (AI === "off") return expectError(r, 501, "POST /api/translate without a key", "Set AI_API_KEY to enable translation");
  expectStatus(r, 200, "POST /api/translate");
  expectEqual(r.data, ["[de] Hello", "[de] Thank you, naïve user"], "translated strings in order");
});

check("ai-translation (AI=stub): each POST /api/translate calls the provider once", "ai-translation", async () => {
  const calls = async () => {
    const r = await fetch(`${AI_STUB_URL}/requests`).catch(() => null);
    expect(r?.ok, `GET ${AI_STUB_URL}/requests: the AI stub answered ${r?.status ?? "nothing"} (AI_BASE_URL is the stub's /v1)`);
    return (await r.json())["/v1/chat/completions"];
  };
  const before = await calls();
  for (let i = 1; i <= 2; i++) {
    expectStatus(await http("POST", "/api/translate", { json: { strings: ["One", "Two", "Three"], from: "en", to: "fr" } }), 200, `POST /api/translate #${i}`);
    expectEqual(await calls(), before + i, `provider calls after ${i} translation request(s)`);
  }
}, { skip: AI === "off" && "AI is off" });

// ---------- variable-presets
check("variable-presets: GET the seeded presets, [] when none are saved, 403 for Bob, PUT stored as-is", "variable-presets", async () => {
  const seeded = await http("GET", "/api/variable-presets/support");
  expectStatus(seeded, 200, "GET /api/variable-presets/support");
  expect(Array.isArray(seeded.data) && seeded.data.length >= 2, "basic and premium presets are seeded");
  const key = unique("contract");
  const empty = await http("GET", `/api/variable-presets/${key}`);
  expectStatus(empty, 200, "GET unsaved presets");
  expectEqual(empty.data, [], "unsaved presets are an empty list");
  const presets = [{ name: "basic", variables: { customerTier: "basic" } }, { name: "premium", description: "", variables: { customerTier: "premium", extra: {} } }];
  expectError(await http("PUT", `/api/variable-presets/${key}`, { json: presets, user: "bob" }), 403, "PUT as Bob");
  expectStatus(await http("PUT", `/api/variable-presets/${key}`, { json: presets }), 204, "PUT as Alice");
  expectEqual((await stored("variable-presets", { key })).variable_presets?.json, presets, "stored presets");
  expectEqual((await http("GET", `/api/variable-presets/${key}`)).data, presets, "GET after PUT");
});

// ---------- validate-response
const claimData = { customer_email: "valid@example.com", amount: 120, incident: "theft", details: "Contract test" };
check(`validate-response POST /api/responses is validated on the server (SERVICE=${SERVICE})`, "validate-response", async () => {
  const before = (await stored("validate-response")).responses?.[0]?.id ?? 0;
  const valid = await http("POST", "/api/responses", { json: { formId: "claim", data: claimData } });
  if (!LIVE) return expectError(valid, 503, "POST /api/responses", "not running");
  expectStatus(valid, 201, "a valid response");
  for (const [what, data] of [
    ["an unknown choice", { ...claimData, incident: "meteor" }],
    ["a wrong type", { ...claimData, amount: { much: true } }],
    ["a missing required answer", { amount: 10, incident: "theft" }],
  ]) {
    const r = await http("POST", "/api/responses", { json: { formId: "claim", data } });
    expectStatus(r, 400, what);
    expect(Array.isArray(r.data?.errors) && r.data.errors.length > 0, `${what}: expected { errors: [...] }, got ${r.text().slice(0, 200)}`);
  }
  const after = (await stored("validate-response")).responses ?? [];
  expectEqual(after.filter((row) => row.id > before).length, 1, "rows stored (only the valid response)");
}, { skip: !VALIDATE && "VALIDATE_RESPONSES is off" });

check("validate-response POST /api/responses: a wrong envelope answers 400 before the service is called, nothing stored", "validate-response", async () => {
  const before = await rowCounts();
  for (const [what, json] of [["[]", []], ["a number formId", { formId: 1, data: claimData }], ["a string data", { formId: "claim", data: "answers" }]]) {
    expectError(await http("POST", "/api/responses", { json }), 400, what, "Expected { formId, data } with an answers object");
  }
  expectEqual(await rowCounts(), before, "row counts");
}, { skip: !VALIDATE && "VALIDATE_RESPONSES is off" });

// ---------- lint-definition
check(`lint-definition PUT /api/forms/:id is linted on the server (SERVICE=${SERVICE})`, "lint-definition", async () => {
  const put = (key, json) => http("PUT", `/api/forms/${key}`, { json });
  const clean = unique("contract");
  const r0 = await put(clean, { elements: [{ type: "text", name: "q1" }] });
  if (!LIVE) return expectError(r0, 503, "PUT /api/forms", "not running");
  expectStatus(r0, 204, "a clean definition");
  for (const [what, definition] of [
    ["an unknown variable", { elements: [{ type: "text", name: "q1", visibleIf: "{nosuch} = 1" }] }],
    ["a question without a name", { elements: [{ type: "text", title: "No name" }] }],
  ]) {
    const key = unique("contract");
    const r = await put(key, definition);
    expectStatus(r, 422, what);
    expect(Array.isArray(r.data?.errors) && r.data.errors.length > 0 && Array.isArray(r.data.warnings), `${what}: expected { errors, warnings }, got ${r.text().slice(0, 200)}`);
    expectError(await http("GET", `/api/forms/${key}`), 404, `${what} was not saved`);
  }
  const key = unique("contract");
  const warned = { elements: [{ type: "text", name: "q1", someproperty: 1 }] };
  const r = await put(key, warned);
  expectStatus(r, 200, "an unknown property");
  expect(Array.isArray(r.data?.warnings) && r.data.warnings.length > 0 && !("errors" in r.data), `expected { warnings }, got ${r.text().slice(0, 200)}`);
  expectEqual((await http("GET", `/api/forms/${key}`)).data?.definition, warned, "a definition with warnings is saved");
}, { skip: !LINT && "LINT_DEFINITIONS is off" });

// ---------- server-pdf
const pdfCheck = async (id) => {
  const r = await http("GET", `/api/claims/${id}/pdf`);
  if (!LIVE) return expectError(r, 503, "GET /api/claims/:id/pdf", "not running");
  expectStatus(r, 200, "GET /api/claims/:id/pdf");
  expect((r.headers.get("content-type") ?? "").startsWith("application/pdf"), `Content-Type ${r.headers.get("content-type")}`);
  expect(r.bytes.subarray(0, 4).toString("latin1") === "%PDF", "the body starts with %PDF");
  expectEqual(r.headers.get("content-disposition"), `inline; filename="claim-${id}.pdf"`, "Content-Disposition");
  expectEqual(directives(r.headers.get("cache-control")), ["no-store", "private"], `Cache-Control ${r.headers.get("cache-control")}`);
};
check(`server-pdf GET /api/claims/:id/pdf (SERVICE=${SERVICE})`, "server-pdf", async () => {
  const s = await stored("server-pdf");
  const id = s.responses?.[0]?.id;
  expect(Number.isInteger(id), "the stored panel lists a claim");
  await pdfCheck(id);
  expectError(await http("GET", "/api/claims/999999999/pdf"), 404, "GET the PDF of an unknown claim");
});

check("server-pdf page /examples/server-pdf/loading answers 200 HTML", "server-pdf", async () => {
  const r = await http("GET", "/examples/server-pdf/loading");
  expectStatus(r, 200, "GET /examples/server-pdf/loading");
  expect((r.headers.get("content-type") ?? "").startsWith("text/html"), `Content-Type ${r.headers.get("content-type")}`);
});

check("relational-storage → server-pdf: a new claim prints", ["relational-storage", "server-pdf"], async () => {
  const r = await http("POST", "/api/claims", { json: { data: claimData, definitionVersion: "v1" } });
  expectStatus(r, 201, "POST /api/claims");
  await pdfCheck(r.data.id);
});

// ---------- extract-from-paper
check(`extract-from-paper POST /api/work-orders/extract (SERVICE=${SERVICE}, AI=${AI})`, "extract-from-paper", async () => {
  const before = (await stored("extract-from-paper"))["row counts"];
  const form = new FormData();
  form.append("scan", new Blob([readShared("samples/work-order-scan.png")], { type: "image/png" }), "work-order-scan.png");
  const r = await http("POST", "/api/work-orders/extract", { body: form });
  if (!LIVE) expectError(r, 503, "POST /api/work-orders/extract", "not running");
  else if (AI === "off") expectError(r, 503, "POST /api/work-orders/extract", TEXTS[SERVICE].noAiProvider);
  else {
    expectStatus(r, 200, "POST /api/work-orders/extract");
    expectEqual(r.data?.answers, JSON.parse(readShared("samples/work-order-scan.answers.json")), "answers");
    expect(Array.isArray(r.data.confidence) && r.data.confidence.every((c) => typeof c.fieldName === "string" && typeof c.flagged === "boolean"), "confidence: [{ fieldName, value, confidence, flagged }]");
    expect(r.data.uniqueId === null || typeof r.data.uniqueId === "string", "uniqueId is a string or null");
  }
  expectEqual((await stored("extract-from-paper"))["row counts"], before, "nothing was saved");
  const big = new FormData();
  big.append("scan", new Blob([Buffer.alloc(5 * 1024 * 1024 + 1, 0x20)], { type: "image/png" }), "big.png");
  expectError(await http("POST", "/api/work-orders/extract", { body: big }), 413, "a scan over 5 MB");
});

check(`extract-from-paper GET /api/work-orders/blank.pdf (SERVICE=${SERVICE})`, "extract-from-paper", async () => {
  const r = await http("GET", "/api/work-orders/blank.pdf");
  if (!LIVE) return expectError(r, 503, "GET /api/work-orders/blank.pdf", "not running");
  expectStatus(r, 200, "GET /api/work-orders/blank.pdf");
  expect((r.headers.get("content-type") ?? "").startsWith("application/pdf"), `Content-Type ${r.headers.get("content-type")}`);
  expect(r.bytes.subarray(0, 4).toString("latin1") === "%PDF", "the body starts with %PDF");
  expectEqual(r.headers.get("content-disposition"), 'attachment; filename="work-order.pdf"', "Content-Disposition");
  expectEqual(directives(r.headers.get("cache-control")), ["no-store", "private"], `Cache-Control ${r.headers.get("cache-control")}`);
});

// With SERVICE=off these answer 400, not 503: the app checks them before it would call the service
check("extract-from-paper POST /api/work-orders/extract: no scan field, or a text file named .png, answers 400", "extract-from-paper", async () => {
  const none = new FormData();
  none.append("document", new Blob([readShared("samples/work-order-scan.png")], { type: "image/png" }), "work-order-scan.png");
  expectError(await http("POST", "/api/work-orders/extract", { body: none }), 400, "no scan field", 'Upload the scan in a field named "scan"');
  const text = new FormData();
  text.append("scan", new Blob([Buffer.from("Not a scan: plain text in a file named .png\n")], { type: "image/png" }), "scan.png");
  expectError(await http("POST", "/api/work-orders/extract", { body: text }), 400, "a text file named scan.png", "The file is not a PDF, PNG, JPEG, WebP or GIF document");
});

// ---------- /demo/stored for every step with server code
const WITH_SERVER_CODE = ALL_STEPS.filter((s) => s !== "creator-uploads" && SELECTED.has(s));
check("/demo/stored/:slug answers for every step with server code", WITH_SERVER_CODE, async () => {
  for (const step of WITH_SERVER_CODE) await stored(step);
});

// ---------- Pages
const PAGES = ALL_STEPS.filter((s) => SELECTED.has(s));
check("pages: /examples/<slug> answers 200 HTML with window.SURVEYJS_PAGE for every step", PAGES, async () => {
  for (const slug of PAGES) {
    const r = await http("GET", `/examples/${slug}`);
    expectStatus(r, 200, `GET /examples/${slug}`);
    expect(r.text().includes("window.SURVEYJS_PAGE"), `/examples/${slug} sets window.SURVEYJS_PAGE`);
  }
});

check("pages: /shared/ serves its four folders with their types and nothing else; an unknown example answers 404", PAGES, async () => {
  for (const [path, type] of [["/shared/samples/support-help.svg", /^image\/svg\+xml/], ["/shared/ui/page-tabs.js", /^(text|application)\/javascript/]]) {
    const r = await http("GET", path);
    expectStatus(r, 200, `GET ${path}`);
    expect(type.test(r.headers.get("content-type") ?? ""), `${path}: Content-Type ${r.headers.get("content-type")}`);
  }
  for (const path of ["/shared/../.env", "/shared/client/../../.env", "/shared/%2e%2e/.env", "/shared/..%2f.env", "/shared/seed/forms.json"]) {
    expectEqual(await rawGet(path), 404, `GET ${path}`);
  }
  expectStatus(await http("GET", `/examples/${unique("no-such-step")}`), 404, "GET /examples/<unknown>");
});

check("edit-together page /examples/edit-together?form= answers 400 for an invalid form id", "edit-together", async () => {
  expectStatus(await http("GET", "/examples/edit-together?form=bad%20id"), 400, "GET /examples/edit-together?form=bad%20id");
});

// ---------- Relays

class Socket {
  static async open(url, { user = "alice", jar: j = jar } = {}) {
    const headers = {};
    const cookie = j.header(user);
    if (cookie) headers.Cookie = cookie;
    const s = new Socket();
    s.ws = new WebSocket(url, { headers });
    s.messages = [];
    s.waiters = [];
    s.closed = new Promise((resolve) => s.ws.addEventListener("close", resolve));
    s.ws.addEventListener("message", (e) => {
      const msg = JSON.parse(String(e.data));
      s.messages.push(msg);
      s.waiters = s.waiters.filter((w) => !(w.test(msg) && (w.resolve(msg), true)));
    });
    await new Promise((resolve, reject) => {
      s.ws.addEventListener("open", resolve, { once: true });
      s.ws.addEventListener("error", () => reject(new Failure(`could not connect to ${url}`)), { once: true });
    });
    return s;
  }
  next(test, what, ms = 3000) {
    const found = this.messages.find(test);
    if (found) { this.messages.splice(this.messages.indexOf(found), 1); return Promise.resolve(found); }
    return new Promise((resolve, reject) => {
      const w = { test, resolve: (m) => { clearTimeout(timer); this.messages.splice(this.messages.indexOf(m), 1); resolve(m); } };
      const timer = setTimeout(() => { this.waiters = this.waiters.filter((x) => x !== w); reject(new Failure(`timed out waiting for ${what}`)); }, ms);
      this.waiters.push(w);
    });
  }
  send(msg) { this.ws.send(JSON.stringify(msg)); }
  close() { this.ws.close(); return this.closed; }
}
const type = (t) => (m) => m.type === t;

/** true when the relay closes the connection (or refuses the handshake) before sending anything.
 *  A refused handshake (a 401 or 403 instead of 101) fires "error" and then "close" on Node 24+, but only "error" on
 *  Node 22 (undici 6), so either one counts. */
function refused(url, user) {
  const headers = {};
  const cookie = jar.header(user);
  if (cookie) headers.Cookie = cookie;
  const ws = new WebSocket(url, { headers });
  return new Promise((resolve) => {
    const timer = setTimeout(() => { resolve(false); ws.close(); }, 3000);
    const closed = () => { clearTimeout(timer); resolve(true); };
    ws.addEventListener("message", () => { clearTimeout(timer); resolve(false); ws.close(); });
    ws.addEventListener("error", closed);
    ws.addEventListener("close", closed);
  });
}

check("fill-together relay: init first, values relayed, late joiners get them, peer-left on leave", "fill-together", async () => {
  await http("GET", "/demo/stored/fill-together");   // takes demo_sid from the server in demo mode
  const room = `${RELAY_URL}/ws/rooms/${unique("contract")}`;
  const a = await Socket.open(`${room}?name=Ann`);
  const initA = await a.next(() => true, "the first message");
  expectEqual(initA.type, "init", "the first message type");
  expect(typeof initA.clientId === "string" && isObject(initA.values) && Array.isArray(initA.peers) && "seed" in initA && Number.isInteger(initA.colorIndex), `init { clientId, name, colorIndex, seed, values, peers }: ${JSON.stringify(initA)}`);
  const b = await Socket.open(`${room}?name=Ben`);
  const initB = await b.next(type("init"), "Ben's init");
  a.send({ type: "value", key: "q1", value: ROUNDTRIP });
  const v = await b.next(type("value"), "the value at Ben");
  expectEqual(v, { type: "value", from: initA.clientId, key: "q1", value: ROUNDTRIP }, "relayed value");
  a.send({ type: "presence", state: { page: "page1", focus: "q1" }, retain: true });
  const p = await b.next(type("peer"), "Ann's presence at Ben");
  expect(p.peer?.clientId === initA.clientId && p.retain === true && isObject(p.peer.state), `peer { peer, retain }: ${JSON.stringify(p)}`);
  a.send({ type: "nonsense" });
  const c = await Socket.open(`${room}?name=Cat`);
  const initC = await c.next(type("init"), "the late joiner's init");
  expectEqual(initC.values?.q1, ROUNDTRIP, "late joiner's init.values.q1");
  expect(initC.peers.some((peer) => peer.clientId === initA.clientId), "late joiner's init.peers lists Ann");
  await a.close();
  const left = await b.next(type("peer-left"), "peer-left at Ben");
  expectEqual(left.clientId, initA.clientId, "peer-left.clientId");
  await b.close(); await c.close();
  void initB;
}, { skip: !RELAY_URL && "RELAY_URL is not set" });

check("fill-together relay: init has sessionId and responseId; two completes at once save one job-sheet row; later values are ignored", "fill-together", async () => {
  await http("GET", "/demo/stored/fill-together");
  const before = (await stored("fill-together")).responses?.[0]?.id ?? 0;
  const room = `${RELAY_URL}/ws/rooms/${unique("contract")}`;
  const a = await Socket.open(`${room}?name=Ann`);
  const initA = await a.next(type("init"), "Ann's init");
  expect(/^[0-9a-f]{32}$/.test(initA.sessionId ?? ""), `init.sessionId is 32 hex characters: ${initA.sessionId}`);
  expectEqual(initA.responseId, null, "init.responseId before completing");
  const b = await Socket.open(`${room}?name=Ben`);
  expectEqual((await b.next(type("init"), "Ben's init")).sessionId, initA.sessionId, "Ben's init.sessionId (same room)");
  const data = { q1: "done", d: {}, g: 1.5 };
  a.send({ type: "complete", data });
  b.send({ type: "complete", data });
  const [ca, cb] = await Promise.all([a.next(type("completed"), "completed at Ann"), b.next(type("completed"), "completed at Ben")]);
  expect(Number.isInteger(ca.id), `completed { id }: ${JSON.stringify(ca)}`);
  expectEqual(cb.id, ca.id, "completed.id at Ben");
  const [ca2, cb2] = await Promise.all([a.next(type("completed"), "the second completed at Ann"), b.next(type("completed"), "the second completed at Ben")]);
  expectEqual([ca2.id, cb2.id], [ca.id, ca.id], "the second complete resends the same id");
  const rows = ((await stored("fill-together")).responses ?? []).filter((row) => row.id > before);
  expectEqual(rows.map((row) => row.id), [ca.id], "job-sheet rows stored");
  expectEqual(rows[0].data, data, "the stored job sheet");
  a.send({ type: "value", key: "q1", value: "changed after completing" });
  await sleep(300);
  expect(!b.messages.some(type("value")), "a value sent after completing isn't relayed");
  const c = await Socket.open(`${room}?name=Cat`);
  const initC = await c.next(type("init"), "the late joiner's init");
  expectEqual(initC.responseId, ca.id, "late joiner's init.responseId");
  expectEqual(initC.values?.q1, "done", "late joiner's init.values.q1");
  await a.close(); await b.close(); await c.close();
}, { skip: !RELAY_URL && "RELAY_URL is not set" });

check("edit-together relay: appends reach a late joiner's init.log in order", "edit-together", async () => {
  await http("GET", "/demo/stored/edit-together");
  const room = `${EDIT_RELAY_URL}/ws/forms/${unique("contract")}`;
  const a = await Socket.open(`${room}?name=Ann`);
  const initA = await a.next(() => true, "the first message");
  expect(initA.type === "init" && typeof initA.clientId === "string" && Array.isArray(initA.log) && "seed" in initA, `init { clientId, colorIndex, seed, log }: ${JSON.stringify(initA)}`);
  const b = await Socket.open(`${room}?name=Ben`);
  await b.next(type("init"), "Ben's init");
  const records = [{ v: 1, seq: 1, op: 0, payload: { name: "title", value: "One" } }, { v: 1, seq: 1, op: 0, payload: { name: "title", value: "One more" } }];
  for (const record of records) a.send({ type: "append", payload: record });
  for (const record of records) expectEqual(await b.next(type("record"), "a record at Ben"), { type: "record", from: initA.clientId, payload: record }, "relayed record");
  a.send({ type: "presence", state: { tab: "designer", sel: null } });
  const p = await b.next(type("presence"), "Ann's presence at Ben");
  expect(p.peer?.clientId === initA.clientId && isObject(p.peer.state), `presence { peer }: ${JSON.stringify(p)}`);
  const c = await Socket.open(`${room}?name=Cat`);
  const initC = await c.next(type("init"), "the late joiner's init");
  expectEqual(initC.log, records, "late joiner's init.log");
  await a.close();
  expectEqual((await b.next(type("presence-leave"), "presence-leave at Ben")).clientId, initA.clientId, "presence-leave.clientId");
  await b.close(); await c.close();
}, { skip: !EDIT_RELAY_URL && "EDIT_RELAY_URL is not set" });

check("edit-together relay: presence-sync { peers } follows init; signed-out and Bob connections are closed", "edit-together", async () => {
  await http("GET", "/demo/stored/edit-together");
  const room = `${EDIT_RELAY_URL}/ws/forms/${unique("contract")}`;
  const a = await Socket.open(`${room}?name=Ann`);
  const initA = await a.next(type("init"), "Ann's init");
  a.send({ type: "presence", state: { tab: "designer", sel: null } });
  await sleep(300);
  const b = await Socket.open(`${room}?name=Ben`);
  expectEqual((await b.next(() => true, "Ben's first message")).type, "init", "Ben's first message type");
  const sync = await b.next(() => true, "Ben's second message");
  expect(sync.type === "presence-sync" && Array.isArray(sync.peers) && sync.peers.some((p) => p.clientId === initA.clientId), `presence-sync { peers } listing Ann: ${JSON.stringify(sync)}`);
  expect(await refused(`${room}?name=Nobody`, null), "a signed-out connection is closed");
  expect(await refused(`${room}?name=Bob`, "bob"), "Bob's connection is closed (viewers can't edit)");
  await a.close(); await b.close();
}, { skip: !EDIT_RELAY_URL && "EDIT_RELAY_URL is not set" });

check("fill-together and edit-together relays: sandboxes get separate rooms, one sandbox shares a room", ["fill-together", "edit-together"], async () => {
  const other = new Jar();
  await http("GET", "/demo/stored/fill-together", { jar: other });
  await http("GET", "/demo/stored/fill-together");
  expect(jar.sid && other.sid && jar.sid !== other.sid, "two visitors got two demo_sid cookies from the server");
  for (const [base, path, msg, seen] of [
    [RELAY_URL, "/ws/rooms/", { type: "value", key: "q1", value: "mine" }, (m) => m.values?.q1],
    [EDIT_RELAY_URL, "/ws/forms/", { type: "append", payload: { seq: 1 } }, (m) => m.log?.length],
  ]) {
    const room = `${base}${path}${unique("contract")}?name=X`;
    const mine = await Socket.open(room);
    await mine.next(type("init"), "init");
    mine.send(msg);
    await new Promise((r) => setTimeout(r, 300));
    const same = await Socket.open(room);
    expect(seen(await same.next(type("init"), "init in the same sandbox")), `${path}: the same sandbox shares the room`);
    const theirs = await Socket.open(room, { jar: other });
    expect(!seen(await theirs.next(type("init"), "init in another sandbox")), `${path}: another sandbox gets its own room`);
    await mine.close(); await same.close(); await theirs.close();
  }
}, { skip: (!DEMO && "DEMO_MODE is off") || ((!RELAY_URL || !EDIT_RELAY_URL) && "RELAY_URL and EDIT_RELAY_URL are not set") });

// ------------------------------------------------------------------------------------------------

console.log(`Contract server-integration-v4 against ${BASE_URL} (SERVICE=${SERVICE} AI=${AI}${VALIDATE ? " VALIDATE_RESPONSES" : ""}${LINT ? " LINT_DEFINITIONS" : ""}${DEMO ? " DEMO_MODE" : ""})`);
let failed = 0, passed = 0, skipped = 0;
for (const c of checks) {
  const missing = c.steps.filter((s) => !SELECTED.has(s));
  if (c.steps.length === 0 || (c.steps.length === 1 && missing.length)) continue;     // a step check for an unselected step
  if (missing.length) { console.log(`skip  ${c.name}: skipped (needs ${missing.join(", ")})`); skipped++; continue; }
  if (c.skip) { console.log(`skip  ${c.name}: ${c.skip}`); skipped++; continue; }
  try {
    await c.fn();
    console.log(`ok    ${c.name}`);
    passed++;
  } catch (e) {
    console.log(`FAIL  ${c.name}\n      ${e instanceof Failure ? e.message : e.stack}`);
    failed++;
  }
}
console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
process.exit(failed ? 1 : 0);
