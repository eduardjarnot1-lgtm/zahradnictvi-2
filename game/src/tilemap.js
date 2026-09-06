// Hand-drawn maps, authored as a character grid.
//
// The seven floorplan levels are recreations of real reference drawings, and a
// list of pixel rectangles is the wrong way to write one down: you cannot see
// the building in it, and moving a wall means re-deriving every number beside
// it. A grid you can read as a floorplan is the right shape for the job — what
// is written here looks like the map it produces.
//
// One tile is TUNING.world.tile world units. That is the only conversion in the
// system, so a map's proportions on the grid are exactly its proportions in the
// game: a 43x40 drawing becomes a 43x40 map, never 43x38.
import { TUNING } from './tuning.js';

const TILE = TUNING.world.tile;

// What each character means. Furniture names its own style rather than letting
// the renderer guess from the shape, because these maps place specific things
// in specific rooms and a hash is not an opinion about a floorplan.
const FURNITURE = {
  T: 'table', S: 'sofa', W: 'wardrobe', N: 'nightstand',
  V: 'tvBench', C: 'chest', B: 'bookshelf', P: 'plinth'
};

const FLOOR = new Set([' ', '.', 'D', ',', '~', '@', 'X']);

// Maximal-rectangle merge over cells sharing a character. Fewer, larger
// colliders than one box per tile: the physics loop is linear in collider
// count and a floorplan is mostly long straight walls.
function mergeRects(grid, rows, cols, wanted) {
  const used = Array.from({ length: rows }, () => new Array(cols).fill(false));
  const rects = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (used[y][x] || grid[y][x] !== wanted) continue;
      // Widest run on this row...
      let w = 0;
      while (x + w < cols && !used[y][x + w] && grid[y][x + w] === wanted) w++;
      // ...then as far down as the whole run keeps matching.
      let h = 1;
      grow: while (y + h < rows) {
        for (let i = 0; i < w; i++) {
          if (used[y + h][x + i] || grid[y + h][x + i] !== wanted) break grow;
        }
        h++;
      }
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) used[y + dy][x + dx] = true;
      rects.push({ x: x * TILE, y: y * TILE, w: w * TILE, h: h * TILE });
    }
  }
  return rects;
}

// Every cell of a given character, as its own tile rect — for things that must
// stay separate (items, the spawn) rather than merge.
function cellsOf(grid, rows, cols, test) {
  const out = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (test(grid[y][x])) out.push({ ch: grid[y][x], tx: x, ty: y, x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 });
    }
  }
  return out;
}

/**
 * Build a level from a character grid.
 *
 * Characters:
 *   `#` outer wall      `%` interior partition   `O` window (in a wall)
 *   `.` or space floor  `D` doorway (floor, framed as a threshold)
 *   `,` rug (soft floor, silent underfoot)        `~` creaky boards
 *   `E` the watcher's own furniture — bed, desk, couch, armchair
 *   `T S W N V C B P` table sofa wardrobe nightstand tvBench chest bookshelf plinth
 *   `@` spawn           `X` the way out (cut into an outer wall)
 *   anything in `legend` is an item of that type
 */
