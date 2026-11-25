const test = require("node:test");
const assert = require("node:assert/strict");
const { strToU8, zipSync } = require("fflate");
const {
  decodeRouteType, formatTimetableDayRange, getMatchingRows, getReferencedRoute, getRouteVariants, getTableColumns, getVariantTableRows,
  getVariantTimetable, getDateSchedule, getTripFares, isServiceActiveOnDate, loadGtfs, summarizeTripField,
  decodeTripFieldValue, WHEELCHAIR_ACCESSIBLE_VALUES, BIKES_ALLOWED_VALUES, CARS_ALLOWED_VALUES,
} = require("../dist/gtfs.cjs");
const {
  WarningCollector, WARNING_DESCRIPTIONS, WARNING_TYPES,
} = require("../dist/warnings.cjs");

function archive(files) {
  return zipSync(Object.fromEntries(
    Object.entries(files).map(([name, text]) => [name, strToU8(text)]),
  ));
}

test("warning collector supports counts, filtering, clearing and replacement", () => {
  const collector = new WarningCollector();
  const warning = {
    type: "unrecognized_files",
    parameters: { file: "readme.txt" },
    relatedObjectIds: [],
  };
  collector.add(warning);
  assert.equal(collector.count("unrecognized_files"), 1);
  assert.equal(collector.count("extra_values"), 0);
  assert.deepEqual(collector.forTypes(["unrecognized_files"]), [warning]);
  assert.deepEqual(collector.forTypes(["extra_values"]), []);
  collector.replace([warning, warning]);
  assert.equal(collector.all.length, 2);
  collector.clear();
  assert.equal(collector.all.length, 0);
});

test("warning descriptions cover every warning type with severity and scope", () => {
  assert.deepEqual([...WARNING_TYPES].sort(), [
    "extra_values",
    "invalid_values",
    "missing_or_duplicate_ids",
    "missing_values",
    "unrecognized_columns",
    "unrecognized_files",
  ]);
  for (const type of WARNING_TYPES) {
    const description = WARNING_DESCRIPTIONS[type];
    assert.equal(description.id, type);
    assert.ok(description.messageTemplate.length > 0);
    assert.ok(["error", "warning", "info"].includes(description.severity));
    assert.ok(["archive", "table", "element"].includes(description.scope));
  }
});

test("loadGtfs attaches all warning types to feed and collector", () => {
  const collector = new WarningCollector();
  const feed = loadGtfs(archive({
    "routes.txt": "route_id,custom,route_type\nR1,one,bad\nR1,two,3\n",
    "stops.txt": "stop_id,stop_name,stop_desc\nS1,Main\nS2,Second,Description,extra\n,Missing\n",
    "readme.md": "documentation",
  }), collector);
  assert.equal(feed.warnings.length, 8);
  assert.equal(collector.all.length, 8);
  for (const type of WARNING_TYPES) {
    assert.ok(feed.warnings.some((warning) => warning.type === type));
  }
});

test("reports extra values with CSV row numbers and values", () => {
  const collector = new WarningCollector();
  const feed = loadGtfs(archive({
    "stops.txt": 'stop_id,stop_name\nS1,Main\nS2,Second,extra,"more extra"\n',
  }), collector);
  const warnings = feed.warnings.filter((warning) => warning.type === "extra_values");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].csvRowNumber, 3);
  assert.deepEqual(warnings[0].parameters, {
    file: "stops.txt", row: 3, count: 2, values: ["extra", "more extra"],
  });
  assert.deepEqual(warnings[0].relatedObjectIds, []);
  assert.equal(collector.count("extra_values"), 1);
});

test("reports missing values with CSV row numbers", () => {
  const collector = new WarningCollector();
  const feed = loadGtfs(archive({
    "stops.txt": "stop_id,stop_name,stop_desc\nS1,Main\nS2\n",
  }), collector);
  const warnings = feed.warnings.filter((warning) => warning.type === "missing_values");
  assert.equal(warnings.length, 2);
  assert.equal(warnings[0].csvRowNumber, 2);
  assert.deepEqual(warnings[0].parameters, { file: "stops.txt", row: 2, count: 1 });
  assert.equal(warnings[1].csvRowNumber, 3);
  assert.deepEqual(warnings[1].parameters, { file: "stops.txt", row: 3, count: 2 });
  assert.equal(collector.count("missing_values"), 2);
});

test("reports unrecognized CSV columns globally", () => {
  const collector = new WarningCollector();
  const feed = loadGtfs(archive({
    "routes.txt": "route_id,route_name,custom\nR1,Route,one\n",
  }), collector);
  const warnings = feed.warnings.filter((warning) => warning.type === "unrecognized_columns");
  assert.deepEqual(warnings, [{
    type: "unrecognized_columns",
    parameters: { file: "routes.txt", column: "route_name" },
    relatedObjectIds: [],
  }, {
    type: "unrecognized_columns",
    parameters: { file: "routes.txt", column: "custom" },
    relatedObjectIds: [],
  }]);
  assert.equal(collector.count("unrecognized_columns"), 2);
});

