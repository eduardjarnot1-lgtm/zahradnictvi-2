// What the room does back, checked without a browser.
//
// Two halves. One is the effects themselves — they are geometry and a clock, so
// they can be driven headlessly against a canvas that records what it was asked
// to draw, and "the drawer is open while his hands are in it and shut
// afterwards" is a thing a test can say rather than a thing somebody squints at.
//
// The other is the seam. None of this is any use if the simulation does not
// hand over what the effect needs — which piece was hit, which way, what was
// underfoot — so the events are checked for their payload here too, at the one
// place that actually consumes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/levels.js';
import { TUNING } from '../src/tuning.js';
import { createSim, stepSim } from '../src/sim.js';
import { createEffects, facing } from '../src/effects.js';
import { createRun, tick, walkTo } from './harness.mjs';

// A canvas that draws nothing and remembers everything. Only the calls the
// effects actually make; anything else would be a fake of the platform rather
// than of what this file uses.
function recorder() {
  const calls = [];
  const note = (name) => (...args) => calls.push({ name, args });
  return {
    calls,
    ops: () => calls.map((c) => c.name),
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: '',
    lineJoin: '',
    font: '',
    textAlign: '',
    save: note('save'),
    restore: note('restore'),
    translate: note('translate'),
    rotate: note('rotate'),
    scale: note('scale'),
    beginPath: note('beginPath'),
    moveTo: note('moveTo'),
    lineTo: note('lineTo'),
    arc: note('arc'),
    arcTo: note('arcTo'),
    ellipse: note('ellipse'),
    closePath: note('closePath'),
    fill: note('fill'),
    stroke: note('stroke'),
    fillRect: note('fillRect'),
    fillText: note('fillText'),
    strokeText: note('strokeText'),
    setLineDash: note('setLineDash'),
    measureText: () => ({ width: 10 })
  };
}

const BOX = { x: 100, y: 100, w: 60, h: 20 };

test('an effect lives for as long as it says and not a frame longer', () => {
  const fx = createEffects();
  const ctx = recorder();
  fx.ring(10, 10, 8);
  fx.update(0.2);
  fx.under(ctx);
  assert.ok(ctx.calls.length > 0, 'a fresh ring should draw something');
  const before = ctx.calls.length;
  // Longer than any ring lives.
  fx.update(2);
  fx.under(ctx);
  assert.equal(ctx.calls.length, before, 'a dead ring must not draw anything');
});

test('a knock needs something to knock, and something to draw it with', () => {
  const fx = createEffects();
  const ctx = recorder();
  fx.knock(null, 0, 1, 1, () => {});
  fx.knock(BOX, 0, 1, 1, null);
  fx.update(0.01);
  fx.under(ctx);
  assert.equal(ctx.calls.length, 0, 'neither of those should have drawn');
});

test('a knocked piece is redrawn off true, and settles back onto it', () => {
  const fx = createEffects();
  const offsets = [];
  const ctx = recorder();
  // The painter is handed the box itself; the displacement is in the transform,
  // which is what lets the same wobble serve furniture and litter alike.
  fx.knock(BOX, 0, 1, 1, () => {}, { x: 130, y: 122 });
  for (let i = 0; i < 40; i++) {
    ctx.calls.length = 0;
    fx.under(ctx);
    const move = ctx.calls.find((c) => c.name === 'translate');
    if (move) offsets.push(Math.abs(move.args[1]));
    fx.update(1 / 60);
  }
  assert.ok(offsets.length > 6, 'it should have moved on more than a frame or two');
  assert.ok(Math.max(...offsets) > 1, 'and moved far enough to be seen');
  assert.ok(Math.max(...offsets) < 6, 'but not so far that it leaves its own footprint');
  // It starts at rest, so the comparison is between the first half of the
  // wobble and the last: a knock has to die away rather than ring on.
  const half = Math.floor(offsets.length / 2);
  assert.ok(Math.max(...offsets.slice(half)) < Math.max(...offsets.slice(0, half)) * 0.6,
    'and it has to settle rather than ring on');
});

test('a hard knock reacts harder than a nudge', () => {
  const reach = (force) => {
    const fx = createEffects();
    const ctx = recorder();
    let worst = 0;
    for (let i = 0; i < 40; i++) {
      ctx.calls.length = 0;
      fx.under(ctx);
      const move = ctx.calls.find((c) => c.name === 'translate');
      if (move) worst = Math.max(worst, Math.abs(move.args[1]));
      fx.update(1 / 60);
      if (i === 0) fx.knock(BOX, 0, 1, force, () => {});
    }
    return worst;
  };
  assert.ok(reach(1) > reach(0.15) * 1.8,
    'walking into a cabinet at a run should not look like brushing past it');
});

