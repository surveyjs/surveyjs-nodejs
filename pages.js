// Demo only: the catalog and the example pages around the examples, the shared client files, the SurveyJS browser
// builds and the health route. The integration code is in routes/<slug>.js; these routes only show it running.
import express from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";
import { httpError } from "./integration/http.js";
import { currentBuild } from "./demo/build.js";
import { codeDefinitions, codePanel } from "./demo/code-panel.js";
import { BROWSER_PACKAGES, HIGHLIGHT_THEME, buildImportMap } from "./demo/import-map.js";
import { docsUrl, findStep, readManifest } from "./demo/manifest.js";
import { storedRoute } from "./demo/stored.js";
import { LABELS, forPage, signInForPage, userKey } from "./demo/users.js";

/** The catalog's browser title, and the example pages' header next to the SurveyJS pill */
export const TITLE = "Node.js Backend Integration with Express";
/** The catalog header, next to the logo */
export const HEADER = "Step-by-Step Node.js Backend Integration with Express";

const shared = (path) => fileURLToPath(new URL(`./shared/${path}`, import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

/** What needs no database, user or sandbox: /up, /shared/<four folders> and /vendor/<package>@<version>. */
export function staticRoutes(app) {
  // Health: answers without touching the database
  app.get("/up", (req, res) => res.json({ status: "ok" }));

  // Shared client modules, definitions, samples and the page UI live outside public/: serve only those four folders
  for (const folder of ["client", "definitions", "samples", "ui"]) {
    app.use(`/shared/${folder}`, express.static(shared(folder), { index: false, fallthrough: false, dotfiles: "ignore" }));
  }

  // The SurveyJS browser builds, from this app's node_modules. The version is in the URL, so they cache for a year.
  const { version, packages } = app.locals.importMap;
  for (const name of BROWSER_PACKAGES) {
    app.use(`/vendor/${name}@${version}`, express.static(packages[name], { index: false, fallthrough: false, immutable: true, maxAge: "1y" }));
  }

  // send answers 403 for a path with "..": nothing outside the folders exists, so say 404
  app.use(["/shared", "/vendor"], (err, req, res, next) => (err.status >= 400 && err.status < 500 ? res.status(404).type("text").send("Not found") : next(err)));
}

/** The pages: the catalog, /examples/<slug>, /claim's frame, the PDF loading page and the Data panel. */
export function pages(app) {
  const config = app.locals.config;

  app.get("/", (req, res) => {
    const manifest = readManifest();
    res.render("catalog", { ...siteLocals(req), manifest, groups: Object.groupBy(manifest.steps, (step) => step.section) });
  });

  app.get("/examples/server-pdf/loading", (req, res) => res.render("examples/pdf-loading", siteLocals(req)));

  // Option A of load-definition-variables-data renders the example page itself (routes/load-definition-variables-data.js)
  app.get("/claim", (req, res, next) => {
    signInForPage("load-definition-variables-data", req, res);
    Object.assign(res.locals, exampleLocals(req, findStep("load-definition-variables-data")));
    next();
  });

  app.get("/examples/:slug", (req, res, next) => {
    const step = /^[a-z0-9-]+$/.test(req.params.slug) ? findStep(req.params.slug) : undefined;
    if (!step) return next();   // an unknown example: Express's 404 page
    signInForPage(step.slug, req, res);
    res.render(`examples/${step.slug}`, { ...exampleLocals(req, step), ...(PAGE_DATA[step.slug]?.(req, config) ?? {}) });
  });

  storedRoute(app);
}

/** What the catalog, the PDF loading page and the example pages all read. */
function siteLocals(req) {
  const config = req.app.locals.config;
  const origin = `${req.protocol}://${req.host}`;
  return {
    title: TITLE,
    header: HEADER,
    config,
    build: currentBuild(config),
    docs: docsUrl(config),
    canonical: origin + req.path,   // https behind a TLS proxy: trust proxy reads X-Forwarded-Proto
    fonts: ["Regular", "Medium", "Semibold", "Bold"].map((weight) => `/shared/ui/fonts/lato/LatoLatin-${weight}.woff2`),
    query: req.query,
  };
}

/** Everything the example layout (views/layouts/example.njk) reads. */
function exampleLocals(req, step) {
  const config = req.app.locals.config;
  const importMap = req.app.locals.importMap;
  const vendor = (name, file) => `/vendor/${name}@${importMap.version}/${file}`;
  return {
    ...siteLocals(req),
    step,
    page: pageConfig(req, step),
    users: forPage(step.slug),
    labels: LABELS,
    user: req.user,
    commercial: step.licence.startsWith("Commercial"),
    needsAi: step.licence.includes("needs an AI provider"),
    stepDocs: docsUrl(config, step),
    joinFailed: req.demoJoinFailed === true,
    codeDefinitions: codeDefinitions(config, step),
    codePanel: codePanel(config, step),
    importMap: { imports: importMap.imports },
    styles: {
      survey: [vendor("survey-core", "survey-core.min.css"), vendor("survey-core", "collaboration.min.css"),
        vendor("survey-core", "themes/adapters/tailwind4.min.css"), "/shared/ui/survey-overrides.css"],
      creator: [vendor("survey-core", "survey-core.min.css"), vendor("survey-creator-core", "survey-creator-core.min.css"),
        vendor("survey-creator-core", "collaboration.min.css"), vendor("survey-core", "themes/adapters/tailwind4.min.css")],
      dashboard: [vendor("survey-core", "survey-core.min.css"), vendor("survey-analytics", "survey.analytics.min.css"),
        vendor("survey-core", "themes/adapters/tailwind4.min.css")],
    },
    highlightTheme: HIGHLIGHT_THEME,
  };
}

/** window.SURVEYJS_PAGE: what shared/client/host.js and the example modules read. */
function pageConfig(req, step) {
  const config = req.app.locals.config;
  const definitions = Object.fromEntries(Object.entries(step.files)
    .filter(([role]) => role.startsWith("definition"))
    .map(([role, path]) => [role, readJson(path)]));
  if (step.slug === "extract-from-paper") {
    const form = db(req).prepare("SELECT json FROM forms WHERE key = 'work-order'").get();
    if (!form) throw httpError(404, "Unknown work order form");
    definitions.definition = JSON.parse(form.json);
  }
  // The relays run in this process: the page's own origin, ws or wss as the visitor sees it (X-Forwarded-Proto)
  const origin = `${req.protocol === "https" ? "wss" : "ws"}://${req.host}`;
  return {
    slug: step.slug,
    version: readManifest().surveyjsVersion,
    licenseKey: config.licenseKey,
    demoUser: userKey(req),
    user: req.user ? { key: req.user.key, name: req.user.name, plan: req.user.plan, isEditor: req.user.isEditor } : null,
    relay: {
      fill: { url: config.relay.fillUrl ?? origin, port: config.port },
      edit: { url: config.relay.editUrl ?? origin, port: config.port },
    },
    demoMode: config.demoMode,
    sandboxId: req.sandbox?.id ?? null,
    switches: { validateResponses: config.validateResponses, lintDefinitions: config.lintDefinitions },
    ...definitions,
  };
}

// What some example views compute before they render: the reference does this in the views' @php blocks.
const records = (req, formId, labelKey, customerEmail = null) =>
  db(req).prepare(`SELECT id, data FROM responses WHERE form_id = ? ${customerEmail === null ? "" : "AND data ->> '$.customer_email' = ?"}
    ORDER BY id LIMIT 10`).all(formId, ...(customerEmail === null ? [] : [customerEmail]))
    .map((row) => ({ id: String(row.id), label: `#${row.id} · ${JSON.parse(row.data)[labelKey] ?? ""}` }));

const queryString = (req, name, fallback) => (typeof req.query[name] === "string" ? req.query[name] : fallback);

const PAGE_DATA = {
  "load-definition-variables-data": (req) => ({
    record: queryString(req, "record", ""),
    records: records(req, "claim", "customer_email", req.user?.email ?? ""),
  }),
  "fill-together": (req) => {
    const list = records(req, "job-sheet", "customer");
    const record = queryString(req, "record", list[0]?.id ?? "new");
    return { records: list, record, known: list.some((r) => r.id === record) };
  },
  "edit-together": (req) => {
    const formId = req.query.form ?? "support-team";
    if (typeof formId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(formId)) throw httpError(400, "Invalid form ID");
    const forms = db(req).prepare("SELECT key, json FROM forms WHERE key LIKE '%-team' OR key LIKE 'team-%' ORDER BY key").all()
      .map((row) => {
        const title = JSON.parse(row.json).title;
        return { id: row.key, label: (typeof title === "string" ? title : title?.default) || "Untitled form" };
      });
    return { forms, formId, known: forms.some((f) => f.id === formId) };
  },
  "relational-storage": (req) => ({ version: req.query.version === "v2" ? "v2" : "v1" }),
  "server-pdf": (req) => ({
    claims: db(req).prepare("SELECT id, data FROM responses WHERE form_id = 'claim' ORDER BY id DESC LIMIT 10").all().map((row) => {
      const answers = JSON.parse(row.data);
      const email = answers?.customer_email;
      return { id: row.id, label: ["string", "number", "boolean"].includes(typeof email) ? email : "No email provided", json: JSON.stringify(answers, null, 4) };
    }),
  }),
  "creator-load-save": (req) => ({ formMode: req.query.form !== undefined }),
  "creator-uploads": (req) => ({ formMode: req.query.form !== undefined }),
};
