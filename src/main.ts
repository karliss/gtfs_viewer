import {
  decodeRouteType, getMatchingRows, getReferencedRoute, getRouteVariants, getTableColumns, getVariantTableRows, indexRoutes, summarizeTripField,
  type GtfsFeed, type GtfsRow, type GtfsTable, type RouteVariant,
} from "./gtfs";
import workerSource from "../dist/gtfs-worker.txt";
import type { WorkerResponse } from "./gtfs-worker";
import { indexShapes, indexStopRoutes, indexStops, mapStop, variantLabel, variantMapData, type MapStop } from "./map-data";
import {
  defaultMapBaseLayer,
  MAP_BASE_LAYERS,
  MapView,
  type MapBaseLayerId,
  type MapLine,
} from "./map-view";
import { DEFAULT_VIEW_STATE, ViewHistory, type ViewState } from "./view-history";
import "maplibre-gl/dist/maplibre-gl.css";

const app = document.querySelector<HTMLElement>("#app");

if (!app) {
  throw new Error("App root element not found");
}

app.innerHTML = `
  <main class="page">
    <header class="page__header">
      <h1>GTFS Viewer</h1>
    </header>
    <section id="load-panel" class="panel" aria-labelledby="load-heading">
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
    <div class="history-controls" aria-label="View history" hidden>
      <label class="history-select-label">History</label>
      <button id="history-back" type="button" title="Back" aria-label="Back">←</button>
      <button id="history-forward" type="button" title="Forward" aria-label="Forward">→</button>
      <div class="history-dropdown">
        <button id="history-select" type="button" title="View history" aria-label="View history" aria-haspopup="listbox" aria-expanded="false">▼</button>
        <div id="history-menu" class="history-menu" role="listbox" hidden></div>
      </div>
      <button id="history-routes" type="button">Routes</button>
      <button id="history-stops" type="button">Stops</button>
    </div>
    <section id="viewer" class="panel viewer" aria-labelledby="viewer-heading" hidden>
      <h2 id="viewer-heading">Feed tables</h2>
      <p id="feed-summary"></p>
      <button id="back-to-route" type="button" hidden>Back to route details</button>
      <label for="table-select">Table</label>
      <select id="table-select"></select>
      <p id="table-filter" hidden></p>
      <button id="clear-filter" type="button" hidden>Show all rows</button>
      <button id="stops-map" type="button" hidden title="View stops on map" aria-label="View stops on map">🗺️</button>
      <button id="routes-map" type="button" hidden title="View routes on map" aria-label="View routes on map">🗺️</button>
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
      <h2 id="route-heading" tabindex="-1">Route details</h2>
      <div id="route-properties"></div>
      <p id="route-summary"></p>
      <button id="route-trips" type="button">View route trips</button>
      <button id="route-map" type="button">🗺️ View route on map</button>
      <h3>Shapes and route variants</h3>
      <div id="route-variants"></div>
      <section id="all-route-stops">
        <ol id="route-stop-list"></ol>
      </section>
    </section>
    <section id="stop-detail" class="panel viewer" aria-labelledby="stop-heading" hidden>
      <h2 id="stop-heading" tabindex="-1">Stop details</h2>
      <div id="stop-properties"></div>
    </section>
    <section id="map-panel" class="panel viewer" aria-labelledby="map-heading" hidden>
      <h2 id="map-heading" tabindex="-1">Map</h2>
      <p id="map-error" role="alert"></p>
      <p id="map-summary" role="status"></p>
      <button id="map-clear-filter" type="button" hidden>Clear stop filter</button>
      <div id="map-variant-controls" hidden>
        <div>
          <label for="map-route">Route</label>
          <select id="map-route"></select>
          <button id="map-route-reset" type="button" title="Show all routes" aria-label="Show all routes">X</button>
        </div>
        <div>
          <label for="map-variant">Route variant</label>
          <select id="map-variant"></select>
          <button id="map-variant-reset" type="button" title="Show all variants" aria-label="Show all variants">X</button>
        </div>
        <details class="map-settings">
          <summary title="Map settings" aria-label="Map settings">⚙</summary>
          <div class="map-settings-menu">
            <label class="map-option" for="map-base-layer">
              <span>Background map</span>
              <select id="map-base-layer"></select>
            </label>
            <label class="map-option" for="map-route-colors">
              <input id="map-route-colors" type="checkbox" checked />
              Use route colors
            </label>
            <label class="map-option" for="map-random-colors">
              <input id="map-random-colors" type="checkbox" />
              Use random colors
            </label>
            <label class="map-option" for="map-all-stops">
              <input id="map-all-stops" type="checkbox" />
              Show all stops
            </label>
            <label class="map-option" for="map-reduced-stops">
              <input id="map-reduced-stops" type="checkbox" />
              Reduce stop size
            </label>
            <label class="map-option" for="map-stop-order">
              <input id="map-stop-order" type="checkbox" />
              Display stop order numbers
            </label>
          </div>
        </details>
      </div>
      <div class="map-layout">
        <div id="map-canvas" aria-label="Map of transit stops and routes"></div>
        <aside id="map-sidebar" aria-label="Route stops" hidden></aside>
      </div>
    </section>
    <dialog id="agency-dialog" aria-labelledby="agency-dialog-heading">
      <h2 id="agency-dialog-heading">Agency details</h2>
      <div id="agency-dialog-content"></div>
      <button id="agency-dialog-close" type="button">Close</button>
    </dialog>
  </main>
`;

function element<T extends HTMLElement>(selector: string): T {
  const result = app!.querySelector<T>(selector);
  if (!result) throw new Error(`Missing element: ${selector}`);
  return result;
}

