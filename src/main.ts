import {
  decodeRouteType, getMatchingRows, getReferencedRoute, getRouteVariants, getTableColumns, getVariantTableRows, indexRoutes,
  type GtfsFeed, type GtfsRow, type GtfsTable, type RouteVariant,
} from "./gtfs";
import workerSource from "../dist/gtfs-worker.txt";
import type { WorkerResponse } from "./gtfs-worker";
import { indexShapes, indexStops, mapStop, variantLabel, variantMapData, type MapStop } from "./map-data";
import { MapView, type MapLine } from "./map-view";
import "maplibre-gl/dist/maplibre-gl.css";

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
      <button id="back-to-route" type="button" hidden>Back to route details</button>
      <label for="table-select">Table</label>
      <select id="table-select"></select>
      <p id="table-filter" hidden></p>
      <button id="clear-filter" type="button" hidden>Show all rows</button>
      <button id="stops-map" type="button" hidden>View stops on map</button>
      <div class="table-controls">
        <div>
          <label for="table-search">Search rows</label>
          <input id="table-search" type="search" placeholder="Search all fields" />
        </div>
        <div>
          <label for="page-size">Rows per page</label>
          <select id="page-size">
            <option>25</option>
            <option>50</option>
            <option selected>100</option>
            <option>250</option>
            <option>500</option>
          </select>
        </div>
      </div>
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
    <section id="route-detail" class="panel viewer" aria-labelledby="route-heading" hidden>
      <button id="back-to-tables" type="button">Back to tables</button>
      <h2 id="route-heading" tabindex="-1">Route details</h2>
      <div id="route-properties"></div>
      <p id="route-summary"></p>
      <button id="route-trips" type="button">View route trips</button>
      <button id="route-map" type="button">🗺️ View route on map</button>
      <h3>Shapes and route variants</h3>
      <div id="route-variants"></div>
      <section id="all-route-stops">
        <h3>All route stops</h3>
        <ol id="route-stop-list"></ol>
      </section>
    </section>
    <section id="map-panel" class="panel viewer" aria-labelledby="map-heading" hidden>
      <button id="back-from-map" type="button">Back</button>
      <h2 id="map-heading" tabindex="-1">Map</h2>
      <p id="map-error" role="alert"></p>
      <p id="map-summary" role="status"></p>
      <button id="map-clear-filter" type="button" hidden>Clear stop filter</button>
      <div id="map-variant-controls" hidden>
        <label for="map-variant">Route variant</label>
        <select id="map-variant"></select>
      </div>
      <div class="map-layout">
        <div id="map-canvas" aria-label="Map of transit stops and routes"></div>
        <aside id="map-sidebar" aria-label="Route stops" hidden></aside>
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
const tableSearch = element<HTMLInputElement>("#table-search");
const pageSizeSelect = element<HTMLSelectElement>("#page-size");
const tableSummary = element<HTMLParagraphElement>("#table-summary");
const tableHead = element<HTMLTableSectionElement>("#table-head");
const tableBody = element<HTMLTableSectionElement>("#table-body");
const previous = element<HTMLButtonElement>("#previous");
const next = element<HTMLButtonElement>("#next");
const pageLabel = element<HTMLSpanElement>("#page-label");
const routeDetail = element<HTMLElement>("#route-detail");
const routeHeading = element<HTMLHeadingElement>("#route-heading");
const routeProperties = element<HTMLElement>("#route-properties");
const routeVariants = element<HTMLElement>("#route-variants");
const routeSummary = element<HTMLParagraphElement>("#route-summary");
const routeTrips = element<HTMLButtonElement>("#route-trips");
const routeStopList = element<HTMLOListElement>("#route-stop-list");
const backToTables = element<HTMLButtonElement>("#back-to-tables");
const backToRoute = element<HTMLButtonElement>("#back-to-route");
const tableFilter = element<HTMLParagraphElement>("#table-filter");
const clearFilter = element<HTMLButtonElement>("#clear-filter");
const stopsMapButton = element<HTMLButtonElement>("#stops-map");
const routeMapButton = element<HTMLButtonElement>("#route-map");
const mapPanel = element<HTMLElement>("#map-panel");
const mapHeading = element<HTMLHeadingElement>("#map-heading");
const mapCanvas = element<HTMLElement>("#map-canvas");
const mapError = element<HTMLParagraphElement>("#map-error");
const mapSummary = element<HTMLParagraphElement>("#map-summary");
const mapSidebar = element<HTMLElement>("#map-sidebar");
const mapVariantControls = element<HTMLElement>("#map-variant-controls");
const mapVariant = element<HTMLSelectElement>("#map-variant");
const mapClearFilter = element<HTMLButtonElement>("#map-clear-filter");
const backFromMap = element<HTMLButtonElement>("#back-from-map");
let pageSize = 100;
let feed: GtfsFeed | undefined;
let page = 0;
let routesById = new Map<string, GtfsRow<"routes.txt">>();
let filteredTable: GtfsTable | undefined;
let currentRoute: GtfsRow<"routes.txt"> | undefined;
let mapView: MapView | undefined;
let mapReturn: "table" | "route" = "table";
let mapRouteVariants: RouteVariant[] = [];
let mapStopsIndex = new Map<string, MapStop>();
let mapShapesIndex = new Map<string, GtfsRow<"shapes.txt">[]>();
const stopListItems = new Map<string, HTMLElement[]>();
let highlightedStopItems: HTMLElement[] = [];

