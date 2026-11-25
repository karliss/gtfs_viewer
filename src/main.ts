import {
  decodeRouteType, getMatchingRows, getReferencedRoute, getRouteVariants, getTableColumns, getVariantTableRows, summarizeTripField,
  getVariantTimetable, formatTimetableDayRange, getDateSchedule, getTripFares, isServiceActiveOnDate,
  gtfsDateToIso, isoDateToGtfs,
  type GtfsFeed, type GtfsRow, type GtfsTable, type RouteVariant,
} from "./gtfs";
import workerSource from "../dist/gtfs-worker.txt";
import type { WorkerResponse } from "./gtfs-worker";
import { mapStop, variantLabel, variantMapData, type MapStop } from "./map-data";
import {
  defaultMapBaseLayer,
  MAP_BASE_LAYERS,
  MapView,
  type MapBaseLayerId,
  type MapLine,
} from "./map-view";
import { DEFAULT_VIEW_STATE, ViewHistory, type ViewState } from "./view-history";
import {
  WARNING_DESCRIPTIONS, WARNING_LABELS, WARNING_TYPES,
  WarningCollector,
  type GtfsWarning, type WarningType,
} from "./warnings";
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
      <span id="loading-spinner" class="loading-spinner" aria-label="Loading feed" hidden></span>
      <progress id="loading-progress" max="100" value="0" hidden></progress>
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
      <button id="history-warnings" type="button">Warnings</button>
    </div>
    <section id="viewer" class="panel viewer" hidden>
      <button id="back-to-route" type="button" hidden>Back to route details</button>
      <div class="table-selection-row">
        <label for="table-select">Table</label>
        <select id="table-select"></select>
        <button id="stops-map" type="button" hidden title="View stops on map" aria-label="View stops on map">🗺️</button>
        <button id="routes-map" type="button" hidden title="View routes on map" aria-label="View routes on map">🗺️</button>
        <span id="feed-summary"></span>
      </div>
      <p id="table-filter" hidden></p>
      <button id="clear-filter" type="button" hidden>Show all rows</button>
      <div class="table-controls">
        <div>
          <label for="table-search">Search rows</label>
          <input id="table-search" type="search" placeholder="Search all fields" />
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
        <label for="page-size">Rows per page</label>
        <select id="page-size">
          <option>25</option>
          <option>50</option>
          <option selected>100</option>
          <option>250</option>
          <option>500</option>
        </select>
      </div>
    </section>
    <section id="route-detail" class="panel viewer" aria-labelledby="route-heading" hidden>
      <h2 id="route-heading" tabindex="-1">Route details</h2>
      <div id="route-properties"></div>
      <p id="route-summary"></p>
      <button id="route-trips" type="button">View route trips</button>
      <button id="route-date-schedule" type="button">Open date-specific schedule</button>
      <button id="route-map" type="button">🗺️ View route on map</button>
      <h3>Shapes and route variants</h3>
      <div id="route-variants"></div>
      <section id="all-route-stops">
        <ol id="route-stop-list"></ol>
      </section>
    </section>
    <section id="warnings-view" class="panel viewer" aria-labelledby="warnings-heading" hidden>
      <h2 id="warnings-heading" tabindex="-1">Warnings</h2>
      <div class="warning-filter-columns">
        <div class="warning-filter-category">
          <h3>Warning types</h3>
          <div class="warning-filter-actions">
            <button id="warning-types-select-all" type="button">Select all</button>
            <button id="warning-types-clear-all" type="button">Clear all</button>
          </div>
          <div id="warning-types" class="warning-types" aria-label="Warning types"></div>
        </div>
        <div class="warning-filter-category">
          <h3>Tables</h3>
          <div class="warning-filter-actions">
            <button id="warning-tables-select-all" type="button">Select all</button>
            <button id="warning-tables-clear-all" type="button">Clear all</button>
          </div>
          <div id="warning-tables" class="warning-tables" aria-label="Associated tables"></div>
        </div>
      </div>
      <div class="table-scroll" tabindex="0" role="region" aria-label="GTFS warnings">
        <table>
          <thead><tr><th scope="col">Severity</th><th scope="col">Type</th><th scope="col">Row</th><th scope="col">Message</th></tr></thead>
          <tbody id="warning-table-body"></tbody>
        </table>
      </div>
      <div class="pagination">
        <button id="warning-previous" type="button">Previous</button>
        <span id="warning-page-label"></span>
        <button id="warning-next" type="button">Next</button>
        <label for="warning-page-size">Rows per page</label>
        <select id="warning-page-size">
          <option>25</option>
          <option>50</option>
          <option selected>100</option>
          <option>250</option>
          <option>500</option>
        </select>
      </div>
    </section>
    <section id="stop-detail" class="panel viewer" aria-labelledby="stop-heading" hidden>
      <h2 id="stop-heading" tabindex="-1">Stop details</h2>
      <div id="stop-properties"></div>
    </section>
    <section id="trip-detail" class="panel viewer" aria-labelledby="trip-heading" hidden>
      <h2 id="trip-heading" tabindex="-1">Trip details</h2>
      <div id="trip-properties"></div>
      <details id="trip-route-details">
        <summary id="trip-route-summary">Route</summary>
        <div id="trip-route-properties"></div>
      </details>
      <section>
        <h3>Service calendar</h3>
        <div id="trip-calendar"></div>
        <div id="trip-exceptions"></div>
      </section>
      <section>
        <h3>Frequencies</h3>
        <div id="trip-frequencies"></div>
      </section>
      <section>
        <h3>Stops and times</h3>
        <p id="trip-stop-help">Select a stop to calculate fares to every following stop.</p>
        <ol id="trip-stop-list"></ol>
        <div id="trip-fares"></div>
      </section>
    </section>
    <section id="date-schedule" class="panel viewer" aria-labelledby="date-schedule-heading" hidden>
      <h2 id="date-schedule-heading" tabindex="-1">Date-specific schedule</h2>
      <div class="form-controls">
        <label for="schedule-date">Date</label>
        <input id="schedule-date" type="date" />
      </div>
      <p id="schedule-summary"></p>
      <div id="schedule-variants"></div>
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
        <details id="map-settings" class="map-settings">
          <summary title="Map settings" aria-label="Map settings">⚙</summary>
          <div class="map-settings-menu">
            <label class="map-option" for="map-base-layer">
              <span>Background map</span>
              <select id="map-base-layer"></select>
            </label>
            <label class="map-option" for="map-raster-black-and-white">
              <input id="map-raster-black-and-white" type="checkbox" />
              Black and white
            </label>
            <label class="map-option" for="map-route-colors">
              <input id="map-route-colors" type="checkbox" />
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
const loadingSpinner = element<HTMLSpanElement>("#loading-spinner");
const loadingProgress = element<HTMLProgressElement>("#loading-progress");
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
const historyWarnings = element<HTMLButtonElement>("#history-warnings");
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
const tripDetail = element<HTMLElement>("#trip-detail");
const tripHeading = element<HTMLHeadingElement>("#trip-heading");
const tripProperties = element<HTMLElement>("#trip-properties");
const tripRouteDetails = element<HTMLDetailsElement>("#trip-route-details");
const tripRouteSummary = element<HTMLElement>("#trip-route-summary");
const tripRouteProperties = element<HTMLElement>("#trip-route-properties");
const tripCalendar = element<HTMLElement>("#trip-calendar");
const tripExceptions = element<HTMLElement>("#trip-exceptions");
const tripFrequencies = element<HTMLElement>("#trip-frequencies");
const tripStopHelp = element<HTMLParagraphElement>("#trip-stop-help");
const tripStopList = element<HTMLOListElement>("#trip-stop-list");
const tripFares = element<HTMLElement>("#trip-fares");
const dateSchedule = element<HTMLElement>("#date-schedule");
const dateScheduleHeading = element<HTMLHeadingElement>("#date-schedule-heading");
const scheduleDate = element<HTMLInputElement>("#schedule-date");
const scheduleSummary = element<HTMLParagraphElement>("#schedule-summary");
const scheduleVariants = element<HTMLElement>("#schedule-variants");
const routeDateSchedule = element<HTMLButtonElement>("#route-date-schedule");
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
const mapRasterBlackAndWhite = element<HTMLInputElement>("#map-raster-black-and-white");
const mapRouteColors = element<HTMLInputElement>("#map-route-colors");
const mapRandomColors = element<HTMLInputElement>("#map-random-colors");
const mapAllStops = element<HTMLInputElement>("#map-all-stops");
const mapReducedStops = element<HTMLInputElement>("#map-reduced-stops");
const mapStopOrder = element<HTMLInputElement>("#map-stop-order");
const mapClearFilter = element<HTMLButtonElement>("#map-clear-filter");
const mapSettings = element<HTMLDetailsElement>("#map-settings");
const agencyDialog = element<HTMLDialogElement>("#agency-dialog");
const agencyDialogContent = element<HTMLElement>("#agency-dialog-content");
const warningsView = element<HTMLElement>("#warnings-view");
const warningTypes = element<HTMLElement>("#warning-types");
const warningTables = element<HTMLElement>("#warning-tables");
const warningTypesSelectAll = element<HTMLButtonElement>("#warning-types-select-all");
const warningTypesClearAll = element<HTMLButtonElement>("#warning-types-clear-all");
const warningTablesSelectAll = element<HTMLButtonElement>("#warning-tables-select-all");
const warningTablesClearAll = element<HTMLButtonElement>("#warning-tables-clear-all");
const warningTableBody = element<HTMLTableSectionElement>("#warning-table-body");
const warningPrevious = element<HTMLButtonElement>("#warning-previous");
const warningNext = element<HTMLButtonElement>("#warning-next");
const warningPageLabel = element<HTMLSpanElement>("#warning-page-label");
const warningPageSize = element<HTMLSelectElement>("#warning-page-size");
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
let currentTrip: GtfsRow<"trips.txt"> | undefined;
let currentScheduleRoute: GtfsRow<"routes.txt"> | undefined;
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
let selectedWarningTypes = new Set<WarningType>(WARNING_TYPES);
let selectedWarningTables = new Set<string>();
let warningTablesInitialized = false;
let warningPage = 0;
let warningRowsPerPage = 100;
const warningCollector = new WarningCollector();
const filteredTableStates = new Map<string, GtfsTable>();

