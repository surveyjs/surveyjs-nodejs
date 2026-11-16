// Extract Responses from Documents
import { mountSurvey, note, page, setStoredQuery, show } from "./host.js";
import { Model } from "survey-core";
import { responseError } from "./schema-saver.js";

const definition = structuredClone(page.definition);
const lastPage = definition.pages?.at(-1) ?? definition;
lastPage.elements.push({
  type: "checkbox", name: "review_confirmation", title: "Review confirmation", titleLocation: "hidden",
  choices: [{ value: "reviewed", text: "I have reviewed these answers" }],
  isRequired: true,
  requiredErrorText: "You need to confirm that you have reviewed the answers."
});
const survey = mountSurvey(new Model(definition));
survey.completeText = "Save reviewed response";
const reviewed = survey.getQuestionByName("review_confirmation");
const form = document.getElementById("form");
const sample = document.getElementById("sample-scan");
const ownScan = document.getElementById("own-scan");
const startOver = document.getElementById("start-over");
const downloadBlank = document.getElementById("download-work-order");
const downloadError = document.getElementById("work-order-download-error");
const descriptions = new Map(survey.getAllQuestions().filter(q => q !== reviewed).map(q => [q.name, q.description]));
const status = document.querySelector('[data-show="extract-status"]');
const allowed = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"];
let controller, previewUrl;
let revision = 0;
let busy = false;
let downloading = false, blankPdfUrl;

function lock(locked, saving = false) {
  busy = locked;
  for (const control of [sample, ownScan]) control.disabled = locked;
  downloadBlank.disabled = locked || downloading;
  startOver.disabled = saving;
  form.inert = locked;
  form.setAttribute("aria-busy", String(locked));
}
function clearReview() { reviewed.clearValue(); reviewed.clearErrors(); }
function clearDescriptions() { for (const [name, description] of descriptions) survey.getQuestionByName(name).description = description; }
function showStatus(message) { status.textContent = message; status.hidden = !message; }
function preview(file) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  const image = document.getElementById("scan-image");
  const pdf = document.getElementById("scan-pdf");
  image.hidden = file.type === "application/pdf";
  pdf.hidden = !image.hidden;
  if (image.hidden) { image.removeAttribute("src"); pdf.src = previewUrl; }
  else { pdf.removeAttribute("src"); image.src = previewUrl; }
  document.getElementById("open-document").href = previewUrl;
  document.getElementById("scan-preview").hidden = false;
  document.getElementById("review-layout").dataset.preview = "true";
}

// #region sjs:extract-from-paper.client
// Extract a draft without saving it and validate the response before replacing any answers
async function extract(file, signal) {
  const body = new FormData();
  body.append("scan", file);
  const response = await fetch("/api/work-orders/extract", { method: "POST", body, signal });
  if (!response.ok) throw await responseError(response, "Couldn't extract the answers. Try again or enter the answers directly in the form.");
  const result = await response.json();
  if (!result.answers || typeof result.answers !== "object" || Array.isArray(result.answers) || !Array.isArray(result.confidence)) {
    throw new Error("The extraction result couldn't be read. Try again or enter the answers directly in the form.");
  }
  return result;
}
// #endregion

async function run(getFile) {
  if (busy) return;
  const current = ++revision;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  lock(true);
  let file;
  try {
    showStatus("Loading the document...");
    file = await getFile(signal);
    if (!allowed.includes(file.type)) throw new Error("Choose a PDF, PNG, JPEG, WebP, or GIF document.");
    if (!file.size || file.size > 5 * 1024 * 1024) throw new Error("Choose a document of 5 MB or less.");
    showStatus(`Extracting answers from ${file.name}...`);
    const result = await extract(file, signal);
    if (current !== revision) return;
    survey.notifier.active = false;
    survey.clear(true, true);
    survey.data = result.answers;
    clearReview();
    clearDescriptions();
    const flagged = result.confidence.filter(c => c && c.flagged && typeof c.confidence === "number" && c.confidence >= 0 && c.confidence <= 1 && descriptions.has(c.fieldName));
    for (const item of flagged) {
      const question = survey.getQuestionByName(item.fieldName);
      question.description = `Review this answer (${Math.round(item.confidence * 100)}% confidence)`;
    }
    preview(file);
    showStatus("Draft ready for review");
    show("extract-source", file.name);
    show("extract-id", typeof result.uniqueId === "string" ? result.uniqueId : "Not detected");
    show("extract-review-count", String(flagged.length));
    document.getElementById("extract-details").hidden = false;
    note("Draft ready for review", "ok");
  } catch (error) {
    if (current !== revision || error.name === "AbortError") return;
    const message = error instanceof TypeError || error instanceof SyntaxError ? "Couldn't extract the answers. Try again or enter the answers directly in the form." : error.message;
    showStatus(message);
    if (!previewUrl && file && allowed.includes(file.type) && file.size <= 5 * 1024 * 1024) preview(file);
    note(message, "error");
  } finally { if (current === revision) lock(false); }
}

