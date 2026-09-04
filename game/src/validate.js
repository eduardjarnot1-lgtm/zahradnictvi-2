// Boot-time / CI level validator. A hand-typed coordinate that makes a level
// unfinishable now fails loudly instead of shipping.
import { TUNING } from './tuning.js';
import { blocked } from './physics.js';
import { levelTotals, itemStats } from './rules.js';

const GRID = 4; // flood-fill resolution in world units

// Every position the player box can legally stand in, reachable from spawn.
function reachableCells(level) {
  const { width: W, height: H } = TUNING.world;
  const { boxWidth: PW, boxHeight: PH } = TUNING.player;
  const cols = Math.ceil(W / GRID);
  const rows = Math.ceil(H / GRID);
  const key = (cx, cy) => cy * cols + cx;

  const free = (cx, cy) => {
    const x = cx * GRID + GRID / 2;
    const y = cy * GRID + GRID / 2;
    if (x < PW / 2 || x > W - PW / 2 || y < PH / 2 || y > H - PH / 2 + 10) return false;
    return !blocked(x, y, PW, PH, level.colliders);
  };

  const start = [Math.round(level.spawn.x / GRID), Math.round(level.spawn.y / GRID)];
  const seen = new Set();
  if (!free(start[0], start[1])) return seen;

  seen.add(key(start[0], start[1]));
  const queue = [start];
  while (queue.length) {
    const [cx, cy] = queue.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const k = key(nx, ny);
      if (seen.has(k) || !free(nx, ny)) continue;
      seen.add(k);
      queue.push([nx, ny]);
    }
  }
  return seen;
}

function cellsToPoints(cells, cols) {
  return [...cells].map((k) => ({
    x: (k % cols) * GRID + GRID / 2,
    y: Math.floor(k / cols) * GRID + GRID / 2
  }));
}

export function validateLevel(level) {
  const errors = [];
  const warnings = [];
  const { width: W, height: H } = TUNING.world;
  const { boxWidth: PW, boxHeight: PH } = TUNING.player;
  const cols = Math.ceil(W / GRID);

  if (!level.items.length) errors.push('level has no items');

  // Spawn must be legal.
  if (blocked(level.spawn.x, level.spawn.y, PW, PH, level.colliders)) {
    errors.push(`spawn (${level.spawn.x},${level.spawn.y}) is inside a collider`);
  }

  const reachable = reachableCells(level);
  const points = cellsToPoints(reachable, cols);
  if (!reachable.size) errors.push('spawn is walled in — nothing is reachable');

  // Every item must sit in open space and be standable-next-to.
  for (const item of level.items) {
    let stats;
    try {
      stats = itemStats(item.type);
    } catch (e) {
      errors.push(`${item.id}: ${e.message}`);
      continue;
    }
    if (stats.noise <= 0 || stats.value <= 0) {
      errors.push(`${item.id}: type "${item.type}" has a non-positive value or noise`);
    }
    const inside = level.colliders.some(
      (c) => item.x > c.x - 8 && item.x < c.x + c.w + 8 &&
             item.y > c.y - 8 && item.y < c.y + c.h + 8
    );
    if (inside) errors.push(`${item.id} (${item.x},${item.y}) is inside or touching a collider`);

    const canReach = points.some(
      (p) => Math.hypot(p.x - item.x, p.y - item.y) <= TUNING.pickup.radius
    );
    if (!canReach) errors.push(`${item.id} (${item.x},${item.y}) is unreachable from spawn`);
  }

  // An item on the spawn is free money for no travel, and an item on the exit
  // hides the way out and is taken on the way past. Neither is a decision.
  for (const item of level.items) {
    if (Math.hypot(item.x - level.spawn.x, item.y - level.spawn.y) < TUNING.pickup.radius * 1.6) {
      errors.push(`${item.id} sits on the spawn — it costs nothing to take`);
    }
    const exit = level.exit;
    if (item.x > exit.x - 16 && item.x < exit.x + exit.w + 16 && item.y > exit.y - 26) {
      errors.push(`${item.id} sits on the exit`);
    }
  }

  // Items must not stack on top of each other.
  for (let i = 0; i < level.items.length; i++) {
    for (let j = i + 1; j < level.items.length; j++) {
      const a = level.items[i];
      const b = level.items[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) < TUNING.pickup.radius * 1.15) {
        warnings.push(`${a.id} and ${b.id} are close enough to be taken as a pair`);
      }
    }
  }

  // Furniture must not overlap furniture (a silent way to lose a walkable gap).
  const solids = level.colliders.filter((c) => c.type === 'furniture' || c.type === 'bed');
  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) {
      const a = solids[i];
      const b = solids[j];
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) {
        errors.push(`${a.type} at (${a.x},${a.y}) overlaps ${b.type} at (${b.x},${b.y})`);
      }
    }
  }

  // Every declared doorway must be wide enough to walk through, and must
  // actually be open. A sealed room is the failure mode complex layouts invite.
  for (const [index, door] of (level.doors || []).entries()) {
    const span = Math.min(door.w, door.h) === door.h ? door.w : door.h;
    const need = (door.w > door.h ? PW : PH) + 12;
    if (span < need) {
      errors.push(`doorway ${index} is ${span}px, too narrow to walk through (need ${need})`);
    }
    const middle = { x: door.x + door.w / 2, y: door.y + door.h / 2 };
    const openCell = points.some((p) => Math.hypot(p.x - middle.x, p.y - middle.y) < GRID * 3);
    if (!openCell) errors.push(`doorway ${index} at (${door.x},${door.y}) is blocked`);
  }

  // The exit has to be walkable-into.
  const exitReachable = points.some(
    (p) => p.x + PW / 2 > level.exit.x &&
           p.x - PW / 2 < level.exit.x + level.exit.w &&
           p.y + PH / 2 > level.exit.y
  );
  if (!exitReachable) errors.push('exit is unreachable from spawn');
  if (level.exit.y + level.exit.h < H - TUNING.world.wallThickness) {
    warnings.push('exit does not reach the room edge');
  }

  const totals = levelTotals(level);
  if (totals.noise <= 0) errors.push('level totals no noise at all');

  return {
    id: level.id,
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      items: level.items.length,
      totalNoise: totals.noise,
      totalValue: totals.value,
      forcesChoice: totals.noise > TUNING.noise.max,
      reachableArea: reachable.size
    }
  };
}

export function validateAll(levels) {
  const results = levels.map(validateLevel);
  return {
    ok: results.every((r) => r.ok),
    results,
    errorCount: results.reduce((n, r) => n + r.errors.length, 0)
  };
}
