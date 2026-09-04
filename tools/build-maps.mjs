/**
 * "Don't Wake Him" — map compiler.
 *
 * Each map is authored as rooms + doors + windows + props (see tools/maps-src/*.mjs).
 * This script turns that description into a concrete tile grid and writes:
 *
 *   game/maps/<id>.json   one file per map (what the game loads)
 *   game/maps/index.json  manifest
 *   game/maps-data.js     all maps inlined as window.DWH_MAPS (what the viewer loads,
 *                         so game/maps.html also works straight off the filesystem)
 *
 * Run:  node tools/build-maps.mjs
 */
import { writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ *
 * Tile alphabet
 * ------------------------------------------------------------------ */
export const TILES = {
  ' ': { key: 'void',     name: 'Outside / not part of the level', walk: false, noise: 0 },
  '#': { key: 'wall',     name: 'Wall',                            walk: false, noise: 0 },
  'W': { key: 'window',   name: 'Window in wall',                  walk: false, noise: 0 },
  'G': { key: 'glass',    name: 'Glass partition',                 walk: false, noise: 0 },
  'D': { key: 'door',     name: 'Door (closed, opens with a click)',walk: true,  noise: 3 },
  'd': { key: 'doorway',  name: 'Open doorway',                    walk: true,  noise: 0 },
  'L': { key: 'locked',   name: 'Locked door (needs a key)',       walk: false, noise: 0 },
  'V': { key: 'vent',     name: 'Vent / crawl space',              walk: true,  noise: 1 },
  'S': { key: 'stairs',   name: 'Stairs',                          walk: true,  noise: 2 },
  'E': { key: 'elevator', name: 'Elevator',                        walk: true,  noise: 4 },
  'X': { key: 'exit',     name: 'Level exit',                      walk: true,  noise: 0 },
  '.': { key: 'concrete', name: 'Concrete / linoleum floor',       walk: true,  noise: 2 },
  ',': { key: 'carpet',   name: 'Carpet',                          walk: true,  noise: 0 },
  '~': { key: 'wood',     name: 'Old parquet (creaks!)',           walk: true,  noise: 4 },
  ':': { key: 'tile',     name: 'Ceramic tile',                    walk: true,  noise: 3 },
  '=': { key: 'marble',   name: 'Polished marble',                 walk: true,  noise: 2 },
  '"': { key: 'grass',    name: 'Grass',                           walk: true,  noise: 0 },
  '%': { key: 'gravel',   name: 'Gravel (very loud)',              walk: true,  noise: 5 },
  'o': { key: 'deck',     name: 'Balcony decking',                 walk: true,  noise: 2 },
};

const DOOR_CHAR = { door: 'D', open: 'd', locked: 'L', vent: 'V', stairs: 'S', elevator: 'E', exit: 'X' };

/* ------------------------------------------------------------------ *
 * Grid construction
 * ------------------------------------------------------------------ */
function build(def) {
  const { w, h } = def;
  const g = Array.from({ length: h }, () => Array(w).fill(' '));
  const put = (x, y, c) => { if (x >= 0 && y >= 0 && x < w && y < h) g[y][x] = c; };

  // 1. carve room interiors
  for (const r of def.rooms) {
    const floor = r.floor || '.';
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) put(x, y, floor);
  }

  // 2. any void cell touching a floor cell (8-way) becomes wall
  const isFloor = (x, y) => x >= 0 && y >= 0 && x < w && y < h && g[y][x] !== ' ' && g[y][x] !== '#';
  const walls = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (g[y][x] !== ' ') continue;
      let touch = false;
      for (let dy = -1; dy <= 1 && !touch; dy++)
        for (let dx = -1; dx <= 1 && !touch; dx++)
          if ((dx || dy) && isFloor(x + dx, y + dy)) touch = true;
      if (touch) walls.push([x, y]);
    }
  }
  for (const [x, y] of walls) put(x, y, '#');

  // 3. explicit extra wall stubs (counters, half-walls inside a room)
  for (const s of def.walls || []) {
    for (let y = s.y; y < s.y + (s.h || 1); y++)
      for (let x = s.x; x < s.x + (s.w || 1); x++) put(x, y, '#');
  }

  // 4. windows and glass, then openings (openings win over everything)
  for (const s of def.windows || [])
    for (let y = s.y; y < s.y + (s.h || 1); y++)
      for (let x = s.x; x < s.x + (s.w || 1); x++) put(x, y, s.glass ? 'G' : 'W');

  for (const o of def.openings || []) {
    const c = DOOR_CHAR[o.t || 'door'] || 'D';
    for (let y = o.y; y < o.y + (o.h || 1); y++)
      for (let x = o.x; x < o.x + (o.w || 1); x++) put(x, y, c);
  }

  return g.map((row) => row.join(''));
}

/** doors/windows need to know which way they face so the viewer can draw them */
function orientOpenings(def, tiles) {
  const at = (x, y) => (tiles[y] && tiles[y][x]) || ' ';
  const solid = (x, y) => '#WG'.includes(at(x, y));
  const out = [];
  for (const o of def.openings || []) {
    // a door in a horizontal wall has wall to its left and right
    const horizontal = solid(o.x - 1, o.y) && solid(o.x + (o.w || 1), o.y);
    out.push({ ...o, t: o.t || 'door', w: o.w || 1, h: o.h || 1, axis: o.axis || (horizontal ? 'h' : 'v') });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Compile
 * ------------------------------------------------------------------ */
const srcDir = join(ROOT, 'tools', 'maps-src');
const files = readdirSync(srcDir).filter((f) => f.endsWith('.mjs')).sort();

const maps = [];
for (const f of files) {
  const { default: def } = await import(pathToFileURL(join(srcDir, f)).href);
  const tiles = build(def);
  const map = {
    id: def.id,
    name: def.name,
    subtitle: def.subtitle,
    objective: def.objective,
    difficulty: def.difficulty,
    width: def.w,
    height: def.h,
    tileSize: def.tileSize || 16,
    spawn: def.spawn,
    exit: def.exit,
    sleeper: def.sleeper,
    rooms: def.rooms.map((r) => ({ ...r, floor: r.floor || '.' })),
    openings: orientOpenings(def, tiles),
    windows: def.windows || [],
    props: def.props,
    hideSpots: def.hideSpots || [],
    patrols: def.patrols || [],
    tiles,
  };
  maps.push(map);
  writeFileSync(join(ROOT, 'game', 'maps', `${def.id}.json`), JSON.stringify(map, null, 1) + '\n');
  const cells = def.w * def.h;
  console.log(`  ${def.id.padEnd(22)} ${def.w}x${def.h}  ${String(cells).padStart(5)} tiles  ${map.props.length} props  ${map.rooms.length} rooms`);
}

writeFileSync(
  join(ROOT, 'game', 'maps', 'index.json'),
  JSON.stringify({ tiles: TILES, maps: maps.map((m) => ({ id: m.id, name: m.name, subtitle: m.subtitle, file: `${m.id}.json`, width: m.width, height: m.height })) }, null, 1) + '\n',
);

writeFileSync(
  join(ROOT, 'game', 'maps-data.js'),
  '/* GENERATED by tools/build-maps.mjs — do not edit by hand. */\n' +
  `window.DWH_TILES = ${JSON.stringify(TILES, null, 1)};\n` +
  `window.DWH_MAPS = ${JSON.stringify(maps)};\n`,
);

console.log(`\n${maps.length} maps written to game/maps/`);