const form = element<HTMLFormElement>("#load-form");
const loadPanel = element<HTMLElement>("#load-panel");
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
const historyBack = element<HTMLButtonElement>("#history-back");
const historyForward = element<HTMLButtonElement>("#history-forward");
const historyRoutes = element<HTMLButtonElement>("#history-routes");
const historyStops = element<HTMLButtonElement>("#history-stops");
const historyControls = document.querySelector<HTMLElement>(".history-controls");
const historySelect = element<HTMLButtonElement>("#history-select");
const historyMenu = element<HTMLElement>("#history-menu");
const routeDetail = element<HTMLElement>("#route-detail");
const routeHeading = element<HTMLHeadingElement>("#route-heading");
const routeProperties = element<HTMLElement>("#route-properties");
const routeVariants = element<HTMLElement>("#route-variants");
const routeSummary = element<HTMLParagraphElement>("#route-summary");
const routeTrips = element<HTMLButtonElement>("#route-trips");
const routeStopList = element<HTMLOListElement>("#route-stop-list");
const backToRoute = element<HTMLButtonElement>("#back-to-route");
const tableFilter = element<HTMLParagraphElement>("#table-filter");
const clearFilter = element<HTMLButtonElement>("#clear-filter");
const stopsMapButton = element<HTMLButtonElement>("#stops-map");
const routesMapButton = element<HTMLButtonElement>("#routes-map");
const routeMapButton = element<HTMLButtonElement>("#route-map");
const stopDetail = element<HTMLElement>("#stop-detail");
const stopHeading = element<HTMLHeadingElement>("#stop-heading");
const stopProperties = element<HTMLElement>("#stop-properties");
const mapPanel = element<HTMLElement>("#map-panel");
const mapHeading = element<HTMLHeadingElement>("#map-heading");
const mapCanvas = element<HTMLElement>("#map-canvas");
const mapError = element<HTMLParagraphElement>("#map-error");
const mapSummary = element<HTMLParagraphElement>("#map-summary");
const mapSidebar = element<HTMLElement>("#map-sidebar");
const mapVariantControls = element<HTMLElement>("#map-variant-controls");
const mapRoute = element<HTMLSelectElement>("#map-route");
const mapRouteReset = element<HTMLButtonElement>("#map-route-reset");
const mapVariant = element<HTMLSelectElement>("#map-variant");
const mapVariantReset = element<HTMLButtonElement>("#map-variant-reset");
const mapBaseLayer = element<HTMLSelectElement>("#map-base-layer");
const mapRouteColors = element<HTMLInputElement>("#map-route-colors");
const mapRandomColors = element<HTMLInputElement>("#map-random-colors");
const mapAllStops = element<HTMLInputElement>("#map-all-stops");
const mapReducedStops = element<HTMLInputElement>("#map-reduced-stops");
const mapStopOrder = element<HTMLInputElement>("#map-stop-order");
const mapClearFilter = element<HTMLButtonElement>("#map-clear-filter");
const agencyDialog = element<HTMLDialogElement>("#agency-dialog");
const agencyDialogContent = element<HTMLElement>("#agency-dialog-content");
for (const layer of MAP_BASE_LAYERS) {
  const option = document.createElement("option");
  option.value = layer.id;
  option.textContent = layer.label;
  mapBaseLayer.append(option);
}
mapBaseLayer.value = defaultMapBaseLayer();
let pageSize = 100;
let feed: GtfsFeed | undefined;
let page = 0;
let routesById = new Map<string, GtfsRow<"routes.txt">>();
let agenciesById = new Map<string, GtfsRow<"agency.txt">>();
let filteredTable: GtfsTable | undefined;
let currentRoute: GtfsRow<"routes.txt"> | undefined;
let stopsById = new Map<string, GtfsRow<"stops.txt">>();
let routesByStop = new Map<string, string[]>();
let mapView: MapView | undefined;
let mapRoutes: GtfsRow<"routes.txt">[] = [];
let mapRouteVariants: RouteVariant[] = [];
let mapVariantLabels: string[] = [];
let mapVariantRouteIds: string[] = [];
let mapVariantColors: (string | null)[] = [];
let mapVariantRandomColors: string[] = [];
let pinnedVariant: number | null = null;
let mapStopsIndex = new Map<string, MapStop>();
let mapShapesIndex = new Map<string, GtfsRow<"shapes.txt">[]>();
const stopListItems = new Map<string, HTMLElement[]>();
let highlightedStopItems: HTMLElement[] = [];
const viewHistory = new ViewHistory();
let viewHistoryRestoring = false;
let mapMode: "stops" | "routes" | "route" = "routes";
const filteredTableStates = new Map<string, GtfsTable>();

type CellRenderer = (column: string, value: string | null) => HTMLTableCellElement;

function tableKind(): string {
  if (!feed) return "";
  return filteredTable?.kind ?? feed.tables[tableSelect.selectedIndex]?.kind ?? "";
}

function tableFilterKey(): string | undefined {
  if (!filteredTable) return undefined;
  return `${filteredTable.kind}:${filteredTable.rows.map((row) => {
    const idFields = ["route_id", "stop_id", "trip_id", "shape_id"];
    return idFields.map((field) => String(row.fields[field as keyof typeof row.fields] ?? "")).join(":");
  }).join("|")}`;
}

function captureViewState(): ViewState {
  if (routeDetail && !routeDetail.hidden && currentRoute) {
    return { type: "route", routeId: currentRoute.fields.route_id ?? "" };
  }
  if (stopDetail && !stopDetail.hidden) {
    const stopId = [...stopsById.entries()].find(([, stop]) =>
      `Stop details: ${stop.fields.stop_name || stop.fields.stop_id || "Stop"}` === stopHeading.textContent
    )?.[0] ?? "";
    return { type: "stop", stopId };
  }
  if (mapPanel && !mapPanel.hidden) {
    if (mapMode === "route") {
      const routeId = mapRoute.value === "all"
        ? undefined
        : mapRoutes[Number(mapRoute.value)]?.fields.route_id ?? undefined;
      const variant = mapVariant.value === "all" ? "all" as const : Number(mapVariant.value);
      return { type: "map", mode: "route", routeId, variantIndex: variant };
    }
    return { type: "map", mode: mapMode };
  }
  const filterKey = tableFilterKey();
  if (filterKey && filteredTable) filteredTableStates.set(filterKey, filteredTable);
  return {
    type: "table",
    table: tableKind(),
    itemIndex: page * pageSize,
    search: tableSearch.value,
    filter: tableFilter.textContent ?? undefined,
    filterKind: filterKey,
  };
}

