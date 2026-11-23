const test = require("node:test");
const assert = require("node:assert/strict");
const { strToU8, zipSync } = require("fflate");
const { getReferencedRoute, getRouteVariants, indexRoutes, loadGtfs } = require("../dist/gtfs.cjs");

function archive(files) {
  return zipSync(Object.fromEntries(
    Object.entries(files).map(([name, text]) => [name, strToU8(text)]),
  ));
}

test("loads typed rows while preserving quoted CSV, unknown columns, and ZIP paths", () => {
  const feed = loadGtfs(archive({
    "feed/STOPS.TXT": '\ufeffstop_id,stop_name,description\r\n001,"Main, Street","First\nSecond"\r\n',
    "feed/routes.txt": "route_id,route_name\n01,Bus\n",
    "feed/extension.txt": "id,value\n1,example\n",
    "readme.md": "ignored",
    "__MACOSX/._stops.txt": "ignored",
    "feed/locations.geojson": "{}",
  }));
  assert.deepEqual(feed.unrecognizedFiles, [
    "__MACOSX/._stops.txt", "feed/extension.txt", "feed/locations.geojson", "readme.md",
  ]);
  const [extension, routes, stops] = feed.tables;
  assert.equal(extension.kind, "unknown");
  assert.deepEqual(extension.rows, [{
    fields: {}, unrecognizedColumns: { id: "1", value: "example" }, extraValues: [],
  }]);
  assert.equal(routes.kind, "routes.txt");
  assert.equal(routes.rows[0].fields.route_id, "01");
  assert.equal(routes.rows[0].fields.route_type, null);
  assert.deepEqual(routes.rows[0].unrecognizedColumns, { route_name: "Bus" });
  assert.equal(stops.kind, "stops.txt");
  assert.deepEqual(stops.columns, ["stop_id", "stop_name", "description"]);
  assert.equal(stops.rows[0].fields.stop_id, "001");
  assert.equal(stops.rows[0].fields.stop_name, "Main, Street");
  assert.equal(stops.rows[0].fields.stop_desc, null);
  assert.deepEqual(stops.rows[0].unrecognizedColumns, { description: "First\nSecond" });
  assert.equal(stops.hasExtraValues, false);
});

test("recognizes fields in different GTFS Schedule tables", () => {
  const examples = {
    "agency.txt": ["agency_timezone", "Europe/Riga"],
    "trips.txt": ["safe_duration_factor", "1.5"],
    "stop_times.txt": ["pickup_booking_rule_id", "booking"],
    "fare_leg_join_rules.txt": ["from_network_id", "network"],
    "fare_products.txt": ["fare_media_id", "card"],
    "location_group_stops.txt": ["location_group_id", "group"],
    "booking_rules.txt": ["prior_notice_service_id", "service"],
    "translations.txt": ["field_value", "text"],
  };
  const feed = loadGtfs(archive(Object.fromEntries(
    Object.entries(examples).map(([name, [field, value]]) => [name, `${field}\n${value}\n`]),
  )));
  assert.deepEqual(feed.unrecognizedFiles, []);
  for (const table of feed.tables) {
    const [field, value] = examples[table.name];
    assert.equal(table.kind, table.name);
    assert.equal(table.rows[0].fields[field], value);
    assert.deepEqual(table.rows[0].unrecognizedColumns, {});
  }
});

test("preserves short and long rows, distinguishing absent values from empty values", () => {
  const [table] = loadGtfs(archive({
    "stops.txt": 'stop_id,stop_name,custom,another\n1,,x\n2,Name,y,z,"extra, value",\n3\n',
  })).tables;
  assert.equal(table.hasExtraValues, true);
  assert.equal(table.rows[0].fields.stop_name, "");
  assert.equal(table.rows[0].fields.stop_lat, null);
  assert.deepEqual(table.rows[0].unrecognizedColumns, { custom: "x", another: null });
  assert.deepEqual(table.rows[0].extraValues, []);
  assert.deepEqual(table.rows[1].extraValues, ["extra, value", ""]);
  assert.equal(table.rows[2].fields.stop_name, null);
  assert.deepEqual(table.rows[2].unrecognizedColumns, { custom: null, another: null });
});

test("keeps arbitrary unrecognized column names as own properties", () => {
  const [table] = loadGtfs(archive({
    "stops.txt": "__proto__,constructor,stop_id\nfirst,second,3\n",
  })).tables;
  assert.deepEqual(Object.keys(table.rows[0].unrecognizedColumns), ["__proto__", "constructor"]);
  assert.equal(table.rows[0].unrecognizedColumns.__proto__, "first");
  assert.equal(table.rows[0].unrecognizedColumns.constructor, "second");
});

