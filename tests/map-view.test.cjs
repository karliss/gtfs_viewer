const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

let map;
let popup;
let detailPopup;
class FakeMap {
  constructor(options) {
    map = this;
    this.options = options;
    this.fitBoundsCount = 0;
    this.style = options?.style;
    this.events = {};
    this.sources = {};
    this.layers = {};
    this.filters = {};
    this.paint = {};
    this.features = [];
    this.canvas = { style: {} };
  }
  on(event, handler) { this.events[event] = handler; }
  addControl() {}
  addSource(id, source) { this.sources[id] = { data: source.data, setData(data) { this.data = data; } }; }
  getSource(id) { return this.sources[id]; }
  addLayer(layer) { this.layers[layer.id] = layer; }
  getLayer(id) { return this.layers[id]; }
  removeLayer(id) { delete this.layers[id]; }
  removeSource(id) { delete this.sources[id]; }
  setFilter(id, filter) { this.filters[id] = filter; }
  setLayoutProperty(id, name, value) { this.layout = this.layout || {}; this.layout[`${id}:${name}`] = value; }
  setPaintProperty(id, name, value) { this.paint[`${id}:${name}`] = value; }
  queryRenderedFeatures() { return this.features; }
  getCanvas() { return this.canvas; }
  resize() {}
  fitBounds() { this.fitBoundsCount++; }
  getBounds() { return { getWest: () => -10, getEast: () => 10, getSouth: () => -10, getNorth: () => 10 }; }
  getZoom() { return 3; }
  easeTo(options) { this.lastEase = options; }
  remove() { this.removed = true; }
}
class FakePopup {
  constructor(options) { if (options.closeButton) detailPopup = this; else popup = this; }
  setLngLat(value) { this.position = value; return this; }
  setText(value) { this.text = value; return this; }
  setDOMContent(value) { this.content = value; return this; }
  addTo() { this.visible = true; return this; }
  remove() { this.visible = false; return this; }
}
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request === "maplibre-gl") {
    return {
      Map: FakeMap, Popup: FakePopup, NavigationControl: class {},
      LngLatBounds: class { extend() {} }, setWorkerUrl() {},
    };
  }
  return originalLoad.call(this, request, ...args);
};
let MapView;
let MAP_BASE_LAYERS;
let defaultMapBaseLayer;
try {
  ({ MapView, MAP_BASE_LAYERS, defaultMapBaseLayer } = require("../dist/map-view.cjs"));
} finally {
  Module._load = originalLoad;
}

test("base map options include none and default locally to none", () => {
  assert.deepEqual(MAP_BASE_LAYERS.map((layer) => layer.id), ["none", "osm", "osm-humanitarian", "opentopomap"]);
  assert.equal(defaultMapBaseLayer("localhost"), "none");
  assert.equal(defaultMapBaseLayer("127.0.0.1"), "none");
  assert.equal(defaultMapBaseLayer("0.0.0.0"), "none");
  assert.equal(defaultMapBaseLayer("example.com"), "osm");
  const view = new MapView({ classList: { toggle() {} } }, () => {}, () => {}, undefined, undefined, undefined, "none");
  assert.deepEqual(map.options.attributionControl, { compact: false });
  assert.deepEqual(Object.keys(map.style.sources), ["osm", "osm-humanitarian", "opentopomap"]);
  assert.deepEqual(map.style.layers, []);
  map.events.load();
  view.setBaseLayer("osm");
  assert.equal(map.layers.basemap.source, "osm");
  view.setBaseLayer("osm-humanitarian");
  assert.equal(map.layers.basemap.source, "osm-humanitarian");
  view.setBaseLayer("opentopomap");
  assert.equal(map.layers.basemap.source, "opentopomap");
  assert.equal(map.layout["grid:visibility"], "none");
  view.setBaseLayer("none");
  assert.equal(map.layers.basemap, undefined);
  assert.equal(map.layout["grid:visibility"], "visible");
});

