// The Express app: the JSON parser, the demo middleware and pages, then each example's routes in the order of the
// integration docs, then JSON errors for everything under /api. server.js starts it; the tests call createApp().
import express from "express";
import nunjucks from "nunjucks";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pages, staticRoutes } from "./pages.js";
import { buildImportMap } from "./demo/import-map.js";
import { demoAiLimit } from "./demo/ai-limit.js";
import { demoCacheHeader } from "./demo/cache-header.js";
import { demoSandbox } from "./demo/sandbox.js";
import { demoUploadLimit } from "./demo/upload-limit.js";
import { demoUsers } from "./demo/users.js";
import saveResponse from "./routes/save-response.js";
import validateResponse from "./routes/validate-response.js";
import loadDefinitionVariablesData from "./routes/load-definition-variables-data.js";
import resumeProgress from "./routes/resume-progress.js";
import storeFiles from "./routes/store-files.js";
import choicesFromWeb from "./routes/choices-from-web.js";
import asyncFunctions from "./routes/async-functions.js";
import relationalStorage from "./routes/relational-storage.js";
import dashboard from "./routes/dashboard.js";
import creatorLoadSave from "./routes/creator-load-save.js";
import lintDefinition from "./routes/lint-definition.js";
import aiTranslation from "./routes/ai-translation.js";
import variablePresets from "./routes/variable-presets.js";
import serverPdf from "./routes/server-pdf.js";
import extractFromPaper from "./routes/extract-from-paper.js";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

