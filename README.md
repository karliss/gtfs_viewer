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

The viewer reads UTF-8 CSV-formatted `.txt` files from the archive, including optional and extension tables. It does not validate the feed against the full GTFS specification.

Run the loader tests with `npm test`.
