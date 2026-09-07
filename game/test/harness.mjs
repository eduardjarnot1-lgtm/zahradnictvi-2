// Headless harness: drives the pure simulation through scripted inputs with no
// browser at all. Every assertion in the suite goes through this.
import { TUNING } from '../src/tuning.js';
import { blocked } from '../src/physics.js';
import { proximityScale } from '../src/rules.js';
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
export function walkTo(run, target, maxFrames = null, pace = 1) {
  const player = playerOf(run.sim);
  // Follow every cell of the path: skipping cells lets a straight line between
  // two waypoints clip a furniture corner, and the bot stalls against it.
  const waypoints = pathTo(run.level, { x: player.x, y: player.y }, target);
  const perFrame = TUNING.player.speed / TUNING.sim.hz;
  const budget =
    maxFrames === null
      ? Math.ceil((waypoints.length * 4) / (perFrame * pace)) * 3 + 240 : maxFrames;
  let frames = 0;

  for (let index = 0; index < waypoints.length; index++) {
    const waypoint = waypoints[index];
    const isLast = index === waypoints.length - 1;
    let stalled = 0;
    for (let guard = 0; guard < 120; guard++) {
      if (run.sim.status !== 'running' || frames++ > budget) return false;
      // Spotted, mid-walk. A player does not carry on towards the shelf with a
      // guard closing on them, and a bot that does is not testing whether the
      // level is winnable, only whether it is winnable while ignoring the man
      // in it. `run.heed` is set by the bots that are supposed to look up.
      // `heed` is "stop what you are doing, he has seen you"; `heedBeat` is
      // only "wait for the man on his round to go past". Running for the door
      // wants the second and not the first: once he is chasing you, the answer
      // is the door, not standing about deciding.
      if (run.sim.investigator
          && ((run.heed && run.sim.investigator.state === 'following')
            || ((run.heed || run.heedBeat) && onBeat(run.sim)
              && closeTo(run.sim) < 150))) return false;
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
      const throttle = Math.min(arriving, nearFurniture(run.level, p) ? 0.7 : 1) * pace;
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

  // Three goes at the door. In a building whose person walks a round, the way
  // out is sometimes simply occupied — the hotel's porter has his desk in the
  // corridor the exit is at the end of — and the answer to that is to wait in
  // the next room until he has moved, not to walk into him. `run.heed` makes
  // `walkTo` hand control back the moment he turns round, and this is what
  // does something with it.
  const atDoor = () => {
    const p = playerOf(run.sim);
    return Math.hypot(p.x - centre.x, p.y - centre.y) < 46;
  };
  run.heedBeat = true;
  let idle = 0;
  for (let go = 0; go < 40 && run.sim.status === 'running'; go++) {
    if (run.sim.timeLeft < 10) break;
    // Nowhere to walk from here: whatever we are standing in has no route out
    // of it at path resolution. Shuffle off it and ask again.
    const before = run.sim.frame;
    // `walkTo` reports whether it ran out of budget, not whether it arrived —
    // a path that stalls against a corner walks its whole waypoint list and
    // says yes. Ask where we actually ended up.
    walkTo(run, centre, 60 * 20);
    if (atDoor()) break;
    freezeUntilPast(run);
    if (run.sim.frame === before && ++idle > 2) {
      const mid = { x: run.level.width / 2, y: run.level.height / 2 };
      const p = playerOf(run.sim);
      const dx = mid.x - p.x;
      const dy = mid.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      for (let i = 0; i < 40 && run.sim.status === 'running'; i++) {
        tick(run, { x: dx / d, y: dy / d, take: false, search: false });
      }
      idle = 0;
    }
  }
  run.heedBeat = false;
  // ...and then go, whoever is in the way. The clock is the other way to lose,
  // and standing in a side room waiting for a corridor to clear until the timer
  // runs out is not caution, it is a different loss.
  for (let go = 0; go < 4 && run.sim.status === 'running'; go++) {
    if (walkTo(run, centre, 60 * 20)) break;
  }
  for (let guard = 0; guard < 240 && run.sim.status === 'running'; guard++) {
    const p = playerOf(run.sim);
    // Stay lined up with the doorway while pressing through it.
    const driftX = push.x !== 0 ? push.x : Math.max(-1, Math.min(1, (centre.x - p.x) / 8));
    const driftY = push.y !== 0 ? push.y : Math.max(-1, Math.min(1, (centre.y - p.y) / 8));
    tick(run, { x: driftX, y: driftY, take: false });
  }
  return snapshot(run.sim);
}

// What lifting this item will actually cost, here, on this map. Where a
// location makes noise depend on how close the listener is, a player who plans
// against the printed number is planning against the wrong number — and so was
// this bot, which is how it kept waking the caretaker.
function costOf(sim, item) {
  if (!sim.rules.proximity) return item.noise;
  const listener = sim.investigator || sim.level.watcher;
  return item.noise * proximityScale(
    sim.rules, Math.hypot(item.x - listener.x, item.y - listener.y));
}

// Someone is up and looking for you. Stand absolutely still and let the meter
// fall until he loses interest — the loop the level is built around, and the
// one thing a bot that does not know about it will always get wrong.
export function waitOut(run, maxFrames = 60 * 25) {
  const w = run.sim.investigator;
  if (!w) return true;
  for (let i = 0; i < maxFrames && run.sim.status === 'running'; i++) {
    if (w.state === 'asleep') return true;
    // A round is not something you wait out standing where you are.
    if (onBeat(run.sim)) return closeTo(run.sim) > 140 || keepAway(run);
    // Waiting for a man to go back to sleep is a decision against the clock,
    // and on a floor the length of a hotel corridor the walk out is most of
    // what is left. Past halfway there is nothing to wait for.
    if (run.sim.timeLeft < run.sim.timeLimit * 0.44) return false;
    tick(run);
  }
  return run.sim.status === 'running' && w.state === 'asleep';
}

// Play the way an efficient player would: take the quietest items first while
// staying under a noise budget, then leave. This is the shape of run the game
// promises is always possible, so it is what the fairness test drives.
// Get off the spot he is walking towards, then go quiet.
//
// Freezing where you stand used to be enough, because his target was wherever
// you were when the meter crossed and you had usually moved on by the time he
// arrived. Now that he takes a fix on the noise and narrows it as you keep
// making more, standing still *at the place he is heading for* is the one thing
// that cannot work — which is the point. So: put ground between yourself and
// his guess, then stop, and let the meter come down.
export function slipAway(run, maxFrames = 60 * 8) {
  const { sim } = run;
  const w = sim.investigator;
  if (!w || w.state === 'asleep') return true;
  const p = playerOf(sim);
  for (let i = 0; i < maxFrames && sim.status === 'running'; i++) {
    const spot = w.target || w;
    const dx = p.x - spot.x;
    const dy = p.y - spot.y;
    const far = Math.hypot(dx, dy);
    const gap = Math.hypot(p.x - w.x, p.y - w.y);
    // Distance alone is not the condition while he is actually following you:
    // he has your position, not a guess at it, so standing still the moment you
    // are nominally far enough just lets him close it again. Keep going until
    // he has lost the thread.
    if (w.state !== 'following' && far > 190 && gap > 190) break;
    if (w.state === 'following' && gap > 210 && far > 210) {
      // Far enough to start holding it — but keep drifting, not standing.
      tick(run, { x: dx / (far || 1) * 0.35, y: dy / (far || 1) * 0.35, take: false, search: false });
      continue;
    }
    const d = far || 1;
    tick(run, { x: dx / d, y: dy / d, take: false, search: false });
  }
  return waitOut(run);
}

// Is the person in this building actually after us?
//
// A guard walking his round is on his feet and is not hunting anybody, so a bot
// that treats "not asleep" as "he is coming" spends a location like the hotel
// running away from a man doing his job and never leaves with anything. The
// states that mean trouble are the ones he entered because of something we did.
export function hunting(sim) {
  const w = sim.investigator;
  return !!w && w.state !== 'asleep' && w.state !== 'patrolling' && w.state !== 'watching';
}

export function playEfficiently(levelId, { budget = 70, reserve = null, seed = 7 } = {}) {
  const run = createRun(levelId, seed);
  // Never spend past the point where he gets up. In a building where the meter
  // is how alert one man is rather than a fuse, "efficient" means taking what
  // you can take without him ever standing up — spending into his waking and
  // then hoping is not efficiency, it is the greed the level is testing for.
  const wakes = run.sim.rules.investigate && run.sim.rules.investigate.wakeAt;
  if (wakes) budget = Math.min(budget, wakes - 8);
  // Leave a share of the clock for the walk out. Moving carefully near
  // furniture is slower, so the tighter the level the earlier you stop.
  // Leave more of the clock where somebody is walking a round: the way out can
  // simply be occupied, and the answer to that is to wait, which costs seconds
  // rather than distance. A reserve set for an empty corridor is what turns a
  // patrolled level into a loss on the timer.
  const keepBack = reserve === null
    ? Math.max(9, run.sim.timeLimit * (run.sim.patrol ? 0.58 : 0.45)) : reserve;
  // Best deals first — but a deal on the far side of the building is not the
  // deal it looks like. Sorting purely by value per point of noise sends the
  // player zig-zagging across a floorplan, which is not how anyone plays and
  // makes a small map look slower to work than a big one. So the next target is
  // whichever item is worth most per point of noise *and* per step of walking,
  // recomputed after each steal.
  // An item the bot cannot actually reach must not be chosen twice, or the
  // loop never ends: unlike the old fixed-list version, this one re-picks its
  // target every step.
  const gaveUp = new Set();
  run.heed = true;
  while (run.sim.status === 'running') {
    // Leave enough clock to actually get out. Stealing until the timer dies is
    // the greed the game is supposed to punish, not efficient play.
    if (run.sim.timeLeft < keepBack) break;
    // Somebody is walking his round through the room we are standing in. Step
    // out of his way first and pick the next thing up afterwards — which is
    // what a player does, and is the whole point of giving a guard a beat.
    if (onBeat(run.sim) && closeTo(run.sim) < 150) freezeUntilPast(run);
    if (hunting(run.sim)) slipAway(run);
    const player = playerOf(run.sim);
    let best = null;
    let bestScore = 0;
    for (const item of run.sim.items) {
      if (item.taken || gaveUp.has(item.id)) continue;
      // Judge against the meter, not against a plan: walking across a
      // floorplan costs real noise, so a budget counted from item values alone
      // quietly overspends by the length of the walk.
      if (run.sim.noise + costOf(run.sim, item) > budget) continue;
      const distance = Math.hypot(item.x - player.x, item.y - player.y);
      const score = item.value / (costOf(run.sim, item) * (1 + distance / 300));
      if (score > bestScore) { bestScore = score; best = item; }
    }
    if (!best) break;
    // Let it settle before it crosses the line he gets up at. Walking costs
    // meter too, so a budget that only gates what you *pick up* still creeps
    // over the top on a long floor — and the answer a player reaches for is to
    // stand still for a moment, not to press on and hope.
    if (wakes && run.sim.noise > wakes - 26) {
      for (let i = 0; i < 60 * 10 && run.sim.status === 'running'; i++) {
        if (run.sim.noise <= wakes - 38 || run.sim.timeLeft < keepBack) break;
        // ...but not while a man on his round is walking towards the spot you
        // chose to stand still on. Waiting is the answer to a full meter, not
        // to a guard; standing there is how you get walked into.
        if (onBeat(run.sim) && closeTo(run.sim) < 140) { keepAway(run); break; }
        tick(run);
      }
    }
    steal(run, best.id);
    // ...and again straight afterwards, before setting off across the floor:
    // the walk is where most of the meter goes, so arriving at the next item
    // already near the line is how a run ends up being hunted.
    if (wakes && run.sim.noise > wakes - 14 && run.sim.status === 'running') {
      for (let i = 0; i < 60 * 10 && run.sim.status === 'running'; i++) {
        if (run.sim.noise <= wakes - 30 || run.sim.timeLeft < keepBack) break;
        if (onBeat(run.sim) && closeTo(run.sim) < 140) { keepAway(run); break; }
        tick(run);
      }
    }
    if (!best.taken) gaveUp.add(best.id);
    // Woke him anyway? Then get off the spot he is heading for and go quiet,
    // exactly as a player would, rather than walking on and into him.
    // Seen. Standing in a corner does not shake a man who is looking straight
    // at you, so the answer a player reaches for is the door with whatever is
    // already in the bag — and this bot's job is to prove the level can be
    // walked out of, not to prove it can be cleared.
    if (run.sim.investigator && run.sim.investigator.state === 'following') break;
    if (hunting(run.sim)) slipAway(run);
  }
  run.heed = false;
  if (run.sim.status === 'running') escape(run);
  return { run, result: snapshot(run.sim) };
}

// Is he walking a round rather than looking for us, and how far away is he?
export function onBeat(sim) {
  const w = sim.investigator;
  return !!w && (w.state === 'patrolling' || w.state === 'watching');
}

export function closeTo(sim) {
  const w = sim.investigator;
  if (!w) return Infinity;
  const p = playerOf(sim);
  return Math.hypot(p.x - w.x, p.y - w.y);
}

// Stand absolutely still while a man on his round goes past. He picks out
// movement, not shapes, so this is the counter the game actually gives you —
// and it costs clock rather than distance, which is the trade the round exists
// to create.
export function freezeUntilPast(run, gap = 170, maxFrames = 60 * 9) {
  const { sim } = run;
  for (let i = 0; i < maxFrames && sim.status === 'running'; i++) {
    if (!onBeat(sim)) return hunting(sim) ? false : true;
    if (closeTo(sim) > gap) return true;
    // Standing still stops him picking you out; it does not stop him walking
    // into you. Once he is inside a room's width, holding your ground is no
    // longer the play — get out of the lane he is walking down.
    if (closeTo(sim) < 130) { keepAway(run, 195, 60 * 5); continue; }
    tick(run);
  }
  return sim.status === 'running';
}

// Give a man on his rounds room. He is not looking for us, so this is not an
// escape — it is stepping into the next room until he has gone past.
export function keepAway(run, gap = 180, maxFrames = 60 * 7) {
  const { sim } = run;
  const w = sim.investigator;
  if (!w) return true;
  const p = playerOf(sim);
  let stuck = 0;
  for (let i = 0; i < maxFrames && sim.status === 'running'; i++) {
    const dx = p.x - w.x;
    const dy = p.y - w.y;
    const d = Math.hypot(dx, dy);
    if (d > gap) return true;
    const wasX = p.x;
    const wasY = p.y;
    tick(run, { x: dx / (d || 1), y: dy / (d || 1), take: false, search: false });
    // Backing away in a straight line ends in a corner, and a player wedged in
    // a corner cannot be pathed out of it — the route home starts from a cell
    // with no free neighbours and comes back empty. Stop when the wall does.
    if (Math.abs(p.x - wasX) < 0.05 && Math.abs(p.y - wasY) < 0.05 && ++stuck > 8) return false;
  }
  return false;
}

// Open every cupboard on the map, wherever they can be reached. "Take
// everything" has to mean everything now that most of a school level is behind
// a door — a greedy run that only sweeps the floor is not greedy any more.
export function ransack(run) {
  if (!run.sim.rules.search) return;
  for (const stash of run.sim.stashes) {
    if (run.sim.status !== 'running' || stash.searched) continue;
    const target = { x: stash.x + stash.w / 2, y: stash.y + stash.h + 18 };
    if (!walkTo(run, target, 60 * 12)) continue;
    tick(run, { x: 0, y: 0, take: false, search: true });
    let guard = 0;
    while (run.sim.searching && run.sim.status === 'running' && guard++ < 300) tick(run);
  }
}

// Play the way the school is meant to be played: explore, open the cupboards
// that look worth the noise, back off when the meter climbs, run if he spots
// you, and leave with something. This is the shape of run the school promises
// is possible, so it is what the payoff tests drive.
export function playSearching(levelId, { seed = 7, pace = 0.6, budget = 64 } = {}) {
  const run = createRun(levelId, seed);
  const { sim } = run;
  const p = playerOf(sim);
  const keepBack = Math.max(11, sim.timeLimit * 0.34);
  const gaveUp = new Set();
  const him = () => sim.investigator || sim.level.watcher;

  // Hold still and let it settle — but keep one eye open. Standing there while
  // he walks past is how you get caught.
  const settle = (until) => {
    for (let i = 0; i < 60 * 12 && sim.status === 'running' && sim.noise > until; i++) {
      if (sim.investigator && sim.investigator.state === 'following') return false;
      if (hunting(sim) && Math.hypot(p.x - him().x, p.y - him().y) < 170) return false;
      tick(run);
    }
    return true;
  };

  // Spotted. Standing still is the one thing that does not work.
  const bolt = () => {
    for (let i = 0; i < 60 * 6 && sim.status === 'running'
         && sim.investigator.state === 'following'; i++) {
      const dx = p.x - him().x;
      const dy = p.y - him().y;
      const d = Math.hypot(dx, dy) || 1;
      tick(run, { x: dx / d, y: dy / d, take: false, search: false });
    }
  };

  // Every branch below can decline to act — settle can bail the moment he
  // stirs, bolt can end with him still on your heels. Bound the loop so a
  // stand-off cannot spin forever.
  for (let turns = 0; turns < 400 && sim.status === 'running'
       && sim.timeLeft > keepBack; turns++) {
    if (sim.investigator && sim.investigator.state === 'following') { bolt(); continue; }
    if (sim.noise > budget) {
      if (!settle(budget * 0.5)) tick(run);
      continue;
    }

    // The nearest thing worth doing: something on the floor right here, or the
    // cupboard with the best ratio of quiet to walking.
    const loose = sim.items.filter((i) => !i.taken && !gaveUp.has(i.id))
      .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
    let stash = null;
    let bestScore = 0;
    for (const s of sim.stashes) {
      if (s.searched || gaveUp.has(s.id)) continue;
      const cx = s.x + s.w / 2;
      const cy = s.y + s.h / 2;
      const quiet = Math.hypot(cx - him().x, cy - him().y);
      const walk = Math.hypot(cx - p.x, cy - p.y);
      // What it would cost from here, guessing at what is inside. A player
      // reads this off the meter and the distance; a bot that ignores it opens
      // one cupboard too many and wakes him, every time.
      const scale = proximityScale(sim.rules, quiet, !!(sim.investigator
        && sim.investigator.state !== 'asleep'));
      if (sim.noise + (sim.rules.search.noise[s.style] + 14) * scale > budget + 22) continue;
      const score = (quiet + 80) / (1 + walk / 220);
      if (score > bestScore) { bestScore = score; stash = s; }
    }
    if (!loose && !stash) break;

    if (loose && (!stash || Math.hypot(loose.x - p.x, loose.y - p.y) < 100)) {
      if (!walkTo(run, loose, 60 * 12, pace)) { gaveUp.add(loose.id); continue; }
      for (let i = 0; i < 40 && !loose.taken && sim.status === 'running'; i++) {
        tick(run, { x: 0, y: 0, take: true, search: false });
        tick(run, { x: 0, y: 0, take: false, search: false });
      }
      if (!loose.taken) gaveUp.add(loose.id);
      continue;
    }
    const at = { x: stash.x + stash.w / 2, y: stash.y + stash.h + 18 };
    if (!walkTo(run, at, 60 * 16, pace)) { gaveUp.add(stash.id); continue; }
    tick(run, { x: 0, y: 0, take: false, search: true });
    for (let i = 0; i < 300 && sim.searching && sim.status === 'running'; i++) tick(run);
    if (!stash.searched) gaveUp.add(stash.id);
  }
  if (sim.status === 'running' && sim.noise > 88) settle(70);
  if (sim.status === 'running') escape(run);
  return { run, result: snapshot(run.sim) };
}

// Steal the listed items (or all of them) then run for the door.
export function play(levelId, { take = null, seed = 7, everything = false } = {}) {
  const run = createRun(levelId, seed);
  const ids = take || run.sim.items.map((i) => i.id);
  for (const id of ids) {
    if (run.sim.status !== 'running') break;
    steal(run, id);
  }
  // "Take everything" has to mean everything now that most of a school level is
  // behind a cupboard door. Sweeping only the floor is not greed any more.
  if (everything) ransack(run);
  if (run.sim.status === 'running') escape(run);
  return { run, result: snapshot(run.sim) };
}