export function tileLevel(spec) {
  const rows = spec.tiles.length;
  const cols = spec.tiles[0].length;
  for (let y = 0; y < rows; y++) {
    if (spec.tiles[y].length !== cols) {
      throw new Error(`level ${spec.id}: row ${y} is ${spec.tiles[y].length} tiles, expected ${cols}`);
    }
  }
  const grid = spec.tiles.map((row) => [...row]);
  const legend = spec.legend || {};

  const width = cols * TILE;
  const height = rows * TILE;

  // --- the building ---------------------------------------------------------
  const colliders = [];
  for (const r of mergeRects(grid, rows, cols, '#')) colliders.push({ type: 'wall', ...r });
  for (const r of mergeRects(grid, rows, cols, '%')) colliders.push({ type: 'partition', ...r });
  // A window is a hole in a wall you cannot walk through: solid, but drawn as
  // glass with light coming through it.
  const windows = mergeRects(grid, rows, cols, 'O');
  for (const r of windows) colliders.push({ type: 'wall', window: true, ...r });

  // --- the watcher's furniture ---------------------------------------------
  const watcherRects = mergeRects(grid, rows, cols, 'E');
  if (!watcherRects.length) throw new Error(`level ${spec.id}: no watcher furniture ('E') on the map`);
  // The largest, so a desk drawn beside its chair still resolves to the desk.
  const bedRect = watcherRects.reduce((a, b) => (a.w * a.h >= b.w * b.h ? a : b));
  const bed = { type: 'bed', ...bedRect };
  colliders.push(bed);
  for (const r of watcherRects) if (r !== bedRect) colliders.push({ type: 'furniture', style: 'chest', theme: spec.theme, ...r });

  // --- everything standing in the rooms -------------------------------------
  for (const [ch, style] of Object.entries(FURNITURE)) {
    for (const r of mergeRects(grid, rows, cols, ch)) {
      colliders.push({ type: 'furniture', style, theme: spec.theme, ...r });
    }
  }

  // --- furniture you can look inside ---------------------------------------
  // A searchable cabinet is an ordinary cabinet that happens to know what is in
  // it. It blocks the same route and costs the same to walk into; the only
  // difference is that the map wrote down whether opening it is worth the
  // noise. `null` means it is empty, which is the point of the mechanic — a
  // level where every drawer pays out is a chore, not a decision.
  const search = spec.search || {};
  const stashes = [];
  for (const [ch, entry] of Object.entries(search)) {
    // One character can merge into more than one rectangle — an L-shaped bank
    // of lockers, say. Each piece is searchable, but only the largest holds
    // what the map said was in there; the others are empty. Otherwise a single
    // awkwardly-shaped cupboard would quietly pay out twice.
    const parts = mergeRects(grid, rows, cols, ch);
    const holder = parts.length
      ? parts.reduce((a, b) => (a.w * a.h >= b.w * b.h ? a : b)) : null;
    for (const r of parts) {
      // What is inside is written in the same one-letter vocabulary as the
      // loot on the floor, and resolved through the same legend — a `w` in a
      // drawer is the same wallet as a `w` on a desk.
      const inside = entry.item && r === holder ? (legend[entry.item] || entry.item) : null;
      const stash = {
        id: `L${spec.id}-s${stashes.length}`,
        style: entry.style,
        item: typeof inside === 'string' ? inside : inside && inside.type,
        ...r
      };
      stashes.push(stash);
      colliders.push({
        type: 'furniture', style: entry.style, theme: spec.theme,
        searchable: stash.id, ...r
      });
    }
  }

  // --- floor markings -------------------------------------------------------
  const rugs = mergeRects(grid, rows, cols, ',');
  const creaks = mergeRects(grid, rows, cols, '~')
    .map((r, i) => ({ id: `L${spec.id}-c${i}`, ...r }));
  const doors = mergeRects(grid, rows, cols, 'D');

  // --- spawn ----------------------------------------------------------------
  const spawnCells = cellsOf(grid, rows, cols, (ch) => ch === '@');
  if (spawnCells.length !== 1) {
    throw new Error(`level ${spec.id}: expected exactly one spawn ('@'), found ${spawnCells.length}`);
  }
  const spawn = { x: spawnCells[0].x, y: spawnCells[0].y };

  // --- the way out ----------------------------------------------------------
  const exitRects = mergeRects(grid, rows, cols, 'X');
  if (exitRects.length !== 1) {
    throw new Error(`level ${spec.id}: expected exactly one exit ('X'), found ${exitRects.length}`);
  }
  const e = exitRects[0];
  // Which wall it is cut into, read off the map rather than declared twice.
  const side = e.x <= TILE ? 'left' : e.x + e.w >= width - TILE ? 'right' : 'bottom';
  const exit = side === 'bottom'
    ? { side, x: e.x, y: e.y, w: e.w, h: e.h + TILE }
    : { side, x: side === 'left' ? 0 : width - e.w, y: e.y, w: e.w, h: e.h };

  // --- loot -----------------------------------------------------------------
  const items = cellsOf(grid, rows, cols, (ch) => legend[ch] !== undefined)
    .map((cell, i) => {
      const entry = legend[cell.ch];
      const type = typeof entry === 'string' ? entry : entry.type;
      return {
        id: `L${spec.id}-${i}`,
        type,
        x: cell.x,
        y: cell.y,
        bonus: typeof entry === 'object' && !!entry.bonus
      };
    });

  // --- anything left over is a typo, and a typo is a broken level ------------
  const known = new Set([...FLOOR, '#', '%', 'O', 'E',
    ...Object.keys(FURNITURE), ...Object.keys(legend), ...Object.keys(search)]);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!known.has(grid[y][x])) {
        throw new Error(`level ${spec.id}: unknown tile '${grid[y][x]}' at ${x},${y}`);
      }
    }
  }

  const kind = spec.watcher || 'sleeper';
  return {
    id: spec.id,
    layout: `tile:${spec.id}`,
    tiles: { cols, rows },
    width,
    height,
    theme: spec.theme || 'bedroom',
    name: spec.name || 'Bedroom',
    // Which chapter this is, and where in it: the level-select groups by
    // location, and the difficulty tests read the tier rather than guessing
    // from the id.
    location: spec.location || spec.name || 'Bedroom',
    tier: spec.tier || 1,
    extraTime: spec.extraTime || 0,
    // An explicit clock. With eleven locations the old campaign-wide shrink is
    // no longer the design: pressure now rises inside a location, and a bigger
    // map is allowed more seconds while still being tighter to play.
    clock: spec.clock || 0,
    doors,
    stashes,
    windows,
    creaks,
    rugs,
    spawn,
    exit,
    bed,
    sleeper: { x: bed.x + bed.w / 2, y: bed.y + bed.h * 0.26 },
    // Where the person actually is. Seated watchers sit at the middle of their
    // desk; sleeping ones have their head at the pillow end.
    watcher: {
      kind,
      x: bed.x + bed.w / 2,
      y: bed.y + bed.h * (spec.seated ? 0.5 : 0.26),
      // How far this particular guard is watching. The kind sets the ceiling;
      // a level may dial it back, which is how the first level of a location
      // is survivable and the fifth is not — the same man, paying more
      // attention. Zero means "use the kind's own range".
      sees: spec.sight || 0
    },
    colliders,
    items
  };
}

// Handy for asserting a map came out the size it was drawn at.
export const tileSize = TILE;
