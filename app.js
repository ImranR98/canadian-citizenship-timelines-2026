"use strict";

const COLUMNS = [
  { key: "application_date",    label: "Application",      isDate: true },
  { key: "aor_date",            label: "AOR",              isDate: true },
  { key: "background_check_date", label: "Background",     isDate: true },
  { key: "test_invitation_date", label: "Test Invite",     isDate: true },
  { key: "test_taken_date",     label: "Test Taken",       isDate: true },
  { key: "test_completed_date", label: "Test Complete",    isDate: true },
  { key: "lpp_date",            label: "LPP",              isDate: true },
  { key: "oath_scheduled_date", label: "Oath Scheduled",   isDate: true },
  { key: "oath_ceremony_date",  label: "Oath Ceremony",    isDate: true },
  { key: "location",            label: "Location",         isDate: false },
  { key: "application_type",    label: "App Type",         isDate: false },
  { key: "extra_steps",         label: "Extra Steps",      isDate: false },
  { key: "notes",               label: "Notes",            isDate: false },
];

const DEFAULT_VISIBLE = new Set([
  "application_date", "aor_date", "background_check_date",
  "test_invitation_date", "test_taken_date", "test_completed_date",
  "lpp_date", "oath_scheduled_date", "oath_ceremony_date",
  "location", "notes",
]);

let allItems = [];
let table;
let visibleColumns = new Set(DEFAULT_VISIBLE);
let sortField = "application_date";
let sortDir = "desc";
let selectedId = null;
let selectedLocations = new Set();

function loadColumns() {
  try { const s = localStorage.getItem("columns"); if (s) visibleColumns = new Set(JSON.parse(s)); } catch (e) { console.debug("Failed to load column preferences:", e.message); }
}
function saveColumns() { localStorage.setItem("columns", JSON.stringify([...visibleColumns])); }
loadColumns();

function parseDate(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(s + "T00:00:00Z") : null;
}

function daysBetween(d1, d2) {
  if (!d1 || !d2) return null;
  return Math.round((d2.getTime() - d1.getTime()) / 86400000);
}

async function fetchAll() {
  const errEl = document.getElementById("error-state");

  let state;
  try {
    const r = await fetch("data/state.json");
    if (!r.ok) throw new Error(`state.json: ${r.status}`);
    state = await r.json();
  } catch (e) {
    document.getElementById("loading-state").classList.add("hidden");
    errEl.classList.remove("hidden");
    errEl.replaceChildren();
    const p1 = document.createElement("p");
    p1.textContent = "Failed to load data";
    const p2 = document.createElement("p");
    p2.style.cssText = "margin-top:8px;font-size:0.85rem";
    p2.innerHTML = "Run <code>node main.js</code> first to scrape and process comments.";
    errEl.appendChild(p1);
    errEl.appendChild(p2);
    return;
  }

  const ids = Object.entries(state)
    .filter(([_, v]) => v.status === "processed")
    .map(([id]) => id);

  if (ids.length === 0) {
    document.getElementById("loading-state").classList.add("hidden");
    document.getElementById("empty-state").classList.remove("hidden");
    return;
  }

  const items = [];
  const batchSize = 10;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(id =>
      fetch(`data/${id}.json`).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    ));
    for (const r of results) {
      if (r.status === "fulfilled") items.push(r.value);
      else console.warn("Failed to load data item:", r.reason?.message || r.reason);
    }
  }

  allItems = items.map(item => {
    const appDate = parseDate(item.application_date);
    item._id = item.source?.id || item.id;
    item._appDate = appDate;
    item._months = {};
    for (const col of COLUMNS) {
      if (!col.isDate) continue;
      const d = parseDate(item[col.key]);
      item._months[col.key] = (appDate && d) ? daysBetween(appDate, d) : null;
    }
    return item;
  });

  document.getElementById("loading-state").classList.add("hidden");
  populateLocations();
  initTable();
  fetchLastScrape();
}

function populateLocations() {
  const locations = [...new Set(allItems.map(i => i.location).filter(Boolean))].sort();
  const popup = document.getElementById("loc-popup");
  popup.replaceChildren();
  popup.onclick = (e) => e.stopPropagation();

  for (const loc of locations) {
    addLocCheckbox(popup, loc, loc);
  }
  addLocCheckbox(popup, "_unknown", "Unknown");

  updateLocButton();
}