test("reports missing and duplicate IDs with related object IDs", () => {
  const collector = new WarningCollector();
  const feed = loadGtfs(archive({
    "routes.txt": "route_id,route_short_name\nR1,One\nR1,Duplicate\n,Missing\n",
  }), collector);
  const warnings = feed.warnings.filter((warning) => warning.type === "missing_or_duplicate_ids");
  assert.equal(warnings.length, 2);
  assert.equal(warnings[0].csvRowNumber, 3);
  assert.deepEqual(warnings[0].parameters, {
    file: "routes.txt", row: 3, column: "route_id", issue: "duplicate", id: "R1", idSuffix: ": R1",
  });
  assert.deepEqual(warnings[0].relatedObjectIds, ["R1"]);
  assert.equal(warnings[1].csvRowNumber, 4);
  assert.deepEqual(warnings[1].parameters, {
    file: "routes.txt", row: 4, column: "route_id", issue: "missing", idSuffix: "",
  });
  assert.deepEqual(warnings[1].relatedObjectIds, []);
});

test("does not report duplicate service_id values in calendar_dates.txt", () => {
  const collector = new WarningCollector();
  const feed = loadGtfs(archive({
    "calendar_dates.txt": "service_id,date,exception_type\nweekday,20260101,1\nweekday,20260102,2\n",
  }), collector);
  const warnings = feed.warnings.filter((warning) => warning.type === "missing_or_duplicate_ids");
  assert.equal(warnings.length, 0);
  assert.equal(collector.count("missing_or_duplicate_ids"), 0);
});

test("does not report duplicate IDs in shapes.txt", () => {
  const collector = new WarningCollector();
  const feed = loadGtfs(archive({
    "shapes.txt": "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\nshape1,1,2,1\nshape1,1.1,2.1,2\n",
  }), collector);
  const warnings = feed.warnings.filter((warning) => warning.type === "missing_or_duplicate_ids");
  assert.equal(warnings.length, 0);
  assert.equal(collector.count("missing_or_duplicate_ids"), 0);
});

test("does not report duplicate service_id or fare_product_id values", () => {
  const collector = new WarningCollector();
  const feed = loadGtfs(archive({
    "calendar.txt": "service_id,monday,tuesday\nweekday,1,1\nweekday,1,1\n",
    "fare_products.txt": "fare_product_id,fare_product_name\nproduct1,First\nproduct1,Second\n",
  }), collector);
  const warnings = feed.warnings.filter((warning) => warning.type === "missing_or_duplicate_ids");
  assert.equal(warnings.length, 0);
  assert.equal(collector.count("missing_or_duplicate_ids"), 0);
});

test("reports missing and duplicate IDs in route_networks.txt and pathways.txt", () => {
  const collector = new WarningCollector();
  const feed = loadGtfs(archive({
    "route_networks.txt": "network_id,route_id\nn1,r1\nn1,r1\nn1,\n",
    "pathways.txt": "pathway_id,from_stop_id,to_stop_id\np1,s1,s2\np1,s2,s3\n,\ns1,s2\n",
  }), collector);
  const warnings = feed.warnings.filter((warning) => warning.type === "missing_or_duplicate_ids");
  assert.equal(warnings.filter((warning) => warning.parameters.file === "route_networks.txt").length, 2);
  assert.equal(warnings.filter((warning) => warning.parameters.file === "pathways.txt").length, 2);
  assert.ok(warnings.some((warning) =>
    warning.parameters.file === "route_networks.txt" && warning.parameters.issue === "duplicate"));
  assert.ok(warnings.some((warning) =>
    warning.parameters.file === "route_networks.txt" && warning.parameters.issue === "missing"));
  assert.ok(warnings.some((warning) =>
    warning.parameters.file === "pathways.txt" && warning.parameters.issue === "duplicate"));
  assert.ok(warnings.some((warning) =>
    warning.parameters.file === "pathways.txt" && warning.parameters.issue === "missing"));
});

test("reports unrecognized archive files and ignores metadata", () => {
  const collector = new WarningCollector();
  const feed = loadGtfs(archive({
    "routes.txt": "route_id\nR1\n",
    "readme.md": "documentation",
    "data.geojson": "{}",
    "__MACOSX/._routes.txt": "ignored",
  }), collector);
  const warnings = feed.warnings.filter((warning) => warning.type === "unrecognized_files");
  assert.deepEqual(new Set(warnings.map((warning) => warning.parameters.file)), new Set([
    "data.geojson", "readme.md",
  ]));
  assert.equal(warnings.some((warning) => warning.parameters.file === "__MACOSX/._routes.txt"), false);
  assert.equal(warnings.length, 2);
  assert.equal(collector.count("unrecognized_files"), 2);
});

