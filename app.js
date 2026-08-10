const COLUMNS = [
  { key: "application_date",    label: "Application Date",     isDate: true },
  { key: "aor_date",            label: "AOR",                  isDate: true },
  { key: "background_check_date", label: "Background Check",   isDate: true },
  { key: "test_invitation_date", label: "Test Invitation",     isDate: true },
  { key: "test_taken_date",     label: "Test Taken",           isDate: true },
  { key: "test_completed_date", label: "Test Completed",       isDate: true },
  { key: "lpp_date",            label: "LPP",                  isDate: true },
  { key: "oath_scheduled_date", label: "Oath Scheduled",       isDate: true },
  { key: "oath_ceremony_date",  label: "Oath Ceremony",        isDate: true },
  { key: "location",            label: "Location",             isDate: false },
  { key: "application_type",    label: "Application Type",     isDate: false },
  { key: "processing_office",   label: "Processing Office",    isDate: false },
];

let allItems = [];
let filteredItems = [];
let visibleColumns = new Set(COLUMNS.slice(0, 10).map(c => c.key));
let sortField = "application_date";
let sortDir = "desc";
let filters = {};
let selectedId = null;

function loadVisibleColumns() {
  try {
    const s = localStorage.getItem("columns");
    if (s) visibleColumns = new Set(JSON.parse(s));
  } catch (_) {}
}
function saveVisibleColumns() {
  localStorage.setItem("columns", JSON.stringify([...visibleColumns]));
}
loadVisibleColumns();

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
  showLoading();

  const stateRes = await fetch("data/state.json");
  if (!stateRes.ok) throw new Error("state.json not found");
  const state = await stateRes.json();

  const ids = Object.entries(state)
    .filter(([_, v]) => v.status === "processed")
    .map(([id]) => id);

  const items = [];
  const batchSize = 10;

  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(id =>
      fetch(`data/${id}.json`).then(r => r.json())
    ));
    items.push(...results);
  }

  allItems = items.map(computeDerived).filter(f => f);
  applyAll();
}

function computeDerived(item) {
  const appDate = parseDate(item.application_date);
  if (!appDate) return null;

  const months = {};
  for (const col of COLUMNS) {
    if (!col.isDate) continue;
    const d = parseDate(item[col.key]);
    months[col.key] = d ? monthsBetween(appDate, d) : null;
  }
  item._months = months;
  item._appDate = appDate;
  return item;
}

function applyAll() {
  applyFilters();
  const avgs = computeAverages(filteredItems);
  renderStats();
  renderColumnsPopup();
  renderTable(filteredItems, avgs);
}

