// The start command: it refuses a port that something answers on, prints which checkout it serves, exits on an old
// Node, and stops cleanly. It also checks the licence path of server PDFs (setLicenseKey() at startup).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dataDir = mkdtempSync(join(tmpdir(), "surveyjs-run-"));
after(() => rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const freePort = () => new Promise((resolve) => {
  const server = createServer().listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

/** node server.js with these variables; resolves with { code, output } when it exits. */
function run(env, { until, stop } = {}) {
  const child = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: "", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let stopping;
  const onData = (chunk) => {
    output += chunk;
    if (until && !stopping && output.includes(until)) {
      stopping = Promise.resolve().then(() => stop?.(child)).finally(() => child.kill());   // kill() also after a failed check
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  return new Promise((resolve, reject) => child.on("exit", (code) => (stopping ?? Promise.resolve()).then(() => resolve({ code, output }), reject)));
}

test("a busy APP_PORT is refused with the meta prompt's message and exit code 1", async () => {
  const busy = createServer().listen(0, "127.0.0.1");
  await new Promise((resolve) => busy.once("listening", resolve));
  const { port } = busy.address();
  try {
    const { code, output } = await run({ APP_PORT: String(port) });
    assert.equal(code, 1);
    assert.match(output, new RegExp(`Port ${port} is already in use\\. Another copy of this app \\(another checkout or branch\\?\\) may be running\\. Stop it, or set APP_PORT\\.`));
  } finally {
    busy.close();
  }
});

test("a free port serves, prints the folder and the build, and SIGTERM stops it with code 0", async () => {
  const port = await freePort();
  const { code, output } = await run({ APP_PORT: String(port), SURVEYJS_BUILD: "test-branch@abc1234" }, {
    until: "on http://",
    stop: async (child) => {
      const r = await fetch(`http://127.0.0.1:${port}/up`);
      assert.deepEqual(await r.json(), { status: "ok" });
      child.kill("SIGTERM");
    },
  });
  assert.match(output, new RegExp(`Serving .+ \\(test-branch@abc1234\\) on http://127\\.0\\.0\\.1:${port}`));
  if (process.platform !== "win32") assert.equal(code, 0);   // Windows has no signals: kill() ends the process
  const reopened = createServer().listen(port, "127.0.0.1");
  await new Promise((resolve, reject) => reopened.once("listening", resolve).once("error", reject));
  reopened.close();
});

test("server PDFs: without SURVEYJS_LICENSE_KEY they carry the licence banner; with a key, setLicenseKey() runs at startup", async () => {
  // A dummy key shows the code path only: survey-pdf still shows the banner for a key that isn't valid.
  for (const key of ["", "dummy-key"]) {
    const port = await freePort();
    let pdf;
    await run({ APP_PORT: String(port), SURVEYJS_LICENSE_KEY: key }, {
      until: "on http://",
      stop: async (child) => {
        const page = await (await fetch(`http://127.0.0.1:${port}/examples/server-pdf`, { headers: { Cookie: "demo_user=alice" } })).text();
        const id = /data-claim="(\d+)"/.exec(page)[1];
        pdf = Buffer.from(await (await fetch(`http://127.0.0.1:${port}/api/claims/${id}/pdf`, { headers: { Cookie: "demo_user=alice" } })).arrayBuffer());
        assert.equal(page.includes(`"licenseKey":${key ? `"${key}"` : "null"}`), true);
        child.kill();
      },
    });
    assert.equal(pdf.toString("latin1", 0, 5), "%PDF-");
    assert.match(pdf.toString("latin1"), /set up your license key/, `the banner with key "${key}"`);
  }
});
