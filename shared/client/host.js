// Demo only: everything around the examples on a step page. Mounting the form or Creator, the
// requests log, the "What the server stored" panel and the demo-user switch. None of this is part
// of an integration, and the step code doesn't depend on it beyond mountSurvey(). Creator pages
// render with renderSurveyCreator() from survey-creator-js; mountCreator() stays exported.
//
// It finds page elements by id, data- attributes and <template> slots and never uses CSS classes,
// so each platform styles its own templates. Step modules import this file first.
import { setLicenseKey } from "survey-core";
import { renderSurvey } from "survey-js-ui";

/** The page config the server renders into window.SURVEYJS_PAGE. */
export const page = window.SURVEYJS_PAGE ?? {};

if (page.licenseKey) setLicenseKey(page.licenseKey);

// ---------------------------------------------------------------------------------------------
// Mounting

export function mountSurvey(survey, id = "form") {
  const element = document.getElementById(id);
  element.replaceChildren();
  renderSurvey(survey, element);
  return survey;
}

export function mountCreator(creator, id = "creator") {
  creator.render(document.getElementById(id));
  return creator;
}

// ---------------------------------------------------------------------------------------------
// Requests log: wraps fetch, XMLHttpRequest (choicesByUrl uses XHR) and WebSocket

const REQUEST_HEADERS = ["authorization"];
const RESPONSE_HEADERS = ["x-demo-cache", "cache-control", "content-type"];
const storedListeners = [];
let storedQuery = {};
let refreshTimer;

/** The demo's own requests (stored panel, shared files, other origins) are hidden by default. */
function isDemoRequest(url) {
  const u = new URL(url, location.href);
  return u.origin !== location.origin || u.pathname.startsWith("/demo/") || u.pathname.startsWith("/shared/");
}

/** Clone the page's <template id="…"> and put each value into its data-field="<key>" slots as text. */
export function fill(template, values) {
  const tpl = document.getElementById(template);
  if (!tpl) return null;
  const node = tpl.content.firstElementChild.cloneNode(true);
  for (const [key, value] of Object.entries(values)) {
    const slots = node.matches(`[data-field="${key}"]`) ? [node] : node.querySelectorAll(`[data-field="${key}"]`);
    for (const slot of slots) slot.textContent = value ?? "";
  }
  return node;
}

// Request and response bodies, only when the platform's #request-row template has both slots
// (data-field="request-body" and "response-body"). Without them none of this runs: no clone, no
// extra reads. Capture never touches what the caller sends or receives: a response is read through
// a clone, at most BODY_LIMIT bytes, in a detached task, and any failure only writes
// "(body unavailable)" into the slot.
const BODY_LIMIT = 64 * 1024;
const rowTemplate = document.getElementById("request-row")?.content;
const CAPTURE_BODIES = Boolean(rowTemplate?.querySelector('[data-field="request-body"]') && rowTemplate?.querySelector('[data-field="response-body"]'));

const sizeOf = (bytes) => `${bytes} bytes`;
const cut = (text) => (text.length > BODY_LIMIT ? { text: text.slice(0, BODY_LIMIT), truncated: true } : { text, truncated: false });

/** For display only: two-space JSON when the whole body was read and parses, else the text as it is. */
function display(text, truncated, json) {
  if (truncated) return `${text}\n… (truncated)`;
  if (json) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      // not JSON after all
    }
  }
  return text;
}