type CellRenderer = (column: string, value: string | null) => HTMLTableCellElement;

function renderGenericCell(_column: string, value: string | null): HTMLTableCellElement {
  const cell = document.createElement("td");
  cell.textContent = value;
  return cell;
}

function renderLink(value: string | null, label: string): Node {
  if (!value) return document.createTextNode(label);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return document.createTextNode(label);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return document.createTextNode(label);
  const link = document.createElement("a");
  link.href = url.href;
  link.textContent = label;
  return link;
}

function renderUrlCell(_column: string, value: string | null): HTMLTableCellElement {
  const cell = document.createElement("td");
  cell.append(renderLink(value, value ?? ""));
  return cell;
}

function routeTypeLabel(value: string): string {
  const name = decodeRouteType(value);
  return name === `Unknown route type (${value})` ? name : `${name} (${value})`;
}

function renderRoutesCell(column: string, value: string | null): HTMLTableCellElement {
  if (column === "route_url") return renderUrlCell(column, value);
  if (column === "route_type" && value) {
    return renderGenericCell(column, routeTypeLabel(value));
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
  "agency.txt": (column, value) => column === "agency_url" || column === "agency_fare_url"
    ? renderUrlCell(column, value) : renderGenericCell(column, value),
  "stops.txt": (column, value) => column === "stop_url"
    ? renderUrlCell(column, value) : renderGenericCell(column, value),
};

function showRoute(route: GtfsRow<"routes.txt">): void {
  if (!feed) return;
  currentRoute = route;
  const title = route.fields.route_short_name || route.fields.route_long_name || route.fields.route_id;
  routeHeading.textContent = title ? `Route details: ${title}` : "Route details";
  const list = document.createElement("dl");
  list.className = "route-properties";
  const properties = [...Object.entries(route.fields), ...Object.entries(route.unrecognizedColumns)];
  for (const [name, value] of properties) {
    const term = document.createElement("dt");
    term.textContent = name;
    const description = document.createElement("dd");
    if (value === null) {
      description.textContent = "Not provided";
    } else if (value === "") {
      description.textContent = "(empty)";
    } else {
      description.append(...renderRoutesCell(name, value).childNodes);
    }
    if (value === null || value === "") {
      description.className = "not-provided";
    }
    list.append(term, description);
  }
  if (route.extraValues.length > 0) {
    const term = document.createElement("dt");
    term.textContent = "Extra values";
    const description = document.createElement("dd");
    description.textContent = JSON.stringify(route.extraValues);
    list.append(term, description);
  }
  routeProperties.replaceChildren(list);

  const { variants, tripsCount, tripsWithoutVariant } = route.fields.route_id
    ? getRouteVariants(feed, route.fields.route_id)
    : { variants: [], tripsCount: 0, tripsWithoutVariant: 0 };
  routeSummary.textContent =
    `${variants.length} ${variants.length === 1 ? "variant" : "variants"} · `
    + `${tripsCount} ${tripsCount === 1 ? "trip references" : "trips reference"} this route.`;
  routeTrips.hidden = !route.fields.route_id || !feed.tables.some((table) => table.kind === "trips.txt");
  const stopsTable = feed.tables.find((table) => table.kind === "stops.txt");
  const stopNames = new Map(stopsTable?.rows.map(({ fields }) => [fields.stop_id, fields.stop_name]));
  const stopUrls = new Map(stopsTable?.rows.map(({ fields }) => [fields.stop_id, fields.stop_url]));
  routeVariants.replaceChildren();
  routeStopList.replaceChildren();
  if (variants.length === 0) {
    const message = document.createElement("p");
    message.textContent = "No route variants could be formed from this route's trips.";
    routeVariants.append(message);
  }
  const uniqueStops = new Set<string | null>();
  for (const [index, variant] of variants.entries()) {
    const section = document.createElement("section");
    const heading = document.createElement("h4");
    const firstStop = variant.stops[0];
    const lastStop = variant.stops.length > 1 ? variant.stops[variant.stops.length - 1] : null;
    const endpoints = [firstStop, lastStop]
      .map((id) => id == null ? "" : stopNames.get(id)?.trim() ?? "")
      .filter(Boolean)
      .join(" → ");
    const headingParts = [variant.tripHeadsign?.trim(), variant.tripShortName?.trim(), endpoints].filter(Boolean);
    heading.textContent = headingParts.join(" · ") || `Variant ${index + 1}`;
    section.append(heading);
    const properties = document.createElement("dl");
    properties.className = "route-properties";
    for (const [name, value, missing] of [
      ["Shape ID", variant.shapeId, !variant.shapeId],
      ["Trip headsign", variant.tripHeadsign, variant.tripHeadsign === null || variant.tripHeadsign === ""],
      ["Trip short name", variant.tripShortName, variant.tripShortName === null || variant.tripShortName === ""],
      ["Direction ID", variant.directionIds.map((id) => id === null ? "Not provided" : id === "" ? "(empty)" : id).join(", "),
        variant.directionIds.every((id) => id === null || id === "")],
    ] as const) {
      const term = document.createElement("dt");
      term.textContent = name;
      const description = document.createElement("dd");
      description.textContent = value === null ? "Not provided" : value === "" ? "(empty)" : value;
      if (missing) {
        description.className = "not-provided";
      }
      properties.append(term, description);
    }
    section.append(properties);
    const tableLinks: (readonly ["shapes.txt" | "trips.txt", string])[] = [
      ...(variant.shapeId ? [["shapes.txt", "View shape rows"] as const] : []),
      ["trips.txt", "View variant trips"],
    ];
    for (const [kind, label] of tableLinks) {
      if (!feed.tables.some((table) => table.kind === kind)) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "route-link variant-link";
      button.textContent = label;
      button.addEventListener("click", () => showVariantTable(variant, kind));
      section.append(button);
    }
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = `Stops (${variant.stops.length})`;
    details.append(summary);
    if (variant.stops.length === 0) {
      const message = document.createElement("p");
      message.textContent = "No stop times found for this variant.";
      details.append(message);
    } else {
      const stops = document.createElement("ol");
      for (const stopId of variant.stops) {
        const item = document.createElement("li");
        item.append(renderLink(stopId ? stopUrls.get(stopId) ?? null : null, formatStop(stopId, stopNames)));
        stops.append(item);
        uniqueStops.add(stopId);
      }
      details.append(stops);
    }
    section.append(details);
    routeVariants.append(section);
  }
  if (tripsWithoutVariant > 0) {
    const message = document.createElement("p");
    message.textContent = `${tripsWithoutVariant} ${tripsWithoutVariant === 1 ? "trip lacks" : "trips lack"} all variant grouping data (shape, headsign, short name, and stop sequence).`;
    routeVariants.append(message);
  }
  for (const stopId of uniqueStops) {
    const item = document.createElement("li");
    item.append(renderLink(stopId ? stopUrls.get(stopId) ?? null : null, formatStop(stopId, stopNames)));
    routeStopList.append(item);
  }
  if (uniqueStops.size === 0) {
    const item = document.createElement("li");
    item.textContent = "No stops available.";
    routeStopList.append(item);
  }
  viewer.hidden = true;
  routeDetail.hidden = false;
  routeHeading.focus();
}

function formatStop(stopId: string | null, stopNames: Map<string | null, string | null>): string {
  const stopName = stopNames.get(stopId);
  return stopName && stopId ? `${stopName} (${stopId})` : stopId || "Stop ID not provided";
}

function showVariantTable(variant: RouteVariant, kind: "shapes.txt" | "trips.txt"): void {
  if (!feed) return;
  const table = getVariantTableRows(feed, variant, kind);
  if (!table) return;
  showFilteredTable(table, kind === "shapes.txt"
    ? `Showing rows for shape ${variant.shapeId}.`
    : "Showing trips for this variant.");
}

function showFilteredTable(table: GtfsTable, message: string): void {
  if (!feed) return;
  filteredTable = table;
  tableSelect.selectedIndex = feed.tables.findIndex((candidate) => candidate.kind === table.kind);
  page = 0;
  tableSearch.value = "";
  tableFilter.textContent = message;
  tableFilter.hidden = false;
  clearFilter.hidden = false;
  backToRoute.hidden = false;
  routeDetail.hidden = true;
  viewer.hidden = false;
  renderSelectedTable();
  tableSelect.focus();
}

function resetTableFilter(): void {
  filteredTable = undefined;
  tableFilter.hidden = true;
  clearFilter.hidden = true;
  backToRoute.hidden = true;
}

function renderTable(table: GtfsTable): void {
  const { recognized, additional } = getTableColumns(table);
  const header = document.createElement("tr");
  for (const column of recognized) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = column;
    header.append(cell);
  }
  if (additional.length > 0) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = "Additional fields";
    header.append(cell);
  }
  if (table.hasExtraValues) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = "Extra values";
    header.append(cell);
  }
  tableHead.replaceChildren(header);

  const matchingRows = getMatchingRows(table, tableSearch.value);
  const start = page * pageSize;
  const rows = document.createDocumentFragment();
  const renderCell = tableCellRenderers[table.kind] ?? renderGenericCell;
  for (const values of matchingRows.slice(start, start + pageSize)) {
    const row = document.createElement("tr");
    const fields: Record<string, string | null> = values.fields;
    if (table.kind === "routes.txt") {
      const route = values as GtfsRow<"routes.txt">;
      row.className = "route-row";
      row.tabIndex = 0;
      row.setAttribute("aria-label", `Open route ${route.fields.route_id || "details"}`);
      row.addEventListener("click", (event) => {
        if (!(event.target instanceof Element) || !event.target.closest("a, button")) showRoute(route);
      });
      row.addEventListener("keydown", (event) => {
        if (event.target === row && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          showRoute(route);
        }
      });
    }
    for (const column of recognized) {
      const value = fields[column];
      const referencedRoute = getReferencedRoute(routesById, table.kind, column, value);
      if (referencedRoute) {
        const cell = document.createElement("td");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "route-link";
        button.textContent = value;
        button.addEventListener("click", () => showRoute(referencedRoute));
        cell.append(button);
        row.append(cell);
      } else {
        row.append(renderCell(column, value));
      }
    }
    if (additional.length > 0) {
      const cell = document.createElement("td");
      cell.textContent = JSON.stringify(values.unrecognizedColumns);
      row.append(cell);
    }
    if (table.hasExtraValues) {
      const cell = document.createElement("td");
      cell.textContent = values.extraValues.length > 0 ? JSON.stringify(values.extraValues) : "";
      row.append(cell);
    }
    if (table.kind === "routes.txt") {
      const route = values as GtfsRow<"routes.txt">;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "route-map-icon";
      button.textContent = "🗺️";
      button.title = "View route on map";
      button.setAttribute("aria-label", `View route ${route.fields.route_short_name || route.fields.route_id || "details"} on map`);
      button.addEventListener("click", () => showRouteMap(route, "table"));
      row.firstElementChild?.prepend(button, " ");
    }
    rows.append(row);
  }
  tableBody.replaceChildren(rows);
  tableSummary.textContent = table.rows.length === 0
    ? "This table has no data rows."
    : matchingRows.length === 0
      ? "No rows match the search."
      : `Showing ${start + 1}–${Math.min(start + pageSize, matchingRows.length)} of ${matchingRows.length} rows.`;
  const pageCount = Math.max(1, Math.ceil(matchingRows.length / pageSize));
  pageLabel.textContent = `Page ${page + 1} of ${pageCount}`;
  previous.disabled = page === 0;
  next.disabled = page + 1 >= pageCount;
}

