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
  { key: "processing_office",   label: "Office",           isDate: false },
];

let allItems = [];
let filteredItems = [];
let visibleColumns = new Set(COLUMNS.slice(0, 10).map(c => c.key));
let sortField = "application_date";
let sortDir = "desc";
let selectedId = null;

function loadColumns() {
  try {
    const s = localStorage.getItem("columns");
    if (s) visibleColumns = new Set(JSON.parse(s));
  } catch (_) {}
}
function saveColumns() { localStorage.setItem("columns", JSON.stringify([...visibleColumns])); }
loadColumns();

function parseDate(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

function monthsBetween(d1, d2) {
  if (!d1 || !d2) return null;
  return Math.round(((d2.getTime() - d1.getTime()) / 86400000 / 30.44) * 10) / 10;
}

function noData() {
  document.getElementById("loading-state").classList.add("hidden");
  document.getElementById("empty-state").classList.remove("hidden");
  document.getElementById("table").classList.add("hidden");
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
    errEl.innerHTML = `<p>Failed to load data</p><p style="margin-top:8px;font-size:0.85rem">Run <code>node main.js</code> first to scrape and process comments.</p>`;
    return;
  }

  const ids = Object.entries(state)
    .filter(([_, v]) => v.status === "processed")
    .map(([id]) => id);

  if (ids.length === 0) { noData(); return; }

  const items = [];
  const batchSize = 10;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(id =>
      fetch(`data/${id}.json`).then(r => r.json())
    ));
    items.push(...results);
  }

  allItems = items.map(computeDerived);
  document.getElementById("loading-state").classList.add("hidden");
  document.getElementById("table").classList.remove("hidden");
  applyAll();
}

function computeDerived(item) {
  const appDate = parseDate(item.application_date);
  item._id = item.source?.id || item.id;
  item._appDate = appDate;

  const months = {};
  for (const col of COLUMNS) {
    if (!col.isDate) continue;
    const d = parseDate(item[col.key]);
    months[col.key] = (appDate && d) ? monthsBetween(appDate, d) : null;
  }
  item._months = months;
  return item;
}

function applyAll() {
  applyFilters();
  renderStats();
  renderColumnsPopup();
  renderTable();
}

function applyFilters() {
  const checked = {};
  document.querySelectorAll(".filter-check").forEach(el => {
    checked[el.dataset.field] = el.classList.contains("checked");
  });

  const from = document.getElementById("filter-from").value;
  const to   = document.getElementById("filter-to").value;

  filteredItems = allItems.filter(item => {
    if (from && item.application_date && item.application_date < from) return false;
    if (to   && item.application_date && item.application_date > to)   return false;
    for (const [field, on] of Object.entries(checked)) {
      if (on && !item[field]) return false;
    }
    return true;
  });

  const dir = sortDir === "asc" ? 1 : -1;
  filteredItems.sort((a, b) => {
    const va = a[sortField] || "\uffff";
    const vb = b[sortField] || "\uffff";
    if (va < vb) return -dir;
    if (va > vb) return dir;
    return 0;
  });
}

function computeAverages(items) {
  const sums = {}, counts = {};
  for (const col of COLUMNS) {
    if (!col.isDate) continue;
    sums[col.key] = 0; counts[col.key] = 0;
  }
  for (const item of items) {
    for (const col of COLUMNS) {
      if (!col.isDate) continue;
      const v = item._months[col.key];
      if (v !== null && v !== undefined) { sums[col.key] += v; counts[col.key]++; }
    }
  }
  const avgs = {};
  for (const col of COLUMNS) {
    if (!col.isDate) continue;
    avgs[col.key] = counts[col.key] > 0 ? Math.round(sums[col.key] / counts[col.key] * 10) / 10 : null;
  }
  return avgs;
}

function renderStats() {
  const avgs = computeAverages(filteredItems);

  const stats = [
    { label: "Total", value: filteredItems.length },
    { label: "AOR avg", value: avgs.aor_date !== null ? `${avgs.aor_date}mo` : "—" },
    { label: "BG avg", value: avgs.background_check_date !== null ? `${avgs.background_check_date}mo` : "—" },
    { label: "Test avg", value: avgs.test_completed_date !== null ? `${avgs.test_completed_date}mo` : "—" },
    { label: "LPP avg", value: avgs.lpp_date !== null ? `${avgs.lpp_date}mo` : "—" },
    { label: "Oath avg", value: avgs.oath_ceremony_date !== null ? `${avgs.oath_ceremony_date}mo` : "—" },
  ];

  document.getElementById("stats-bar").innerHTML = stats.map(s =>
    `<div class="stat-card"><div class="stat-value">${s.value}</div><div class="stat-label">${s.label}</div></div>`
  ).join("");

  document.getElementById("header-count").textContent =
    `${filteredItems.length} of ${allItems.length}`;
}