/** @param {ReturnType<import("./config.js").readConfig>} config */
export function createApp(config) {
  const app = express();
  app.locals.config = config;
  app.locals.importMap = buildImportMap();   // stops here when node_modules doesn't match shared/surveyjs-version.json
  app.set("env", config.env);
  // Behind a TLS proxy (Traefik, nginx, App Service): req.protocol, req.host and req.secure from X-Forwarded-*.
  // This trusts any proxy; in your own production, narrow it to the proxy's address ("loopback", a subnet).
  app.set("trust proxy", true);
  app.disable("x-powered-by");
  mkdirSync(join(config.dataDir, "files"), { recursive: true });

  // The page templates: Nunjucks, autoescaped. script_json escapes JSON for an inline <script>.
  const views = nunjucks.configure(here("./views"), { express: app, autoescape: true, noCache: config.env !== "production" });
  views.addFilter("script_json", scriptJson);
  views.addFilter("slug", (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  app.set("view engine", "njk");

  // Files that need no database: /up, /shared/<four folders>, /vendor/<SurveyJS package>@<version>, public/
  staticRoutes(app);
  app.use(express.static(here("./public"), { index: false }));

  // Demo only: the visitor's sandbox (DEMO_MODE=true), then the demo user from the demo_user cookie
  app.use(demoSandbox(config));
  app.use(demoUsers);

  // JSON bodies, parsed from the raw body. strict: false hands every JSON value to the handler, so each one checks
  // its own envelope (a top-level null or string is a wrong envelope, not a parse error). 12 MB: a Creator definition
  // with images or a long form is bigger than the 100 KB default. Other content types leave req.body undefined.
  app.use(express.json({ limit: "12mb", strict: false }));

  // Demo only: the catalog, the example pages and the Data panel
  pages(app);

  // Run Forms
  (config.validateResponses ? validateResponse : saveResponse)(app);   // POST /api/responses (validated when VALIDATE_RESPONSES=true)
  loadDefinitionVariablesData(app);   // GET /claim, GET /api/forms/:id
  resumeProgress(app);                // GET|PUT|DELETE /api/progress/:formId
  storeFiles(app);                    // POST /api/files, GET /api/files/:id
  app.use("/api/countries", demoCacheHeader);   // Demo only: X-Demo-Cache
  choicesFromWeb(app);                // GET /api/offices, GET /api/countries
  asyncFunctions(app);                // GET /api/customers/exists, GET /api/shipping
  relationalStorage(app);             // POST /api/claims
  // fill-together is a WebSocket relay in this process: relay/fill-relay.js, attached in server.js

  // Analyze Results with Dashboard
  dashboard(app);                     // GET /api/responses

  // Edit Forms in Survey Creator (creator-uploads reuses POST /api/files from store-files)
  (config.lintDefinitions ? lintDefinition : creatorLoadSave)(app);   // PUT /api/forms/:id (linted when LINT_DEFINITIONS=true)
  app.use(["/api/translate", "/api/work-orders/extract"], demoAiLimit(config));   // Demo only: 20 AI calls a day
  aiTranslation(app);                 // POST /api/translate
  variablePresets(app);               // GET|PUT /api/variable-presets/:formId
  // edit-together is a WebSocket relay in this process: relay/edit-relay.js, attached in server.js

  // Run Server-Side Workflows (validate-response and lint-definition are switched in above)
  serverPdf(app);                     // GET /api/claims/:id/pdf
  extractFromPaper(app);              // GET /api/work-orders/blank.pdf, POST /api/work-orders/extract

  // Under /api every answer is JSON, also Express's own: an unknown path is 404, a known path with another method 405
  app.all("/api/*path", (req, res) => {
    const allowed = allowedMethods(app, req.path);
    if (allowed.length === 0) return res.status(404).json({ error: "Not found" });
    res.set("Allow", allowed.join(", ")).status(405).json({ error: "Method not allowed" });
  });
  app.use(demoUploadLimit(config));   // Demo only: the 5 MB upload cap's own answer
  app.use(apiErrors);
  app.use(pageErrors);
  return app;
}

const MESSAGES = {
  400: "Bad request", 401: "Unauthorized", 403: "Forbidden", 404: "Not found", 405: "Method not allowed",
  413: "The request body is too large", 415: "Unsupported media type", 422: "Unprocessable content", 429: "Too many requests",
};

/**
 * The same error shape on every platform: { error } with the HTTP status. Express's default handler writes HTML
 * (with a stack trace outside production), so everything under /api ends here; pages keep Express's HTML errors.
 */
function apiErrors(err, req, res, next) {
  if (!req.path.startsWith("/api/") || res.headersSent) return next(err);
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "The request body is not valid JSON" });
  if (err.type === "entity.too.large") return res.status(413).json({ error: MESSAGES[413] });
  if (err.code === "ENOENT") return res.status(404).json({ error: MESSAGES[404] });   // sendFile: never show the path
  let status = err.status ?? err.statusCode;
  if (!(status >= 400 && status < 600)) status = 500;
  if (status >= 500 && !err.expose) console.error(err);   // an exception: log it with its stack
  const fallback = status === 500 ? "Internal server error" : (MESSAGES[status] ?? "Error");
  res.status(status).json({ error: err.expose ? err.message : fallback });
}

/** A page's own 4xx (edit-together's "Invalid form ID") as a short HTML page; anything else goes to Express's handler. */
function pageErrors(err, req, res, next) {
  if (!(err.status >= 400 && err.status < 500 && err.expose) || res.headersSent) return next(err);
  const text = String(err.message).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  res.status(err.status).type("html").send(`<!DOCTYPE html><html lang="en"><title>${err.status}</title><p>${text}</p></html>`);
}

/** The methods the app's routes answer for a path (the 405's Allow header). */
function allowedMethods(app, path) {
  const methods = new Set();
  for (const layer of app.router.stack) {
    if (layer.route?.path === "/api/*path") break;   // the 404 / 405 route itself, and nothing after it
    if (!layer.route || !layer.match(path)) continue;
    for (const method of Object.keys(layer.route.methods)) methods.add(method.toUpperCase());
  }
  if (methods.has("GET")) methods.add("HEAD");
  return [...methods];
}

/** JSON for an inline <script>: `<`, `>`, `&`, U+2028 and U+2029 escaped, so a "</script>" in a title can't end it. */
function scriptJson(value) {
  const json = JSON.stringify(value ?? null).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return new nunjucks.runtime.SafeString(json);
}