function renderSelectedTable(): void {
  const table = filteredTable ?? feed?.tables[tableSelect.selectedIndex];
  stopsMapButton.hidden = table?.kind !== "stops.txt";
  if (table) renderTable(table);
}

function openMap(returnTo: "table" | "route", title: string): void {
  mapView?.remove();
  mapView = undefined;
  mapReturn = returnTo;
  viewer.hidden = true;
  routeDetail.hidden = true;
  mapPanel.hidden = false;
  mapHeading.textContent = title;
  mapError.textContent = "";
  mapSummary.textContent = "";
  mapSidebar.replaceChildren();
  stopListItems.clear();
  highlightedStopItems = [];
  try {
    mapView = new MapView(mapCanvas, (message) => { mapError.textContent = message; }, highlightStopList);
  } catch (error) {
    mapError.textContent = `Could not initialize the map: ${error instanceof Error ? error.message : "unknown error"}`;
  }
  mapHeading.focus();
}

function highlightStopList(stopId: string | null): void {
  for (const item of highlightedStopItems) item.classList.remove("map-stop-highlight");
  highlightedStopItems = stopId ? stopListItems.get(stopId) ?? [] : [];
  for (const item of highlightedStopItems) item.classList.add("map-stop-highlight");
}

function showStopsMap(): void {
  if (!feed) return;
  const table = filteredTable ?? feed.tables[tableSelect.selectedIndex];
  if (table?.kind !== "stops.txt") return;
  mapSidebar.hidden = true;
  mapVariantControls.hidden = true;
  openMap("table", "Stops map");
  renderStopsMap();
}

