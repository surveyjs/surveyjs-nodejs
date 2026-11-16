// Run Server-Side Workflows, in process: the plumbing around the SurveyJS calls the route files make. The same
// libraries SurveyJS Server uses (https://github.com/surveyjs/surveyjs-server at db1ac24: src/validator.ts, pdf.ts,
// extractor.ts) run inside this app, so it accepts and rejects what the service does. When you copy validate-response,
// lint-definition, server-pdf or extract-from-paper, copy this file too.
//
// Why no 502 or 504 for lint, validation or PDFs: they run on this app's CPU, so a failure there is this app's own
// error (500), and a timer can't stop synchronous work. 502 and 504 are kept for the AI provider, the one upstream left.
import { SurveyPDF } from "survey-pdf";

/**
 * The service's linter options. The linter reports an unknown element, validator or trigger type below the error
 * level, but the deserializer drops such an object, so a response would be validated against less than the
 * definition says: raise them to errors.
 */
export const lintOptions = {
  rules: { "element/unknown-type": "error", "validator/unknown-type": "error", "trigger/unknown-type": "error" },
};

export const surveyjs = {
  /**
   * The errors of a response, as validator.ts collects them: the data errors from setData(), then every question's
   * getAllErrors() (matrix cells, multiple text items and dynamic panels included) and every panel's errors.
   * @param {import("survey-core").SurveyModel} survey after setData() and validate()
   */
  responseErrors(survey, dataErrors) {
    return [
      ...dataErrors,
      ...survey.getAllQuestions(true).flatMap((question) => question.getAllErrors()),
      ...survey.getAllPanels(true).flatMap((panel) => panel.errors),
    ];
  },

  /** A PDF of the definition, filled with data when given (otherwise a blank, fillable form), as pdf.ts makes it. */
  async renderPdf(definition, data) {
    const pdf = new SurveyPDF(definition, {});
    if (data) pdf.data = data;
    return Buffer.from(await pdf.raw("arraybuffer"));
  },

  /** True for PDF bytes: a renderer that answers anything else has failed. */
  isPdf(bytes) {
    return Buffer.isBuffer(bytes) && bytes.toString("latin1", 0, 5) === "%PDF-";
  },

  /** Rejects with a TimeoutError after ms. The extractor takes no AbortSignal, so its request runs on unseen. */
  withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`No answer within ${ms / 1000} s`), { name: "TimeoutError" })), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  },

  /**
   * Log a failure of this app's SurveyJS work or of the AI provider. Extraction errors are logged by name only:
   * their messages may quote the AI's answer, which holds the answers written on the form.
   */
  logFailure(what, error, { withMessage = true } = {}) {
    const detail = error instanceof Error ? (withMessage ? error.stack : error.name) : String(error ?? "no PDF bytes");
    console.error(`${what}: ${detail}`);
  },

  /** The extractor looks for questions in `pages` only; a definition without pages keeps them at the root (extractor.ts). */
  toFormDefinition(definition) {
    const rootElements = definition.elements ?? definition.questions;
    if (Array.isArray(definition.pages) || !Array.isArray(rootElements)) return definition;
    const { elements, questions, ...rest } = definition;
    return { ...rest, pages: [{ elements: rootElements }] };
  },
};