survey.onValueChanged.add((_, options) => { if (options.name !== reviewed.name) clearReview(); });
survey.onCompleting.add((_, options) => { options.allowComplete = !busy; });

// #region sjs:extract-from-paper.save
// Save only after human review and confirm the response ID returned by the backend
survey.onComplete.add(async (sender, options) => {
  lock(true, true);
  sender.completedHtml = "<h3>Saving the reviewed response...</h3>";
  options.showSaveInProgress();
  try {
    const data = Object.fromEntries(sender.getAllQuestions()
      .filter(q => q !== reviewed).map(q => [q.valueName || q.name, q.isEmpty() ? null : q.value]));
    const response = await fetch("/api/responses", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ formId: "work-order", data })
    });
    if (!response.ok) throw await responseError(response, "Couldn't save the reviewed response. Please try again.");
    const { id } = await response.json();
    if (!Number.isInteger(id) || id < 1) throw new Error("The server didn't confirm a saved response. Please try again.");
    setStoredQuery({ id });
    sender.completedHtml = `<h3>The reviewed response has been saved.</h3><p>Response ID: ${id}</p>`;
    showStatus(`Reviewed response #${id} saved.`);
    options.showSaveSuccess();
  } catch (error) {
    sender.completedHtml = "<h3>The reviewed response hasn't been saved.</h3>";
    options.showSaveError(error instanceof TypeError ? "Couldn't save the reviewed response. Please try again." : error.message);
  } finally { lock(false); }
});
// #endregion

sample.addEventListener("click", () => run(async signal => {
  const response = await fetch("/shared/samples/work-order-scan.png", { signal });
  if (!response.ok) throw new Error("Couldn't load the sample scan. Please try again.");
  return new File([await response.blob()], "work-order-scan.png", { type: "image/png" });
}));
downloadBlank.addEventListener("click", async () => {
  downloading = true;
  downloadBlank.disabled = true;
  downloadBlank.textContent = "Preparing PDF...";
  downloadError.hidden = true;
  try {
    const response = await fetch("/api/work-orders/blank.pdf");
    if (!response.ok) throw await responseError(response, "Couldn't download the blank work order. Please try again.");
    if (!response.headers.get("content-type")?.startsWith("application/pdf")) throw new Error("The server didn't return a PDF. Please try again.");
    const blob = await response.blob();
    if (!blob.size) throw new Error("The server returned an empty PDF. Please try again.");
    if (blankPdfUrl) URL.revokeObjectURL(blankPdfUrl);
    blankPdfUrl = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement("a"), { href: blankPdfUrl, download: "work-order.pdf" });
    link.click();
    note("Blank work order downloaded.", "ok");
  } catch (error) {
    const message = error instanceof TypeError ? "Couldn't download the blank work order. Please try again." : error.message;
    downloadError.textContent = message;
    downloadError.hidden = false;
    note(message, "error");
  } finally {
    downloading = false;
    downloadBlank.disabled = busy;
    downloadBlank.textContent = "Download blank work order";
  }
});
ownScan.addEventListener("change", event => {
  const file = event.target.files[0];
  event.target.value = "";
  if (file) run(async () => file);
});
startOver.addEventListener("click", () => {
  revision++;
  controller?.abort();
  lock(false);
  survey.notifier.active = false;
  survey.clear(true, true);
  clearDescriptions();
  clearReview();
  ownScan.value = "";
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  document.getElementById("scan-image").removeAttribute("src");
  document.getElementById("scan-pdf").removeAttribute("src");
  document.getElementById("open-document").removeAttribute("href");
  document.getElementById("scan-preview").hidden = true;
  document.getElementById("review-layout").dataset.preview = "false";
  document.getElementById("extract-details").hidden = true;
  showStatus("");
  for (const field of ["extract-source", "extract-id", "extract-review-count"]) show(field, "");
  setStoredQuery({});
});
window.addEventListener("pagehide", () => {
  controller?.abort();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  if (blankPdfUrl) URL.revokeObjectURL(blankPdfUrl);
});
