const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

let map;
let popup;
let detailPopup;
class FakeMap {
  constructor() {
    map = this;
    this.events = {};
    this.sources = {};
    this.filters = {};
    this.paint = {};
    this.features = [];
    this.canvas = { style: {} };
  }
  on(event, handler) { this.events[event] = handler; }
  addControl() {}
  addSource(id, source) { this.sources[id] = { data: source.data, setData(data) { this.data = data; } }; }
  addLayer() {}
  setFilter(id, filter) { this.filters[id] = filter; }
  setPaintProperty(id, name, value) { this.paint[`${id}:${name}`] = value; }
  getSource(id) { return this.sources[id]; }
  queryRenderedFeatures() { return this.features; }
  getCanvas() { return this.canvas; }
  resize() {}
  fitBounds() {}
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
try {
  ({ MapView } = require("../dist/map-view.cjs"));
} finally {
  Module._load = originalLoad;
}

test("map hover displays safe labels, prioritizes stops, and clears sidebar highlight", () => {
  const hovered = [];
  const view = new MapView({}, () => {}, (id) => hovered.push(id));
  view.update([{ id: "stop-1", name: "<Stop>", coordinate: [1, 2] }], [
    { coordinates: [[1, 2], [3, 4]], approximate: false, variantIndex: 2, label: "Variant A" },
  ]);
  map.events.load();
  assert.deepEqual(map.sources.stops.data.features[0].properties, { stopId: "stop-1", label: "<Stop>" });
  assert.equal(map.sources["route-lines"].data.features[0].properties.label, "Variant A");
  map.features = [
    { layer: { id: "route-hit" }, properties: { label: "Variant A" } },
    { layer: { id: "stops" }, properties: { stopId: "stop-1", label: "<Stop>" } },
  ];
  map.events.mousemove({ point: {}, lngLat: [1, 2] });
  assert.equal(popup.text, "<Stop>");
  assert.equal(popup.visible, true);
  assert.deepEqual(hovered, ["stop-1"]);
  map.features = [{ layer: { id: "route-hit" }, properties: { label: "Variant A" } }];
  map.events.mousemove({ point: {}, lngLat: [2, 3] });
  assert.equal(popup.text, "Variant A");
  assert.deepEqual(hovered, ["stop-1", null]);
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
  const view = new MapView({}, () => {}, () => {});
  map.events.load();
  view.highlightVariant(3);
  map.features = [{ layer: { id: "route-hit" }, properties: { label: "Other", variantIndex: 5 } }];
  map.events.mousemove({ point: {}, lngLat: [1, 2] });
  assert.deepEqual(map.filters["route-highlight"][2], ["==", ["get", "variantIndex"], 5]);
  map.events.mouseout();
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
  const highlightedStops = () => map.paint["stops:circle-color"][1][2][1];
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
    { coordinates: [[1, 2], [3, 4]], approximate: false, variantIndex: 0, label: "Route", routeId: "r", color: "#aabbcc" },
  ]);
  map.events.load();
  assert.equal(map.sources["route-lines"].data.features[0].properties.color, "#aabbcc");
  assert.deepEqual(map.paint["route-lines:line-color"], ["get", "color"]);
  view.setRouteColors(false);
  assert.equal(map.paint["route-lines:line-color"], "#1554a0");
  assert.equal(map.paint["route-approximations:line-color"], "#1554a0");
  view.setRouteColors(true);
  assert.deepEqual(map.paint["route-lines:line-color"], ["get", "color"]);
});

test("clicking a route line opens compact route details", () => {
  const content = {};
  const view = new MapView({}, () => {}, () => {}, undefined, (id) => id === "r" ? content : null);
  map.events.load();
  map.features = [{ layer: { id: "route-hit" }, properties: { routeId: "r" } }];
  map.events.click({ point: {}, lngLat: [1, 2] });
  assert.equal(detailPopup.content, content);
  assert.equal(detailPopup.visible, true);
});