test('the drawer is open while his hands are in it and shut once they are out', () => {
  const fx = createEffects();
  const ctx = recorder();
  const drew = () => {
    ctx.calls.length = 0;
    fx.under(ctx);
    return ctx.calls.length;
  };
  fx.open(BOX, 'table', { x: 130, y: 140 }, 1.25);
  assert.equal(drew(), 0, 'shut at the instant it starts');
  fx.update(0.25);
  const open = drew();
  assert.ok(open > 0, 'open a moment later');
  fx.update(0.8);
  assert.ok(drew() > 0, 'and still open while the search runs');
  // Past the search, past the shutting, and gone.
  fx.update(1.2);
  assert.equal(drew(), 0, 'and shut again afterwards');
});

test('finding something shuts the drawer early rather than leaving it hanging', () => {
  const fx = createEffects();
  const ctx = recorder();
  fx.open(BOX, 'chest', { x: 130, y: 140 }, 4);
  fx.update(0.4);
  ctx.calls.length = 0;
  fx.under(ctx);
  assert.ok(ctx.calls.length > 0);
  fx.shut(BOX);
  fx.update(0.5);
  ctx.calls.length = 0;
  fx.under(ctx);
  assert.equal(ctx.calls.length, 0, 'shut, well before its four seconds were up');
});

test('a drawer opens on the side the thief is standing on', () => {
  // Section 2, and the reason it is worth a function of its own: a bank of
  // lockers has four faces and only one of them is the one you are at.
  const bank = { x: 100, y: 100, w: 120, h: 20 };
  assert.deepEqual(facing(bank, { x: 160, y: 160 }), { x: 0, y: 1 }, 'from below');
  assert.deepEqual(facing(bank, { x: 160, y: 60 }), { x: 0, y: -1 }, 'from above');
  // ...and the long side wins a diagonal, because that is the side a bank of
  // lockers actually opens on.
  assert.deepEqual(facing(bank, { x: 250, y: 130 }), { x: 1, y: 0 }, 'from the end');
  const tall = { x: 100, y: 100, w: 20, h: 120 };
  assert.deepEqual(facing(tall, { x: 160, y: 160 }), { x: 1, y: 0 }, 'from the side');
});

test('a louder noise draws a bigger ring than a quieter one', () => {
  // The widest either of them ever gets, over the whole of its own life — a
  // quiet ring is quicker as well as smaller, so comparing them at one instant
  // compares a ring that is nearly done with one that has barely started.
  const spread = (noise) => {
    const fx = createEffects();
    const ctx = recorder();
    fx.ring(0, 0, noise);
    let widest = 0;
    for (let i = 0; i < 90; i++) {
      ctx.calls.length = 0;
      fx.under(ctx);
      for (const call of ctx.calls) {
        if (call.name === 'ellipse') widest = Math.max(widest, call.args[2]);
      }
      fx.update(1 / 60);
    }
    return widest;
  };
  assert.ok(spread(30) > spread(2) * 1.4,
    'a television off a shelf and a sheet of paper underfoot should not look alike');
});

test('nothing is left running when a level restarts', () => {
  const fx = createEffects();
  const ctx = recorder();
  fx.ring(0, 0, 20);
  fx.knock(BOX, 1, 0, 1, () => {});
  fx.open(BOX, 'table', { x: 0, y: 0 }, 2);
  fx.mark(0, 0, '!');
  fx.fly(0, 0, 'coin');
  fx.scuff(0, 0, 1);
  fx.clear();
  fx.update(1 / 60);
  fx.under(ctx);
  fx.over(ctx, 0, 0);
  assert.equal(ctx.calls.length, 0);
});

// --- the seam ----------------------------------------------------------------

test('a bump says what was hit and which way', () => {
  // Without the piece there is nothing to shake, and without the normal there
  // is no direction to shake it in.
  const run = createRun(21, 5);
  const { sim } = run;
  const player = sim.entities[0];
  // Into a piece the map has already guaranteed is approachable, so that a
  // failure here is the event's fault rather than the floorplan's.
  const stash = sim.stashes[0];
  const piece = sim.level.colliders.find((c) => c.searchable === stash.id);
  player.x = piece.x + piece.w / 2;
  player.y = piece.y + piece.h + 18;
  player.prevX = player.x;
  player.prevY = player.y;
  let bump = null;
  for (let i = 0; i < 60 && !bump; i++) {
    tick(run, { x: 0, y: -1, take: false, search: false });
    bump = sim.events.find((e) => e.type === 'bump');
  }
  assert.ok(bump, 'he should have walked into it');
  assert.equal(bump.piece, piece, 'the event has to name the piece itself');
  assert.ok(Math.abs(bump.nx) + Math.abs(bump.ny) > 0, 'and which way it was hit');
  assert.ok(bump.force > 0 && bump.force <= 1);
});

