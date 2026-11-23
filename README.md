# GTFS Viewer

A small, single-page web app built with TypeScript and browser-native HTML and CSS.

## Requirements

- Node.js and npm

## Build and run

```sh
npm install
npm run build
```

Open `index.html` in a browser, choose a GTFS ZIP file, and select **Load feed**. Select a table to browse its columns and rows; large tables are displayed 100 rows at a time. Files are processed locally and are not uploaded.

Select a route row or a route ID in another table to see its properties and variants. Route types are displayed with human-readable names. Trips are grouped by shape ID, trip headsign, trip short name, and ordered stop IDs from `stop_times.txt`; any available grouping property is enough to form a variant, even without a shape ID. Direction IDs are shown for each variant without affecting grouping. The view summarizes variant and trip counts, followed by collapsible variant stop lists and a unique route-wide stop list. Use the variant links to view matching shape points or trips in the feed tables.

The viewer reads UTF-8 CSV-formatted `.txt` files from the archive, including optional and extension tables. Rows have typed fields for the GTFS Schedule tables in the [April 27, 2026 reference](https://github.com/google/transit/blob/2ce6aa79e3fa7bdbaf19d2a12765cee5b9fdd699/gtfs/spec/en/reference.md). Values remain strings; absent fields are `null`, while explicitly empty fields remain empty strings. Unrecognized columns are stored separately by header name, and values beyond the header are preserved in order and displayed together in an extra column.

The loaded feed also lists the full ZIP paths of unrecognized files, including extension tables and metadata files. Unknown `.txt` tables remain viewable. Directory entries and ZIP header metadata are not listed. The viewer does not parse `locations.geojson` or GTFS Realtime, or validate the feed against the full GTFS specification.

Run the loader tests with `npm test`.