function renderStopsMap(): void {
  if (!feed) return;
  const table = filteredTable ?? feed.tables[tableSelect.selectedIndex];
  if (table?.kind !== "stops.txt") return;
  const matching = new Set(getMatchingRows(table, tableSearch.value));
  const stops = table.rows.filter((row) => matching.has(row)).map(mapStop);
  const mappable = stops.filter((stop) => stop.coordinate).length;
  mapSummary.textContent = `${mappable} of ${stops.length} matching stops have valid coordinates.`;
  mapClearFilter.hidden = !tableSearch.value.trim();
  mapView?.update(stops, []);
}

function showRouteMap(route: GtfsRow<"routes.txt">, returnTo: "table" | "route"): void {
  if (!feed) return;
  const title = route.fields.route_short_name || route.fields.route_long_name || route.fields.route_id;
  mapRouteVariants = route.fields.route_id ? getRouteVariants(feed, route.fields.route_id).variants : [];
  mapStopsIndex = indexStops(feed);
  mapShapesIndex = indexShapes(feed);
  mapSidebar.hidden = false;
  mapVariantControls.hidden = mapRouteVariants.length === 0;
  mapClearFilter.hidden = true;
  mapVariant.replaceChildren();
  for (const [index, variant] of mapRouteVariants.entries()) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = variantLabel(variant, index, mapStopsIndex);
    mapVariant.append(option);
  }
  if (mapRouteVariants.length) {
    const option = document.createElement("option");
    option.value = "all";
    option.textContent = "All variants";
    mapVariant.append(option);
  }
  openMap(returnTo, title ? `Route map: ${title}` : "Route map");
  renderRouteMap();
}