function stateLabel(state: ViewState): string {
  if (state.type === "table") return state.filter ? `Table: ${state.filter}` : `Table: ${state.table || "feed"}`;
  if (state.type === "route") return `Route: ${routesById.get(state.routeId)?.fields.route_long_name || routesById.get(state.routeId)?.fields.route_short_name || state.routeId || "details"}`;
  if (state.type === "stop") return `Stop: ${stopsById.get(state.stopId)?.fields.stop_name || state.stopId || "details"}`;
  if (state.type === "map") return state.mode === "stops" ? "Map: stops" : state.mode === "routes" ? "Map: routes" : "Map: route";
  return "Table";
}

function updateHistoryUi(): void {
  historyBack.disabled = !viewHistory.canGoBack;
  historyForward.disabled = !viewHistory.canGoForward;
  historyRoutes.disabled = !feed?.tables.some((table) => table.kind === "routes.txt");
  historyStops.disabled = !feed?.tables.some((table) => table.kind === "stops.txt");
  historyMenu.replaceChildren();
  viewHistory.states.forEach((state, index) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "history-menu-item";
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(index === viewHistory.currentIndex));
    option.textContent = stateLabel(state);
    option.addEventListener("click", () => {
      const selected = viewHistory.select(index);
      if (selected) restoreViewState(selected);
      closeHistoryMenu();
    });
    historyMenu.append(option);
  });
}

function pushViewState(): void {
  if (viewHistoryRestoring) return;
  viewHistory.push(captureViewState());
  updateHistoryUi();
}

function restoreTableState(state: Extract<ViewState, { type: "table" }>): void {
  const index = feed?.tables.findIndex((table) => table.kind === state.table) ?? -1;
  if (index >= 0) tableSelect.selectedIndex = index;
  filteredTable = state.filterKind ? filteredTableStates.get(state.filterKind) : undefined;
  tableSearch.value = state.search;
  page = Math.floor(state.itemIndex / pageSize);
  resetTableFilter();
  if (filteredTable && state.filter) {
    tableFilter.textContent = state.filter;
    tableFilter.hidden = false;
    clearFilter.hidden = false;
  }
  routeDetail.hidden = true;
  stopDetail.hidden = true;
  mapView?.remove();
  mapView = undefined;
  mapPanel.hidden = true;
  viewer.hidden = false;
  renderSelectedTable();
  tableSelect.focus();
}

function restoreViewState(state: ViewState): void {
  viewHistoryRestoring = true;
  try {
    if (state.type === "table") {
      restoreTableState(state);
    } else if (state.type === "route") {
      const route = routesById.get(state.routeId);
      if (route) showRoute(route);
      else restoreTableState(DEFAULT_VIEW_STATE as Extract<ViewState, { type: "table" }>);
    } else if (state.type === "stop") {
      const stop = stopsById.get(state.stopId);
      if (stop) showStop(stop, "table");
      else restoreTableState(DEFAULT_VIEW_STATE as Extract<ViewState, { type: "table" }>);
    } else if (state.type === "map") {
      if (state.mode === "stops") showStopsMap();
      else if (state.mode === "routes") showAllRoutesMap();
      else {
        const route = state.routeId ? routesById.get(state.routeId) : undefined;
        if (route) showRouteMap(route, "table", state.variantIndex ?? "all");
        else showAllRoutesMap();
      }
    }
  } finally {
    viewHistoryRestoring = false;
  }
  updateHistoryUi();
}

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

function showAgency(agency: GtfsRow<"agency.txt">): void {
  const list = document.createElement("dl");
  list.className = "route-properties";
  for (const [name, value] of [...Object.entries(agency.fields), ...Object.entries(agency.unrecognizedColumns)]) {
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = name;
    if (value === null || value === "") {
      description.textContent = value === null ? "Not provided" : "(empty)";
      description.className = "not-provided";
    } else if (name === "agency_url" || name === "agency_fare_url") {
      description.append(renderLink(value, value));
    } else {
      description.textContent = value;
    }
    list.append(term, description);
  }
  if (agency.extraValues.length) {
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = "Extra values";
    description.textContent = JSON.stringify(agency.extraValues);
    list.append(term, description);
  }
  agencyDialogContent.replaceChildren(list);
  agencyDialog.showModal();
}

function agencyLink(id: string, includeName = false): Node {
  const agency = agenciesById.get(id);
  if (!agency) return document.createTextNode(id);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "route-link";
  button.textContent = includeName && agency.fields.agency_name
    ? `${id} (${agency.fields.agency_name})` : id;
  button.addEventListener("click", () => showAgency(agency));
  return button;
}

function showZoneStops(zone: string): void {
  const table = feed?.tables.find((candidate) => candidate.kind === "stops.txt");
  if (!table) return;
  showFilteredTable(
    { ...table, rows: table.rows.filter((row) => row.fields.zone_id === zone) },
    `Showing stops in zone ${zone}.`,
    false,
  );
}

function routeListLabel(route: GtfsRow<"routes.txt">): string {
  return route.fields.route_short_name || route.fields.route_long_name || route.fields.route_id || "Route";
}

function routeColor(route: GtfsRow<"routes.txt"> | undefined): string | null {
  const value = route?.fields.route_color;
  return value && /^[\da-f]{6}$/i.test(value) ? `#${value}` : null;
}

