// GET|PUT|DELETE /api/progress/:formId
import { db } from "../db.js";
import { httpError } from "../integration/http.js";

export default function resumeProgress(app) {
  // #region sjs:resume-progress.server
  // Return the current user's saved answers and UI state
  app.get("/api/progress/:formId", (req, res) => {
    if (!req.user) throw httpError(401, "Sign in to load progress");
    const row = db(req).prepare("SELECT json FROM progress WHERE key = ?").get(`${req.user.id}:${req.params.formId}`);

    res.type("json").send(row?.json ?? "null");   // the document as stored, or null when there is none
  });

  // Store progress under a key containing both the user ID and form ID
  app.put("/api/progress/:formId", (req, res) => {
    if (!req.user) throw httpError(401, "Sign in to save progress");
    if (req.body === undefined) throw httpError(400, "Expected { data, uiState }");   // not a JSON body
    // req.body is the parsed raw body: {} stays {}; store it with JSON.stringify, never a copy
    db(req).prepare("INSERT INTO progress (key, json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET json = excluded.json")
      .run(`${req.user.id}:${req.params.formId}`, JSON.stringify(req.body));

    res.sendStatus(204);
  });
  // #endregion

  // #region sjs:resume-progress.delete
  // Remove only the current user's draft
  app.delete("/api/progress/:formId", (req, res) => {
    if (!req.user) throw httpError(401, "Sign in to clear progress");
    db(req).prepare("DELETE FROM progress WHERE key = ?").run(`${req.user.id}:${req.params.formId}`);

    res.sendStatus(204);
  });
  // #endregion
}