function renderRouteMap(): void {
  if (!feed) return;
  mapSidebar.replaceChildren();
  stopListItems.clear();
  highlightedStopItems = [];
  if (!mapRouteVariants.length) {
    mapSummary.textContent = "No route variants are available.";
    mapView?.update([], []);
    return;
  }
  const selected = mapVariant.value === "all" ? mapRouteVariants.map((_, index) => index) : [Number(mapVariant.value)];
  const allStops: MapStop[] = [];
  const lines: MapLine[] = [];
  const warnings: string[] = [];
  for (const index of selected) {
    const variant = mapRouteVariants[index];
    const label = variantLabel(variant, index, mapStopsIndex);
    const data = variantMapData(mapShapesIndex, variant, mapStopsIndex);
    allStops.push(...data.stops);
    lines.push({ coordinates: data.line, approximate: data.approximate, variantIndex: index, label });
    if (data.approximate) {
      warnings.push(`${label}: shape unavailable; ${data.line.length >= 2
        ? "dashed line connects known stops approximately" : "not enough located stops to draw a line"}.`);
    } else if (data.invalidShapePoints) {
      warnings.push(`${label}: ${data.invalidShapePoints} invalid shape points omitted.`);
    }
    const section = document.createElement("section");
    const heading = document.createElement("h3");
    const variantButton = document.createElement("button");
    variantButton.type = "button";
    variantButton.className = "map-variant-label";
    variantButton.textContent = label;
    variantButton.addEventListener("mouseenter", () => mapView?.highlightVariant(index));
    variantButton.addEventListener("mouseleave", () => mapView?.highlightVariant(null));
    variantButton.addEventListener("focus", () => mapView?.highlightVariant(index));
    variantButton.addEventListener("blur", () => mapView?.highlightVariant(null));
    heading.append(variantButton);
    section.append(heading);
    const list = document.createElement("ol");
    for (const stop of data.stops) {
      const item = document.createElement("li");
      if (stop.id) {
        const items = stopListItems.get(stop.id) ?? [];
        items.push(item);
        stopListItems.set(stop.id, items);
      }
      const label = stop.name && stop.id ? `${stop.name} (${stop.id})` : stop.id || "Stop ID not provided";
      if (stop.coordinate) {
        const position = stop.coordinate;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "route-link";
        button.textContent = label;
        button.addEventListener("mouseenter", () => mapView?.highlight(position));
        button.addEventListener("mouseleave", () => mapView?.highlight(null));
        button.addEventListener("focus", () => mapView?.highlight(position));
        button.addEventListener("blur", () => mapView?.highlight(null));
        button.addEventListener("click", () => mapView?.zoomTo(position));
        item.append(button);
      } else {
        item.textContent = `${label} (location unavailable)`;
      }
      list.append(item);
    }
    if (!data.stops.length) {
      const item = document.createElement("li");
      item.textContent = "No stops available.";
      list.append(item);
    }
    section.append(list);
    mapSidebar.append(section);
  }
  const missing = allStops.filter((stop) => !stop.coordinate).length;
  if (missing) warnings.push(`${missing} stop ${missing === 1 ? "location is" : "locations are"} unavailable.`);
  mapSummary.textContent = warnings.join(" ") || `${selected.length} ${selected.length === 1 ? "variant" : "variants"} shown.`;
  mapView?.update(allStops, lines);
}

