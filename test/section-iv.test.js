// Run Server-Side Workflows in process: every row of the meta prompt's in-process mapping, with the exact status and
// text, and the checks that answer before any SurveyJS call. The library and provider calls are replaced with
// mock.method() on integration/surveyjs.js and integration/ai-provider.js. Each row also checks that nothing was
// stored, and that nothing logged carries an answer.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, mock, test } from "node:test";
import { AiConfigurationError, aiProvider } from "../integration/ai-provider.js";
import { surveyjs } from "../integration/surveyjs.js";
import { files, PNG, startApp } from "./helpers.js";

const SECRET = "secret-answer-7f3a";   // an answer that must never reach a log line
const broken = JSON.stringify({ elements: [{ type: "text", name: "q1", visibleIf: "{nosuch} = 1" }] });
const scan = readFileSync(new URL("../shared/samples/work-order-scan.png", import.meta.url));
const answers = JSON.parse(readFileSync(new URL("../shared/samples/work-order-scan.answers.json", import.meta.url), "utf8"));

let app;
let logs;
before(async () => (app = await startApp({ VALIDATE_RESPONSES: "true", LINT_DEFINITIONS: "true" })));
after(() => app.stop());
beforeEach((t) => {
  logs = [];
  for (const level of ["error", "warn", "log", "info"]) {
    const spy = mock.method(console, level, (...args) => logs.push(args.map((a) => (a instanceof Error ? a.stack : String(a))).join(" ")));
    t.after(() => spy.mock.restore());
  }
});

const count = () => app.db().prepare("SELECT COUNT(*) AS n FROM responses").get().n;
const setForm = (key, json) => app.db().prepare("INSERT INTO forms (key, json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET json = excluded.json").run(key, json);
const form = (key) => app.db().prepare("SELECT json FROM forms WHERE key = ?").get(key)?.json;
function assertAnswer(r, status, error) {
  assert.equal(r.status, status, r.text);
  assert.deepEqual(r.data, { error });
}
const assertNoAnswersLogged = () => assert.ok(!logs.some((line) => line.includes(SECRET) || line.includes(answers.customer ?? "\0")), logs.join("\n"));

describe("validate-response", () => {
  const claim = { customer_email: "valid@example.com", amount: 120, incident: "theft", details: SECRET };

  test("a wrong envelope answers 400 before anything else; an unknown form 404", async () => {
    const before = count();
    for (const json of [[], { formId: 1, data: claim }, { formId: "claim", data: "answers" }, { formId: "claim", data: [claim] }, { formId: "claim" }]) {
      assertAnswer(await app.request("POST", "/api/responses", { json }), 400, "Expected { formId, data } with an answers object");
    }
    assertAnswer(await app.request("POST", "/api/responses", { json: { formId: "no-such-form", data: claim } }), 404, "Unknown form");
    assert.equal(count(), before);
  });

  test("a stored definition with a lint error answers 500, nothing stored, logged without the answers", async () => {
    setForm("broken-for-validation", broken);
    const before = count();
    assertAnswer(await app.request("POST", "/api/responses", { json: { formId: "broken-for-validation", data: { q1: SECRET } } }), 500, "The stored definition has errors");
    assert.equal(count(), before);
    assert.equal(logs.length, 1);
    assertNoAnswersLogged();
  });

  test("data errors or a failed validate() answer 400 { errors }, nothing stored; valid answers 201", async () => {
    const before = count();
    for (const data of [{ ...claim, incident: "meteor" }, { ...claim, amount: { much: true } }, { amount: 10, incident: "theft" }, { ...claim, unknown: 1 }]) {
      const r = await app.request("POST", "/api/responses", { json: { formId: "claim", data } });
      assert.equal(r.status, 400, r.text);
      assert.ok(Array.isArray(r.data.errors) && r.data.errors.length > 0, r.text);
      assert.deepEqual(Object.keys(r.data), ["errors"]);
    }
    assert.equal(count(), before);
    const ok = await app.request("POST", "/api/responses", { json: { formId: "claim", data: claim } });
    assert.equal(ok.status, 201);
    assert.equal(count(), before + 1);
    assertNoAnswersLogged();
  });
});

describe("lint-definition", () => {
  test("no findings 204, warnings only 200 { warnings } and saved, errors 422 { errors, warnings } and the previous version kept", async () => {
    const clean = { elements: [{ type: "text", name: "q1" }] };
    assert.equal((await app.request("PUT", "/api/forms/lint-row", { json: clean })).status, 204);
    const warned = await app.request("PUT", "/api/forms/lint-row-2", { json: { elements: [{ type: "text", name: "q1", someproperty: 1 }] } });
    assert.equal(warned.status, 200);
    assert.deepEqual(Object.keys(warned.data), ["warnings"]);
    assert.ok(form("lint-row-2"));
    const refused = await app.request("PUT", "/api/forms/lint-row", { json: JSON.parse(broken) });
    assert.equal(refused.status, 422);
    assert.deepEqual(Object.keys(refused.data).sort(), ["errors", "warnings"]);
    assert.deepEqual(JSON.parse(form("lint-row")), clean);
  });

  test("not an object answers 400; Bob answers 403", async () => {
    for (const json of [[], "text", 1, null]) {
      assertAnswer(await app.request("PUT", "/api/forms/lint-row-3", { json: JSON.stringify(json), raw: true }), 400, "Expected a form definition");
    }
    assertAnswer(await app.request("PUT", "/api/forms/lint-row-3", { json: {}, user: "bob" }), 403, "You don't have editor rights: only editors can change forms");
    assert.equal(form("lint-row-3"), undefined);
  });
});

