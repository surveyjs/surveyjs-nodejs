// GET /api/work-orders/blank.pdf, POST /api/work-orders/extract
// survey-pdf and ai-form-response-extractor run right here, as they run in SurveyJS Server (src/pdf.ts,
// src/extractor.ts, src/provider.ts). The answers come back as a draft: nothing is saved until a person reviews them.
import { createExtractor } from "ai-form-response-extractor";
import multer from "multer";
import { lintSurvey } from "survey-core/linter";
import { db } from "../db.js";
import { AiConfigurationError, aiProvider } from "../integration/ai-provider.js";
import { detectType } from "../integration/file-type.js";
import { httpError } from "../integration/http.js";
import { lintOptions, surveyjs } from "../integration/surveyjs.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const TOO_LARGE = "The scan must be a file of 5 MB or less";

/** multer's errors, in the contract's words. On the demo, demo/upload-limit.js answers the 5 MB case itself. */
function scanErrors(err, req, res, next) {
  if (err.code === "LIMIT_FILE_SIZE") return next(httpError(413, TOO_LARGE, { code: err.code }));
  if (err.code === "LIMIT_UNEXPECTED_FILE") {   // a second scan, or a file in another field
    return next(err.field === "scan" ? httpError(413, TOO_LARGE) : httpError(400, 'Upload the scan in a field named "scan"'));
  }
  next(err);
}

// The in-process mapping's answers for a failed extraction
const EXTRACTION_ERRORS = {
  503: "No AI provider is configured for document extraction",   // none chosen, an unknown one, or its key missing
  504: "The AI provider timed out",                               // no answer within 120 s
  502: "Could not extract the response from the document",        // unreachable, an HTTP error, or an answer it can't use
};

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const workOrder = (req) => db(req).prepare("SELECT json FROM forms WHERE key = 'work-order'").get();

export default function extractFromPaper(app) {
  // #region sjs:extract-from-paper.template
  // Generate a blank, fillable PDF using the same schema as extraction
  app.get("/api/work-orders/blank.pdf", async (req, res) => {
    const form = workOrder(req);
    if (!form) throw httpError(404, "Unknown work order form");
    const definition = JSON.parse(form.json);
    if (lintSurvey(definition, lintOptions).findings.some((finding) => finding.severity === "error")) {
      surveyjs.logFailure("blank work order", "the work-order definition has errors");
      return res.status(500).json({ error: "The stored definition has errors" });
    }

    const pdf = await surveyjs.renderPdf(definition).catch((error) => error);   // new SurveyPDF(…) without answers
    if (!surveyjs.isPdf(pdf)) {   // it threw, or its bytes aren't a PDF
      surveyjs.logFailure("blank work order", pdf);
      return res.status(500).json({ error: "Couldn't generate the PDF" });
    }
    res.set({ "Content-Disposition": 'attachment; filename="work-order.pdf"', "Cache-Control": "private, no-store" });
    res.type("pdf").send(pdf);
  });
  // #endregion

  // #region sjs:extract-from-paper.server
  // POST /api/work-orders/extract — read the answers from the uploaded scan; return them as a draft response
  app.post("/api/work-orders/extract", upload.single("scan"), async (req, res) => {
    if (!req.file) throw httpError(400, 'Upload the scan in a field named "scan"');
    if (!detectType(req.file.buffer)) throw httpError(400, "The file is not a PDF, PNG, JPEG, WebP or GIF document");
    const definition = JSON.parse(workOrder(req).json);
    if (lintSurvey(definition, lintOptions).findings.some((finding) => finding.severity === "error")) {
      surveyjs.logFailure("extract-from-paper", "the work-order definition has errors");
      return res.status(500).json({ error: "The stored definition has errors" });
    }
    let result;
    try {
      const provider = aiProvider.create(req.app.locals.config.extraction);   // from SURVEYJS_AI_PROVIDER and its key
      const extractor = createExtractor({ provider, adapter: "surveyjs", options: {} });
      const formDefinition = surveyjs.toFormDefinition(definition);
      result = await surveyjs.withTimeout(extractor.extractFromImage({ image: req.file.buffer, formDefinition }), 120_000);
      if (!isObject(result?.data)) throw new TypeError("The extractor returned no answers object");
    } catch (error) {
      const status = error instanceof AiConfigurationError ? 503 : error.name === "TimeoutError" ? 504 : 502;
      if (status !== 503) surveyjs.logFailure("extract-from-paper", error, { withMessage: false });   // it may quote the answers
      return res.status(status).json({ error: EXTRACTION_ERRORS[status] });
    }
    const { data: answers, confidence = [], uniqueId = null } = result;   // never rawResponse: it repeats the whole form
    res.json({ answers, confidence, uniqueId });
  }, scanErrors);
  // #endregion
}
