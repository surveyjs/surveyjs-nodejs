// Demo only: surveyjs-integration.json, the list of examples the catalog, the example pages and the docs read.
import { readFileSync } from "node:fs";

let manifest;

export function readManifest() {
  return (manifest ??= JSON.parse(readFileSync(new URL("../surveyjs-integration.json", import.meta.url), "utf8")));
}

/** The manifest's example with this slug, or undefined. */
export const findStep = (slug) => readManifest().steps.find((step) => step.slug === slug);

/** The docs page, at the example's anchor when one is given. */
export const docsUrl = (config, step) => config.docs + (step ? `#${step.anchor}` : "");
