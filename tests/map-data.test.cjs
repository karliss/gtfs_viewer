const test = require("node:test");
const assert = require("node:assert/strict");
const { strToU8, zipSync } = require("fflate");
const { getMatchingRows, getRouteVariants, loadGtfs } = require("../dist/gtfs.cjs");
const { coordinate, indexShapes, indexStops, mapStop, variantMapData } = require("../dist/map-data.cjs");

function feedFrom(files) {
  return loadGtfs(zipSync(Object.fromEntries(
    Object.entries(files).map(([name, text]) => [name, strToU8(text)]),
  )));
}

test("coordinates reject absent, malformed and out-of-range values", () => {
  assert.deepEqual(coordinate("0", "0"), [0, 0]);
  assert.deepEqual(coordinate("-180", "90"), [-180, 90]);
  for (const [lon, lat] of [["", "2"], ["  ", "2"], ["1", null], ["NaN", "2"], ["0x10", "2"], ["181", "0"], ["0", "-91"]]) {
    assert.equal(coordinate(lon, lat), null);
  }
});

test("stop search uses all fields and all matching rows rather than a page", () => {
  const feed = feedFrom({
    "stops.txt": "stop_id,stop_name,stop_lat,stop_lon,custom\n1,First,1,2,Hidden\n2,Second,3,4,Other\n3,Third,,,Hidden\n",
    "routes.txt": "route_id,route_type\nr,3\n",
  });
  const stops = feed.tables.find((table) => table.kind === "stops.txt");
  assert.deepEqual(getMatchingRows(stops, " hIdDeN ").map(mapStop).map((stop) => stop.id), ["1", "3"]);
  assert.equal(getMatchingRows(stops, "").length, 3);
  assert.equal(getMatchingRows(feed.tables.find((table) => table.kind === "routes.txt"), "bus").length, 1);
});

test("variant geometry orders shape points and retains repeated and missing stops", () => {
  const feed = feedFrom({
    "stops.txt": "stop_id,stop_name,stop_lat,stop_lon\na,A,10,20\nb,B,11,21\n",
    "trips.txt": "route_id,trip_id,shape_id\nr,t,s\n",
    "stop_times.txt": "trip_id,stop_id,stop_sequence\nt,a,1\nt,b,2\nt,a,3\nt,missing,4\n",
    "shapes.txt": "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\ns,12,22,10\ns,10,20,2\ns,99,4,3\ns,11,21,bad\n",
  });
  const variant = getRouteVariants(feed, "r").variants[0];
  const data = variantMapData(indexShapes(feed), variant, indexStops(feed));
  assert.deepEqual(data.line, [[20, 10], [22, 12]]);
  assert.equal(data.approximate, false);
  assert.equal(data.invalidShapePoints, 2);
  assert.deepEqual(data.stops.map((stop) => stop.id), ["a", "b", "a", "missing"]);
  assert.equal(data.stops[3].coordinate, null);
});

test("missing or unusable shape uses located stops for a dashed approximation", () => {
  const feed = feedFrom({
    "stops.txt": "stop_id,stop_lat,stop_lon\na,1,2\nb,3,4\nc,,\n",
    "trips.txt": "route_id,trip_id,shape_id\nr,t,s\n",
    "stop_times.txt": "trip_id,stop_id,stop_sequence\nt,a,1\nt,c,2\nt,b,3\n",
    "shapes.txt": "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\ns,1,2,0\n",
  });
  const variant = getRouteVariants(feed, "r").variants[0];
  const data = variantMapData(indexShapes(feed), variant, indexStops(feed));
  assert.equal(data.approximate, true);
  assert.deepEqual(data.line, [[2, 1], [4, 3]]);
  variant.stops = ["c"];
  assert.deepEqual(variantMapData(indexShapes(feed), variant, indexStops(feed)).line, []);
});
