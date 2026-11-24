import { LngLatBounds, Map as LibreMap, NavigationControl, Popup, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import mapWorker from "../dist/map-worker.txt";
import type { Coordinate, MapStop } from "./map-data";

const workerUrl = URL.createObjectURL(new Blob([mapWorker], { type: "text/javascript" }));
setWorkerUrl(workerUrl);

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
  private hoveredVariant: number | null = null;
  private mapHoveredVariant: number | null = null;
  private hoveredStop: string | null = null;
  private hoveredStopIndex: number | null = null;
  private routeColorsEnabled = true;
  private randomColorsEnabled = false;
  private stopSizeReduced = false;
  private stopOrderEnabled = false;
  private stopOrderVariant: number | null = null;
  private popup: Popup;
  private detailPopup: Popup;
  private pendingZoom: Coordinate | null = null;

  constructor(
    container: HTMLElement,
    onError: (message: string) => void,
    onStopHover: (stopId: string | null) => void,
    stopDetails?: (stopId: string) => HTMLElement | null,
    routeDetails?: (routeId: string, variantIndex: number | null) => HTMLElement | null,
    onVariantHover?: (index: number | null) => void,
  ) {
    this.map = new LibreMap({
      container,
      center: [0, 0],
      zoom: 1,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            maxzoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          },
        },
        layers: [{ id: "basemap", type: "raster", source: "osm" }],
      },
    });
    this.popup = new Popup({ closeButton: false, closeOnClick: false });
    this.detailPopup = new Popup({ closeButton: true, closeOnClick: true });
    this.map.addControl(new NavigationControl(), "top-right");
    this.map.on("error", (event) => onError(`Map or basemap error: ${event.error.message}`));
    this.map.on("load", () => {
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
      this.fit();
      if (this.pendingZoom) {
        this.zoomTo(this.pendingZoom);
        this.pendingZoom = null;
      }
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
    this.hoveredVariant = null;
    this.mapHoveredVariant = null;
    this.pendingZoom = null;
    this.hoveredStop = null;
    this.hoveredStopIndex = null;
    this.popup.remove();
    this.detailPopup.remove();
    if (this.loaded) {
      (this.map.getSource("stops") as GeoJSONSource).setData(this.stopFeatures());
      (this.map.getSource("route-lines") as GeoJSONSource).setData(this.lineFeatures());
      (this.map.getSource("highlight") as GeoJSONSource).setData(this.highlightFeatures());
      this.applyVariantHighlight();
      this.applyRouteColors();
      this.applyStopSize();
      this.applyStopOrder();
      if (fitView) this.fit();
    }
  }

  highlightVariant(index: number | null): void {
    this.highlightedVariant = index;
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

  setStopOrderVariant(index: number | null): void {
    this.stopOrderVariant = index;
    if (this.loaded) {
      (this.map.getSource("stops") as GeoJSONSource).setData(this.stopFeatures());
      this.applyStopOrder();
    }
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

  zoomTo(coordinate: Coordinate): void {
    if (!this.loaded) {
      this.pendingZoom = coordinate;
      return;
    }
    this.map.easeTo({ center: coordinate, zoom: Math.max(this.map.getZoom(), 16) });
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
          label: stop.hoverLabel || stop.name?.trim() || stop.id || "Stop",
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

  private applyVariantHighlight(): void {
    const index = this.hoveredVariant ?? this.highlightedVariant ?? -1;
    this.map.setFilter("route-highlight", ["all", ["==", ["get", "approximate"], false], ["==", ["get", "variantIndex"], index]]);
    this.map.setFilter("route-approximation-highlight", ["all", ["==", ["get", "approximate"], true], ["==", ["get", "variantIndex"], index]]);
    const stopIds = [...new Set(this.lines.filter((line) => line.variantIndex === index).flatMap((line) => line.stopIds ?? []))];
    this.map.setPaintProperty("stops", "circle-color", [
      "case", ["==", ["get", "stopIndex"], this.hoveredStopIndex ?? -1], "#fff",
      ["in", ["get", "stopId"], ["literal", stopIds]], "#fff", "#fff",
    ]);
    this.map.setPaintProperty("stops", "circle-stroke-color", [
      "case", ["==", ["get", "stopIndex"], this.hoveredStopIndex ?? -1], "#b33a08",
      ["in", ["get", "stopId"], ["literal", stopIds]], "#e95e21", "#1554a0",
    ]);
    const lastStopId = this.highlightedVariant === null
      ? null
      : (() => {
        const stopIds = this.lines.find((line) => line.variantIndex === this.highlightedVariant)?.stopIds;
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
    const visible = this.stopOrderEnabled && this.stopOrderVariant !== null;
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
    const points = [
      ...this.stops.flatMap((stop) => stop.coordinate ? [stop.coordinate] : []),
      ...this.lines.flatMap((line) => line.coordinates),
    ];
    if (!points.length) return;
    const bounds = new LngLatBounds(points[0], points[0]);
    for (const point of points.slice(1)) bounds.extend(point);
    this.map.resize();
    this.map.fitBounds(bounds, { padding: 48, maxZoom: 16, duration: 0 });
  }
}
