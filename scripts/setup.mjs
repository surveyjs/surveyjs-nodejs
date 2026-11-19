// npm run setup: creates .env (the private keys) from .env.example when there is none, DATA_DIR, the SQLite database
// and the seed.
// `npm start` creates and seeds a missing database itself; this makes the first run explicit. Running it again adds
// only what is missing.
import { copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const env = fileURLToPath(new URL("../.env", import.meta.url));
if (!existsSync(env)) {
  copyFileSync(fileURLToPath(new URL("../.env.example", import.meta.url)), env);
  console.log("Created .env from .env.example");
}
// As `npm start` loads them: variables already set win, then .env, then settings.env
process.loadEnvFile(env);
process.loadEnvFile(fileURLToPath(new URL("../settings.env", import.meta.url)));

const { default: config } = await import("../config.js");
const { close } = await import("../db.js");
const { seed } = await import("../seed.js");

const seeded = seed(config.databasePath);
close();
console.log(seeded ? `Created and seeded ${config.databasePath}` : `${config.databasePath} is already seeded; added any missing forms`);
