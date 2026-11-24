import { unzipSync } from "fflate";
import Papa from "papaparse";
import { gtfsZeroDefaultEnumFields, gtfsFields, type GtfsFields, type GtfsTableName } from "./gtfs-schema";
import type { GtfsWarning, WarningCollector } from "./warnings";

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
  warnings?: GtfsWarning[];
}

export function getTableColumns(table: GtfsTable): {
  recognized: string[];
  additional: string[];
} {
  const knownFields: readonly string[] = table.kind === "unknown" ? [] : gtfsFields[table.kind];
  const known = new Set(knownFields);
  return {
    recognized: table.columns.filter((column) => known.has(column)),
    additional: table.columns.filter((column) => !known.has(column)),
  };
}

export function getMatchingRows(table: GtfsTable, search: string): GtfsTable["rows"][number][] {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return table.rows;
  return table.rows.filter((row) => {
    const values = [...Object.values(row.fields), ...Object.values(row.unrecognizedColumns), ...row.extraValues];
    if (table.kind === "routes.txt" && "route_type" in row.fields && row.fields.route_type) {
      const value = row.fields.route_type;
      const name = decodeRouteType(value);
      values.push(name === `Unknown route type (${value})` ? name : `${name} (${value})`);
    }
    return values.some((value) => value !== null && value.toLocaleLowerCase().includes(query));
  });
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

export function summarizeTripField(
  trips: readonly GtfsRow<"trips.txt">[],
  field: "wheelchair_accessible" | "bikes_allowed",
): string {
  if (!trips.length) return "No trips available";
  const counts = new Map<string | null, number>();
  for (const trip of trips) {
    const value = trip.fields[field]?.trim() ? trip.fields[field] : "0";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const label = (value: string | null): string => value === null ? "Not provided" : value === "" ? "(empty)" : value;
  return [...counts].map(([value, count]) => counts.size === 1
    ? label(value)
    : `${label(value)} (${Number((count * 100 / trips.length).toFixed(1))}%)`).join(", ");
}

export interface RouteVariant {
  shapeId: string | null;
  tripHeadsign: string | null;
  tripShortName: string | null;
  directionIds: (string | null)[];
  stops: (string | null)[];
  trips: GtfsRow<"trips.txt">[];
}

export function getVariantTableRows(
  feed: GtfsFeed, variant: RouteVariant, kind: "shapes.txt" | "trips.txt",
): GtfsTable | undefined {
  const table = feed.tables.find((candidate) => candidate.kind === kind);
  if (!table) return undefined;
  if (table.kind === "shapes.txt" && variant.shapeId !== null) {
    return { ...table, rows: table.rows.filter((row) => row.fields.shape_id === variant.shapeId) };
  }
  if (table.kind === "trips.txt") {
    const trips = new Set(variant.trips);
    return { ...table, rows: table.rows.filter((row) => trips.has(row)) };
  }
}

export function getRouteVariants(feed: GtfsFeed, routeId: string): {
  variants: RouteVariant[];
  tripsCount: number;
  tripsWithoutVariant: number;
} {
  const trips = feed.tables.find((table) => table.kind === "trips.txt");
  const stopTimes = feed.tables.find((table) => table.kind === "stop_times.txt");
  const routeTrips = (trips?.rows ?? []).filter(({ fields }) => fields.route_id === routeId);
  const relevantTrips = new Set(routeTrips.flatMap(({ fields }) => fields.trip_id ? [fields.trip_id] : []));
  const timesByTrip = new Map<string, GtfsRow<"stop_times.txt">[]>();
  for (const row of stopTimes?.rows ?? []) {
    const tripId = row.fields.trip_id;
    if (!tripId || !relevantTrips.has(tripId)) continue;
    const times = timesByTrip.get(tripId) ?? [];
    times.push(row);
    timesByTrip.set(tripId, times);
  }

  const sequence = (value: string | null): number =>
    value !== null && /^\d+$/.test(value) ? Number(value) : Infinity;
  const stopsByTrip = new Map<string, (string | null)[]>();
  for (const [tripId, times] of timesByTrip) {
    times.sort((a, b) => sequence(a.fields.stop_sequence) - sequence(b.fields.stop_sequence));
    stopsByTrip.set(tripId, times.map(({ fields }) => fields.stop_id));
  }

  const variantsByKey = new Map<string, RouteVariant>();
  let tripsWithoutVariant = 0;
  for (const trip of routeTrips) {
    const { fields } = trip;
    const stops = fields.trip_id ? stopsByTrip.get(fields.trip_id) ?? [] : [];
    if (!fields.shape_id && !fields.trip_headsign && !fields.trip_short_name && stops.length === 0) {
      tripsWithoutVariant++;
      continue;
    }
    const key = JSON.stringify([fields.shape_id, fields.trip_headsign, fields.trip_short_name, stops]);
    let variant = variantsByKey.get(key);
    if (!variant) {
      variant = {
        shapeId: fields.shape_id || null, tripHeadsign: fields.trip_headsign,
        tripShortName: fields.trip_short_name, directionIds: [], stops, trips: [],
      };
      variantsByKey.set(key, variant);
    }
    if (!variant.directionIds.includes(fields.direction_id)) variant.directionIds.push(fields.direction_id);
    variant.trips.push(trip);
  }
  return {
    variants: [...variantsByKey.values()],
    tripsCount: routeTrips.length,
    tripsWithoutVariant,
  };
}

export const ROUTE_TYPE_NAMES: Readonly<Record<string, string>> = {
  "0": "Tram",
  "1": "Subway",
  "2": "Rail",
  "3": "Bus",
  "4": "Ferry",
  "5": "Cable tram",
  "6": "Aerial lift",
  "7": "Funicular",
  "11": "Trolleybus",
  "12": "Monorail",
};

export function decodeRouteType(routeType: string): string {
  return ROUTE_TYPE_NAMES[routeType] ?? `Unknown route type (${routeType})`;
}

function isGtfsTableName(name: string): name is GtfsTableName {
  return Object.prototype.hasOwnProperty.call(gtfsFields, name);
}

function parseTable(name: string, columns: string[], records: string[][], collector?: WarningCollector): GtfsTable {
  const key = name.toLowerCase();
  const kind = isGtfsTableName(key) ? key : "unknown";
  const fields: readonly string[] = kind === "unknown" ? [] : gtfsFields[kind];
  const enumFields = new Set(kind === "unknown" ? [] : gtfsZeroDefaultEnumFields[kind] ?? []);
  const fieldNames = new Set(fields);
  const columnIndexes = new Map(columns.map((column, index) => [column, index]));
  const unknownColumns = columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => !fieldNames.has(column));
  const valueAt = (record: string[], column: string, index: number | undefined): string | null => {
    const value = index === undefined ? null : record[index] ?? null;
    if (enumFields.has(column) && !value?.trim()) return "0";
    return value !== null && (column === "id" || column.endsWith("_id") ||
      (kind === "routes.txt" && (column === "route_type" || column === "route_short_name"))) ? value.trim() : value;
  };
  const rows = records.map((record, index) => {
    const row = {
      fields: Object.fromEntries(fields.map((field) => {
        const columnIndex = columnIndexes.get(field);
        return [field, valueAt(record, field, columnIndex)];
      })),
      unrecognizedColumns: Object.fromEntries(
        unknownColumns.map(({ column, index }) => [column, valueAt(record, column, index)]),
      ),
      extraValues: record.slice(columns.length),
    };
    if (row.extraValues.length > 0) {
      collector?.add({
        type: "extra_values",
        parameters: { file: name, row: index + 2, count: row.extraValues.length, values: row.extraValues },
        relatedObjectIds: [],
        csvRowNumber: index + 2,
      });
    }
    if (record.length < columns.length) {
      const count = columns.length - record.length;
      collector?.add({
        type: "missing_values",
        parameters: { file: name, row: index + 2, count },
        relatedObjectIds: [],
        csvRowNumber: index + 2,
      });
    }
    return row;
  });
  const primaryIdColumns: Partial<Record<GtfsTableName, string>> = {
    "agency.txt": "agency_id",
    "stops.txt": "stop_id",
    "routes.txt": "route_id",
    "trips.txt": "trip_id",
    "calendar.txt": "service_id",
    "calendar_dates.txt": "service_id",
    "fare_attributes.txt": "fare_id",
    "fare_media.txt": "fare_media_id",
    "fare_products.txt": "fare_product_id",
    "rider_categories.txt": "rider_category_id",
    "areas.txt": "area_id",
    "networks.txt": "network_id",
    "shapes.txt": "shape_id",
    "booking_rules.txt": "booking_rule_id",
    "attributions.txt": "attribution_id",
    "levels.txt": "level_id",
    "location_groups.txt": "location_group_id",
  };
  const idColumn = kind === "unknown" ? undefined : primaryIdColumns[kind];
  if (idColumn) {
    const seen = new Map<string, number>();
    for (const [index, row] of rows.entries()) {
      const id = row.fields[idColumn];
      if (!id?.trim()) {
        collector?.add({
          type: "missing_or_duplicate_ids",
          parameters: { file: name, row: index + 2, column: idColumn, issue: "missing", idSuffix: "" },
          relatedObjectIds: [],
          csvRowNumber: index + 2,
        });
      } else if (seen.has(id)) {
        collector?.add({
          type: "missing_or_duplicate_ids",
          parameters: { file: name, row: index + 2, column: idColumn, issue: "duplicate", id, idSuffix: `: ${id}` },
          relatedObjectIds: [id],
          csvRowNumber: index + 2,
        });
      } else {
        seen.set(id, index);
      }
    }
  }
  // The chosen schema creates exactly the fields required by its discriminant.
  return { name, kind, columns, rows, hasExtraValues: rows.some((row) => row.extraValues.length > 0) } as GtfsTable;
}

export interface GtfsLoadProgress {
  phase: "extracting" | "parsing";
  completed: number;
  total: number;
  fileName?: string;
}

export function loadGtfs(
  data: Uint8Array,
  onProgressOrWarnings?: ((progress: GtfsLoadProgress) => void) | WarningCollector,
  warningCollector?: WarningCollector,
): GtfsFeed {
  const onProgress = typeof onProgressOrWarnings === "function" ? onProgressOrWarnings : undefined;
  const collector = typeof onProgressOrWarnings !== "function" ? onProgressOrWarnings ?? warningCollector : warningCollector;
  collector?.clear();
  let files: Record<string, Uint8Array>;
  try {
    onProgress?.({ phase: "extracting", completed: 0, total: 1 });
    files = unzipSync(data);
  } catch {
    throw new Error("Could not read the ZIP file. Make sure it is a valid, unencrypted ZIP archive.");
  }
  onProgress?.({ phase: "extracting", completed: 1, total: 1 });

  const tables: GtfsTable[] = [];
  const unrecognizedFiles: string[] = [];
  const names = new Set<string>();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const textFiles = Object.entries(files).filter(([path]) => {
    if (path.endsWith("/")) return false;
    const name = path.split("/").pop() ?? "";
    return name.toLowerCase().endsWith(".txt") && !name.startsWith("._")
      && !path.split("/").includes("__MACOSX");
  });
  let parsedFiles = 0;

  for (const [path, bytes] of Object.entries(files)) {
    if (path.endsWith("/")) continue;

    const parts = path.split("/");
    const name = parts[parts.length - 1];
    const key = name.toLowerCase();
    const isMetadata = name.startsWith("._") || parts.includes("__MACOSX");
    if (isMetadata || !isGtfsTableName(key)) {
      unrecognizedFiles.push(path);
      if (!isMetadata) {
        collector?.add({
          type: "unrecognized_files",
          parameters: { file: path },
          relatedObjectIds: [],
        });
      }
    }
    if (!key.endsWith(".txt") || isMetadata) {
      continue;
    }

    if (names.has(key)) {
      throw new Error(`The ZIP contains multiple files named ${name}.`);
    }
    names.add(key);
    onProgress?.({ phase: "parsing", completed: parsedFiles, total: textFiles.length, fileName: name });

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

    const [header, ...rows] = parsed.data;
    if (!header) {
      throw new Error(`${name} must have a non-empty header row.`);
    }
    const columns = header.map((column) => column.trim());
    if (columns.some((column) => column === "")) {
      throw new Error(`${name} must have a non-empty header row.`);
    }
    if (new Set(columns).size !== columns.length) {
      throw new Error(`${name} contains duplicate column names.`);
    }
    const recognizedFields: readonly string[] = isGtfsTableName(key) ? gtfsFields[key] : [];
    const unrecognized = columns.filter((column) => !recognizedFields.includes(column));
    for (const column of unrecognized) {
      collector?.add({
        type: "unrecognized_columns",
        parameters: { file: name, column },
        relatedObjectIds: [],
      });
    }
    tables.push(parseTable(name, columns, rows, collector));
    parsedFiles++;
    onProgress?.({ phase: "parsing", completed: parsedFiles, total: textFiles.length, fileName: name });
  }

  if (tables.length === 0) {
    throw new Error("The ZIP does not contain any GTFS .txt files.");
  }

  tables.sort((a, b) => a.name.localeCompare(b.name));
  unrecognizedFiles.sort();
  return { tables, unrecognizedFiles, warnings: collector ? [...collector.all] : undefined };
}
