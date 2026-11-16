// The comments on data-corrupting pitfalls are inside the regions the docs show, and the route files stand alone.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { regionsIn } from "../demo/code-panel.js";

const region = (path, id) => {
  const found = regionsIn(path).get(id);
  assert.ok(found, `${path} has sjs:${id}`);
  return found.code;
};

test("the pitfall comments are inside the regions", () => {
  const pitfalls = [
    ["routes/save-response.js", "save-response.server", ["{} stays {}", "never a copy"]],
    ["routes/resume-progress.js", "resume-progress.server", ["{} stays {}", "never a copy"]],
    ["routes/relational-storage.js", "relational-storage.server", ["{} stays {}", "keys come from valueName"]],
    ["routes/creator-load-save.js", "creator-load-save.server", ["{} stays {}", "never a copy"]],
    ["routes/variable-presets.js", "variable-presets.server", ["{} stays {}", "never a copy"]],
    ["routes/validate-response.js", "validate-response.server", ["{} stays {}"]],
    ["routes/lint-definition.js", "lint-definition.server", ["{} stays {}"]],
    ["routes/store-files.js", "store-files.server", ['"files[]"', "by the bytes, never the client's Content-Type", "never by the client's file name"]],
    ["routes/store-files.js", "store-files.download", ["404, not 403", "nosniff and sandbox"]],
    ["routes/choices-from-web.js", "choices-from-web.server", ["is an array", "the browser can't call a service without CORS"]],
    ["routes/dashboard.js", "dashboard.server", ["documents as stored, not re-encoded", "ISO 8601 UTC strings compare as dates"]],
    ["routes/extract-from-paper.js", "extract-from-paper.server", ["never rawResponse", "may quote the answers"]],
  ];
  for (const [path, id, comments] of pitfalls) {
    const code = region(path, id);
    for (const comment of comments) assert.ok(code.includes(comment), `sjs:${id} explains: ${comment}`);
  }
});

test("the regions show the SurveyJS calls themselves", () => {
  assert.match(region("routes/validate-response.js", "validate-response.server"), /lintSurvey\(definition, lintOptions\)[\s\S]*new Model\(definition\)[\s\S]*setData\(data, \{\}\)[\s\S]*validate\(\)/);
  assert.match(region("routes/lint-definition.js", "lint-definition.server"), /lintSurvey\(definition, lintOptions\)/);
  assert.match(region("routes/extract-from-paper.js", "extract-from-paper.server"), /createExtractor\(\{ provider, adapter: "surveyjs"[\s\S]*extractFromImage/);
  assert.match(region("routes/server-pdf.js", "server-pdf.server"), /renderPdf\(definition, JSON\.parse\(claim\.data\)\)/);
});

test("route files never import each other, and never read process.env", () => {
  for (const name of readdirSync(new URL("../routes", import.meta.url))) {
    const source = readFileSync(new URL(`../routes/${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from "\.\/|from "\.\.\/routes\//, `${name} imports another route file`);
    assert.doesNotMatch(source, /process\.env/, `${name} reads process.env`);
    assert.match(source.split("\n")[0], /^\/\/ (GET|POST|PUT|DELETE|GET\|PUT)/, `${name} starts with its endpoints`);
  }
});