test('a creak says what was underfoot, and where it was', () => {
  const run = createRun(21, 5);
  const { sim } = run;
  const player = sim.entities[0];
  const zone = sim.creaks[0];
  player.x = zone.x + zone.w / 2;
  player.y = zone.y + zone.h / 2;
  player.prevX = player.x;
  player.prevY = player.y;
  tick(run, { x: 0.2, y: 0, take: false, search: false });
  const creak = sim.events.find((e) => e.type === 'creak');
  assert.ok(creak, 'standing on it should have cost something');
  assert.ok(creak.where, 'and said what "it" was');
  assert.equal(creak.where.x, zone.x);
  assert.equal(creak.kind, zone.kind, 'a sheet of paper is not a floorboard');
});

test('a search says which piece opened, from which side, and for how long', () => {
  const run = createRun(21, 5);
  const { sim } = run;
  const player = sim.entities[0];
  const stash = sim.stashes[0];
  player.x = stash.x + stash.w / 2;
  player.y = stash.y + stash.h + 14;
  player.prevX = player.x;
  player.prevY = player.y;
  tick(run, { x: 0, y: 0, take: false, search: false });
  tick(run, { x: 0, y: 0, take: false, search: true });
  const opened = sim.events.find((e) => e.type === 'searching');
  assert.ok(opened, 'the button should have opened it');
  assert.equal(opened.where.x, stash.x);
  assert.ok(opened.from.y > stash.y, 'and remembered which side he was on');
  assert.equal(opened.duration, TUNING.locations.School.search.duration);
  // ...and what came out of it says which piece to shut.
  for (let i = 0; i < 200; i++) {
    tick(run, { x: 0, y: 0, take: false, search: false });
    const found = sim.events.find((e) => e.type === 'found');
    if (found) {
      assert.equal(found.where.x, stash.x);
      return;
    }
  }
  assert.fail('the search never finished');
});

test('the room answers in the school and nowhere else', () => {
  // The whole of the scope rule, in one assertion: the flag the host reads
  // before spawning any of this exists in exactly one location.
  const reacting = Object.entries(TUNING.locations)
    .filter(([, rules]) => rules.reacts)
    .map(([name]) => name);
  assert.deepEqual(reacting, ['School']);
  for (const level of LEVELS) {
    const sim = createSim({ level, seed: 3 });
    assert.equal(!!sim.rules.reacts, level.location === 'School', `L${level.id}`);
  }
});

test('the caretaker publishes how long ago he placed a noise', () => {
  // The renderer turns his head towards a fresh fix, and it can only know one
  // happened because he says so. Nothing else reads it, so it must not be able
  // to change anything either: it counts up and is set to zero, and that is all.
  const run = createRun(23, 5);
  const { sim } = run;
  const him = sim.investigator;
  assert.ok(him.sinceFix > 1, 'nothing has happened yet');
  sim.noise = 80;
  const player = sim.entities[0];
  walkTo(run, player.x + 1, player.y, 4);
  assert.ok(him.sinceFix < 0.5, 'he has just placed one');
  for (let i = 0; i < 120; i++) tick(run, { x: 0, y: 0, take: false, search: false });
  assert.ok(him.sinceFix > 0.5, 'and it ages');
});

test('none of this reaches the simulation', () => {
  // The determinism guarantee, stated as a test: two sims of the same level and
  // seed, one of them driven while an effects instance is spun up and fed the
  // same events, must end in the same place. The effects hold no reference to
  // the sim and the sim holds none to them, so this is really a check that
  // nobody has quietly wired the two together.
  const level = LEVELS.find((l) => l.id === 21);
  const inputs = [];
  for (let i = 0; i < 90; i++) {
    inputs.push({ x: Math.sin(i / 9), y: Math.cos(i / 7), take: false, search: i % 30 === 0 });
  }
  const play = (fx) => {
    const sim = createSim({ level, seed: 11 });
    for (const input of inputs) {
      stepSim(sim, input);
      if (fx) {
        for (const event of sim.events) {
          if (event.type === 'bump' && event.piece) {
            fx.knock(event.piece, event.nx, event.ny, event.force, () => {}, event);
          }
          if (event.type === 'creak') fx.ring(event.x, event.y, event.noise);
        }
        fx.update(1 / 60);
      }
    }
    const player = sim.entities[0];
    return `${sim.noise.toFixed(6)}|${player.x.toFixed(6)}|${player.y.toFixed(6)}`;
  };
  assert.equal(play(createEffects()), play(null));
});