function applyFilters() {
  const checked = {};
  document.querySelectorAll(".stage-filter").forEach(cb => {
    checked[cb.dataset.field] = cb.checked;
  });

  const from = document.getElementById("filter-from").value;
  const to   = document.getElementById("filter-to").value;

  filteredItems = allItems.filter(item => {
    if (from && item.application_date < from) return false;
    if (to   && item.application_date > to)   return false;

    for (const [field, on] of Object.entries(checked)) {
      if (on && !item[field]) return false;
    }
    return true;
  });

  const dir = sortDir === "asc" ? 1 : -1;
  filteredItems.sort((a, b) => {
    const va = a[sortField] || "", vb = b[sortField] || "";
    if (!va && !vb) return 0;
    if (!va) return 1; if (!vb) return -1;
    return va < vb ? -dir : va > vb ? dir : 0;
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
      if (v !== null && v !== undefined) {
        sums[col.key] += v;
        counts[col.key]++;
      }
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
  document.getElementById("stats-row").innerHTML =
    `<span>Showing <span class="count">${filteredItems.length}</span> of <span class="count">${allItems.length}</span> timelines</span>`;
}

function renderTable(items, avgs) {
  const thead = document.querySelector("thead");
  const tbody = document.querySelector("tbody");
  const empty = document.getElementById("empty-state");

  const cols = COLUMNS.filter(c => visibleColumns.has(c.key));

  thead.innerHTML = "";
  const tr = document.createElement("tr");
  for (const col of cols) {
    const th = document.createElement("th");
    if (col.isDate && avgs[col.key] !== null) {
      th.textContent = `${col.label} (${avgs[col.key]}mo)`;
    } else {
      th.textContent = col.label;
    }
    th.dataset.field = col.key;
    tr.appendChild(th);
  }
  thead.appendChild(tr);

  tbody.innerHTML = "";
  if (items.length === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  for (const item of items) {
    const row = document.createElement("tr");
    row.dataset.id = item.id;
    if (item.id === selectedId) row.classList.add("selected");
    row.addEventListener("click", () => selectItem(item));

    for (const col of cols) {
      const td = document.createElement("td");
      if (col.key === "location") {
        td.textContent = item[col.key] || "—";
      } else {
        td.textContent = item[col.key] || "—";
        if (!item[col.key]) td.classList.add("empty");
      }
      if (col.key === sortField && col.isDate) {
        td.classList.add("sorted");
      }
      row.appendChild(td);
    }
    tbody.appendChild(row);
  }
}

function selectItem(item) {
  selectedId = item.id;
  document.querySelectorAll("tbody tr").forEach(r => r.classList.remove("selected"));
  const row = document.querySelector(`tbody tr[data-id="${item.id}"]`);
  if (row) row.classList.add("selected");
  renderSidePanel(item);
}

function renderSidePanel(item) {
  const panel = document.getElementById("detail-panel");
  const body = document.getElementById("detail-body");
  panel.classList.remove("hidden");

  body.innerHTML = `
    <h3>${item.application_date || "—"}</h3>
    <div class="id-tag">ID: ${item.id}</div>

    <div class="section-title">Timeline</div>
    <table class="field-table">${COLUMNS.filter(c => c.isDate || c.key === "location" || c.key === "application_type" || c.key === "processing_office").map(c => `
      <tr><td>${c.label}</td><td>${item[c.key] || "—"}${c.isDate && item._months[c.key] !== null ? ` (${item._months[c.key]}mo)` : ""}</td></tr>
    `).join("")}</table>

    ${item.extra_steps && item.extra_steps.length ? `
    <div class="section-title">Extra Steps</div>
    <table class="field-table">${item.extra_steps.map(s => `
      <tr><td>${s.step}</td><td>${s.date || "—"}</td></tr>
    `).join("")}</table>` : ""}

    ${item.notes ? `
    <div class="section-title">Notes</div>
    <div class="notes-text">${item.notes}</div>` : ""}

    <div class="section-title">Source Thread</div>
    <div class="source-thread">${formatSourceThread(item.source)}</div>
  `;

  document.getElementById("close-panel").onclick = () => {
    panel.classList.add("hidden");
    selectedId = null;
    document.querySelectorAll("tbody tr").forEach(r => r.classList.remove("selected"));
  };
}

function formatSourceThread(node, depth) {
  depth = depth || 0;
  const indent = "  ".repeat(depth);
  const date = node.created ? ` (${node.created})` : "";
  let text = `${indent}[id: ${node.id}]${date} ${node.body}\n`;
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
      saveVisibleColumns();
      applyAll();
    });
  });
}

function toggleColumnsPopup(e) {
  const popup = document.getElementById("cols-popup");
  popup.classList.toggle("hidden");
  if (!popup.classList.contains("hidden")) {
    const btn = document.getElementById("cols-btn");
    const rect = btn.getBoundingClientRect();
    popup.style.top = (rect.bottom + 4) + "px";
    popup.style.left = Math.min(rect.left, window.innerWidth - 220) + "px";
  }
  e.stopPropagation();
}

function showLoading() {
  document.querySelector("tbody").innerHTML =
    `<tr><td colspan="10" style="text-align:center;padding:40px">Loading timelines...</td></tr>`;
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function init() {
  const fromEl = document.getElementById("filter-from");
  const toEl   = document.getElementById("filter-to");
  const sortFieldEl = document.getElementById("sort-field");
  const sortDirBtn = document.getElementById("sort-dir");

  sortFieldEl.innerHTML = COLUMNS.filter(c => c.isDate).map(c =>
    `<option value="${c.key}" ${c.key === sortField ? "selected" : ""}>${c.label}</option>`
  ).join("");

  sortFieldEl.addEventListener("change", () => {
    sortField = sortFieldEl.value;
    applyAll();
  });

  sortDirBtn.addEventListener("click", () => {
    sortDir = sortDir === "asc" ? "desc" : "asc";
    sortDirBtn.textContent = sortDir === "asc" ? "ASC ▲" : "DESC ▼";
    applyAll();
  });

  document.getElementById("clear-btn").addEventListener("click", () => {
    document.querySelectorAll(".stage-filter").forEach(cb => cb.checked = false);
    fromEl.value = ""; toEl.value = "";
    filters = {};
    applyAll();
  });

  const d = debounce(applyAll, 200);
  fromEl.addEventListener("input", d);
  toEl.addEventListener("input", d);
  document.querySelectorAll(".stage-filter").forEach(cb => cb.addEventListener("change", () => applyAll()));

  document.getElementById("cols-btn").addEventListener("click", toggleColumnsPopup);
  document.addEventListener("click", () => document.getElementById("cols-popup").classList.add("hidden"));

  fetchAll().catch(err => {
    document.querySelector("tbody").innerHTML =
      `<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--red)">Failed to load data: ${err.message}<br><small>Run the scraper first with <code>node main.js</code></small></td></tr>`;
  });
}

init();
