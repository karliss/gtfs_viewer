import { loadGtfs, type GtfsFeed, type GtfsLoadProgress } from "./gtfs";
import { WarningCollector } from "./warnings";

export type WorkerResponse =
  | { progress: GtfsLoadProgress }
  | { feed: GtfsFeed }
  | { error: string };

const worker = globalThis as typeof globalThis & {
  postMessage(message: WorkerResponse): void;
};

worker.addEventListener("message", async (event: MessageEvent<File>) => {
  try {
    const data = await event.data.arrayBuffer();
    const warnings = new WarningCollector();
    worker.postMessage({ feed: loadGtfs(new Uint8Array(data), (progress) => {
      worker.postMessage({ progress });
    }, warnings) });
  } catch (error) {
    worker.postMessage({ error: error instanceof Error ? error.message : "Could not load the feed." });
  }
});
