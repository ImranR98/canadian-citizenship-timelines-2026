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
  { key: "extra_steps",         label: "Extra Steps",      isDate: false },
  { key: "notes",               label: "Notes",            isDate: false },
];

const DEFAULT_VISIBLE = new Set(COLUMNS.map(c => c.key));

const DATE_FIELDS = COLUMNS.filter(c => c.isDate).map(c => c.key);

let allItems = [];
let table;
let visibleColumns = new Set(DEFAULT_VISIBLE);
let sortField = "application_date";
let sortDir = "desc";
let selectedId = null;
let selectedLocations = new Set();
let expandedNotes = false;
let expandedExtra = false;
let estimatorFilled = {};
let estimatorCollapsed = false;

const ESTIMATOR_KEYS = {
  app: "application_date", aor: "aor_date", bg: "background_check_date",
  test_inv: "test_invitation_date", test_tkn: "test_taken_date",
  test_cmp: "test_completed_date", lpp: "lpp_date", os: "oath_scheduled_date",
  oc: "oath_ceremony_date"
};

function parseQueryParams() {
  const p = new URLSearchParams(window.location.search);
  estimatorFilled = {};
  for (const [short, key] of Object.entries(ESTIMATOR_KEYS)) {
    const v = p.get(short);
    if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) estimatorFilled[key] = v;
  }
  if (p.get("from")) document.getElementById("filter-from").value = p.get("from");
  if (p.get("to")) document.getElementById("filter-to").value = p.get("to");
  if (p.get("sort")) sortField = p.get("sort");
  if (p.get("dir")) sortDir = p.get("dir") === "asc" ? "asc" : "desc";
  if (p.get("missing") === "1") {
    setTimeout(() => {
      const el = document.querySelector(`.filter-check[data-field="_missing_date"]`);
      if (el) el.classList.add("checked");
    }, 0);
  }
  for (const f of ["aor_date","background_check_date","test_completed_date","lpp_date","oath_ceremony_date"]) {
    if (p.get("filter_" + f) === "1") {
      setTimeout(() => {
        const el = document.querySelector(`.filter-check[data-field="${f}"]`);
        if (el) el.classList.add("checked");
      }, 0);
    }
  }
  p.getAll("loc").forEach(loc => selectedLocations.add(loc));
}

