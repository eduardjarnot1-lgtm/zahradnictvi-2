// How quickly Mr. Vrána answers, and what he answers first.
//
// Section 3 of the polish brief asks for two things that pull against each
// other: he should react at once, and he should never magically know. So these
// measure the delay end to end — the number a player actually feels — and then
// pin the order he resolves competing claims in, which is what stops "fast"
// turning into "clairvoyant".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/levels.js';
import { TUNING } from '../src/tuning.js';
import { createSim, stepSim, playerOf } from '../src/sim.js';
import { footStep, legCycle } from '../src/gait.js';
import { gaitOf } from '../src/rules.js';

const IDLE = { x: 0, y: 0, take: false, search: false };
const SCHOOL = LEVELS.filter((l) => l.location === 'School');
const open = (id = 23) => {
  const sim = createSim({ level: LEVELS.find((l) => l.id === id), seed: 7 });
  return { sim, p: playerOf(sim), w: sim.investigator };
};
const put = (r, x, y) => { r.p.x = x; r.p.y = y; r.p.prevX = x; r.p.prevY = y; };

// Seconds from the bang to his first purposeful step. The thief stays where he
// is; nothing is teleported after the first frame.
function timeToSetOff(id, dist, noise) {
  const r = open(id);
  put(r, r.w.x + dist, r.w.y);
  for (let i = 0; i < 60 * 20; i++) {
    if (i === 0) r.sim.noise = noise;
    stepSim(r.sim, IDLE);
    if (r.w.state === 'investigating' || r.w.state === 'following') return i / 60;
  }
  return Infinity;
}

test('a bang beside him has him on his feet inside a second and a half', () => {
  // The complaint this fixes: the meter falls while a man is getting up, and
  // the rise used to be recomputed from it every frame — so the duration grew
  // as he took it, and a loud noise at his elbow cost the player two and a
  // quarter seconds of grace it was never supposed to buy.
  for (const level of SCHOOL) {
    const near = timeToSetOff(level.id, 70, 88);
    assert.ok(near <= 1.5, `L${level.id}: ${near.toFixed(2)}s to react to a bang beside him`);
  }
  // ...and a clatter at the other end of the building is still worth a pause.
  const far = timeToSetOff(23, 70, 64);
  assert.ok(far > 1.0, `a barely-over-the-line noise got him up in ${far.toFixed(2)}s`);
  assert.ok(far < 2.2, `...and ${far.toFixed(2)}s is still too long to wait`);
});

test('how fast he gets up is fixed when he hears it, not while he stands', () => {
  // The defect in one assertion. `riseFor` is written once, at the moment the
  // noise reaches him, and nothing that happens to the meter afterwards may
  // move it — otherwise the delay feeds on itself.
  const r = open(23);
  put(r, r.w.x + 70, r.w.y);
  r.sim.noise = 90;
  stepSim(r.sim, IDLE);
  assert.equal(r.w.state, 'rising');
  const fixed = r.w.riseFor;
  assert.ok(fixed > 0, 'he has no idea how long he is taking');
  for (let i = 0; i < 20; i++) {
    r.sim.noise = Math.max(0, r.sim.noise - 3);   // the room going quiet again
    stepSim(r.sim, IDLE);
    if (r.w.state !== 'rising') break;
    assert.equal(r.w.riseFor, fixed, 'the get-up got longer while he was doing it');
  }
});

test('the drawing and the state get up on the same clock', () => {
  // He is inside his own desk while he sleeps, and the get-up slides him out to
  // the nearest tile a person can stand on. That slide and the state it belongs
  // to have to end together, or he either waits at the chair's edge or gets
  // snapped the rest of the way — and the snap is the thing the whole sequence
  // exists to avoid.
  const r = open(23);
  put(r, r.w.x + 70, r.w.y);
  r.sim.noise = 88;
  stepSim(r.sim, IDLE);
  const stand = { x: r.w.stand.x, y: r.w.stand.y };
  let last = { x: r.w.x, y: r.w.y };
  let jump = 0;
  while (r.w.state === 'rising') {
    stepSim(r.sim, IDLE);
    jump = Math.max(jump, Math.hypot(r.w.x - last.x, r.w.y - last.y));
    last = { x: r.w.x, y: r.w.y };
  }
  assert.ok(jump < 3, `he moved ${jump.toFixed(1)} units in one frame getting up`);
  assert.ok(Math.hypot(r.w.x - stand.x, r.w.y - stand.y) < 1.5,
    'he did not finish getting out of the chair before the state ended');
});