test("reports feed index initialization progress", () => {
  const progress = [];
  loadGtfs(archive({
    "routes.txt": "route_id\nR1\n",
  }), (update) => progress.push(update));
  assert.deepEqual(progress.filter((update) => update.phase === "indexing"), [
    { phase: "indexing", completed: 0, total: 1 },
    { phase: "indexing", completed: 1, total: 1 },
  ]);
});

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
    "trips.txt": ["safe_duration_factor", 1.5],
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
  assert.equal(table.rows[0].fields.stop_name, null);
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

test("separates recognized table columns from additional fields, even without rows", () => {
  const feed = loadGtfs(archive({
    "trips.txt": "route_id, shape_id,trip_id,custom,constructor\nr, s,t,,x\n",
    "stops.txt": "stop_name,custom,stop_id\n",
    "extension.txt": "route_id,custom\nr,value\n",
  }));
  const trips = feed.tables.find((table) => table.kind === "trips.txt");
  assert.deepEqual(getTableColumns(trips), {
    recognized: ["route_id", "shape_id", "trip_id"],
    additional: ["custom", "constructor"],
  });
  assert.deepEqual(trips.rows[0].unrecognizedColumns, {
    custom: "", constructor: "x",
  });
  assert.equal(trips.rows[0].fields.shape_id, "s");
  const stops = feed.tables.find((table) => table.kind === "stops.txt");
  assert.deepEqual(getTableColumns(stops), {
    recognized: ["stop_name", "stop_id"], additional: ["custom"],
  });
  const extension = feed.tables.find((table) => table.kind === "unknown");
  assert.deepEqual(getTableColumns(extension), {
    recognized: [], additional: ["route_id", "custom"],
  });
  assert.deepEqual(extension.rows[0].unrecognizedColumns, { route_id: "r", custom: "value" });
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
  assert.throws(() => loadGtfs(archive({ "stops.txt": "stop_id, stop_id \n1,2\n" })), /duplicate column/i);
  assert.throws(() => loadGtfs(archive({ "stops.txt": "stop_id, \t \n1,2\n" })), /non-empty header/i);
});

test("trims headers and ID values in the sample trips", () => {
  const feed = loadGtfs(archive({
    "trips.txt": "route_id, service_id, trip_id, trip_headsign, trip_short_name, direction_id, block_id, shape_id, wheelchair_accessible, bikes_allowed\n"
      + "5501720, 210688, 210688, , , , , 124085, , \n"
      + "2301590, 214392, 214392, , , , , 121670, , \n"
      + "2200045, 239911, 239911, , , , , 137118, , \n",
  }));
  const trips = feed.tables[0];
  assert.equal(trips.rows[0].fields.shape_id, "124085");
  assert.equal(trips.rows[0].fields.trip_id, "210688");
  assert.equal(trips.rows[0].fields.trip_headsign, null);
  assert.deepEqual(trips.rows[0].unrecognizedColumns, {});
  const { variants, tripsCount, tripsWithoutVariant } = getRouteVariants(feed, "5501720");
  assert.equal(tripsCount, 1);
  assert.equal(tripsWithoutVariant, 0);
  assert.equal(variants[0].shapeId, "124085");
});

test("trims recognized fields while preserving unrecognized values except IDs", () => {
  const feed = loadGtfs(archive({
    "routes.txt": "route_id,route_short_name,custom_id,note\n r ,  Name  , ext ,  text  \n",
    "trips.txt": "route_id,trip_id,shape_id\n r , t , s \n r , t2 , s \n",
    "stop_times.txt": "trip_id,stop_id,stop_sequence\n t , a ,1\n t2 , a ,1\n",
    "extension.txt": "id,other_id,description\n x , y , value \n",
  }));
  const route = feed.tables.find((table) => table.kind === "routes.txt").rows[0];
  assert.equal(route.fields.route_id, "r");
  assert.equal(route.fields.route_short_name, "Name");
  assert.deepEqual(route.unrecognizedColumns, { custom_id: "ext", note: "  text  " });
  const extension = feed.tables.find((table) => table.kind === "unknown").rows[0];
  assert.deepEqual(extension.unrecognizedColumns, { id: "x", other_id: "y", description: " value " });
  const { variants } = getRouteVariants(feed, route.fields.route_id);
  assert.equal(variants.length, 1);
  assert.equal(variants[0].shapeId, "s");
  assert.deepEqual(variants[0].stops, ["a"]);
  assert.deepEqual(variants[0].trips.map(({ fields }) => fields.trip_id), ["t", "t2"]);
});