function addLocCheckbox(popup, key, label) {
  const wrap = document.createElement("label");
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = selectedLocations.has(key);
  wrap.appendChild(cb);
  wrap.appendChild(document.createTextNode(" " + label));
  cb.addEventListener("change", () => {
    if (cb.checked) selectedLocations.add(key);
    else selectedLocations.delete(key);
    updateLocButton();
    refreshTable();
  });
  popup.appendChild(wrap);
}

function updateLocButton() {
  const btn = document.getElementById("loc-btn");
  if (selectedLocations.size === 0) {
    btn.textContent = "All locations";
  } else if (selectedLocations.size === 1) {
    const v = [...selectedLocations][0];
    btn.textContent = v === "_unknown" ? "Unknown" : v;  } else {
    btn.textContent = `${selectedLocations.size} locations`;
  }
}

async function fetchLastScrape() {
  try {
    const r = await fetch("data/last_scrape.json");
    if (!r.ok) return;
    const { time } = await r.json();
    const d = new Date(time);
    document.getElementById("last-scrape").textContent =
      `Last scraped ${d.toLocaleDateString()} ${d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}`;
  } catch (e) { console.debug("Failed to load last scrape time:", e.message); }
}

function getFiltered() {
  const checked = {};
  document.querySelectorAll(".filter-check").forEach(el => {
    checked[el.dataset.field] = el.classList.contains("checked");
  });

  const from = document.getElementById("filter-from").value;
  const to   = document.getElementById("filter-to").value;
  const showMissing = checked["_missing_date"];

  let items = allItems.filter(item => {
    if (showMissing) return !item.application_date;
    if (!item.application_date) return false;
    if (from && item.application_date < from) return false;
    if (to   && item.application_date > to)   return false;
    for (const [field, on] of Object.entries(checked)) {
      if (field === "_missing_date") continue;
      if (on && !item[field]) return false;
    }
    if (selectedLocations.size > 0 && !(selectedLocations.has(item.location) || (selectedLocations.has("_unknown") && !item.location))) return false;
    return true;
  });

  const dir = sortDir === "asc" ? 1 : -1;
  items.sort((a, b) => {
    const va = a[sortField] || "\uffff";
    const vb = b[sortField] || "\uffff";
    if (va === vb) return 0;
    if (va === "\uffff") return 1;
    if (vb === "\uffff") return -1;
    return va < vb ? -dir : dir;
  });

  return items;
}

function computeAverages(items) {
  const sums = {}, counts = {};
  for (const col of COLUMNS) {
    if (!col.isDate || col.key === "application_date") continue;
    sums[col.key] = 0; counts[col.key] = 0;
  }
  for (const item of items) {
    for (const col of COLUMNS) {
      if (!col.isDate || col.key === "application_date") continue;
      const v = item._months[col.key];
      if (v !== null && v !== undefined) { sums[col.key] += v; counts[col.key]++; }
    }
  }
  const avgs = {};
  for (const col of COLUMNS) {
    if (!col.isDate || col.key === "application_date") continue;
    avgs[col.key] = counts[col.key] > 0 ? Math.round(sums[col.key] / counts[col.key] * 10) / 10 : null;
  }
  return avgs;
}

function updateStats(filteredItems) {
  const avgs = computeAverages(filteredItems);
  const stats = [
    { label: "Total", value: filteredItems.length },
    { label: "AOR avg", value: avgs.aor_date !== null ? `${avgs.aor_date}d` : "—" },
    { label: "BG avg", value: avgs.background_check_date !== null ? `${avgs.background_check_date}d` : "—" },
    { label: "Test avg", value: avgs.test_completed_date !== null ? `${avgs.test_completed_date}d` : "—" },
    { label: "LPP avg", value: avgs.lpp_date !== null ? `${avgs.lpp_date}d` : "—" },
    { label: "Oath avg", value: avgs.oath_ceremony_date !== null ? `${avgs.oath_ceremony_date}d` : "—" },
  ];
  const bar = document.getElementById("stats-bar");
  bar.replaceChildren();
  for (const s of stats) {
    const card = document.createElement("div");
    card.className = "stat-card";
    const val = document.createElement("div");
    val.className = "stat-value";
    val.textContent = String(s.value);
    const lbl = document.createElement("div");
    lbl.className = "stat-label";
    lbl.textContent = s.label;
    card.appendChild(val);
    card.appendChild(lbl);
    bar.appendChild(card);
  }
  document.getElementById("header-count").textContent = `${filteredItems.length} of ${allItems.length}`;
}

