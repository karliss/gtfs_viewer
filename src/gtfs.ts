import { unzipSync } from "fflate";
import Papa from "papaparse";
import {
  gtfsFloatFields, gtfsIntegerFields, gtfsFields, type GtfsFields, type GtfsTableName,
} from "./gtfs-schema";
import type { GtfsWarning, WarningCollector } from "./warnings";

export type { GtfsFields, GtfsTableName } from "./gtfs-schema";

export interface GtfsColor {
  raw: string;
  css: string;
}

export function processGtfsColor(value: string | null | undefined): GtfsColor | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!/^[\da-f]{6}$/i.test(raw)) return null;
  const normalized = raw.toLowerCase();
  return { raw: normalized, css: `#${normalized}` };
}

export const WHEELCHAIR_ACCESSIBLE_VALUES = {
  UNKNOWN: 0,
  YES: 1,
  NO: 2,
} as const;

export const BIKES_ALLOWED_VALUES = {
  UNKNOWN: 0,
  YES: 1,
  NO: 2,
} as const;

export const CARS_ALLOWED_VALUES = {
  UNKNOWN: 0,
  YES: 1,
  NO: 2,
} as const;

export const PICKUP_TYPES = {
  REGULAR: 0,
  NO_SERVICE: 1,
  PHONE_AGENCY: 2,
  COORDINATE: 3,
} as const;

export const DROP_OFF_TYPES = {
  REGULAR: 0,
  NO_SERVICE: 1,
  PHONE_AGENCY: 2,
  COORDINATE: 3,
} as const;

export function decodePickupType(value: number | null): string {
  if (value === null || value === PICKUP_TYPES.REGULAR) return "regular pickup";
  if (value === PICKUP_TYPES.NO_SERVICE) return "no pickup";
  if (value === PICKUP_TYPES.PHONE_AGENCY) return "pickup by phone";
  if (value === PICKUP_TYPES.COORDINATE) return "pickup by coordinate";
  return `pickup type ${value}`;
}

export function decodeDropOffType(value: number | null): string {
  if (value === null || value === DROP_OFF_TYPES.REGULAR) return "regular drop-off";
  if (value === DROP_OFF_TYPES.NO_SERVICE) return "no drop-off";
  if (value === DROP_OFF_TYPES.PHONE_AGENCY) return "drop-off by phone";
  if (value === DROP_OFF_TYPES.COORDINATE) return "drop-off by coordinate";
  return `drop-off type ${value}`;
}

export function decodeTripFieldValue(
  value: number | null,
): "Unknown" | "Yes" | "No" | "Unrecognized" {
  if (value === null || value === WHEELCHAIR_ACCESSIBLE_VALUES.UNKNOWN
    || value === BIKES_ALLOWED_VALUES.UNKNOWN
    || value === CARS_ALLOWED_VALUES.UNKNOWN) return "Unknown";
  if (value === WHEELCHAIR_ACCESSIBLE_VALUES.YES
    || value === BIKES_ALLOWED_VALUES.YES
    || value === CARS_ALLOWED_VALUES.YES) return "Yes";
  if (value === WHEELCHAIR_ACCESSIBLE_VALUES.NO
    || value === BIKES_ALLOWED_VALUES.NO
    || value === CARS_ALLOWED_VALUES.NO) return "No";
  return "Unrecognized";
}

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

export interface GtfsIndexes {
  agenciesById: Map<string, GtfsRow<"agency.txt">>;
  routesById: Map<string, GtfsRow<"routes.txt">>;
  stopsById: Map<string, GtfsRow<"stops.txt">>;
  tripsById: Map<string, GtfsRow<"trips.txt">>;
  shapesById: Map<string, GtfsRow<"shapes.txt">[]>;
  tripsByRouteId: Map<string, GtfsRow<"trips.txt">[]>;
  routesByTripId: Map<string, string>;
  stopTimesByTripId: Map<string, GtfsRow<"stop_times.txt">[]>;
  stopTimesByStopId: Map<string, GtfsRow<"stop_times.txt">[]>;
  calendarByServiceId: Map<string, GtfsRow<"calendar.txt">[]>;
  calendarDatesByServiceId: Map<string, GtfsRow<"calendar_dates.txt">[]>;
  routesByStopId: Map<string, string[]>;
  fareAttributesById: Map<string, GtfsRow<"fare_attributes.txt">>;
  fareRulesByRouteId: Map<string, GtfsRow<"fare_rules.txt">[]>;
  fareRulesWithoutRoute: GtfsRow<"fare_rules.txt">[];
  stopAreasByStopId: Map<string, GtfsRow<"stop_areas.txt">[]>;
  fareLegRules: GtfsRow<"fare_leg_rules.txt">[];
  fareProductsById: Map<string, GtfsRow<"fare_products.txt">>;
  networksByRouteId: Map<string, string[]>;
  fareCache: Map<string, FareResult | null>;
}

