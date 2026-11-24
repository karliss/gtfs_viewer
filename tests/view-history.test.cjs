const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_VIEW_STATE, ViewHistory } = require("../dist/view-history.cjs");

function table(itemIndex = 0, table = "stops.txt") {
  return { type: "table", table, itemIndex, search: "" };
}

test("starts with the default state", () => {
  const history = new ViewHistory();

  assert.deepEqual(history.states, [DEFAULT_VIEW_STATE]);
  assert.deepEqual(history.current, DEFAULT_VIEW_STATE);
  assert.equal(history.canGoBack, false);
  assert.equal(history.canGoForward, false);
});

test("merges consecutive states with the same view type", () => {
  const history = new ViewHistory();
  history.push(table(0));
  history.push(table(125));

  assert.equal(history.states.length, 1);
  assert.deepEqual(history.current, table(125));
});

test("does not merge non-consecutive states with the same view type", () => {
  const history = new ViewHistory();
  history.push({ type: "route", routeId: "R1" });
  history.push({ type: "stop", stopId: "S1" });
  history.push({ type: "route", routeId: "R2" });

  assert.deepEqual(history.states.map((state) => state.type), ["table", "route", "stop", "route"]);
  assert.deepEqual(history.current, { type: "route", routeId: "R2" });
});

test("back and forward navigate through history", () => {
  const history = new ViewHistory();
  history.push({ type: "route", routeId: "R1" });
  history.push({ type: "stop", stopId: "S1" });

  assert.deepEqual(history.back(), { type: "route", routeId: "R1" });
  assert.equal(history.canGoForward, true);
  assert.deepEqual(history.forward(), { type: "stop", stopId: "S1" });
  assert.equal(history.canGoForward, false);
});

test("preserves warning pagination without filters in history", () => {
  const history = new ViewHistory();
  history.push({
    type: "warnings",
    itemIndex: 100,
  });

  assert.deepEqual(history.current, {
    type: "warnings",
    itemIndex: 100,
  });
});

test("push truncates forward history", () => {
  const history = new ViewHistory();
  history.push({ type: "route", routeId: "R1" });
  history.push({ type: "stop", stopId: "S1" });
  history.back();
  history.push({ type: "map", mode: "routes" });

  assert.deepEqual(history.states.map((state) => state.type), ["table", "route", "map"]);
  assert.equal(history.canGoForward, false);
});

test("limits history to 16 entries and removes the oldest", () => {
  const history = new ViewHistory();
  for (let index = 0; index < 20; index++) {
    history.push(index % 2 === 0
      ? { type: "route", routeId: `R${index}` }
      : { type: "stop", stopId: `S${index}` });
  }

  assert.equal(history.states.length, 16);
  assert.equal(history.maxEntries, 16);
  assert.equal(history.states.some((state) => state.type === "table"), false);
});

test("select restores valid entries and ignores invalid indexes", () => {
  const history = new ViewHistory();
  history.push({ type: "route", routeId: "R1" });

  assert.deepEqual(history.select(0), DEFAULT_VIEW_STATE);
  assert.equal(history.select(-1), undefined);
  assert.equal(history.select(99), undefined);
  assert.deepEqual(history.select(1), { type: "route", routeId: "R1" });
});

test("clear resets history and accepts a custom initial state", () => {
  const history = new ViewHistory();
  history.push({ type: "route", routeId: "R1" });
  history.clear({ type: "stop", stopId: "S1" });

  assert.deepEqual(history.states, [{ type: "stop", stopId: "S1" }]);
  assert.equal(history.currentIndex, 0);
  assert.equal(history.canGoBack, false);
  assert.equal(history.canGoForward, false);
});
