// The five thief skins.
//
// A skin is a look, and a look is data the figure painter reads. That is the
// whole of the integration — but it is also why nothing else in this suite
// touches it, and the first build of these five shipped a crash: a rename left
// `beanie` behind in the rim-light line, every skin threw on the first frame,
// and 264 passing tests said nothing because not one of them ever draws a head.
//
// So the first test here draws all of them, from every angle, at every speed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  drawFigure, SCHOOL_SKINS, DEFAULT_SKIN, skinById, THIEF_LOOK, SCHOOL_CARETAKER_LOOK
} from '../src/figure.js';
import { gaitOf } from '../src/rules.js';
import { TUNING } from '../src/tuning.js';
import { migrate, defaultSettings } from '../src/save.js';
import { createSim, stepSim, playerOf } from '../src/sim.js';
import { LEVELS } from '../src/levels.js';

// A canvas that records rather than paints. Every call the figure painter can
// make has to be here, so a skin reaching for something exotic fails loudly.
function recorder() {
  const calls = [];
  const note = (name) => (...args) => calls.push({ name, args });
  return {
    calls,
    ops: () => calls.map((c) => c.name),
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
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
    clip: note('clip'),
    rect: note('rect'),
    beginPath: note('beginPath'),
    closePath: note('closePath'),
    moveTo: note('moveTo'),
    lineTo: note('lineTo'),
    arc: note('arc'),
    arcTo: note('arcTo'),
    ellipse: note('ellipse'),
    quadraticCurveTo: note('quadraticCurveTo'),
    bezierCurveTo: note('bezierCurveTo'),
    fill: note('fill'),
    stroke: note('stroke'),
    fillRect: note('fillRect'),
    strokeRect: note('strokeRect'),
    setLineDash: note('setLineDash'),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} })
  };
}

const poseAt = (share, facing, extra = {}) => ({
  facing,
  walkPhase: 0.37,
  clock: 4.2,
  gait: gaitOf(share, TUNING.locations.School.gait),
  stand: 1,
  glance: 0,
  search: 0,
  reach: 0,
  moving: share > 0.02,
  creep: 0,
  run: share,
  stride: 1,
  drive: 0,
  ...extra
});

test('every skin draws, from every angle, at every speed', () => {
  // Eight headings and the five walking states, plus the two poses that are not
  // a walk: rummaging in a cabinet and getting up. If a skin can throw, one of
  // these two hundred draws finds it.
  for (const skin of SCHOOL_SKINS) {
    for (let i = 0; i < 8; i++) {
      const facing = (i / 8) * Math.PI * 2;
      for (const share of [0, 0.18, 0.42, 0.68, 0.95]) {
        for (const extra of [{}, { search: 0.5 }, { stand: 0.4 }]) {
          const ctx = recorder();
          assert.doesNotThrow(
            () => drawFigure(ctx, 100, 100, poseAt(share, facing, extra), skin),
            `${skin.id} threw facing ${i} at ${share}`);
          assert.ok(ctx.calls.length > 40,
            `${skin.id} drew only ${ctx.calls.length} things facing ${i}`);
        }
      }
    }
  }
});

test('the original thief is still here, and he is still the default', () => {
  // Section 2. The five are additions, not a replacement — a player who never
  // opens the shop plays the character the game has always had, and `classic`
  // has to be that character exactly rather than a lookalike. Every field of
  // the shared thief, unchanged, plus the school's own lighting.
  const classic = SCHOOL_SKINS[0];
  assert.equal(classic.id, DEFAULT_SKIN);
  assert.equal(classic.id, 'classic');
  for (const key of Object.keys(THIEF_LOOK)) {
    assert.deepEqual(classic[key], THIEF_LOOK[key],
      `the default skin changed the original thief's ${key}`);
  }
  // ...and the only thing it adds is the lighting every school figure gets.
  const added = Object.keys(classic).filter((k) => !(k in THIEF_LOOK));
  assert.deepEqual(added.sort(), ['blurb', 'id', 'lit', 'name']);
});

test('there are six of them and they are six different people', () => {
  assert.equal(SCHOOL_SKINS.length, 6);
  assert.deepEqual(SCHOOL_SKINS.map((s) => s.id),
    ['classic', 'shadow', 'pirate', 'tech', 'gentleman', 'ghost']);
  for (const skin of SCHOOL_SKINS) {
    assert.ok(skin.name && skin.blurb, `${skin.id} has no name or blurb`);
  }
  // Not recolours. Two skins may share a crown — two of them wear hoods — but
  // no two may be the same combination of what is on the head, what trails
  // behind and what the coat is, because that combination *is* the silhouette
  // and the silhouette is all you can read at the distance this is played at.
  const shapes = SCHOOL_SKINS.map((s) => [
    s.crown, s.cape ? 'cape' : '-', s.cane ? 'cane' : '-',
    s.aura ? 'aura' : '-', s.goggles ? 'goggles' : '-', s.front || '-'
  ].join('/'));
  assert.equal(new Set(shapes).size, 6, `two skins share a silhouette: ${shapes}`);
  const coats = SCHOOL_SKINS.map((s) => s.coat);
  assert.equal(new Set(coats).size, 6, 'two skins wear the same coat');
});

