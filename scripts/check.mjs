// npm run check [-- --complete]: does this repo still match the integration docs (contract server-integration-v4)?
// The manifest's files and regions, the region rules (no nesting, short, no plumbing in server regions), shared/
// against its SHA256SUMS, the SurveyJS pins against shared/surveyjs-version.json, and the README's docs links.
// With --complete (CI, the end of a run) all 18 examples must be in the manifest.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import config from "../config.js";
import { regionsIn } from "../demo/code-panel.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const errors = [];

const STEPS = ["save-response", "load-definition-variables-data", "resume-progress", "store-files", "choices-from-web", "async-functions",
  "relational-storage", "fill-together", "dashboard", "creator-load-save", "creator-uploads", "ai-translation", "variable-presets",
  "edit-together", "validate-response", "lint-definition", "server-pdf", "extract-from-paper"];
const SURVEYJS_PACKAGES = ["survey-core", "survey-js-ui", "survey-creator-core", "survey-creator-js", "survey-analytics", "survey-pdf"];
const REGION_SOURCES = ["routes", "relay", "shared/client"];
const MAX_REGION_LINES = 24;
const MAX_RELAY_REGION_LINES = 60;
/** This platform's plumbing: a displayed server region calls integration/ or db.js for these instead of showing them. */
const PLUMBING = ["lastInsertRowid", "DatabaseSync", "AbortSignal", "ECONNREFUSED", "toISOString", "process.env", "MulterError"];

const files = (dir) => readdirSync(join(root, dir)).flatMap((name) => {
  const path = `${dir}/${name}`;
  return statSync(join(root, path)).isDirectory() ? files(path) : [path];
});

// ---- shared/: CONTRACT and the hashes (shared/ is a copy: fixes go to surveyjs-php-laravel)
const contract = existsSync(join(root, "shared/CONTRACT")) ? read("shared/CONTRACT").trim() : "";
if (contract !== "server-integration-v4") errors.push(`shared/CONTRACT must read server-integration-v4, found "${contract}"`);
const upstream = existsSync(join(root, "shared/UPSTREAM")) ? read("shared/UPSTREAM").trim() : "";
if (!/^surveyjs\/surveyjs-php-laravel@[0-9a-f]{7,40}$/.test(upstream)) errors.push(`shared/UPSTREAM must name the copied commit (surveyjs/surveyjs-php-laravel@<sha>), found "${upstream}"`);
const expected = new Map(read("shared/SHA256SUMS").trim().split(/\r?\n/).filter(Boolean).map((line) => [line.slice(66), line.slice(0, 64)]));
const actual = new Map(files("shared").map((path) => relative("shared", path).replaceAll("\\", "/"))
  .filter((path) => !["SHA256SUMS", "UPSTREAM"].includes(path))
  .map((path) => [path, createHash("sha256").update(readFileSync(join(root, "shared", path))).digest("hex")]));
for (const [path, hash] of expected) {
  if (!actual.has(path)) errors.push(`shared/${path} is listed in shared/SHA256SUMS but missing`);
  else if (actual.get(path) !== hash) errors.push(`shared/${path} differs from shared/SHA256SUMS: shared/ is a copy, fix it in surveyjs-php-laravel`);
}
for (const path of actual.keys()) if (!expected.has(path)) errors.push(`shared/${path} is not listed in shared/SHA256SUMS`);

// ---- versions: the manifest, shared/surveyjs-version.json, package.json and the lock file pin the same SurveyJS
const manifest = JSON.parse(read("surveyjs-integration.json"));
const version = JSON.parse(read("shared/surveyjs-version.json")).version;
const pkg = JSON.parse(read("package.json"));
const lock = JSON.parse(read("package-lock.json"));
if (manifest.surveyjsVersion !== version) errors.push(`surveyjsVersion in the manifest is ${manifest.surveyjsVersion}, shared/surveyjs-version.json says ${version}`);
for (const name of SURVEYJS_PACKAGES) {
  if (pkg.dependencies?.[name] !== version) errors.push(`package.json pins ${name} to ${pkg.dependencies?.[name] ?? "nothing"}, expected exactly ${version}`);
  const locked = lock.packages?.[`node_modules/${name}`]?.version;
  if (locked !== version) errors.push(`package-lock.json has ${name} ${locked ?? "missing"}, expected ${version}: run npm install`);
}
if (manifest.serverSideWorkflows !== "in-process") errors.push(`serverSideWorkflows must be "in-process", found ${manifest.serverSideWorkflows}`);
if ("surveyjsService" in manifest) errors.push("surveyjsService belongs to service platforms: Run Server-Side Workflows run in process here");