function routeCompactContent(route: GtfsRow<"routes.txt">, variantIndex: number | null): HTMLElement {
  const content = document.createElement("div");
  const heading = document.createElement("h3");
  heading.textContent = routeListLabel(route);
  content.append(heading);
  const properties = document.createElement("dl");
  properties.className = "route-properties";
  for (const [name, value] of Object.entries(route.fields)) {
    if (![
      "route_id", "route_short_name", "route_long_name", "route_desc", "route_type",
      "route_color", "agency_id", "route_url",
    ].includes(name) || !value) continue;
    const term = document.createElement("dt");
    term.textContent = name;
    const description = document.createElement("dd");
    if (name === "route_url") {
      description.append(renderLink(value, value));
    } else {
      description.textContent = name === "route_type" ? routeTypeLabel(value) : value;
    }
    if (name === "route_color" && /^[\da-f]{6}$/i.test(value)) {
      const swatch = document.createElement("span");
      swatch.className = "route-color-swatch";
      swatch.style.backgroundColor = `#${value}`;
      swatch.setAttribute("aria-hidden", "true");
      description.prepend(swatch);
    }
    properties.append(term, description);
  }
  content.append(properties);
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Open full route details";
  button.addEventListener("click", () => showRoute(route));
  content.append(button);
  const mapButton = document.createElement("button");
  mapButton.type = "button";
  mapButton.className = "route-map-icon";
  mapButton.textContent = "🗺️";
  mapButton.title = "Show route on map";
  mapButton.setAttribute("aria-label", "Show route on map");
  mapButton.addEventListener("click", () => {
    const indices = mapVariantRouteIds.flatMap((id, index) => id === route.fields.route_id ? [index] : []);
    const localIndex = variantIndex === null ? -1 : indices.indexOf(variantIndex);
    showRouteMap(route, "table", localIndex < 0 ? "all" : localIndex);
  });
  content.append(" ", mapButton);
  return content;
}

function stopContent(stop: GtfsRow<"stops.txt">, popup = false): HTMLElement {
  const content = document.createElement("div");
  if (popup) {
    const heading = document.createElement("h3");
    heading.textContent = stop.fields.stop_name || stop.fields.stop_id || "Stop details";
    content.append(heading);
  }
  const list = document.createElement("dl");
  list.className = "route-properties";
  const addProperty = (name: string, value: string | null): void => {
    const term = document.createElement("dt");
    term.textContent = name;
    const description = document.createElement("dd");
    if (value === null || value === "") {
      description.textContent = value === null ? "Not provided" : "(empty)";
      description.className = "not-provided";
    } else {
      description.append(name === "stop_url" ? renderLink(value, value) : document.createTextNode(value));
    }
    if (popup && name === "stop_id") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "route-link";
      button.textContent = "more";
      button.setAttribute("aria-label", "Open stop details");
      button.addEventListener("click", () => showStop(stop, "map"));
      description.append(" ", button);
    }
    list.append(term, description);
  };
  for (const [name, value] of [...Object.entries(stop.fields), ...Object.entries(stop.unrecognizedColumns)]) {
    addProperty(name, value);
  }
  if (stop.extraValues.length) addProperty("Extra values", JSON.stringify(stop.extraValues));
  const ids = stop.fields.stop_id ? routesByStop.get(stop.fields.stop_id) ?? [] : [];
  const term = document.createElement("dt");
  term.textContent = "Routes";
  const description = document.createElement("dd");
  if (!ids.length) {
    description.textContent = "None found";
  } else {
    const routeList = document.createElement("ul");
    routeList.className = popup ? "stop-routes stop-routes--compact" : "stop-routes";
    for (const id of ids) {
      const item = document.createElement("li");
      const route = routesById.get(id);
      if (route) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "route-link";
        const color = routeColor(route);
        if (popup && color) {
          const swatch = document.createElement("span");
          swatch.className = "route-color-swatch";
          swatch.style.backgroundColor = color;
          swatch.setAttribute("aria-hidden", "true");
          button.append(swatch);
        }
        const shortName = routeListLabel(route);
        const longName = route.fields.route_long_name;
        const label = !popup && longName && longName !== shortName ? `${shortName} — ${longName}` : shortName;
        button.append(document.createTextNode(label));
        button.setAttribute("aria-label", popup ? `Show route ${label} on map` : `Open route ${label}`);
        button.addEventListener("click", () => popup ? showRouteMap(route, "table", "all") : showRoute(route, "stop"));
        item.append(button);
      } else {
        item.textContent = route ? routeListLabel(route) : id;
      }
      routeList.append(item);
    }
    description.append(routeList);
  }
  list.append(term, description);
  content.append(list);
  return content;
}

function showStop(stop: GtfsRow<"stops.txt">, returnTo: "table" | "map" | "route"): void {
  stopHeading.textContent = `Stop details: ${stop.fields.stop_name || stop.fields.stop_id || "Stop"}`;
  stopProperties.replaceChildren(stopContent(stop));
  viewer.hidden = true;
  mapPanel.hidden = true;
  routeDetail.hidden = true;
  stopDetail.hidden = false;
  stopHeading.focus();
  pushViewState();
}

const tableCellRenderers: Record<string, CellRenderer> = {
  "routes.txt": renderRoutesCell,
  "agency.txt": (column, value) => column === "agency_url" || column === "agency_fare_url"
    ? renderUrlCell(column, value) : renderGenericCell(column, value),
  "stops.txt": (column, value) => column === "stop_url"
    ? renderUrlCell(column, value) : renderGenericCell(column, value),
};

function showRoute(route: GtfsRow<"routes.txt">, returnTo: "table" | "stop" = "table"): void {
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
    } else if (name === "agency_id") {
      description.append(agencyLink(value, true));
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
  const tripsTable = feed.tables.find((candidate) => candidate.kind === "trips.txt");
  const trips = route.fields.route_id
    ? tripsTable?.rows.filter((trip) => trip.fields.route_id === route.fields.route_id) ?? []
    : [];
  for (const field of ["wheelchair_accessible", "bikes_allowed"] as const) {
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = field;
    description.textContent = summarizeTripField(trips, field);
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
    const mapButton = document.createElement("button");
    mapButton.type = "button";
    mapButton.className = "route-map-icon";
    mapButton.textContent = "🗺️";
    mapButton.title = "View variant on map";
    mapButton.setAttribute("aria-label", `View ${heading.textContent} on map`);
    mapButton.addEventListener("click", () => showRouteMap(route, "route", index));
    heading.append(" ", mapButton);
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
        item.append(routeStopLink(stopId, stopNames));
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
    item.append(routeStopLink(stopId, stopNames));
    routeStopList.append(item);
  }
  if (uniqueStops.size === 0) {
    const item = document.createElement("li");
    item.textContent = "No stops available.";
    routeStopList.append(item);
  }
  const allStopsDetails = document.createElement("details");
  allStopsDetails.open = false;
  const allStopsSummary = document.createElement("summary");
  allStopsSummary.textContent = "Show all route stops";
  allStopsDetails.append(allStopsSummary, routeStopList);
  element("#all-route-stops").replaceChildren(allStopsDetails);
  viewer.hidden = true;
  routeDetail.hidden = false;
  stopDetail.hidden = true;
  mapPanel.hidden = true;
  routeHeading.focus();
  pushViewState();
}