test('a second bang while he is getting up re-aims him at the second one', () => {
  // Section 3: a new, stronger event updates his target. Without this the whole
  // wake-up was deaf — everything the player did during it was aimed at wherever
  // the first sound came from.
  const r = open(23);
  put(r, r.w.x + 70, r.w.y);
  r.sim.noise = 70;
  stepSim(r.sim, IDLE);
  assert.equal(r.w.state, 'rising');
  const first = { x: r.w.target.x, y: r.w.target.y };
  // ...now something goes over on the other side of him.
  put(r, r.w.x - 120, r.w.y + 40);
  r.sim.noise += 12;
  stepSim(r.sim, IDLE);
  const moved = Math.hypot(r.w.target.x - first.x, r.w.target.y - first.y);
  assert.ok(moved > 20, `his target moved ${moved.toFixed(0)} units for a fresh bang`);
});

test('he answers a thief he can see before a noise he only heard', () => {
  // The order section 3 asks for: a visible thief, then a new strong noise,
  // then whatever he was already walking towards. The first of those is the one
  // that must never be overridden — a man looking straight at you does not
  // wander off to a bin that fell over.
  const r = open(23);
  // Reached the honest way: he gets up, and the thief is standing in front of
  // him when he does. Forcing the state by hand leaves him with no target and
  // proves nothing about the order he picks one in.
  r.sim.noise = 88;
  put(r, r.w.x + 60, r.w.y);
  const home = { x: r.w.x, y: r.w.y };
  for (let i = 0; i < 60 * 8 && r.w.state !== 'following'; i++) {
    stepSim(r.sim, IDLE);
    r.w.x = home.x; r.w.y = home.y; r.w.prevX = home.x; r.w.prevY = home.y;
    put(r, home.x + 60, home.y);
  }
  assert.equal(r.w.state, 'following', 'he never picked out a thief 60 units away');
  const onMe = { x: r.w.target.x, y: r.w.target.y };
  assert.ok(Math.hypot(onMe.x - r.p.x, onMe.y - r.p.y) < 40, 'he is not coming for me');
  // A bang somewhere else, as loud as the mechanic allows.
  r.sim.noise = 99;
  for (let i = 0; i < 30; i++) {
    stepSim(r.sim, IDLE);
    r.w.x = home.x; r.w.y = home.y; r.w.prevX = home.x; r.w.prevY = home.y;
    put(r, home.x + 60, home.y);
  }
  assert.equal(r.w.state, 'following', 'a noise pulled him off a thief he can see');
  assert.ok(Math.hypot(r.w.target.x - r.p.x, r.w.target.y - r.p.y) < 60,
    'he stopped coming for the thief in front of him');
});

test('he still does not know where you are, only where the noise was', () => {
  // The other half of section 3, and the half that is easy to lose while making
  // him quicker. Out of sight, his target is a guess whose error comes off the
  // meter — never the thief's actual position.
  const r = open(23);
  // Well outside anything he could see, and standing still.
  put(r, r.w.x + 320, r.w.y + 180);
  r.sim.noise = 72;
  stepSim(r.sim, IDLE);
  const miss = Math.hypot(r.w.target.x - r.p.x, r.w.target.y - r.p.y);
  assert.ok(miss > 12, `he walked straight to me from ${miss.toFixed(0)} units of guess`);
  assert.ok(r.w.state !== 'following', 'he is chasing someone he cannot see');
});

