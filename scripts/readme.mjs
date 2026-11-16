// npm run readme: regenerates the README's example table (between the steps markers) from surveyjs-integration.json.
import { readFileSync, writeFileSync } from "node:fs";
import config from "../config.js";

const readmePath = new URL("../README.md", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("../surveyjs-integration.json", import.meta.url), "utf8"));
const file = (step, role) => (step.files[role] ? `[\`${step.files[role]}\`](${step.files[role]})` : "—");

const rows = ["| Example | Run | Server | Client | Page | Licence |", "|---|---|---|---|---|---|"];
for (const step of manifest.steps) {
  rows.push(`| [${step.title}](${config.docs}#${step.anchor}) | [${step.page}](${manifest.live}${step.page}) | ${file(step, "server")} | ${file(step, "client")} | ${file(step, "page")} | ${step.licence} |`);
}

const readme = readFileSync(readmePath, "utf8");
const marker = /(<!-- steps:start[^>]*-->)[\s\S]*?(<!-- steps:end -->)/;
if (!marker.test(readme)) {
  console.error("README.md needs <!-- steps:start --> and <!-- steps:end --> markers.");
  process.exit(1);
}
writeFileSync(readmePath, readme.replace(marker, (_, start, end) => `${start}\n${rows.join("\n")}\n${end}`));
console.log(`Updated the example table in README.md (${manifest.steps.length} examples).`);
