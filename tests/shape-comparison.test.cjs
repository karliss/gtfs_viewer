const test = require("node:test");
const assert = require("node:assert/strict");
const { compareShapePoints } = require("../dist/shape-comparison.cjs");

function points(...coordinates) {
  return coordinates.map(([lon, lat], index) => ({
    sequence: index + 1,
    coordinate: [lon, lat],
  }));
}

test("finds common contiguous and differing ranges from the longest increasing subsequence", () => {
  const comparison = compareShapePoints(
    points([0, 0], [1, 1], [2, 2], [3, 3]),
    points([0, 0], [9, 9], [1, 1], [2, 2], [8, 8], [3, 3]),
  );
  assert.deepEqual(comparison.matches, [
    { firstIndex: 0, secondIndex: 0 },
    { firstIndex: 1, secondIndex: 2 },
    { firstIndex: 2, secondIndex: 3 },
    { firstIndex: 3, secondIndex: 5 },
  ]);
  assert.deepEqual(comparison.commonRanges, [
    { first: { startIndex: 0, endIndex: 0 }, second: { startIndex: 0, endIndex: 0 } },
    { first: { startIndex: 1, endIndex: 2 }, second: { startIndex: 2, endIndex: 3 } },
    { first: { startIndex: 3, endIndex: 3 }, second: { startIndex: 5, endIndex: 5 } },
  ]);
  assert.deepEqual(comparison.differingFirstRanges, []);
  assert.deepEqual(comparison.differingSecondRanges, [
    { startIndex: 1, endIndex: 1 },
    { startIndex: 4, endIndex: 4 },
  ]);
});

test("handles repeated points without matching a second-sequence point more than once", () => {
  const comparison = compareShapePoints(
    points([0, 0], [0, 0], [1, 1]),
    points([0, 0], [0, 0], [0, 0], [1, 1]),
  );
  assert.equal(comparison.matches.length, 3);
  assert.equal(new Set(comparison.matches.map((match) => match.secondIndex)).size, 3);
  assert.deepEqual(comparison.matches.map((match) => match.secondIndex), [...comparison.matches.map((match) => match.secondIndex)].sort((a, b) => a - b));
  assert.equal(comparison.differingSecondRanges.reduce((count, range) => count + range.endIndex - range.startIndex + 1, 0), 1);
});

test("returns every point as differing when there are no common coordinates", () => {
  const comparison = compareShapePoints(points([0, 0], [1, 1]), points([2, 2]));
  assert.deepEqual(comparison.commonRanges, []);
  assert.deepEqual(comparison.differingFirstRanges, [{ startIndex: 0, endIndex: 1 }]);
  assert.deepEqual(comparison.differingSecondRanges, [{ startIndex: 0, endIndex: 0 }]);
});