describe("server-pdf", () => {
  const claimId = () => app.db().prepare("SELECT id FROM responses WHERE form_id = 'claim' AND definition_version = 'v1' ORDER BY id LIMIT 1").get().id;
  const insertClaim = (version, data) => Number(app.db().prepare("INSERT INTO responses (form_id, definition_version, data, created_at) VALUES ('claim', ?, ?, '2026-01-01T00:00:00Z')")
    .run(version, JSON.stringify(data)).lastInsertRowid);

  test("%PDF- bytes pass as application/pdf with the contract's headers", async () => {
    const id = claimId();
    const r = await app.request("GET", `/api/claims/${id}/pdf`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "application/pdf");
    assert.equal(r.bytes.toString("latin1", 0, 5), "%PDF-");
    assert.equal(r.headers.get("content-disposition"), `inline; filename="claim-${id}.pdf"`);
    assert.equal(r.headers.get("cache-control"), "private, no-store");
  });

  test("an unknown or non-numeric claim answers 404, an unknown version 409, before SurveyPDF runs", async (t) => {
    const render = mock.method(surveyjs, "renderPdf");
    t.after(() => render.mock.restore());
    assertAnswer(await app.request("GET", "/api/claims/999999/pdf"), 404, "Unknown claim");
    assertAnswer(await app.request("GET", "/api/claims/abc/pdf"), 404, "Unknown claim");
    assertAnswer(await app.request("GET", `/api/claims/${insertClaim("v9", { details: SECRET })}/pdf`), 409, "The schema version for this claim is unavailable");
    assert.equal(render.mock.callCount(), 0);
  });

  test("the definition with a lint error answers 500 and is logged", async (t) => {
    const original = form("claim");
    setForm("claim", broken);
    t.after(() => setForm("claim", original));
    assertAnswer(await app.request("GET", `/api/claims/${insertClaim(null, { q1: SECRET })}/pdf`), 500, "The stored definition has errors");
    assert.equal(logs.length, 1);
    assertNoAnswersLogged();
  });

  test("SurveyPDF throws, or its bytes don't start with %PDF-: 500, logged", async (t) => {
    const id = claimId();
    const thrower = mock.method(surveyjs, "renderPdf", async () => {
      throw new Error("jsPDF failed");
    });
    assertAnswer(await app.request("GET", `/api/claims/${id}/pdf`), 500, "Couldn't generate the PDF");
    thrower.mock.restore();
    const junk = mock.method(surveyjs, "renderPdf", async () => Buffer.from("<html>not a pdf</html>"));
    t.after(() => junk.mock.restore());
    assertAnswer(await app.request("GET", `/api/claims/${id}/pdf`), 500, "Couldn't generate the PDF");
    assert.equal(logs.length, 2);
    assert.match(logs[0], /jsPDF failed/);
  });
});

describe("blank work order", () => {
  test("a fillable PDF of the stored work-order form, as an attachment", async () => {
    const r = await app.request("GET", "/api/work-orders/blank.pdf");
    assert.equal(r.status, 200);
    assert.equal(r.bytes.toString("latin1", 0, 5), "%PDF-");
    assert.equal(r.headers.get("content-disposition"), 'attachment; filename="work-order.pdf"');
    assert.equal(r.headers.get("cache-control"), "private, no-store");
  });

  test("a lint error, a throwing renderer and non-PDF bytes answer 500; no form answers 404", async (t) => {
    const original = form("work-order");
    t.after(() => setForm("work-order", original));
    setForm("work-order", broken);
    assertAnswer(await app.request("GET", "/api/work-orders/blank.pdf"), 500, "The stored definition has errors");
    setForm("work-order", original);
    const render = mock.method(surveyjs, "renderPdf", async () => {
      throw new Error("no fonts");
    });
    assertAnswer(await app.request("GET", "/api/work-orders/blank.pdf"), 500, "Couldn't generate the PDF");
    render.mock.mockImplementation(async () => Buffer.alloc(0));
    assertAnswer(await app.request("GET", "/api/work-orders/blank.pdf"), 500, "Couldn't generate the PDF");
    render.mock.restore();
    app.db().prepare("DELETE FROM forms WHERE key = 'work-order'").run();
    assertAnswer(await app.request("GET", "/api/work-orders/blank.pdf"), 404, "Unknown work order form");
  });
});

