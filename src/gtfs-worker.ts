import { loadGtfs, loadGtfsFiles, type GtfsFeed, type GtfsLoadProgress } from "./gtfs";
import { WarningCollector } from "./warnings";

export type WorkerResponse =
  | { progress: GtfsLoadProgress }
  | { feed: GtfsFeed }
  | { error: string };

const worker = globalThis as typeof globalThis & {
  postMessage(message: WorkerResponse): void;
};

export type WorkerRequest =
  | { type: "zip"; file: File }
  | { type: "files"; files: File[] };

worker.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  try {
    const warnings = new WarningCollector();
    let feed: GtfsFeed;
    if (event.data.type === "zip") {
      const data = await event.data.file.arrayBuffer();
      feed = loadGtfs(new Uint8Array(data), (progress) => {
        worker.postMessage({ progress });
      }, warnings);
    } else {
      const files: Record<string, Uint8Array> = {};
      let completed = 0;
      for (const file of event.data.files) {
        worker.postMessage({ progress: { phase: "extracting", completed, total: event.data.files.length } });
        files[file.name] = new Uint8Array(await file.arrayBuffer());
        completed++;
      }
      worker.postMessage({ progress: { phase: "extracting", completed, total: event.data.files.length } });
      feed = loadGtfsFiles(files, (progress) => {
        worker.postMessage({ progress });
      }, warnings);
    }
    worker.postMessage({ feed });
  } catch (error) {
    worker.postMessage({ error: error instanceof Error ? error.message : "Could not load the feed." });
  }
});
