// PUT /api/forms/:id
// GET /api/forms/:id is in load-definition-variables-data.js: Creator reads its .definition.
// This file holds only the PUT, so LINT_DEFINITIONS=true can swap in lint-definition.js (app.js).
import { can } from "../auth.js";
import { db } from "../db.js";
import { httpError } from "../integration/http.js";

export default function creatorLoadSave(app) {
  // #region sjs:creator-load-save.server
  // PUT /api/forms/:id — store the definition as-is: it's one JSON document
  app.put("/api/forms/:id", (req, res) => {
    const denied = can(req.user, "edit-forms");   // editing is an admin action: 403 otherwise
    if (denied) throw httpError(403, denied);
    if (req.body === undefined) throw httpError(400, "Expected a form definition");   // not a JSON body
    // req.body is the parsed raw body: {} stays {}; store it with JSON.stringify, never a copy
    db(req).prepare("INSERT INTO forms (key, json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET json = excluded.json")
      .run(req.params.id, JSON.stringify(req.body));

    res.sendStatus(204);   // the next page load renders the new version
  });
  // #endregion
}