function renderTable() {
  const thead = document.querySelector("#table thead");
  const tbody = document.querySelector("#table tbody");
  const empty = document.getElementById("empty-state");
  const avgs = computeAverages(filteredItems);

  const cols = COLUMNS.filter(c => visibleColumns.has(c.key));

  thead.innerHTML = "";
  const tr = document.createElement("tr");
  for (const col of cols) {
    const th = document.createElement("th");
    const m = (col.isDate && avgs[col.key] !== null) ? ` · ${avgs[col.key]}mo` : "";
    th.textContent = col.label + m;
    th.dataset.field = col.key;
    tr.appendChild(th);
  }
  thead.appendChild(tr);

  tbody.innerHTML = "";
  if (filteredItems.length === 0) {
    document.getElementById("table").classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }
  document.getElementById("table").classList.remove("hidden");
  empty.classList.add("hidden");

  for (const item of filteredItems) {
    const row = document.createElement("tr");
    row.dataset.id = item._id;
    if (item._id === selectedId) row.classList.add("selected");
    row.addEventListener("click", () => selectItem(item));

    for (const col of cols) {
      const td = document.createElement("td");
      const val = item[col.key];
      td.textContent = val || "—";
      if (!val) td.classList.add("empty");
      row.appendChild(td);
    }
    tbody.appendChild(row);
  }
}

function selectItem(item) {
  selectedId = item._id;
  document.querySelectorAll("tbody tr").forEach(r => r.classList.remove("selected"));
  const row = document.querySelector(`tbody tr[data-id="${item._id}"]`);
  if (row) row.classList.add("selected");
  renderSidePanel(item);
}

function renderSidePanel(item) {
  const panel = document.getElementById("detail-panel");
  const body = document.getElementById("detail-body");
  panel.classList.remove("hidden");

  document.getElementById("panel-title").textContent =
    item.application_date || item._id;

  body.innerHTML = `
    <div class="id-tag">ID: ${item._id}</div>

    <div class="section-title">Timeline</div>
    <table class="field-table">
      ${COLUMNS.filter(c => visibleColumns.has(c.key) || c.key === "application_date").map(c => `
        <tr><td>${c.label}</td><td>${item[c.key] || "—"}${c.isDate && item._months[c.key] !== null ? ` · ${item._months[c.key]}mo` : ""}</td></tr>
      `).join("")}
    </table>

    ${item.extra_steps && item.extra_steps.length ? `
    <div class="section-title">Extra Steps</div>
    <table class="field-table">
      ${item.extra_steps.map(s => `<tr><td>${s.step}</td><td>${s.date || "—"}</td></tr>`).join("")}
    </table>` : ""}

    ${item.notes ? `
    <div class="section-title">Notes</div>
    <div class="notes-text">${item.notes}</div>` : ""}

    <div class="section-title">Source</div>
    <div class="source-thread">${formatSourceThread(item.source)}</div>
  `;

  document.getElementById("close-panel").onclick = closePanel;
}

function closePanel() {
  document.getElementById("detail-panel").classList.add("hidden");
  selectedId = null;
  document.querySelectorAll("tbody tr").forEach(r => r.classList.remove("selected"));
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
  popup.innerHTML = COLUMNS.map(c => `
    <label><input type="checkbox" ${visibleColumns.has(c.key) ? "checked" : ""} data-colid="${c.key}"> ${c.label}</label>
  `).join("");

  popup.querySelectorAll("input").forEach(cb => {
    cb.addEventListener("change", () => {
      if (cb.checked) visibleColumns.add(cb.dataset.colid);
      else visibleColumns.delete(cb.dataset.colid);
      saveColumns();
      applyAll();
    });
  });
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
  sortEl.innerHTML = COLUMNS.filter(c => c.isDate).map(c =>
    `<option value="${c.key}" ${c.key === sortField ? "selected" : ""}>${c.label}</option>`
  ).join("");

  sortEl.addEventListener("change", () => { sortField = sortEl.value; applyAll(); });

  document.getElementById("sort-dir").addEventListener("click", () => {
    sortDir = sortDir === "asc" ? "desc" : "asc";
    document.getElementById("sort-dir").textContent = sortDir === "asc" ? "ASC ▲" : "DESC ▼";
    applyAll();
  });

  document.getElementById("clear-btn").addEventListener("click", () => {
    document.querySelectorAll(".filter-check").forEach(el => el.classList.remove("checked"));
    document.getElementById("filter-from").value = "";
    document.getElementById("filter-to").value = "";
    sortField = "application_date";
    sortDir = "desc";
    document.getElementById("sort-dir").textContent = "DESC ▼";
    document.getElementById("sort-field").value = "application_date";
    applyAll();
  });

  document.querySelectorAll(".filter-check").forEach(el => {
    el.addEventListener("click", () => { el.classList.toggle("checked"); applyAll(); });
  });

  const d = debounce(applyAll, 200);
  document.getElementById("filter-from").addEventListener("input", d);
  document.getElementById("filter-to").addEventListener("input", d);

  document.getElementById("cols-btn").addEventListener("click", toggleColumnsPopup);
  document.addEventListener("click", () => document.getElementById("cols-popup").classList.remove("show"));

  fetchAll();
}

init();