function updateColumnHeaders(avgs) {
  if (!table) return;
  const cols = table.getColumnDefinitions();
  for (const col of cols) {
    const def = COLUMNS.find(c => c.key === col.field);
    if (!def || !def.isDate) continue;
    const m = avgs[col.field] != null ? ` · ${avgs[col.field]}d` : "";
    table.updateColumnDefinition(col.field, { title: def.label + m });
  }
}

function refreshTable() {
  const filteredItems = getFiltered();
  const avgs = computeAverages(filteredItems);

  updateStats(filteredItems);
  updateColumnHeaders(avgs);

  if (table) {
    table.replaceData(filteredItems);
    table.setSort(sortField, sortDir);
  }
}

function initTable() {
  const filteredItems = getFiltered();
  const avgs = computeAverages(filteredItems);

  const cols = COLUMNS.filter(c => visibleColumns.has(c.key)).map(c => {
    let formatter = "plaintext";
    if (c.isDate) {
      formatter = function(cell) { return cell.getValue() || "—"; };
    } else if (c.key === "extra_steps") {
      formatter = function(cell) {
        const v = cell.getValue();
        if (!v || !v.length) return "—";
        return v.map(s => s.step + (s.date ? " (" + s.date + ")" : "")).join(", ");
      };
    }
    return {
      title: c.label + (c.isDate && avgs[c.key] != null ? ` · ${avgs[c.key]}d` : ""),
      field: c.key,
      sorter: "string",
      headerSort: false,
      formatter,
    };
  });

  table = new Tabulator("#table", {
    data: filteredItems,
    columns: cols,
    layout: "fitDataFill",
    height: "calc(100vh - 320px)",
    movableColumns: false,
    selectable: 1,
    rowClick: function(e, row) { selectItem(row.getData()); },
    placeholder: "No matching timelines.",
    initialSort: [{ column: sortField, dir: sortDir }],
  });

  updateStats(filteredItems);
}

function selectItem(item) {
  selectedId = item._id;
  table.selectRow(item._id);
  renderSidePanel(item);
}

function renderSidePanel(item) {
  const panel = document.getElementById("detail-panel");
  const body = document.getElementById("detail-body");
  panel.classList.remove("hidden");

  document.getElementById("panel-title").textContent = item.application_date || item._id;

  body.replaceChildren();

  const idTag = document.createElement("div");
  idTag.className = "id-tag";
  idTag.textContent = `ID: ${item._id}`;
  body.appendChild(idTag);

  body.appendChild(sectionTitle("Timeline"));
  const table = document.createElement("table");
  table.className = "field-table";
  const cols = COLUMNS.filter(c => c.key === "application_date" || visibleColumns.has(c.key));
  for (const c of cols) {
    const tr = document.createElement("tr");
    const td1 = document.createElement("td");
    td1.textContent = c.label;
    const td2 = document.createElement("td");
    let val = item[c.key] || "—";
    if (c.isDate && item._months[c.key] !== null) val += ` · ${item._months[c.key]}d`;
    td2.textContent = val;
    tr.appendChild(td1);
    tr.appendChild(td2);
    table.appendChild(tr);
  }
  body.appendChild(table);

  if (item.extra_steps && item.extra_steps.length) {
    body.appendChild(sectionTitle("Extra Steps"));
    const esTable = document.createElement("table");
    esTable.className = "field-table";
    for (const s of item.extra_steps) {
      const tr = document.createElement("tr");
      const td1 = document.createElement("td");
      td1.textContent = s.step;
      const td2 = document.createElement("td");
      td2.textContent = s.date || "—";
      tr.appendChild(td1);
      tr.appendChild(td2);
      esTable.appendChild(tr);
    }
    body.appendChild(esTable);
  }

  if (item.notes) {
    body.appendChild(sectionTitle("Notes"));
    const notesDiv = document.createElement("div");
    notesDiv.className = "notes-text";
    notesDiv.textContent = item.notes;
    body.appendChild(notesDiv);
  }

  body.appendChild(sectionTitle("Source"));
  const sourceDiv = document.createElement("div");
  sourceDiv.className = "source-thread";
  sourceDiv.textContent = formatSourceThread(item.source);
  body.appendChild(sourceDiv);

  document.getElementById("close-panel").onclick = closePanel;
}