describe("extract-from-paper", () => {
  const extract = (form) => app.request("POST", "/api/work-orders/extract", { body: form });
  const scanForm = () => files("scan", [scan, "image/png", "work-order-scan.png"]);
  /** A provider the extractor accepts, answering like the AI stub does. */
  const provider = (extractFromImage) => ({ name: "fake", model: "fake", extractFromImage });
  const reply = () => ({ content: JSON.stringify({ ...answers, _confidence: Object.fromEntries(Object.keys(answers).map((k) => [k, 0.9])) }) });

  test("the pre-checks: no scan 400, a file elsewhere 400, not a document 400, over 5 MB 413, two scans 413", async () => {
    const before = count();
    assertAnswer(await extract(new FormData()), 400, 'Upload the scan in a field named "scan"');
    assertAnswer(await extract(files("document", [scan, "image/png", "scan.png"])), 400, 'Upload the scan in a field named "scan"');
    const text = new FormData();
    text.append("scan", "not a file");
    assertAnswer(await extract(text), 400, 'Upload the scan in a field named "scan"');
    assertAnswer(await extract(files("scan", [Buffer.from("plain text"), "image/png", "scan.png"])), 400, "The file is not a PDF, PNG, JPEG, WebP or GIF document");
    assertAnswer(await extract(files("scan", [Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]), "image/png", "big.png"])), 413, "The scan must be a file of 5 MB or less");
    assertAnswer(await extract(files("scan", [scan, "image/png", "a.png"], [scan, "image/png", "b.png"])), 413, "The scan must be a file of 5 MB or less");
    assert.equal(count(), before);
  });

  test("no AI provider configured answers 503", async () => {
    assertAnswer(await extract(scanForm()), 503, "No AI provider is configured for document extraction");
  });

  test("the work-order definition with a lint error answers 500 before the provider is asked", async (t) => {
    const original = form("work-order") ?? readFileSync(new URL("../shared/definitions/extract-from-paper.json", import.meta.url), "utf8");
    setForm("work-order", broken);
    t.after(() => setForm("work-order", original));
    const create = mock.method(aiProvider, "create");
    t.after(() => create.mock.restore());
    assertAnswer(await extract(scanForm()), 500, "The stored definition has errors");
    assert.equal(create.mock.callCount(), 0);
  });

  test("an answer comes back as { answers, confidence, uniqueId }, never rawResponse, and nothing is stored", async (t) => {
    const create = mock.method(aiProvider, "create", () => provider(async () => reply()));
    t.after(() => create.mock.restore());
    const before = count();
    const r = await extract(scanForm());
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(Object.keys(r.data).sort(), ["answers", "confidence", "uniqueId"]);
    assert.deepEqual(r.data.answers, answers);
    assert.ok(r.data.confidence.every((c) => typeof c.fieldName === "string" && typeof c.flagged === "boolean"));
    assert.equal(count(), before);
  });

  test("a provider that fails answers 502, logged without its message", async (t) => {
    const create = mock.method(aiProvider, "create", () => provider(async () => {
      throw new Error(`HTTP 500: the model said ${SECRET}`);
    }));
    t.after(() => create.mock.restore());
    assertAnswer(await extract(scanForm()), 502, "Could not extract the response from the document");
    create.mock.mockImplementation(() => provider(async () => ({ content: "I can't read this form" })));
    assertAnswer(await extract(scanForm()), 502, "Could not extract the response from the document");
    assert.ok(logs.length >= 2);
    assertNoAnswersLogged();
  });

  test("a provider that never answers gives 504 after the timeout", async (t) => {
    const withTimeout = surveyjs.withTimeout;
    const short = mock.method(surveyjs, "withTimeout", (promise) => withTimeout.call(surveyjs, promise, 50));
    const create = mock.method(aiProvider, "create", () => provider(() => new Promise(() => {})));
    t.after(() => { short.mock.restore(); create.mock.restore(); });
    assertAnswer(await extract(scanForm()), 504, "The AI provider timed out");
    assert.equal(short.mock.calls[0].arguments[1], 120_000);
  });
});

describe("the provider choice (integration/ai-provider.js ports provider.ts)", () => {
  const none = { provider: null, model: null, ollamaBaseUrl: null, openaiApiKey: null, anthropicApiKey: null };
  test("none chosen, an unknown one, or its key missing throw AiConfigurationError", () => {
    for (const extraction of [none, { ...none, provider: "gemini" }, { ...none, provider: "openai" }, { ...none, provider: "anthropic" }]) {
      assert.throws(() => aiProvider.create(extraction), AiConfigurationError);
    }
  });
  test("the key picks the provider without SURVEYJS_AI_PROVIDER; ollama gets its base URL through OLLAMA_BASE_URL", () => {
    assert.equal(aiProvider.create({ ...none, anthropicApiKey: "k" }).name, "anthropic");
    assert.equal(aiProvider.create({ ...none, openaiApiKey: "k", anthropicApiKey: "k" }).name, "openai");
    const ollama = aiProvider.create({ ...none, provider: "Ollama", model: "llava", ollamaBaseUrl: "http://127.0.0.1:1" });
    assert.deepEqual([ollama.name, ollama.model, process.env.OLLAMA_BASE_URL], ["ollama", "llava", "http://127.0.0.1:1"]);
  });
});
