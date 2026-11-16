// Demo only: GET /demo/stored/:slug, the Data panel ("What the server stored"). A fixed, whitelisted read per
// example, never arbitrary SQL. The section names and row fields are the reference's: the contract test and the
// browser tests read them.
import { existsSync, readFileSync } from "node:fs";
import { db } from "../db.js";
import { cache } from "../integration/cache.js";
import { roomKey, snapshotPath } from "../relay/room-key.js";

const query = (req, name) => (typeof req.query[name] === "string" ? req.query[name] : undefined);

function responses(req, formId, id, limit = 5, customerEmail = null) {
  const filters = [
    formId && ["form_id = ?", formId],
    id && ["id = ?", id],
    customerEmail !== null && ["data ->> '$.customer_email' = ?", customerEmail],
  ].filter(Boolean);
  const where = filters.map(([sql]) => sql);
  const params = filters.map(([, value]) => value);
  const sql = `SELECT id, form_id, definition_version, data, created_at FROM responses
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`;
  return db(req).prepare(sql).all(...params, limit).map((row) => ({
    data: JSON.parse(row.data), id: row.id, form_id: row.form_id, definition_version: row.definition_version, created_at: row.created_at,
  }));
}

function documents(req, table, key) {
  const row = typeof key === "string" ? db(req).prepare(`SELECT json FROM ${table} WHERE key = ?`).get(key) : undefined;
  return row ? { key, json: JSON.parse(row.json) } : null;
}

function claims(req, id, limit = 3) {
  const rows = db(req).prepare(`
    SELECT claims.id AS claim_id, claims.response_id, claims.customer_email, claims.amount,
           responses.form_id, responses.definition_version, responses.created_at, responses.data
    FROM claims JOIN responses ON responses.id = claims.response_id
    ${id ? "WHERE responses.id = ?" : ""} ORDER BY claims.id DESC LIMIT ?`).all(...(id ? [id] : []), limit);
  return {
    claims: rows.map((r) => ({ claim_id: r.claim_id, response_id: r.response_id, customer_email: r.customer_email, amount: r.amount })),
    responses: rows.map((r) => ({
      id: r.response_id, form_id: r.form_id, definition_version: r.definition_version, created_at: r.created_at, data: JSON.parse(r.data),
    })),
  };
}

function relaySnapshot(req, relay) {
  const config = req.app.locals.config;
  const id = query(req, "room") ?? "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  if (!config.demoMode) return "The relay writes room snapshots in demo mode only (DEMO_MODE=true)";
  const path = snapshotPath(config, roomKey(req.sandbox.id, id), relay);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : "No room data";
}

function rowCounts(req) {
  return Object.fromEntries(["forms", "responses", "progress", "files", "claims", "variable_presets"]
    .map((table) => [table, db(req).prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]));
}

const files = (req, limit) => db(req).prepare("SELECT id, name, type FROM files ORDER BY rowid DESC LIMIT ?").all(limit);

/** The Data panel's sections for an example, or undefined for an unknown slug. */
export function stored(slug, req) {
  const id = /^\s*\+?\d+\s*$/.test(query(req, "id") ?? "") ? Number(query(req, "id")) || null : null;
  const key = (fallback) => query(req, "key") ?? fallback;
  switch (slug) {
    case "save-response": return { responses: responses(req, id ? null : "contact", id) };
    case "load-definition-variables-data": return { responses: responses(req, "claim", id, 5, id ? null : (req.user?.email ?? "")) };
    case "resume-progress": return {
      progress: documents(req, "progress", `${req.user?.id ?? ""}:${key("onboarding")}`),
      responses: responses(req, "onboarding", id),
    };
    case "store-files": return { responses: responses(req, "expenses", id, 3), files: files(req, 10) };
    case "choices-from-web": return {
      responses: responses(req, "visit", id, 3),
      offices: db(req).prepare("SELECT id, name, region FROM offices ORDER BY region, name").all(),
      "countries cache": cache.has("countries") ? "cached for 24 hours" : "empty: the next request fetches restcountries.com",
    };
    case "async-functions": return {
      customers: db(req).prepare("SELECT email FROM customers").all().map((row) => row.email),
      shipping_rates: db(req).prepare("SELECT postcode_prefix, price FROM shipping_rates ORDER BY postcode_prefix").all(),
    };
    case "relational-storage": return claims(req, id);
    case "fill-together": return { "relay room": relaySnapshot(req, "fill"), responses: responses(req, "job-sheet", id, 3) };
    case "dashboard": return { responses: db(req).prepare("SELECT COUNT(*) AS n FROM responses WHERE form_id = 'feedback'").get().n };
    case "creator-load-save": return { forms: documents(req, "forms", key("support")) };
    case "ai-translation": return { forms: documents(req, "forms", "support-translations") };
    case "creator-uploads": return { forms: documents(req, "forms", "support-assets"), files: files(req, 5) };
    case "variable-presets": return { variable_presets: documents(req, "variable_presets", key("support")) };
    case "edit-together": return { "relay room": relaySnapshot(req, "edit"), forms: documents(req, "forms", key("support-team")) };
    case "validate-response": return { responses: responses(req, "claim", id) };
    case "lint-definition": return { forms: documents(req, "forms", "support-lint") };
    case "server-pdf": return { responses: responses(req, "claim", id, 10) };
    case "extract-from-paper": return { "row counts": rowCounts(req), responses: responses(req, "work-order", id, 3) };
    default: return undefined;
  }
}

/** GET /demo/stored/:slug */
export function storedRoute(app) {
  app.get("/demo/stored/:slug", (req, res, next) => {
    const sections = stored(req.params.slug, req);
    if (sections === undefined) return next();
    res.json(sections);
  });
}
