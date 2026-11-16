// Demo only: which checkout is answering, `<branch>@<short commit>`. server.js prints it at start, and the catalog
// and the example pages show it ("Running …"). Hosted demos set SURVEYJS_BUILD at deploy; without it, git is asked
// once; without git, there is no build line.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
let fromGit;

function git(...args) {
  return execFileSync("git", args, { cwd: root, timeout: 2000, stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).toString().trim();
}

/** The build line, or null. */
export function currentBuild(config) {
  if (config.build) return config.build;
  if (fromGit === undefined) {
    try {
      fromGit = `${git("rev-parse", "--abbrev-ref", "HEAD")}@${git("rev-parse", "--short", "HEAD")}`;
    } catch {
      fromGit = null;   // no git on PATH, or not a checkout
    }
  }
  return fromGit;
}