test("black and white toggle applies to raster basemaps", () => {
  const view = new MapView({ classList: { toggle() {} } }, () => {}, () => {}, undefined, undefined, undefined, "none", true);
  map.events.load();
  view.setBaseLayer("osm");
  assert.equal(map.layers.basemap.source, "osm");
  assert.equal(map.layers.basemap.paint["raster-saturation"], -1);
  view.setRasterBlackAndWhite(false);
  assert.equal(map.paint["basemap:raster-saturation"], 0);
  view.setRasterBlackAndWhite(true);
  assert.equal(map.paint["basemap:raster-saturation"], -1);
  view.setBaseLayer("osm-humanitarian");
  assert.equal(map.layers.basemap.source, "osm-humanitarian");
  assert.equal(map.layers.basemap.paint["raster-saturation"], -1);
  view.setRasterBlackAndWhite(false);
  assert.equal(map.paint["basemap:raster-saturation"], 0);
});

test("map hover displays safe labels, prioritizes stops, and clears sidebar highlight", () => {
  const hovered = [];
  const view = new MapView({}, () => {}, (id) => hovered.push(id));
  view.update([{ id: "stop-1", name: "<Stop>", coordinate: [1, 2] }], [
    { coordinates: [[1, 2], [3, 4]], approximate: false, variantIndex: 2, label: "Variant A" },
  ]);
  map.events.load();
  assert.deepEqual(map.sources.stops.data.features[0].properties, { stopId: "stop-1", stopIndex: 0, label: "<Stop>" });
  assert.equal(map.sources["route-lines"].data.features[0].properties.label, "Variant A");
  map.features = [
    { layer: { id: "route-hit" }, properties: { label: "Variant A" } },
    { layer: { id: "stops" }, properties: { stopId: "stop-1", stopIndex: 0, label: "<Stop>" } },
  ];
  map.events.mousemove({ point: {}, lngLat: [1, 2] });
  assert.equal(popup.text, "<Stop>");
  assert.equal(popup.visible, true);
  assert.deepEqual(hovered, ["stop-1"]);
  assert.deepEqual(map.paint["stops:circle-color"][1], ["==", ["get", "stopIndex"], 0]);
  map.features = [{ layer: { id: "route-hit" }, properties: { label: "Variant A" } }];
  map.events.mousemove({ point: {}, lngLat: [2, 3] });
  assert.equal(popup.text, "Variant A");
  assert.deepEqual(hovered, ["stop-1", null]);
  assert.deepEqual(map.paint["stops:circle-color"][1], ["==", ["get", "stopIndex"], -1]);
  map.events.mouseout();
  assert.equal(popup.visible, false);
  assert.equal(map.canvas.style.cursor, "");
  view.remove();
  assert.equal(map.removed, true);
});

test("variant highlighting handles solid and dashed lines and clears on update", () => {
  const view = new MapView({}, () => {}, () => {});
  view.highlightVariant(3);
  map.events.load();
  assert.deepEqual(map.filters["route-highlight"][2], ["==", ["get", "variantIndex"], 3]);
  assert.deepEqual(map.filters["route-approximation-highlight"][2], ["==", ["get", "variantIndex"], 3]);
  view.highlightVariant(null);
  assert.deepEqual(map.filters["route-highlight"][2], ["==", ["get", "variantIndex"], -1]);
  view.highlightVariant(2);
  view.update([], []);
  assert.deepEqual(map.filters["route-highlight"][2], ["==", ["get", "variantIndex"], -1]);
});

test("map hover temporarily highlights variants without clearing pinned selection", () => {
  const hovered = [];
  const view = new MapView({}, () => {}, () => {}, undefined, undefined, (index) => hovered.push(index));
  map.events.load();
  view.highlightVariant(3);
  view.hoverVariant(5);
  map.features = [{ layer: { id: "route-hit" }, properties: { label: "Other", variantIndex: 5 } }];
  map.events.mousemove({ point: {}, lngLat: [1, 2] });
  map.events.mousemove({ point: {}, lngLat: [1, 2] });
  assert.deepEqual(hovered, [5]);
  assert.deepEqual(map.filters["route-highlight"][2], ["==", ["get", "variantIndex"], 5]);
  map.features = [{ layer: { id: "stops" }, properties: { stopId: "s" } }];
  map.events.mousemove({ point: {}, lngLat: [1, 2] });
  assert.deepEqual(hovered, [5, null]);
  map.features = [{ layer: { id: "route-hit" }, properties: { variantIndex: 5 } }];
  map.events.mousemove({ point: {}, lngLat: [1, 2] });
  map.events.mouseout();
  assert.deepEqual(hovered, [5, null, 5, null]);
  assert.deepEqual(map.filters["route-highlight"][2], ["==", ["get", "variantIndex"], 3]);
  view.highlightVariant(null);
  assert.deepEqual(map.filters["route-highlight"][2], ["==", ["get", "variantIndex"], -1]);
});