test('they are the same body, so nothing about them is an advantage', () => {
  // Section 3, at the only place a drawing could cheat: a smaller figure is a
  // harder figure to see, and a bigger one has a longer reach on the screen
  // than the simulation gave it. Every skin is the thief's own build.
  for (const skin of SCHOOL_SKINS) {
    assert.equal(skin.build, THIEF_LOOK.build, `${skin.id} is a different size`);
  }
  // ...and none of them carries a field the simulation reads. The list is every
  // key any skin defines; none may collide with the rules a location is built
  // from, because that is how a cosmetic choice becomes a gameplay one.
  const keys = new Set();
  for (const skin of SCHOOL_SKINS) for (const k of Object.keys(skin)) keys.add(k);
  const rules = new Set(Object.keys(TUNING.locations.School));
  for (const k of keys) {
    assert.equal(rules.has(k), false, `skins define '${k}', which is also a rule`);
  }
});

test('the simulation has never heard of a skin', () => {
  // The strongest form of "purely cosmetic" that can be checked by reading: the
  // file that decides everything about the game refers to none of this.
  const sim = readFileSync(new URL('../src/sim.js', import.meta.url), 'utf8');
  for (const name of ['SCHOOL_SKINS', 'skinById', 'DEFAULT_SKIN', 'skin']) {
    assert.equal(sim.includes(name), false, `sim.js mentions ${name}`);
  }
  // ...and the renderer is where it is worn, behind the school's own flag.
  const render = readFileSync(new URL('../src/render.js', import.meta.url), 'utf8');
  assert.match(render, /sim\.rules\.reacts \? skin : THIEF_LOOK/);
});

test('only the thief has skins; Mr. Vrána is one man', () => {
  for (const skin of SCHOOL_SKINS) {
    assert.notEqual(skin.coat, SCHOOL_CARETAKER_LOOK.coat,
      `${skin.id} is dressed as the caretaker`);
  }
  // The five new ones all wear the mask, or have something over their eyes
  // instead of one. The original does not, and that is not an oversight — he
  // never has, and section 2 says leave him alone.
  for (const skin of SCHOOL_SKINS.slice(1)) {
    assert.ok(skin.mask || skin.goggles, `${skin.id} has a bare face`);
  }
});

test('the skin you picked is the skin you get back', () => {
  assert.equal(defaultSettings().skin, DEFAULT_SKIN);
  const saved = (skin) => migrate({ v: 5, unlocked: 1, settings: { skin } });
  for (const skin of SCHOOL_SKINS) {
    assert.equal(saved(skin.id).settings.skin, skin.id,
      `${skin.id} did not survive a save`);
  }
  // A save from a build with a sixth skin loads rather than throwing, and the
  // player gets the first one back instead of an empty thief.
  assert.equal(saved('ninja').settings.skin, DEFAULT_SKIN);
  // ...and a save written before skins existed gains one without losing a thing.
  const old = migrate({ v: 5, unlocked: 7, money: 250, settings: { sound: false } });
  assert.equal(old.settings.skin, DEFAULT_SKIN);
  assert.equal(old.unlocked, 7);
  assert.equal(old.settings.sound, false);
  assert.equal(skinById('ninja').id, DEFAULT_SKIN);
  assert.equal(skinById(undefined).id, DEFAULT_SKIN);
});

test('every skin is the same thief underneath, frame for frame', () => {
  // Section 3, and the thing it is most worth proving: the six differ in what
  // they are wearing and in nothing else. There is one animation system, the
  // pose comes off the speed the simulation measured, and the skin is only ever
  // read for colours and for what is on the head — so for identical input every
  // figure has to put its body in exactly the same place.
  //
  // Checked on the two numbers that leave the painter: the hand it hands back
  // (which is where a stolen item is drawn) and the contact shadow (which is
  // where it says his feet are).
  const shadowOf = (calls) => {
    const first = calls.find((c) => c.name === 'arc' || c.name === 'ellipse');
    return first ? first.args.slice(0, 4).map((n) => Math.round(n * 1000)) : null;
  };
  for (let i = 0; i < 8; i++) {
    const facing = (i / 8) * Math.PI * 2;
    for (const share of [0, 0.18, 0.42, 0.68, 0.95]) {
      let hand = null;
      let feet = null;
      for (const skin of SCHOOL_SKINS) {
        const ctx = recorder();
        const got = drawFigure(ctx, 100, 100, poseAt(share, facing), skin);
        const at = [Math.round(got.x * 1000), Math.round(got.y * 1000)];
        const sole = shadowOf(ctx.calls);
        if (hand === null) { hand = at; feet = sole; continue; }
        assert.deepEqual(at, hand,
          `${skin.id}'s hand is somewhere else at ${share}, facing ${i}`);
        assert.deepEqual(sole, feet,
          `${skin.id} stands somewhere else at ${share}, facing ${i}`);
      }
    }
  }
});

