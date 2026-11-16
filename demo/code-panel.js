// Demo only: the Code tab. It shows the files that just ran: each JSON definition, then each region the manifest
// lists for the example (`// #region sjs:<id>` … `// #endregion`), dedented, with a link to its lines on GitHub.
// scripts/check.mjs reads regions the same way.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readManifest } from "./manifest.js";

const root = new URL("..", import.meta.url);
export const read = (path) => readFileSync(new URL(path, root), "utf8");
export const repoPath = (path) => fileURLToPath(new URL(path, root));

const OPEN = /^\s*\/\/\s*#region\s+sjs:(\S+)/;
const CLOSE = /^\s*\/\/\s*#endregion/;

/**
 * Every `#region sjs:<id>` in a file. start and end are the 1-based lines inside the markers.
 * @returns {Map<string, { start: number, end: number, code: string, count: number }>}
 */
export function regionsIn(path) {
  const lines = read(path).split(/\r?\n/);
  const regions = new Map();
  let open = null;
  lines.forEach((line, i) => {
    const m = OPEN.exec(line);
    if (m) open = { id: m[1], from: i + 1 };
    else if (open && CLOSE.test(line)) {
      const found = regions.get(open.id);
      if (found) found.count++;
      else regions.set(open.id, { start: open.from + 1, end: i, code: dedent(lines.slice(open.from, i)), count: 1 });
      open = null;
    }
  });
  return regions;
}

function dedent(lines) {
  const indents = lines.filter((line) => line.trim() !== "").map((line) => line.length - line.trimStart().length);
  const indent = indents.length ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(indent)).join("\n");
}

const github = (config, path) => `${config.github}/blob/${readManifest().branch}/${path}`;

/** The JSON definitions, shown collapsed above the regions. */
export function codeDefinitions(config, step) {
  return Object.entries(step.files)
    .filter(([role]) => role.startsWith("definition"))
    .map(([, path]) => ({ path, code: read(path).trim(), url: github(config, path) }));
}

/** The regions the manifest lists for an example, from its client file and every server* file, in manifest order. */
export function codePanel(config, step) {
  const panel = [];
  for (const [role, path] of Object.entries(step.files)) {
    if (role !== "client" && !role.startsWith("server")) continue;
    for (const [id, region] of regionsIn(path)) {
      if (!step.regions.includes(id)) continue;
      panel.push({
        id,
        role: role === "client" ? "client" : "server",
        path,
        language: path.endsWith(".json") ? "json" : "javascript",
        code: region.code,
        url: `${github(config, path)}#L${region.start}-L${region.end}`,
      });
    }
  }
  return panel;
}
