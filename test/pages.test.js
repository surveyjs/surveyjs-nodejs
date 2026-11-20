// The pages: every example renders with its module, the import map and window.SURVEYJS_PAGE, inline JSON can't end
// its <script>, the layout's ids and blocks are where the reference puts them, /shared and /vendor serve only what they
// should, and behind a TLS proxy the page's URLs are https and wss.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readManifest } from "../demo/manifest.js";
import { startApp } from "./helpers.js";

let app;
before(async () => (app = await startApp()));
after(() => app.stop());

const SLUGS = readManifest().steps.map((step) => step.slug);
const START_OVER = ["save-response", "load-definition-variables-data", "resume-progress", "store-files", "choices-from-web", "async-functions",
  "relational-storage", "validate-response", "extract-from-paper"];
const page = async (path, options) => (await app.request("GET", path, options)).text;
const pageConfig = (html) => JSON.parse(/window\.SURVEYJS_PAGE = (.*?);<\/script>/.exec(html)[1]);
const importMap = (html) => JSON.parse(/<script type="importmap">(.*?)<\/script>/.exec(html)[1]);

test("every example page renders its client module after the shared UI, with the import map and the page config", async () => {
  for (const step of readManifest().steps) {
    const r = await app.request("GET", step.page);
    assert.equal(r.status, 200, step.slug);
    const html = r.text;
    const scripts = [...html.matchAll(/<script type="module" src="([^"]+)">/g)].map((m) => m[1]);
    assert.deepEqual(scripts, ["/shared/ui/code-highlight.js", "/shared/ui/page-tabs.js", `/${step.files.client}`], step.slug);
    const map = importMap(html).imports;
    for (const specifier of ["survey-core", "survey-core/collaboration", "survey-core/i18n", "survey-js-ui", "survey-creator-core",
      "survey-creator-core/collaboration", "survey-creator-js", "survey-analytics", "chart.js", "@kurkle/color", "lodash/debounce", "highlight.js/lib/core"]) {
      assert.ok(map[specifier], `${step.slug}: ${specifier}`);
    }
    const config = pageConfig(html);
    assert.equal(config.slug, step.slug);
    assert.equal(config.version, readManifest().surveyjsVersion);
    assert.deepEqual(Object.keys(config.relay), ["fill", "edit"]);
    assert.ok(html.indexOf('<script type="importmap">') < html.indexOf('<script type="module"'), `${step.slug}: the map comes first`);
    for (const role of Object.keys(step.files).filter((role) => role.startsWith("definition"))) assert.ok(config[role], `${step.slug}: ${role}`);
    assert.match(html, new RegExp(`<title>${step.title} · SurveyJS \\+ Express</title>`));
  }
});

test("the import map's SurveyJS files are served from node_modules, and nothing else under /vendor", async () => {
  const { imports } = importMap(await page("/examples/dashboard"));
  for (const [specifier, url] of Object.entries(imports)) {
    if (!url.startsWith("/vendor/")) continue;
    const r = await app.request("GET", url);
    assert.equal(r.status, 200, specifier);
    assert.match(r.headers.get("content-type"), /^text\/javascript/);
    assert.match(r.headers.get("cache-control"), /max-age=31536000, immutable/);
  }
  const version = readManifest().surveyjsVersion;
  for (const path of [`/vendor/express@5.3.0/package.json`, `/vendor/survey-pdf@${version}/`, `/vendor/survey-pdf@${version}/package.json`,
    `/vendor/survey-core@0.0.1/package.json`, `/vendor/survey-core@${version}/../express/package.json`]) {
    assert.equal((await app.request("GET", path)).status, 404, path);
  }
  const creator = `/vendor/survey-creator-core@${version}/images/placeholder-designer.png`;
  assert.equal((await app.request("GET", creator)).headers.get("content-type"), "image/png", "Creator's CSS finds its images");
});

