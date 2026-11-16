// Analyze Results with Dashboard
import { show } from "./host.js";
import { Model } from "survey-core";
import { Dashboard } from "survey-analytics";

const container = document.getElementById("dashboard");
const notice = document.getElementById("dashboard-notice");
const retry = document.getElementById("retry-dashboard");
let dashboard, schemaPromise, controller;
let revision = 0;

async function loadSchema() {
  schemaPromise ??= fetch("/api/forms/feedback").then(async response => {
    if (!response.ok) throw new Error("Schema load failed");
    const { definition } = await response.json();
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) throw new Error("Invalid schema");
    return definition;
  }).catch(error => { schemaPromise = null; throw error; });
  return schemaPromise;
}

// #region sjs:dashboard.client
// Load answers with their submission dates for Dashboard's built-in date filter
async function loadResults(signal) {
  const query = new URLSearchParams({ formId: "feedback", includeCreatedAt: "1", limit: "5000" });
  const [definition, response] = await Promise.all([
    loadSchema(), fetch(`/api/responses?${query}`, { signal })
  ]);
  if (!response.ok) throw new Error("Responses load failed");
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error("Invalid responses");
  return { definition, data: data.map(row => ({ ...row.data, createdAt: row.createdAt })) };
}

function renderResults(definition, data) {
  if (!dashboard) {
    const survey = new Model(definition);
    dashboard = new Dashboard({
      questions: survey.getAllQuestions(), data,
      dateFieldName: "createdAt", datePeriod: "last30days"
    });
    dashboard.render(container);
  } else {
    dashboard.updateData(data);
  }
}
// #endregion

async function refresh() {
  const run = ++revision;
  controller?.abort();
  controller = new AbortController();
  container.hidden = true;
  container.setAttribute("aria-busy", "true");
  notice.hidden = false;
  retry.hidden = true;
  show("dashboard-status", "Loading responses...");
  try {
    const { definition, data } = await loadResults(controller.signal);
    if (run !== revision) return;
    container.hidden = false;
    renderResults(definition, data);
    notice.hidden = true;
  } catch (error) {
    if (run !== revision || error.name === "AbortError") return;
    container.hidden = true;
    show("dashboard-status", "Couldn't load the responses. Please try again.");
    retry.hidden = false;
  } finally {
    if (run === revision) container.setAttribute("aria-busy", "false");
  }
}

retry.addEventListener("click", refresh);
addEventListener("pagehide", () => { controller?.abort(); dashboard?.destroy(); }, { once: true });
refresh();
