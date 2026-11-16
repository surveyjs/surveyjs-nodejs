// GET /api/claims/:id/pdf
// survey-pdf runs right here, as it runs in SurveyJS Server (src/pdf.ts); integration/surveyjs.js holds the call.
import { readFileSync } from "node:fs";
import { lintSurvey } from "survey-core/linter";
import { db } from "../db.js";
import { httpError } from "../integration/http.js";
import { lintOptions, surveyjs } from "../integration/surveyjs.js";

const versioned = (version) => readFileSync(new URL(`../shared/definitions/relational-storage.${version}.json`, import.meta.url), "utf8");

export default function serverPdf(app) {
  // #region sjs:server-pdf.server
  // GET /api/claims/:id/pdf — fill the claim's definition with its answers and send the PDF
  app.get("/api/claims/:id/pdf", async (req, res) => {
    const claim = /^\d+$/.test(req.params.id)
      ? db(req).prepare("SELECT data, definition_version FROM responses WHERE form_id = 'claim' AND id = ?").get(req.params.id)
      : undefined;
    if (!claim) throw httpError(404, "Unknown claim");
    const version = claim.definition_version;   // use the schema version recorded with the response
    const json = ["v1", "v2"].includes(version) ? versioned(version)
      : version === null ? db(req).prepare("SELECT json FROM forms WHERE key = 'claim'").get()?.json : undefined;
    if (json === undefined) throw httpError(409, "The schema version for this claim is unavailable");
    const definition = JSON.parse(json);
    if (lintSurvey(definition, lintOptions).findings.some((finding) => finding.severity === "error")) {
      surveyjs.logFailure("server-pdf", `the definition of claim ${req.params.id} has errors`);
      return res.status(500).json({ error: "The stored definition has errors" });
    }

    const pdf = await surveyjs.renderPdf(definition, JSON.parse(claim.data)).catch((error) => error);   // new SurveyPDF(…)
    if (!surveyjs.isPdf(pdf)) {   // it threw, or its bytes aren't a PDF
      surveyjs.logFailure("server-pdf", pdf);
      return res.status(500).json({ error: "Couldn't generate the PDF" });
    }
    res.set({ "Content-Disposition": `inline; filename="claim-${req.params.id}.pdf"`, "Cache-Control": "private, no-store" });
    res.type("pdf").send(pdf);
  });
  // #endregion
}