test("loads a header-only table and ignores directory entries", () => {
  const zip = zipSync({ "feed/": new Uint8Array(), "feed/agency.txt": strToU8("agency_id\n") });
  const feed = loadGtfs(zip);
  assert.deepEqual(feed.unrecognizedFiles, []);
  assert.deepEqual(feed.tables[0], {
    name: "agency.txt", kind: "agency.txt", columns: ["agency_id"], rows: [], hasExtraValues: false,
  });
});

test("reports invalid archives, missing tables and duplicate filenames", () => {
  assert.throws(() => loadGtfs(strToU8("not a zip")), /valid.*ZIP/i);
  assert.throws(() => loadGtfs(archive({ "readme.md": "hello" })), /no.*\.txt/i);
  assert.throws(() => loadGtfs(archive({ "one/stops.txt": "id\n1", "two/STOPS.TXT": "id\n2" })), /multiple files named/i);
});

test("reports malformed CSV, empty headers and duplicate columns", () => {
  assert.throws(() => loadGtfs(archive({ "stops.txt": 'id,name\n1,"unterminated' })), /parse stops.txt/i);
  assert.throws(() => loadGtfs(archive({ "stops.txt": "id,\n1,2\n" })), /non-empty header/i);
  assert.throws(() => loadGtfs(archive({ "stops.txt": "id,id\n1,2\n" })), /duplicate column/i);
});

test("reports invalid UTF-8 in parsed tables", () => {
  const zip = zipSync({ "stops.txt": new Uint8Array([0xff]) });
  assert.throws(() => loadGtfs(zip), /valid UTF-8/);
});

test("groups route trips by shape and orders the representative trip's stops", () => {
  const feed = loadGtfs(archive({
    "trips.txt": "route_id,trip_id,shape_id\nr1,t1,s1\nr1,t2,s1\nr1,t3,s2\nr1,t4,\nr2,t5,s3\n",
    "stop_times.txt": "trip_id,stop_id,stop_sequence\n"
      + "t2,b,10\nt2,a,2\nt2,a,3\nt3,c,1\nt5,d,1\n",
    "stops.txt": "stop_id,stop_name\na,Alpha\nb,Beta\n",
  }));
  assert.deepEqual(getRouteVariants(feed, "r1"), {
    variants: [
      { shapeId: "s1", stops: ["a", "a", "b"] },
      { shapeId: "s2", stops: ["c"] },
    ],
    tripsWithoutShape: 1,
  });
});

test("handles missing tables and shape trips without stop times", () => {
  const feed = loadGtfs(archive({
    "trips.txt": "route_id,trip_id,shape_id\nr,t,s\nr,u,\n",
  }));
  assert.deepEqual(getRouteVariants(feed, "r"), {
    variants: [{ shapeId: "s", stops: [] }],
    tripsWithoutShape: 1,
  });
  assert.deepEqual(getRouteVariants(feed, "other"), { variants: [], tripsWithoutShape: 0 });
});

test("resolves route references from other tables without linking missing IDs", () => {
  const feed = loadGtfs(archive({
    "routes.txt": "route_id,route_short_name\nr,First\nr,Duplicate\n,No ID\n",
    "trips.txt": "route_id,trip_id\nr,t\n",
  }));
  const routes = indexRoutes(feed);
  for (const [table, column] of [
    ["trips.txt", "route_id"],
    ["transfers.txt", "from_route_id"],
    ["transfers.txt", "to_route_id"],
    ["unknown", "route_id"],
  ]) {
    assert.equal(getReferencedRoute(routes, table, column, "r").fields.route_short_name, "First");
  }
  assert.equal(getReferencedRoute(routes, "routes.txt", "route_id", "r"), undefined);
  assert.equal(getReferencedRoute(routes, "trips.txt", "trip_id", "r"), undefined);
  assert.equal(getReferencedRoute(routes, "trips.txt", "route_id", "missing"), undefined);
  assert.equal(getReferencedRoute(routes, "trips.txt", "route_id", ""), undefined);
  assert.equal(getReferencedRoute(routes, "trips.txt", "route_id", null), undefined);
  assert.equal(indexRoutes(loadGtfs(archive({ "trips.txt": "trip_id\nt\n" }))).size, 0);
});

test("preserves missing stop IDs and variants with no stop times", () => {
  const feed = loadGtfs(archive({
    "trips.txt": "route_id,trip_id,shape_id\nr,t,s1\nr,u,s2\n",
    "stop_times.txt": "trip_id,stop_sequence,location_group_id,location_id\nt,1,group,\nt,2,,location\n",
  }));
  assert.deepEqual(getRouteVariants(feed, "r"), {
    variants: [
      { shapeId: "s1", stops: [null, null] },
      { shapeId: "s2", stops: [] },
    ],
    tripsWithoutShape: 0,
  });
});
