// PUT /api/forms/:id, linted before it is stored
// Used in place of the PUT in creator-load-save.js when LINT_DEFINITIONS=true (app.js). survey-core's linter runs
// right here, as it runs in SurveyJS Server (src/validator.ts).
import { lintSurvey } from "survey-core/linter";
import { can } from "../auth.js";
import { db } from "../db.js";
import { httpError } from "../integration/http.js";
import { lintOptions } from "../integration/surveyjs.js";

export default function lintDefinition(app) {
  // #region sjs:lint-definition.server
  // PUT /api/forms/:id — lint the definition from Creator before storing it
  app.put("/api/forms/:id", (req, res) => {
    const denied = can(req.user, "edit-forms");
    if (denied) throw httpError(403, denied);
    const definition = req.body;   // the parsed raw body: {} stays {} (see Load and Save Form JSON Schemas)
    if (definition === null || typeof definition !== "object" || Array.isArray(definition)) {
      throw httpError(400, "Expected a form definition");
    }

    const { findings } = lintSurvey(definition, lintOptions);
    const errors = findings.filter((finding) => finding.severity === "error");
    const warnings = findings.filter((finding) => finding.severity !== "error");
    if (errors.length > 0) return res.status(422).json({ errors, warnings });   // refuse the save: the previous version stays

    db(req).prepare("INSERT INTO forms (key, json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET json = excluded.json")
      .run(req.params.id, JSON.stringify(definition));   // stored as it arrived, never a copy
    if (warnings.length > 0) return res.json({ warnings });   // warnings don't block the save
    res.sendStatus(204);
  });
  // #endregion
}
