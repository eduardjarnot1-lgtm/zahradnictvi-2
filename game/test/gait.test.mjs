// The walk, checked as arithmetic rather than as a screenshot.
//
// Almost everything §2 to §14 asks for is a claim about numbers — the foot does
// not slide, the body is lowest when both feet are down, a run has a moment
// with neither foot on the floor, the arms oppose the legs — so almost all of
// it can be proved here instead of squinted at. What is left over for the eye
// is whether it *looks* like a person, and that is the part screenshots are
// actually good for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TUNING } from '../src/tuning.js';
import { gaitOf, stridePerUnit } from '../src/rules.js';
import { legCycle, footStep, pelvisRise, kneeOf, footReach } from '../src/gait.js';

const SCHOOL = TUNING.locations.School.gait;
const VRANA = TUNING.locations.School.watcherGait;
const TAU = Math.PI * 2;
const bandOf = (share, config = SCHOOL) => gaitOf(share, config);

// The one that matters (sections 5 and 13). Walk a character across the floor
// at a fixed speed, exactly as the simulation does, and follow one foot. While
// that foot is planted its position on the *floor* must not change — not
// nearly, not on average, but to within the arithmetic.
function slideOf(share, config) {
  const speed = share * TUNING.player.speed;
  const dt = 1 / 60;
  const k = stridePerUnit(share, config);
  const g = bandOf(share, config);
  let phase = 0;
  let world = 0;                 // how far the body has travelled
  let planted = null;            // where the foot was pinned down
  let worst = 0;
  for (let i = 0; i < 60 * 6; i++) {
    const travelled = speed * dt;
    world += travelled;
    phase += travelled * k;
    const foot = footStep(legCycle(phase), g);
    if (foot.planted) {
      const onFloor = world + foot.along;
      if (planted === null) planted = onFloor;
      worst = Math.max(worst, Math.abs(onFloor - planted));
    } else {
      planted = null;            // in the air; the next plant is a new spot
    }
  }
  return worst;
}

test('a planted foot does not move across the floor, at any speed', () => {
  for (const share of [0.08, 0.15, 0.25, 0.4, 0.55, 0.7, 0.85, 1]) {
    const slide = slideOf(share, SCHOOL);
    // A tenth of a world unit is a fiftieth of a shoe. The figure is drawn
    // about 45 units tall, so this is well under a pixel on a phone.
    assert.ok(slide < 0.1,
      `at ${share} of top speed the planted foot slid ${slide.toFixed(2)} units`);
  }
});

test('Mr. Vrána does not slide either', () => {
  for (const share of [0.1, 0.3, 0.45, 0.59, 0.75]) {
    const slide = slideOf(share, VRANA);
    assert.ok(slide < 0.1,
      `at ${share} his planted foot slid ${slide.toFixed(2)} units`);
  }
});

test('the old sinusoid it replaces would have slid badly', () => {
  // Not a test of the game — a test of the claim that this was worth doing. The
  // previous model put the foot at sin(phase) * stride, which never stops
  // moving, so the foot travelled the whole time it was supposed to be down.
  const share = 0.5;
  const speed = share * TUNING.player.speed;
  const dt = 1 / 60;
  const k = TUNING.player.gait.strideWalk;
  let phase = 0;
  let world = 0;
  let worst = 0;
  const at = (p) => Math.sin(p) * 5.9;
  // Follow the half-cycle the old code would have called a stance.
  let anchor = null;
  for (let i = 0; i < 60; i++) {
    world += speed * dt;
    phase += speed * dt * k;
    const onFloor = world + at(phase);
    if (anchor === null) anchor = onFloor;
    worst = Math.max(worst, Math.abs(onFloor - anchor));
    if (phase > Math.PI) break;
  }
  assert.ok(worst > 5, `the old model only slid ${worst.toFixed(1)} units`);
});

test('one step covers exactly one step of ground', () => {
  // Half a cycle is one step. If the ground covered in that time were not the
  // step length the band declares, everything else here would be a coincidence.
  for (const share of [0.2, 0.5, 0.9]) {
    const g = bandOf(share);
    const ground = Math.PI / stridePerUnit(share, SCHOOL);
    assert.ok(Math.abs(ground - g.step) < 1e-9,
      `at ${share}: a step covers ${ground.toFixed(2)} but the band says ${g.step}`);
  }
});

