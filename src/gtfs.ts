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
  shapePointsById: Map<string, [number | null, number | null, number | null][]>;
  routeVariantsByRouteId: Map<string, RouteVariant[]>;
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
  routeId: string | null;
  shapeId: string | null;
  shapeIds: string[];
  mergedWithDifferentShapes: boolean;
  differentShapePairs: Array<{ firstShapeId: string; secondShapeId: string }>;
  tripHeadsign: string | null;
  tripShortName: string | null;
  directionIds: (number | null)[];
  stops: (string | null)[];
  trips: GtfsRow<"trips.txt">[];
}

export interface VariantMergeResult {
  merged: boolean;
  mergedVariantCount: number;
  canonicalShapeId: string | null;
  removedShapeIds: string[];
}

export interface RouteVariantMergeSummary {
  variantsBefore: number;
  variantsAfter: number;
  mergedVariantCount: number;
  removedShapeIds: string[];
}

export interface FeedVariantMergeSummary {
  routesAttempted: number;
  routesMerged: number;
  mergedVariantCount: number;
  removedShapeIds: string[];
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
  dateRange: [string | null, string | null];
  exceptionDates: string[];
  rows: VariantTimetableRow[];
}

export type TimetableDateRange = [string | null, string | null];

export interface TimetableCalendarItem {
  serviceId: string;
  days: number[];
  dateRange: TimetableDateRange;
}

export interface TimetableCalendarData {
  calendarItems: TimetableCalendarItem[];
  exceptionDates: string[];
}

export interface TimetableServiceDateRange {
  dateRange: TimetableDateRange;
  serviceDays: Map<string, number[]>;
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

export function collectTimetableCalendarData(
  feed: GtfsFeed,
  variant: RouteVariant,
): TimetableCalendarData {
  const serviceIds = new Set(variant.trips.flatMap((trip) =>
    trip.fields.service_id ? [trip.fields.service_id] : []));
  const calendarItems: TimetableCalendarItem[] = [];
  for (const serviceId of serviceIds) {
    for (const row of feed.indexes.calendarByServiceId.get(serviceId) ?? []) {
      calendarItems.push({
        serviceId,
        days: [
          row.fields.monday === 1 ? 1 : null,
          row.fields.tuesday === 1 ? 2 : null,
          row.fields.wednesday === 1 ? 3 : null,
          row.fields.thursday === 1 ? 4 : null,
          row.fields.friday === 1 ? 5 : null,
          row.fields.saturday === 1 ? 6 : null,
          row.fields.sunday === 1 ? 7 : null,
        ].filter((day): day is number => day !== null),
        dateRange: [row.fields.start_date, row.fields.end_date],
      });
    }
  }
  const exceptionDates = [...new Set(
    [...serviceIds].flatMap((serviceId) => feed.indexes.calendarDatesByServiceId.get(serviceId) ?? [])
      .map((row) => row.fields.date)
      .filter((date): date is string => date !== null))]
    .sort();
  return { calendarItems, exceptionDates };
}

function shiftTimetableDate(date: string, days: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6)) - 1;
  const day = Number(date.slice(6, 8));
  const shifted = new Date(Date.UTC(year, month, day + days));
  return `${shifted.getUTCFullYear()}${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`
    + String(shifted.getUTCDate()).padStart(2, "0");
}

function isValidTimetableDate(date: string | null): date is string {
  return Boolean(date && /^\d{8}$/.test(date) && shiftTimetableDate(date, 0) === date);
}

function isValidTimetableDateRange(dateRange: TimetableDateRange): boolean {
  const [startDate, endDate] = dateRange;
  return (!(startDate && !isValidTimetableDate(startDate))
    && !(endDate && !isValidTimetableDate(endDate)))
    && !(startDate && endDate && startDate > endDate);
}

function timetableDateRangesOverlap(
  first: TimetableDateRange,
  second: TimetableDateRange,
): boolean {
  return (!first[1] || !second[0] || first[1] >= second[0])
    && (!second[1] || !first[0] || second[1] >= first[0]);
}