function computeEstimates() {
  const avgs = computeAverages(getFiltered());
  const expectations = {};
  const estimates = {};
  const pinned = {};

  const known = [];
  for (const f of DATE_FIELDS) {
    if (estimatorFilled[f]) known.push({ field: f, date: parseDate(estimatorFilled[f]) });
  }
  if (known.length === 0) return { estimates, expectations, pinned };

  const stepDays = {};
  for (const f of DATE_FIELDS) {
    if (f === "application_date") {
      stepDays[f] = 0;
    } else {
      const avg = avgs[f];
      stepDays[f] = (avg !== null && avg !== undefined) ? avg : null;
    }
  }

  for (const f of DATE_FIELDS) {
    if (stepDays[f] === null) continue;

    const isFilled = !!estimatorFilled[f];
    let prev = null, next = null;
    for (let i = DATE_FIELDS.indexOf(f) - 1; i >= 0; i--) {
      const d = estimatorFilled[DATE_FIELDS[i]];
      if (d) { prev = { field: DATE_FIELDS[i], date: parseDate(d) }; break; }
    }
    for (let i = DATE_FIELDS.indexOf(f) + 1; i < DATE_FIELDS.length; i++) {
      const d = estimatorFilled[DATE_FIELDS[i]];
      if (d) { next = { field: DATE_FIELDS[i], date: parseDate(d) }; break; }
    }

    let exp;
    if (prev && next && stepDays[prev.field] !== null && stepDays[next.field] !== null) {
      const totalAvg = stepDays[next.field] - stepDays[prev.field];
      const gapAvg = stepDays[f] - stepDays[prev.field];
      const ratio = totalAvg > 0 ? gapAvg / totalAvg : 0;
      const actualGap = (next.date.getTime() - prev.date.getTime()) / 86400000;
      exp = new Date(prev.date.getTime() + actualGap * ratio * 86400000);
    } else if (prev && stepDays[prev.field] !== null) {
      const gap = stepDays[f] - stepDays[prev.field];
      exp = new Date(prev.date.getTime() + gap * 86400000);
    } else if (next && stepDays[next.field] !== null) {
      const gap = stepDays[next.field] - stepDays[f];
      exp = new Date(next.date.getTime() - gap * 86400000);
    } else {
      continue;
    }
    expectations[f] = exp.toISOString().slice(0, 10);

    if (!isFilled) {
      estimates[f] = exp.toISOString().slice(0, 10);
    }
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let shiftMs = 0;
  for (const f of DATE_FIELDS) {
    if (estimates[f]) {
      let d = new Date(estimates[f] + "T00:00:00Z");
      if (d < today) {
        const diffMs = today.getTime() - d.getTime();
        if (diffMs > shiftMs) shiftMs = diffMs;
        pinned[f] = true;
      }
      if (shiftMs > 0) {
        d = new Date(d.getTime() + shiftMs);
        estimates[f] = d.toISOString().slice(0, 10);
      }
    }
  }
  return { estimates, expectations, pinned };
}

function applyEstimator() {
  const { estimates, expectations, pinned } = computeEstimates();
  const inputs = document.querySelectorAll("#estimator-card input[type=date]");
  for (const inp of inputs) {
    const step = inp.dataset.step;
    let actual;
    if (estimatorFilled[step]) {
      inp.value = estimatorFilled[step];
      actual = estimatorFilled[step];
      inp.className = "user-filled";
    } else if (estimates[step]) {
      inp.value = estimates[step];
      actual = estimates[step];
      inp.className = "estimated";
    } else {
      inp.value = "";
      inp.className = "estimated";
      inp.placeholder = "—";
      continue;
    }

    const expDate = expectations[step];
    if (expDate && actual && step !== "application_date") {
      if (pinned[step]) {
        inp.classList.add("pinned");
      } else if (actual > expDate) {
        inp.classList.add("late");
      } else if (actual < expDate) {
        inp.classList.add("early");
      }
    }
  }
}

function buildUrl() {
  const u = new URL(window.location.href);
  u.search = "";
  for (const [key, val] of Object.entries(estimatorFilled)) {
    const short = Object.entries(ESTIMATOR_KEYS).find(([, k]) => k === key);
    if (short) u.searchParams.set(short[0], val);
  }
  const from = document.getElementById("filter-from").value;
  const to = document.getElementById("filter-to").value;
  if (from) u.searchParams.set("from", from);
  if (to) u.searchParams.set("to", to);
  u.searchParams.set("sort", sortField);
  u.searchParams.set("dir", sortDir);
  if (document.querySelector(`.filter-check[data-field="_missing_date"]`)?.classList.contains("checked")) {
    u.searchParams.set("missing", "1");
  }
  for (const f of ["aor_date","background_check_date","test_completed_date","lpp_date","oath_ceremony_date"]) {
    if (document.querySelector(`.filter-check[data-field="${f}"]`)?.classList.contains("checked")) {
      u.searchParams.set("filter_" + f, "1");
    }
  }
  for (const loc of selectedLocations) {
    u.searchParams.append("loc", loc);
  }
  return u.toString();
}

function initEstimator() {
  parseQueryParams();

  document.getElementById("estimator-btn").addEventListener("click", () => {
    document.getElementById("estimator-card").classList.toggle("hidden");
  });

  document.getElementById("estimator-collapse").addEventListener("click", () => {
    estimatorCollapsed = !estimatorCollapsed;
    document.getElementById("estimator-collapse").textContent = estimatorCollapsed ? "▼" : "▲";
    document.querySelector(".estimator-grid").style.display = estimatorCollapsed ? "none" : "grid";
  });

  document.getElementById("estimator-clear").addEventListener("click", () => {
    estimatorFilled = {};
    applyEstimator();
  });

  document.getElementById("estimator-copy").addEventListener("click", () => {
    const url = buildUrl();
    navigator.clipboard.writeText(url).then(() => {
      const btn = document.getElementById("estimator-copy");
      btn.textContent = "Copied!";
      setTimeout(() => { btn.textContent = "Copy link"; }, 1500);
    }).catch(() => {
      alert("Failed to copy: " + url);
    });
  });

  document.querySelectorAll("#estimator-card input[type=date]").forEach(inp => {
    inp.addEventListener("input", () => {
      const step = inp.dataset.step;
      if (inp.value && /^\d{4}-\d{2}-\d{2}$/.test(inp.value)) {
        estimatorFilled[step] = inp.value;
      } else {
        delete estimatorFilled[step];
      }
      applyEstimator();
    });
  });

  if (Object.keys(estimatorFilled).length > 0) {
    document.getElementById("estimator-card").classList.remove("hidden");
  }
  applyEstimator();
}

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem("settings"));
    if (!s) return;
    if (s.columns) visibleColumns = new Set(s.columns);
    if (s.sortField) sortField = s.sortField;
    if (s.sortDir) sortDir = s.sortDir;
    if (s.locations) selectedLocations = new Set(s.locations);
    if (s.stages) {
      for (const [field, on] of Object.entries(s.stages)) {
        if (on) {
          setTimeout(() => {
            const el = document.querySelector(`.filter-check[data-field="${field}"]`);
            if (el) el.classList.add("checked");
          }, 0);
        }
      }
    }
    if (s.missingDate) {
      setTimeout(() => {
        const el = document.querySelector(`.filter-check[data-field="_missing_date"]`);
        if (el) el.classList.add("checked");
      }, 0);
    }
    if (s.from) {
      setTimeout(() => { document.getElementById("filter-from").value = s.from; }, 0);
    }
    if (s.to) {
      setTimeout(() => { document.getElementById("filter-to").value = s.to; }, 0);
    }
  } catch (e) { console.debug("Failed to load settings:", e.message); }
}

