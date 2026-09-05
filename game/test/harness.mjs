// Headless harness: drives the pure simulation through scripted inputs with no
// browser at all. Every assertion in the suite goes through this.
import { TUNING } from '../src/tuning.js';
import { blocked } from '../src/physics.js';
import { createSim, stepSim, playerOf, snapshot } from '../src/sim.js';
import { LEVELS } from '../src/levels.js';
import { createRecorder, recordFrame, quantise } from '../src/replay.js';

const GRID = 4;

// Is there furniture within arm's reach? Used to make the bot approach tight
// spots slowly, the way a player who values the noise meter would.
function nearFurniture(level, player, margin = 20) {
  const { boxWidth: PW, boxHeight: PH } = TUNING.player;
  return level.colliders.some((c) =>
    c.type !== 'wall' &&
    player.x - PW / 2 - margin < c.x + c.w && player.x + PW / 2 + margin > c.x &&
    player.y - PH / 2 - margin < c.y + c.h && player.y + PH / 2 + margin > c.y);
}

// Grid path around furniture, so a script can say "go to that laptop" and mean it.
export function pathTo(level, from, to) {
  // The level's own bounds, not a global room size: these maps are not all one
  // shape any more.
  const W = level.width;
  const H = level.height;
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

  const start = [Math.round(from.x / GRID), Math.round(from.y / GRID)];
  const goal = [Math.round(to.x / GRID), Math.round(to.y / GRID)];
  const prev = new Map([[key(...start), null]]);
  const queue = [start];
  let best = start;
  let bestDistance = Infinity;

  while (queue.length) {
    const [cx, cy] = queue.shift();
    const distance = Math.hypot(cx - goal[0], cy - goal[1]);
    if (distance < bestDistance) { bestDistance = distance; best = [cx, cy]; }
    if (distance < 1.5) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      const k = key(nx, ny);
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || prev.has(k) || !free(nx, ny)) continue;
      prev.set(k, [cx, cy]);
      queue.push([nx, ny]);
    }
  }

  const path = [];
  let cursor = best;
  while (cursor) {
    path.unshift({ x: cursor[0] * GRID + GRID / 2, y: cursor[1] * GRID + GRID / 2 });
    cursor = prev.get(key(...cursor));
  }
  return path;
}

export function createRun(levelId, seed = 7) {
  const level = LEVELS.find((l) => l.id === levelId);
  if (!level) throw new Error(`no level ${levelId}`);
  const sim = createSim({ level, seed });
  return { sim, level, recording: createRecorder(levelId, seed) };
}

// Feed one input frame and record it.
export function tick(run, input = { x: 0, y: 0, take: false }) {
  const quantised = quantise(input);
  recordFrame(run.recording, quantised);
  stepSim(run.sim, quantised);
  return run.sim;
}

// Walk to a world position. Returns false if the sim ended or we gave up.
export function walkTo(run, target, maxFrames = null) {
  const player = playerOf(run.sim);
  // Follow every cell of the path: skipping cells lets a straight line between
  // two waypoints clip a furniture corner, and the bot stalls against it.
  const waypoints = pathTo(run.level, { x: player.x, y: player.y }, target);
  const perFrame = TUNING.player.speed / TUNING.sim.hz;
  const budget =
    maxFrames === null ? Math.ceil((waypoints.length * 4) / perFrame) * 3 + 240 : maxFrames;
  let frames = 0;

  for (let index = 0; index < waypoints.length; index++) {
    const waypoint = waypoints[index];
    const isLast = index === waypoints.length - 1;
    let stalled = 0;
    for (let guard = 0; guard < 120; guard++) {
      if (run.sim.status !== 'running' || frames++ > budget) return false;
      const p = playerOf(run.sim);
      const dx = waypoint.x - p.x;
      const dy = waypoint.y - p.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 3) break;
      const wasX = p.x;
      const wasY = p.y;
      // Ease off approaching the destination only — throttling at every 4px
      // path cell would make the bot crawl the whole way there.
      const arriving = isLast ? Math.max(0.35, Math.min(1, distance / 14)) : 1;
      // ...and ease off near furniture, which is what a careful player does now
      // that a full-speed collision costs several times what a brush does.
      const throttle = Math.min(arriving, nearFurniture(run.level, p) ? 0.7 : 1);
      tick(run, { x: (dx / distance) * throttle, y: (dy / distance) * throttle, take: false });
      // Wedged against geometry: give up on this cell rather than burn the budget.
      if (Math.abs(p.x - wasX) < 0.05 && Math.abs(p.y - wasY) < 0.05 && ++stalled > 6) break;
    }
  }
  return run.sim.status === 'running';
}