test("variant highlighting colors only its stops and restores the pinned variant", () => {
  const view = new MapView({}, () => {}, () => {});
  view.update([], [
    { coordinates: [[1, 2], [3, 4]], approximate: false, variantIndex: 0, label: "A", stopIds: ["a", "shared"] },
    { coordinates: [[1, 2], [3, 4]], approximate: true, variantIndex: 1, label: "B", stopIds: ["b", "shared"] },
  ]);
  map.events.load();
  const highlightedStops = () => map.paint["stops:circle-color"][3][2][1];
  assert.deepEqual(highlightedStops(), []);
  view.highlightVariant(0);
  assert.deepEqual(highlightedStops(), ["a", "shared"]);
  view.hoverVariant(1);
  assert.deepEqual(highlightedStops(), ["b", "shared"]);
  view.hoverVariant(null);
  assert.deepEqual(highlightedStops(), ["a", "shared"]);
  view.update([], []);
  assert.deepEqual(highlightedStops(), []);
  assert.equal(map.paint["stops:circle-radius"], undefined);
});

test("selected variant keeps final-stop effects without highlighting route lines", () => {
  const view = new MapView({}, () => {}, () => {});
  view.update([], [
    { coordinates: [[1, 2], [3, 4]], approximate: false, variantIndex: 0, label: "A", stopIds: ["a", "final-a"] },
  ]);
  map.events.load();
  view.setSelectedVariant(0);
  assert.deepEqual(map.filters["route-highlight"][2], ["==", ["get", "variantIndex"], -1]);
  assert.deepEqual(map.filters["stop-last-dot"], ["==", ["get", "stopId"], "final-a"]);
  view.setSelectedVariant(null);
  assert.deepEqual(map.filters["stop-last-dot"], ["==", ["get", "stopId"], "__no_variant_last_stop__"]);
});

test("hovering a route variant displays its final-stop dot", () => {
  const view = new MapView({}, () => {}, () => {});
  view.update([], [
    { coordinates: [[1, 2], [3, 4]], approximate: false, variantIndex: 4, label: "A", stopIds: ["a", "final-a"] },
  ]);
  map.events.load();
  view.hoverVariant(4);
  assert.deepEqual(map.filters["route-highlight"][2], ["==", ["get", "variantIndex"], 4]);
  assert.deepEqual(map.filters["stop-last-dot"], ["==", ["get", "stopId"], "final-a"]);
  view.hoverVariant(null);
  assert.deepEqual(map.filters["stop-last-dot"], ["==", ["get", "stopId"], "__no_variant_last_stop__"]);
});

test("click opens stop details and pre-load zoom is applied after fit", () => {
  const content = {};
  const view = new MapView({}, () => {}, () => {}, (id) => id === "s" ? content : null);
  view.update([{ id: "s", name: "Stop", coordinate: [1, 2], hoverLabel: "Stop — stop 2" }], []);
  view.zoomTo([1, 2]);
  map.events.load();
  assert.equal(map.sources.stops.data.features[0].properties.label, "Stop — stop 2");
  assert.deepEqual(map.lastEase.center, [1, 2]);
  assert.equal(map.lastEase.zoom, 16);
  map.features = [{ layer: { id: "stops" }, properties: { stopId: "s" } }];
  map.events.click({ point: {}, lngLat: [1, 2] });
  assert.equal(detailPopup.content, content);
  assert.equal(detailPopup.visible, true);
});

test("route colors are used by default and can be disabled", () => {
  const view = new MapView({}, () => {}, () => {});
  view.update([], [
    { coordinates: [[1, 2], [3, 4]], approximate: false, variantIndex: 0, label: "Route", routeId: "r", color: "#aabbcc", randomColor: "#234567" },
  ]);
  map.events.load();
  assert.equal(map.sources["route-lines"].data.features[0].properties.color, "#aabbcc");
  assert.equal(map.sources["route-lines"].data.features[0].properties.randomColor, "#234567");
  assert.deepEqual(map.paint["route-lines:line-color"], ["get", "color"]);
  view.setRouteColors(false);
  assert.equal(map.paint["route-lines:line-color"], "#1554a0");
  assert.equal(map.paint["route-approximations:line-color"], "#1554a0");
  view.setRouteColors(true);
  assert.deepEqual(map.paint["route-lines:line-color"], ["get", "color"]);
  view.setRandomColors(true);
  assert.deepEqual(map.paint["route-lines:line-color"], ["get", "randomColor"]);
  assert.deepEqual(map.paint["route-approximations:line-color"], ["get", "randomColor"]);
  view.setRandomColors(false);
  assert.deepEqual(map.paint["route-lines:line-color"], ["get", "color"]);
});

