const test = require("node:test");
const assert = require("node:assert/strict");
const { strToU8, zipSync } = require("fflate");
const {
  getRouteVariants,
  getVariantTimetable,
  isServiceActiveOnDate,
  loadGtfs,
} = require("../dist/gtfs.cjs");

function archive(files) {
  return zipSync(Object.fromEntries(
    Object.entries(files).map(([name, text]) => [name, strToU8(text)]),
  ));
}

test("single service ID supports separate calendar ranges and weekday masks", () => {
  const feed = loadGtfs(archive({
    "routes.txt": "route_id,route_short_name\nr,5\n",
    "trips.txt": "route_id,trip_id,service_id,shape_id,trip_headsign\nr,t1,weekday,s,Center\n",
    "stop_times.txt": "trip_id,departure_time,stop_id,stop_sequence\nt1,08:05:00,a,1\n",
    "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
      + "weekday,1,0,0,0,0,0,0,20260101,20260331\n"
      + "weekday,0,0,0,0,0,1,1,20260601,20260831\n",
  }));

  assert.equal(feed.indexes.calendarByServiceId.get("weekday").length, 2);
  assert.equal(isServiceActiveOnDate(feed, "weekday", "2026-01-05"), true);
  assert.equal(isServiceActiveOnDate(feed, "weekday", "2026-06-06"), true);
  assert.equal(isServiceActiveOnDate(feed, "weekday", "2026-01-06"), false);

  const variant = getRouteVariants(feed, "r").variants[0];
  const timetables = getVariantTimetable(feed, variant);

  assert.deepEqual(
    timetables.map((timetable) => timetable.popularDays),
    [[[1]], [[6, 7]]],
  );
  assert.deepEqual(
    timetables.map((timetable) => timetable.rows[0].departures[0].days),
    [[1], [6, 7]],
  );
});
