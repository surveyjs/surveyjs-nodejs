// npm run setup: creates .env from .env.example (when there is none), DATA_DIR, the SQLite database and the seed.
// `npm start` creates and seeds a missing database itself; this makes the first run explicit. Running it again adds
// only what is missing.
import { copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const env = fileURLToPath(new URL("../.env", import.meta.url));
if (!existsSync(env)) {
  copyFileSync(fileURLToPath(new URL("../.env.example", import.meta.url)), env);
  console.log("Created .env from .env.example");
}
process.loadEnvFile(env);   // as `npm start` loads it; variables already set win

const { default: config } = await import("../config.js");
const { close } = await import("../db.js");
const { seed } = await import("../seed.js");

const seeded = seed(config.databasePath);
close();
console.log(seeded ? `Created and seeded ${config.databasePath}` : `${config.databasePath} is already seeded; added any missing forms`);
