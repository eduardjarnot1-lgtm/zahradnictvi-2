// Walking somewhere, for characters that are not being steered by a thumb.
//
// Mr. Vrána is the only one who needs this today: he has to cross a school
// that is mostly partitions and doorways, and "walk at the target and slide
// along whatever you hit" puts him in a corner within two rooms. So he gets a
// map instead — a coarse grid of where a person his size fits, a breadth-first
// distance field flooded out from wherever he is going, and a walk downhill.
//
// Everything here is a pure function of the level. No randomness, no clock, no
// document: the simulation stays replayable.
import { TUNING } from './tuning.js';

// Half a tile. Fine enough that a two-tile doorway is three cells wide and he
// aims through the middle of it, coarse enough that flooding the biggest map
// in the game is a few thousand cells rather than a few hundred thousand.
const CELL = TUNING.world.tile / 2;

const grids = new Map();

// Where a box of this size can stand. Built by painting each collider onto the
// grid rather than by testing every cell against every collider: both the
// colliders and the box are axis-aligned, so "the box centred here overlaps
// this collider" is exactly "this point is inside the collider grown by half a
// box", and growing a rectangle is something you can rasterise directly.
export function navGrid(level, boxW = TUNING.player.boxWidth, boxH = TUNING.player.boxHeight) {
  const key = `${level.id}:${boxW}x${boxH}`;
  const cached = grids.get(key);
  if (cached) return cached;

  const cols = Math.ceil(level.width / CELL);
  const rows = Math.ceil(level.height / CELL);
  const blocked = new Uint8Array(cols * rows);

  const at = (cx, cy) => cx + cy * cols;
  // Cell centres, so a cell is walkable if a person standing in the middle of
  // it fits — which is the same question the physics asks.
  const centre = (c) => c * CELL + CELL / 2;

  // Outside the walkable bounds of the world.
  const minX = boxW / 2;
  const maxX = level.width - boxW / 2;
  const minY = boxH / 2;
  const maxY = level.height - boxH / 2;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x = centre(cx);
      const y = centre(cy);
      if (x < minX || x > maxX || y < minY || y > maxY) blocked[at(cx, cy)] = 1;
    }
  }

  for (const c of level.colliders) {
    const x0 = c.x - boxW / 2;
    const x1 = c.x + c.w + boxW / 2;
    const y0 = c.y - boxH / 2;
    const y1 = c.y + c.h + boxH / 2;
    // Cells whose centre falls strictly inside the grown rectangle.
    const cx0 = Math.max(0, Math.ceil((x0 - CELL / 2) / CELL));
    const cx1 = Math.min(cols - 1, Math.floor((x1 - CELL / 2 - 1e-9) / CELL));
    const cy0 = Math.max(0, Math.ceil((y0 - CELL / 2) / CELL));
    const cy1 = Math.min(rows - 1, Math.floor((y1 - CELL / 2 - 1e-9) / CELL));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) blocked[at(cx, cy)] = 1;
    }
  }

  const grid = { cols, rows, cell: CELL, blocked };
  grids.set(key, grid);
  return grid;
}

export const cellOf = (grid, x, y) => ({
  cx: Math.max(0, Math.min(grid.cols - 1, Math.floor(x / grid.cell))),
  cy: Math.max(0, Math.min(grid.rows - 1, Math.floor(y / grid.cell)))
});

export const cellCentre = (grid, cx, cy) => ({
  x: cx * grid.cell + grid.cell / 2,
  y: cy * grid.cell + grid.cell / 2
});

// The nearest cell you could actually stand in. A goal read off a world
// position — the couch he sleeps on, the spot a crash came from — regularly
// lands inside furniture, and a flood from a blocked cell reaches nothing.
function nearestFree(grid, cx, cy) {
  const index = cx + cy * grid.cols;
  if (!grid.blocked[index]) return index;
  for (let r = 1; r <= 12; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= grid.cols || ny >= grid.rows) continue;
        const i = nx + ny * grid.cols;
        if (!grid.blocked[i]) return i;
      }
    }
  }
  return -1;
}