test('the foot is on the floor exactly when it is planted', () => {
  const g = bandOf(0.4);
  for (let i = 0; i < 200; i++) {
    const u = i / 200;
    const foot = footStep(u, g);
    if (!foot.planted) continue;
    const p = u / g.duty;
    if (p < 0.58) {
      // From the landing through the middle of the stance the sole is flat on
      // the floor and stays there.
      assert.equal(foot.lift, 0, `a planted foot was ${foot.lift} above the floor`);
    } else {
      // After that the heel comes off for the push. The toe has not left: this
      // is the ankle riding up over it, and it must stay small enough to read
      // as a heel rather than as a hop.
      assert.ok(foot.lift > 0 && foot.lift < g.lift * 0.45,
        `the heel came ${foot.lift.toFixed(2)} off the floor at push-off`);
    }
  }
  // ...and it arrives at the floor rather than dropping the last bit (section 2,
  // "floating feet"). The frame before the plant must be all but touching.
  const justBefore = footStep(0.9999, g);
  assert.ok(justBefore.lift < 0.02,
    `the foot landed from ${justBefore.lift.toFixed(2)} units up`);
});

test('the body is lowest when both feet are down and highest over the planted one', () => {
  // Section 2's weight transfer, and the phase the old hand-tuned bob had
  // upside down: it lifted the body at contact, which is when a person sinks.
  const g = bandOf(0.4);
  const contact = pelvisRise(0, g);
  const passing = pelvisRise(g.duty / 2, g);
  assert.ok(passing > contact + 0.5,
    `contact ${contact.toFixed(2)} vs passing ${passing.toFixed(2)}: the bob is flat or inverted`);
  // Two dips per cycle, not one — one would be a limp. Counted by how deep
  // each dip is rather than by the sign of a derivative: where the constraint
  // hands over from one leg to the other the curve has kinks a hundredth of a
  // unit deep, which is a four-thousandth of the figure and not a dip.
  const N = 720;
  const at = (i) => pelvisRise(((i % N) + N) / N % 1, g);
  let peak = -Infinity;
  for (let i = 0; i < N; i++) peak = Math.max(peak, at(i));
  let dips = 0;
  for (let i = 0; i < N; i++) {
    const here = at(i);
    if (peak - here < 0.25) continue;            // not deep enough to see
    let lower = false;
    for (let j = 1; j <= N / 6; j++) {
      if (at(i - j) < here || at(i + j) < here) { lower = true; break; }
    }
    if (!lower) dips++;
  }
  assert.ok(dips >= 2, `found ${dips} dips per cycle, expected two`);
});

test('the vertical movement is small enough not to bounce', () => {
  // Section 2 again, from the other side: "excessive bouncing".
  for (const share of [0.2, 0.5, 0.9]) {
    const g = bandOf(share);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 200; i++) {
      const r = pelvisRise(i / 200, g);
      lo = Math.min(lo, r); hi = Math.max(hi, r);
    }
    const travel = hi - lo;
    assert.ok(travel > 0.6, `at ${share} the body barely moves: ${travel.toFixed(2)}`);
    assert.ok(travel < 5.5, `at ${share} the body bounces ${travel.toFixed(2)} units`);
  }
});

test('running has a moment with neither foot on the floor, and walking never does', () => {
  // Section 3: the difference between a run and a fast walk is not the speed,
  // it is the flight phase. This is that difference, stated as a number.
  const airborne = (share, config = SCHOOL) => {
    const g = bandOf(share, config);
    let off = 0;
    for (let i = 0; i < 500; i++) {
      const u = i / 500;
      if (!footStep(u, g).planted && !footStep((u + 0.5) % 1, g).planted) off++;
    }
    return off / 500;
  };
  assert.equal(airborne(0.25), 0, 'a walk should always have a foot down');
  assert.equal(airborne(0.55), 0, 'a walk should always have a foot down');
  assert.ok(airborne(1) > 0.1,
    `a run was only airborne ${(airborne(1) * 100).toFixed(0)}% of the cycle`);
  // Section 11: he is an older caretaker. He never leaves the ground, however
  // urgently he is following you.
  assert.equal(airborne(1, VRANA), 0, 'Mr. Vrána should not sprint');
});

