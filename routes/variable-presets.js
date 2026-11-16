// GET|PUT /api/variable-presets/:formId
import { can } from "../auth.js";
import { db } from "../db.js";
import { httpError } from "../integration/http.js";

export default function variablePresets(app) {
  // #region sjs:variable-presets.server
  // GET /api/variable-presets/:formId — return the stored preset list, or [] when none are saved
  app.get("/api/variable-presets/:formId", (req, res) => {
    const row = db(req).prepare("SELECT json FROM variable_presets WHERE key = ?").get(req.params.formId);

    res.type("json").send(row?.json ?? "[]");
  });

  // PUT /api/variable-presets/:formId — store the variable presets as-is: it's one JSON document
  app.put("/api/variable-presets/:formId", (req, res) => {
    const denied = can(req.user, "edit-forms");   // editing is an admin action: 403 otherwise
    if (denied) throw httpError(403, denied);
    if (req.body === undefined) throw httpError(400, "Expected a list of presets");   // not a JSON body
    // req.body is the parsed raw body: {} stays {}; store it with JSON.stringify, never a copy
    db(req).prepare("INSERT INTO variable_presets (key, json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET json = excluded.json")
      .run(req.params.formId, JSON.stringify(req.body));

    res.sendStatus(204);
  });
  // #endregion
}
