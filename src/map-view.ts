import { LngLatBounds, Map as LibreMap, NavigationControl, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import mapWorker from "../dist/map-worker.txt";
import type { Coordinate, MapStop } from "./map-data";

const workerUrl = URL.createObjectURL(new Blob([mapWorker], { type: "text/javascript" }));
setWorkerUrl(workerUrl);

interface MapLine {
  coordinates: Coordinate[];
  approximate: boolean;
}

export class MapView {
  private map: LibreMap;
  private loaded = false;
  private stops: MapStop[] = [];
  private lines: MapLine[] = [];
  private highlighted: Coordinate | null = null;

  constructor(container: HTMLElement, onError: (message: string) => void) {
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
      this.fit();
    });
  }

  update(stops: MapStop[], lines: MapLine[]): void {
    this.stops = stops;
    this.lines = lines;
    this.highlighted = null;
    if (this.loaded) {
      (this.map.getSource("stops") as GeoJSONSource).setData(this.stopFeatures());
      (this.map.getSource("route-lines") as GeoJSONSource).setData(this.lineFeatures());
      (this.map.getSource("highlight") as GeoJSONSource).setData(this.highlightFeatures());
      this.fit();
    }
  }

  highlight(coordinate: Coordinate | null): void {
    this.highlighted = coordinate;
    if (this.loaded) (this.map.getSource("highlight") as GeoJSONSource).setData(this.highlightFeatures());
  }

  zoomTo(coordinate: Coordinate): void {
    this.map.easeTo({ center: coordinate, zoom: Math.max(this.map.getZoom(), 16) });
  }

  remove(): void {
    this.map.remove();
  }

  private stopFeatures(): FeatureCollection<Point> {
    const features: Feature<Point>[] = this.stops.flatMap((stop) => stop.coordinate
      ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: stop.coordinate } }] : []);
    return { type: "FeatureCollection", features };
  }

  private lineFeatures(): FeatureCollection<LineString> {
    return {
      type: "FeatureCollection",
      features: this.lines.filter((line) => line.coordinates.length >= 2).map((line) => ({
        type: "Feature", properties: { approximate: line.approximate },
        geometry: { type: "LineString", coordinates: line.coordinates },
      })),
    };
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
