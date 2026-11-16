// Starts the app: checks the port, seeds a missing database, serves HTTP and both WebSocket relays on one port,
// and shuts down cleanly on Ctrl+C and SIGTERM. `npm start` runs `node --env-file-if-exists=.env server.js`.

// node:sqlite needs Node.js 24: say so instead of failing with ERR_UNKNOWN_BUILTIN_MODULE
const [major] = process.versions.node.split(".").map(Number);
if (major < 24) {
  console.error(`This app needs Node.js 24 or later; this is ${process.version}. Install Node.js 26 LTS from https://nodejs.org.`);
  process.exit(1);
}

const { createServer } = await import("node:http");
const { connect } = await import("node:net");
const { setLicenseKey } = await import("survey-core");
const { default: config } = await import("./config.js");
const { createApp } = await import("./app.js");
const { close } = await import("./db.js");
const { seed } = await import("./seed.js");
const { attachRelays } = await import("./relay/index.js");
const { currentBuild } = await import("./demo/build.js");
const { prune } = await import("./demo/sandbox.js");
const { fileURLToPath } = await import("node:url");

const busy = `Port ${config.port} is already in use. Another copy of this app (another checkout or branch?) may be running. Stop it, or set APP_PORT.`;

/**
 * Is something answering on the port? Don't rely on the bind error: on Windows a server on 0.0.0.0 and another on
 * 127.0.0.1 can both bind the same port, and the first one keeps answering.
 */
const answers = (port) => new Promise((resolve) => {
  const socket = connect({ host: "127.0.0.1", port });
  const done = (result) => { socket.destroy(); resolve(result); };
  socket.setTimeout(500, () => done(false));
  socket.once("connect", () => done(true));
  socket.once("error", () => done(false));
});

if (await answers(config.port)) {
  console.error(busy);
  process.exit(1);
}

// Server PDFs are made in this process, so the licence key applies to them as well as to the pages
if (config.licenseKey) setLicenseKey(config.licenseKey);

if (seed(config.databasePath)) console.log(`Created and seeded ${config.databasePath}`);

const app = createApp(config);
const server = createServer(app);
const relays = attachRelays(server, config);

server.once("error", (error) => {
  console.error(error.code === "EADDRINUSE" ? busy : error);
  process.exit(1);
});
server.listen(config.port, config.host, () => {
  const build = currentBuild(config);
  console.log(`Serving ${fileURLToPath(new URL(".", import.meta.url))}${build ? ` (${build})` : ""} on http://127.0.0.1:${config.port}`);
});

// Demo only: remove visitor sandboxes unused for 24 hours, hourly
if (config.demoMode) setInterval(() => prune(config), 3600 * 1000).unref();

// Ctrl+C (SIGINT) and docker stop (SIGTERM): close the relays (1001, going away), stop accepting connections,
// close the databases, then exit, so the port is free at once
let stopping = false;
const shutdown = (signal) => {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: shutting down`);
  relays.close();
  server.close(() => {
    close();
    process.exit(0);
  });
  server.closeAllConnections();
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
