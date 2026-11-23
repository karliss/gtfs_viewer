const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { runInNewContext } = require("node:vm");
const { strToU8, zipSync } = require("fflate");

function createWorker() {
  let handler;
  const messages = [];
  runInNewContext(readFileSync("dist/gtfs-worker.txt", "utf8"), {
    Error, TextDecoder, Uint8Array,
    addEventListener(type, callback) {
      assert.equal(type, "message");
      handler = callback;
    },
    postMessage(message) { messages.push(message); },
  });
  return { handler, messages };
}

test("worker reads and parses a feed asynchronously", async () => {
  const { handler, messages } = createWorker();
  const bytes = zipSync({ "routes.txt": strToU8("route_id,route_type\nr, 3 \n") });
  let finishReading;
  const reading = new Promise((resolve) => { finishReading = resolve; });
  const processing = handler({ data: { arrayBuffer: () => reading } });
  assert.equal(messages.length, 0);
  finishReading(bytes.buffer);
  await processing;
  assert.equal(messages[0].feed.tables[0].rows[0].fields.route_type, "3");
});

test("worker reports file-reading and archive errors", async () => {
  const { handler, messages } = createWorker();
  await handler({ data: { arrayBuffer: async () => { throw new Error("Read failed"); } } });
  await handler({ data: { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } });
  assert.equal(messages[0].error, "Read failed");
  assert.match(messages[1].error, /ZIP/);
});
