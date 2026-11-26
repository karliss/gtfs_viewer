import {
  LngLatBounds,
  Map as LibreMap,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type GeoJSONSource,
  type SourceSpecification,
} from "maplibre-gl";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import mapWorker from "../dist/map-worker.txt";
import type { Coordinate, MapStop } from "./map-data";

const workerUrl = URL.createObjectURL(new Blob([mapWorker], { type: "text/javascript" }));
setWorkerUrl(workerUrl);

export type MapBaseLayerId = "none" | "osm" | "osm-humanitarian" | "opentopomap";

export interface MapBaseLayerOption {
  id: MapBaseLayerId;
  label: string;
  source?: {
    tiles: string[];
    tileSize: number;
    maxzoom: number;
    attribution: string;
  };
}

export const MAP_BASE_LAYERS: readonly MapBaseLayerOption[] = [
  { id: "none", label: "None" },
  {
    id: "osm",
    label: "OpenStreetMap",
    source: {
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  {
    id: "osm-humanitarian",
    label: "OpenStreetMap Humanitarian",
    source: {
      tiles: [
        "https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
        "https://b.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
        "https://c.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://www.hotosm.org/">Humanitarian OpenStreetMap Team</a>',
    },
  },
  {
    id: "opentopomap",
    label: "OpenTopoMap",
    source: {
      tiles: [
        "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
        "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
        "https://c.tile.opentopomap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      maxzoom: 17,
      attribution: 'Kartendaten: © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende, SRTM | Kartendarstellung: © <a href="http://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
    },
  },
];

export function defaultMapBaseLayer(hostname: string = typeof window === "undefined" ? "" : window.location.hostname): MapBaseLayerId {
  const isLocal = hostname === "" || hostname === "localhost" || hostname.endsWith(".localhost")
    || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "[::1]";
  return isLocal ? "none" : "osm";
}

export interface MapLine {
  coordinates: Coordinate[];
  approximate: boolean;
  variantIndex: number;
  label: string;
  routeId?: string;
  color?: string;
  randomColor?: string;
  stopIds?: string[];
}

export class MapView {
  private map: LibreMap;
  private loaded = false;
  private stops: MapStop[] = [];
  private lines: MapLine[] = [];
  private highlighted: Coordinate | null = null;
  private highlightedVariant: number | null = null;
  private selectedVariant: number | null = null;
  private hoveredVariant: number | null = null;
  private mapHoveredVariant: number | null = null;
  private hoveredStop: string | null = null;
  private hoveredStopIndex: number | null = null;
  private highlightedLines: Coordinate[][] | null = null;
  private comparisonRangeLines: Array<{ coordinates: Coordinate[]; color: string }> = [];
  private pendingFocusPoints: Coordinate[] | null = null;
  private routeColorsEnabled: boolean;
  private randomColorsEnabled: boolean;
  private stopSizeReduced: boolean;
  private stopOrderEnabled: boolean;
  private allStopsEnabled = false;
  private stopsVisible = true;
  private autoRefocusEnabled = true;
  private stopOrderVariant: number | null = null;
  private baseLayer: MapBaseLayerId;
  private rasterBlackAndWhite = false;
  private container: HTMLElement;
  private popup: Popup;
  private detailPopup: Popup;
  private pendingZoom: Coordinate | null = null;
  private pendingStopPopup: { coordinate: Coordinate; stopId: string } | null = null;
  private stopDetailsCallback: ((stopId: string) => HTMLElement | null) | undefined;
  private focusSelectionCallback?: () => void;

  constructor(
    container: HTMLElement,
    onError: (message: string) => void,
    onStopHover: (stopId: string | null) => void,
    stopDetails?: (stopId: string) => HTMLElement | null,
    routeDetails?: (routeId: string, variantIndex: number | null) => HTMLElement | null,
    onVariantHover?: (index: number | null) => void,
    baseLayer: MapBaseLayerId = defaultMapBaseLayer(),
    rasterBlackAndWhite = true,
    routeColors = true,
    randomColors = false,
    stopSizeReduced = false,
    stopOrder = false,
    allStops = false,
    focusSelection?: () => void,
  ) {
    this.container = container;
    this.baseLayer = baseLayer;
    this.rasterBlackAndWhite = rasterBlackAndWhite;
    this.routeColorsEnabled = routeColors;
    this.randomColorsEnabled = randomColors;
    this.stopSizeReduced = stopSizeReduced;
    this.stopOrderEnabled = stopOrder;
    this.allStopsEnabled = allStops;
    this.stopDetailsCallback = stopDetails;
    this.focusSelectionCallback = focusSelection;
    const baseLayerOption = MAP_BASE_LAYERS.find((option) => option.id === baseLayer);
    const sources: Record<string, SourceSpecification> = {};
    for (const layer of MAP_BASE_LAYERS) {
      if (!layer.source) continue;
      sources[layer.id] = {
        type: "raster",
        tiles: layer.source.tiles,
        tileSize: layer.source.tileSize,
        maxzoom: layer.source.maxzoom,
        attribution: layer.source.attribution,
      };
    }
    const layers = baseLayerOption?.source
      ? [{
        id: "basemap",
        type: "raster" as const,
        source: baseLayer,
        ...(rasterBlackAndWhite ? { paint: { "raster-saturation": -1 } } : {}),
      }]
      : [];
    container.classList?.toggle("map-canvas--no-basemap", baseLayer === "none");
    this.map = new LibreMap({
      container,
      center: [0, 0],
      zoom: 1,
      attributionControl: { compact: false },
      style: {
        version: 8,
        sources,
        layers,
      },
    });
    this.popup = new Popup({ closeButton: false, closeOnClick: false });
    this.detailPopup = new Popup({ closeButton: true, closeOnClick: true });
    this.map.addControl(new NavigationControl(), "top-right");
    this.map.addControl({
      onAdd: (map: LibreMap) => {
        const container = document.createElement("div");
        container.className = "maplibregl-ctrl maplibregl-ctrl-group";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "maplibregl-ctrl-icon";
        button.textContent = "⌖";
        button.title = "Focus selected routes or all routes and stops";
        button.setAttribute("aria-label", "Focus selected routes or all routes and stops");
        button.addEventListener("click", () => this.focusSelectionCallback?.());
        container.append(button);
        return container;
      },
      onRemove: (_map: LibreMap) => {},
    }, "top-right");
    this.map.on("error", (event) => onError(`Map or basemap error: ${event.error.message}`));
    this.map.on("load", () => {
      this.map.addSource("grid", { type: "geojson", data: this.gridFeatures() });
      this.map.addLayer({
        id: "grid", type: "line", source: "grid",
        layout: { "line-join": "round", "visibility": this.baseLayer === "none" ? "visible" : "none" },
        paint: { "line-color": "#b7c0cc", "line-width": 1, "line-opacity": 0.75 },
      });
      this.map.addSource("route-lines", { type: "geojson", data: this.lineFeatures() });
      this.map.addLayer({
        id: "route-lines", type: "line", source: "route-lines", filter: ["==", ["get", "approximate"], false],
        paint: { "line-color": "#1554a0", "line-width": 4 },
      });
      this.map.addLayer({
        id: "route-approximations", type: "line", source: "route-lines", filter: ["==", ["get", "approximate"], true],
        paint: { "line-color": "#1554a0", "line-width": 4, "line-dasharray": [2, 2] },
      });
      this.map.addLayer({
        id: "route-highlight", type: "line", source: "route-lines",
        filter: ["all", ["==", ["get", "approximate"], false], ["==", ["get", "variantIndex"], -1]],
        paint: { "line-color": "#e95e21", "line-width": 7 },
      });
      this.map.addLayer({
        id: "route-approximation-highlight", type: "line", source: "route-lines",
        filter: ["all", ["==", ["get", "approximate"], true], ["==", ["get", "variantIndex"], -1]],
        paint: { "line-color": "#e95e21", "line-width": 7, "line-dasharray": [2, 2] },
      });
      this.map.addSource("range-highlight-lines", { type: "geojson", data: this.rangeLineFeatures() });
      this.map.addLayer({
        id: "range-highlight-lines", type: "line", source: "range-highlight-lines",
        paint: { "line-color": ["get", "color"], "line-width": 8 },
      });
      this.map.addSource("range-highlight-points", { type: "geojson", data: this.rangePointFeatures() });
      this.map.addLayer({
        id: "range-highlight-points", type: "circle", source: "range-highlight-points",
        paint: { "circle-radius": 7, "circle-color": ["get", "color"], "circle-stroke-color": "#fff", "circle-stroke-width": 2 },
      });
      this.map.addLayer({
        id: "route-hit", type: "line", source: "route-lines",
        paint: { "line-color": "#1554a0", "line-width": 16, "line-opacity": 0 },
      });
      this.map.addSource("stops", { type: "geojson", data: this.stopFeatures() });
      this.map.addLayer({
        id: "stops", type: "circle", source: "stops",
        paint: { "circle-radius": 5, "circle-color": "#fff", "circle-stroke-color": "#1554a0", "circle-stroke-width": 2 },
      });
      this.map.addLayer({
        id: "stop-last-dot", type: "circle", source: "stops",
        filter: ["==", ["get", "stopId"], ""],
        paint: { "circle-radius": 2.5, "circle-color": "#e95e21", "circle-stroke-width": 0 },
      });
      this.map.addLayer({
        id: "stop-order", type: "symbol", source: "stops",
        layout: {
          "text-field": ["to-string", ["get", "stopOrder"]],
          "text-size": 10,
          "text-allow-overlap": true,
          "text-ignore-placement": true,
          "visibility": "none",
        },
        paint: {
          "text-color": "#111",
          "text-halo-color": "#fff",
          "text-halo-width": 1,
        },
      });
      this.map.addSource("highlight", { type: "geojson", data: this.highlightFeatures() });
      this.map.addLayer({
        id: "highlight", type: "circle", source: "highlight",
        paint: { "circle-radius": 10, "circle-color": "#e95e21", "circle-stroke-color": "#fff", "circle-stroke-width": 2 },
      });
      this.loaded = true;
      this.applyVariantHighlight();
      this.applyRouteColors();
      this.applyStopSize();
      this.applyStopOrder();
      if (this.autoRefocusEnabled) this.fit();
      if (this.pendingZoom) {
        this.zoomTo(this.pendingZoom);
        this.pendingZoom = null;
      }
      if (this.pendingStopPopup) {
        this.showStopPopup(this.pendingStopPopup.stopId, this.pendingStopPopup.coordinate);
        this.pendingStopPopup = null;
      }
      if (this.pendingFocusPoints) {
        this.fitPoints(this.pendingFocusPoints);
        this.pendingFocusPoints = null;
      }
    });
    this.map.on("moveend", () => {
      if (this.loaded) this.updateGrid();
    });
    this.map.on("mousemove", (event) => {
      if (!this.loaded) return;
      const features = this.map.queryRenderedFeatures(event.point, { layers: ["stops", "route-hit"] });
      const stop = features.find((feature) => feature.layer.id === "stops");
      const line = features.find((feature) => feature.layer.id === "route-hit");
      const feature = stop ?? line;
      this.map.getCanvas().style.cursor = feature ? "pointer" : "";
      const stopId = stop?.properties?.stopId || null;
      const stopIndex = typeof stop?.properties?.stopIndex === "number" ? stop.properties.stopIndex : null;
      const variant = !stop && line && typeof line.properties?.variantIndex === "number"
        ? line.properties.variantIndex : null;
      if (variant !== this.mapHoveredVariant) {
        this.mapHoveredVariant = variant;
        onVariantHover?.(variant);
      }
      this.hoverVariant(variant);
      if (stopIndex !== this.hoveredStopIndex) {
        this.hoveredStopIndex = stopIndex;
        this.applyVariantHighlight();
      }
      if (stopId !== this.hoveredStop) {
        this.hoveredStop = stopId;
        onStopHover(stopId);
      }
      if (feature) {
        this.popup.setLngLat(event.lngLat).setText(String(feature.properties?.label || "")).addTo(this.map);
      } else {
        this.popup.remove();
      }
    });
    this.map.on("mouseout", () => {
      this.popup.remove();
      this.map.getCanvas().style.cursor = "";
      this.hoveredStop = null;
      this.hoveredStopIndex = null;
      if (this.mapHoveredVariant !== null) {
        this.mapHoveredVariant = null;
        onVariantHover?.(null);
      }
      this.hoverVariant(null);
      if (this.loaded) this.applyVariantHighlight();
      onStopHover(null);
    });
    this.map.on("click", (event) => {
      if (!this.loaded) return;
      const features = this.map.queryRenderedFeatures(event.point, { layers: ["stops", "route-hit"] });
      const stop = features.find((feature) => feature.layer.id === "stops");
      const route = features.find((feature) => feature.layer.id === "route-hit");
      const stopId = stop?.properties?.stopId;
      const routeId = route?.properties?.routeId;
      const variantIndex = typeof route?.properties?.variantIndex === "number" ? route.properties.variantIndex : null;
      const content = stopId && stopDetails
        ? stopDetails(String(stopId))
        : !stop && routeId && routeDetails ? routeDetails(String(routeId), variantIndex) : null;
      if (content) this.detailPopup.setLngLat(event.lngLat).setDOMContent(content).addTo(this.map);
    });
  }

  update(stops: MapStop[], lines: MapLine[], fitView = true): void {
    this.stops = stops;
    this.lines = lines;
    this.highlighted = null;
    this.highlightedVariant = null;
    this.selectedVariant = null;
    this.hoveredVariant = null;
    this.mapHoveredVariant = null;
    this.pendingZoom = null;
    this.pendingFocusPoints = null;
    this.highlightedLines = null;
    this.comparisonRangeLines = [];
    this.hoveredStop = null;
    this.hoveredStopIndex = null;
    this.popup.remove();
    this.detailPopup.remove();
    if (this.loaded) {
      (this.map.getSource("stops") as GeoJSONSource).setData(this.stopFeatures());
      (this.map.getSource("route-lines") as GeoJSONSource).setData(this.lineFeatures());
      (this.map.getSource("highlight") as GeoJSONSource).setData(this.highlightFeatures());
      (this.map.getSource("range-highlight-lines") as GeoJSONSource).setData(this.rangeLineFeatures());
      (this.map.getSource("range-highlight-points") as GeoJSONSource).setData(this.rangePointFeatures());
      this.applyVariantHighlight();
      this.applyRouteColors();
      this.applyStopSize();
      this.applyStopOrder();
      if (fitView && this.autoRefocusEnabled) this.fit();
    }
  }

  highlightVariant(index: number | null): void {
    this.highlightedVariant = index;
    if (this.loaded) this.applyVariantHighlight();
  }

  setSelectedVariant(index: number | null): void {
    this.selectedVariant = index;
    if (this.loaded) this.applyVariantHighlight();
  }

  setRouteColors(enabled: boolean): void {
    this.routeColorsEnabled = enabled;
    if (this.loaded) this.applyRouteColors();
  }

  setRandomColors(enabled: boolean): void {
    this.randomColorsEnabled = enabled;
    if (this.loaded) this.applyRouteColors();
  }

  setStopSizeReduced(enabled: boolean): void {
    this.stopSizeReduced = enabled;
    if (this.loaded) {
      this.map.setPaintProperty("stops", "circle-radius", enabled ? 3 : 5);
    }
  }

  setStopOrderEnabled(enabled: boolean): void {
    this.stopOrderEnabled = enabled;
    if (this.loaded) this.applyStopOrder();
  }

  get rasterBlackAndWhiteEnabled(): boolean {
    return this.rasterBlackAndWhite;
  }

  get routeColorsEnabledState(): boolean {
    return this.routeColorsEnabled;
  }

  get randomColorsEnabledState(): boolean {
    return this.randomColorsEnabled;
  }

  get reducedStopSizeEnabled(): boolean {
    return this.stopSizeReduced;
  }

  get stopOrderEnabledState(): boolean {
    return this.stopOrderEnabled;
  }

  get allStopsEnabledState(): boolean {
    return this.allStopsEnabled;
  }

  setAllStopsEnabled(enabled: boolean): void {
    this.allStopsEnabled = enabled;
  }

  setStopsVisible(enabled: boolean): void {
    this.stopsVisible = enabled;
    if (this.loaded) {
      this.map.setLayoutProperty("stops", "visibility", enabled ? "visible" : "none");
      this.map.setLayoutProperty("stop-order", "visibility",
        enabled && this.stopOrderEnabled && this.stopOrderVariant !== null ? "visible" : "none");
    }
  }

  setAutoRefocusEnabled(enabled: boolean): void {
    this.autoRefocusEnabled = enabled;
  }

  get autoRefocusEnabledState(): boolean {
    return this.autoRefocusEnabled;
  }

  setStopOrderVariant(index: number | null): void {
    this.stopOrderVariant = index;
    if (this.loaded) {
      (this.map.getSource("stops") as GeoJSONSource).setData(this.stopFeatures());
      this.applyStopOrder();
    }
  }

  addOverlayControl(control: HTMLElement): void {
    this.map.addControl({
      onAdd: () => {
        control.classList.add("maplibregl-ctrl", "maplibregl-ctrl-group");
        return control;
      },
      onRemove: () => {},
    }, "top-right");
  }

  setBaseLayer(id: MapBaseLayerId): void {
    if (id === this.baseLayer) return;
    const option = MAP_BASE_LAYERS.find((candidate) => candidate.id === id);
    if (!option) return;
    this.baseLayer = id;
    this.container.classList?.toggle("map-canvas--no-basemap", id === "none");
    if (!this.loaded) return;
    this.map.setLayoutProperty("grid", "visibility", id === "none" ? "visible" : "none");
    if (this.map.getLayer("basemap")) this.map.removeLayer("basemap");
    if (option.source) {
      this.map.addLayer({
        id: "basemap",
        type: "raster",
        source: id,
        ...(this.rasterBlackAndWhite ? { paint: { "raster-saturation": -1 } } : {}),
      }, "route-lines");
    }
  }

  setRasterBlackAndWhite(enabled: boolean): void {
    this.rasterBlackAndWhite = enabled;
    if (!this.loaded) return;
    if (this.map.getLayer("basemap")) {
      this.map.setPaintProperty("basemap", "raster-saturation", enabled ? -1 : 0);
    }
  }

  private updateGrid(): void {
    if (!this.loaded) return;
    (this.map.getSource("grid") as GeoJSONSource).setData(this.gridFeatures());
  }

  private gridFeatures(): FeatureCollection<LineString> {
    const bounds = typeof this.map.getBounds === "function"
      ? this.map.getBounds()
      : null;
    const west = bounds ? Math.max(-180, bounds.getWest()) : -180;
    const east = bounds ? Math.min(180, bounds.getEast()) : 180;
    const south = bounds ? Math.max(-85, bounds.getSouth()) : -85;
    const north = bounds ? Math.min(85, bounds.getNorth()) : 85;
    const zoom = this.map.getZoom();
    let interval = 180 / Math.pow(2, Math.max(0, zoom));
    if (interval < 0.000001) interval = 0.000001;

    const features: Feature<LineString>[] = [];
    for (let lon = Math.floor(west / interval) * interval; lon <= east; lon += interval) {
      features.push({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: [[lon, south], [lon, north]] },
      });
    }
    for (let lat = Math.floor(south / interval) * interval; lat <= north; lat += interval) {
      features.push({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: [[west, lat], [east, lat]] },
      });
    }
    return { type: "FeatureCollection", features };
  }

  hoverVariant(index: number | null): void {
    if (this.hoveredVariant === index) return;
    this.hoveredVariant = index;
    if (this.loaded) this.applyVariantHighlight();
  }

  highlight(coordinate: Coordinate | null): void {
    this.highlighted = coordinate;
    if (this.loaded) (this.map.getSource("highlight") as GeoJSONSource).setData(this.highlightFeatures());
  }

  highlightLines(lines: Coordinate[][] | null): void {
    this.highlightedLines = lines;
    if (this.loaded) {
      (this.map.getSource("range-highlight-lines") as GeoJSONSource).setData(this.rangeLineFeatures());
      (this.map.getSource("range-highlight-points") as GeoJSONSource).setData(this.rangePointFeatures());
    }
  }

  setComparisonRangeColors(common: Coordinate[][], differing: Coordinate[][], enabled: boolean): void {
    this.comparisonRangeLines = enabled
      ? [
        ...common.map((coordinates) => ({ coordinates, color: "#2e7d32" })),
        ...differing.map((coordinates) => ({ coordinates, color: "#c62828" })),
      ]
      : [];
    if (this.loaded) {
      (this.map.getSource("range-highlight-lines") as GeoJSONSource).setData(this.rangeLineFeatures());
      (this.map.getSource("range-highlight-points") as GeoJSONSource).setData(this.rangePointFeatures());
    }
  }

  focusPoints(points: Coordinate[]): void {
    if (!this.loaded) {
      this.pendingFocusPoints = points;
      return;
    }
    this.fitPoints(points);
  }

  zoomTo(coordinate: Coordinate): void {
    if (!this.loaded) {
      this.pendingZoom = coordinate;
      return;
    }
    this.map.easeTo({ center: coordinate, zoom: Math.max(this.map.getZoom(), 16) });
  }

  focusSelection(routeId: string | null = null, variantIndex: number | null = null): void {
    if (!this.loaded) return;
    const selectedLines = this.lines.filter((line) =>
      variantIndex !== null
        ? line.variantIndex === variantIndex
        : routeId === null || line.routeId === routeId
    );
    const points = selectedLines.flatMap((line) => line.coordinates);
    if (points.length) {
      this.fitPoints(points);
      return;
    }
    const selectedStopIds = new Set(selectedLines.flatMap((line) => line.stopIds ?? []));
    const stopPoints = this.stops.flatMap((stop) =>
      stop.coordinate && (selectedLines.length === 0
        ? routeId === null && variantIndex === null
        : stop.id !== null && selectedStopIds.has(stop.id))
        ? [stop.coordinate]
        : []
    );
    this.fitPoints(stopPoints);
  }

  showStopPopup(stopId: string, coordinate: Coordinate): void {
    this.zoomTo(coordinate);
    const content = this.stopDetailsCallback?.(stopId);
    if (!content) return;
    if (!this.loaded) {
      this.pendingStopPopup = { coordinate, stopId };
      return;
    }
    this.detailPopup.setLngLat(coordinate).setDOMContent(content).addTo(this.map);
  }

  resize(): void {
    this.map.resize();
  }

  remove(): void {
    this.popup.remove();
    this.detailPopup.remove();
    this.map.remove();
  }

  private stopFeatures(): FeatureCollection<Point> {
    const orderLine = this.stopOrderVariant === null
      ? null
      : this.lines.find((line) => line.variantIndex === this.stopOrderVariant);
    const stopOrders = new Map<string, number>();
    for (const [index, stopId] of (orderLine?.stopIds ?? []).entries()) {
      if (stopId) stopOrders.set(stopId, index + 1);
    }
    const features: Feature<Point>[] = this.stops.flatMap((stop, index) => stop.coordinate
      ? [{
        type: "Feature",
        properties: {
          stopId: stop.id ?? "",
          stopIndex: index,
          label: stop.hoverLabel || stop.name || stop.id || "Stop",
          ...(stop.id && stopOrders.has(stop.id) ? { stopOrder: stopOrders.get(stop.id) } : {}),
        },
        geometry: { type: "Point", coordinates: stop.coordinate },
      }] : []);
    return { type: "FeatureCollection", features };
  }

  private lineFeatures(): FeatureCollection<LineString> {
    return {
      type: "FeatureCollection",
      features: this.lines.filter((line) => line.coordinates.length >= 2).map((line) => ({
        type: "Feature",
        properties: {
          approximate: line.approximate,
          variantIndex: line.variantIndex,
          label: line.label,
          routeId: line.routeId ?? "",
          color: line.color ?? "#1554a0",
          randomColor: line.randomColor ?? "#1554a0",
        },
        geometry: { type: "LineString", coordinates: line.coordinates },
      })),
    };
  }

  private rangeLineFeatures(): FeatureCollection<LineString> {
    const highlighted = (this.highlightedLines ?? []).map((coordinates) => ({
      coordinates,
      color: "#f58220",
    }));
    return {
      type: "FeatureCollection",
      features: [...this.comparisonRangeLines, ...highlighted].filter((line) => line.coordinates.length >= 2).map((line) => ({
        type: "Feature",
        properties: { color: line.color },
        geometry: { type: "LineString", coordinates: line.coordinates },
      })),
    };
  }

  private rangePointFeatures(): FeatureCollection<Point> {
    const highlighted = (this.highlightedLines ?? []).map((coordinates) => ({
      coordinates,
      color: "#f58220",
    }));
    return {
      type: "FeatureCollection",
      features: [...this.comparisonRangeLines, ...highlighted].flatMap((line) => line.coordinates.length === 1
        ? [{ type: "Feature", properties: { color: line.color }, geometry: { type: "Point", coordinates: line.coordinates[0] } }]
        : []),
    };
  }

  private applyVariantHighlight(): void {
    const highlightedIndex = this.hoveredVariant ?? this.highlightedVariant ?? -1;
    this.map.setFilter("route-highlight", ["all", ["==", ["get", "approximate"], false], ["==", ["get", "variantIndex"], highlightedIndex]]);
    this.map.setFilter("route-approximation-highlight", ["all", ["==", ["get", "approximate"], true], ["==", ["get", "variantIndex"], highlightedIndex]]);
    const stopVariantIndex = this.hoveredVariant ?? this.highlightedVariant ?? this.selectedVariant ?? -1;
    const stopIds = [...new Set(this.lines.filter((line) => line.variantIndex === stopVariantIndex).flatMap((line) => line.stopIds ?? []))];
    this.map.setPaintProperty("stops", "circle-color", [
      "case", ["==", ["get", "stopIndex"], this.hoveredStopIndex ?? -1], "#fff",
      ["in", ["get", "stopId"], ["literal", stopIds]], "#fff", "#fff",
    ]);
    this.map.setPaintProperty("stops", "circle-stroke-color", [
      "case", ["==", ["get", "stopIndex"], this.hoveredStopIndex ?? -1], "#b33a08",
      ["in", ["get", "stopId"], ["literal", stopIds]], "#e95e21", "#1554a0",
    ]);
    const finalStopVariant = this.hoveredVariant ?? this.highlightedVariant ?? this.selectedVariant;
    const lastStopId = finalStopVariant === null
      ? null
      : (() => {
        const stopIds = this.lines.find((line) => line.variantIndex === finalStopVariant)?.stopIds;
        return stopIds?.length ? stopIds[stopIds.length - 1] : null;
      })();
    this.map.setFilter("stop-last-dot", ["==", ["get", "stopId"], lastStopId ?? "__no_variant_last_stop__"]);

    if (typeof (this.map as LibreMap & { moveLayer?: (id: string) => void }).moveLayer === "function") {
      this.map.moveLayer("route-highlight");
      this.map.moveLayer("route-approximation-highlight");
      this.map.moveLayer("stops");
      this.map.moveLayer("stop-last-dot");
      this.map.moveLayer("stop-order");
    }
  }

  private applyStopSize(): void {
    if (this.stopSizeReduced) {
      this.map.setPaintProperty("stops", "circle-radius", 3);
    }
  }

  private applyStopOrder(): void {
    const visible = this.stopsVisible && this.stopOrderEnabled && this.stopOrderVariant !== null;
    if (typeof (this.map as LibreMap & { setLayoutProperty?: (id: string, name: string, value: unknown) => void }).setLayoutProperty === "function") {
      this.map.setLayoutProperty("stop-order", "visibility", visible ? "visible" : "none");
    }
  }

  private applyRouteColors(): void {
    if (this.randomColorsEnabled) {
      this.map.setPaintProperty("route-lines", "line-color", ["get", "randomColor"]);
      this.map.setPaintProperty("route-approximations", "line-color", ["get", "randomColor"]);
    } else if (this.routeColorsEnabled) {
      this.map.setPaintProperty("route-lines", "line-color", ["get", "color"]);
      this.map.setPaintProperty("route-approximations", "line-color", ["get", "color"]);
    } else {
      this.map.setPaintProperty("route-lines", "line-color", "#1554a0");
      this.map.setPaintProperty("route-approximations", "line-color", "#1554a0");
    }
  }

  private highlightFeatures(): FeatureCollection<Point> {
    return {
      type: "FeatureCollection",
      features: this.highlighted
        ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: this.highlighted } }]
        : [],
    };
  }

  private fit(): void {
    const linePoints = this.lines.flatMap((line) => line.coordinates);
    const points = linePoints.length
      ? linePoints
      : this.stops.flatMap((stop) => stop.coordinate ? [stop.coordinate] : []);
    this.fitPoints(points);
  }

  private fitPoints(points: Coordinate[]): void {
    if (!points.length) return;
    const bounds = new LngLatBounds(points[0], points[0]);
    for (const point of points.slice(1)) bounds.extend(point);
    this.map.resize();
    this.map.fitBounds(bounds, { padding: 48, maxZoom: 16, duration: 0 });
  }
}