export interface GtfsFeed {
  tables: GtfsTable[];
  unrecognizedFiles: string[];
  warnings?: GtfsWarning[];
  indexes: GtfsIndexes;
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
    if (table.kind === "routes.txt" && "route_type" in row.fields && row.fields.route_type !== null) {
      const value = String(row.fields.route_type);
      const name = decodeRouteType(value);
      values.push(name === `Unknown route type (${value})` ? name : `${name} (${value})`);
    }
    return values.some((value) => value !== null && String(value).toLocaleLowerCase().includes(query));
  });
}

export function getReferencedRoute(
  routes: ReadonlyMap<string, GtfsRow<"routes.txt">>,
  tableKind: GtfsTable["kind"],
  column: string,
  value: string | number | null,
): GtfsRow<"routes.txt"> | undefined {
  if (tableKind === "routes.txt" || !value ||
    (column !== "route_id" && column !== "from_route_id" && column !== "to_route_id")) {
    return undefined;
  }
  return routes.get(String(value));
}

export interface TripFieldSummary {
  value: number | null;
  count: number;
  percent: number | null;
}

export function summarizeTripField(
  trips: readonly GtfsRow<"trips.txt">[],
  field: "wheelchair_accessible" | "bikes_allowed" | "cars_allowed",
): TripFieldSummary[] {
  if (!trips.length) return [];
  const counts = new Map<number | null, number>();
  for (const trip of trips) {
    const value = trip.fields[field];
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const showPercent = counts.size > 1;
  return [...counts].map(([value, count]) => ({
    value,
    count,
    percent: showPercent ? Number((count * 100 / trips.length).toFixed(1)) : null,
  }));
}

export interface RouteVariant {
  shapeId: string | null;
  tripHeadsign: string | null;
  tripShortName: string | null;
  directionIds: (number | null)[];
  stops: (string | null)[];
  trips: GtfsRow<"trips.txt">[];
}

export interface VariantTimetableDeparture {
  minute: number;
  days: number[] | null;
}

export interface VariantTimetableRow {
  hour: number;
  departures: VariantTimetableDeparture[];
}

export interface VariantTimetable {
  popularDays: number[][];
  exceptionDates: string[];
  rows: VariantTimetableRow[];
}

export function gtfsDateToIso(date: string | null): string | null {
  if (!date || !/^\d{8}$/.test(date)) return null;
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

export function isoDateToGtfs(date: string | null): string | null {
  if (!date) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return match ? `${match[1]}${match[2]}${match[3]}` : null;
}

export function isServiceActiveOnDate(feed: GtfsFeed, serviceId: string | null, date: string): boolean {
  if (!serviceId) return false;
  const gtfsDate = isoDateToGtfs(date);
  if (!gtfsDate) return false;
  let active: boolean | null = null;
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const days = [
    null,
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ] as const;
  const dayField = days[weekday === 0 ? 7 : weekday];
  for (const calendar of feed.indexes.calendarByServiceId.get(serviceId) ?? []) {
    const start = calendar.fields.start_date;
    const end = calendar.fields.end_date;
    if (!dayField || !start || !end || gtfsDate < start || gtfsDate > end) continue;
    if (active === null) active = false;
    if (calendar.fields[dayField] === 1) active = true;
  }
  for (const exception of feed.indexes.calendarDatesByServiceId.get(serviceId) ?? []) {
    if (exception.fields.date !== gtfsDate) continue;
    if (exception.fields.exception_type === 1) active = true;
    if (exception.fields.exception_type === 2) active = false;
  }
  return active ?? false;
}

export interface DateScheduleDeparture {
  tripId: string | null;
  time: string;
  minute: number;
  hour: number;
  headsign: string | null;
  shortName: string | null;
}

export interface DateScheduleRow {
  hour: number;
  departures: DateScheduleDeparture[];
}

export interface DateScheduleVariant {
  variant: RouteVariant;
  rows: DateScheduleRow[];
  tripCount: number;
}

export interface FareResult {
  destinationStopId: string;
  fareId: string | null;
  price: number | null;
  currency: string | null;
  productName: string | null;
  source: "legacy" | "modern";
  matchedRules: {
    table: string;
    fields: Record<string, string | number | null>;
  }[];
}

export function getDateSchedule(feed: GtfsFeed, variant: RouteVariant, date: string): DateScheduleVariant {
  const grouped = new Map<number, Map<number, DateScheduleDeparture[]>>();
  let tripCount = 0;
  const firstStop = variant.stops[0];
  for (const trip of variant.trips) {
    if (!isServiceActiveOnDate(feed, trip.fields.service_id, date)) continue;
    tripCount++;
    const tripId = trip.fields.trip_id;
    if (!tripId) continue;
    for (const stopTime of feed.indexes.stopTimesByTripId.get(tripId) ?? []) {
      if (firstStop !== null && stopTime.fields.stop_id !== firstStop) continue;
      const time = stopTime.fields.departure_time || stopTime.fields.arrival_time;
      const match = time ? /^(\d+):(\d{2})(:\d{2})?$/.exec(time) : null;
      if (!match) continue;
      const hour = Number(match[1]);
      const minute = Number(match[2]);
      if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute > 59) continue;
      const minutes = grouped.get(hour) ?? new Map<number, DateScheduleDeparture[]>();
      const departures = minutes.get(minute) ?? [];
      departures.push({
        tripId,
        time: match[0],
        hour,
        minute,
        headsign: trip.fields.trip_headsign,
        shortName: trip.fields.trip_short_name,
      });
      minutes.set(minute, departures);
      grouped.set(hour, minutes);
    }
  }
  const rows = [...grouped.entries()].sort(([a], [b]) => a - b).map(([hour, minutes]) => ({
    hour,
    departures: [...minutes.entries()].sort(([a], [b]) => a - b)
      .flatMap(([, departures]) => departures),
  }));
  return { variant, rows, tripCount };
}

export function getTripFares(feed: GtfsFeed, trip: GtfsRow<"trips.txt">,
  originStopId: string, destinationStopIds: readonly (string | null)[]): FareResult[] {
  const routeId = trip.fields.route_id;
  const results: FareResult[] = [];

  const legacyFareFor = (destinationStopId: string): FareResult | null => {
    const origin = feed.indexes.stopsById.get(originStopId);
    const destination = feed.indexes.stopsById.get(destinationStopId);
    const originZone = origin?.fields.zone_id;
    const destinationZone = destination?.fields.zone_id;
    const routeRules = routeId
      ? feed.indexes.fareRulesByRouteId.get(routeId) ?? []
      : [];
    for (const rule of [...routeRules, ...feed.indexes.fareRulesWithoutRoute]) {
      if (rule.fields.route_id && routeId && rule.fields.route_id !== routeId) continue;
      if (rule.fields.origin_id && originZone && rule.fields.origin_id !== originZone) continue;
      if (rule.fields.destination_id && destinationZone && rule.fields.destination_id !== destinationZone) continue;
      if (rule.fields.contains_id && originZone !== rule.fields.contains_id &&
        destinationZone !== rule.fields.contains_id) continue;
      if (rule.fields.fare_id) {
        const attribute = feed.indexes.fareAttributesById.get(rule.fields.fare_id);
        if (attribute) return {
          destinationStopId,
          fareId: rule.fields.fare_id,
          price: attribute.fields.price,
          currency: attribute.fields.currency_type,
          productName: null,
          source: "legacy",
          matchedRules: [
            { table: "fare_rules.txt", fields: { ...rule.fields } },
            { table: "fare_attributes.txt", fields: { ...attribute.fields } },
          ],
        };
      }
    }
    return null;
  };

  for (const destinationStopId of destinationStopIds) {
    if (!destinationStopId) continue;
    const cacheKey = `${routeId ?? ""}\u001f${originStopId}\u001f${destinationStopId}`;
    if (feed.indexes.fareCache.has(cacheKey)) {
      const cached = feed.indexes.fareCache.get(cacheKey);
      results.push(cached ? { ...cached, destinationStopId } : {
        destinationStopId, fareId: null, price: null, currency: null, productName: null,
        source: "legacy", matchedRules: [],
      });
      continue;
    }
    let modern: FareResult | null = null;
    if (feed.indexes.fareLegRules.length > 0) {
      const originAreas = (feed.indexes.stopAreasByStopId.get(originStopId) ?? [])
        .map((row) => row.fields.area_id).filter((id): id is string => id !== null);
      const destinationAreas = (feed.indexes.stopAreasByStopId.get(destinationStopId) ?? [])
        .map((row) => row.fields.area_id).filter((id): id is string => id !== null);
      const networks = routeId
        ? feed.indexes.networksByRouteId.get(routeId) ?? []
        : [];
      for (const rule of feed.indexes.fareLegRules) {
        if (rule.fields.from_area_id && !originAreas.includes(rule.fields.from_area_id)) continue;
        if (rule.fields.to_area_id && !destinationAreas.includes(rule.fields.to_area_id)) continue;
        if (rule.fields.network_id && networks.length > 0 && !networks.includes(rule.fields.network_id)) continue;
        if (!rule.fields.fare_product_id) continue;
        const product = feed.indexes.fareProductsById.get(rule.fields.fare_product_id);
        if (product) {
          modern = {
            destinationStopId,
            fareId: rule.fields.fare_product_id,
            price: product.fields.amount,
            currency: product.fields.currency,
            productName: product.fields.fare_product_name,
            source: "modern",
            matchedRules: [
              { table: "fare_leg_rules.txt", fields: { ...rule.fields } },
              { table: "fare_products.txt", fields: { ...product.fields } },
            ],
          };
          break;
        }
      }
    }
    const resolved = modern ?? legacyFareFor(destinationStopId);
    feed.indexes.fareCache.set(cacheKey, resolved);
    results.push(resolved ? { ...resolved, destinationStopId } : {
      destinationStopId, fareId: null, price: null, currency: null, productName: null,
      source: "legacy", matchedRules: [],
    });
  }
  return results;
}

export function formatTimetableDayRange(days: readonly number[]): string {
  if (days.length === 0) return "1-7";
  const sorted = [...new Set(days)].filter((day) => day >= 1 && day <= 7).sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let index = 0; index < sorted.length;) {
    let end = index;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end++;
    ranges.push(index === end
      ? String(sorted[index])
      : `${sorted[index]}-${sorted[end]}`);
    index = end + 1;
  }
  return ranges.join(", ");
}