// Walk to an item and take it (press-and-release, so edge detection is exercised).
export function steal(run, itemId) {
  const item = run.sim.items.find((i) => i.id === itemId);
  if (!item) throw new Error(`no item ${itemId}`);
  walkTo(run, item);
  for (let guard = 0; guard < 60 && !item.taken && run.sim.status === 'running'; guard++) {
    tick(run, { x: 0, y: 0, take: true });
    tick(run, { x: 0, y: 0, take: false });
  }
  return item.taken;
}

export function escape(run) {
  const exit = run.level.exit;
  const centre = { x: exit.x + exit.w / 2, y: exit.y + exit.h / 2 };
  // Push in whichever direction the way out actually lies. It is not always
  // downward any more — the corridor floorplans put theirs in a side wall.
  const push = exit.side === 'left' ? { x: -1, y: 0 }
    : exit.side === 'right' ? { x: 1, y: 0 } : { x: 0, y: 1 };

  walkTo(run, centre);
  for (let guard = 0; guard < 240 && run.sim.status === 'running'; guard++) {
    const p = playerOf(run.sim);
    // Stay lined up with the doorway while pressing through it.
    const driftX = push.x !== 0 ? push.x : Math.max(-1, Math.min(1, (centre.x - p.x) / 8));
    const driftY = push.y !== 0 ? push.y : Math.max(-1, Math.min(1, (centre.y - p.y) / 8));
    tick(run, { x: driftX, y: driftY, take: false });
  }
  return snapshot(run.sim);
}

// Play the way an efficient player would: take the quietest items first while
// staying under a noise budget, then leave. This is the shape of run the game
// promises is always possible, so it is what the fairness test drives.
export function playEfficiently(levelId, { budget = 70, reserve = null, seed = 7 } = {}) {
  const run = createRun(levelId, seed);
  // Leave a share of the clock for the walk out. Moving carefully near
  // furniture is slower, so the tighter the level the earlier you stop.
  const keepBack = reserve === null ? Math.max(9, run.sim.timeLimit * 0.45) : reserve;
  // Best deals first: most value per point of noise.
  const order = [...run.sim.items].sort((a, b) => b.value / b.noise - a.value / a.noise);
  let planned = 0;
  for (const item of order) {
    if (run.sim.status !== 'running') break;
    if (planned + item.noise > budget) continue;
    // Leave enough clock to actually get out. Stealing until the timer dies is
    // the greed the game is supposed to punish, not efficient play.
    if (run.sim.timeLeft < keepBack) break;
    planned += item.noise;
    steal(run, item.id);
  }
  if (run.sim.status === 'running') escape(run);
  return { run, result: snapshot(run.sim) };
}

// Steal the listed items (or all of them) then run for the door.
export function play(levelId, { take = null, seed = 7 } = {}) {
  const run = createRun(levelId, seed);
  const ids = take || run.sim.items.map((i) => i.id);
  for (const id of ids) {
    if (run.sim.status !== 'running') break;
    steal(run, id);
  }
  if (run.sim.status === 'running') escape(run);
  return { run, result: snapshot(run.sim) };
}