function sectionTitle(text) {
  const div = document.createElement("div");
  div.className = "section-title";
  div.textContent = text;
  return div;
}

function closePanel() {
  document.getElementById("detail-panel").classList.add("hidden");
  selectedId = null;
  table.deselectRow();
}

function formatSourceThread(node, depth) {
  depth = depth || 0;
  const indent = "  ".repeat(depth);
  const date = node.created ? ` (${node.created})` : "";
  let text = `${indent}[${node.id}]${date} ${node.author ? "by " + node.author : ""}: ${node.body}\n`;
  for (const reply of (node.replies || [])) {
    text += formatSourceThread(reply, depth + 1);
  }
  return text;
}

function renderColumnsPopup() {
  const popup = document.getElementById("cols-popup");
  popup.replaceChildren();
  for (const c of COLUMNS) {
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = visibleColumns.has(c.key);
    cb.dataset.colid = c.key;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(" " + c.label));
    popup.appendChild(label);
  }

  popup.querySelectorAll("input").forEach(cb => {
    cb.addEventListener("change", () => {
      if (cb.checked) visibleColumns.add(cb.dataset.colid);
      else visibleColumns.delete(cb.dataset.colid);
      saveColumns();
      rebuildTable();
    });
  });
}

function rebuildTable() {
  if (table) table.destroy();
  initTable();
}

function toggleColumnsPopup(e) {
  const popup = document.getElementById("cols-popup");
  popup.classList.toggle("show");
  if (popup.classList.contains("show")) {
    const btn = document.getElementById("cols-btn");
    const rect = btn.getBoundingClientRect();
    popup.style.top = (rect.bottom + 4) + "px";
    popup.style.left = Math.min(rect.left, window.innerWidth - 220) + "px";
  }
  e.stopPropagation();
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function init() {
  const sortEl = document.getElementById("sort-field");
  sortEl.replaceChildren();
  for (const c of COLUMNS.filter(c => c.isDate)) {
    const opt = document.createElement("option");
    opt.value = c.key;
    opt.textContent = c.label;
    if (c.key === sortField) opt.selected = true;
    sortEl.appendChild(opt);
  }

  sortEl.addEventListener("change", () => {
    sortField = sortEl.value;
    refreshTable();
  });

  document.getElementById("sort-dir").addEventListener("click", () => {
    sortDir = sortDir === "asc" ? "desc" : "asc";
    document.getElementById("sort-dir").textContent = sortDir === "asc" ? "Oldest first" : "Newest first";
    refreshTable();
  });

  document.getElementById("clear-btn").addEventListener("click", () => {
    document.querySelectorAll(".filter-check").forEach(el => el.classList.remove("checked"));
    document.getElementById("filter-from").value = "";
    document.getElementById("filter-to").value = "";
    sortField = "application_date";
    sortDir = "desc";
    document.getElementById("sort-dir").textContent = "Newest first";
    document.getElementById("sort-field").value = "application_date";
    selectedLocations.clear();
    updateLocButton();
    refreshTable();
  });

  document.querySelectorAll(".filter-check").forEach(el => {
    el.addEventListener("click", () => { el.classList.toggle("checked"); refreshTable(); });
  });

  const d = debounce(refreshTable, 200);
  document.getElementById("filter-from").addEventListener("input", d);
  document.getElementById("filter-to").addEventListener("input", d);

  document.getElementById("cols-btn").addEventListener("click", toggleColumnsPopup);
  document.addEventListener("click", () => {
    document.getElementById("cols-popup").classList.remove("show");
    document.getElementById("loc-popup").classList.remove("show");
  });

  document.getElementById("loc-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    const popup = document.getElementById("loc-popup");
    popup.classList.toggle("show");
    if (popup.classList.contains("show")) {
      const btn = document.getElementById("loc-btn");
      const rect = btn.getBoundingClientRect();
      popup.style.top = (rect.bottom + 4) + "px";
      popup.style.left = Math.min(rect.left, window.innerWidth - 220) + "px";
    }
  });

  document.getElementById("about-btn").addEventListener("click", () => {
    document.getElementById("about-modal").classList.remove("hidden");
  });
  document.getElementById("close-modal").addEventListener("click", () => {
    document.getElementById("about-modal").classList.add("hidden");
  });
  document.getElementById("about-modal").addEventListener("click", function(e) {
    if (e.target === this) this.classList.add("hidden");
  });

  renderColumnsPopup();
  fetchAll();
}

init();