test("summarizes trip accessibility with missing values left unprovided", () => {
  const [table] = loadGtfs(archive({
    "trips.txt": "trip_id,wheelchair_accessible,bikes_allowed,cars_allowed\n1,1,2,1\n2,1,2,0\n3,2,,2\n4,,2,\n5\n",
  })).tables;
  assert.equal(WHEELCHAIR_ACCESSIBLE_VALUES.UNKNOWN, 0);
  assert.equal(WHEELCHAIR_ACCESSIBLE_VALUES.YES, 1);
  assert.equal(WHEELCHAIR_ACCESSIBLE_VALUES.NO, 2);
  assert.equal(BIKES_ALLOWED_VALUES.UNKNOWN, 0);
  assert.equal(BIKES_ALLOWED_VALUES.YES, 1);
  assert.equal(BIKES_ALLOWED_VALUES.NO, 2);
  assert.equal(CARS_ALLOWED_VALUES.UNKNOWN, 0);
  assert.equal(CARS_ALLOWED_VALUES.YES, 1);
  assert.equal(CARS_ALLOWED_VALUES.NO, 2);
  assert.equal(decodeTripFieldValue(null), "Unknown");
  assert.equal(decodeTripFieldValue(0), "Unknown");
  assert.equal(decodeTripFieldValue(1), "Yes");
  assert.equal(decodeTripFieldValue(2), "No");
  assert.equal(decodeTripFieldValue(3), "Unrecognized");
  assert.deepEqual(summarizeTripField([], "bikes_allowed"), []);
  assert.deepEqual(summarizeTripField(table.rows.slice(0, 2), "wheelchair_accessible"), [
    { value: 1, count: 2, percent: null },
  ]);
  assert.deepEqual(summarizeTripField(table.rows, "wheelchair_accessible"), [
    { value: 1, count: 2, percent: 40 },
    { value: 2, count: 1, percent: 20 },
    { value: null, count: 2, percent: 40 },
  ]);
  assert.deepEqual(summarizeTripField(table.rows, "bikes_allowed"), [
    { value: 2, count: 3, percent: 60 },
    { value: null, count: 2, percent: 40 },
  ]);
  assert.deepEqual(summarizeTripField(table.rows.slice(0, 3), "bikes_allowed"), [
    { value: 2, count: 2, percent: 66.7 },
    { value: null, count: 1, percent: 33.3 },
  ]);
  assert.deepEqual(summarizeTripField(table.rows, "cars_allowed"), [
    { value: 1, count: 1, percent: 20 },
    { value: 0, count: 1, percent: 20 },
    { value: 2, count: 1, percent: 20 },
    { value: null, count: 2, percent: 40 },
  ]);
});

test("normalizes numeric fields and preserves missing values as null", () => {
  const feed = loadGtfs(archive({
    "stops.txt": "stop_id,location_type,wheelchair_boarding,stop_name,stop_access\ns1,,  ,,\ns2,2,1, Stop ,\n",
    "routes.txt": "route_id,continuous_pickup,continuous_drop_off\nr,,\n",
    "stop_times.txt": "trip_id,pickup_type,timepoint,continuous_pickup\nt,2,,\nu\n",
    "calendar.txt": "service_id,monday,tuesday\ns,1,\n",
    "fare_attributes.txt": "fare_id,transfers\nf,\n",
    "translations.txt": "language,table_name\nen,\n",
    "extension.txt": "pickup_type\n \n",
  }));
  const stops = feed.tables.find((table) => table.kind === "stops.txt");
  assert.equal(stops.rows[0].fields.location_type, null);
  assert.equal(stops.rows[0].fields.wheelchair_boarding, null);
  assert.equal(stops.rows[0].fields.stop_name, null);
  assert.equal(stops.rows[1].fields.location_type, 2);
  assert.equal(stops.rows[1].fields.stop_name, "Stop");
  assert.equal(stops.rows[0].fields.stop_access, null);
  const routes = feed.tables.find((table) => table.kind === "routes.txt");
  assert.equal(routes.rows[0].fields.continuous_pickup, null);
  assert.equal(routes.rows[0].fields.continuous_drop_off, null);
  const times = feed.tables.find((table) => table.kind === "stop_times.txt");
  assert.equal(times.rows[0].fields.pickup_type, 2);
  assert.equal(times.rows[0].fields.timepoint, null);
  assert.equal(times.rows[0].fields.continuous_pickup, null);
  assert.equal(times.rows[1].fields.timepoint, null);
  assert.equal(times.rows[1].fields.continuous_pickup, null);
  assert.equal(times.rows[1].fields.pickup_type, null);
  const calendar = feed.tables.find((table) => table.kind === "calendar.txt");
  assert.equal(calendar.rows[0].fields.monday, 1);
  assert.equal(calendar.rows[0].fields.tuesday, null);
  assert.equal(calendar.rows[0].fields.wednesday, null);
  assert.equal(feed.tables.find((table) => table.kind === "fare_attributes.txt").rows[0].fields.transfers, null);
  assert.equal(feed.tables.find((table) => table.kind === "translations.txt").rows[0].fields.table_name, null);
  assert.equal(feed.tables.find((table) => table.kind === "unknown").rows[0].unrecognizedColumns.pickup_type, " ");
});