test("/shared serves its four folders with their types and nothing else", async () => {
  for (const [path, type] of [["/shared/ui/page-tabs.js", /^text\/javascript/], ["/shared/client/host.js", /^text\/javascript/],
    ["/shared/samples/support-help.svg", /^image\/svg\+xml/], ["/shared/ui/fonts/lato/LatoLatin-Bold.woff2", /^font\/woff2/],
    ["/shared/definitions/dashboard.json", /^application\/json/], ["/shared/ui/theme.css", /^text\/css/]]) {
    const r = await app.request("GET", path);
    assert.equal(r.status, 200, path);
    assert.match(r.headers.get("content-type"), type, path);
  }
  for (const path of ["/shared/seed/forms.json", "/shared/contract-tests/run.mjs", "/shared/%2e%2e/package.json", "/shared/client/../../package.json",
    "/shared/client/%2e%2e/%2e%2e/package.json", "/shared/ui/", "/shared/CONTRACT", "/shared/client/.hidden"]) {
    const status = await rawStatus(path);
    assert.equal(status, 404, path);
  }
});

/** The path as written: fetch() would resolve ".." before sending it. */
async function rawStatus(path) {
  const { request } = await import("node:http");
  const { port } = new URL(app.origin);
  return new Promise((resolve, reject) => request({ host: "127.0.0.1", port, path }, (res) => { res.resume(); resolve(res.statusCode); }).on("error", reject).end());
}

test('a "</script>" in a stored definition or a query value can\'t end the inline script', async () => {
  const definition = { title: "</script><script>alert(1)</script>", elements: [{ type: "text", name: "q1", title: "\u00e9 & <b>" }] };
  app.db().prepare("UPDATE forms SET json = ? WHERE key = 'work-order'").run(JSON.stringify(definition));
  const html = await page("/examples/extract-from-paper");
  assert.ok(!html.includes("</script><script>alert(1)"));
  assert.ok(html.includes("\\u003c/script\\u003e\\u003cscript\\u003ealert(1)\\u003c/script\\u003e"));
  assert.deepEqual(pageConfig(html).definition, definition);
  const record = await page(`/examples/fill-together?record=${encodeURIComponent("</script><b>")}`);
  assert.ok(record.includes('window.SURVEYJS_PAGE.record = "\\u003c/script\\u003e\\u003cb\\u003e";'));
  assert.ok(record.includes('<option value="&lt;/script&gt;&lt;b&gt;" selected>New job sheet</option>'));
});

test("Start over is on exactly the nine pages, between the other actions and the component", async () => {
  for (const slug of SLUGS) {
    const html = await page(`/examples/${slug}`);
    assert.equal(html.includes('id="start-over"'), START_OVER.includes(slug), slug);
    if (START_OVER.includes(slug)) assert.ok(html.indexOf('id="start-over"') < html.indexOf('id="component"'), slug);
  }
  assert.match(await page("/claim"), /id="start-over"/);
  assert.match(await page("/examples/resume-progress"), /<button id="start-over" type="button" disabled/);
});

test("the layout's ids and templates are there, the Description holds one docs link, about renders where the reference renders it", async () => {
  for (const slug of SLUGS) {
    const html = await page(`/examples/${slug}`);
    for (const id of ["page-header", "side-panel", "panel-close", "panel-tabs", "panel-tabs-thumb", "hood", "panel-description", "try", "panel-requests",
      "readouts", "notes", "show-demo-requests", "clear-requests", "requests-empty", "requests", "panel-stored", "stored-updated", "stored", "main-tabs",
      "panel-toggle", "panel-dot", "page-tabs", "panel-demo", "component", "panel-code", "request-row", "stored-section", "note", "requests-count", "stored-dot"]) {
      assert.ok(html.includes(`id="${id}"`), `${slug}: #${id}`);
    }
    assert.equal((html.match(/>Documentation<\/a>/g) ?? []).length, 1, slug);
    const step = readManifest().steps.find((s) => s.slug === slug);
    assert.ok(html.includes(`href="https://surveyjs.io/documentation/backend-integration-nodejs-express#${step.anchor}"`), slug);
    const about = html.includes('<div class="space-y-2 text-sm text-gray-600">');
    assert.equal(about, slug === "extract-from-paper", `${slug}: the about block`);
    assert.equal(html.includes("require a developer license"), step.licence.startsWith("Commercial"), `${slug}: the licence note`);
    assert.equal((html.match(/<details data-code-section open/g) ?? []).length, step.regions.length, `${slug}: one code section per region`);
  }
  const demo = await startApp({ DEMO_MODE: "true" });
  try {
    for (const slug of ["fill-together", "edit-together"]) {
      assert.match((await demo.request("GET", `/examples/${slug}`)).text, /The invite link carries your sandbox ID/, `${slug} in demo mode`);
    }
  } finally {
    await demo.stop();
  }
});

