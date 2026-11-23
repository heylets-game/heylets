// Pure hex grid maths, shared by every map in the game.
//
// Axial coordinates (q, r) on pointy-top hexes. The third cube coordinate
// s = -q - r is used internally for distance and line maths.

export type HexPos = { q: number; r: number };
/**
 * A rectangle of hexes, `cols` across and `rows` down. It starts at offset column 0 and row 0 unless `col0` and
 * `row0` say otherwise: a map that has to reach left of or above where its places were first laid out (the
 * Harbor's sea) starts there instead, so nothing already on it moves. `row0` must be even, so the rows that are
 * a hex short are still the odd ones.
 */
export type HexGrid = { cols: number; rows: number; col0?: number; row0?: number };

// Six axial directions (pointy-top hex), clockwise from top-right.
const DIRECTIONS: readonly HexPos[] = [
  { q: 1, r: -1 }, // top-right
  { q: 1, r: 0 },  // right
  { q: 0, r: 1 },  // bottom-right
  { q: -1, r: 1 }, // bottom-left
  { q: -1, r: 0 }, // left
  { q: 0, r: -1 }, // top-left
] as const;

// Brick-layout bounds: valid hexes form a vertical rectangle with even rows
// holding `grid.cols` hexes and odd rows holding `grid.cols - 1` hexes
// (shifted right by half a hex). In axial storage, this means the valid
// q range slides left by 1 every 2 rows so the visual leftmost column
// stays aligned.
//
//   row 0: q ∈ [0,             cols-1]    (cols hexes)
//   row 1: q ∈ [0,             cols-2]    (cols-1 hexes, half-offset right)
//   row 2: q ∈ [-1,            cols-2]
//   row 3: q ∈ [-1,            cols-3]
//   row 4: q ∈ [-2,            cols-3]
//   ...
//
// (The leftmost VISUAL column stays at offset col 0; axial coords drift
// because the rendering formula already shifts +sqrt(3)/2 per row.)
export function inBounds(pos: HexPos, grid: HexGrid): boolean {
  const row0 = grid.row0 ?? 0, col0 = grid.col0 ?? 0;
  if (pos.r < row0 || pos.r >= row0 + grid.rows) return false;
  const rowShift = Math.floor(pos.r / 2);
  const rowWidth = pos.r % 2 === 0 ? grid.cols : grid.cols - 1;
  const offsetCol = pos.q + rowShift;
  return offsetCol >= col0 && offsetCol < col0 + rowWidth;
}

// Every valid hex in the grid, row by row.
export function allHexesInGrid(grid: HexGrid): HexPos[] {
  const result: HexPos[] = [];
  const row0 = grid.row0 ?? 0, col0 = grid.col0 ?? 0;
  for (let r = row0; r < row0 + grid.rows; r++) {
    const rowShift = Math.floor(r / 2);
    const rowWidth = r % 2 === 0 ? grid.cols : grid.cols - 1;
    for (let oc = col0; oc < col0 + rowWidth; oc++) {
      result.push({ q: oc - rowShift, r });
    }
  }
  return result;
}

export function posKey(pos: HexPos): string {
  return `${pos.q},${pos.r}`;
}

// The six in-bounds neighbors of a hex.
export function hexNeighbors(pos: HexPos, grid: HexGrid): HexPos[] {
  const result: HexPos[] = [];
  for (const d of DIRECTIONS) {
    const n = { q: pos.q + d.q, r: pos.r + d.r };
    if (inBounds(n, grid)) result.push(n);
  }
  return result;
}

// Hex distance using cube coordinate max-abs formula.
export function hexDistance(a: HexPos, b: HexPos): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

// Round floating-point axial coordinates to the nearest integer hex.
function hexRound(fq: number, fr: number): HexPos {
  const fs = -fq - fr;
  let rq = Math.round(fq);
  let rr = Math.round(fr);
  let rs = Math.round(fs);
  const qdiff = Math.abs(rq - fq);
  const rdiff = Math.abs(rr - fr);
  const sdiff = Math.abs(rs - fs);
  if (qdiff > rdiff && qdiff > sdiff) {
    rq = -rr - rs;
  } else if (rdiff > sdiff) {
    rr = -rq - rs;
  }
  return { q: rq, r: rr };
}

// The hexes on the straight line from `from` to `to`, both ends included.
export function hexSegment(from: HexPos, to: HexPos): HexPos[] {
  const dist = hexDistance(from, to);
  return Array.from({ length: dist + 1 }, (_, i) => (dist === 0 ? { q: from.q, r: from.r } : hexRound(from.q + ((to.q - from.q) * i) / dist, from.r + ((to.r - from.r) * i) / dist)));
}
