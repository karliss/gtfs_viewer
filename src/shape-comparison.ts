import type { Coordinate } from "./map-data";

export interface ShapePoint {
  sequence: number;
  coordinate: Coordinate;
}

export interface ShapePointMatch {
  firstIndex: number;
  secondIndex: number;
}

export interface ShapePointRange {
  startIndex: number;
  endIndex: number;
}

export interface ShapeComparison {
  matches: ShapePointMatch[];
  commonRanges: Array<{ first: ShapePointRange; second: ShapePointRange }>;
  differingFirstRanges: ShapePointRange[];
  differingSecondRanges: ShapePointRange[];
}

export function rangeSegmentCoordinates(
  points: readonly ShapePoint[],
  range: ShapePointRange,
): Coordinate[][] {
  if (points.length < 2 || range.startIndex > range.endIndex) return [];
  const segments: Coordinate[][] = [];
  if (range.startIndex > 0) {
    segments.push([
      points[range.startIndex - 1].coordinate,
      points[range.startIndex].coordinate,
    ]);
  }
  for (let index = range.startIndex; index < range.endIndex; index++) {
    segments.push([
      points[index].coordinate,
      points[index + 1].coordinate,
    ]);
  }
  if (range.endIndex < points.length - 1) {
    segments.push([
      points[range.endIndex].coordinate,
      points[range.endIndex + 1].coordinate,
    ]);
  }
  return segments;
}

function pointKey(point: ShapePoint): string {
  return `${point.coordinate[0]},${point.coordinate[1]}`;
}

function unmatchedRanges(length: number, matched: ReadonlySet<number>): ShapePointRange[] {
  const ranges: ShapePointRange[] = [];
  let start: number | null = null;
  for (let index = 0; index <= length; index++) {
    if (index < length && !matched.has(index)) {
      if (start === null) start = index;
    } else if (start !== null) {
      ranges.push({ startIndex: start, endIndex: index - 1 });
      start = null;
    }
  }
  return ranges;
}

export function compareShapePoints(
  first: readonly ShapePoint[],
  second: readonly ShapePoint[],
): ShapeComparison {
  const firstIndexesByPoint = new Map<string, number[]>();
  for (const [index, point] of first.entries()) {
    const key = pointKey(point);
    const indexes = firstIndexesByPoint.get(key) ?? [];
    indexes.push(index);
    firstIndexesByPoint.set(key, indexes);
  }

  const candidates: ShapePointMatch[] = [];
  for (const [secondIndex, point] of second.entries()) {
    const firstIndexes = firstIndexesByPoint.get(pointKey(point)) ?? [];
    for (let index = firstIndexes.length - 1; index >= 0; index--) {
      candidates.push({ firstIndex: firstIndexes[index], secondIndex });
    }
  }

  const tails: number[] = [];
  const tailCandidates: number[] = [];
  const previousCandidates = new Array<number>(candidates.length).fill(-1);
  for (const [candidateIndex, candidate] of candidates.entries()) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (tails[middle] < candidate.firstIndex) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previousCandidates[candidateIndex] = tailCandidates[low - 1];
    tails[low] = candidate.firstIndex;
    tailCandidates[low] = candidateIndex;
  }

  const matches: ShapePointMatch[] = [];
  let candidateIndex = tailCandidates[tails.length - 1] ?? -1;
  while (candidateIndex >= 0) {
    matches.push(candidates[candidateIndex]);
    candidateIndex = previousCandidates[candidateIndex];
  }
  matches.reverse();

  const commonRanges: ShapeComparison["commonRanges"] = [];
  for (const match of matches) {
    const previous = commonRanges[commonRanges.length - 1];
    if (previous
      && previous.first.endIndex + 1 === match.firstIndex
      && previous.second.endIndex + 1 === match.secondIndex) {
      previous.first.endIndex = match.firstIndex;
      previous.second.endIndex = match.secondIndex;
    } else {
      commonRanges.push({
        first: { startIndex: match.firstIndex, endIndex: match.firstIndex },
        second: { startIndex: match.secondIndex, endIndex: match.secondIndex },
      });
    }
  }

  return {
    matches,
    commonRanges,
    differingFirstRanges: unmatchedRanges(first.length, new Set(matches.map((match) => match.firstIndex))),
    differingSecondRanges: unmatchedRanges(second.length, new Set(matches.map((match) => match.secondIndex))),
  };
}