test("reports invalid UTF-8 in parsed tables", () => {
  const zip = zipSync({ "stops.txt": new Uint8Array([0xff]) });
  assert.throws(() => loadGtfs(zip), /valid UTF-8/);
});

test("normalizes field values and warns when numeric parsing fails", () => {
  const collector = new WarningCollector();
  const feed = loadGtfs(archive({
    "stops.txt": "stop_id,stop_name,stop_lat,stop_lon,location_type\n"
      + " s1 , Main Street , 56.9 , 24.1 , 2 \n"
      + "s2,Invalid,west,25,1.5\n"
      + "s3,,,,\n"
      + "s4\n",
  }), collector);
  const stops = feed.tables[0];
  assert.deepEqual(stops.rows[0].fields, {
    stop_id: "s1", stop_code: null, stop_name: "Main Street", tts_stop_name: null, stop_desc: null,
    stop_lat: 56.9, stop_lon: 24.1, zone_id: null, stop_url: null, location_type: 2,
    parent_station: null, stop_timezone: null, wheelchair_boarding: null, level_id: null,
    platform_code: null, stop_access: null,
  });
  assert.equal(stops.rows[1].fields.stop_lat, null);
  assert.equal(stops.rows[1].fields.location_type, null);
  assert.equal(stops.rows[2].fields.stop_name, null);
  assert.equal(stops.rows[2].fields.stop_lat, null);
  assert.equal(stops.rows[3].fields.stop_name, null);
  assert.deepEqual(feed.warnings.filter(({ type }) => type === "invalid_values").map(({ parameters, csvRowNumber }) => ({
    parameters, csvRowNumber,
  })), [
    { parameters: { file: "stops.txt", row: 3, column: "stop_lat", value: "west" }, csvRowNumber: 3 },
    { parameters: { file: "stops.txt", row: 3, column: "location_type", value: "1.5" }, csvRowNumber: 3 },
  ]);
  assert.equal(collector.count("invalid_values"), 2);
});

test("normalizes recognized route fields and leaves unknown columns untouched", () => {
  const feed = loadGtfs(archive({
    "routes.txt": "route_id,route_type,route_desc\n r , 3 , description \ns,   ,\nt\n",
    "extension.txt": "route_type\n 3 \n",
  }));
  const routes = feed.tables.find((table) => table.kind === "routes.txt");
  assert.equal(routes.rows[0].fields.route_type, 3);
  assert.equal(routes.rows[0].fields.route_desc, "description");
  assert.equal(routes.rows[1].fields.route_type, null);
  assert.equal(routes.rows[2].fields.route_type, null);
  assert.equal(feed.tables.find((table) => table.kind === "unknown").rows[0].unrecognizedColumns.route_type, " 3 ");
});

test("preserves valid single-trip calendar masks", () => {
  for (const [monday, tuesday, wednesday, thursday, friday, saturday, sunday, expected] of [
    ["1", "1", "1", "1", "1", "1", "0", [1, 2, 3, 4, 5, 6]],
    ["1", "1", "0", "0", "0", "0", "1", [1, 2, 7]],
  ]) {
    const feed = loadGtfs(archive({
      "trips.txt": "route_id,trip_id,service_id,shape_id\nr,trip,service,s\n",
      "stop_times.txt": "trip_id,departure_time,stop_id,stop_sequence\ntrip,07:20:00,a,1\n",
      "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
        + `service,${monday},${tuesday},${wednesday},${thursday},${friday},${saturday},${sunday},20260101,20261231\n`,
    }));
    const variant = getRouteVariants(feed, "r").variants[0];
    const timetable = getVariantTimetable(feed, variant);
    assert.deepEqual(timetable.popularDays, [expected]);
  }
});

test("trims calendar IDs and values for single-trip timetables", () => {
  const feed = loadGtfs(archive({
    "trips.txt": "route_id,trip_id,service_id,shape_id\nr,weekday,weekday-service,s\n",
    "stop_times.txt": "trip_id,departure_time,stop_id,stop_sequence\nweekday,07:20:00,a,1\n",
    "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
      + "weekday-service, 1 ,1,1,1,1,0,0,20260101,20261231\n",
  }));
  const variant = getRouteVariants(feed, "r").variants[0];
  const timetable = getVariantTimetable(feed, variant);
  assert.deepEqual(timetable.popularDays, [[1, 2, 3, 4, 5]]);
  assert.equal(formatTimetableDayRange(timetable.popularDays[0]), "1-5");
});

