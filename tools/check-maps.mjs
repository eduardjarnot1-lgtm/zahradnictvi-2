/**
 * Sanity check for the compiled maps:
 *  - every room reachable on foot from the spawn point
 *  - spawn / exit / sleeper stand on walkable tiles
 *  - no prop sitting inside a wall
 * Run: node tools/check-maps.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAPS = join(ROOT, 'game', 'maps');
const { tiles: TILES } = JSON.parse(readFileSync(join(MAPS, 'index.json'), 'utf8'));

let problems = 0;
const note = (m, s) => { problems++; console.log(`  ! ${m.id}: ${s}`); };

for (const file of readdirSync(MAPS).filter((f) => f.endsWith('.json') && f !== 'index.json')) {
  const m = JSON.parse(readFileSync(join(MAPS, file), 'utf8'));
  const at = (x, y) => (m.tiles[y] && m.tiles[y][x]) || ' ';
  const walk = (x, y) => (TILES[at(x, y)] || {}).walk === true;

  // flood fill from the spawn
  const seen = new Set();
  const start = [Math.floor(m.spawn.x), Math.floor(m.spawn.y)];
  if (!walk(...start)) note(m, `spawn (${start}) is not walkable — tile '${at(...start)}'`);
  const queue = [start];
  seen.add(start.join(','));
  while (queue.length) {
    const [x, y] = queue.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${x + dx},${y + dy}`;
      if (seen.has(k) || !walk(x + dx, y + dy)) continue;
      seen.add(k); queue.push([x + dx, y + dy]);
    }
  }
  for (const r of m.rooms) {
    let reached = false;
    for (let y = r.y; y < r.y + r.h && !reached; y++)
      for (let x = r.x; x < r.x + r.w && !reached; x++) if (seen.has(`${x},${y}`)) reached = true;
    if (!reached) note(m, `room "${r.name}" cannot be reached from the spawn`);
  }
  const ex = [Math.floor(m.exit.x), Math.floor(m.exit.y)];
  if (!seen.has(ex.join(','))) note(m, `exit (${ex}) cannot be reached from the spawn`);
  const sl = [Math.floor(m.sleeper.x), Math.floor(m.sleeper.y)];
  if (!walk(...sl)) note(m, `sleeper (${sl}) stands on '${at(...sl)}'`);

  // props buried in walls (ceiling fixtures and wall-mounted things are exempt)
  const onWall = new Set(['painting', 'mirror', 'tv-wall', 'whiteboard', 'chalkboard', 'sign', 'clock',
    'sconce', 'radiator', 'curtain', 'blinds', 'extinguisher', 'board', 'camera', 'lockers', 'shelf',
    'counter', 'bookcase', 'glass-screen', 'fireplace', 'cabinet', 'wardrobe', 'dresser', 'doormat', 'screen',
    'lamp-ceiling', 'chandelier']);
  let buried = 0;
  for (const pr of m.props) {
    if (onWall.has(pr.t)) continue;
    const cx = Math.floor(pr.x + (pr.w || 1) / 2), cy = Math.floor(pr.y + (pr.h || 1) / 2);
    if ('#WGL'.includes(at(cx, cy))) buried++;
  }
  if (buried) note(m, `${buried} prop(s) centred inside a wall`);

  const cells = m.width * m.height;
  console.log(`  ${m.id.padEnd(11)} ok  ${m.rooms.length} rooms, ${m.props.length} props, ${seen.size}/${cells} walkable tiles reachable`);
}

console.log(problems ? `\n${problems} problem(s) found` : '\nAll maps pass.');
process.exit(problems ? 1 : 0);
