// Generate PDFs
import { note, setStoredQuery } from "./host.js";
import { responseError } from "./schema-saver.js";

const urls = new Map();
const feedback = document.getElementById("pdf-feedback");

function showFeedback(message, kind = "info") {
  feedback.textContent = message;
  feedback.dataset.kind = kind;
  feedback.hidden = !message;
}

function usePdfUrl(id, action, url) {
  const link = document.createElement("a");
  link.href = url;
  if (action === "download") link.download = `claim-${id}.pdf`;
  else { link.target = "_blank"; link.rel = "noopener"; }
  link.click();
  return { message: action === "download" ? "PDF ready. Download started." : "PDF opened in a new tab.", needsAction: false };
}

// #region sjs:server-pdf.client
// Open a tab during the click and navigate only after the server returns a PDF
async function generatePdf(id, action) {
  if (urls.has(id)) return usePdfUrl(id, action, urls.get(id));
  const tab = action === "open" ? window.open("/examples/server-pdf/loading", "_blank") : null;
  try {
    const response = await fetch(`/api/claims/${id}/pdf`);
    if (!response.ok) throw await responseError(response, "Couldn't generate the PDF. Please try again.");
    if (!response.headers.get("content-type")?.startsWith("application/pdf")) throw new Error("The server didn't return a PDF. Please try again.");
    const blob = await response.blob();
    if (!blob.size) throw new Error("The server returned an empty PDF. Please try again.");
    const url = URL.createObjectURL(blob);
    urls.set(id, url);
    if (action === "download") return usePdfUrl(id, action, url);
    const opened = tab && !tab.closed;
    if (opened) tab.location = url;
    return { message: opened ? "PDF opened in a new tab." : "PDF ready. Select Open PDF again or Download PDF.", needsAction: !opened };
  } catch (error) { tab?.close(); throw error; }
}
// #endregion

for (const button of document.querySelectorAll("[data-claim]")) {
  button.addEventListener("click", async () => {
    const row = button.closest("[data-claim-row]");
    const buttons = row.querySelectorAll("[data-claim]");
    for (const item of buttons) item.disabled = true;
    showFeedback("Generating the PDF...");
    row.setAttribute("aria-busy", "true");
    setStoredQuery({ id: button.dataset.claim });
    try {
      const result = await generatePdf(button.dataset.claim, button.dataset.action);
      showFeedback(result.needsAction ? result.message : "");
      note(`Claim #${button.dataset.claim}: ${result.message}`, "ok");
    } catch (error) {
      const message = error instanceof TypeError ? "Couldn't generate the PDF. Please try again." : error.message;
      showFeedback(message, "error");
      note(`Claim #${button.dataset.claim}: ${message}`, "error");
    } finally {
      for (const item of buttons) item.disabled = false;
      row.setAttribute("aria-busy", "false");
    }
  });
}
window.addEventListener("pagehide", () => { for (const url of urls.values()) URL.revokeObjectURL(url); });