export function splitTimetableCalendarRanges(
  dateRanges: readonly TimetableDateRange[],
): TimetableDateRange[] {
  const validRanges = dateRanges.filter(isValidTimetableDateRange);
  if (validRanges.length === 0) return [];
  const events = new Map<string, number>();
  let activeRangeCount = 0;
  const addEvent = (date: string, change: number): void => {
    events.set(date, (events.get(date) ?? 0) + change);
  };
  for (const [startDate, endDate] of validRanges) {
    if (startDate) addEvent(startDate, 1);
    else activeRangeCount++;
    if (endDate) addEvent(shiftTimetableDate(endDate, 1), -1);
  }
  const sortedEventDates = [...events.keys()].sort();
  const splitRanges: TimetableDateRange[] = [];
  let startDate: string | null = null;
  for (const eventDate of sortedEventDates) {
    if (activeRangeCount > 0) {
      splitRanges.push([startDate, shiftTimetableDate(eventDate, -1)]);
    }
    activeRangeCount += events.get(eventDate) ?? 0;
    startDate = eventDate;
  }
  if (activeRangeCount > 0) splitRanges.push([startDate, null]);
  return splitRanges;
}

export function collectTimetableServiceDateRanges(
  calendarItems: readonly TimetableCalendarItem[],
  dateRanges: readonly TimetableDateRange[],
): TimetableServiceDateRange[] {
  const serviceDaySetsByRange: TimetableServiceDateRange[] = dateRanges.flatMap((dateRange) => {
    const overlappingItems = calendarItems.filter((item) =>
      isValidTimetableDateRange(item.dateRange)
      && timetableDateRangesOverlap(item.dateRange, dateRange));
    const serviceDays = new Map<string, Set<number>>();
    for (const item of overlappingItems) {
      const days = serviceDays.get(item.serviceId) ?? new Set<number>();
      for (const day of item.days) days.add(day);
      serviceDays.set(item.serviceId, days);
    }
    if (serviceDays.size === 0) return [];
    return [{
      dateRange,
      serviceDays: new Map([...serviceDays].map(([serviceId, days]) =>
        [serviceId, [...days].sort((left, right) => left - right)])),
    }];
  });
  return serviceDaySetsByRange.reduce<TimetableServiceDateRange[]>((result, current) => {
    const previous = result[result.length - 1];
    const signature = JSON.stringify([...current.serviceDays]);
    const previousSignature = previous ? JSON.stringify([...previous.serviceDays]) : null;
    if (previous && signature === previousSignature
      && previous.dateRange[1] !== null && current.dateRange[0] !== null
      && shiftTimetableDate(previous.dateRange[1], 1) === current.dateRange[0]) {
      previous.dateRange[1] = current.dateRange[1];
    } else {
      result.push(current);
    }
    return result;
  }, []);
}

