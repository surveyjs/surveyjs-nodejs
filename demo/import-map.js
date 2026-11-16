// Demo only: the import map every example page carries, built once at startup. The shared ES modules
// (shared/client/*.js, shared/ui/*.js) import bare specifiers ("survey-core", "lodash/debounce"); the map points
// the SurveyJS ones at this app's own node_modules (served at /vendor/<package>@<version>/ by pages.js) and the
// third-party ones at unpkg, pinned here. One place pins every page.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The SurveyJS packages the pages load; survey-pdf stays on the server. */
export const BROWSER_PACKAGES = ["survey-core", "survey-js-ui", "survey-creator-core", "survey-creator-js", "survey-analytics"];

// Every SurveyJS specifier the shared modules and the SurveyJS builds import: [package, its "exports" subpath]
const SURVEYJS_SPECIFIERS = {
  "survey-core": ["survey-core", "."],
  "survey-core/collaboration": ["survey-core", "./collaboration"],
  "survey-core/i18n": ["survey-core", "./i18n"],
  "survey-js-ui": ["survey-js-ui", "."],
  "survey-creator-core": ["survey-creator-core", "."],
  "survey-creator-core/collaboration": ["survey-creator-core", "./collaboration"],
  "survey-creator-js": ["survey-creator-js", "."],
  "survey-analytics": ["survey-analytics", "."],
};

// The other packages, each checked in unpkg's file list (https://unpkg.com/<package>@<version>/?meta). chart.js and
// @kurkle/color are the versions survey-analytics allows (^4.5.1), as in the reference's lock file.
const UNPKG = "https://unpkg.com";
// highlight.js's own es/ files re-export its CommonJS lib/ (for bundlers), so the browser gets no default export:
// @highlightjs/cdn-assets is the same release built as browser ES modules
const HIGHLIGHT = `${UNPKG}/@highlightjs/cdn-assets@11.12.0`;
const THIRD_PARTY = {
  "chart.js": `${UNPKG}/chart.js@4.5.1/dist/chart.js`,
  "@kurkle/color": `${UNPKG}/@kurkle/color@0.3.4/dist/color.esm.js`,
  "lodash/debounce": `${UNPKG}/lodash-es@4.18.1/debounce.js`,
  "highlight.js/lib/core": `${HIGHLIGHT}/es/core.min.js`,
  ...Object.fromEntries(["csharp", "javascript", "json", "php", "python", "typescript"]
    .map((language) => [`highlight.js/lib/languages/${language}`, `${HIGHLIGHT}/es/languages/${language}.min.js`])),
};

/** highlight.js's github-dark theme, for the Code tab. */
export const HIGHLIGHT_THEME = `${HIGHLIGHT}/styles/github-dark.min.css`;

/** The installed package's folder, found from its main entry, so it works wherever npm put node_modules. */
export function packageDir(name) {
  let dir = dirname(fileURLToPath(import.meta.resolve(name)));
  while (!existsSync(join(dir, "package.json")) || JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name !== name) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`Can't find the folder of ${name}`);
    dir = parent;
  }
  return dir;
}

/** The SurveyJS version every page pins (shared/surveyjs-version.json). */
export const surveyjsVersion = () =>
  JSON.parse(readFileSync(new URL("../shared/surveyjs-version.json", import.meta.url), "utf8")).version;

/**
 * Build the import map, and stop the app when node_modules doesn't match shared/surveyjs-version.json or a mapped
 * file is missing: a page would load the wrong code, or fail in the browser with a bare 404.
 * @returns {{ version: string, packages: Record<string, string>, imports: Record<string, string> }}
 */
export function buildImportMap() {
  const version = surveyjsVersion();
  const packages = {};
  for (const name of BROWSER_PACKAGES) {
    const dir = packageDir(name);
    const installed = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
    if (installed !== version) {
      throw new Error(`${name} ${installed} is installed, but shared/surveyjs-version.json pins ${version}. Run npm ci.`);
    }
    packages[name] = dir;
  }

  const imports = {};
  for (const [specifier, [name, subpath]] of Object.entries(SURVEYJS_SPECIFIERS)) {
    const entry = JSON.parse(readFileSync(join(packages[name], "package.json"), "utf8")).exports?.[subpath];
    const file = typeof entry === "string" ? entry : entry?.import;
    if (!file || !existsSync(join(packages[name], file))) {
      throw new Error(`${specifier}: ${name}'s package.json exports no browser ES module at ${subpath} (${file}). Run npm ci.`);
    }
    imports[specifier] = `/vendor/${name}@${version}/${file.replace(/^\.\//, "")}`;
  }
  return { version, packages, imports: { ...imports, ...THIRD_PARTY } };
}