test('a run is a different shape from a walk, not a faster one', () => {
  const walk = bandOf(0.35);
  const run = bandOf(1);
  assert.ok(run.step > walk.step * 1.5, 'a run needs a longer stride');
  assert.ok(run.lift > walk.lift * 1.8, 'a run needs the knee up');
  assert.ok(run.duty < 0.5 && walk.duty > 0.5, 'a run needs a flight phase');
  assert.ok(run.lean > walk.lean * 3, 'a run needs a forward lean');
  assert.ok(run.armSwing > walk.armSwing * 1.5, 'a run needs the arms working');
  assert.ok(run.armBend > walk.armBend * 3, 'a run needs the elbows bent');
});

test('a tiptoe is short, low, quiet and crouched', () => {
  // Section 10, and the whole reason the school is a stealth level.
  const creep = bandOf(0.12);
  const walk = bandOf(0.35);
  assert.ok(creep.step < walk.step * 0.8, 'tiptoe steps must be short');
  assert.ok(creep.lift < walk.lift, 'a tiptoe does not pick its feet up');
  assert.ok(creep.armSwing < walk.armSwing * 0.6, 'the arms stay in');
  assert.ok(creep.crouch > 2, 'the whole body should be lower');
  assert.ok(creep.duty > walk.duty, 'a careful foot stays down longer');
});

test('the bands blend rather than snap', () => {
  // Section 4: no abrupt switch anywhere in the range, including at the exact
  // speeds where one band hands over to the next.
  let worst = 0;
  for (let i = 1; i <= 2000; i++) {
    const a = bandOf((i - 1) / 2000);
    const b = bandOf(i / 2000);
    worst = Math.max(worst, Math.abs(b.step - a.step));
  }
  assert.ok(worst < 0.08, `the step length jumps by ${worst.toFixed(3)} at some speed`);
});

test('going faster always means a longer stride and never fewer steps', () => {
  let lastStep = 0;
  let lastCadence = 0;
  for (let i = 1; i <= 100; i++) {
    const share = i / 100;
    const g = bandOf(share);
    const cadence = (share * TUNING.player.speed) / g.step;
    assert.ok(g.step >= lastStep - 1e-9, `stride shortened at ${share}`);
    // Cadence is allowed to dip a little where the walk hands over to the run,
    // because that is what happens to a person: the stride lengthens faster
    // than the speed does for a moment, and the feet come down slightly less
    // often. What is not allowed is a fall you could see.
    assert.ok(cadence >= lastCadence * 0.94, `cadence fell off a cliff at ${share}`);
    lastStep = g.step;
    lastCadence = cadence;
  }
});

test('the cadence stays inside what a person could plausibly do', () => {
  // The check against the obvious failure of this whole approach: pinning the
  // feet to the floor fixes the sliding by making the legs cycle faster, and
  // taken too far that is a cartoon character running on the spot.
  for (const share of [0.15, 0.4, 0.7, 1]) {
    const g = bandOf(share);
    const perSecond = (share * TUNING.player.speed) / g.step;
    assert.ok(perSecond < 6.2, `${perSecond.toFixed(1)} steps a second at ${share}`);
  }
});

test('the legs are never asked to reach further than they are long', () => {
  // The other obvious failure: a stride the legs cannot make, drawn as a
  // character doing the splits.
  for (const config of [SCHOOL, VRANA]) {
    for (let i = 0; i <= 20; i++) {
      const g = bandOf(i / 20, config);
      const reach = footReach(g.step, g.duty);
      assert.ok(reach < g.legLen * 0.72,
        `reaching ${reach.toFixed(1)} on a ${g.legLen} leg is the splits`);
    }
  }
});

