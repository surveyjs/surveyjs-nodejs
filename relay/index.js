// Attaches both relays to the app's HTTP server, so they share its port: the upgrade router, the sign-in check,
// the visitor sandbox, keep-alive pings and the demo's room snapshots. The relays' own code is in fill-relay.js and
// edit-relay.js. Express middleware doesn't run for upgrade requests, so this file reads the cookies itself.
import { WebSocketServer } from "ws";
import { database } from "../db.js";
import { parseCookies } from "../demo/cookies.js";
import { isValidId, resolveSandbox } from "../demo/sandbox.js";
import { findUser } from "../demo/users.js";
import { editRelay } from "./edit-relay.js";
import { fillRelay } from "./fill-relay.js";
import { roomKey, writeSnapshot } from "./room-key.js";

const ROUTES = [
  { pattern: /^\/ws\/rooms\/([A-Za-z0-9_-]{1,64})$/, kind: "fill" },
  { pattern: /^\/ws\/forms\/([A-Za-z0-9_-]{1,64})$/, kind: "edit" },
];

/** Answer a refused upgrade with a plain HTTP status, then close the socket. */
function refuse(socket, status, reason) {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

/** @returns {{ close(): void }} */
export function attachRelays(server, config) {
  const relays = { fill: fillRelay(), edit: editRelay() };
  const sockets = {
    fill: new WebSocketServer({ noServer: true, maxPayload: 20 * 1024 * 1024 }),   // a large answer (a signature) fits one frame
    edit: new WebSocketServer({ noServer: true, maxPayload: 5 * 1024 * 1024 }),    // the reference relay's limit for one record
  };

  server.on("upgrade", (req, socket, head) => {
    try {
      const url = new URL(req.url, "http://relay");
      const route = ROUTES.find(({ pattern }) => pattern.test(url.pathname));
      if (!route) return refuse(socket, 400, "Bad Request");
      const id = route.pattern.exec(url.pathname)[1];
      const cookies = parseCookies(req.headers.cookie);

      // Demo only: in demo mode the demo_sid cookie picks the visitor's sandbox (the same check as demo/sandbox.js),
      // so the room is seeded from and saves into that copy, and its key is "<demo_sid>:<id>"
      let sandbox = null;
      if (config.demoMode) {
        if (!isValidId(cookies.demo_sid)) return refuse(socket, 401, "Unauthorized");
        sandbox = resolveSandbox(config, cookies.demo_sid);
      }
      const db = database(sandbox?.database ?? config.databasePath);

      // Demo only: the demo_user cookie stands in for your real session check here (express-session, a JWT…).
      // Like saving in creator-load-save, editing together is for editors (can(user, "edit-forms") in auth.js).
      const user = findUser(db, cookies.demo_user);
      if (!user) return refuse(socket, 401, "Unauthorized");
      if (route.kind === "edit" && !user.isEditor) return refuse(socket, 403, "Forbidden");

      sockets[route.kind].handleUpgrade(req, socket, head, (ws) => {
        const context = { user, database: db, name: url.searchParams.get("name"), roomKey: roomKey(sandbox?.id, id) };
        accept(route.kind, ws, route.kind === "fill" ? { ...context, recordId: id } : { ...context, formId: id });
      });
    } catch (error) {
      console.error("relay: upgrade failed", error);
      refuse(socket, 500, "Internal Server Error");
    }
  });

  /** An exception in a socket handler isn't Express's to catch and would stop the process: log it, keep the room. */
  function guard(ws, kind, what, fn) {
    try {
      fn();
      snapshot(kind, ws, what);
    } catch (error) {
      console.error(`${kind} relay: ${what} failed`, error);
    }
  }

  function accept(kind, ws, context) {
    const relay = relays[kind];
    ws.isAlive = true;
    ws.on("pong", () => (ws.isAlive = true));
    ws.on("error", (error) => console.error(`${kind} relay: socket error`, error.message));
    ws.on("message", (data, isBinary) => {
      const raw = isBinary ? "" : data.toString();
      guard(ws, kind, /"type"\s*:\s*"presence"/.test(raw) ? "presence" : "message", () => relay.message(ws, raw));
    });
    ws.on("close", () => guard(ws, kind, "close", () => relay.close(ws)));
    guard(ws, kind, "connect", () => relay.connect(ws, context));
  }

  /** Demo only: the room's state for the Data panel (fill: participants, values, responseId; edit: the log's length). */
  function snapshot(kind, ws, what) {
    const room = relays[kind].roomOf(ws);
    if (!config.demoMode || !room || what === "presence") return;
    writeSnapshot(config, ws.client.roomKey, kind, kind === "fill"
      ? { participants: room.clients.size, values: room.values, responseId: room.responseId }
      : { participants: room.clients.size, "seed title": room.seed?.title ?? null, "records in the log": room.log.length });
  }

  // Keep-alive: ping every 30 s and drop clients that didn't answer, so a proxy's idle connections close cleanly
  const timer = setInterval(() => {
    for (const wss of Object.values(sockets)) {
      for (const ws of wss.clients) {
        if (!ws.isAlive) ws.terminate();
        else {
          ws.isAlive = false;
          ws.ping();
        }
      }
    }
  }, 30_000).unref();

  return {
    close() {
      clearInterval(timer);
      for (const wss of Object.values(sockets)) {
        for (const ws of wss.clients) ws.close(1001, "Server shutting down");
        wss.close();
      }
    },
  };
}