function loadFeed(file: File): Promise<GtfsFeed> {
  const url = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
  let worker: Worker;
  try {
    worker = new Worker(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      worker.terminate();
      if ("error" in event.data) reject(new Error(event.data.error));
      else resolve(event.data.feed);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "Could not load the feed."));
    };
    worker.onmessageerror = () => {
      worker.terminate();
      reject(new Error("Could not read the parsed feed."));
    };
    try {
      worker.postMessage(file);
    } catch (error) {
      worker.terminate();
      reject(error);
    }
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = input.files?.[0];
  if (!file) return;

  input.disabled = true;
  submit.disabled = true;
  status.textContent = "Loading feed…";
  viewer.hidden = true;
  routeDetail.hidden = true;
  mapPanel.hidden = true;
  mapView?.remove();
  mapView = undefined;
  resetTableFilter();
  tableSearch.value = "";
  currentRoute = undefined;
  feed = undefined;
  routesById.clear();

  try {
    feed = await loadFeed(file);
    routesById = indexRoutes(feed);
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

backToTables.addEventListener("click", () => {
  routeDetail.hidden = true;
  viewer.hidden = false;
  tableSelect.focus();
});

stopsMapButton.addEventListener("click", showStopsMap);
routeMapButton.addEventListener("click", () => {
  if (currentRoute) showRouteMap(currentRoute, "route");
});
backFromMap.addEventListener("click", () => {
  mapView?.remove();
  mapView = undefined;
  mapPanel.hidden = true;
  if (mapReturn === "route") {
    routeDetail.hidden = false;
    routeMapButton.focus();
  } else {
    viewer.hidden = false;
    tableSelect.focus();
  }
});
mapVariant.addEventListener("change", renderRouteMap);
mapClearFilter.addEventListener("click", () => {
  tableSearch.value = "";
  page = 0;
  renderSelectedTable();
  renderStopsMap();
});

backToRoute.addEventListener("click", () => {
  if (currentRoute) showRoute(currentRoute);
});

routeTrips.addEventListener("click", () => {
  if (!feed || !currentRoute?.fields.route_id) return;
  const table = feed.tables.find((candidate) => candidate.kind === "trips.txt");
  if (!table) return;
  const routeId = currentRoute.fields.route_id;
  showFilteredTable(
    { ...table, rows: table.rows.filter((row) => row.fields.route_id === routeId) },
    `Showing trips for route ${routeId}.`,
  );
});

clearFilter.addEventListener("click", () => {
  resetTableFilter();
  page = 0;
  renderSelectedTable();
});

tableSelect.addEventListener("change", () => {
  resetTableFilter();
  tableSearch.value = "";
  page = 0;
  renderSelectedTable();
});
tableSearch.addEventListener("input", () => {
  page = 0;
  renderSelectedTable();
});
pageSizeSelect.addEventListener("change", () => {
  pageSize = Number(pageSizeSelect.value);
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
  if (!next.disabled) {
    page++;
    renderSelectedTable();
  }
});
