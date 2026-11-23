import { unzipSync } from "fflate";
import Papa from "papaparse";
import { gtfsFields, type GtfsFields, type GtfsTableName } from "./gtfs-schema";

export type { GtfsFields, GtfsTableName } from "./gtfs-schema";

interface RowExtras {
  unrecognizedColumns: Record<string, string | null>;
  extraValues: string[];
}

export type GtfsRow<Name extends GtfsTableName> = RowExtras & {
  fields: GtfsFields<Name>;
};

interface TableBase {
  name: string;
  columns: string[];
  hasExtraValues: boolean;
}

export type GtfsTable = {
  [Name in GtfsTableName]: TableBase & {
    kind: Name;
    rows: GtfsRow<Name>[];
  };
}[GtfsTableName] | (TableBase & {
  kind: "unknown";
  rows: (RowExtras & { fields: Record<string, never> })[];
});

export interface GtfsFeed {
  tables: GtfsTable[];
  unrecognizedFiles: string[];
}

export function indexRoutes(feed: GtfsFeed): Map<string, GtfsRow<"routes.txt">> {
  const routes = feed.tables.find((table) => table.kind === "routes.txt");
  const byId = new Map<string, GtfsRow<"routes.txt">>();
  for (const route of routes?.rows ?? []) {
    if (route.fields.route_id && !byId.has(route.fields.route_id)) {
      byId.set(route.fields.route_id, route);
    }
  }
  return byId;
}

export function getReferencedRoute(
  routes: ReadonlyMap<string, GtfsRow<"routes.txt">>,
  tableKind: GtfsTable["kind"],
  column: string,
  value: string | null,
): GtfsRow<"routes.txt"> | undefined {
  if (tableKind === "routes.txt" || !value ||
    (column !== "route_id" && column !== "from_route_id" && column !== "to_route_id")) {
    return undefined;
  }
  return routes.get(value);
}

export interface RouteVariant {
  shapeId: string;
  stops: (string | null)[];
}

export function getRouteVariants(feed: GtfsFeed, routeId: string): {
  variants: RouteVariant[];
  tripsWithoutShape: number;
} {
  const trips = feed.tables.find((table) => table.kind === "trips.txt");
  const stopTimes = feed.tables.find((table) => table.kind === "stop_times.txt");
  const shapeTrips = new Map<string, string[]>();
  let tripsWithoutShape = 0;

  for (const { fields } of trips?.rows ?? []) {
    if (fields.route_id !== routeId) continue;
    if (!fields.shape_id) {
      tripsWithoutShape++;
      continue;
    }
    const tripIds = shapeTrips.get(fields.shape_id) ?? [];
    if (fields.trip_id) tripIds.push(fields.trip_id);
    shapeTrips.set(fields.shape_id, tripIds);
  }

  const relevantTrips = new Set([...shapeTrips.values()].flat());
  const timesByTrip = new Map<string, GtfsRow<"stop_times.txt">[]>();
  for (const row of stopTimes?.rows ?? []) {
    const tripId = row.fields.trip_id;
    if (!tripId || !relevantTrips.has(tripId)) continue;
    const times = timesByTrip.get(tripId) ?? [];
    times.push(row);
    timesByTrip.set(tripId, times);
  }

  const variants = [...shapeTrips].map(([shapeId, tripIds]) => {
    const times = tripIds.map((id) => timesByTrip.get(id)).find((rows) => rows?.length) ?? [];
    const sequence = (value: string | null): number =>
      value !== null && /^\d+$/.test(value) ? Number(value) : Infinity;
    const ordered = [...times].sort((a, b) =>
      sequence(a.fields.stop_sequence) - sequence(b.fields.stop_sequence));
    return {
      shapeId,
      stops: ordered.map(({ fields }) => fields.stop_id),
    };
  });
  return { variants, tripsWithoutShape };
}

function isGtfsTableName(name: string): name is GtfsTableName {
  return Object.prototype.hasOwnProperty.call(gtfsFields, name);
}

function parseTable(name: string, columns: string[], records: string[][]): GtfsTable {
  const key = name.toLowerCase();
  const kind = isGtfsTableName(key) ? key : "unknown";
  const fields: readonly string[] = kind === "unknown" ? [] : gtfsFields[kind];
  const fieldNames = new Set(fields);
  const columnIndexes = new Map(columns.map((column, index) => [column, index]));
  const unknownColumns = columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => !fieldNames.has(column));
  const rows = records.map((record) => ({
    fields: Object.fromEntries(fields.map((field) => {
      const index = columnIndexes.get(field);
      return [field, index === undefined ? null : record[index] ?? null];
    })),
    unrecognizedColumns: Object.fromEntries(
      unknownColumns.map(({ column, index }) => [column, record[index] ?? null]),
    ),
    extraValues: record.slice(columns.length),
  }));
  // The chosen schema creates exactly the fields required by its discriminant.
  return { name, kind, columns, rows, hasExtraValues: rows.some((row) => row.extraValues.length > 0) } as GtfsTable;
}

export function loadGtfs(data: Uint8Array): GtfsFeed {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch {
    throw new Error("Could not read the ZIP file. Make sure it is a valid, unencrypted ZIP archive.");
  }

  const tables: GtfsTable[] = [];
  const unrecognizedFiles: string[] = [];
  const names = new Set<string>();
  const decoder = new TextDecoder("utf-8", { fatal: true });

  for (const [path, bytes] of Object.entries(files)) {
    if (path.endsWith("/")) continue;

    const parts = path.split("/");
    const name = parts[parts.length - 1];
    const key = name.toLowerCase();
    const isMetadata = name.startsWith("._") || parts.includes("__MACOSX");
    if (isMetadata || !isGtfsTableName(key)) {
      unrecognizedFiles.push(path);
    }
    if (!key.endsWith(".txt") || isMetadata) {
      continue;
    }

    if (names.has(key)) {
      throw new Error(`The ZIP contains multiple files named ${name}.`);
    }
    names.add(key);

    let text: string;
    try {
      text = decoder.decode(bytes);
    } catch {
      throw new Error(`${name} is not valid UTF-8.`);
    }

    const parsed = Papa.parse<string[]>(text, {
      delimiter: ",",
      skipEmptyLines: true,
    });
    if (parsed.errors.length > 0) {
      throw new Error(`Could not parse ${name}: ${parsed.errors[0].message}`);
    }

    const [columns, ...rows] = parsed.data;
    if (!columns || columns.some((column) => column.trim() === "")) {
      throw new Error(`${name} must have a non-empty header row.`);
    }
    if (new Set(columns).size !== columns.length) {
      throw new Error(`${name} contains duplicate column names.`);
    }
    tables.push(parseTable(name, columns, rows));
  }

  if (tables.length === 0) {
    throw new Error("The ZIP does not contain any GTFS .txt files.");
  }

  tables.sort((a, b) => a.name.localeCompare(b.name));
  unrecognizedFiles.sort();
  return { tables, unrecognizedFiles };
}