type CellRenderer = (column: string, value: string | number | null) => HTMLTableCellElement;

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
  if (!warningsView.hidden) return {
    type: "warnings",
    itemIndex: warningPage * warningRowsPerPage,
  };
  if (routeDetail && !routeDetail.hidden && currentRoute) {
    return { type: "route", routeId: currentRoute.fields.route_id ?? "" };
  }
  if (tripDetail && !tripDetail.hidden && currentTrip?.fields.trip_id) {
    return { type: "trip", tripId: currentTrip.fields.trip_id };
  }
  if (dateSchedule && !dateSchedule.hidden && currentScheduleRoute) {
    return {
      type: "date-schedule",
      routeId: currentScheduleRoute.fields.route_id ?? "",
      date: scheduleDate.value,
    };
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
  if (state.type === "warnings") return "Warnings";
  if (state.type === "table") return state.filter ? `Table: ${state.filter}` : `Table: ${state.table || "feed"}`;
  if (state.type === "route") return `Route: ${routesById.get(state.routeId)?.fields.route_long_name || routesById.get(state.routeId)?.fields.route_short_name || state.routeId || "details"}`;
  if (state.type === "stop") return `Stop: ${stopsById.get(state.stopId)?.fields.stop_name || state.stopId || "details"}`;
  if (state.type === "trip") return `Trip: ${feed?.indexes.tripsById.get(state.tripId)?.fields.trip_headsign || state.tripId}`;
  if (state.type === "date-schedule") return `Schedule: ${routesById.get(state.routeId)?.fields.route_short_name || state.routeId} · ${state.date}`;
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
  tripDetail.hidden = true;
  dateSchedule.hidden = true;
  mapView?.remove();
  mapView = undefined;
  mapPanel.hidden = true;
  viewer.hidden = false;
  warningsView.hidden = true;
  renderSelectedTable();
  tableSelect.focus();
}

function restoreViewState(state: ViewState): void {
  viewHistoryRestoring = true;
  try {
    if (state.type === "warnings") {
      warningPage = Math.floor(state.itemIndex / warningRowsPerPage);
      showWarnings();
    } else if (state.type === "table") {
      restoreTableState(state);
    } else if (state.type === "route") {
      const route = routesById.get(state.routeId);
      if (route) showRoute(route);
      else restoreTableState(DEFAULT_VIEW_STATE as Extract<ViewState, { type: "table" }>);
    } else if (state.type === "stop") {
      const stop = stopsById.get(state.stopId);
      if (stop) showStop(stop);
      else restoreTableState(DEFAULT_VIEW_STATE as Extract<ViewState, { type: "table" }>);
    } else if (state.type === "trip") {
      const trip = feed?.indexes.tripsById.get(state.tripId);
      if (trip) showTrip(trip);
      else restoreTableState(DEFAULT_VIEW_STATE as Extract<ViewState, { type: "table" }>);
    } else if (state.type === "date-schedule") {
      const route = routesById.get(state.routeId);
      if (route) showDateSchedule(route, state.date);
      else restoreTableState(DEFAULT_VIEW_STATE as Extract<ViewState, { type: "table" }>);
    } else if (state.type === "map") {
      if (state.mode === "stops") showStopsMap();
      else if (state.mode === "routes") showAllRoutesMap();
      else {
        const route = state.routeId ? routesById.get(state.routeId) : undefined;
        if (route) showRouteMap(route, state.variantIndex ?? "all");
        else showAllRoutesMap();
      }
    }
  } finally {
    viewHistoryRestoring = false;
  }
  updateHistoryUi();
}

function renderGenericCell(_column: string, value: string | number | null): HTMLTableCellElement {
  const cell = document.createElement("td");
  cell.textContent = value === null ? "" : String(value);
  return cell;
}

function renderLink(value: string | number | null, label: string): Node {
  if (!value) return document.createTextNode(label);
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    return document.createTextNode(label);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return document.createTextNode(label);
  const link = document.createElement("a");
  link.href = url.href;
  link.textContent = label;
  return link;
}

function renderUrlCell(_column: string, value: string | number | null): HTMLTableCellElement {
  const cell = document.createElement("td");
  cell.append(renderLink(value, value === null ? "" : String(value)));
  return cell;
}

function routeTypeLabel(value: string | number): string {
  const text = String(value);
  const name = decodeRouteType(text);
  return name === `Unknown route type (${text})` ? name : `${name} (${text})`;
}

function formatDateWithWeekday(date: string | null): string {
  if (!date) return "";
  const iso = gtfsDateToIso(date) || date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return date;
  const weekday = new Date(`${iso}T12:00:00Z`).getUTCDay();
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return `${iso} (${dayNames[weekday]})`;
}