export function getVariantTimetable(feed: GtfsFeed, variant: RouteVariant): VariantTimetable[] {
  const firstStop = variant.stops[0];
  const tripIds = new Set(variant.trips.flatMap((trip) => trip.fields.trip_id ? [trip.fields.trip_id] : []));

  const daySetsForService = (serviceId: string | null): number[][] => {
    if (!serviceId) return [];
    const rows = feed.indexes.calendarByServiceId.get(serviceId);
    if (!rows?.length) return [];
    const sets = rows.map((row) => [
      row.fields.monday === 1 ? 1 : null,
      row.fields.tuesday === 1 ? 2 : null,
      row.fields.wednesday === 1 ? 3 : null,
      row.fields.thursday === 1 ? 4 : null,
      row.fields.friday === 1 ? 5 : null,
      row.fields.saturday === 1 ? 6 : null,
      row.fields.sunday === 1 ? 7 : null,
    ].filter((day): day is number => day !== null));
    return [...new Map(sets.map((days) => [days.join(","), days])).values()];
  };

  const allDaySets = new Map<string, number[]>();
  for (const trip of variant.trips) {
    for (const days of daySetsForService(trip.fields.service_id)) {
      allDaySets.set(days.join(","), days);
    }
  }
  const serviceIds = new Set(variant.trips.flatMap((trip) =>
    trip.fields.service_id ? [trip.fields.service_id] : []));
  const exceptionDates = [...new Set(
    [...serviceIds].flatMap((serviceId) => feed.indexes.calendarDatesByServiceId.get(serviceId) ?? [])
      .map((row) => row.fields.date)
      .filter((date): date is string => date !== null))]
    .sort();

  const buildTimetable = (targetDays: number[] | null): VariantTimetable => {
    const grouped = new Map<number, Map<number, Map<string, number>>>();
    for (const trip of variant.trips) {
      const tripId = trip.fields.trip_id;
      if (!tripId || !tripIds.has(tripId)) continue;
      const sets = daySetsForService(trip.fields.service_id);
      if (targetDays && !sets.some((days) => days.join(",") === targetDays.join(","))) continue;
      const rows = feed.indexes.stopTimesByTripId.get(tripId)?.filter((row) =>
        firstStop !== null && row.fields.stop_id === firstStop) ?? [];
      for (const row of rows) {
        const time = row.fields.departure_time || row.fields.arrival_time;
        if (!time) continue;
        const match = /^(\d+):(\d{2})(:\d{2})?$/.exec(time);
        if (!match) continue;
        const hour = Number(match[1]);
        const minute = Number(match[2]);
        if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute > 59) continue;
        let minutes = grouped.get(hour);
        if (!minutes) {
          minutes = new Map();
          grouped.set(hour, minutes);
        }
        let dayCounts = minutes.get(minute);
        if (!dayCounts) {
          dayCounts = new Map();
          minutes.set(minute, dayCounts);
        }
        const dayKey = targetDays?.join(",") ?? "";
        dayCounts.set(dayKey, (dayCounts.get(dayKey) ?? 0) + 1);
      }
    }
    const rows: VariantTimetableRow[] = [...grouped.entries()]
      .sort(([left], [right]) => left - right)
      .map(([hour, minuteMap]) => ({
        hour,
        departures: [...minuteMap.entries()].sort(([left], [right]) => left - right).flatMap(([minute]) => [{
          minute,
          days: targetDays,
        }]),
      }));
    const popularDays = targetDays ? [targetDays] : [[1, 2, 3, 4, 5, 6, 7]];
    return { popularDays, exceptionDates, rows };
  };

  const daySets = [...allDaySets.values()];
  if (daySets.length === 0) return [buildTimetable(null)];
  return daySets.map((days) => buildTimetable(days));
}

