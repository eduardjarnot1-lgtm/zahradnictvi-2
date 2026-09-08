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

test('there are five of them and they are five different people', () => {
  assert.equal(SCHOOL_SKINS.length, 5);
  assert.deepEqual(SCHOOL_SKINS.map((s) => s.id),
    ['shadow', 'pirate', 'tech', 'gentleman', 'ghost']);
  for (const skin of SCHOOL_SKINS) {
    assert.ok(skin.name && skin.blurb, `${skin.id} has no name or blurb`);
  }
  // Not a recolour. Two skins may share a crown — two of them wear hoods — but
  // no two may be the same combination of what is on the head, what trails
  // behind and what the coat is, because that combination *is* the silhouette
  // and the silhouette is all you can read at the distance this is played at.
  const shapes = SCHOOL_SKINS.map((s) => [
    s.crown, s.cape ? 'cape' : '-', s.cane ? 'cane' : '-',
    s.aura ? 'aura' : '-', s.goggles ? 'goggles' : '-', s.front || '-'
  ].join('/'));
  assert.equal(new Set(shapes).size, 5, `two skins share a silhouette: ${shapes}`);
  const coats = SCHOOL_SKINS.map((s) => s.coat);
  assert.equal(new Set(coats).size, 5, 'two skins wear the same coat');
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
    // Every thief wears the mask, or has something over his eyes instead of one.
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