function formatStop(stopId: string | null, stopNames: Map<string | null, string | null>): string {
  const stopName = stopNames.get(stopId);
  return stopName && stopId ? `${stopName} (${stopId})` : stopId || "Stop ID not provided";
}

function routeStopLink(stopId: string | null, stopNames: Map<string | null, string | null>): Node {
  const label = formatStop(stopId, stopNames);
  const stop = stopId ? stopsById.get(stopId) : undefined;
  if (!stop) return document.createTextNode(label);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "route-link";
  button.textContent = label;
  button.addEventListener("click", () => showStop(stop, "route"));
  return button;
}

function showVariantTable(variant: RouteVariant, kind: "shapes.txt" | "trips.txt"): void {
  if (!feed) return;
  const table = getVariantTableRows(feed, variant, kind);
  if (!table) return;
  showFilteredTable(table, kind === "shapes.txt"
    ? `Showing rows for shape ${variant.shapeId}.`
    : "Showing trips for this variant.");
}

function showFilteredTable(table: GtfsTable, message: string, fromRoute = true): void {
  if (!feed) return;
  filteredTable = table;
  tableSelect.selectedIndex = feed.tables.findIndex((candidate) => candidate.kind === table.kind);
  page = 0;
  tableSearch.value = "";
  tableFilter.textContent = message;
  tableFilter.hidden = false;
  clearFilter.hidden = false;
  backToRoute.hidden = !fromRoute;
  routeDetail.hidden = true;
  viewer.hidden = false;
  renderSelectedTable();
  tableSelect.focus();
  pushViewState();
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
    for (const column of recognized) {
      const value = fields[column];
      const referencedRoute = getReferencedRoute(routesById, table.kind, column, value);
      if (column === "agency_id" && value && agenciesById.has(value)) {
        const cell = document.createElement("td");
        cell.append(agencyLink(value));
        row.append(cell);
      } else if (table.kind === "fare_rules.txt" && (column === "origin_id" || column === "destination_id" || column === "contains_id")
        && value && feed?.tables.some((candidate) => candidate.kind === "stops.txt")) {
        const cell = document.createElement("td");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "route-link";
        button.textContent = value;
        button.setAttribute("aria-label", `Show stops in zone ${value}`);
        button.addEventListener("click", () => showZoneStops(value));
        cell.append(button);
        row.append(cell);
      } else if (referencedRoute) {
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
      const entries = Object.entries(values.unrecognizedColumns);
      cell.append("{");
      for (const [index, [name, value]] of entries.entries()) {
        if (index) cell.append(", ");
        cell.append(`${JSON.stringify(name)}: `);
        if (name === "agency_id" && value && agenciesById.has(value)) {
          cell.append(agencyLink(value));
        } else {
          cell.append(JSON.stringify(value));
        }
      }
      cell.append("}");
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
      const more = document.createElement("button");
      more.type = "button";
      more.textContent = "...";
      more.title = "Open route details";
      more.setAttribute("aria-label", `Open route ${route.fields.route_short_name || route.fields.route_id || "details"}`);
      more.addEventListener("click", () => showRoute(route));
      row.firstElementChild?.prepend(button, " ", more, " ");
    } else if (table.kind === "stops.txt") {
      const stop = values as GtfsRow<"stops.txt">;
      const position = mapStop(stop).coordinate;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "route-map-icon";
      button.textContent = "🗺️";
      button.title = position ? "View stop on map" : "Stop location unavailable";
      button.setAttribute("aria-label", `View stop ${stop.fields.stop_name || stop.fields.stop_id || "details"} on map`);
      button.disabled = !position;
      button.addEventListener("click", () => {
        showStopsMap();
        if (position) mapView?.zoomTo(position);
      });
      const more = document.createElement("button");
      more.type = "button";
      more.className = "route-link";
      more.textContent = "More";
      more.setAttribute("aria-label", `Open stop ${stop.fields.stop_name || stop.fields.stop_id || "details"}`);
      more.addEventListener("click", () => showStop(stop, "table"));
      row.firstElementChild?.prepend(button, " (", more, ") ");
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
  routesMapButton.hidden = table?.kind !== "routes.txt";
  if (table) renderTable(table);
}

function openMap(returnTo: "table" | "route", title: string): void {
  mapView?.remove();
  mapView = undefined;
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
    mapView = new MapView(
      mapCanvas,
      (message) => { mapError.textContent = message; },
      highlightStopList,
      (id) => {
        const stop = stopsById.get(id);
        return stop ? stopContent(stop, true) : null;
      },
      (id, variantIndex) => {
        const route = routesById.get(id);
        return route ? routeCompactContent(route, variantIndex) : null;
      },
      (index) => {
        for (const button of mapSidebar.querySelectorAll<HTMLButtonElement>(".map-variant-label")) {
          button.classList.toggle("map-variant-hover", button.dataset.variantIndex === String(index));
        }
      },
      mapBaseLayer.value as MapBaseLayerId,
    );
    mapView.setRouteColors(mapRouteColors.checked);
    mapView.setRandomColors(mapRandomColors.checked);
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
  mapMode = "stops";
  openMap("table", "Stops map");
  renderStopsMap();
  pushViewState();
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

function showRouteMap(route: GtfsRow<"routes.txt">, returnTo: "table" | "route", variantIndex: number | "all" = 0): void {
  if (!feed) return;
  const title = route.fields.route_short_name || route.fields.route_long_name || route.fields.route_id;
  const routes = feed.tables.find((table) => table.kind === "routes.txt")?.rows ?? [];
  prepareRouteMap(routes);
  const routeIndex = mapRoutes.findIndex((candidate) => candidate === route);
  mapRoute.value = routeIndex < 0 ? "all" : String(routeIndex);
  populateMapVariants();
  if (variantIndex !== "all") {
    const indices = mapVariantRouteIds.flatMap((id, index) => id === route.fields.route_id ? [index] : []);
    if (indices[variantIndex] !== undefined) mapVariant.value = String(indices[variantIndex]);
  }
  openMap(returnTo, title ? `Route map: ${title}` : "Route map");
  renderRouteMap();
  mapMode = "route";
  pushViewState();
}

function showAllRoutesMap(): void {
  if (!feed) return;
  const table = filteredTable ?? feed.tables[tableSelect.selectedIndex];
  if (table?.kind !== "routes.txt") return;
  prepareRouteMap(getMatchingRows(table, tableSearch.value) as GtfsRow<"routes.txt">[]);
  mapRoute.value = "all";
  populateMapVariants();
  openMap("table", "Routes map");
  renderRouteMap();
  mapMode = "routes";
  pushViewState();
}

function prepareRouteMap(routes: GtfsRow<"routes.txt">[]): void {
  if (!feed) return;
  const trips = feed.tables.find((candidate) => candidate.kind === "trips.txt");
  const times = feed.tables.find((candidate) => candidate.kind === "stop_times.txt");
  const tripsByRoute = new Map<string, GtfsRow<"trips.txt">[]>();
  const routeByTrip = new Map<string, string>();
  for (const trip of trips?.rows ?? []) {
    const { route_id, trip_id } = trip.fields;
    if (!route_id) continue;
    const rows = tripsByRoute.get(route_id) ?? [];
    rows.push(trip);
    tripsByRoute.set(route_id, rows);
    if (trip_id) routeByTrip.set(trip_id, route_id);
  }
  const timesByRoute = new Map<string, GtfsRow<"stop_times.txt">[]>();
  for (const time of times?.rows ?? []) {
    const routeId = time.fields.trip_id && routeByTrip.get(time.fields.trip_id);
    if (!routeId) continue;
    const rows = timesByRoute.get(routeId) ?? [];
    rows.push(time);
    timesByRoute.set(routeId, rows);
  }
  mapStopsIndex = indexStops(feed);
  mapShapesIndex = indexShapes(feed);
  mapRouteVariants = [];
  mapVariantLabels = [];
  mapVariantRouteIds = [];
  mapVariantColors = [];
  mapVariantRandomColors = [];
  mapRoutes = routes;
  for (const route of routes) {
    const id = route.fields.route_id;
    if (!id) continue;
    const routeFeed: GtfsFeed = {
      ...feed,
      tables: feed.tables.map((candidate) => {
        if (candidate.kind === "trips.txt") return { ...candidate, rows: tripsByRoute.get(id) ?? [] };
        if (candidate.kind === "stop_times.txt") return { ...candidate, rows: timesByRoute.get(id) ?? [] };
        return candidate;
      }),
    };
    const variants = getRouteVariants(routeFeed, id).variants;
    const routeName = route.fields.route_short_name || route.fields.route_long_name || id;
    const randomColor = `#${Array.from({ length: 3 }, () => Math.floor(Math.random() * 160 + 32).toString(16).padStart(2, "0")).join("")}`;
    for (const [index, variant] of variants.entries()) {
      mapRouteVariants.push(variant);
      mapVariantLabels.push(`${routeName}: ${variantLabel(variant, index, mapStopsIndex)}`);
      mapVariantRouteIds.push(id);
      mapVariantColors.push(routeColor(route));
      mapVariantRandomColors.push(randomColor);
    }
  }
  mapSidebar.hidden = false;
  mapVariantControls.hidden = false;
  mapClearFilter.hidden = true;
  mapRoute.replaceChildren();
  const allRoutes = document.createElement("option");
  allRoutes.value = "all";
  allRoutes.textContent = "All routes";
  mapRoute.append(allRoutes);
  for (const [index, route] of mapRoutes.entries()) {
    const option = document.createElement("option");
    option.value = String(index);
    const shortName = routeListLabel(route);
    const longName = route.fields.route_long_name;
    option.textContent = longName && longName !== shortName ? `${shortName} — ${longName}` : shortName;
    mapRoute.append(option);
  }
}

function populateMapVariants(): void {
  const routeId = mapRoute.value === "all" ? null : mapRoutes[Number(mapRoute.value)]?.fields.route_id;
  mapVariant.replaceChildren();
  const all = document.createElement("option");
  all.value = "all";
  all.textContent = "All variants";
  mapVariant.append(all);
  for (const [index, label] of mapVariantLabels.entries()) {
    if (routeId !== null && mapVariantRouteIds[index] !== routeId) continue;
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = label;
    mapVariant.append(option);
  }
  mapVariant.value = "all";
}

function renderRouteMap(preserveMapView = false): void {
  if (!feed) return;
  const selectedRoute = mapRoute.value === "all" ? undefined : mapRoutes[Number(mapRoute.value)];
  mapHeading.textContent = selectedRoute ? `Route map: ${routeListLabel(selectedRoute)}` : "Routes map";
  mapRouteReset.disabled = mapRoute.value === "all";
  mapVariantReset.disabled = mapVariant.value === "all";
  mapSidebar.replaceChildren();
  stopListItems.clear();
  highlightedStopItems = [];
  pinnedVariant = null;
  const routeId = mapRoute.value === "all" ? null : mapRoutes[Number(mapRoute.value)]?.fields.route_id;
  const selected = mapVariant.value === "all"
    ? mapVariantRouteIds.flatMap((id, index) => routeId === null || id === routeId ? [index] : [])
    : [Number(mapVariant.value)];
  const allStops: MapStop[] = [];
  const lines: MapLine[] = [];
  const warnings: string[] = [];
  let approximateLines = 0;
  let missingLines = 0;
  const stopLabels = new Map<string, string[]>();
  const clearHighlight = document.createElement("button");
  clearHighlight.type = "button";
  clearHighlight.textContent = "Clear variant highlight";
  clearHighlight.hidden = true;
  clearHighlight.addEventListener("click", () => {
    pinnedVariant = null;
    clearHighlight.hidden = true;
    for (const button of mapSidebar.querySelectorAll<HTMLButtonElement>(".map-variant-label")) {
      button.setAttribute("aria-pressed", "false");
    }
    mapView?.highlightVariant(null);
    mapView?.setStopOrderVariant(null);
  });
  mapSidebar.append(clearHighlight);
  for (const index of selected) {
    const variant = mapRouteVariants[index];
    const label = mapVariantLabels[index];
    const data = variantMapData(mapShapesIndex, variant, mapStopsIndex);
    allStops.push(...data.stops);
    lines.push({
      coordinates: data.line,
      approximate: data.approximate,
      variantIndex: index,
      label,
      routeId: mapVariantRouteIds[index],
      color: mapVariantColors[index] ?? undefined,
      randomColor: mapVariantRandomColors[index],
      stopIds: data.stops.flatMap((stop) => stop.id ? [stop.id] : []),
    });
    if (data.approximate) {
      if (data.line.length >= 2) approximateLines++;
      else missingLines++;
    } else if (data.invalidShapePoints) {
      warnings.push(`${label}: ${data.invalidShapePoints} invalid shape points omitted.`);
    }
    const section = document.createElement("section");
    const heading = document.createElement("h3");
    const variantButton = document.createElement("button");
    variantButton.type = "button";
    variantButton.className = "map-variant-label";
    variantButton.dataset.variantIndex = String(index);
    variantButton.textContent = label;
    variantButton.setAttribute("aria-pressed", "false");
    variantButton.addEventListener("mouseenter", () => mapView?.hoverVariant(index));
    variantButton.addEventListener("mouseleave", () => mapView?.hoverVariant(null));
    variantButton.addEventListener("focus", () => mapView?.hoverVariant(index));
    variantButton.addEventListener("blur", () => mapView?.hoverVariant(null));
    variantButton.addEventListener("click", () => {
      pinnedVariant = pinnedVariant === index ? null : index;
      clearHighlight.hidden = pinnedVariant === null;
      for (const button of mapSidebar.querySelectorAll<HTMLButtonElement>(".map-variant-label")) {
        button.setAttribute("aria-pressed", String(button === variantButton && pinnedVariant !== null));
      }
      mapView?.highlightVariant(pinnedVariant);
      mapView?.setStopOrderVariant(pinnedVariant);
    });
    const list = document.createElement("ol");
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "map-stop-list-toggle";
    toggle.textContent = "▾";
    toggle.title = "Collapse all stop lists";
    toggle.setAttribute("aria-label", "Collapse all stop lists");
    toggle.setAttribute("aria-expanded", "true");
    toggle.addEventListener("click", () => {
      const collapse = [...mapSidebar.querySelectorAll<HTMLOListElement>("section > ol")].some((item) => !item.hidden);
      for (const item of mapSidebar.querySelectorAll<HTMLOListElement>("section > ol")) item.hidden = collapse;
      const action = collapse ? "Expand" : "Collapse";
      for (const button of mapSidebar.querySelectorAll<HTMLButtonElement>(".map-stop-list-toggle")) {
        button.textContent = collapse ? "▸" : "▾";
        button.title = `${action} all stop lists`;
        button.setAttribute("aria-label", `${action} all stop lists`);
        button.setAttribute("aria-expanded", String(!collapse));
      }
    });
    heading.append(toggle, variantButton);
    section.append(heading);
    for (const [stopIndex, stop] of data.stops.entries()) {
      const item = document.createElement("li");
      if (stop.id) {
        const items = stopListItems.get(stop.id) ?? [];
        items.push(item);
        stopListItems.set(stop.id, items);
        const labels = stopLabels.get(stop.id) ?? [];
        labels.push(selected.length > 1 ? `${label}: ${stopIndex + 1}` : String(stopIndex + 1));
        stopLabels.set(stop.id, labels);
      }
      const stopLabel = stop.name && stop.id ? `${stop.name} (${stop.id})` : stop.id || "Stop ID not provided";
      if (stop.coordinate) {
        const position = stop.coordinate;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "route-link";
        button.textContent = stopLabel;
        button.addEventListener("mouseenter", () => mapView?.highlight(position));
        button.addEventListener("mouseleave", () => mapView?.highlight(null));
        button.addEventListener("focus", () => mapView?.highlight(position));
        button.addEventListener("blur", () => mapView?.highlight(null));
        button.addEventListener("click", () => mapView?.zoomTo(position));
        item.append(button);
      } else {
        item.textContent = `${stopLabel} (location unavailable)`;
      }
      const row = stop.id ? stopsById.get(stop.id) : undefined;
      if (row) {
        const details = document.createElement("button");
        details.type = "button";
        details.className = "stop-details-link";
        details.textContent = "...";
        details.title = `Open details for ${stopLabel}`;
        details.setAttribute("aria-label", `Open details for ${stopLabel}`);
        details.addEventListener("click", () => showStop(row, "map"));
        item.append(" ", details);
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
  const missingShapes = approximateLines + missingLines;
  if (missingShapes) {
    warnings.push(`Shape unavailable for ${missingShapes} ${missingShapes === 1 ? "variant" : "variants"}.`
      + (approximateLines ? ` ${approximateLines} shown as dashed lines connecting known stops approximately.` : "")
      + (missingLines ? ` ${missingLines} have too few located stops to draw a line.` : ""));
  }
  const missing = allStops.filter((stop) => !stop.coordinate).length;
  if (missing) warnings.push(`${missing} stop ${missing === 1 ? "location is" : "locations are"} unavailable.`);
  mapSummary.textContent = warnings.join(" ") || (mapRouteVariants.length
    ? `${selected.length} ${selected.length === 1 ? "variant" : "variants"} shown.`
    : "No route variants are available.");
  const displayedStops = mapAllStops.checked
    ? (feed.tables.find((table) => table.kind === "stops.txt")?.rows ?? []).map(mapStop)
    : allStops;
  mapView?.update(displayedStops.map((stop) => ({
    ...stop,
    hoverLabel: stop.id && stopLabels.has(stop.id)
      ? `${stop.name?.trim() || stop.id} — ${stopLabels.get(stop.id)!.length > 5
        ? `${stopLabels.get(stop.id)!.length} stops`
        : `stop ${stopLabels.get(stop.id)!.join(", ")}`}`
      : undefined,
  })), lines, !preserveMapView);
  mapView?.setStopOrderVariant(selected.length === 1 ? selected[0] : null);
  mapView?.highlightVariant(selected.length === 1 ? selected[0] : null);
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
  loadPanel.classList.remove("loaded");
  viewer.hidden = true;
  routeDetail.hidden = true;
  stopDetail.hidden = true;
  mapPanel.hidden = true;
  if (historyControls) historyControls.hidden = true;
  mapView?.remove();
  mapView = undefined;
  viewHistory.clear();
  resetTableFilter();
  tableSearch.value = "";
  currentRoute = undefined;
  feed = undefined;
  routesById.clear();
  agenciesById.clear();

  try {
    feed = await loadFeed(file);
    if (historyControls) historyControls.hidden = false;
    routesById = indexRoutes(feed);
    const agencies = feed.tables.find((table) => table.kind === "agency.txt");
    for (const agency of agencies?.rows ?? []) {
      if (agency.fields.agency_id && !agenciesById.has(agency.fields.agency_id)) {
        agenciesById.set(agency.fields.agency_id, agency);
      }
    }
    stopsById = new Map();
    const stops = feed.tables.find((table) => table.kind === "stops.txt");
    for (const stop of stops?.rows ?? []) {
      if (stop.fields.stop_id && !stopsById.has(stop.fields.stop_id)) stopsById.set(stop.fields.stop_id, stop);
    }
    routesByStop = indexStopRoutes(feed);
    tableSelect.replaceChildren(...feed.tables.map((table) => {
      const option = document.createElement("option");
      option.textContent = table.name;
      return option;
    }));
    feedSummary.textContent = `${file.name} · ${feed.tables.length} ${feed.tables.length === 1 ? "table" : "tables"}`;
    page = 0;
    renderSelectedTable();
    pushViewState();
    viewer.hidden = false;
    loadPanel.classList.add("loaded");
    status.textContent = "Feed loaded.";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Could not load the feed.";
  } finally {
    input.disabled = false;
    submit.disabled = false;
  }
});

element<HTMLButtonElement>("#agency-dialog-close").addEventListener("click", () => agencyDialog.close());
stopsMapButton.addEventListener("click", showStopsMap);
routesMapButton.addEventListener("click", showAllRoutesMap);
routeMapButton.addEventListener("click", () => {
  if (currentRoute) showRouteMap(currentRoute, "route");
});
mapRoute.addEventListener("change", () => {
  populateMapVariants();
  renderRouteMap();
  pushViewState();
});
mapRouteReset.addEventListener("click", () => {
  mapRoute.value = "all";
  populateMapVariants();
  renderRouteMap();
});
mapVariant.addEventListener("change", () => renderRouteMap());
mapVariant.addEventListener("change", () => pushViewState());
mapVariantReset.addEventListener("click", () => {
  mapVariant.value = "all";
  renderRouteMap();
});
mapRouteColors.addEventListener("change", () => {
  if (mapRouteColors.checked) mapRandomColors.checked = false;
  mapView?.setRouteColors(mapRouteColors.checked);
  mapView?.setRandomColors(mapRandomColors.checked);
});
mapRandomColors.addEventListener("change", () => {
  if (mapRandomColors.checked) mapRouteColors.checked = false;
  mapView?.setRouteColors(mapRouteColors.checked);
  mapView?.setRandomColors(mapRandomColors.checked);
});
mapAllStops.addEventListener("change", () => renderRouteMap(true));
mapReducedStops.addEventListener("change", () => mapView?.setStopSizeReduced(mapReducedStops.checked));
mapStopOrder.addEventListener("change", () => mapView?.setStopOrderEnabled(mapStopOrder.checked));
mapBaseLayer.addEventListener("change", () => {
  mapView?.setBaseLayer(mapBaseLayer.value as MapBaseLayerId);
});
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
  pushViewState();
});

tableSelect.addEventListener("change", () => {
  resetTableFilter();
  tableSearch.value = "";
  page = 0;
  renderSelectedTable();
  pushViewState();
});
tableSearch.addEventListener("input", () => {
  page = 0;
  renderSelectedTable();
  pushViewState();
});
pageSizeSelect.addEventListener("change", () => {
  pageSize = Number(pageSizeSelect.value);
  page = 0;
  renderSelectedTable();
  pushViewState();
});
previous.addEventListener("click", () => {
  if (page > 0) {
    page--;
    renderSelectedTable();
    pushViewState();
  }
});
next.addEventListener("click", () => {
  if (!next.disabled) {
    page++;
    renderSelectedTable();
    pushViewState();
  }
});

historyBack.addEventListener("click", () => {
  const state = viewHistory.back();
  if (state) restoreViewState(state);
  else restoreTableState(DEFAULT_VIEW_STATE as Extract<ViewState, { type: "table" }>);
});

historyForward.addEventListener("click", () => {
  const state = viewHistory.forward();
  if (state) restoreViewState(state);
});

function openHistoryTable(kind: "routes.txt" | "stops.txt"): void {
  if (!feed) return;
  if (!feed.tables.some((table) => table.kind === kind)) return;
  restoreViewState({ type: "table", table: kind, itemIndex: 0, search: "" });
  pushViewState();
}

historyRoutes.addEventListener("click", () => openHistoryTable("routes.txt"));
historyStops.addEventListener("click", () => openHistoryTable("stops.txt"));

function closeHistoryMenu(): void {
  historyMenu.hidden = true;
  historySelect.setAttribute("aria-expanded", "false");
}

historySelect.addEventListener("click", () => {
  const opening = historyMenu.hidden;
  historyMenu.hidden = !opening;
  historySelect.setAttribute("aria-expanded", String(opening));
});

document.addEventListener("click", (event) => {
  if (event.target instanceof Node && !historySelect.parentElement?.contains(event.target)) closeHistoryMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeHistoryMenu();
});