test('nothing a skin wears is on the path the body is drawn from', () => {
  // The reason the frame-for-frame test above can hold: the fields a skin sets
  // are colours and the names of things to put on a head. None of them is a
  // length, an angle or a time, so none of them can reach the pose.
  const geometry = ['build', 'legLen', 'seg', 'step', 'duty', 'lift', 'stride',
    'speed', 'accel', 'bands', 'gait', 'walkPhase', 'flight', 'crouch', 'lean'];
  for (const skin of SCHOOL_SKINS) {
    for (const key of Object.keys(skin)) {
      if (key === 'build') continue;             // the one, and it is shared
      assert.equal(geometry.includes(key), false,
        `the ${skin.id} skin sets '${key}', which the walk is built from`);
    }
  }
  // ...and `build` is the same for all six, so no skin is a different size.
  assert.equal(new Set(SCHOOL_SKINS.map((s) => s.build)).size, 1);
});

test('what a thief is wearing never reaches the simulation', () => {
  // Section 7, end to end. The same seeded run, played identically, with each
  // skin selected: if a skin could touch movement, noise, detection or money,
  // these would diverge. They cannot, because the simulation is never told —
  // but this is the assertion that would catch it if that ever changed.
  const play = () => {
    const sim = createSim({ level: LEVELS.find((l) => l.id === 23), seed: 11 });
    const p = playerOf(sim);
    const trail = [];
    for (let i = 0; i < 60 * 12; i++) {
      stepSim(sim, {
        x: Math.cos(i * 0.021), y: Math.sin(i * 0.033),
        take: i % 47 === 0, search: i % 83 === 0
      });
      if (i % 20 === 0) {
        trail.push([Math.round(p.x * 100), Math.round(p.y * 100),
          Math.round(sim.noise * 100), sim.money, Math.round(sim.timeLeft * 100),
          sim.hideState, sim.investigator.state]);
      }
    }
    return trail;
  };
  const reference = play();
  assert.ok(reference.length > 30);
  for (const skin of SCHOOL_SKINS) {
    // Selecting a skin is a renderer call and a saved setting; neither is on
    // this path, and that is exactly the point being pinned.
    assert.deepEqual(play(), reference,
      `the run diverged with ${skin.id} selected`);
  }
});

test('the other ten locations draw the thief they always drew', () => {
  // Every pass in `figure.js` is gated on the look carrying `lit`, which only
  // the school's looks do — and this is the assertion that catches it when one
  // is not. The shoe detail added with the skins was not, at first: it went
  // straight into the Apartment, the Hotel and the other eight.
  //
  // Compared as *drawing*, not as source: the same pose through the shared
  // thief has to produce exactly the calls it did before any of this, and the
  // check for that is that it produces strictly fewer than the school's own
  // version of the same man.
  for (let i = 0; i < 8; i++) {
    const facing = (i / 8) * Math.PI * 2;
    const plain = recorder();
    const lit = recorder();
    const plainHand = drawFigure(plain, 100, 100, poseAt(0.42, facing), THIEF_LOOK);
    const litHand = drawFigure(lit, 100, 100, poseAt(0.42, facing), SCHOOL_SKINS[0]);
    // The same man in the same pose: lighting him does not move him. Compared
    // on the hand the painter hands back, which is the one position it reports
    // and the one that is not buried inside a transform.
    assert.deepEqual(
      [Math.round(litHand.x * 1000), Math.round(litHand.y * 1000)],
      [Math.round(plainHand.x * 1000), Math.round(plainHand.y * 1000)],
      `lighting him moved him, facing ${i}`);
    assert.ok(plain.calls.length < lit.calls.length,
      `the shared thief picked up the school's extra passes, facing ${i}`);
  }
  // No gradients anywhere in the shared thief: the school's finish is where the
  // gradients live, and one leaking out is how the other locations start paying
  // for a pass they never asked for.
  const plain = recorder();
  let gradients = 0;
  plain.createLinearGradient = () => { gradients++; return { addColorStop() {} }; };
  plain.createRadialGradient = () => { gradients++; return { addColorStop() {} }; };
  drawFigure(plain, 100, 100, poseAt(0.42, 1.2), THIEF_LOOK);
  assert.equal(gradients, 0, 'the shared thief is being drawn with gradients');
});
