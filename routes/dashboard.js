// GET /api/responses
import { db } from "../db.js";

export default function dashboard(app) {
  // #region sjs:dashboard.server
  // GET /api/responses?formId=&includeCreatedAt=&from=&to=&limit=&offset=
  app.get("/api/responses", (req, res) => {
    const query = (name, fallback) => (typeof req.query[name] === "string" ? req.query[name] : fallback);
    const to = query("to");
    const limit = Math.min(Math.max(Number.parseInt(query("limit", "500"), 10) || 0, 1), 5000);   // page on the server
    const offset = Math.max(Number.parseInt(query("offset", "0"), 10) || 0, 0);
    const rows = db(req).prepare(`SELECT data, created_at FROM responses
      WHERE form_id = ? AND created_at >= ? ${to ? "AND substr(created_at, 1, 10) <= ?" : ""}
      ORDER BY created_at, id LIMIT ? OFFSET ?`)   // ISO 8601 UTC strings compare as dates
      .all(query("formId", ""), query("from", "1970-01-01"), ...(to ? [to] : []), limit, offset);

    // Include submission dates separately when requested by Dashboard
    if (/^(1|true|on|yes)$/.test(query("includeCreatedAt", ""))) {
      return res.json(rows.map((row) => ({ data: JSON.parse(row.data), createdAt: row.created_at })));
    }
    res.type("json").send(`[${rows.map((row) => row.data).join(",")}]`);   // documents as stored, not re-encoded
  });
  // #endregion
}