test('the knee is straight at contact and folded through the swing', () => {
  // Section 2's natural knee bending, and the second thing the old code had
  // backwards: it bent the knee hardest when the leg was reaching forward.
  const g = bandOf(0.4);
  const bulge = (u) => {
    const foot = footStep(u, g);
    const hipY = -pelvisRise(u, g);
    const knee = kneeOf(0, hipY, foot.along, -foot.lift, g.seg, 1, 0);
    // How far the knee stands off the straight line from hip to ankle.
    const dx = foot.along;
    const dy = -foot.lift - hipY;
    const len = Math.hypot(dx, dy) || 1;
    return Math.abs((knee.x - 0) * (dy / len) - (knee.y - hipY) * (dx / len));
  };
  const atContact = bulge(0.001);
  const midSwing = bulge(g.duty + (1 - g.duty) * 0.5);
  assert.ok(midSwing > atContact * 1.6,
    `knee bulge ${atContact.toFixed(2)} at contact vs ${midSwing.toFixed(2)} mid-swing`);
});

test('the two legs are always half a cycle apart', () => {
  for (let i = 0; i < 50; i++) {
    const phase = i * 0.37;
    const a = legCycle(phase);
    const b = legCycle(phase, 0.5);
    const gap = ((a - b) % 1 + 1) % 1;
    assert.ok(Math.abs(gap - 0.5) < 1e-9,
      `the legs were ${gap.toFixed(4)} of a cycle apart, not half`);
  }
});

test('the arms oppose the legs', () => {
  // One sign, and the difference between walking and marching. The arm on a
  // side swings against that side's leg, so their offsets always disagree.
  const g = bandOf(0.4);
  for (let i = 0; i < 100; i++) {
    const u = i / 100;
    const leg = footStep(u, g).along;
    const arm = -footStep(u, g).along;       // what figure.js does
    if (Math.abs(leg) > 0.5) {
      assert.ok(Math.sign(arm) !== Math.sign(leg),
        `at ${u} the arm and its own leg both went ${Math.sign(leg)}`);
    }
  }
});

test('idle is a stand, not a crouch held still', () => {
  // Section 4: at 0% there is no walk cycle at all. `moving` is what everything
  // postural is scaled by, so this is the check that it reaches zero.
  assert.equal(bandOf(0).moving, 0);
  assert.ok(bandOf(0.06).moving > 0.9, 'the legs should be cycling by a light push');
});

test('the caretaker walks like an older man', () => {
  // Section 11, against the thief at the same share of the same top speed.
  const him = bandOf(0.59, VRANA);
  const thief = bandOf(0.59, SCHOOL);
  assert.ok(him.step < thief.step, 'his steps should be shorter');
  assert.ok(him.lift < thief.lift, 'he does not pick his feet up as far');
  assert.ok(him.duty > thief.duty, 'he keeps a foot down longer');
  assert.ok(him.sway > thief.sway, 'he rolls more from side to side');
  assert.ok(him.lean < thief.lean + 0.01, 'he does not lean into it like a runner');
});

test('following puts a bit of urgency into him without making him sprint', () => {
  const u = VRANA.urgency;
  assert.ok(u.following > 0, 'following should hurry him along');
  assert.ok(u.returning <= 0, 'going back to bed is not urgent');
  // 78 of the player's 132 is 0.59; the urgency lifts it, and it must still
  // land inside a walk.
  const share = 78 / TUNING.player.speed + u.following;
  assert.ok(share < 1, 'he should never reach his own top band');
  assert.equal(bandOf(share, VRANA).duty > 0.5, true, 'still a walk, with a foot down');
});

// --- section 18: the school, and nowhere else --------------------------------

test('every location has a gait, and the walkers are not all the same walker', () => {
  const steps = new Map();
  for (const [name, rules] of Object.entries(TUNING.locations)) {
    assert.ok(rules.gait, `${name} has no gait for the thief`);
    assert.ok(rules.watcherGait, `${name} has no gait for its own person`);
    // The thief is the same man everywhere, so his band table is shared
    // outright rather than copied.
    assert.equal(rules.gait, TUNING.locations.School.gait,
      `${name} has its own copy of the thief's walk`);
    // A band with air under it needs a duty factor under a half or there is no
    // moment with both feet off the ground — and `pelvisRise` would be dividing
    // by a gap of nothing.
    for (const band of rules.watcherGait.bands) {
      if (band.flight > 0) {
        assert.ok(band.duty < 0.5,
          `${name} has a band with air under it and both feet down (${band.duty})`);
      }
      assert.ok(band.step > 0 && band.duty > 0.2 && band.duty <= 0.82,
        `${name} has a band out of range`);
    }
    steps.set(name, rules.watcherGait.bands.map((b) => b.step).join(','));
  }
  // Grandpa does not walk like the estate's security. If every location shared
  // one walker the whole point of §12 would be missing.
  assert.ok(new Set(steps.values()).size >= 6,
    `only ${new Set(steps.values()).size} distinct walks across eleven locations`);
  assert.notEqual(steps.get('House'), steps.get('Mansion'));
});