test('what the renderer draws his feet on is the ground he actually covered', () => {
  // Section 4, end to end rather than in the model. `gait.test.mjs` proves the
  // model does not slide at a fixed share on a straight line; this drives the
  // whole simulation round a real building and puts the foot where the renderer
  // would put it — in world coordinates, off his position and his heading.
  //
  // Measured only across frames where he is going more or less straight. A
  // planted foot on a turning man pivots, and it is supposed to; what would be
  // a fault is a foot that travels across the floor while he walks past it.
  const r = open(25);
  r.sim.noise = 92;
  put(r, r.w.x + 330, r.w.y - 40);
  const frames = [];
  for (let i = 0; i < 60 * 12; i++) {
    stepSim(r.sim, IDLE);
    if (r.sim.status !== 'running') break;
    frames.push({
      x: r.w.x, y: r.w.y, facing: r.w.facing,
      phase: r.w.walkPhase, share: r.w.gaitShare, moving: r.w.moving
    });
  }
  assert.ok(frames.length > 150, `he only walked for ${frames.length} frames`);

  const band = (share) => gaitOf(share, TUNING.locations.School.watcherGait);
  let planted = null;
  let worst = 0;
  let straight = 0;
  for (let i = 1; i < frames.length; i++) {
    const f = frames[i];
    let turn = f.facing - frames[i - 1].facing;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    const foot = footStep(legCycle(f.phase), band(f.share));
    if (!foot.planted || !f.moving || Math.abs(turn) > 0.004) { planted = null; continue; }
    // Where that foot is standing, in the room.
    const at = { x: f.x + Math.cos(f.facing) * foot.along,
      y: f.y + Math.sin(f.facing) * foot.along };
    if (planted === null) { planted = at; continue; }
    straight++;
    worst = Math.max(worst, Math.hypot(at.x - planted.x, at.y - planted.y));
    planted = at;
  }
  assert.ok(straight > 60, `only ${straight} frames of straight walking to measure`);
  // Per frame, and at sixtieths of a second. The turn tolerance above is what
  // sets the floor here: a foot planted ten units off the body's centre moves
  // that far simply by the body rotating under it, so measuring a translation
  // means allowing almost no rotation. What is left is creep, and a fiftieth of
  // a shoe is already far below a pixel on a phone.
  assert.ok(worst < 0.12,
    `his planted foot crept ${worst.toFixed(3)} units across the floor in one frame`);
});

test('nothing about his stride moves faster than his legs can explain', () => {
  // The other half of section 4. His stride is read off `gaitShare`, which is
  // his real speed plus an eased urgency — so the only thing allowed to move it
  // quickly is acceleration, and acceleration is bounded by the tuning. Anything
  // above that bound is a switch dressed up as a walk, which is exactly what
  // adding the whole urgency on the frame `moving` flipped used to be.
  const rules = TUNING.locations.School.investigate;
  const bound = (rules.accel / 60) / TUNING.player.speed * 1.25;
  const r = open(23);
  r.sim.noise = 92;
  put(r, r.w.x + 300, r.w.y);
  let jump = 0;
  let last = r.w.gaitShare;
  for (let i = 0; i < 60 * 10; i++) {
    stepSim(r.sim, IDLE);
    if (r.sim.status !== 'running') break;
    jump = Math.max(jump, Math.abs(r.w.gaitShare - last));
    last = r.w.gaitShare;
  }
  assert.ok(jump <= bound,
    `his stride jumped ${jump.toFixed(3)} in one frame; his legs allow ${bound.toFixed(3)}`);
  // ...and the urgency itself is a gathering, not a switch: half a second or so
  // from a walk to a hurry, which is also long enough for the player to read.
  assert.ok(r.w.urge !== undefined, 'the urgency is not being eased at all');
});

test('the thief keeps his stride through a doorway he clips', () => {
  // Section 5. His walking system is good and is not being replaced; this is
  // the one thing measurement found wrong with it. `speed` is ground covered,
  // so a shoulder catching a door frame zeroes it for a frame and his gait
  // restarted from a standstill — eight frames in a hundred, walking a school.
  // Nothing about the movement changed; the share the pose is read from now
  // follows that speed over about a seventh of a second instead of being it.
  const bound = (TUNING.player.accel / 60) / TUNING.player.speed;
  for (const level of SCHOOL) {
    const r = open(level.id);
    let over = 0;
    let worst = 0;
    let last = r.p.gaitShare;
    // A wandering course, so he meets corners rather than walking a clear line.
    for (let i = 0; i < 60 * 30; i++) {
      stepSim(r.sim, { x: Math.cos(i * 0.017), y: Math.sin(i * 0.029), take: false, search: false });
      const d = Math.abs(r.p.gaitShare - last);
      last = r.p.gaitShare;
      worst = Math.max(worst, d);
      if (d > bound) over++;
    }
    assert.equal(over, 0,
      `L${level.id}: ${over} frames moved his stride further than his legs allow `
      + `(worst ${worst.toFixed(3)} against ${bound.toFixed(3)})`);
  }
});