test("the catalog, the PDF loading page and /claim", async () => {
  const catalog = await page("/");
  assert.match(catalog, /<title>Node\.js Backend Integration with Express · SurveyJS<\/title>/);
  assert.match(catalog, /Step-by-Step Node\.js Backend Integration with Express/);
  assert.match(catalog, /Build a Node\.js Backend for&nbsp;Your SurveyJS Forms/);
  assert.match(catalog, />Node\.js integration guide<\/a>/);
  assert.equal((catalog.match(/>Run Example<\/a>/g) ?? []).length, 18);
  assert.doesNotMatch(catalog, /PHP|Laravel|SurveyJS service/);
  assert.match(await page("/examples/server-pdf/loading"), /Generating the PDF\.\.\./);
  const claim = await page("/claim");
  assert.match(claim, /window\.FORM_DEFINITION = \{/);
  assert.match(claim, /window\.FORM_VARIABLES = \{"user":\{"name":"Alice Martin","plan":"premium"\}\};/);
});

test("no page text names PHP, Laravel, artisan or the SurveyJS service", async () => {
  for (const slug of SLUGS) {
    const html = (await page(`/examples/${slug}`)).replace(/<pre[\s\S]*?<\/pre>/g, "");
    assert.doesNotMatch(html.replace(/"php"|languages\/php|php\.min\.js/g, ""), /\bPHP\b|Laravel|artisan|docker compose|SurveyJS service/i, slug);
  }
});

test("X-Forwarded-Proto: https gives https absolute URLs and wss relay URLs; RELAY_URL wins when set", async () => {
  const headers = { "X-Forwarded-Proto": "https", "X-Forwarded-Host": "demo.example.com" };
  const html = await page("/examples/fill-together", { headers });
  assert.match(html, /<link rel="canonical" href="https:\/\/demo\.example\.com\/examples\/fill-together">/);
  assert.deepEqual(pageConfig(html).relay.fill.url, "wss://demo.example.com");
  assert.match(await page("/", { headers }), /<link rel="canonical" href="https:\/\/demo\.example\.com\/">/);
  assert.equal(pageConfig(await page("/examples/edit-together")).relay.edit.url, app.origin.replace("http", "ws"));
  const proxied = await startApp({ RELAY_URL: "wss://relay.example.com", EDIT_RELAY_URL: "wss://edit.example.com" });
  try {
    const { relay } = pageConfig((await proxied.request("GET", "/examples/edit-together")).text);
    assert.deepEqual([relay.fill.url, relay.edit.url], ["wss://relay.example.com", "wss://edit.example.com"]);
  } finally {
    await proxied.stop();
  }
});

test("the stylesheets come in the meta prompt's order", async () => {
  const links = (html) => [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1].replace(/^\/vendor\/([^@]+)@[^/]+\//, "$1/"));
  const head = ["/shared/ui/fonts.css", "/css/site.css"];
  const hl = "https://unpkg.com/@highlightjs/cdn-assets@11.12.0/styles/github-dark.min.css";
  assert.deepEqual(links(await page("/examples/save-response")), [...head, "survey-core/survey-core.min.css", "survey-core/collaboration.min.css",
    "survey-core/themes/adapters/tailwind4.min.css", "/shared/ui/survey-overrides.css", hl]);
  assert.deepEqual(links(await page("/examples/creator-load-save")), [...head, "survey-core/survey-core.min.css",
    "survey-creator-core/survey-creator-core.min.css", "survey-creator-core/collaboration.min.css", "survey-core/themes/adapters/tailwind4.min.css", hl]);
  const dashboard = await page("/examples/dashboard");
  assert.deepEqual(links(dashboard), [...head, "survey-core/survey-core.min.css", "survey-analytics/survey.analytics.min.css",
    "survey-core/themes/adapters/tailwind4.min.css", hl]);
  assert.match(dashboard, /\.sd-theme-root \{ --sjs2-typography-font-family-text: var\(--font-sans\); \}/);
  assert.deepEqual(links(await page("/examples/creator-load-save?form")).slice(2, 3), ["survey-core/survey-core.min.css"]);
  assert.equal((await page("/")).match(/rel="preload" as="font"/g).length, 4);
});
