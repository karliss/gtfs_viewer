const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { strToU8, zipSync } = require("fflate");
const {
  getRouteVariants,
  getVariantTimetable,
  isServiceActiveOnDate,
  loadGtfs,
} = require("../dist/gtfs.cjs");

function archiveDirectory(directory) {
  const files = Object.fromEntries(
    fs.readdirSync(directory)
      .filter((name) => name.endsWith(".txt"))
      .map((name) => [name, fs.readFileSync(path.join(directory, name), "utf8")]),
  );
  return zipSync(Object.fromEntries(
    Object.entries(files).map(([name, text]) => [name, strToU8(text)]),
  ));
}

test("single service ID supports separate calendar ranges and weekday masks", () => {
  const feed = loadGtfs(archiveDirectory(path.join(__dirname, "multiple-calendar-ranges")));

  assert.equal(feed.indexes.calendarByServiceId.get("weekday").length, 2);
  assert.equal(isServiceActiveOnDate(feed, "weekday", "2026-01-05"), true);
  assert.equal(isServiceActiveOnDate(feed, "weekday", "2026-01-06"), true);
  assert.equal(isServiceActiveOnDate(feed, "weekday", "2026-06-06"), true);
  assert.equal(isServiceActiveOnDate(feed, "weekday", "2026-06-08"), false);
  assert.equal(isServiceActiveOnDate(feed, "weekday", "2026-01-07"), false);

  const variant = getRouteVariants(feed, "R1").variants[0];
  const timetables = getVariantTimetable(feed, variant);

  assert.deepEqual(
    timetables.map((timetable) => timetable.popularDays),
    [[[1]], [[6, 7]]],
  );
  assert.deepEqual(
    timetables.map((timetable) => timetable.rows[0].departures[0].days),
    [[1], [6, 7]],
  );
  assert.deepEqual(
    timetables.map((timetable) => timetable.dateRange),
    [["20260101", "20260331"], ["20260601", "20260831"]],
  );
  assert.deepEqual(
    timetables.map((timetable) => timetable.exceptionDates),
    [["20260106", "20260608"], ["20260106", "20260608"]],
  );
});