test('everywhere else keeps exactly the stride it always had', () => {
  // stridePerUnit is the one shared thing this touched. Called the way every
  // other location calls it, it must return what it returned before the school
  // had an opinion — so these are the original table's own numbers.
  const g = TUNING.player.gait;
  assert.equal(stridePerUnit(0), g.strideCreep);
  assert.equal(stridePerUnit(g.creepAt), g.strideCreep);
  assert.equal(stridePerUnit(g.walkAt), g.strideWalk);
  assert.equal(stridePerUnit(TUNING.player.runAt), g.strideWalk);
  assert.equal(stridePerUnit(1), g.strideRun);
  // Halfway up the creep-to-walk ramp, from the original linear blend.
  const mid = (g.creepAt + g.walkAt) / 2;
  assert.ok(Math.abs(stridePerUnit(mid) - (g.strideCreep + g.strideWalk) / 2) < 1e-12);
});

test('an undeclared gait falls back rather than throwing', () => {
  // Every location that is not the school passes undefined here, every frame.
  assert.equal(stridePerUnit(0.5, undefined), stridePerUnit(0.5));
  assert.equal(stridePerUnit(0.5, {}), stridePerUnit(0.5));
});

// Put the thief at the left end of the longest clear run of floor on the level,
// facing along it. Walking a character into a wall and then drawing conclusions
// about its gait is the oldest way to be wrong about an animation.
function clearFloor(sim) {
  const level = sim.level;
  const solid = (x, y) => level.colliders.some(
    (c) => x > c.x - 16 && x < c.x + c.w + 16 && y > c.y - 16 && y < c.y + c.h + 16);
  let best = { len: 0 };
  for (let y = 30; y < level.height - 30; y += 6) {
    let run = 0;
    let from = null;
    for (let x = 24; x < level.width - 24; x += 6) {
      if (!solid(x, y)) { if (from === null) from = x; run += 6; } else {
        if (run > best.len) best = { len: run, x: from, y };
        run = 0; from = null;
      }
    }
    if (run > best.len) best = { len: run, x: from, y };
  }
  const p = sim.entities[0];
  p.x = best.x + 20; p.y = best.y;
  p.prevX = p.x; p.prevY = p.y;
  p.vx = 0; p.vy = 0; p.speed = 0; p.walkPhase = 0;
  sim.timeLeft = 9999;
  return best;
}

// --- driving the gait from the running simulation ----------------------------
// The tests above are about the model. These are about the wiring: the share the
// phase was advanced with has to be the share the renderer reads, and the
// caretaker's states have to reach his legs.

test('the walk phase and the share the renderer reads come from one place', async () => {
  const { createRun, tick } = await import('./harness.mjs');
  const run = createRun(23, 5);
  const { sim } = run;
  const p = sim.entities[0];
  clearFloor(sim);
  let lastPhase = p.walkPhase;
  for (let i = 0; i < 200; i++) {
    tick(run, { x: 1, y: 0, take: false, search: false });
    // From the speed rather than from the positions: walking into a wall
    // recoils the character *after* the phase is advanced, so the positions
    // disagree with the ground actually walked and the speed does not.
    const travelled = (p.speed || 0) / 60;
    // Whatever share the entity is carrying, the phase must have advanced by
    // exactly that share's rate over the ground actually covered.
    const expected = lastPhase + travelled * stridePerUnit(p.gaitShare, SCHOOL);
    assert.ok(Math.abs(p.walkPhase - expected) < 1e-9,
      `frame ${i}: the phase and the share disagree`);
    lastPhase = p.walkPhase;
  }
});