test("groups trips by shape, headsign, short name and ordered stops", () => {
  const feed = loadGtfs(archive({
    "trips.txt": "route_id,trip_id,shape_id,trip_headsign,trip_short_name,direction_id\n"
      + "r,t1,s1,Center,10,0\nr,t2,s1,Center,10,1\n"
      + "r,t3,s1,Other,10,0\nr,t4,s1,Center,11,0\n"
      + "r,t5,s1,Center,10,0\nr,t6,s2,Center,10,0\n"
      + "r,t7,,Center,10,0\nother,t8,s1,Center,10,0\n",
    "stop_times.txt": "trip_id,stop_id,stop_sequence\n"
      + "t1,b,10\nt1,a,2\nt2,a,1\nt2,b,2\n"
      + "t3,a,1\nt3,b,2\nt4,a,1\nt4,b,2\n"
      + "t5,b,1\nt5,a,2\nt6,a,1\nt6,b,2\nt8,a,1\nt8,b,2\n",
    "shapes.txt": "shape_id,shape_pt_sequence\ns1,1\ns1,2\ns2,1\n",
  }));
  const { variants, tripsCount, tripsWithoutVariant } = getRouteVariants(feed, "r");
  assert.equal(tripsCount, 7);
  assert.equal(tripsWithoutVariant, 0);
  assert.deepEqual(variants.map(({ shapeId, tripHeadsign, tripShortName, directionIds, stops, trips }) => ({
    shapeId, tripHeadsign, tripShortName, directionIds, stops, trips: trips.map((trip) => trip.fields.trip_id),
  })), [
    { shapeId: "s1", tripHeadsign: "Center", tripShortName: "10", directionIds: [0, 1], stops: ["a", "b"], trips: ["t1", "t2"] },
    { shapeId: "s1", tripHeadsign: "Other", tripShortName: "10", directionIds: [0], stops: ["a", "b"], trips: ["t3"] },
    { shapeId: "s1", tripHeadsign: "Center", tripShortName: "11", directionIds: [0], stops: ["a", "b"], trips: ["t4"] },
    { shapeId: "s1", tripHeadsign: "Center", tripShortName: "10", directionIds: [0], stops: ["b", "a"], trips: ["t5"] },
    { shapeId: "s2", tripHeadsign: "Center", tripShortName: "10", directionIds: [0], stops: ["a", "b"], trips: ["t6"] },
    { shapeId: null, tripHeadsign: "Center", tripShortName: "10", directionIds: [0], stops: [], trips: ["t7"] },
  ]);
  const shapeRows = getVariantTableRows(feed, variants[0], "shapes.txt");
  const tripRows = getVariantTableRows(feed, variants[0], "trips.txt");
  assert.deepEqual(shapeRows.rows.map((row) => row.fields.shape_id), ["s1", "s1"]);
  assert.deepEqual(tripRows.rows.map((row) => row.fields.trip_id), ["t1", "t2"]);
  assert.equal(feed.tables.find((table) => table.kind === "trips.txt").rows.length, 8);
});

test("handles missing tables and shape trips without stop times", () => {
  const feed = loadGtfs(archive({
    "trips.txt": "route_id,trip_id,shape_id\nr,t,s\nr,u,\n",
  }));
  const { variants, tripsCount, tripsWithoutVariant } = getRouteVariants(feed, "r");
  assert.equal(tripsCount, 2);
  assert.equal(tripsWithoutVariant, 1);
  assert.deepEqual(variants.map(({ trips, ...variant }) => variant), [
    { shapeId: "s", tripHeadsign: null, tripShortName: null, directionIds: [null], stops: [] },
  ]);
  assert.equal(getVariantTableRows(feed, variants[0], "shapes.txt"), undefined);
  assert.deepEqual(getRouteVariants(feed, "other"), {
    variants: [], tripsCount: 0, tripsWithoutVariant: 0,
  });
});

test("resolves route references from other tables without linking missing IDs", () => {
  const feed = loadGtfs(archive({
    "routes.txt": "route_id,route_short_name\nr,First\nr,Duplicate\n,No ID\n",
    "trips.txt": "route_id,trip_id\nr,t\n",
  }));
  const routes = feed.indexes.routesById;
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
  assert.equal(loadGtfs(archive({ "trips.txt": "trip_id\nt\n" })).indexes.routesById.size, 0);
});