function renderRoutesCell(column: string, value: string | number | null): HTMLTableCellElement {
  if (column === "route_url") return renderUrlCell(column, value);
  if (column === "route_type" && value !== null) {
    return renderGenericCell(column, routeTypeLabel(value));
  }
  if (column === "route_color" && typeof value === "string" && /^[\da-f]{6}$/i.test(value)) {
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
      description.append(renderLink(value, String(value)));
    } else {
      description.textContent = String(value);
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
    ].includes(name) || value === null || value === "") continue;
    const term = document.createElement("dt");
    term.textContent = name;
    const description = document.createElement("dd");
    if (name === "route_url") {
      description.append(renderLink(value, String(value)));
    } else {
      description.textContent = name === "route_type" ? routeTypeLabel(value) : String(value);
    }
    if (name === "route_color" && typeof value === "string" && /^[\da-f]{6}$/i.test(value)) {
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
    showRouteMap(route, localIndex < 0 ? "all" : localIndex);
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
  const addProperty = (name: string, value: string | number | null): void => {
    const term = document.createElement("dt");
    term.textContent = name;
    const description = document.createElement("dd");
    if (value === null || value === "") {
      description.textContent = value === null ? "Not provided" : "(empty)";
      description.className = "not-provided";
    } else {
      description.append(name === "stop_url" ? renderLink(value, String(value)) : document.createTextNode(String(value)));
    }
    if (popup && name === "stop_id") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "route-link";
      button.textContent = "more";
      button.setAttribute("aria-label", "Open stop details");
      button.addEventListener("click", () => showStop(stop));
      description.append(" ", button);
    }
    if (!popup && name === "stop_lat" && mapStop(stop).coordinate) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "route-map-icon";
      button.textContent = "🗺️";
      button.title = "Show stop on map";
      button.setAttribute("aria-label", `Show stop ${stop.fields.stop_name || stop.fields.stop_id || "details"} on map`);
      button.addEventListener("click", () => showStopOnMap(stop));
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
        button.addEventListener("click", () => popup ? showRouteMap(route, "all") : showRoute(route));
        item.append(button);
      } else {
        item.textContent = route ? routeListLabel(route) : id;
      }
      if (route) {
        const mapButton = document.createElement("button");
        mapButton.type = "button";
        mapButton.className = "route-map-icon";
        mapButton.textContent = "🗺️";
        mapButton.title = `Show route ${routeListLabel(route)} on map`;
        mapButton.setAttribute("aria-label", `Show route ${routeListLabel(route)} on map`);
        mapButton.addEventListener("click", () => showRouteMap(route, "all"));
        item.append(" ", mapButton);
      }
      routeList.append(item);
    }
    description.append(routeList);
  }
  list.append(term, description);
  content.append(list);
  return content;
}

function showStop(stop: GtfsRow<"stops.txt">): void {
  stopHeading.textContent = `Stop details: ${stop.fields.stop_name || stop.fields.stop_id || "Stop"}`;
  stopProperties.replaceChildren(stopContent(stop));
  viewer.hidden = true;
  mapPanel.hidden = true;
  routeDetail.hidden = true;
  tripDetail.hidden = true;
  dateSchedule.hidden = true;
  warningsView.hidden = true;
  stopDetail.hidden = false;
  stopHeading.focus();
  pushViewState();
}

function showStopOnMap(stop: GtfsRow<"stops.txt">): void {
  const position = mapStop(stop).coordinate;
  if (!position) return;
  const stopsTable = feed?.tables.find((table) => table.kind === "stops.txt");
  if (!stopsTable) return;
  const index = feed?.tables.indexOf(stopsTable) ?? -1;
  if (index >= 0) tableSelect.selectedIndex = index;
  filteredTable = undefined;
  resetTableFilter();
  tableSearch.value = "";
  showStopsMap();
  mapView?.showStopPopup(stop.fields.stop_id ?? "", position);
}

const tableCellRenderers: Record<string, CellRenderer> = {
  "routes.txt": renderRoutesCell,
  "agency.txt": (column, value) => column === "agency_url" || column === "agency_fare_url"
    ? renderUrlCell(column, value) : renderGenericCell(column, value),
  "stops.txt": (column, value) => column === "stop_url"
    ? renderUrlCell(column, value) : renderGenericCell(column, value),
};