/** The request body as sent, read synchronously from what the caller passed, never consuming it. */
function describeRequestBody(body, input) {
  if (body === undefined || body === null) return typeof Request !== "undefined" && input instanceof Request && input.body ? "(not shown)" : "(no body)";
  if (typeof body === "string") {
    const { text, truncated } = cut(body);
    return display(text, truncated, /^\s*[[{]/.test(text));
  }
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof FormData) {
    return [...body.entries()]
      .map(([name, value]) => (typeof value === "string" ? `${name}: ${value}` : `${name}: ${value.name} (${value.type || "unknown type"}, ${sizeOf(value.size)})`))
      .join("\n");
  }
  if (body instanceof Blob) return `(${body.type || "unknown type"}, ${sizeOf(body.size)})`;
  return "(not shown)";
}

const isJsonType = (type) => /^application\/json$|\+json$/.test(type);
const isTextType = (type) => type.startsWith("text/") || isJsonType(type);

/** Reads at most BODY_LIMIT bytes of a stream, then cancels it. Cancels it on any error too. */
async function readLimited(stream) {
  let reader;
  try {
    reader = stream.getReader();
  } catch (error) {
    stream.cancel().catch(() => {});   // never leave a clone unread: the browser would buffer the whole body
    throw error;
  }
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  let done = false;
  try {
    while (bytes < BODY_LIMIT) {
      const chunk = await reader.read();
      if (chunk.done) {
        done = true;
        break;
      }
      const part = chunk.value.subarray(0, BODY_LIMIT - bytes);
      bytes += part.byteLength;
      text += decoder.decode(part, { stream: true });
    }
    return { text: text + decoder.decode(), truncated: !done };
  } finally {
    if (!done) reader.cancel().catch(() => {});
  }
}

function captureResponse(entry, response) {
  try {
    if (response.status === 204 || response.status === 304 || !response.body) return entry.body("response-body", "(no content)");
    const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const header = response.headers.get("content-length");
    const length = header === null ? null : Number(header);
    if (!isTextType(type) || (length !== null && !(length <= BODY_LIMIT))) {
      return entry.body("response-body", `(${type || "unknown type"}, ${length !== null && Number.isFinite(length) ? sizeOf(length) : "size unknown"})`);
    }
    const clone = response.clone();
    readLimited(clone.body)
      .then(({ text, truncated }) => entry.body("response-body", display(text, truncated, isJsonType(type))))
      .catch(() => entry.body("response-body", "(body unavailable)"));
  } catch {
    entry.body("response-body", "(body unavailable)");
  }
}

function captureXhrResponse(entry, xhr) {
  try {
    if (xhr.status === 0) return entry.body("response-body", "(no response)");
    if (xhr.status === 204 || xhr.status === 304) return entry.body("response-body", "(no content)");
    if (xhr.responseType !== "" && xhr.responseType !== "text") return entry.body("response-body", `(${xhr.responseType}, size unknown)`);
    const type = (xhr.getResponseHeader("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const { text, truncated } = cut(xhr.responseText);
    entry.body("response-body", display(text, truncated, isJsonType(type)));
  } catch {
    entry.body("response-body", "(body unavailable)");
  }
}

function updateRequestsEmptyState() {
  const empty = document.getElementById("requests-empty");
  if (empty) empty.hidden = Boolean(document.querySelector('#requests > li:not([hidden])'));
}

function startEntry(method, url, requestHeaders) {
  const started = performance.now();
  const u = new URL(url, location.href);
  const demo = isDemoRequest(url);
  const shown = u.origin === location.origin ? u.pathname + u.search : u.href;
  const headers = REQUEST_HEADERS.filter((h) => requestHeaders?.[h]).map((h) => `${h.replace(/\b\w/g, (c) => c.toUpperCase())}: ${requestHeaders[h]}`);
  const row = fill("request-row", { method: method.toUpperCase(), url: shown, status: "…", time: "", headers: headers.join(" · ") });
  const list = document.getElementById("requests");
  if (row && list) {
    row.dataset.demo = String(demo);
    row.dataset.state = "pending";
    row.hidden = demo && !document.getElementById("show-demo-requests")?.checked;
    list.prepend(row);
    updateRequestsEmptyState();
  }
  return {
    finish(status, getHeader) {
      const extra = RESPONSE_HEADERS
        .map((h) => [h, getHeader?.(h)])
        .filter(([h, v]) => v && !(h === "content-type" && /json|html/.test(v)) && !(h === "cache-control" && !/max-age=[1-9]/.test(v)))
        .map(([h, v]) => `${h.replace(/(^|-)\w/g, (c) => c.toUpperCase())}: ${v}`);
      if (row) {
        row.querySelector('[data-field="status"]').textContent = status === 0 ? "failed" : String(status);
        row.querySelector('[data-field="time"]').textContent = `${Math.round(performance.now() - started)} ms`;
        row.querySelector('[data-field="headers"]').textContent = [...headers, ...extra].join(" · ");
        row.dataset.state = status >= 100 && status < 400 ? "ok" : "error";
      }
      if (!demo) {
        scheduleStoredRefresh();
        for (const listener of requestListeners) listener({ method: method.toUpperCase(), url: u.pathname + u.search, status });
      }
    },
    /** Write a body slot of the row (only called when CAPTURE_BODIES). Never throws. */
    body(name, text) {
      try {
        const slot = row?.querySelector(`[data-field="${name}"]`);
        if (slot) slot.textContent = text;
      } catch {
        // the log is optional
      }
    },
  };
}

const requestListeners = [];
/** Called after each non-demo request completes with { method, url, status }, for step-specific indicators. */
export function onRequest(callback) {
  requestListeners.push(callback);
}

/** Add a line to the requests log for something that isn't an HTTP request (a WebSocket, a download). */
export function logEvent(method, url, status, getHeader) {
  startEntry(method, url, {}).finish(status, getHeader);
}

const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
  const method = init.method ?? (typeof input === "object" && "method" in input ? input.method : "GET");
  const headers = Object.fromEntries(new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined)));
  const entry = startEntry(method, url, headers);
  if (CAPTURE_BODIES) {
    try {
      entry.body("request-body", describeRequestBody(init.body, input));
    } catch {
      entry.body("request-body", "(body unavailable)");
    }
  }
  try {
    const response = await nativeFetch(input, init);
    entry.finish(response.status, (h) => response.headers.get(h));
    if (CAPTURE_BODIES) captureResponse(entry, response);   // synchronous up to the clone; the reading is detached
    return response;
  } catch (error) {
    entry.finish(0);
    if (CAPTURE_BODIES) entry.body("response-body", "(no response)");
    throw error;
  }
};

