import { type GtfsFeed, type GtfsRow } from "../src/gtfs";

declare const feed: GtfsFeed;
declare const stop: GtfsRow<"stops.txt">;

const stopId: string | null = stop.fields.stop_id;
// @ts-expect-error Route fields are not stop fields.
stop.fields.route_id;

for (const table of feed.tables) {
  if (table.kind === "routes.txt") {
    const routeType: number | null = table.rows[0].fields.route_type;
    // @ts-expect-error Stop fields are not route fields.
    table.rows[0].fields.stop_id;
    void routeType;
  }
}
void stopId;