function saveSettings() {
  const stages = {};
  document.querySelectorAll(".filter-check").forEach(el => {
    if (el.dataset.field !== "_missing_date") {
      stages[el.dataset.field] = el.classList.contains("checked");
    }
  });
  const missingDate = document.querySelector(`.filter-check[data-field="_missing_date"]`)?.classList.contains("checked") || false;
  const settings = {
    columns: [...visibleColumns],
    sortField,
    sortDir,
    locations: [...selectedLocations],
    stages,
    missingDate,
    from: document.getElementById("filter-from").value,
    to: document.getElementById("filter-to").value,
  };
  localStorage.setItem("settings", JSON.stringify(settings));
}
loadSettings();

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
    item._updated = (item.source?.edited || item.source?.created || "");
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
  applyEstimator();
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

function refreshTable(dataChanged) {
  if (dataChanged === undefined) dataChanged = true;
  const card = document.getElementById("filter-card");
  card.classList.add("busy");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        const filteredItems = getFiltered();
        const avgs = computeAverages(filteredItems);
        updateStats(filteredItems);
        updateColumnHeaders(avgs);
        if (table) {
          if (dataChanged) {
            table.setData(filteredItems);
            table.setSort(sortField, sortDir);
          } else {
            table.setSort(sortField, sortDir);
          }
        }
        saveSettings();
        applyEstimator();
      } finally {
        card.classList.remove("busy");
      }
    });
  });
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
        const text = v.map(s => s.step + (s.date ? " (" + s.date + ")" : "")).join(", ");
        return expandedExtra ? text : (text.length > 70 ? text.slice(0, 70) + "…" : text);
      };
    } else if (c.key === "notes") {
      formatter = function(cell) {
        const v = cell.getValue();
        if (!v) return "—";
        return expandedNotes ? v : (v.length > 50 ? v.slice(0, 50) + "…" : v);
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
    columnDefaults: { resizable: false },
    height: "calc(100vh - 230px)",
    movableColumns: false,
    selectable: 1,
    rowClick: function(e, row) { selectItem(row.getData()); },
    placeholder: "No matching timelines.",
    initialSort: [{ column: sortField, dir: sortDir }],
  });

  table.on("cellClick", function(e, cell) {
    const field = cell.getColumn().getField();
    if (field !== "notes" && field !== "extra_steps") return;
    const scrollEl = table.rowManager.element;
    const st = scrollEl.scrollTop;
    const sl = scrollEl.scrollLeft;
    if (field === "notes") expandedNotes = !expandedNotes;
    else expandedExtra = !expandedExtra;
    table.redraw(true);
    requestAnimationFrame(() => { scrollEl.scrollTop = st; scrollEl.scrollLeft = sl; });
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
      saveSettings();
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
  const updOpt = document.createElement("option");
  updOpt.value = "_updated";
  updOpt.textContent = "Last updated";
  if (sortField === "_updated") updOpt.selected = true;
  sortEl.appendChild(updOpt);

  sortEl.addEventListener("change", () => {
    sortField = sortEl.value;
    refreshTable(false);
  });

  document.getElementById("sort-dir").addEventListener("click", () => {
    sortDir = sortDir === "asc" ? "desc" : "asc";
    document.getElementById("sort-dir").textContent = sortDir === "asc" ? "Oldest first" : "Newest first";
    refreshTable(false);
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
  initEstimator();
  fetchAll();
}

init();
