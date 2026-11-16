// Demo only: the two tab sets of a step page (layouts/example.blade.php): the side panel with
// Description, Requests and Data, and the main column with Demo and Code, plus the panel's toggle,
// its badge and the highlights. It works from the DOM alone: shared/client/host.js fills #requests,
// #stored and #notes, and MutationObservers here watch them, so host.js doesn't know the tabs exist.
//
// - The two sets are independent: choosing a tab in one never changes the other.
// - The URL hash holds the last choice: none or #demo shows Demo, #code Code, and #description,
//   #requests or #stored open the panel on that tab (the sheet on a phone). Choosing a tab replaces
//   the hash (no new history entry); closing the panel drops a panel tab's hash.
// - From 768px the panel is docked: open unless the reader closed it, remembered in localStorage.
//   Narrower, it is a full-screen sheet that starts closed; Escape and × close it. Crossing 768px
//   doesn't change the remembered choice. The panel opens on Description unless the hash names a tab:
//   its last tab isn't remembered across loads or examples.
// - What is unseen: a non-demo request that finished or a note that arrived while Requests wasn't
//   showing, and a Data section whose text changed after its first render while Data wasn't
//   showing. A tab shows when the panel is open on it, and showing it clears its flag. The badge on
//   the toggle shows while the panel is closed and a flag is set; the Data dot while Data's is.
//   The Requests counter counts the unseen requests still in the log, red once one of them failed;
//   showing Requests clears it.

const panel = document.getElementById("side-panel");
if (panel) setUpPageTabs();

