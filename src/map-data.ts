import type { GtfsFeed, GtfsRow, RouteVariant } from "./gtfs";

export type Coordinate = [number, number];
export interface MapStop {
  id: string | null;
  name: string | null;
  coordinate: Coordinate | null;
  hoverLabel?: string;
}

export function indexStopRoutes(feed: GtfsFeed): Map<string, string[]> {
  const trips = feed.tables.find((table) => table.kind === "trips.txt");
  const times = feed.tables.find((table) => table.kind === "stop_times.txt");
  const routesByTrip = new Map<string, string>();
  for (const { fields } of trips?.rows ?? []) {
    if (fields.trip_id && fields.route_id) routesByTrip.set(fields.trip_id, fields.route_id);
  }
  const routesByStop = new Map<string, Set<string>>();
  for (const { fields } of times?.rows ?? []) {
    const route = fields.trip_id && routesByTrip.get(fields.trip_id);
    if (!fields.stop_id || !route) continue;
    const routes = routesByStop.get(fields.stop_id) ?? new Set<string>();
    routes.add(route);
    routesByStop.set(fields.stop_id, routes);
  }
  return new Map([...routesByStop].map(([stop, routes]) => [stop, [...routes]]));
}

export function coordinate(lon: string | null, lat: string | null): Coordinate | null {
  if (!lon?.trim() || !lat?.trim()) return null;
  const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
  if (!numeric.test(lon.trim()) || !numeric.test(lat.trim())) return null;
  const x = Number(lon);
  const y = Number(lat);
  return Number.isFinite(x) && Number.isFinite(y) && x >= -180 && x <= 180 && y >= -90 && y <= 90
    ? [x, y] : null;
}

export function indexShapes(feed: GtfsFeed): Map<string, GtfsRow<"shapes.txt">[]> {
  const index = new Map<string, GtfsRow<"shapes.txt">[]>();
  const table = feed.tables.find((candidate) => candidate.kind === "shapes.txt");
  for (const row of table?.rows ?? []) {
    const id = row.fields.shape_id;
    if (!id) continue;
    const rows = index.get(id) ?? [];
    rows.push(row);
    index.set(id, rows);
  }
  return index;
}

export function mapStop(row: GtfsRow<"stops.txt">): MapStop {
  return {
    id: row.fields.stop_id,
    name: row.fields.stop_name,
    coordinate: coordinate(row.fields.stop_lon, row.fields.stop_lat),
  };
}

export function indexStops(feed: GtfsFeed): Map<string, MapStop> {
  const index = new Map<string, MapStop>();
  const table = feed.tables.find((candidate) => candidate.kind === "stops.txt");
  for (const row of table?.rows ?? []) {
    const stop = mapStop(row);
    if (stop.id && !index.has(stop.id)) index.set(stop.id, stop);
  }
  return index;
}

export function variantLabel(variant: RouteVariant, index: number, stops: ReadonlyMap<string, MapStop>): string {
  const first = variant.stops[0];
  const last = variant.stops.length > 1 ? variant.stops[variant.stops.length - 1] : null;
  const endpoints = [first, last].map((id) => id ? stops.get(id)?.name?.trim() ?? "" : "").filter(Boolean).join(" → ");
  return [variant.tripHeadsign?.trim(), variant.tripShortName?.trim(), endpoints].filter(Boolean).join(" · ")
    || `Variant ${index + 1}`;
}

export function variantMapData(
  shapes: ReadonlyMap<string, GtfsRow<"shapes.txt">[]>,
  variant: RouteVariant,
  stops: ReadonlyMap<string, MapStop>,
): {
  stops: MapStop[];
  line: Coordinate[];
  approximate: boolean;
  invalidShapePoints: number;
} {
  const variantStops = variant.stops.map((id) => id && stops.get(id) || { id, name: null, coordinate: null });
  const rows = variant.shapeId ? shapes.get(variant.shapeId) ?? [] : [];
  const points = rows.flatMap((row) => {
    const sequence = row.fields.shape_pt_sequence;
    const position = coordinate(row.fields.shape_pt_lon, row.fields.shape_pt_lat);
    return sequence !== null && /^\d+$/.test(sequence) && Number.isSafeInteger(Number(sequence)) && position
      ? [{ sequence: Number(sequence), position }] : [];
  }).sort((a, b) => a.sequence - b.sequence);
  const approximate = points.length < 2;
  return {
    stops: variantStops,
    line: approximate ? variantStops.flatMap((stop) => stop.coordinate ? [stop.coordinate] : [])
      : points.map((point) => point.position),
    approximate,
    invalidShapePoints: rows.length - points.length,
  };
}
