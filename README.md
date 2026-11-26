# GTFS Viewer

**This is slop.** Provided as is, use at your own risk. Don't expect any support.

Simple [GTFS](https://gtfs.org/) (General Transit Feed Specification) viewer with focus on exploring the technical technical details and GTFS file structure.

All the processing happens locally, can be run by simply opening HTML file and no server.

Try [here](https://karliss.github.io/gtfs_viewer/)


Features:
* Browse GTFS tables
* Map for inspecting routes and stop positions
* Compare shapes on a map and inspect their common and differing point ranges
* Cross reference tables with clickable links
* Basic support for calendar.txt and calendar-dates.txt based schedules
* Trip information

## Limitations

* map background layers don't work when running a local copy (abuse prevention system by the free OSM tile providers)
* not designed to be a user friendly public transport route planer
* GTFS spec lists more than 30 different tables, this currently handles (not necessarily fully or correctly)
   - agency.txt
   - routes.txt
   - trips.txt
   - shapes.txt
   - stops.txt
   - stop_times.txt
   - calendar.txt
   - calendar_dates.txt
   - fare_rules.txt (Fares V1) poorly tested
   - fare_attributes.txt
   - frequencies.txt (partial support, UI not optimized)
* realtime parts of GTFS not supported
* geojson related parts of GTFS not supported

## Route variants

Single route usually consists of multiple trips. Single trip consists of stop sequence, shape, departure time and weekly schedule.

Multiple trips in single route can have different physical route (represented by sequence of stops and shape). Main use of this is forward band backward direction for non circular routes. But it also gets used for optional extra stops visited by only some trips. Another common use for city transport is first and last trip of the day which goes to and from depot  instead of regular final stops. 

For people interested to get somewhere route is too coarse, since the direction of travel matters. Trips are too granular, 
since most people want to get to destination as soon as possible or as close as possible to specific time.

GTFS has direction field, but due to variants with extra stops it isn't sufficient for grouping trips in a logical manner.

By default this tool only combines trips for which all the properties match exactly. But it is not uncommon in low quality GTFS files to have duplicate shapes which might be identical or nearly identical. This makes it harder to identify logical route variants. There is a command to attempt combining trips with identical stop order. It will print a warning explaining why trips weren't combined by default and provide ability to compare shapes.

Testing on real life GTFS showed that there are more weird cases. Trips with identical stop order, where shape differs significantly. Seemingly unnecessary forks without any stops. Potential causes:

* incorrectly copy pasting/reusing wrong shape from route variant with different set of stops
* missing stops in specific route
* trips that actually follow different roads

In theory bus with flexible pickup/drop off approach could follow different roads and it would be meaningful even though stop lists are identical.


## Second warning

GTFS specification is complex with many optional features. If first warning about this being slop wasn't enough, consider complexity of full GTFS specification. There is high chance of some edge cases or feature combinations not being implemented correctly.

Don't rely on this as only source if you need accurate schedule or fare calculation.