function showTrip(trip: GtfsRow<"trips.txt">): void {
  if (!feed) return;
  currentTrip = trip;
  const tripId = trip.fields.trip_id || "Trip";
  const route = trip.fields.route_id ? routesById.get(trip.fields.route_id) : undefined;
  const tripName = trip.fields.trip_headsign && trip.fields.trip_short_name
    && trip.fields.trip_headsign !== trip.fields.trip_short_name
    ? `${trip.fields.trip_headsign} · ${trip.fields.trip_short_name}`
    : trip.fields.trip_headsign || trip.fields.trip_short_name || tripId;
  tripHeading.textContent = `Trip details: ${tripName}`;
  if (route) {
    const routeName = [route.fields.route_short_name, route.fields.route_long_name]
      .filter((value): value is string => Boolean(value))
      .join(" — ");
    tripHeading.textContent += ` · ${routeName || route.fields.route_id || "Route"}`;
  } else if (trip.fields.route_id) {
    tripHeading.textContent += ` · Route ${trip.fields.route_id}`;
  }

  const properties = document.createElement("dl");
  properties.className = "route-properties";
  for (const [name, value] of [...Object.entries(trip.fields), ...Object.entries(trip.unrecognizedColumns)]) {
    const term = document.createElement("dt");
    term.textContent = name;
    const description = document.createElement("dd");
    if (value === null || value === "") {
      description.textContent = value === null ? "Not provided" : "(empty)";
      description.className = "not-provided";
    } else if (name === "route_id") {
      const route = routesById.get(String(value));
      description.append(route ? routeStopRouteButton(route) : document.createTextNode(String(value)));
    } else if (name === "service_id") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "route-link";
      button.textContent = String(value);
      button.addEventListener("click", () => showServiceTable(String(value)));
      description.append(button);
    } else if (name === "shape_id") {
      const shapeTable = feed.tables.find((table) => table.kind === "shapes.txt");
      if (shapeTable?.kind === "shapes.txt") {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "route-link";
        button.textContent = String(value);
        button.addEventListener("click", () => showFilteredTable(
          { ...shapeTable, rows: shapeTable.rows.filter((row) => row.fields.shape_id === String(value)) },
          `Showing rows for shape ${value}.`,
        ));
        description.append(button);
      } else {
        description.textContent = String(value);
      }
    } else {
      description.textContent = String(value);
    }
    properties.append(term, description);
  }
  if (trip.extraValues.length) {
    const term = document.createElement("dt");
    term.textContent = "Extra values";
    const description = document.createElement("dd");
    description.textContent = JSON.stringify(trip.extraValues);
    properties.append(term, description);
  }
  tripProperties.replaceChildren(properties);

  tripRouteDetails.open = false;
  tripRouteSummary.replaceChildren();
  tripRouteProperties.replaceChildren();
  if (route) {
    const label = `${route.fields.route_id || "Route"} — ${route.fields.route_short_name || route.fields.route_long_name || ""}`.replace(/ — $/, "");
    tripRouteSummary.textContent = `Route: ${label}`;
    tripRouteSummary.prepend(routeStopRouteButton(route), document.createTextNode(" "));
  } else {
    tripRouteSummary.textContent = "Route";
  }
  if (route) {
    const routeProperties = document.createElement("dl");
    routeProperties.className = "route-properties";
    for (const [name, value] of Object.entries(route.fields)) {
      const term = document.createElement("dt");
      term.textContent = name;
      const description = document.createElement("dd");
      if (value === null || value === "") {
        description.textContent = value === null ? "Not provided" : "(empty)";
        description.className = "not-provided";
      } else if (name === "route_id") {
        description.append(routeStopRouteButton(route));
      } else if (name === "agency_id") {
        description.append(agencyLink(String(value), true));
      } else if (name === "route_url") {
        description.append(renderLink(value, String(value)));
      } else {
        description.textContent = name === "route_type" ? routeTypeLabel(value) : String(value);
      }
      routeProperties.append(term, description);
    }
    tripRouteProperties.append(routeProperties);
  }

  const serviceId = trip.fields.service_id;
  tripCalendar.replaceChildren();
  tripExceptions.replaceChildren();
  if (serviceId) {
    const calendar = feed.indexes.calendarByServiceId.get(serviceId);
    const exceptions = feed.indexes.calendarDatesByServiceId.get(serviceId) ?? [];
    const calendarList = document.createElement("table");
    calendarList.className = "trip-calendar-table";
    const head = document.createElement("tr");
    for (const name of ["Date range", "Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = name;
      head.append(th);
    }
    calendarList.append(head);

    if (calendar) {
      const dayFields = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
      const start = gtfsDateToIso(calendar.fields.start_date);
      const end = gtfsDateToIso(calendar.fields.end_date);
      const row = document.createElement("tr");
      const range = document.createElement("td");
      range.textContent = `${start || "Not provided"} — ${end || "Not provided"}`;
      row.append(range);
      for (const day of dayFields) {
        const cell = document.createElement("td");
        cell.textContent = calendar.fields[day] === 1 ? "●" : "";
        cell.className = calendar.fields[day] === 1 ? "trip-calendar-active" : "";
        row.append(cell);
      }
      calendarList.append(row);
    }
    if (!calendar) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 8;
      cell.textContent = "No calendar.txt row";
      row.append(cell);
      calendarList.append(row);
    }
    tripCalendar.append(calendarList);

    if (exceptions.length) {
      const heading = document.createElement("h4");
      heading.textContent = "Exceptions";
      const list = document.createElement("ul");
      for (const exception of exceptions) {
        const item = document.createElement("li");
        const date = gtfsDateToIso(exception.fields.date);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "schedule-exception-button";
        button.textContent = `${date ? formatDateWithWeekday(date) : exception.fields.date} — ${exception.fields.exception_type === 1 ? "Added" : exception.fields.exception_type === 2 ? "Removed" : "Unknown"}`;
        if (route && date) button.addEventListener("click", () => showDateSchedule(route, date));
        item.append(button);
        list.append(item);
      }
      tripExceptions.append(heading, list);
    }
  } else {
    tripCalendar.textContent = "No service_id provided";
  }

  const frequencies = feed.tables.find((table) => table.kind === "frequencies.txt");
  tripFrequencies.replaceChildren();
  const rows = tripId === "Trip" ? [] : frequencies?.kind === "frequencies.txt"
    ? frequencies.rows.filter((row) => row.fields.trip_id === trip.fields.trip_id) : [];
  if (rows.length) {
    const table = document.createElement("table");
    const head = document.createElement("tr");
    for (const name of ["start_time", "end_time", "headway_secs", "exact_times"]) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = name;
      head.append(th);
    }
    table.append(head);
    for (const row of rows) {
      const tr = document.createElement("tr");
      for (const name of ["start_time", "end_time", "headway_secs", "exact_times"] as const) {
        const td = document.createElement("td");
        td.textContent = row.fields[name] === null ? "" : String(row.fields[name]);
        tr.append(td);
      }
      table.append(tr);
    }
    tripFrequencies.append(table);
  } else {
    tripFrequencies.textContent = "No frequency rows";
  }

  const stopRows = trip.fields.trip_id
    ? [...(feed.indexes.stopTimesByTripId.get(trip.fields.trip_id) ?? [])].sort((left, right) =>
      (left.fields.stop_sequence ?? Infinity) - (right.fields.stop_sequence ?? Infinity))
    : [];
  tripStopHelp.replaceChildren("Select a stop to calculate fares to every following stop.");
  if (trip.fields.trip_id) {
    const stopTimesTable = feed.tables.find((table) => table.kind === "stop_times.txt");
    if (stopTimesTable?.kind === "stop_times.txt") {
      const tableButton = document.createElement("button");
      tableButton.type = "button";
      tableButton.className = "route-link";
      tableButton.textContent = "View filtered stop_times.txt";
      tableButton.addEventListener("click", () => showFilteredTable(
        {
          ...stopTimesTable,
          rows: stopTimesTable.rows.filter((row) => row.fields.trip_id === trip.fields.trip_id),
        },
        `Showing stop_times.txt rows for trip ${trip.fields.trip_id}.`,
      ));
      tripStopHelp.append(" ", tableButton);
    }
  }
  tripStopList.replaceChildren();
  tripFares.replaceChildren();
  for (const [index, stopTime] of stopRows.entries()) {
    const stopId = stopTime.fields.stop_id;
    const stop = stopId ? stopsById.get(stopId) : undefined;
    const item = document.createElement("li");
    item.className = "trip-stop-item";
    item.dataset.stopIndex = String(index);
    const row = document.createElement("div");
    row.className = "trip-stop-row";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "trip-stop-button";
    button.dataset.stopIndex = String(index);
    const stopName = stop?.fields.stop_name || stopId || "Location";
    const stopLink = document.createElement("span");
    stopLink.className = "trip-stop-name";
    if (stop) {
      const link = document.createElement("button");
      link.type = "button";
      link.className = "route-link";
      link.textContent = `${stopName}${stopId ? ` (${stopId})` : ""}`;
      link.addEventListener("click", () => showStop(stop));
      stopLink.append(link);
    } else {
      stopLink.textContent = `${stopName}${stopId ? ` (${stopId})` : ""}`;
    }
    const time = document.createElement("span");
    time.className = "trip-stop-time";
    const arrival = stopTime.fields.arrival_time;
    const departure = stopTime.fields.departure_time;
    time.textContent = arrival && departure && arrival !== departure
      ? `${arrival} — ${departure}`
      : departure || arrival || "";
    button.append(stopLink, time);
    button.setAttribute("aria-selected", "false");
    button.addEventListener("click", () => selectTripStop(trip, stopRows, index, button));
    row.append(button);
    const fare = document.createElement("span");
    fare.className = "trip-inline-fare";
    row.append(fare);
    if (stop) {
      const position = mapStop(stop).coordinate;
      const mapButton = document.createElement("button");
      mapButton.type = "button";
      mapButton.className = "route-map-icon";
      mapButton.textContent = "🗺️";
      mapButton.title = position ? "Open stop on map" : "Stop location unavailable";
      mapButton.setAttribute("aria-label", `Open stop ${stopName} on map`);
      mapButton.disabled = !position;
      mapButton.addEventListener("click", () => showStopOnMap(stop));
      row.append(mapButton);
    } else {
      row.append(document.createElement("span"));
    }
    item.append(row);
    tripStopList.append(item);
  }
  if (!stopRows.length) tripStopList.append(document.createTextNode("No stop times"));

  viewer.hidden = true;
  routeDetail.hidden = true;
  stopDetail.hidden = true;
  dateSchedule.hidden = true;
  warningsView.hidden = true;
  mapPanel.hidden = true;
  tripDetail.hidden = false;
  tripHeading.focus();
  pushViewState();
}

function showServiceTable(serviceId: string): void {
  if (!feed) return;
  const calendar = feed.tables.find((table) => table.kind === "calendar.txt");
  if (calendar?.kind === "calendar.txt") {
    const rows = calendar.rows.filter((row) => row.fields.service_id === serviceId);
    if (rows.length) {
      showFilteredTable({ ...calendar, rows }, `Showing calendar rows for service ${serviceId}.`);
      return;
    }
  }
  const calendarDates = feed.tables.find((table) => table.kind === "calendar_dates.txt");
  if (calendarDates?.kind === "calendar_dates.txt") {
    const rows = calendarDates.rows.filter((row) => row.fields.service_id === serviceId);
    if (rows.length) {
      showFilteredTable({ ...calendarDates, rows }, `Showing calendar exceptions for service ${serviceId}.`);
    }
  }
}

