// Async Calculations and Validation
import { mountSurvey, page, show } from "./host.js";
import { Model } from "survey-core";

import { registerFunction } from "survey-core";

const cache = new Map();
const states = {};
const retry = document.getElementById("retry-checks");
let survey;
let generation = 0;
const normalize = (name, value) => name === "email"
  ? String(value ?? "").trim().toLowerCase()
  : String(value ?? "").replace(/\s/g, "").toUpperCase();

function report(name, key, result, run) {
  if (run !== generation || normalize(name, survey?.getValue(name)) !== key) return;
  states[name] = result;
  const unavailable = name === "email" ? "Couldn't check email availability. Please retry." : "Couldn't calculate shipping. Please retry.";
  const message = result.pending
    ? name === "email" ? "Checking email..." : "Calculating shipping..."
    : !result.ok ? unavailable
      : name === "email" ? result.value ? "This email is already registered." : "This email is available."
        : result.value > 0 ? "Delivery is available." : "We don't deliver to this postcode.";
  show(`${name}-status`, message);
  const question = survey?.getQuestionByName(name);
  if (question) question.validators[0].text = !result.ok && !result.pending ? unavailable
    : name === "email" ? "This email is already registered." : "We don't deliver to this postcode.";
  if (name === "postcode" && survey) survey.getQuestionByName("shipping_price").visible = Boolean(result.ok && result.value > 0);
  retry.hidden = !Object.values(states).some(state => !state.ok && !state.pending);
  retry.disabled = Object.values(states).some(state => state.pending);
}

// #region sjs:async-functions.lookup
// Reuse in-flight and successful lookups, but allow failed requests to be retried
async function lookup(name, key, url, field) {
  const run = generation;
  const cacheKey = `${name}:${key}`;
  if (!cache.has(cacheKey)) {
    const pending = fetch(url).then(async response => {
      if (!response.ok) throw new Error("Lookup failed");
      const value = (await response.json())[field];
      if (name === "email" ? typeof value !== "boolean" : value !== null && (!Number.isFinite(value) || value < 0)) throw new Error("Invalid result");
      return { ok: true, value };
    }).catch(() => ({ ok: false, value: null }));
    cache.set(cacheKey, pending);
  }
  report(name, key, { pending: true }, run);
  const pending = cache.get(cacheKey);
  const result = await pending;
  if (!result.ok && cache.get(cacheKey) === pending) cache.delete(cacheKey);
  report(name, key, result, run);
  return result.value;
}
// #endregion

// #region sjs:async-functions.client
// Validate email availability using the backend's customer records
registerFunction({
  name: "emailExists",
  isAsync: true,
  func: async ([email]) => {
    const key = normalize("email", email);
    if (!key) return false;
    return lookup("email", key, `/api/customers/exists?email=${encodeURIComponent(key)}`, "exists");
  }
});

// Share one shipping lookup between the calculation and the postcode validator
registerFunction({
  name: "shippingCost",
  isAsync: true,
  func: async ([postcode]) => {
    const key = normalize("postcode", postcode);
    if (!key) return null;
    return lookup("postcode", key, `/api/shipping?postcode=${encodeURIComponent(key)}`, "price");
  }
});
// #endregion

survey = mountSurvey(new Model(page.definition));

retry.addEventListener("click", () => {
  survey.runExpressions();
  survey.validate();
});

// Reset status when an input is cleared, and ignore results from earlier runs
survey.onValueChanged.add((sender, { name, value }) => {
  if (!["email", "postcode"].includes(name) || normalize(name, value)) return;
  delete states[name];
  show(`${name}-status`, name === "email" ? "Enter an email address." : "Enter a postcode.");
  if (name === "postcode") sender.getQuestionByName("shipping_price").visible = false;
  retry.hidden = !Object.values(states).some(state => !state.ok && !state.pending);
  retry.disabled = Object.values(states).some(state => state.pending);
});
document.getElementById("start-over")?.addEventListener("click", () => {
  generation++;
  cache.clear();
  for (const name of Object.keys(states)) delete states[name];
  survey.clear(true, true);
  survey.getQuestionByName("shipping_price").visible = false;
  retry.hidden = true;
  show("email-status", "Enter an email address.");
  show("postcode-status", "Enter a postcode.");
});
