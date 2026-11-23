import { loadGtfs, type GtfsFeed, type GtfsTable } from "./gtfs";

const app = document.querySelector<HTMLElement>("#app");

if (!app) {
  throw new Error("App root element not found");
}

app.innerHTML = `
  <main class="page">
    <header class="page__header">
      <p class="eyebrow">Transit data</p>
      <h1>GTFS Viewer</h1>
      <p class="intro">Explore the tables in a General Transit Feed Specification archive.</p>
    </header>
    <section class="panel" aria-labelledby="load-heading">
      <h2 id="load-heading">Load a GTFS feed</h2>
      <p>Choose a GTFS ZIP file from your device. The file is processed locally in your browser.</p>
      <form id="load-form">
        <label for="feed-file">GTFS ZIP file</label>
        <div class="form-controls">
          <input id="feed-file" type="file" accept=".zip,application/zip" required />
          <button type="submit">Load feed</button>
        </div>
      </form>
      <p id="status" role="status" aria-live="polite"></p>
    </section>
    <section id="viewer" class="panel viewer" aria-labelledby="viewer-heading" hidden>
      <h2 id="viewer-heading">Feed tables</h2>
      <p id="feed-summary"></p>
      <label for="table-select">Table</label>
      <select id="table-select"></select>
      <p id="table-summary" aria-live="polite"></p>
      <div class="table-scroll" tabindex="0" role="region" aria-label="GTFS table">
        <table>
          <thead id="table-head"></thead>
          <tbody id="table-body"></tbody>
        </table>
      </div>
      <div class="pagination">
        <button id="previous" type="button">Previous</button>
        <span id="page-label"></span>
        <button id="next" type="button">Next</button>
      </div>
    </section>
  </main>
`;

function element<T extends HTMLElement>(selector: string): T {
  const result = app!.querySelector<T>(selector);
  if (!result) throw new Error(`Missing element: ${selector}`);
  return result;
}

const form = element<HTMLFormElement>("#load-form");
const input = element<HTMLInputElement>("#feed-file");
const submit = element<HTMLButtonElement>("#load-form button");
const status = element<HTMLParagraphElement>("#status");
const viewer = element<HTMLElement>("#viewer");
const feedSummary = element<HTMLParagraphElement>("#feed-summary");
const tableSelect = element<HTMLSelectElement>("#table-select");
const tableSummary = element<HTMLParagraphElement>("#table-summary");
const tableHead = element<HTMLTableSectionElement>("#table-head");
const tableBody = element<HTMLTableSectionElement>("#table-body");
const previous = element<HTMLButtonElement>("#previous");
const next = element<HTMLButtonElement>("#next");
const pageLabel = element<HTMLSpanElement>("#page-label");
const pageSize = 100;
let feed: GtfsFeed | undefined;
let page = 0;

type CellRenderer = (column: string, value: string | null) => HTMLTableCellElement;

function renderGenericCell(_column: string, value: string | null): HTMLTableCellElement {
  const cell = document.createElement("td");
  cell.textContent = value;
  return cell;
}

function renderRoutesCell(column: string, value: string | null): HTMLTableCellElement {
  if (column === "route_url" && value) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return renderGenericCell(column, value);
    }

    if (url.protocol === "http:" || url.protocol === "https:") {
      const link = document.createElement("a");
      link.href = url.href;
      link.textContent = value;
      const cell = document.createElement("td");
      cell.append(link);
      return cell;
    }
  }

  if (column === "route_color" && value && /^[\da-f]{6}$/i.test(value)) {
    const swatch = document.createElement("span");
    swatch.className = "route-color-swatch";
    swatch.style.backgroundColor = `#${value}`;
    swatch.setAttribute("aria-hidden", "true");
    const cell = document.createElement("td");
    cell.append(swatch, document.createTextNode(value));
    return cell;
  }

  return renderGenericCell(column, value);
}

const tableCellRenderers: Record<string, CellRenderer> = {
  "routes.txt": renderRoutesCell,
};

function renderTable(table: GtfsTable): void {
  const header = document.createElement("tr");
  for (const column of table.columns) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = column;
    header.append(cell);
  }
  if (table.hasExtraValues) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = "Extra values";
    header.append(cell);
  }
  tableHead.replaceChildren(header);

  const start = page * pageSize;
  const rows = document.createDocumentFragment();
  const renderCell = tableCellRenderers[table.name] ?? renderGenericCell;
  for (const values of table.rows.slice(start, start + pageSize)) {
    const row = document.createElement("tr");
    const fields: Record<string, string | null> = values.fields;
    for (const column of table.columns) {
      const value = Object.prototype.hasOwnProperty.call(fields, column)
        ? fields[column]
        : values.unrecognizedColumns[column];
      row.append(renderCell(column, value));
    }
    if (table.hasExtraValues) {
      const cell = document.createElement("td");
      cell.textContent = values.extraValues.length > 0 ? JSON.stringify(values.extraValues) : "";
      row.append(cell);
    }
    rows.append(row);
  }
  tableBody.replaceChildren(rows);
  tableSummary.textContent = table.rows.length === 0
    ? "This table has no data rows."
    : `Showing ${start + 1}–${Math.min(start + pageSize, table.rows.length)} of ${table.rows.length} rows.`;
  const pageCount = Math.max(1, Math.ceil(table.rows.length / pageSize));
  pageLabel.textContent = `Page ${page + 1} of ${pageCount}`;
  previous.disabled = page === 0;
  next.disabled = page + 1 >= pageCount;
}

function renderSelectedTable(): void {
  const table = feed?.tables[tableSelect.selectedIndex];
  if (table) renderTable(table);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = input.files?.[0];
  if (!file) return;

  input.disabled = true;
  submit.disabled = true;
  status.textContent = "Loading feed…";
  viewer.hidden = true;
  feed = undefined;

  try {
    feed = loadGtfs(new Uint8Array(await file.arrayBuffer()));
    tableSelect.replaceChildren(...feed.tables.map((table) => {
      const option = document.createElement("option");
      option.textContent = table.name;
      return option;
    }));
    feedSummary.textContent = `${file.name} · ${feed.tables.length} ${feed.tables.length === 1 ? "table" : "tables"}`;
    page = 0;
    renderSelectedTable();
    viewer.hidden = false;
    status.textContent = "Feed loaded.";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Could not load the feed.";
  } finally {
    input.disabled = false;
    submit.disabled = false;
  }
});

tableSelect.addEventListener("change", () => {
  page = 0;
  renderSelectedTable();
});
previous.addEventListener("click", () => {
  if (page > 0) {
    page--;
    renderSelectedTable();
  }
});
next.addEventListener("click", () => {
  const table = feed?.tables[tableSelect.selectedIndex];
  if (table && (page + 1) * pageSize < table.rows.length) {
    page++;
    renderSelectedTable();
  }
});
