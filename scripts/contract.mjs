// npm run contract [-- --steps save-response,choices-from-web | --smoke]
// Runs the shared contract test (shared/contract-tests/run.mjs), or with --smoke the smoke test (shared/smoke/run.mjs),
// against a fresh DATA_DIR and the app on a free port. With AI=stub it also starts the AI stub on a free port and
// points the app at it. VALIDATE_RESPONSES, LINT_DEFINITIONS and DEMO_MODE are passed through.
// Run Server-Side Workflows run in this process, so the tests always run with SERVICE=in-process. Works on Windows
// and Linux: every process is started with process.execPath (never npm, whose cmd on Windows kill() doesn't stop).
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const smoke = args.includes("--smoke");
const steps = args.join(" ").match(/--steps[= ](\S+)/)?.[1];

if (process.env.SERVICE && process.env.SERVICE !== "in-process") {
  console.log(`Ignoring SERVICE=${process.env.SERVICE}: Run Server-Side Workflows run in this app, so the tests use SERVICE=in-process.`);
}
const ai = process.env.AI === "stub" ? "stub" : "off";

const freePort = () => new Promise((resolve, reject) => {
  const server = createServer().listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  }).on("error", reject);
});

/** Start a Node process and wait until it answers on its port. */
async function start(name, script, env, port) {
  const child = spawn(process.execPath, [script], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  child.output = () => output;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`The ${name} stopped:\n${output}`);
    const up = await fetch(`http://127.0.0.1:${port}/${name === "app" ? "up" : "requests"}`).then((r) => r.ok, () => false);
    if (up) {
      console.log(`Started the ${name} on port ${port}`);
      return child;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`The ${name} did not start on port ${port}:\n${output}`);
}

const dataDir = mkdtempSync(join(tmpdir(), "surveyjs-contract-"));
const children = [];
let code = 1;
try {
  const appPort = await freePort();
  const origin = `http://127.0.0.1:${appPort}`;
  const env = {
    ...process.env,
    NODE_ENV: "development",
    DATA_DIR: dataDir,
    APP_PORT: String(appPort),
    APP_HOST: "127.0.0.1",
    SERVICE: "in-process",
    AI: ai,
    SURVEYJS_BUILD: process.env.SURVEYJS_BUILD ?? "contract",
  };
  delete env.PORT;
  // The app's own AI settings from .env never leak in: off means off
  for (const name of ["AI_BASE_URL", "AI_API_KEY", "AI_MODEL", "SURVEYJS_AI_PROVIDER", "SURVEYJS_AI_MODEL", "SURVEYJS_OLLAMA_BASE_URL", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) {
    if (ai === "off") delete env[name];
  }

  if (ai === "stub") {
    const stubPort = await freePort();
    children.push(await start("AI stub", "shared/contract-tests/ai-stub.mjs", { ...env, AI_STUB_PORT: String(stubPort) }, stubPort));
    Object.assign(env, {
      SURVEYJS_AI_PROVIDER: "ollama",
      SURVEYJS_OLLAMA_BASE_URL: `http://127.0.0.1:${stubPort}`,
      AI_BASE_URL: `http://127.0.0.1:${stubPort}/v1`,
      AI_API_KEY: "stub",
      AI_MODEL: "stub",
    });
  }

  children.push(await start("app", "server.js", env, appPort));

  const test = spawn(process.execPath, [smoke ? "shared/smoke/run.mjs" : "shared/contract-tests/run.mjs", ...(steps ? [`--steps=${steps}`] : [])], {
    cwd: root,
    stdio: "inherit",
    env: { ...env, BASE_URL: origin, RELAY_URL: origin.replace(/^http/, "ws"), EDIT_RELAY_URL: origin.replace(/^http/, "ws") },
  });
  code = await new Promise((resolve) => test.on("exit", (exit) => resolve(exit ?? 1)));
} catch (error) {
  console.error(error.message);
} finally {
  for (const child of children) {
    child.kill();
    if (code !== 0 && child.output()) console.log(`--- ${child.spawnargs.at(-1)} output\n${child.output().slice(-3000)}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
process.exit(code);
