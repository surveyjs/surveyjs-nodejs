// Shared by the node:test files: the app from createApp() on port 0, with its own seeded DATA_DIR, the relays
// attached, and fetch / WebSocket helpers that send the demo cookies.
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig } from "../config.js";
import { createApp } from "../app.js";
import { close, database } from "../db.js";
import { seed } from "../seed.js";
import { attachRelays } from "../relay/index.js";

/** Start the app with these environment variables (on top of a temp DATA_DIR). */
export async function startApp(env = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "surveyjs-test-"));
  const config = readConfig({ NODE_ENV: "test", DATA_DIR: dataDir, ...env });
  seed(config.databasePath);
  const app = createApp(config);
  const server = createServer(app);
  const relays = attachRelays(server, config);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const jar = { sid: null };

  /** fetch with demo_user (alice unless given; null for signed out) and the demo_sid the server issued */
  async function request(method, path, { json, body, user = "alice", headers = {}, raw } = {}) {
    const cookie = [jar.sid && `demo_sid=${jar.sid}`, user && `demo_user=${user}`].filter(Boolean).join("; ");
    const init = { method, headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) }, redirect: "manual" };
    if (json !== undefined) {
      init.headers["Content-Type"] ??= "application/json";
      init.body = raw ? json : JSON.stringify(json);
    } else if (body !== undefined) init.body = body;
    const response = await fetch(origin + path, init);
    for (const line of response.headers.getSetCookie()) {
      const m = /^demo_sid=([^;]*)/.exec(line);
      if (m) jar.sid = m[1];
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const text = bytes.toString("utf8");
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
    return { status: response.status, headers: response.headers, bytes, text, data };
  }

  return {
    config,
    origin,
    jar,
    request,
    /** The app's database (the shared one; a sandbox's in demo mode with sandbox()). */
    db: () => database(config.databasePath),
    sandboxDb: () => database(join(dataDir, "sandbox", `${jar.sid}.sqlite`)),
    async stop() {
      relays.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      close();
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

/** A WebSocket client that keeps every message, with next(type) to wait for one. */
export function socket(url, cookie) {
  const ws = new WebSocket(url, cookie ? { headers: { Cookie: cookie } } : undefined);
  const messages = [];
  const waiters = [];
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    const waiter = waiters.find((w) => w.test(message));
    if (waiter) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(message);
    } else messages.push(message);
  });
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error(`could not connect to ${url}`)), { once: true });
  });
  opened.catch(() => {});   // a refused connection rejects only for callers that wait for it
  const closed = new Promise((resolve) => ws.addEventListener("close", (event) => resolve(event), { once: true }));
  return {
    ws,
    messages,
    opened,
    closed,
    send: (message) => ws.send(typeof message === "string" ? message : JSON.stringify(message)),
    next(type, ms = 3000) {
      const test = typeof type === "function" ? type : (m) => m.type === type;
      const found = messages.find(test);
      if (found) {
        messages.splice(messages.indexOf(found), 1);
        return Promise.resolve(found);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), ms);
        waiters.push({ test, resolve: (m) => { clearTimeout(timer); resolve(m); } });
      });
    },
    close() {
      ws.close();
      return closed;
    },
  };
}

/** The round-trip document every storing endpoint must keep exactly (the contract test's). */
export const ROUNDTRIP = { a: "  padded  ", b: "", c: null, d: {}, e: [{}], f: [], g: 1.5, h: "naïve — 東京", i: { j: { k: [1, "x", true] } } };

/** A form-data body with one or more files in a field. */
export function files(field, ...entries) {
  const form = new FormData();
  for (const [bytes, type, name] of entries) form.append(field, new Blob([bytes], { type }), name);
  return form;
}

export const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