test("preserves missing stop IDs and variants with no stop times", () => {
  const feed = loadGtfs(archive({
    "trips.txt": "route_id,trip_id,shape_id\nr,t,s1\nr,u,s2\n",
    "stop_times.txt": "trip_id,stop_sequence,location_group_id,location_id\nt,1,group,\nt,2,,location\n",
  }));
  const { variants, tripsCount, tripsWithoutVariant } = getRouteVariants(feed, "r");
  assert.equal(tripsCount, 2);
  assert.equal(tripsWithoutVariant, 0);
  assert.deepEqual(variants.map(({ shapeId, stops }) => ({ shapeId, stops })), [
    { shapeId: "s1", stops: [null, null] },
    { shapeId: "s2", stops: [] },
  ]);
});

test("normalizes empty and absent trip properties to null and preserves repeated stops", () => {
  const feed = loadGtfs(archive({
    "trips.txt": "route_id,trip_id,shape_id,trip_headsign\nr,t1,s,\nr,t2,s\n",
    "stop_times.txt": "trip_id,stop_id,stop_sequence\nt1,a,1\nt1,a,2\nt2,a,1\nt2,a,2\n",
  }));
  const { variants } = getRouteVariants(feed, "r");
  assert.deepEqual(variants.map(({ tripHeadsign, stops }) => ({ tripHeadsign, stops })), [
    { tripHeadsign: null, stops: ["a", "a"] },
  ]);
});

test("forms shape-less variants from any available grouping property", () => {
  const feed = loadGtfs(archive({
    "trips.txt": "route_id,trip_id,trip_headsign,trip_short_name\n"
      + "r,t1,North,\nr,t2,North,\nr,t3,,X\nr,t4,,\nr,t5,,\nr,t6,,\n",
    "stop_times.txt": "trip_id,stop_id,stop_sequence\nt4,a,1\nt4,b,2\nt5,a,1\nt5,b,2\n",
  }));
  const { variants, tripsCount, tripsWithoutVariant } = getRouteVariants(feed, "r");
  assert.equal(tripsCount, 6);
  assert.equal(tripsWithoutVariant, 1);
  assert.deepEqual(variants.map(({ shapeId, tripHeadsign, tripShortName, stops, trips }) => ({
    shapeId, tripHeadsign, tripShortName, stops, trips: trips.map((trip) => trip.fields.trip_id),
  })), [
    { shapeId: null, tripHeadsign: "North", tripShortName: null, stops: [], trips: ["t1", "t2"] },
    { shapeId: null, tripHeadsign: null, tripShortName: "X", stops: [], trips: ["t3"] },
    { shapeId: null, tripHeadsign: null, tripShortName: null, stops: ["a", "b"], trips: ["t4", "t5"] },
  ]);
});

test("forms variants from shape IDs in a loaded feed without optional tables or trip IDs", () => {
  const feed = loadGtfs(archive({
    "feed/ROUTES.TXT": "\ufeffroute_short_name,route_id\r\nBus,001\r\n",
    "feed/TRIPS.TXT": "\ufeffshape_id,route_id,trip_id,service_id\r\n"
      + "shape-a,001,trip-1,weekday\r\n"
      + "shape-a,001,trip-2,weekend\r\n"
      + "shape-b,001,,weekday\r\n"
      + "shape-c,01,trip-3,weekday\r\n",
  }));
  const routeId = feed.indexes.routesById.get("001").fields.route_id;
  const { variants, tripsCount, tripsWithoutVariant } = getRouteVariants(feed, routeId);
  assert.equal(tripsCount, 3);
  assert.equal(tripsWithoutVariant, 0);
  assert.deepEqual(variants.map(({ shapeId, stops, trips }) => ({
    shapeId, stops, trips: trips.map(({ fields }) => fields.trip_id),
  })), [
    { shapeId: "shape-a", stops: [], trips: ["trip-1", "trip-2"] },
    { shapeId: "shape-b", stops: [], trips: [null] },
  ]);
  assert.deepEqual(getRouteVariants(feed, "1"), {
    variants: [], tripsCount: 0, tripsWithoutVariant: 0,
  });
});

test("matches stop times by trip ID and groups by the complete numeric stop sequence", () => {
  const feed = loadGtfs(archive({
    "trips.txt": "route_id,trip_id,shape_id\n"
      + "r,one,s\nr,two,s\nr,three,s\nr,four,s\nother,ignored,s\n",
    "stop_times.txt": "trip_id,stop_id,stop_sequence\n"
      + "one,c,10\none,a,1\none,b,2\n"
      + "two,b,20\ntwo,c,30\ntwo,a,10\n"
      + "three,a,1\nthree,b,2\n"
      + "four,a,1\nfour,b,2\nfour,b,3\nfour,c,4\n"
      + "ignored,z,1\n",
  }));
  const { variants, tripsCount, tripsWithoutVariant } = getRouteVariants(feed, "r");
  assert.equal(tripsCount, 4);
  assert.equal(tripsWithoutVariant, 0);
  assert.deepEqual(variants.map(({ stops, trips }) => ({
    stops, trips: trips.map(({ fields }) => fields.trip_id),
  })), [
    { stops: ["a", "b", "c"], trips: ["one", "two"] },
    { stops: ["a", "b"], trips: ["three"] },
    { stops: ["a", "b", "b", "c"], trips: ["four"] },
  ]);
});