export function getPopularTimetableDays(serviceMasks: readonly (readonly number[])[]): number[][] {
  const masks = serviceMasks
    .map((days) => [...new Set(days)].filter((day) => day >= 1 && day <= 7).sort((a, b) => a - b))
    .filter((days) => days.length > 0);
  const combinedDays = [...new Set(masks.flat())].sort((left, right) => left - right);
  const candidates = [...new Map(masks.map((days) => [days.join(","), days])).values()];
  const counts = new Map(candidates.map((days) => [days.join(","), 0]));
  for (const days of masks) {
    const serviceDays = new Set(days);
    for (const candidate of candidates) {
      if (candidate.every((day) => serviceDays.has(day))) {
        const key = candidate.join(",");
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  candidates.sort((left, right) => {
    const countDifference = (counts.get(right.join(",")) ?? 0) - (counts.get(left.join(",")) ?? 0);
    if (countDifference !== 0) return countDifference;
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
      if (left[index] !== right[index]) return left[index] - right[index];
    }
    return left.length - right.length;
  });
  const mostPopular = candidates[0];
  if (!mostPopular) return [];
  const secondPopular = combinedDays.filter((day) => !mostPopular.includes(day));
  return secondPopular.length ? [mostPopular, secondPopular] : [mostPopular];
}

function buildVariantTimetable(
  feed: GtfsFeed,
  variant: RouteVariant,
  targetRange: TimetableServiceDateRange | null,
  exceptionDates: string[],
): VariantTimetable {
  const firstStop = variant.stops[0];
  const serviceDays = targetRange?.serviceDays ?? null;
  const popularDays = targetRange
    ? getPopularTimetableDays([...targetRange.serviceDays.values()])
    : [];
  const timetableDays = popularDays.length > 0
    ? popularDays
    : [[1, 2, 3, 4, 5, 6, 7]];
  const grouped = new Map<number, Map<number, Set<string>>>();
  for (const trip of variant.trips) {
    const tripId = trip.fields.trip_id;
    if (!tripId) continue;
    const tripDays = trip.fields.service_id
      ? serviceDays?.get(trip.fields.service_id) ?? null
      : null;
    if (targetRange && !tripDays) continue;
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
      let dayMasks = minutes.get(minute);
      if (!dayMasks) {
        dayMasks = new Set();
        minutes.set(minute, dayMasks);
      }
      dayMasks.add(tripDays === null ? "*" : tripDays.join(","));
    }
  }
  const rows: VariantTimetableRow[] = [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([hour, minuteMap]) => ({
      hour,
      departures: [...minuteMap.entries()].sort(([left], [right]) => left - right)
        .flatMap(([minute, dayMasks]) => [...dayMasks].map((dayMask) => ({
          minute,
          days: dayMask === "*" ? null : dayMask ? dayMask.split(",").map(Number) : [],
        }))),
    }));
  return {
    popularDays: timetableDays,
    dateRange: targetRange?.dateRange ?? [null, null],
    exceptionDates,
    rows,
  };
}

export function getVariantTimetable(feed: GtfsFeed, variant: RouteVariant): VariantTimetable[] {
  const { calendarItems, exceptionDates } = collectTimetableCalendarData(feed, variant);
  const dateRanges = splitTimetableCalendarRanges(calendarItems.map((item) => item.dateRange));
  const ranges = collectTimetableServiceDateRanges(calendarItems, dateRanges);
  if (ranges.length === 0) {
    return [buildVariantTimetable(feed, variant, null, exceptionDates)];
  }
  return ranges.map((range) => buildVariantTimetable(feed, variant, range, exceptionDates));
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

function normalizedVariantValues(values: readonly (number | null)[]): (number | null)[] {
  return [...new Set(values)].sort((a, b) => {
    if (a === null) return b === null ? 0 : 1;
    if (b === null) return -1;
    return a - b;
  });
}

function arraysEqual<T>(first: readonly T[], second: readonly T[]): boolean {
  return first.length === second.length
    && first.every((value, index) => Object.is(value, second[index]));
}

function shapePointsEqual(
  first: readonly (readonly [number | null, number | null, number | null])[],
  second: readonly (readonly [number | null, number | null, number | null])[],
): boolean {
  return first.length === second.length && first.every((point, index) => {
    const other = second[index];
    return point.length === other.length && point.every((value, coordinateIndex) =>
      Object.is(value, other[coordinateIndex]));
  });
}

export function canMergeRouteVariants(
  feed: GtfsFeed,
  first: RouteVariant,
  second: RouteVariant,
): boolean {
  if (!first.shapeId || !second.shapeId || first.shapeId === second.shapeId) return false;
  if (!first.routeId || first.routeId !== second.routeId) return false;
  if (first.tripHeadsign !== second.tripHeadsign) return false;
  if (!arraysEqual(first.stops, second.stops)) return false;
  if (!arraysEqual(normalizedVariantValues(first.directionIds),
    normalizedVariantValues(second.directionIds))) return false;
  return true;
}

function variantMergeWarnings(
  feed: GtfsFeed,
  first: RouteVariant,
  second: RouteVariant,
): GtfsWarning[] {
  const warnings: GtfsWarning[] = [];
  const routeId = first.routeId ?? "";
  const firstTripId = first.trips[0]?.fields.trip_id ?? null;
  const secondTripId = second.trips[0]?.fields.trip_id ?? null;
  if (first.tripShortName !== second.tripShortName) {
    warnings.push({
      type: "variant_merge_different_short_names",
      parameters: {
        routeId,
        first: first.tripShortName,
        second: second.tripShortName,
        firstTripId,
        firstShapeId: first.shapeId,
        secondTripId,
        secondShapeId: second.shapeId,
      },
      relatedObjectIds: [routeId, firstTripId, first.shapeId, secondTripId, second.shapeId].filter(
        (id): id is string => id !== null,
      ),
    });
  }
  if (first.shapeId && second.shapeId) {
    const firstPoints = feed.indexes.shapePointsById.get(first.shapeId);
    const secondPoints = feed.indexes.shapePointsById.get(second.shapeId);
    const identicalShapes = Boolean(firstPoints && secondPoints
      && !firstPoints.some(([lat, lon]) => lat === null || lon === null)
      && !secondPoints.some(([lat, lon]) => lat === null || lon === null)
      && shapePointsEqual(firstPoints, secondPoints));
    warnings.push({
      type: identicalShapes ? "variant_merge_identical_shapes" : "variant_merge_different_shapes",
      parameters: {
        routeId,
        firstTripId,
        firstShapeId: first.shapeId,
        secondTripId,
        secondShapeId: second.shapeId,
      },
      relatedObjectIds: [routeId, firstTripId, first.shapeId, secondTripId, second.shapeId].filter(
        (id): id is string => id !== null,
      ),
    });
  }
  return warnings;
}

export function mergeRouteVariantPair(
  feed: GtfsFeed,
  first: RouteVariant,
  second: RouteVariant,
  warningCollector?: WarningCollector,
): VariantMergeResult {
  if (!canMergeRouteVariants(feed, first, second)) {
    return {
      merged: false,
      mergedVariantCount: 0,
      canonicalShapeId: first.shapeId,
      removedShapeIds: [],
    };
  }

  const canonicalShapeId = first.shapeId;
  const secondaryShapeId = second.shapeId;
  const warnings = variantMergeWarnings(feed, first, second);
  for (const warning of warnings) {
    warningCollector?.add(warning);
    if (warning.type === "variant_merge_different_shapes"
      && canonicalShapeId
      && secondaryShapeId) {
      first.mergedWithDifferentShapes = true;
      const pair = { firstShapeId: canonicalShapeId, secondShapeId: secondaryShapeId };
      if (!first.differentShapePairs.some((candidate) =>
        candidate.firstShapeId === pair.firstShapeId
        && candidate.secondShapeId === pair.secondShapeId)) {
        first.differentShapePairs.push(pair);
      }
    }
  }
  for (const shapeId of [canonicalShapeId, secondaryShapeId]) {
    if (shapeId && !first.shapeIds.includes(shapeId)) first.shapeIds.push(shapeId);
  }
  const trips = new Set(first.trips);
  for (const trip of second.trips) trips.add(trip);
  first.trips = [...trips];

  if (first.routeId) {
    const variants = feed.indexes.routeVariantsByRouteId.get(first.routeId);
    if (variants) {
      feed.indexes.routeVariantsByRouteId.set(first.routeId,
        variants.filter((variant) => variant !== second));
    }
  }
  return {
    merged: true,
    mergedVariantCount: 1,
    canonicalShapeId,
    removedShapeIds: [],
  };
}

export function mergeRouteVariants(
  feed: GtfsFeed,
  route: GtfsRow<"routes.txt"> | string,
  warningCollector?: WarningCollector,
): RouteVariantMergeSummary {
  const routeId = typeof route === "string" ? route : route.fields.route_id;
  const variantsBefore = routeId ? getRouteVariants(feed, routeId).variants : [];
  const removedShapeIds = new Set<string>();
  let mergedVariantCount = 0;

  const canonicalVariants: RouteVariant[] = [];
  for (const variant of variantsBefore) {
    const canonical = canonicalVariants.find((candidate) => canMergeRouteVariants(feed, candidate, variant));
    if (canonical) {
      const result = mergeRouteVariantPair(feed, canonical, variant, warningCollector);
      if (result.merged) {
        mergedVariantCount += result.mergedVariantCount;
        for (const shapeId of result.removedShapeIds) removedShapeIds.add(shapeId);
      }
    } else {
      canonicalVariants.push(variant);
    }
  }

  const variantsAfter = routeId ? getRouteVariants(feed, routeId).variants : [];
  return {
    variantsBefore: variantsBefore.length,
    variantsAfter: variantsAfter.length,
    mergedVariantCount,
    removedShapeIds: [...removedShapeIds],
  };
}

export function mergeRouteVariantsInFeed(
  feed: GtfsFeed,
  warningCollector?: WarningCollector,
): FeedVariantMergeSummary {
  const removedShapeIds = new Set<string>();
  let routesAttempted = 0;
  let routesMerged = 0;
  let mergedVariantCount = 0;

  for (const routeId of feed.indexes.tripsByRouteId.keys()) {
    routesAttempted++;
    const result = mergeRouteVariants(feed, routeId, warningCollector);
    if (result.mergedVariantCount > 0) routesMerged++;
    mergedVariantCount += result.mergedVariantCount;
    for (const shapeId of result.removedShapeIds) removedShapeIds.add(shapeId);
  }

  return {
    routesAttempted,
    routesMerged,
    mergedVariantCount,
    removedShapeIds: [...removedShapeIds],
  };
}

export function getRouteVariants(feed: GtfsFeed, routeId: string): {
  variants: RouteVariant[];
  tripsCount: number;
  tripsWithoutVariant: number;
} {
  const cached = feed.indexes.routeVariantsByRouteId.get(routeId);
  if (cached) {
    const tripsCount = feed.indexes.tripsByRouteId.get(routeId)?.length ?? 0;
    return { variants: cached, tripsCount, tripsWithoutVariant: 0 };
  }
  const routeTrips = feed.indexes.tripsByRouteId.get(routeId) ?? [];
  const variantKeyPart = (value: string | null): string =>
    value === null ? "n" : `v${value.length}:${value}`;
  const variantKey = (
    shapeId: string | null,
    headsign: string | null,
    shortName: string | null,
    directionId: number | null,
    stops: readonly (string | null)[],
  ): string => [
    variantKeyPart(shapeId),
    variantKeyPart(headsign),
    variantKeyPart(shortName),
    directionId === null ? "n" : `d${directionId}`,
    ...stops.map((stop) => variantKeyPart(stop)),
  ].join("|");

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
    const key = variantKey(fields.shape_id, fields.trip_headsign,
      fields.trip_short_name, fields.direction_id, stops);
    let variant = variantsByKey.get(key);
    if (!variant) {
      const shapeId = fields.shape_id || null;
      variant = {
        routeId,
        shapeId, shapeIds: shapeId ? [shapeId] : [],
        mergedWithDifferentShapes: false,
        differentShapePairs: [],
        tripHeadsign: fields.trip_headsign,
        tripShortName: fields.trip_short_name, directionIds: [], stops, trips: [],
      };
      variantsByKey.set(key, variant);
    }
    if (!variant.directionIds.includes(fields.direction_id)) variant.directionIds.push(fields.direction_id);
    variant.trips.push(trip);
  }
  const variants = [...variantsByKey.values()];
  feed.indexes.routeVariantsByRouteId.set(routeId, variants);
  return { variants, tripsCount: routeTrips.length, tripsWithoutVariant };
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

export function reinitializeFeedIndexes(feed: GtfsFeed): void {
  const getRows = <Name extends GtfsTableName>(kind: Name): GtfsRow<Name>[] =>
    (feed.tables.find((table) => table.kind === kind)?.rows as GtfsRow<Name>[] | undefined) ?? [];
  const routeVariantsByRouteId = new Map<string, RouteVariant[]>();

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
  const shapePointsById = new Map<string, [number | null, number | null, number | null][]>();
  for (const [shapeId, rows] of shapesById) {
    const ordered = [...rows].sort((a, b) => {
      const aSequence = a.fields.shape_pt_sequence;
      const bSequence = b.fields.shape_pt_sequence;
      if (aSequence === null) return bSequence === null ? 0 : 1;
      if (bSequence === null) return -1;
      return aSequence - bSequence;
    });
    shapePointsById.set(shapeId, ordered.map((row) => [
      row.fields.shape_pt_lat,
      row.fields.shape_pt_lon,
      row.fields.shape_dist_traveled,
    ]));
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
    shapePointsById,
    routeVariantsByRouteId,
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
  let files: Record<string, Uint8Array>;
  try {
    onProgress?.({ phase: "extracting", completed: 0, total: 1 });
    files = unzipSync(data);
  } catch {
    throw new Error("Could not read the ZIP file. Make sure it is a valid, unencrypted ZIP archive.");
  }
  onProgress?.({ phase: "extracting", completed: 1, total: 1 });
  return loadGtfsFiles(files, onProgressOrWarnings, warningCollector);
}

export function loadGtfsFiles(
  files: Record<string, Uint8Array>,
  onProgressOrWarnings?: ((progress: GtfsLoadProgress) => void) | WarningCollector,
  warningCollector?: WarningCollector,
): GtfsFeed {
  const onProgress = typeof onProgressOrWarnings === "function" ? onProgressOrWarnings : undefined;
  const collector = typeof onProgressOrWarnings !== "function" ? onProgressOrWarnings ?? warningCollector : warningCollector;
  collector?.clear();

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
      throw new Error(`Multiple files named ${name} were selected.`);
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
    throw new Error("The selected files do not contain any GTFS .txt files.");
  }

  tables.sort((a, b) => a.name.localeCompare(b.name));
  unrecognizedFiles.sort();
  const feed = {
    tables,
    unrecognizedFiles,
    warnings: collector ? [...collector.all] : undefined,
  } as GtfsFeed;
  onProgress?.({ phase: "indexing", completed: 0, total: 1 });
  reinitializeFeedIndexes(feed);
  onProgress?.({ phase: "indexing", completed: 1, total: 1 });
  return feed;
}