test("shape colors remain distinct and range highlighting can zoom to selected points", () => {
  const view = new MapView({}, () => {}, () => {});
  view.update([], [
    { coordinates: [[1, 2], [3, 4]], approximate: false, variantIndex: 0, label: "Shape A", color: "#cc0000" },
    { coordinates: [[1, 2], [5, 6]], approximate: false, variantIndex: 1, label: "Shape B", color: "#0055cc" },
  ]);
  map.events.load();
  assert.deepEqual(map.paint["route-lines:line-color"], ["get", "color"]);
  assert.deepEqual(map.sources["route-lines"].data.features.map((feature) => feature.properties.color), ["#cc0000", "#0055cc"]);
  view.highlightLines([[[1, 2], [3, 4]], [[5, 6]]]);
  assert.equal(map.sources["range-highlight-lines"].data.features.length, 1);
  assert.equal(map.sources["range-highlight-points"].data.features.length, 1);
  view.setComparisonRangeColors([[[1, 2], [3, 4]]], [[[5, 6]]], true);
  assert.deepEqual(map.sources["range-highlight-lines"].data.features.map((feature) => feature.properties.color), ["#2e7d32", "#f58220"]);
  assert.deepEqual(map.sources["range-highlight-points"].data.features.map((feature) => feature.properties.color), ["#c62828", "#f58220"]);
  view.setComparisonRangeColors([[[1, 2], [3, 4]]], [[[5, 6]]], false);
  assert.deepEqual(map.sources["range-highlight-lines"].data.features.map((feature) => feature.properties.color), ["#f58220"]);
  view.focusPoints([[1, 2], [5, 6]]);
  assert.equal(map.fitBoundsCount, 2);
});

test("clicking a route line opens compact route details", () => {
  const content = {};
  const view = new MapView({}, () => {}, () => {}, undefined, (id, index) => id === "r" && index === 4 ? content : null);
  map.events.load();
  map.features = [{ layer: { id: "route-hit" }, properties: { routeId: "r", variantIndex: 4 } }];
  map.events.click({ point: {}, lngLat: [1, 2] });
  assert.equal(detailPopup.content, content);
  assert.equal(detailPopup.visible, true);
});

test("can disable automatic refocus after route or variant updates", () => {
  const view = new MapView({}, () => {}, () => {});
  assert.equal(view.autoRefocusEnabledState, true);
  view.setAutoRefocusEnabled(false);
  assert.equal(view.autoRefocusEnabledState, false);
  view.update([{ id: "s", name: "Stop", coordinate: [1, 2] }], [
    { coordinates: [[1, 2], [3, 4]], approximate: false, variantIndex: 0, label: "Variant", routeId: "r" },
  ], true);
  map.events.load();
  assert.equal(view.autoRefocusEnabledState, false);
  assert.equal(map.fitBoundsCount, 0);
  view.update([{ id: "t", name: "Other", coordinate: [5, 6] }], [], true);
  assert.equal(map.fitBoundsCount, 0);
});

test("hovering a stop without an ID changes its color and clears it on mouseout", () => {
  const view = new MapView({}, () => {}, () => {});
  view.update([{ id: null, name: "Unnamed", coordinate: [1, 2] }], []);
  map.events.load();
  map.features = [{ layer: { id: "stops" }, properties: { stopId: "", stopIndex: 0 } }];
  map.events.mousemove({ point: {}, lngLat: [1, 2] });
  assert.deepEqual(map.paint["stops:circle-color"][1], ["==", ["get", "stopIndex"], 0]);
  map.events.mouseout();
  assert.deepEqual(map.paint["stops:circle-color"][1], ["==", ["get", "stopIndex"], -1]);
});
