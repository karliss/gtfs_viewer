const test = require("node:test");
const assert = require("node:assert/strict");
const { strToU8, zipSync } = require("fflate");
const { loadGtfs } = require("../dist/gtfs.cjs");

function archive(files) {
  return zipSync(Object.fromEntries(
    Object.entries(files).map(([name, text]) => [name, strToU8(text)]),
  ));
}

test("loads CSV tables as strings, including quoted commas, newlines and UTF-8 BOM", () => {
  const feed = loadGtfs(archive({
    "feed/stops.txt": '\ufeffstop_id,stop_name,description\r\n001,"Main, Street","First\nSecond"\r\n',
    "feed/routes.txt": "route_id,route_name\n01,Bus\n",
    "readme.md": "ignored",
    "__MACOSX/._stops.txt": "ignored",
  }));
  assert.deepEqual(feed.tables, [
    { name: "routes.txt", columns: ["route_id", "route_name"], rows: [["01", "Bus"]] },
    { name: "stops.txt", columns: ["stop_id", "stop_name", "description"], rows: [["001", "Main, Street", "First\nSecond"]] },
  ]);
});

test("loads a header-only table", () => {
  assert.deepEqual(loadGtfs(archive({ "agency.txt": "agency_id\n" })).tables[0], {
    name: "agency.txt", columns: ["agency_id"], rows: [],
  });
});

test("reports invalid archives, missing tables and duplicate filenames", () => {
  assert.throws(() => loadGtfs(strToU8("not a zip")), /valid.*ZIP/i);
  assert.throws(() => loadGtfs(archive({ "readme.md": "hello" })), /no.*\.txt/i);
  assert.throws(() => loadGtfs(archive({ "one/stops.txt": "id\n1", "two/stops.txt": "id\n2" })), /multiple files named stops.txt/);
});

test("reports malformed CSV and inconsistent rows", () => {
  assert.throws(() => loadGtfs(archive({ "stops.txt": 'id,name\n1,"unterminated' })), /parse stops.txt/i);
  assert.throws(() => loadGtfs(archive({ "stops.txt": "id,name\n1\n" })), /number of fields/);
  assert.throws(() => loadGtfs(archive({ "stops.txt": "id,id\n1,2\n" })), /duplicate column/);
});

test("reports invalid UTF-8", () => {
  const zip = zipSync({ "stops.txt": new Uint8Array([0xff]) });
  assert.throws(() => loadGtfs(zip), /valid UTF-8/);
});