function routeStopRouteButton(route: GtfsRow<"routes.txt">): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "route-link";
  button.textContent = `${route.fields.route_id || ""}${route.fields.route_short_name || route.fields.route_long_name
    ? ` (${route.fields.route_short_name || route.fields.route_long_name})` : ""}`.replace(/^\s*\(\)/, "");
  button.addEventListener("click", () => showRoute(route));
  return button;
}

function selectTripStop(
  trip: GtfsRow<"trips.txt">,
  stopRows: GtfsRow<"stop_times.txt">[],
  selectedIndex: number,
  selectedButton: HTMLButtonElement,
): void {
  if (!feed) return;
  tripStopList.querySelectorAll<HTMLButtonElement>(".trip-stop-button")
    .forEach((button) => button.setAttribute("aria-selected", String(button === selectedButton)));
  tripStopList.querySelectorAll<HTMLElement>(".trip-inline-fare")
    .forEach((fare) => { fare.textContent = ""; });
  const originId = stopRows[selectedIndex]?.fields.stop_id;
  if (!originId) {
    tripFares.textContent = "This stop has no stop_id, so fares cannot be calculated.";
    return;
  }
  const destinations = stopRows.slice(selectedIndex + 1).map((row) => row.fields.stop_id);
  const fares = getTripFares(feed, trip, originId, destinations);
  if (!fares.length) {
    tripFares.textContent = "No following stops.";
    return;
  }
  tripFares.textContent = "";
  for (const [fareIndex, fare] of fares.entries()) {
    const fareLabel = tripStopList.querySelector<HTMLElement>(
      `.trip-stop-item[data-stop-index="${selectedIndex + fareIndex + 1}"] .trip-inline-fare`,
    );
    if (!fareLabel) continue;
    const name = fare.productName || fare.fareId || "No fare found";
    fareLabel.textContent = fare.price === null
      ? name
      : `${name}: ${fare.price}${fare.currency ? ` ${fare.currency}` : ""}`;
  }
}

function showDateSchedule(route: GtfsRow<"routes.txt">, date: string): void {
  if (!feed) return;
  currentScheduleRoute = route;
  let isoDate = gtfsDateToIso(date) || (/^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "");
  if (!isoDate) {
    const calendar = [...feed.indexes.calendarByServiceId.values()][0];
    isoDate = gtfsDateToIso(calendar?.fields.start_date ?? null)
      || gtfsDateToIso(feed.tables.find((table) => table.kind === "feed_info.txt")?.kind === "feed_info.txt"
        ? (feed.tables.find((table) => table.kind === "feed_info.txt") as GtfsTable & { kind: "feed_info.txt" }).rows[0]?.fields.feed_start_date
        : null)
      || "";
  }
  scheduleDate.value = isoDate;
  const title = route.fields.route_short_name || route.fields.route_long_name || route.fields.route_id;
  dateScheduleHeading.textContent = `Date-specific schedule: ${title || "Route"}`;
  renderDateSchedule();
  viewer.hidden = true;
  routeDetail.hidden = true;
  stopDetail.hidden = true;
  tripDetail.hidden = true;
  warningsView.hidden = true;
  mapPanel.hidden = true;
  dateSchedule.hidden = false;
  dateScheduleHeading.focus();
  pushViewState();
}

function renderDateSchedule(): void {
  if (!feed || !currentScheduleRoute) return;
  const routeId = currentScheduleRoute.fields.route_id;
  if (!routeId) {
    scheduleSummary.textContent = "This route has no route_id.";
    scheduleVariants.replaceChildren();
    return;
  }
  const date = scheduleDate.value;
  const gtfsDate = isoDateToGtfs(date);
  const { variants } = getRouteVariants(feed, routeId);
  scheduleVariants.replaceChildren();
  let scheduledTripCount = 0;
  for (const variant of variants) {
    const schedule = getDateSchedule(feed, variant, date);
    scheduledTripCount += schedule.tripCount;
    const section = document.createElement("section");
    const heading = document.createElement("h3");
    const firstStop = variant.stops[0];
    const lastStop = variant.stops.length > 1 ? variant.stops[variant.stops.length - 1] : null;
    const names = (id: string | null) => id ? stopsById.get(id)?.fields.stop_name || id : "";
    heading.textContent = [variant.tripHeadsign, variant.tripShortName,
      [names(firstStop), names(lastStop)].filter(Boolean).join(" → ")].filter(Boolean).join(" · ")
      || "Variant";
    section.append(heading);
    if (!schedule.rows.length) {
      const message = document.createElement("p");
      message.textContent = "No departures run for this route variant on the selected date.";
      section.append(message);
    } else {
      const table = document.createElement("div");
      table.className = "timetable";
      table.style.setProperty("--timetable-columns", "1");
      for (const row of schedule.rows) {
        const line = document.createElement("div");
        line.className = "timetable-row";
        const hour = document.createElement("span");
        hour.className = "timetable-hour";
        hour.textContent = `${row.hour} `;
        line.append(hour);
        const column = document.createElement("span");
        column.className = "timetable-column";
        for (const departure of row.departures) {
          const minute = document.createElement("button");
          minute.type = "button";
          minute.className = "schedule-date-button";
          minute.textContent = String(departure.minute).padStart(2, "0");
          minute.title = departure.headsign || departure.shortName || departure.tripId || "Open trip";
          if (departure.tripId) {
            const trip = feed.indexes.tripsById.get(departure.tripId);
            if (trip) minute.addEventListener("click", () => showTrip(trip));
          }
          column.append(minute, " ");
        }
        line.append(column);
        table.append(line);
      }
      section.append(table);
    }
    scheduleVariants.append(section);
  }
  scheduleSummary.textContent = gtfsDate
    ? `${scheduledTripCount} scheduled ${scheduledTripCount === 1 ? "trip" : "trips"} run on ${date}.`
    : "Select a valid date.";
  if (!variants.length) {
    scheduleSummary.textContent = "No route variants could be formed.";
  }
}

