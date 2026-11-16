// Demo only: with DEMO_MODE=true each visitor works in a private copy of the seeded database and an uploads
// folder, chosen by the demo_sid cookie. The example routes don't change: db(req) and filesDir(req) read
// req.sandbox. The relays resolve the same sandbox with resolveSandbox(). Delete this file (and its line in
// app.js) when you copy an example into your app.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { close, database } from "../db.js";
import { parseCookies } from "./cookies.js";

const TTL_HOURS = 24;

/** 128 random bits as 32 lowercase hex characters; nothing else ever reaches a file path. */
export const isValidId = (id) => typeof id === "string" && /^[0-9a-f]{32}$/.test(id);

const newId = () => randomBytes(16).toString("hex");

const paths = (config, id) => ({
  id,
  database: join(config.dataDir, "sandbox", `${id}.sqlite`),
  files: join(config.dataDir, "sandbox", id),
});

export const sandboxExists = (config, id) => isValidId(id) && existsSync(paths(config, id).database);

/**
 * The visitor's sandbox, created from the seeded database on first use, and marked as used now. The middleware
 * below and the relays (relay/index.js) both call it.
 * @returns {{ id: string, database: string, files: string }}
 */
export function resolveSandbox(config, id) {
  if (!isValidId(id)) throw new Error("Invalid sandbox id");
  const sandbox = paths(config, id);
  if (!existsSync(sandbox.database)) {
    mkdirSync(sandbox.files, { recursive: true });
    // A consistent copy of the seeded database, even while the app has it open
    database(config.databasePath).exec(`VACUUM INTO '${sandbox.database.replaceAll("'", "''")}'`);
  }
  const now = new Date();
  utimesSync(sandbox.database, now, now);   // last used: prune() removes sandboxes unused for 24 hours
  return sandbox;
}

/** Middleware: req.sandbox, from demo_sid or from an invite link's ?join=<id>. Outside demo mode it does nothing. */
export function demoSandbox(config) {
  return (req, res, next) => {
    if (!config.demoMode) return next();

    let id = parseCookies(req.headers.cookie).demo_sid;
    let issueCookie = false;

    // An invite link (?join=<id>) adopts the inviter's sandbox, after the same format check
    const join = req.query.join;
    if (join !== undefined && !req.path.startsWith("/api/")) {
      if (sandboxExists(config, join)) {
        issueCookie = id !== join;
        id = join;
      } else {
        req.demoJoinFailed = true;   // the page header says the invite has expired
        id = undefined;
      }
    }

    if (!isValidId(id)) {
      id = newId();   // never a file path built from client input
      issueCookie = true;
    }
    req.sandbox = resolveSandbox(config, id);
    if (issueCookie) {
      res.cookie("demo_sid", id, { maxAge: 30 * 24 * 3600 * 1000, sameSite: "lax", path: "/", secure: req.secure, httpOnly: true });
    }
    next();
  };
}

/** Remove sandboxes (and relay snapshots) unused for 24 hours. server.js runs it hourly in demo mode. */
export function prune(config, now = Date.now()) {
  const cutoff = now - TTL_HOURS * 3600 * 1000;
  let removed = 0;
  const folder = join(config.dataDir, "sandbox");
  for (const name of existsSync(folder) ? readdirSync(folder) : []) {
    const id = name.replace(/\.sqlite$/, "");
    if (!name.endsWith(".sqlite") || !isValidId(id)) continue;
    const sandbox = paths(config, id);
    if (statSync(sandbox.database).mtimeMs < cutoff) {
      close(sandbox.database);
      rmSync(sandbox.database, { force: true });
      rmSync(sandbox.files, { recursive: true, force: true });
      removed++;
    }
  }
  const snapshots = join(config.dataDir, "relay");
  for (const name of existsSync(snapshots) ? readdirSync(snapshots) : []) {
    const path = join(snapshots, name);
    if (name.endsWith(".json") && statSync(path).mtimeMs < cutoff) rmSync(path, { force: true });
  }
  return removed;
}