function setUpPageTabs() {
  const MAIN = ["demo", "code"];
  const PANEL = ["description", "requests", "stored"];
  const OPEN_KEY = "surveyjs-panel-open";

  const header = document.getElementById("page-header");
  const main = document.querySelector("main");
  const mainRow = document.getElementById("main-tabs");
  const demoPanel = document.getElementById("panel-demo");
  const component = document.getElementById("component");
  const requests = document.getElementById("requests");
  const stored = document.getElementById("stored");
  const notes = document.getElementById("notes");
  const readouts = document.getElementById("readouts");
  const toggle = document.getElementById("panel-toggle");
  const badge = document.getElementById("panel-dot");
  const requestsCount = document.getElementById("requests-count");
  const storedDot = document.getElementById("stored-dot");
  const panelTablist = document.getElementById("panel-tabs");
  const mainTabs = [...document.querySelectorAll('#page-tabs [role="tab"]')];
  const panelTabs = [...panelTablist.querySelectorAll('[role="tab"]')];
  const wide = matchMedia("(min-width: 768px)");   // Tailwind's md: docked, not a sheet

  // ---------------------------------------------------------------------------------------------
  // Sizes: the header and the main tab row for the sticky panel and Creator, what sits above the
  // component, and the fade and the scrollbar on the panel's tab row

  const thumb = document.getElementById("panel-tabs-thumb");
  const TRACK_INSET = 8;   // the thumb runs 4px in from each side of the row

  function measure() {
    const root = document.documentElement.style;
    root.setProperty("--header-h", `${header.offsetHeight}px`);
    root.setProperty("--tabs-h", `${mainRow.offsetHeight}px`);
    if (!demoPanel.hidden) root.setProperty("--demo-above", `${component.offsetTop - demoPanel.offsetTop}px`);
  }

  function fade() {
    const { scrollLeft, clientWidth, scrollWidth } = panelTablist;
    panelTablist.toggleAttribute("data-fade-start", scrollLeft > 0);
    panelTablist.toggleAttribute("data-fade-end", scrollLeft + clientWidth < scrollWidth - 1);

    // The thumb shows only while the row is cut. It is as wide as the visible share of the row, at least 24px
    const hidden = scrollWidth - clientWidth <= 1;
    thumb.hidden = hidden;
    if (hidden) return;
    const track = clientWidth - TRACK_INSET;
    const width = Math.max(24, (track * clientWidth) / scrollWidth);
    thumb.style.width = `${width}px`;
    thumb.style.transform = `translateX(${((track - width) * scrollLeft) / (scrollWidth - clientWidth)}px)`;
  }

  // Dragging the thumb scrolls the row
  thumb.addEventListener("pointerdown", (event) => {
    const { clientWidth, scrollWidth, scrollLeft } = panelTablist;
    const ratio = (scrollWidth - clientWidth) / (clientWidth - TRACK_INSET - thumb.offsetWidth);
    const move = (e) => {
      panelTablist.scrollLeft = scrollLeft + (e.clientX - event.clientX) * ratio;
    };
    event.preventDefault();
    thumb.setPointerCapture(event.pointerId);
    thumb.addEventListener("pointermove", move);
    thumb.addEventListener("lostpointercapture", () => thumb.removeEventListener("pointermove", move), { once: true });
  });

  const sizes = new ResizeObserver(() => {
    measure();
    fade();
  });
  for (const element of [header, mainRow, panelTablist]) sizes.observe(element);
  for (const child of demoPanel.children) if (child !== component) sizes.observe(child);
  panelTablist.addEventListener("scroll", fade, { passive: true });
  document.fonts?.ready.then(fade);   // the labels' widths change when the web font arrives

  // ---------------------------------------------------------------------------------------------
  // Tabs, the panel and the hash

  const read = (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const write = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // private window or blocked storage: the page works, it just forgets
    }
  };

  let shown = "demo";   // the main column's tab
  let tab = "description";
  let dockedOpen = read(OPEN_KEY) !== "false";
  let sheetOpen = false;
  let unseenRequests = false;
  let unseenRows = [];   // the finished non-demo rows that arrived while Requests wasn't showing
  let unseenStored = false;
  const scrollOf = {};   // each main tab keeps its own scroll position

  const isOpen = () => (wide.matches ? dockedOpen : sheetOpen);
  const isSheet = () => !wide.matches && sheetOpen;
  const showing = (name) => isOpen() && tab === name;

  function writeHash(name) {
    const hash = name === "demo" ? "" : `#${name}`;
    if (location.hash === hash) return;
    history.replaceState(history.state, "", hash || location.pathname + location.search);
  }

  function selectIn(list, attribute, value) {
    for (const button of list) {
      const selected = button.dataset[attribute] === value;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      document.getElementById(button.getAttribute("aria-controls")).hidden = !selected;
    }
  }

  function render() {
    selectIn(mainTabs, "tab", shown);
    selectIn(panelTabs, "panelTab", tab);
    const open = isOpen();
    panel.hidden = !open;
    panel.toggleAttribute("data-sheet", isSheet());
    // The sheet covers the page: the page doesn't scroll under it, and keyboard focus stays in it
    document.documentElement.toggleAttribute("data-sheet-open", isSheet());
    header.inert = main.inert = isSheet();
    toggle.setAttribute("aria-expanded", String(open));
    if (showing("requests")) {
      unseenRequests = false;
      unseenRows = [];
    }
    if (showing("stored")) unseenStored = false;
    paintUnseen();
    measure();
  }

  // The chosen panel tab, fully into view in its scrolling row
  function reveal() {
    if (isOpen()) panelTabs.find((button) => button.dataset.panelTab === tab).scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function selectMain(name, { hash = true } = {}) {
    if (name !== shown) {
      scrollOf[shown] = scrollY;
      shown = name;
      render();
      scrollTo(0, scrollOf[name] ?? 0);
    }
    if (hash) writeHash(shown);
  }

  function openOn(name) {
    tab = name;
    if (wide.matches) dockedOpen = true;
    else sheetOpen = true;
    render();
    reveal();
  }

  function choosePanel(name) {
    openOn(name);
    writeHash(tab);
  }

  function setOpen(open) {
    const wasSheet = isSheet();
    if (wide.matches) {
      dockedOpen = open;
      write(OPEN_KEY, String(open));
    } else {
      sheetOpen = open;
    }
    render();
    if (open) {
      reveal();
      if (isSheet()) panelTabs.find((button) => button.tabIndex === 0).focus();
    } else {
      if (PANEL.includes(location.hash.slice(1))) writeHash(shown);
      if (wasSheet) toggle.focus();
    }
  }

  function fromHash() {
    const name = decodeURIComponent(location.hash.slice(1));
    if (PANEL.includes(name)) return openOn(name);
    if (isSheet()) {
      sheetOpen = false;   // a main tab on a phone: show it, not the sheet over it
      render();
    }
    selectMain(name === "code" ? "code" : "demo", { hash: false });
  }

  function keyboard(list, onMove) {
    for (const button of list) {
      button.addEventListener("keydown", (e) => {
        const i = list.indexOf(button);
        const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: list.length - 1 }[e.key];
        if (next === undefined) return;
        e.preventDefault();
        const target = list[(next + list.length) % list.length];
        target.focus();
        onMove(target);
      });
    }
  }

  for (const button of mainTabs) button.addEventListener("click", () => selectMain(button.dataset.tab));
  keyboard(mainTabs, (button) => selectMain(button.dataset.tab));
  for (const button of panelTabs) button.addEventListener("click", () => choosePanel(button.dataset.panelTab));
  keyboard(panelTabs, (button) => choosePanel(button.dataset.panelTab));

  toggle.addEventListener("click", () => setOpen(!isOpen()));
  document.getElementById("panel-close").addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isSheet()) {
      e.preventDefault();
      setOpen(false);
    }
  });

  document.addEventListener("click", (e) => {
    const name = e.target.closest?.("[data-open-tab]")?.dataset.openTab;
    if (MAIN.includes(name)) selectMain(name);
    else if (PANEL.includes(name)) choosePanel(name);
  });

  addEventListener("hashchange", fromHash);

  // A docked panel that is open becomes a closed sheet below 768px, and is open again above
  wide.addEventListener("change", () => {
    sheetOpen = false;
    render();
  });

  // ---------------------------------------------------------------------------------------------
  // The badge on the toggle, the Requests counter and the Data dot

  function paintUnseen() {
    const open = isOpen();
    badge.hidden = open || !(unseenRequests || unseenStored);
    storedDot.hidden = !unseenStored;
    const rows = unseenRows.filter((row) => row.isConnected && !row.hidden);   // Clear empties the log
    requestsCount.hidden = rows.length === 0;
    requestsCount.textContent = String(rows.length);
    requestsCount.dataset.kind = rows.some((row) => row.dataset.state === "error") ? "error" : "ok";
    const what = [unseenRequests && "new requests", unseenStored && "stored data changed"].filter(Boolean).join(" and ");
    toggle.setAttribute("aria-label", open ? "Hide the panel" : what ? `Show the panel, ${what}` : "Show the panel");
    fade();   // the counter and the dot change the row's width
  }

  function sawRequest(row) {
    if (showing("requests")) return;
    unseenRequests = true;
    if (row) unseenRows.push(row);
    paintUnseen();
  }

  function flash(element) {
    element.removeAttribute("data-hood-flash");
    void element.offsetWidth;   // restart the animation
    element.setAttribute("data-hood-flash", "");
    element.addEventListener("animationend", () => element.removeAttribute("data-hood-flash"), { once: true });
  }

  // ---------------------------------------------------------------------------------------------
  // Requests: highlights, the counter and the rows' bodies

  const finished = new WeakSet();
  let current = null;
  let rowIds = 0;

  function expand(row, open) {
    const button = row.querySelector("[data-row-toggle]");
    const bodies = row.querySelector("[data-row-bodies]");
    if (!button || !bodies) return;
    button.setAttribute("aria-expanded", String(open));
    bodies.hidden = !open;
  }

  function onRow(row) {
    if (!(row instanceof HTMLElement) || row.parentElement !== requests) return;
    const bodies = row.querySelector("[data-row-bodies]");
    if (bodies && !bodies.id) {
      bodies.id = `request-bodies-${++rowIds}`;
      row.querySelector("[data-row-toggle]")?.setAttribute("aria-controls", bodies.id);
    }
    if (row.dataset.demo === "true") return;
    if (finished.has(row) || (row.dataset.state !== "ok" && row.dataset.state !== "error")) return;
    finished.add(row);
    sawRequest(row);

    current?.removeAttribute("data-hood-current");
    current = row;
    row.dataset.hoodCurrent = "true";
    flash(row);
    if (!requests.closest("[hidden]")) row.scrollIntoView({ block: "nearest" });
  }

  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") {
        if (record.attributeName === "data-state") onRow(record.target);
      } else {
        record.addedNodes.forEach(onRow);
      }
    }
    paintUnseen();   // a row removed or hidden leaves the counter
  }).observe(requests, { childList: true, attributes: true, subtree: true, attributeFilter: ["data-state", "hidden"] });

  requests.addEventListener("click", (e) => {
    const button = e.target.closest("[data-row-toggle]");
    if (button) expand(button.closest("li"), button.getAttribute("aria-expanded") !== "true");
  });

  // ---------------------------------------------------------------------------------------------
  // Data: first render, changes, highlights and <mark> on new entries

  const previous = new Map();   // section title → its text at the last render
  let marks = new Map();        // section title → { text, fresh } to keep highlighted across re-renders
  const IDENTITY = ["id", "key", "claim_id"];
  const titleOf = (section) => section.querySelector('[data-field="title"]')?.textContent ?? "";

  // For a JSON array of objects with an id, key or claim_id: the identities that weren't there before
  function freshEntries(before, text) {
    let now;
    try {
      now = JSON.parse(text);
    } catch {
      return null;
    }
    const isEntry = (entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry);
    const key = Array.isArray(now) && now.length && now.every(isEntry) ? IDENTITY.find((k) => now.every((entry) => k in entry)) : null;
    if (!key) return null;
    let old = [];
    try {
      old = JSON.parse(before ?? "[]");
    } catch {
      // not JSON before: every entry is new
    }
    const known = new Set(Array.isArray(old) ? old.filter(isEntry).map((entry) => JSON.stringify(entry[key])) : []);
    const fresh = new Set(now.map((entry) => JSON.stringify(entry[key])).filter((id) => !known.has(id)));
    return fresh.size ? { key, ids: fresh } : null;
  }

  // Rebuild the section's <pre> with a <mark> around the new entries' lines (host.js replaces it on its next refresh)
  function markEntries(pre, text, { key, ids }) {
    const entries = JSON.parse(text);
    const chunks = entries.map((entry) => JSON.stringify(entry, null, 2).replace(/^/gm, "  "));
    if (`[\n${chunks.join(",\n")}\n]` !== text) return false;   // not host.js's JSON.stringify(value, null, 2)
    const nodes = [document.createTextNode("[\n")];
    chunks.forEach((chunk, i) => {
      if (i) nodes.push(document.createTextNode(",\n"));
      if (ids.has(JSON.stringify(entries[i][key]))) {
        const mark = document.createElement("mark");
        mark.textContent = chunk;
        nodes.push(mark);
      } else {
        nodes.push(document.createTextNode(chunk));
      }
    });
    nodes.push(document.createTextNode("\n]"));
    pre.replaceChildren(...nodes);
    return true;
  }

  function highlight(section, pre, text, fresh, isNew) {
    if (!(fresh && markEntries(pre, text, fresh))) section.dataset.hoodChanged = "true";
    if (isNew) flash(section);
  }

  function onStoredRender() {
    const changed = [];
    for (const section of stored.children) {
      const title = titleOf(section);
      const pre = section.querySelector('[data-field="json"]');
      const text = pre?.textContent ?? "";
      const before = previous.get(title);
      previous.set(title, text);
      if (before === undefined) continue;   // the first render is the baseline
      if (before === text) {
        if (marks.get(title)?.text === text) highlight(section, pre, text, marks.get(title).fresh, false);
        continue;
      }
      changed.push({ section, pre, title, text, fresh: freshEntries(before, text) });
    }
    if (!changed.length) return;

    marks = new Map(changed.map(({ title, text, fresh }) => [title, { text, fresh }]));
    for (const { section, pre, text, fresh } of changed) highlight(section, pre, text, fresh, true);
    if (!showing("stored")) {
      unseenStored = true;
      paintUnseen();
    }
  }

  new MutationObserver(onStoredRender).observe(stored, { childList: true });

  // ---------------------------------------------------------------------------------------------
  // Notes: each new one is unseen until Requests shows; the read-outs block shows once there is one

  new MutationObserver((records) => {
    if (records.some((record) => [...record.addedNodes].some((node) => node instanceof HTMLElement))) sawRequest();
    readouts.hidden = false;
  }).observe(notes, { childList: true });

  // ---------------------------------------------------------------------------------------------

  requests.querySelectorAll(":scope > li").forEach(onRow);   // in case host.js logged before this ran
  if (notes.children.length) readouts.hidden = false;
  onStoredRender();
  fromHash();
  render();
  reveal();
}