const xhrOpen = XMLHttpRequest.prototype.open;
const xhrSetHeader = XMLHttpRequest.prototype.setRequestHeader;
const xhrSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open = function (method, url, ...rest) {
  this.__demo = { method, url: String(url), headers: {} };
  return xhrOpen.call(this, method, url, ...rest);
};
XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
  if (this.__demo) this.__demo.headers[name.toLowerCase()] = value;
  return xhrSetHeader.call(this, name, value);
};
XMLHttpRequest.prototype.send = function (...args) {
  if (this.__demo) {
    const entry = startEntry(this.__demo.method, this.__demo.url, this.__demo.headers);
    if (CAPTURE_BODIES) {
      try {
        entry.body("request-body", describeRequestBody(args[0]));
      } catch {
        entry.body("request-body", "(body unavailable)");
      }
    }
    this.addEventListener("loadend", () => {
      entry.finish(this.status, (h) => this.getResponseHeader(h));
      if (CAPTURE_BODIES) captureXhrResponse(entry, this);
    }, { once: true });
  }
  return xhrSend.apply(this, args);
};

const NativeWebSocket = window.WebSocket;
window.WebSocket = class extends NativeWebSocket {
  constructor(url, protocols) {
    super(url, protocols);
    const shown = String(url).replace(/^wss?:\/\/[^/]+/, "");
    this.addEventListener("open", () => logEvent("WS", shown, 101), { once: true });
    this.addEventListener("close", (e) => logEvent("WS", `${shown} (closed)`, e.code === 1000 || e.code === 1005 ? 200 : 0), { once: true });
  }
};

document.getElementById("show-demo-requests")?.addEventListener("change", (e) => {
  for (const row of document.querySelectorAll('#requests [data-demo="true"]')) row.hidden = !e.target.checked;
  updateRequestsEmptyState();
});
document.getElementById("clear-requests")?.addEventListener("click", () => {
  document.getElementById("requests")?.replaceChildren();
  updateRequestsEmptyState();
});

// ---------------------------------------------------------------------------------------------
// What the server stored: refreshed 300 ms after a non-demo request completes

function scheduleStoredRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshStored, 300);
}

/** Extra query parameters for GET /demo/stored/:slug, e.g. { id: 12 } or { from: "2026-09-01" }. */
export function setStoredQuery(query) {
  storedQuery = query;
  scheduleStoredRefresh();
}

