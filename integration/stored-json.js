// Stores SurveyJS JSON (responses, definitions, saved progress, variable presets) exactly as it arrived. A response
// or a definition is one JSON document: store it as text, never as columns. Used by save-response,
// relational-storage, validate-response and the fill-together relay. When you copy one of them, copy this file too.
import { db } from "../db.js";

/**
 * ISO 8601 UTC without milliseconds, 2026-11-15T12:00:00Z: the stored format on every platform, so seeded and
 * new rows compare correctly as strings (the dashboard's from and to filters). toISOString() adds .000.
 */
export function timestamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Insert one response and return its id. The answers are stored as JSON.stringify(data) of the parsed body and
 * nothing else: a copy (spread, Object.assign, structuredClone) would turn a "__proto__" key that JSON.parse
 * created as an own property into the copy's prototype, and the key would be lost.
 * @param {import("express").Request | import("node:sqlite").DatabaseSync} source the request, or a relay's database
 */
export function insertResponse(source, formId, data, definitionVersion = null) {
  const { lastInsertRowid } = db(source)
    .prepare("INSERT INTO responses (form_id, definition_version, data, created_at) VALUES (?, ?, ?, ?)")
    .run(formId, definitionVersion, JSON.stringify(data), timestamp());
  return Number(lastInsertRowid);
}
