// POST /api/responses, validated against the stored definition
// Used in place of save-response.js when VALIDATE_RESPONSES=true (app.js). survey-core runs right here, as it runs
// in SurveyJS Server (src/validator.ts).
import { Model } from "survey-core";
import { lintSurvey } from "survey-core/linter";
import { db } from "../db.js";
import { httpError } from "../integration/http.js";
import { insertResponse } from "../integration/stored-json.js";
import { lintOptions, surveyjs } from "../integration/surveyjs.js";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export default function validateResponse(app) {
  // #region sjs:validate-response.server
  // POST /api/responses — validate the answers against the stored definition, then store them as usual
  app.post("/api/responses", (req, res) => {
    const { formId, data } = req.body ?? {};   // the parsed raw body: {} stays {} (see Save Responses)
    if (typeof formId !== "string" || !isObject(data)) throw httpError(400, "Expected { formId, data } with an answers object");
    const form = db(req).prepare("SELECT json FROM forms WHERE key = ?").get(formId);
    if (!form) throw httpError(404, "Unknown form");
    const definition = JSON.parse(form.json);
    if (lintSurvey(definition, lintOptions).findings.some((finding) => finding.severity === "error")) {
      surveyjs.logFailure("validate-response", `the stored definition of ${formId} has errors`);
      return res.status(500).json({ error: "The stored definition has errors" });   // a broken form is this app's fault
    }

    const survey = new Model(definition);
    const dataErrors = survey.setData(data, {});   // unknown keys, wrong value types, choices that don't exist
    const valid = survey.validate();               // required answers and the definition's validators
    if (dataErrors.length > 0 || !valid) return res.status(400).json({ errors: surveyjs.responseErrors(survey, dataErrors) });

    const id = insertResponse(req, formId, data);   // stored as it arrived, never a copy
    res.status(201).json({ id });
  });
  // #endregion
}
