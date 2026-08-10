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
let table;
let visibleColumns = new Set(COLUMNS.slice(0, 10).map(c => c.key));
let sortField = "application_date";
let sortDir = "desc";
let selectedId = null;

function loadColumns() {
  try { const s = localStorage.getItem("columns"); if (s) visibleColumns = new Set(JSON.parse(s)); } catch (_) {}
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

  if (ids.length === 0) {
    document.getElementById("loading-state").classList.add("hidden");
    document.getElementById("empty-state").classList.remove("hidden");
    return;
  }

  const items = [];
  const batchSize = 10;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(id =>
      fetch(`data/${id}.json`).then(r => r.json())
    ));
    items.push(...results);
  }

  allItems = items.map(item => {
    const appDate = parseDate(item.application_date);
    item._id = item.source?.id || item.id;
    item._appDate = appDate;
    item._months = {};
    for (const col of COLUMNS) {
      if (!col.isDate) continue;
      const d = parseDate(item[col.key]);
      item._months[col.key] = (appDate && d) ? monthsBetween(appDate, d) : null;
    }
    return item;
  });

  document.getElementById("loading-state").classList.add("hidden");
  initTable();
}

function getFiltered() {
  const checked = {};
  document.querySelectorAll(".filter-check").forEach(el => {
    checked[el.dataset.field] = el.classList.contains("checked");
  });

  const from = document.getElementById("filter-from").value;
  const to   = document.getElementById("filter-to").value;

  let items = allItems.filter(item => {
    if (from && item.application_date && item.application_date < from) return false;
    if (to   && item.application_date && item.application_date > to)   return false;
    for (const [field, on] of Object.entries(checked)) {
      if (on && !item[field]) return false;
    }
    return true;
  });

  const dir = sortDir === "asc" ? 1 : -1;
  items.sort((a, b) => {
    const va = a[sortField] || "\uffff";
    const vb = b[sortField] || "\uffff";
    if (va < vb) return -dir;
    if (va > vb) return dir;
    return 0;
  });

  return items;
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

function updateStats(filteredItems) {
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
  document.getElementById("header-count").textContent = `${filteredItems.length} of ${allItems.length}`;
}

function updateColumnHeaders(avgs) {
  if (!table) return;
  const cols = table.getColumnDefinitions();
  for (const col of cols) {
    const def = COLUMNS.find(c => c.key === col.field);
    if (!def || !def.isDate) continue;
    const m = avgs[col.field] !== null ? ` · ${avgs[col.field]}mo` : "";
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

  const cols = COLUMNS.filter(c => visibleColumns.has(c.key)).map(c => ({
    title: c.label + (c.isDate && avgs[c.key] !== null ? ` · ${avgs[c.key]}mo` : ""),
    field: c.key,
    sorter: "string",
    headerSort: false,
    isDate: c.isDate,
    formatter: c.isDate ? function(cell) { return cell.getValue() || "—"; } : "plaintext",
  }));

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

  body.innerHTML = `
    <div class="id-tag">ID: ${item._id}</div>
    <div class="section-title">Timeline</div>
    <table class="field-table">
      ${COLUMNS.filter(c => c.key === "application_date" || visibleColumns.has(c.key)).map(c => `
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
  popup.innerHTML = COLUMNS.map(c => `
    <label><input type="checkbox" ${visibleColumns.has(c.key) ? "checked" : ""} data-colid="${c.key}"> ${c.label}</label>
  `).join("");

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
  table.destroy();
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
  sortEl.innerHTML = COLUMNS.filter(c => c.isDate).map(c =>
    `<option value="${c.key}" ${c.key === sortField ? "selected" : ""}>${c.label}</option>`
  ).join("");

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
    refreshTable();
  });

  document.querySelectorAll(".filter-check").forEach(el => {
    el.addEventListener("click", () => { el.classList.toggle("checked"); refreshTable(); });
  });

  const d = debounce(refreshTable, 200);
  document.getElementById("filter-from").addEventListener("input", d);
  document.getElementById("filter-to").addEventListener("input", d);

  document.getElementById("cols-btn").addEventListener("click", toggleColumnsPopup);
  document.addEventListener("click", () => document.getElementById("cols-popup").classList.remove("show"));

  fetchAll();
}

init();