function showRoute(route: GtfsRow<"routes.txt">): void {
  if (!feed) return;
  const activeFeed = feed;
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
      description.append(agencyLink(String(value), true));
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
  const trips = route.fields.route_id
    ? feed.indexes.tripsByRouteId.get(route.fields.route_id) ?? []
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
  const stopNames = new Map([...stopsById].map(([id, stop]) => [id, stop.fields.stop_name]));
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
      .map((id) => id == null ? "" : stopNames.get(id) ?? "")
      .filter(Boolean)
      .join(" → ");
    const headingParts = [variant.tripHeadsign, variant.tripShortName, endpoints].filter(Boolean);
    heading.textContent = headingParts.join(" · ") || `Variant ${index + 1}`;
    const mapButton = document.createElement("button");
    mapButton.type = "button";
    mapButton.className = "route-map-icon";
    mapButton.textContent = "🗺️";
    mapButton.title = "View variant on map";
    mapButton.setAttribute("aria-label", `View ${heading.textContent} on map`);
    mapButton.addEventListener("click", () => showRouteMap(route, index));
    heading.append(" ", mapButton);
    section.append(heading);
    const properties = document.createElement("dl");
    properties.className = "route-properties";
    for (const [name, value, missing] of [
      ["Shape ID", variant.shapeId, !variant.shapeId],
      ["Trip headsign", variant.tripHeadsign, variant.tripHeadsign === null || variant.tripHeadsign === ""],
      ["Trip short name", variant.tripShortName, variant.tripShortName === null || variant.tripShortName === ""],
      ["Direction ID", variant.directionIds.map((id) => id === null ? "Not provided" : String(id)).join(", "),
        variant.directionIds.every((id) => id === null)],
    ] as const) {
      const term = document.createElement("dt");
      term.textContent = name;
      const description = document.createElement("dd");
      description.textContent = value === null ? "Not provided" : value === "" ? "(empty)" : String(value);
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
    const expanders = document.createElement("div");
    expanders.className = "variant-expanders";
    const stopDetails = document.createElement("details");
    stopDetails.className = "variant-expander";
    const stopSummary = document.createElement("summary");
    stopSummary.textContent = `Stops (${variant.stops.length})`;
    stopDetails.append(stopSummary);
    if (variant.stops.length === 0) {
      const message = document.createElement("p");
      message.textContent = "No stop times found for this variant.";
      stopDetails.append(message);
    } else {
      const stops = document.createElement("ol");
      for (const stopId of variant.stops) {
        const item = document.createElement("li");
        item.append(routeStopLink(stopId, stopNames));
        stops.append(item);
        uniqueStops.add(stopId);
      }
      stopDetails.append(stops);
    }
    expanders.append(stopDetails);

    const timetableDetails = document.createElement("details");
    timetableDetails.className = "variant-expander variant-timetable";
    const timetableSummary = document.createElement("summary");
    timetableSummary.textContent = "Timetable";
    timetableDetails.append(timetableSummary);
    let timetableLoaded = false;
    timetableDetails.addEventListener("toggle", () => {
      if (!timetableDetails.open || timetableLoaded) return;
      timetableLoaded = true;
      const timetable = getVariantTimetable(activeFeed, variant);
      if (timetable.rows.length === 0) {
        const message = document.createElement("p");
        message.textContent = "No timetable times found for this variant.";
        timetableDetails.append(message);
        return;
      }
      const table = document.createElement("div");
      table.className = "timetable";
      table.style.setProperty("--timetable-columns", String(Math.max(timetable.popularDays.length, 1)));
      const headings = document.createElement("div");
      headings.className = "timetable-headings";
      headings.append(document.createElement("span"));
      for (const days of timetable.popularDays) {
        const heading = document.createElement("span");
        heading.className = "timetable-popular-days";
        if (timetable.popularDays.length === 2) heading.classList.add("timetable-day-column");
        heading.textContent = formatTimetableDayRange(days);
        headings.append(heading);
      }
      table.append(headings);
      for (const row of timetable.rows) {
        const line = document.createElement("div");
        line.className = "timetable-row";
        const hour = document.createElement("span");
        hour.className = "timetable-hour";
        hour.textContent = `${String(row.hour)} `;
        line.append(hour);
        for (const popularDays of timetable.popularDays) {
          const column = document.createElement("span");
          column.className = "timetable-column";
          if (timetable.popularDays.length === 2) column.classList.add("timetable-day-column");
          for (const departure of row.departures) {
            if (departure.days && !departure.days.some((day) => popularDays.includes(day))) continue;
            const minute = document.createElement("span");
            minute.className = "timetable-minute";
            minute.textContent = String(departure.minute).padStart(2, "0");
            column.append(minute, " ");
          }
          line.append(column);
        }
        table.append(line);
      }
      timetableDetails.append(table);
      if (timetable.exceptionDates.length > 0) {
        const exceptions = document.createElement("p");
        exceptions.className = "timetable-exception-dates";
        exceptions.append("Exceptions: ");
        for (const [index, date] of timetable.exceptionDates.entries()) {
          if (index) exceptions.append(", ");
          const iso = gtfsDateToIso(date);
          const button = document.createElement("button");
          button.type = "button";
          button.className = "schedule-exception-button";
          button.textContent = date;
          button.title = "Open date-specific schedule";
          button.disabled = !iso;
          if (iso) button.addEventListener("click", () => showDateSchedule(route, iso));
          exceptions.append(button);
        }
        timetableDetails.append(exceptions);
      }
    });
    expanders.append(timetableDetails);
    section.append(expanders);
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
  tripDetail.hidden = true;
  dateSchedule.hidden = true;
  warningsView.hidden = true;
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
  button.addEventListener("click", () => showStop(stop));
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
  tripDetail.hidden = true;
  dateSchedule.hidden = true;
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
    const fields: Record<string, string | number | null> = values.fields;
    for (const column of recognized) {
      const value = fields[column];
      const referencedRoute = getReferencedRoute(routesById, table.kind, column, value);
      if (column === "agency_id" && value && agenciesById.has(String(value))) {
        const cell = document.createElement("td");
        cell.append(agencyLink(String(value)));
        row.append(cell);
      } else if (table.kind === "fare_rules.txt" && (column === "origin_id" || column === "destination_id" || column === "contains_id")
        && value && feed?.tables.some((candidate) => candidate.kind === "stops.txt")) {
        const cell = document.createElement("td");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "route-link";
        button.textContent = String(value);
        button.setAttribute("aria-label", `Show stops in zone ${value}`);
        button.addEventListener("click", () => showZoneStops(String(value)));
        cell.append(button);
        row.append(cell);
      } else if (referencedRoute) {
        const cell = document.createElement("td");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "route-link";
        button.textContent = String(value);
        button.addEventListener("click", () => showRoute(referencedRoute));
        cell.append(button);
        row.append(cell);
      } else if (column === "service_id" && value) {
        const cell = document.createElement("td");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "route-link";
        button.textContent = String(value);
        button.addEventListener("click", () => showServiceTable(String(value)));
        cell.append(button);
        row.append(cell);
      } else if (column === "trip_id" && value && feed?.indexes.tripsById.get(String(value))) {
        const cell = document.createElement("td");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "route-link";
        button.textContent = String(value);
        button.addEventListener("click", () => showTrip(feed!.indexes.tripsById.get(String(value))!));
        cell.append(button);
        row.append(cell);
      } else if (column === "stop_id" && value && feed?.indexes.stopsById.get(String(value))) {
        const cell = document.createElement("td");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "route-link";
        button.textContent = String(value);
        button.addEventListener("click", () => showStop(feed!.indexes.stopsById.get(String(value))!));
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
      button.addEventListener("click", () => showRouteMap(route));
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
        if (position) mapView?.showStopPopup(stop.fields.stop_id ?? "", position);
      });
      const more = document.createElement("button");
      more.type = "button";
      more.className = "route-link";
      more.textContent = "More";
      more.setAttribute("aria-label", `Open stop ${stop.fields.stop_name || stop.fields.stop_id || "details"}`);
      more.addEventListener("click", () => showStop(stop));
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

function openMap(title: string): void {
  mapView?.remove();
  mapView = undefined;
  viewer.hidden = true;
  routeDetail.hidden = true;
  stopDetail.hidden = true;
  tripDetail.hidden = true;
  dateSchedule.hidden = true;
  warningsView.hidden = true;
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
      true,
      true,
      false,
      false,
      false,
      false,
      () => {
        if (mapMode !== "route") {
          mapView?.focusSelection(null, null);
          return;
        }
        const routeId = mapRoute.value === "all"
          ? null
          : mapRoutes[Number(mapRoute.value)]?.fields.route_id ?? null;
        const variantIndex = mapVariant.value === "all" ? null : Number(mapVariant.value);
        mapView?.focusSelection(routeId, variantIndex);
      },
    );
    mapRasterBlackAndWhite.checked = mapView.rasterBlackAndWhiteEnabled;
    mapRouteColors.checked = mapView.routeColorsEnabledState;
    mapRandomColors.checked = mapView.randomColorsEnabledState;
    mapAllStops.checked = mapView.allStopsEnabledState;
    mapReducedStops.checked = mapView.reducedStopSizeEnabled;
    mapStopOrder.checked = mapView.stopOrderEnabledState;
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
  if (!feed.tables.some((table) => table.kind === "stops.txt")) return;
  mapSidebar.hidden = true;
  mapVariantControls.hidden = true;
  mapMode = "stops";
  openMap("Stops map");
  if (filteredTable?.kind === "stops.txt" || feed.tables[tableSelect.selectedIndex]?.kind === "stops.txt") {
    renderStopsMap();
  } else {
    const stopsTable = feed.tables.find((table) => table.kind === "stops.txt");
    if (stopsTable) {
      const matching = new Set(getMatchingRows(stopsTable, ""));
      const stops = stopsTable.rows.filter((row) => matching.has(row)).map(mapStop);
      const mappable = stops.filter((stop) => stop.coordinate).length;
      mapSummary.textContent = `${mappable} of ${stops.length} matching stops have valid coordinates.`;
      mapClearFilter.hidden = true;
      mapView?.update(stops, []);
    }
  }
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

function showRouteMap(route: GtfsRow<"routes.txt">, variantIndex: number | "all" = 0): void {
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
  openMap(title ? `Route map: ${title}` : "Route map");
  renderRouteMap();
  mapMode = "route";
  pushViewState();
}

function showAllRoutesMap(): void {
  if (!feed) return;
  const table = filteredTable?.kind === "routes.txt"
    ? filteredTable
    : feed.tables.find((candidate) => candidate.kind === "routes.txt");
  if (!table) return;
  prepareRouteMap(getMatchingRows(table, tableSearch.value) as GtfsRow<"routes.txt">[]);
  mapRoute.value = "all";
  populateMapVariants();
  openMap("Routes map");
  renderRouteMap();
  mapMode = "routes";
  pushViewState();
}

function prepareRouteMap(routes: GtfsRow<"routes.txt">[]): void {
  if (!feed) return;
  const currentFeed = feed;
  const timesByRoute = new Map<string, GtfsRow<"stop_times.txt">[]>();
  for (const [routeId, trips] of currentFeed.indexes.tripsByRouteId) {
    for (const trip of trips) {
      if (trip.fields.trip_id) {
        const rows = timesByRoute.get(routeId) ?? [];
        rows.push(...(currentFeed.indexes.stopTimesByTripId.get(trip.fields.trip_id) ?? []));
        timesByRoute.set(routeId, rows);
      }
    }
  }
  mapStopsIndex = new Map();
  for (const [stopId, row] of currentFeed.indexes.stopsById) {
    mapStopsIndex.set(stopId, mapStop(row));
  }
  mapShapesIndex = currentFeed.indexes.shapesById;
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
      ...currentFeed,
      tables: currentFeed.tables.map((candidate) => {
        if (candidate.kind === "trips.txt") return { ...candidate, rows: currentFeed.indexes.tripsByRouteId.get(id) ?? [] };
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
    section.dataset.variantIndex = String(index);
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
      mapSettings.open = false;
      pinnedVariant = pinnedVariant === index ? null : index;
      clearHighlight.hidden = pinnedVariant === null;
      for (const button of mapSidebar.querySelectorAll<HTMLButtonElement>(".map-variant-label")) {
        button.setAttribute("aria-pressed", String(button === variantButton && pinnedVariant !== null));
      }
      mapView?.highlightVariant(pinnedVariant);
      mapView?.setStopOrderVariant(pinnedVariant);
      section.scrollIntoView({ block: "nearest", behavior: "smooth" });
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
        details.addEventListener("click", () => showStop(row));
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
  const displayedStops = mapView?.allStopsEnabledState
    ? (feed.tables.find((table) => table.kind === "stops.txt")?.rows ?? []).map(mapStop)
    : allStops;
  mapView?.update(displayedStops.map((stop) => ({
    ...stop,
    hoverLabel: stop.id && stopLabels.has(stop.id)
      ? `${stop.name || stop.id} — ${stopLabels.get(stop.id)!.length > 5
        ? `${stopLabels.get(stop.id)!.length} stops`
        : `stop ${stopLabels.get(stop.id)!.join(", ")}`}`
      : undefined,
  })), lines, !preserveMapView);
  mapView?.setStopOrderVariant(selected.length === 1 ? selected[0] : null);
  mapView?.setSelectedVariant(selected.length === 1 ? selected[0] : null);
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
      if ("progress" in event.data) {
        const progress = event.data.progress;
        if (progress.phase === "extracting") {
          loadingProgress.value = progress.completed ? 10 : 5;
          status.textContent = progress.completed ? "Archive extracted." : "Extracting GTFS archive…";
        } else if (progress.phase === "indexing") {
          loadingProgress.value = progress.completed ? 100 : 95;
          status.textContent = progress.completed ? "GTFS indexes built." : "Building GTFS indexes…";
        } else {
          const percent = progress.total > 0
            ? 10 + Math.round(progress.completed / progress.total * 85)
            : 10;
          loadingProgress.value = percent;
          status.textContent = progress.fileName
            ? `Loading ${progress.fileName}… (${progress.completed}/${progress.total})`
            : "Parsing GTFS files…";
        }
        return;
      }
      if ("error" in event.data) {
        worker.terminate();
        reject(new Error(event.data.error));
        return;
      }
      loadingProgress.value = 100;
      worker.terminate();
      resolve(event.data.feed);
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
  loadingSpinner.hidden = false;
  loadingProgress.hidden = false;
  loadingProgress.value = 0;
  status.textContent = "Loading feed…";
  loadPanel.classList.remove("loaded");
  viewer.hidden = true;
  routeDetail.hidden = true;
  stopDetail.hidden = true;
  tripDetail.hidden = true;
  dateSchedule.hidden = true;
  mapPanel.hidden = true;
  warningsView.hidden = true;
  if (historyControls) historyControls.hidden = true;
  mapView?.remove();
  mapView = undefined;
  viewHistory.clear();
  warningTablesInitialized = false;
  resetTableFilter();
  tableSearch.value = "";
  currentRoute = undefined;
  feed = undefined;
  routesById.clear();
  agenciesById.clear();

  try {
    feed = await loadFeed(file);
    warningCollector.replace(feed.warnings ?? []);
    feed.warnings = [...warningCollector.all];
    if (historyControls) historyControls.hidden = false;
    routesById = feed.indexes.routesById;
    agenciesById = feed.indexes.agenciesById;
    stopsById = feed.indexes.stopsById;
    routesByStop = feed.indexes.routesByStopId;
    tableSelect.replaceChildren(...feed.tables.map((table) => {
      const option = document.createElement("option");
      option.textContent = table.name;
      return option;
    }));
    feedSummary.textContent = `${feed.tables.length} ${feed.tables.length === 1 ? "table" : "tables"}`;
    page = 0;
    renderSelectedTable();
    pushViewState();
    viewer.hidden = false;
    loadPanel.classList.add("loaded");
    status.textContent = "Feed loaded.";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Could not load the feed.";
  } finally {
    loadingSpinner.hidden = true;
    loadingProgress.hidden = true;
    input.disabled = false;
    submit.disabled = false;
  }
});

element<HTMLButtonElement>("#agency-dialog-close").addEventListener("click", () => agencyDialog.close());
stopsMapButton.addEventListener("click", showStopsMap);
routesMapButton.addEventListener("click", showAllRoutesMap);
routeMapButton.addEventListener("click", () => {
  if (currentRoute) showRouteMap(currentRoute);
});
mapRoute.addEventListener("change", () => {
  mapSettings.open = false;
  populateMapVariants();
  renderRouteMap();
  pushViewState();
});
mapRouteReset.addEventListener("click", () => {
  mapSettings.open = false;
  mapRoute.value = "all";
  populateMapVariants();
  renderRouteMap();
});
mapVariant.addEventListener("change", () => {
  renderRouteMap();
  mapSettings.open = false;
  if (mapVariant.value !== "all") {
    const section = [...mapSidebar.querySelectorAll<HTMLElement>("section[data-variant-index]")]
      .find((candidate) => candidate.dataset.variantIndex === mapVariant.value);
    section?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  pushViewState();
});
mapVariantReset.addEventListener("click", () => {
  mapSettings.open = false;
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
mapAllStops.addEventListener("change", () => {
  mapView?.setAllStopsEnabled(mapAllStops.checked);
  renderRouteMap(true);
});
mapReducedStops.addEventListener("change", () => mapView?.setStopSizeReduced(mapReducedStops.checked));
mapStopOrder.addEventListener("change", () => mapView?.setStopOrderEnabled(mapStopOrder.checked));
mapBaseLayer.addEventListener("change", () => {
  mapView?.setBaseLayer(mapBaseLayer.value as MapBaseLayerId);
});
mapRasterBlackAndWhite.addEventListener("change", () => {
  mapView?.setRasterBlackAndWhite(mapRasterBlackAndWhite.checked);
});
mapCanvas.addEventListener("pointerdown", () => {
  mapSettings.open = false;
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
    { ...table, rows: feed.indexes.tripsByRouteId.get(routeId) ?? [] },
    `Showing trips for route ${routeId}.`,
  );
});

routeDateSchedule.addEventListener("click", () => {
  if (currentRoute) showDateSchedule(currentRoute, scheduleDate.value);
});

scheduleDate.addEventListener("change", () => {
  renderDateSchedule();
  pushViewState();
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

function formatWarningMessage(warning: GtfsWarning): string {
  let message = WARNING_DESCRIPTIONS[warning.type].messageTemplate;
  const parameters = {
    ...warning.parameters,
    row: warning.csvRowNumber ?? warning.parameters.row,
    values: Array.isArray(warning.parameters.values)
      ? warning.parameters.values.map((value) => JSON.stringify(value)).join(", ")
      : warning.parameters.values,
  };
  for (const [key, value] of Object.entries(parameters)) {
    message = message.split(`{${key}}`).join(String(value ?? ""));
  }
  return message;
}

function showWarnings(): void {
  viewer.hidden = true;
  routeDetail.hidden = true;
  stopDetail.hidden = true;
  tripDetail.hidden = true;
  dateSchedule.hidden = true;
  mapPanel.hidden = true;
  warningsView.hidden = false;

  const warnings = feed?.warnings ?? [];
  if (!warningTablesInitialized) {
    const tableKeys = new Set(["Global"]);
    for (const table of feed?.tables ?? []) tableKeys.add(table.name);
    for (const warning of warnings) {
      if (typeof warning.parameters.file === "string") tableKeys.add(warning.parameters.file);
    }
    selectedWarningTables = tableKeys;
    warningTablesInitialized = true;
  }
  renderWarningFilters();
  renderWarningTable();
  updateHistoryUi();
}

function warningTableKey(warning: GtfsWarning): string {
  if (WARNING_DESCRIPTIONS[warning.type].scope === "archive") return "Global";
  return typeof warning.parameters.file === "string" ? warning.parameters.file : "Global";
}

function renderWarningFilters(): void {
  const warnings = feed?.warnings ?? [];

  const selectedByType = warnings.filter((warning) => selectedWarningTables.has(warningTableKey(warning)));
  warningTypes.replaceChildren();
  for (const type of WARNING_TYPES) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedWarningTypes.has(type);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedWarningTypes.add(type);
      else selectedWarningTypes.delete(type);
      warningPage = 0;
      renderWarningFilters();
      renderWarningTable();
    });
    label.append(checkbox, ` ${WARNING_LABELS[type]} (${selectedByType.filter((warning) => warning.type === type).length})`);
    warningTypes.append(label);
  }

  const selectedByTables = warnings.filter((warning) => selectedWarningTypes.has(warning.type));
  const tableKeys = ["Global", ...[...new Set(warnings
    .map(warningTableKey)
    .filter((key) => key !== "Global"))].sort()];
  warningTables.replaceChildren();
  for (const table of tableKeys) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedWarningTables.has(table);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedWarningTables.add(table);
      else selectedWarningTables.delete(table);
      warningPage = 0;
      renderWarningFilters();
      renderWarningTable();
    });
    label.append(checkbox, ` ${table} (${selectedByTables.filter((warning) => warningTableKey(warning) === table).length})`);
    warningTables.append(label);
  }
}

function renderWarningTable(): void {
  const warnings = (feed?.warnings ?? []).filter((warning) =>
    selectedWarningTypes.has(warning.type) && selectedWarningTables.has(warningTableKey(warning)));
  const pageCount = Math.max(1, Math.ceil(warnings.length / warningRowsPerPage));
  warningPage = Math.min(warningPage, pageCount - 1);
  const start = warningPage * warningRowsPerPage;
  const fragment = document.createDocumentFragment();
  for (const warning of warnings.slice(start, start + warningRowsPerPage)) {
    const row = document.createElement("tr");
    const description = WARNING_DESCRIPTIONS[warning.type];
    const severity = document.createElement("td");
    severity.textContent = description.severity;
    const type = document.createElement("td");
    type.textContent = WARNING_LABELS[warning.type];
    const rowNumber = document.createElement("td");
    rowNumber.textContent = warning.csvRowNumber ? String(warning.csvRowNumber) : "";
    const message = document.createElement("td");
    const text = formatWarningMessage(warning);

    for (const id of warning.relatedObjectIds) {
      const index = text.indexOf(id);
      if (index < 0) continue;
      message.append(text.slice(0, index));
      const button = document.createElement("button");
      button.type = "button";
      button.className = "route-link";
      button.textContent = id;
      button.addEventListener("click", () => {
        const route = routesById.get(id);
        if (route) showRoute(route);
        else {
          const stop = stopsById.get(id);
          if (stop) showStop(stop);
        }
      });
      message.append(button, text.slice(index + id.length));
      break;
    }
    if (!warning.relatedObjectIds.length) message.textContent = text;

    row.append(severity, type, rowNumber, message);
    fragment.append(row);
  }
  warningTableBody.replaceChildren(fragment);
  warningPageLabel.textContent = `Page ${warningPage + 1} of ${pageCount}`;
  warningPrevious.disabled = warningPage === 0;
  warningNext.disabled = warningPage + 1 >= pageCount;
}

historyWarnings.addEventListener("click", () => {
  if (!feed) return;
  showWarnings();
});

warningTypesSelectAll.addEventListener("click", () => {
  selectedWarningTypes = new Set(WARNING_TYPES);
  warningPage = 0;
  showWarnings();
});

warningTypesClearAll.addEventListener("click", () => {
  selectedWarningTypes.clear();
  warningPage = 0;
  showWarnings();
});

warningTablesSelectAll.addEventListener("click", () => {
  selectedWarningTables = new Set(["Global", ...(feed?.tables.map((table) => table.name) ?? [])]);
  for (const warning of feed?.warnings ?? []) {
    if (typeof warning.parameters.file === "string") selectedWarningTables.add(warning.parameters.file);
  }
  warningPage = 0;
  showWarnings();
});

warningTablesClearAll.addEventListener("click", () => {
  selectedWarningTables.clear();
  warningPage = 0;
  showWarnings();
});

warningPrevious.addEventListener("click", () => {
  if (warningPage === 0) return;
  warningPage--;
  renderWarningTable();
  pushViewState();
});

warningNext.addEventListener("click", () => {
  warningPage++;
  renderWarningTable();
  pushViewState();
});

warningPageSize.addEventListener("change", () => {
  const firstItemIndex = warningPage * warningRowsPerPage;
  warningRowsPerPage = Number(warningPageSize.value);
  warningPage = Math.floor(firstItemIndex / warningRowsPerPage);
  renderWarningTable();
  pushViewState();
});

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
