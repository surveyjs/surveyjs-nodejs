// SQLite through node:sqlite: plain parameterized SQL, no ORM, so "a response is one JSON document" stays visible.
// Routes call db(req). It answers the request's database: the shared one, or in demo mode the visitor's sandbox
// copy (demo/sandbox.js sets req.sandbox). Opening a file is cached, so each database is opened once per process.
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

/** @type {Map<string, DatabaseSync>} */
const open = new Map();

/** The database at a path, opened once and kept open. */
export function database(path) {
  let handle = open.get(path);
  if (!handle) {
    handle = new DatabaseSync(path);
    handle.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
    open.set(path, handle);
  }
  return handle;
}

/**
 * The database for a request: the sandbox's in demo mode, otherwise the app's. The relays have no request and
 * pass the DatabaseSync they resolved themselves, which comes back as it is.
 * @param {import("express").Request | DatabaseSync} source
 */
export function db(source) {
  if (source instanceof DatabaseSync) return source;
  return database(source.sandbox?.database ?? source.app.locals.config.databasePath);
}

/** Where a request's uploads live: <DATA_DIR>/files, or the sandbox's folder in demo mode. Named by id, never by the client. */
export function filesDir(req) {
  return req.sandbox?.files ?? join(req.app.locals.config.dataDir, "files");
}

/** Run fn inside one transaction: everything or nothing. */
export function transaction(handle, fn) {
  handle.exec("BEGIN");
  try {
    const result = fn();
    handle.exec("COMMIT");
    return result;
  } catch (error) {
    handle.exec("ROLLBACK");
    throw error;
  }
}

/** Close one database (a pruned sandbox) or, without a path, all of them (shutdown, tests). */
export function close(path) {
  for (const [key, handle] of open) {
    if (path === undefined || key === path) {
      handle.close();
      open.delete(key);
    }
  }
}
