import { loadGtfs, type GtfsFeed } from "./gtfs";

export type WorkerResponse = { feed: GtfsFeed } | { error: string };

const worker = globalThis as typeof globalThis & {
  postMessage(message: WorkerResponse): void;
};

worker.addEventListener("message", async (event: MessageEvent<File>) => {
  try {
    const data = await event.data.arrayBuffer();
    worker.postMessage({ feed: loadGtfs(new Uint8Array(data)) });
  } catch (error) {
    worker.postMessage({ error: error instanceof Error ? error.message : "Could not load the feed." });
  }
});
