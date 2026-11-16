#!/usr/bin/env node
// A deterministic AI provider for the contract test, never for production. node:http only.
//
//   AI_STUB_PORT=3020 node shared/contract-tests/ai-stub.mjs
//
// POST /api/chat             the Ollama chat API, as ai-form-response-extractor 0.2.0's "ollama"
//                            provider calls it (SurveyJS Server db1ac24, AI_PROVIDER=ollama,
//                            OLLAMA_BASE_URL=http://ai-stub:3020). Answers with the contents of
//                            shared/samples/work-order-scan.answers.json.
// POST /v1/chat/completions  OpenAI-compatible chat completions for ai-translation machine translation.
//                            Expects the page's prompt: "Translate each string from <from> to <to>.
//                            Return a JSON array in the same order." with the strings as a JSON array
//                            in the last user message. Answers "[<to>] <string>" for each, in order.
// GET /requests              how many POSTs each of the two paths has received, e.g. { "/api/chat": 1,
//                            "/v1/chat/completions": 2 }: the contract test checks one provider call per request.
//
// It never calls out, logs request paths only, and answers 500 to anything it doesn't recognize,
// so a change in the extractor's request format fails the test instead of passing silently.
import http from "node:http";
import { readFileSync } from "node:fs";

const PORT = Number(process.env.AI_STUB_PORT ?? 3020);
const ANSWERS = JSON.parse(readFileSync(new URL("../samples/work-order-scan.answers.json", import.meta.url), "utf8"));
// One answer read with low confidence, so the extract-from-paper page shows a flagged answer (flagged < 0.75)
const CONFIDENCE = Object.fromEntries(Object.keys(ANSWERS).map((name) => [name, name === "notes" ? 0.55 : 0.96]));

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function ollamaChat(body) {
  const user = Array.isArray(body.messages) ? body.messages.find((m) => m.role === "user") : null;
  if (typeof body.model !== "string" || body.stream !== false || body.format !== "json") return "expected { model, messages, stream: false, format: \"json\" }";
  if (!user || typeof user.content !== "string" || !user.content.includes("Extract the following form fields")) return "expected the extractor's field-extraction prompt";
  if (!Array.isArray(user.images) || user.images.length === 0 || !user.images.every((i) => typeof i === "string" && i.length > 0)) return "expected base64 page images";
  const fields = [...user.content.matchAll(/^\d+\. "([^"]+)" — /gm)].map((m) => m[1]);
  const missing = Object.keys(ANSWERS).filter((name) => !fields.includes(name));
  if (missing.length) return `the prompt does not list the fields ${missing.join(", ")}`;
  return {
    model: body.model,
    created_at: new Date(0).toISOString(),
    message: { role: "assistant", content: JSON.stringify({ ...ANSWERS, _confidence: CONFIDENCE }) },
    done: true,
    prompt_eval_count: 0,
    eval_count: 0,
  };
}

function chatCompletions(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const text = messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
  const to = /\bfrom\s+\S+\s+to\s+([A-Za-z][\w-]*)/i.exec(text)?.[1];
  const last = [...messages].reverse().find((m) => m.role === "user");
  let strings;
  try { strings = JSON.parse(last?.content ?? ""); } catch { strings = null; }
  if (!to || !Array.isArray(strings) || !strings.every((s) => typeof s === "string")) {
    return "expected \"… from <from> to <to> …\" and the strings as a JSON array in the last user message";
  }
  return {
    id: "chatcmpl-stub",
    object: "chat.completion",
    created: 0,
    model: body.model ?? "stub",
    choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(strings.map((s) => `[${to}] ${s}`)) }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

const routes = { "/api/chat": ollamaChat, "/v1/chat/completions": chatCompletions };
const requests = Object.fromEntries(Object.keys(routes).map((path) => [path, 0]));

http.createServer((req, res) => {
  const path = new URL(req.url, "http://stub").pathname;
  console.log(`${req.method} ${path}`);
  if (req.method === "GET" && path === "/requests") return send(res, 200, requests);
  const route = routes[path];
  if (req.method !== "POST" || !route) return send(res, 500, { error: `ai-stub: unexpected request ${req.method} ${path}` });
  requests[path]++;
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return send(res, 500, { error: "ai-stub: the body is not JSON" }); }
    const answer = route(body);
    if (typeof answer === "string") {
      console.log(`  rejected: ${answer}`);
      return send(res, 500, { error: `ai-stub: ${answer}` });
    }
    send(res, 200, answer);
  });
}).listen(PORT, "0.0.0.0", () => console.log(`ai-stub listening on ${PORT}`));