// Steps-to-goal for every cell that can reach the goal, and -1 for the rest.
// Four-connected, so the flood can never squeeze between two diagonally
// touching walls — the diagonals come back later, from the line-of-sight
// shortcut in `steer`, where they are checked against the real geometry.
export function flowField(grid, x, y) {
  const { cx, cy } = cellOf(grid, x, y);
  const start = nearestFree(grid, cx, cy);
  const field = new Int32Array(grid.cols * grid.rows).fill(-1);
  if (start < 0) return field;

  const queue = new Int32Array(grid.cols * grid.rows);
  let head = 0;
  let tail = 0;
  field[start] = 0;
  queue[tail++] = start;
  while (head < tail) {
    const index = queue[head++];
    const d = field[index] + 1;
    const cxi = index % grid.cols;
    const cyi = (index - cxi) / grid.cols;
    if (cxi > 0) { const i = index - 1; if (!grid.blocked[i] && field[i] < 0) { field[i] = d; queue[tail++] = i; } }
    if (cxi < grid.cols - 1) { const i = index + 1; if (!grid.blocked[i] && field[i] < 0) { field[i] = d; queue[tail++] = i; } }
    if (cyi > 0) { const i = index - grid.cols; if (!grid.blocked[i] && field[i] < 0) { field[i] = d; queue[tail++] = i; } }
    if (cyi < grid.rows - 1) { const i = index + grid.cols; if (!grid.blocked[i] && field[i] < 0) { field[i] = d; queue[tail++] = i; } }
  }
  return field;
}

// Is the straight line between two points clear of anything a person his size
// would walk into? Sampled at half a cell, which is finer than the smallest
// gap the grid can represent.
function clearLine(grid, ax, ay, bx, by) {
  const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / (grid.cell / 2));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const { cx, cy } = cellOf(grid, ax + (bx - ax) * t, ay + (by - ay) * t);
    if (grid.blocked[cx + cy * grid.cols]) return false;
  }
  return true;
}

/**
 * Which way to walk from here. Follows the field downhill for a few cells to
 * get a short piece of the route, then aims at the furthest point on it that
 * can be reached in a straight line — so he cuts the corner of a doorway
 * instead of shuffling along the grid like a chess piece.
 *
 * Returns a unit vector, or null when there is nowhere to go.
 */
export function steer(grid, field, x, y, lookahead = 6) {
  const here = cellOf(grid, x, y);
  let index = nearestFree(grid, here.cx, here.cy);
  if (index < 0 || field[index] < 0) return null;

  let target = cellCentre(grid, index % grid.cols, (index - (index % grid.cols)) / grid.cols);
  for (let step = 0; step < lookahead; step++) {
    const cxi = index % grid.cols;
    const cyi = (index - cxi) / grid.cols;
    let best = -1;
    let bestDistance = field[index];
    const consider = (i) => {
      if (i < 0 || i >= field.length || grid.blocked[i]) return;
      if (field[i] >= 0 && field[i] < bestDistance) { bestDistance = field[i]; best = i; }
    };
    if (cxi > 0) consider(index - 1);
    if (cxi < grid.cols - 1) consider(index + 1);
    if (cyi > 0) consider(index - grid.cols);
    if (cyi < grid.rows - 1) consider(index + grid.cols);
    if (best < 0) break;
    index = best;
    const candidate = cellCentre(grid, index % grid.cols, (index - (index % grid.cols)) / grid.cols);
    // Keep the furthest one he can walk to directly; stop looking past the
    // first one he cannot, or he would try to cut through the wall behind it.
    if (!clearLine(grid, x, y, candidate.x, candidate.y)) break;
    target = candidate;
  }

  const dx = target.x - x;
  const dy = target.y - y;
  const length = Math.hypot(dx, dy);
  if (length < 0.001) return null;
  return { x: dx / length, y: dy / length };
}

// The nearest spot to a point where a person of this size can actually stand.
// Somebody asleep on a couch is inside a collider: he has to get off it before
// he can walk anywhere, and this is where he puts his feet.
export function nearestStand(grid, x, y) {
  const { cx, cy } = cellOf(grid, x, y);
  const index = nearestFree(grid, cx, cy);
  if (index < 0) return { x, y };
  const gx = index % grid.cols;
  return cellCentre(grid, gx, (index - gx) / grid.cols);
}

// Only exported so a test can prove the grid says what the physics says.
export const navCell = CELL;
