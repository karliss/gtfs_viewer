import type { GtfsRow, RouteVariant } from "./gtfs";

export type Coordinate = [number, number];
export interface MapStop {
  id: string | null;
  name: string | null;
  coordinate: Coordinate | null;
  hoverLabel?: string;
}

export interface ShapeMapPoint {
  sequence: number;
  coordinate: Coordinate;
}

export function coordinate(lon: number | null, lat: number | null): Coordinate | null {
  if (lon === null || lat === null) return null;
  const x = lon;
  const y = lat;
  return Number.isFinite(x) && Number.isFinite(y) && x >= -180 && x <= 180 && y >= -90 && y <= 90
    ? [x, y] : null;
}

export function mapStop(row: GtfsRow<"stops.txt">): MapStop {
  return {
    id: row.fields.stop_id,
    name: row.fields.stop_name,
    coordinate: coordinate(row.fields.stop_lon, row.fields.stop_lat),
  };
}

export function variantLabel(variant: RouteVariant, index: number, stops: ReadonlyMap<string, MapStop>): string {
  const first = variant.stops[0];
  const last = variant.stops.length > 1 ? variant.stops[variant.stops.length - 1] : null;
  const endpoints = [first, last].map((id) => id ? stops.get(id)?.name ?? "" : "").filter(Boolean).join(" → ");
  return [variant.tripHeadsign, variant.tripShortName, endpoints].filter(Boolean).join(" · ")
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
  const { points, invalidShapePoints } = shapeMapPoints(shapes, variant.shapeId);
  const approximate = points.length < 2;
  return {
    stops: variantStops,
    line: approximate ? variantStops.flatMap((stop) => stop.coordinate ? [stop.coordinate] : [])
      : points.map((point) => point.coordinate),
    approximate,
    invalidShapePoints,
  };
}

export function shapeMapPoints(
  shapes: ReadonlyMap<string, GtfsRow<"shapes.txt">[]>,
  shapeId: string | null,
): { points: ShapeMapPoint[]; invalidShapePoints: number } {
  const rows = shapeId ? shapes.get(shapeId) ?? [] : [];
  const points = rows.flatMap((row) => {
    const sequence = row.fields.shape_pt_sequence;
    const position = coordinate(row.fields.shape_pt_lon, row.fields.shape_pt_lat);
    return sequence !== null && position ? [{ sequence, coordinate: position }] : [];
  }).sort((a, b) => a.sequence - b.sequence);
  return { points, invalidShapePoints: rows.length - points.length };
}
