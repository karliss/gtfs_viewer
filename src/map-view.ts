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
}

export class MapView {
  private map: LibreMap;
  private loaded = false;
  private stops: MapStop[] = [];
  private lines: MapLine[] = [];
  private highlighted: Coordinate | null = null;
  private highlightedVariant: number | null = null;
  private hoveredStop: string | null = null;
  private popup: Popup;

  constructor(
    container: HTMLElement,
    onError: (message: string) => void,
    onStopHover: (stopId: string | null) => void,
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
      this.map.addSource("highlight", { type: "geojson", data: this.highlightFeatures() });
      this.map.addLayer({
        id: "highlight", type: "circle", source: "highlight",
        paint: { "circle-radius": 10, "circle-color": "#e95e21", "circle-stroke-color": "#fff", "circle-stroke-width": 2 },
      });
      this.loaded = true;
      this.applyVariantHighlight();
      this.fit();
    });
    this.map.on("mousemove", (event) => {
      if (!this.loaded) return;
      const features = this.map.queryRenderedFeatures(event.point, { layers: ["stops", "route-hit"] });
      const stop = features.find((feature) => feature.layer.id === "stops");
      const line = features.find((feature) => feature.layer.id === "route-hit");
      const feature = stop ?? line;
      this.map.getCanvas().style.cursor = feature ? "pointer" : "";
      const stopId = stop?.properties?.stopId || null;
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
      onStopHover(null);
    });
  }

  update(stops: MapStop[], lines: MapLine[]): void {
    this.stops = stops;
    this.lines = lines;
    this.highlighted = null;
    this.highlightedVariant = null;
    this.hoveredStop = null;
    this.popup.remove();
    if (this.loaded) {
      (this.map.getSource("stops") as GeoJSONSource).setData(this.stopFeatures());
      (this.map.getSource("route-lines") as GeoJSONSource).setData(this.lineFeatures());
      (this.map.getSource("highlight") as GeoJSONSource).setData(this.highlightFeatures());
      this.applyVariantHighlight();
      this.fit();
    }
  }

  highlightVariant(index: number | null): void {
    this.highlightedVariant = index;
    if (this.loaded) this.applyVariantHighlight();
  }

  highlight(coordinate: Coordinate | null): void {
    this.highlighted = coordinate;
    if (this.loaded) (this.map.getSource("highlight") as GeoJSONSource).setData(this.highlightFeatures());
  }

  zoomTo(coordinate: Coordinate): void {
    this.map.easeTo({ center: coordinate, zoom: Math.max(this.map.getZoom(), 16) });
  }

  remove(): void {
    this.popup.remove();
    this.map.remove();
  }

  private stopFeatures(): FeatureCollection<Point> {
    const features: Feature<Point>[] = this.stops.flatMap((stop) => stop.coordinate
      ? [{
        type: "Feature", properties: { stopId: stop.id ?? "", label: stop.name?.trim() || stop.id || "Stop" },
        geometry: { type: "Point", coordinates: stop.coordinate },
      }] : []);
    return { type: "FeatureCollection", features };
  }

  private lineFeatures(): FeatureCollection<LineString> {
    return {
      type: "FeatureCollection",
      features: this.lines.filter((line) => line.coordinates.length >= 2).map((line) => ({
        type: "Feature", properties: { approximate: line.approximate, variantIndex: line.variantIndex, label: line.label },
        geometry: { type: "LineString", coordinates: line.coordinates },
      })),
    };
  }

  private applyVariantHighlight(): void {
    const index = this.highlightedVariant ?? -1;
    this.map.setFilter("route-highlight", ["all", ["==", ["get", "approximate"], false], ["==", ["get", "variantIndex"], index]]);
    this.map.setFilter("route-approximation-highlight", ["all", ["==", ["get", "approximate"], true], ["==", ["get", "variantIndex"], index]]);
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