export function getVariantTableRows(
  feed: GtfsFeed, variant: RouteVariant, kind: "shapes.txt" | "trips.txt",
): GtfsTable | undefined {
  const table = feed.tables.find((candidate) => candidate.kind === kind);
  if (!table) return undefined;
  if (table.kind === "shapes.txt" && variant.shapeId !== null) {
    return { ...table, rows: feed.indexes.shapesById.get(variant.shapeId) ?? [] };
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
  const routeTrips = feed.indexes.tripsByRouteId.get(routeId) ?? [];

  const sequence = (value: number | null): number => value ?? Infinity;
  const stopsByTrip = new Map<string, (string | null)[]>();
  for (const trip of routeTrips) {
    const tripId = trip.fields.trip_id;
    if (!tripId) continue;
    const times = [...(feed.indexes.stopTimesByTripId.get(tripId) ?? [])];
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
  const fieldNames = new Set(fields);
  const floatFields = new Set<string>(kind === "unknown" ? [] :
    (gtfsFloatFields as Partial<Record<GtfsTableName, readonly string[]>>)[kind] ?? []);
  const integerFields = new Set<string>(kind === "unknown" ? [] :
    (gtfsIntegerFields as Partial<Record<GtfsTableName, readonly string[]>>)[kind] ?? []);
  const columnIndexes = new Map(columns.map((column, index) => [column, index]));
  const unknownColumns = columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => !fieldNames.has(column));
  const valueAt = (
    record: string[], column: string, index: number | undefined, rowIndex: number,
  ): string | number | null => {
    const value = index === undefined ? null : record[index] ?? null;
    if (value === null) return null;
    if (fieldNames.has(column)) {
      const normalized = value.trim();
      if (!normalized) return null;
      if (floatFields.has(column) || integerFields.has(column)) {
        const valid = floatFields.has(column)
          ? /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)
          : /^[+-]?\d+$/.test(normalized);
        const parsed = Number(normalized);
        if (valid && Number.isFinite(parsed) && (floatFields.has(column) || Number.isSafeInteger(parsed))) {
          return parsed;
        }
        collector?.add({
          type: "invalid_values",
          parameters: { file: name, row: rowIndex + 2, column, value },
          relatedObjectIds: [],
          csvRowNumber: rowIndex + 2,
        });
        return null;
      }
      return normalized;
    }
    return column === "id" || column.endsWith("_id") ? value.trim() : value;
  };
  const rows = records.map((record, index) => {
    const row = {
      fields: Object.fromEntries(fields.map((field) => {
        const columnIndex = columnIndexes.get(field);
        return [field, valueAt(record, field, columnIndex, index)];
      })),
      unrecognizedColumns: Object.fromEntries(
        unknownColumns.map(({ column, index: columnIndex }) => [
          column, valueAt(record, column, columnIndex, index),
        ]),
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
    "fare_attributes.txt": "fare_id",
    "fare_media.txt": "fare_media_id",
    "rider_categories.txt": "rider_category_id",
    "areas.txt": "area_id",
    "networks.txt": "network_id",
    "route_networks.txt": "route_id",
    "pathways.txt": "pathway_id",
    "booking_rules.txt": "booking_rule_id",
    "attributions.txt": "attribution_id",
    "levels.txt": "level_id",
    "location_groups.txt": "location_group_id",
  };
  const idColumn = kind === "unknown" ? undefined : primaryIdColumns[kind];
  if (idColumn) {
    const seen = new Map<string, number>();
    for (const [index, row] of rows.entries()) {
      const rawId = row.fields[idColumn];
      const id = typeof rawId === "string" ? rawId : null;
      if (id === null || id === "") {
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
  phase: "extracting" | "parsing" | "indexing";
  completed: number;
  total: number;
  fileName?: string;
}

function initializeFeedIndexes(feed: GtfsFeed): void {
  const getRows = <Name extends GtfsTableName>(kind: Name): GtfsRow<Name>[] =>
    (feed.tables.find((table) => table.kind === kind)?.rows as GtfsRow<Name>[] | undefined) ?? [];

  const agenciesById = new Map<string, GtfsRow<"agency.txt">>();
  for (const row of getRows("agency.txt")) {
    const id = row.fields.agency_id;
    if (id && !agenciesById.has(id)) agenciesById.set(id, row);
  }

  const routesById = new Map<string, GtfsRow<"routes.txt">>();
  for (const row of getRows("routes.txt")) {
    const id = row.fields.route_id;
    if (id && !routesById.has(id)) routesById.set(id, row);
  }

  const stopsById = new Map<string, GtfsRow<"stops.txt">>();
  for (const row of getRows("stops.txt")) {
    const id = row.fields.stop_id;
    if (id && !stopsById.has(id)) stopsById.set(id, row);
  }

  const tripsById = new Map<string, GtfsRow<"trips.txt">>();
  const tripsByRouteId = new Map<string, GtfsRow<"trips.txt">[]>();
  const routesByTripId = new Map<string, string>();
  for (const row of getRows("trips.txt")) {
    const tripId = row.fields.trip_id;
    if (tripId && !tripsById.has(tripId)) tripsById.set(tripId, row);
    const routeId = row.fields.route_id;
    if (routeId) {
      const rows = tripsByRouteId.get(routeId) ?? [];
      rows.push(row);
      tripsByRouteId.set(routeId, rows);
      if (tripId) routesByTripId.set(tripId, routeId);
    }
  }

  const shapesById = new Map<string, GtfsRow<"shapes.txt">[]>();
  for (const row of getRows("shapes.txt")) {
    const id = row.fields.shape_id;
    if (id) {
      const rows = shapesById.get(id) ?? [];
      rows.push(row);
      shapesById.set(id, rows);
    }
  }

  const stopTimesByTripId = new Map<string, GtfsRow<"stop_times.txt">[]>();
  const stopTimesByStopId = new Map<string, GtfsRow<"stop_times.txt">[]>();
  for (const row of getRows("stop_times.txt")) {
    const tripId = row.fields.trip_id;
    if (tripId) {
      const rows = stopTimesByTripId.get(tripId) ?? [];
      rows.push(row);
      stopTimesByTripId.set(tripId, rows);
    }
    const stopId = row.fields.stop_id;
    if (stopId) {
      const rows = stopTimesByStopId.get(stopId) ?? [];
      rows.push(row);
      stopTimesByStopId.set(stopId, rows);
    }
  }

  const calendarByServiceId = new Map<string, GtfsRow<"calendar.txt">[]>();
  for (const row of getRows("calendar.txt")) {
    const id = row.fields.service_id;
    if (id) {
      const rows = calendarByServiceId.get(id) ?? [];
      rows.push(row);
      calendarByServiceId.set(id, rows);
    }
  }

  const calendarDatesByServiceId = new Map<string, GtfsRow<"calendar_dates.txt">[]>();
  for (const row of getRows("calendar_dates.txt")) {
    const id = row.fields.service_id;
    if (id) {
      const rows = calendarDatesByServiceId.get(id) ?? [];
      rows.push(row);
      calendarDatesByServiceId.set(id, rows);
    }
  }

  const routeIdsByStop = new Map<string, Set<string>>();
  for (const [tripId, times] of stopTimesByTripId) {
    const trip = tripsById.get(tripId);
    const routeId = trip?.fields.route_id;
    if (!routeId) continue;
    for (const time of times) {
      const stopId = time.fields.stop_id;
      if (!stopId) continue;
      const routes = routeIdsByStop.get(stopId) ?? new Set<string>();
      routes.add(routeId);
      routeIdsByStop.set(stopId, routes);
    }
  }
  const routesByStopId = new Map<string, string[]>(
    [...routeIdsByStop].map(([stopId, routes]) => [stopId, [...routes]]),
  );
  const fareAttributesById = new Map<string, GtfsRow<"fare_attributes.txt">>();
  for (const row of getRows("fare_attributes.txt")) {
    const id = row.fields.fare_id;
    if (id && !fareAttributesById.has(id)) fareAttributesById.set(id, row);
  }

  const fareRulesByRouteId = new Map<string, GtfsRow<"fare_rules.txt">[]>();
  const fareRulesWithoutRoute: GtfsRow<"fare_rules.txt">[] = [];
  for (const row of getRows("fare_rules.txt")) {
    const routeId = row.fields.route_id;
    if (routeId) {
      const rows = fareRulesByRouteId.get(routeId) ?? [];
      rows.push(row);
      fareRulesByRouteId.set(routeId, rows);
    } else {
      fareRulesWithoutRoute.push(row);
    }
  }

  const stopAreasByStopId = new Map<string, GtfsRow<"stop_areas.txt">[]>();
  for (const row of getRows("stop_areas.txt")) {
    const stopId = row.fields.stop_id;
    if (stopId) {
      const rows = stopAreasByStopId.get(stopId) ?? [];
      rows.push(row);
      stopAreasByStopId.set(stopId, rows);
    }
  }

  const fareLegRules = getRows("fare_leg_rules.txt");
  const fareProductsById = new Map<string, GtfsRow<"fare_products.txt">>();
  for (const row of getRows("fare_products.txt")) {
    const id = row.fields.fare_product_id;
    if (id && !fareProductsById.has(id)) fareProductsById.set(id, row);
  }

  const networksByRouteId = new Map<string, string[]>();
  for (const row of getRows("route_networks.txt")) {
    const routeId = row.fields.route_id;
    const networkId = row.fields.network_id;
    if (routeId && networkId) {
      const networks = networksByRouteId.get(routeId) ?? [];
      if (!networks.includes(networkId)) networks.push(networkId);
      networksByRouteId.set(routeId, networks);
    }
  }

  feed.indexes = {
    agenciesById,
    routesById,
    stopsById,
    tripsById,
    shapesById,
    tripsByRouteId,
    routesByTripId,
    stopTimesByTripId,
    stopTimesByStopId,
    calendarByServiceId,
    calendarDatesByServiceId,
    routesByStopId,
    fareAttributesById,
    fareRulesByRouteId,
    fareRulesWithoutRoute,
    stopAreasByStopId,
    fareLegRules,
    fareProductsById,
    networksByRouteId,
    fareCache: new Map<string, FareResult | null>(),
  };
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
  const feed = {
    tables,
    unrecognizedFiles,
    warnings: collector ? [...collector.all] : undefined,
  } as GtfsFeed;
  onProgress?.({ phase: "indexing", completed: 0, total: 1 });
  initializeFeedIndexes(feed);
  onProgress?.({ phase: "indexing", completed: 1, total: 1 });
  return feed;
}