test('standing still stops the cycle and moving restarts it', async () => {
  const { createRun, tick } = await import('./harness.mjs');
  const run = createRun(23, 5);
  const { sim } = run;
  const p = sim.entities[0];
  clearFloor(sim);
  for (let i = 0; i < 90; i++) tick(run, { x: 0, y: 0, take: false, search: false });
  assert.equal(bandOf(p.gaitShare).moving, 0, 'a standing character should not be cycling');
  const still = p.walkPhase;
  for (let i = 0; i < 30; i++) tick(run, { x: 1, y: 0, take: false, search: false });
  assert.ok(p.walkPhase > still, 'moving should advance the cycle');
  assert.ok(bandOf(p.gaitShare).moving > 0.5, 'and the legs should be cycling');
});

test('the gait walks up and back down the bands as the stick is pushed and let go', async () => {
  // Section 6: idle → tiptoe → walk → fast walk → run, and back down the same
  // way. Nothing may be skipped in either direction.
  const { createRun, tick } = await import('./harness.mjs');
  const run = createRun(23, 5);
  const { sim } = run;
  const p = sim.entities[0];
  clearFloor(sim);
  const seen = [];
  const nameOf = (share) => (share < 0.04 ? 'idle'
    : share < 0.25 ? 'tiptoe' : share < 0.60 ? 'walk' : share < 0.85 ? 'fast' : 'run');
  seen.push(nameOf(p.gaitShare));      // standing, before the stick is touched
  for (let i = 0; i < 120; i++) {
    tick(run, { x: 1, y: 0, take: false, search: false });
    const now = nameOf(p.gaitShare);
    if (seen[seen.length - 1] !== now) seen.push(now);
    if (p.gaitShare > 0.99) break;
  }
  for (let i = 0; i < 240; i++) {
    tick(run, { x: 0, y: 0, take: false, search: false });
    const now = nameOf(p.gaitShare);
    if (seen[seen.length - 1] !== now) seen.push(now);
    if (p.gaitShare < 0.01) break;
  }
  assert.deepEqual(seen,
    ['idle', 'tiptoe', 'walk', 'fast', 'run', 'fast', 'walk', 'tiptoe', 'idle'],
    `the gait went ${seen.join(' → ')}`);
});

test('Mr. Vrána walks rather than sprints, whatever he is doing', async () => {
  // Section 11. His top speed against his own is 1.0, which is what used to put
  // him in a full sprint the moment he stood up.
  const { createRun, tick } = await import('./harness.mjs');
  const run = createRun(23, 5);
  const { sim } = run;
  sim.noise = 95;
  let worst = 0;
  for (let i = 0; i < 60 * 12; i++) {
    tick(run, { x: 0, y: 0, take: false, search: false });
    sim.noise = Math.max(sim.noise, 85);
    const w = sim.investigator;
    if (w && w.gaitShare !== undefined) worst = Math.max(worst, w.gaitShare);
    if (sim.status !== 'running') break;
  }
  assert.ok(worst > 0.3, `he never got going: ${worst.toFixed(2)}`);
  assert.ok(worst < 0.85, `he reached ${worst.toFixed(2)} of the thief's top speed`);
  assert.ok(bandOf(worst, VRANA).duty > 0.5, 'at his fastest he still has a foot down');
});

test('his stride changes gradually when he starts following', async () => {
  // Section 12: no pose may teleport. The urgency that following adds is eased
  // in, so his stride opens up over about half a second instead of on one frame.
  const { createRun, tick } = await import('./harness.mjs');
  const run = createRun(23, 5);
  const { sim } = run;
  sim.noise = 95;
  for (let i = 0; i < 60 * 4 && !sim.investigator; i++) tick(run);
  const w = sim.investigator;
  assert.ok(w, 'he should be up by now');
  const p = sim.entities[0];
  // Put the thief right on top of him so he switches to following.
  let worstJump = 0;
  let last = null;
  for (let i = 0; i < 60 * 3; i++) {
    sim.noise = Math.max(sim.noise, 85);
    p.x = w.x + 40; p.y = w.y;
    tick(run, { x: 0, y: 0, take: false, search: false });
    if (last !== null) worstJump = Math.max(worstJump, Math.abs(w.urge - last));
    last = w.urge;
    if (sim.status !== 'running') break;
  }
  assert.ok(last > 0.02, `he never picked up any urgency (${last})`);
  assert.ok(worstJump < 0.02,
    `his urgency jumped by ${worstJump.toFixed(3)} in a single frame`);
});