test("keeps shape IDs and trip text distinct even when they contain delimiters", () => {
  const feed = loadGtfs(archive({
    "trips.txt": "route_id,trip_id,shape_id,trip_headsign,trip_short_name\n"
      + 'r,t1,"s,1",A,B\nr,t2,s,"1,A",B\nr,t3,"s,1",A,C\n'
      + 'r,t4,"s,1",A,B\n',
  }));
  const { variants } = getRouteVariants(feed, "r");
  assert.deepEqual(variants.map(({ shapeId, tripHeadsign, tripShortName, trips }) => ({
    shapeId, tripHeadsign, tripShortName, trips: trips.map(({ fields }) => fields.trip_id),
  })), [
    { shapeId: "s,1", tripHeadsign: "A", tripShortName: "B", trips: ["t1", "t4"] },
    { shapeId: "s", tripHeadsign: "1,A", tripShortName: "B", trips: ["t2"] },
    { shapeId: "s,1", tripHeadsign: "A", tripShortName: "C", trips: ["t3"] },
  ]);
});

test("applies calendar exceptions and produces a date-specific schedule", () => {
  const feed = loadGtfs(archive({
    "routes.txt": "route_id,route_short_name\nr,5\n",
    "trips.txt": "route_id,trip_id,service_id,shape_id,trip_headsign\nr,t1,weekday,s,Center\n",
    "stop_times.txt": "trip_id,departure_time,stop_id,stop_sequence\nt1,08:05:00,a,1\nt1,08:15:00,b,2\n",
    "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
      + "weekday,1,1,1,1,1,0,0,20260101,20261231\n",
    "calendar_dates.txt": "service_id,date,exception_type\nweekday,20260102,2\nweekday,20260103,1\n",
  }));
  assert.equal(isServiceActiveOnDate(feed, "weekday", "2026-01-01"), true);
  assert.equal(isServiceActiveOnDate(feed, "weekday", "2026-01-02"), false);
  assert.equal(isServiceActiveOnDate(feed, "weekday", "2026-01-03"), true);
  const variant = getRouteVariants(feed, "r").variants[0];
  const schedule = getDateSchedule(feed, variant, "2026-01-03");
  assert.equal(schedule.tripCount, 1);
  assert.equal(schedule.rows[0].hour, 8);
  assert.equal(schedule.rows[0].departures[0].minute, 5);
  assert.equal(schedule.rows[0].departures[0].tripId, "t1");
});

test("calculates legacy fares from a selected stop to following stops", () => {
  const feed = loadGtfs(archive({
    "routes.txt": "route_id\nr\n",
    "trips.txt": "route_id,trip_id,service_id\nr,t,s\n",
    "stops.txt": "stop_id,zone_id\na,z1\nb,z2\nc,z2\n",
    "fare_attributes.txt": "fare_id,price,currency_type\nbase,2.50,EUR\n",
    "fare_rules.txt": "fare_id,route_id,origin_id,destination_id\nbase,r,z1,z2\n",
  }));
  const trip = feed.indexes.tripsById.get("t");
  const fares = getTripFares(feed, trip, "a", ["b", "c"]);
  assert.deepEqual(fares.map(({ destinationStopId, fareId, price, currency }) =>
    ({ destinationStopId, fareId, price, currency })), [
    { destinationStopId: "b", fareId: "base", price: 2.5, currency: "EUR" },
    { destinationStopId: "c", fareId: "base", price: 2.5, currency: "EUR" },
  ]);
  assert.equal(feed.indexes.fareAttributesById.get("base").fields.price, 2.5);
  assert.equal(feed.indexes.fareRulesByRouteId.get("r").length, 1);
  assert.equal(feed.indexes.fareCache.size, 2);
});

test("decodes standard route types for display", () => {
  assert.equal(decodeRouteType("0"), "Tram");
  assert.equal(decodeRouteType("3"), "Bus");
  assert.equal(decodeRouteType("11"), "Trolleybus");
  assert.equal(decodeRouteType("999"), "Unknown route type (999)");
  const [routes] = loadGtfs(archive({ "routes.txt": "route_id,route_type\nr,0\n" })).tables;
  assert.equal(getMatchingRows(routes, "tram").length, 1);
});