// ---- the manifest's files
for (const step of manifest.steps) {
  for (const [role, path] of Object.entries(step.files ?? {})) {
    if (!existsSync(join(root, path))) errors.push(`${step.slug}: ${role} file ${path} is missing`);
  }
  if (!["done", "not-in-repo"].includes(step.status)) errors.push(`${step.slug}: unknown status ${step.status}`);
}

// ---- regions: markers balanced, each region once, short, listed, and in its example's client or server files
const found = new Map();
for (const path of REGION_SOURCES.flatMap(files).filter((path) => path.endsWith(".js"))) {
  let open = false;
  read(path).split(/\r?\n/).forEach((line, i) => {
    if (/^\s*\/\/\s*#region\b/.test(line)) {
      if (open) errors.push(`${path}:${i + 1}: a region opens inside another region`);
      open = true;
    } else if (/^\s*\/\/\s*#endregion\b/.test(line)) {
      if (!open) errors.push(`${path}:${i + 1}: #endregion without #region`);
      open = false;
    }
  });
  if (open) errors.push(`${path}: a region is never closed`);

  for (const [id, region] of regionsIn(path)) {
    found.set(id, [...(found.get(id) ?? []), path]);
    const lines = region.end - region.start + 1;
    const max = path.startsWith("relay/") ? MAX_RELAY_REGION_LINES : MAX_REGION_LINES;
    if (lines > max) errors.push(`Region sjs:${id} in ${path} has ${lines} lines (at most ${max})`);
    if (region.count > 1) errors.push(`Region sjs:${id} appears ${region.count} times in ${path}`);
    if (!path.startsWith("shared/") && id.endsWith(".server")) {
      for (const token of PLUMBING) {
        if (region.code.includes(token)) errors.push(`Region sjs:${id} in ${path} shows ${token}: move it into integration/ or db.js`);
      }
    }
  }
}
const listed = new Set(manifest.steps.flatMap((step) => step.regions));
for (const step of manifest.steps) {
  const sources = Object.entries(step.files).filter(([role]) => role === "client" || role.startsWith("server")).map(([, path]) => path);
  for (const id of step.regions) {
    const where = found.get(id) ?? [];
    if (where.length !== 1) errors.push(`${step.slug}: region sjs:${id} found ${where.length} times, expected exactly once`);
    else if (!sources.includes(where[0])) errors.push(`${step.slug}: region sjs:${id} is in ${where[0]}, not in the example's client or server file`);
  }
}
for (const [id, where] of found) if (!listed.has(id)) errors.push(`Region sjs:${id} in ${where[0]} is not listed in the manifest`);

// ---- README: the prose links the docs page exactly twice, both to config.docs (the generated table always holds it)
const prose = read("README.md").replace(/<!-- steps:start[\s\S]*?<!-- steps:end -->/, "");
const links = [...prose.matchAll(/\]\((https?:\/\/[^)\s]+)\)|<(https?:\/\/[^>\s]+)>/g)].map((m) => m[1] ?? m[2])
  .filter((url) => url.startsWith(config.docs) || /^https?:\/\/(www\.)?surveyjs\.io(\/documentation)?\/backend-integration(?!\/examples)/.test(url));
const wrong = links.filter((url) => url !== config.docs);
if (links.length !== 2 || wrong.length) {
  errors.push(`README.md must link to the docs exactly twice outside the example table, both to ${config.docs}; found ${links.length}${wrong.length ? `: ${wrong.join(", ")}` : ""}`);
}

if (process.argv.includes("--complete")) {
  for (const slug of STEPS) if (!manifest.steps.some((step) => step.slug === slug)) errors.push(`Example ${slug} is missing from surveyjs-integration.json`);
}

for (const error of errors) console.error(`ERROR  ${error}`);
if (errors.length) process.exit(1);
console.log(`OK: ${manifest.steps.length} examples, regions, shared/ and versions are consistent.`);