/** Called with the stored JSON after each refresh, for step-specific checks. */
export function onStored(callback) {
  storedListeners.push(callback);
}

export async function refreshStored() {
  const panel = document.getElementById("stored");
  if (!panel || !page.slug) return;
  const query = new URLSearchParams(Object.entries(storedQuery).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  const response = await fetch(`/demo/stored/${page.slug}${query.size ? `?${query}` : ""}`);
  if (!response.ok) return;
  const stored = await response.json();
  panel.replaceChildren(...Object.entries(stored).map(([title, value]) =>
    fill("stored-section", { title, json: typeof value === "string" ? value : JSON.stringify(value, null, 2) })).filter(Boolean));
  const status = document.getElementById("stored-updated");
  if (status) status.textContent = `Updated at ${new Date().toLocaleTimeString()}`;
  for (const listener of storedListeners) listener(stored);
}

// ---------------------------------------------------------------------------------------------
// Notes, the demo-user switch, relay URLs and invite links

/** Show a short message next to the form ("identical: yes", "403 Forbidden"…). kind: info | ok | error */
export function note(text, kind = "info") {
  const list = document.getElementById("notes");
  const item = fill("note", { text });
  if (!list || !item) return;
  item.dataset.kind = kind;
  list.prepend(item);
  list.hidden = false;
}

/** Replace the contents of an element marked data-show="<name>" with text. */
export function show(name, text) {
  for (const el of document.querySelectorAll(`[data-show="${name}"]`)) el.textContent = text;
}

// Return from a saved form to the editor that opened it
document.getElementById("back-to-editor")?.addEventListener("click", event => {
  try {
    if (!window.opener || window.opener.closed || window.opener.location.origin !== location.origin) return;
    window.opener.focus();
    window.close();
    event.preventDefault();
  } catch { /* Follow the link if the original editor is no longer accessible */ }
});

// The demo user is a cookie (alice, bob or none), so all tabs share it. A page signs in as its
// own user and only some pages offer a switch: each tab sets the cookie back to its user when
// it gets focus, so its requests keep going out as that user.
export const setDemoUser = (key) => { document.cookie = `demo_user=${key}; path=/; max-age=31536000; samesite=lax`; };
if (page.demoUser) {
  addEventListener("focus", () => setDemoUser(page.demoUser));
  addEventListener("pageshow", () => setDemoUser(page.demoUser));
}
document.getElementById("demo-user")?.addEventListener("change", (e) => {
  setDemoUser(e.target.value);
  const resetQuery = e.target.dataset.resetQuery;
  if (!resetQuery) return location.reload();
  const url = new URL(location.href);
  url.searchParams.delete(resetQuery);
  location.assign(url);
});

/** Display name for collaboration: the demo user's name plus a per-window number, so two windows differ. */
const windowNumber = Math.floor(Math.random() * 90) + 10;
export function participantName() {
  return `${page.user?.name ?? "Guest"} · ${windowNumber}`;
}

/** The relays run as their own processes: RELAY_URL / EDIT_RELAY_URL, or this host on their ports. */
export function relayUrl(relay, path) {
  const config = relay === "edit" ? page.relay?.edit : page.relay?.fill;
  const base = config?.url || `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:${config?.port}`;
  return base.replace(/\/$/, "") + path;
}

/** The page's own URL; in demo mode with ?join=<sandbox id>, so a collaborator shares this sandbox. */
export function inviteLink() {
  const url = new URL(location.href);
  if (page.sandboxId) url.searchParams.set("join", page.sandboxId);
  else url.searchParams.delete("join");
  return url.href;
}

for (const link of document.querySelectorAll("[data-invite-link]")) {
  if ("value" in link && link.tagName === "INPUT") link.value = inviteLink();
  else link.href = inviteLink();
}
document.querySelector("[data-copy-invite]")?.addEventListener("click", async (e) => {
  const link = document.querySelector('input[data-invite-link]')?.value ?? inviteLink();
  await navigator.clipboard?.writeText(link);
  e.currentTarget.dataset.copied = "true";
});

refreshStored();
