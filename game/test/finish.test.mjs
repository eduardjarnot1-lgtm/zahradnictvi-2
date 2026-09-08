// The finish, and the floor under it.
//
// The finish used to be the school's alone, behind a flag. It is now simply how
// the game paints, in all eleven buildings, so these tests changed sides: they
// used to prove the other ten locations were untouched, and now they prove none
// of them can fall back below the school. What is still fenced is identity —
// each location's own colour of night, and the skins, which stay the school's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEVELS } from '../src/levels.js';
import { THIEF_LOOK, CARETAKER_LOOK, SCHOOL_CARETAKER_LOOK, SCHOOL_SKINS }
  from '../src/figure.js';
import { createSim } from '../src/sim.js';

const art = readFileSync(new URL('../src/art.js', import.meta.url), 'utf8');
const render = readFileSync(new URL('../src/render.js', import.meta.url), 'utf8');

test('the finish is not gated on anything any more', () => {
  // There is no flag, so there is no location that can be left behind one. The
  // second half matters as much as the first: a painter that still branched
  // would leave a second, worse version of the room in the file waiting to be
  // reached by accident.
  assert.equal(/\bpolish\b/.test(art), false, 'art.js still has a polish flag');
  assert.match(art, /^  paintNight\(ctx, level\);$/m,
    'the night pass is no longer called unconditionally');
});

test('there is one painter per thing, not a good one and a plain one', () => {
  // Each of these used to be a pair: the shared painter, and the school's,
  // reached by an early return. The pair is gone — the good one took the shared
  // name — so every location gets the finish because there is nothing else to
  // get. If a second name ever comes back, so does the two-tier room.
  for (const painter of ['drawLockers', 'drawDesk', 'drawBench', 'drawWindowPane',
    'drawDoorway', 'drawWallSlab', 'drawPartition', 'drawBoard', 'drawNotice']) {
    const found = art.match(new RegExp(`^function ${painter}\\(`, 'gm')) || [];
    assert.equal(found.length, 1, `${painter} is defined ${found.length} times`);
  }
  for (const gone of ['drawLockersMetal', 'drawDeskWood', 'drawBenchWood',
    'drawWindowGlass', 'drawDoorwayLeaf', 'wallSlabLit', 'drawBoardKit',
    'drawNoticePinned', 'paintSchoolNight']) {
    assert.equal(art.includes(gone), false, `${gone} is still a separate painter`);
  }
});

test('every building has its own night, and the school keeps the one it had', () => {
  // Same pass, eleven different nights: the identity half of the brief. If two
  // themes ever agree on both the colour and the depth they stop being two
  // places. The school's own numbers are pinned because it is the benchmark the
  // other ten were brought up to — moving it moves the target.
  const table = art.slice(art.indexOf('const THEMES = {'));
  const themes = table.slice(0, table.indexOf('\n};'));
  const names = [...themes.matchAll(/^  (\w+):\s*\{/gm)].map((m) => m[1]);
  assert.ok(names.length >= 18, `only ${names.length} themes found`);
  const nights = [...themes.matchAll(/night: '(#[0-9a-f]{6})', deep: ([0-9.]+)/g)];
  assert.equal(nights.length, names.length, 'a theme has no night');
  assert.equal(new Set(nights.map((m) => m[1] + m[2])).size, nights.length,
    'two themes have the same night');
  assert.match(themes, /school:[\s\S]{0,400}?night: '#0b1a24', deep: 0\.52/,
    "the school's night moved");
});

test('a building is only as dark as its own lights allow', () => {
  // The night is capped by how much of the floor the level's own fittings
  // reach. The school is lit end to end and takes the full depth its theme
  // asks for; a shop with one light would be a black rectangle at that depth,
  // so it is let off. This reproduces the sum `paintNight` keeps while it
  // punches the holes, reading the two constants out of the source so the test
  // moves when the tuning does.
  const [, floor, span] = art.match(
    /Math\.min\(T\.deep, ([0-9.]+) \+ reached \* ([0-9.]+)\)/) || [];
  assert.ok(floor && span, 'the night no longer scales with the light');
  const reach = (l) => {
    let cover = 0;
    const add = (r, stretch = 1) => { cover += Math.PI * r * r * stretch * 0.55; };
    for (const d of l.decor || []) {
      if (d.kind === 'ceiling') add(Math.max(d.w, d.h) * 1.15, 1.7);
      else if (d.kind === 'lamp') add(66);
      else if (d.kind === 'desklamp') add(52);
      else if (d.kind === 'floor' && (d.tag === 'boards' || d.tag === 'parquet')) {
        cover += d.w * d.h * 0.30;
      }
    }
    for (const c of l.colliders) {
      if (c.type === 'wall' && c.window) {
        const v = c.h > c.w;
        add(Math.max(40, (v ? c.h : c.w) * 0.6), 1.5);
      }
    }
    if (l.exit) add(58);
    return Math.min(1, cover / (l.width * l.height));
  };
  for (const level of LEVELS) {
    const depth = Math.min(0.52, Number(floor) + reach(level) * Number(span));
    // Nothing may be washed so far down that the room stops being legible...
    assert.ok(depth <= 0.53, `L${level.id} is washed to ${depth}`);
    // ...and the school, which is lit end to end, must still take the full
    // depth it took before the other ten locations joined it under this pass.
    if (level.location === 'School') {
      assert.equal(depth.toFixed(2), '0.52', `L${level.id} no longer takes its night`);
    }
  }
});

test('only the school hands its people the lit look', () => {
  // The figure painter does the extra passes when the look it is given has a
  // `lit` colour on it, so the gate is which object the renderer reaches for.
  assert.equal(THIEF_LOOK.lit, undefined, 'the shared thief is lit');
  assert.equal(CARETAKER_LOOK.lit, undefined, 'the shared caretaker is lit');
  assert.ok(SCHOOL_CARETAKER_LOOK.lit, 'the school caretaker is not lit');
  for (const skin of SCHOOL_SKINS) {
    assert.ok(skin.lit, `the ${skin.id} skin is not lit`);
  }
  // Mr. Vrána is the same man in the school as everywhere else, just lit.
  for (const key of Object.keys(CARETAKER_LOOK)) {
    assert.deepEqual(SCHOOL_CARETAKER_LOOK[key], CARETAKER_LOOK[key],
      `the school changed the caretaker's ${key}`);
  }
  // The skins are the school's alone, and both places the renderer can reach
  // for one are behind the school's own flag.
  assert.equal(render.split('SCHOOL_CARETAKER_LOOK').length - 1, 2);
  for (const at of [render.lastIndexOf('SCHOOL_CARETAKER_LOOK'), render.lastIndexOf('? skin :')]) {
    assert.match(render.slice(Math.max(0, at - 120), at + 20), /sim\.rules\.reacts \?/,
      'a school-only look is not gated on the school');
  }
  // ...and everywhere else still gets the character it always had.
  assert.match(render, /sim\.rules\.reacts \? skin : THIEF_LOOK/);
});

test('the school is five levels, and every level reacts', () => {
  const lit = LEVELS.filter((l) => l.location === 'School');
  assert.equal(lit.length, 5);
  assert.deepEqual(lit.map((l) => l.id), [21, 22, 23, 24, 25]);
  // The reacting room is no longer the school's — it is the floor every
  // location is held to. Nothing may fall back below it.
  for (const level of LEVELS) {
    assert.equal(!!createSim({ level }).rules.reacts, true,
      `L${level.id} (${level.location}) does not react`);
  }
});

test('nothing in the finish is drawn per frame', () => {
  // The whole affordability argument. Every painter the pass added is called
  // from `paintStaticRoom`, which runs once when a level loads and never again
  // — so none of it can cost a millisecond while the game is running. If one of
  // these ever gets called from `draw`, that argument is gone.
  const live = render.slice(render.indexOf('function draw('));
  for (const name of ['drawLockers', 'drawDesk', 'drawBench', 'drawWindowPane',
    'drawDoorway', 'drawWallSlab', 'paintNight',
    'tileFloor', 'boardFloor', 'grassFloor', 'parquetFloor']) {
    assert.equal(live.includes(name), false, `${name} is called live`);
    assert.equal(new RegExp(`export function ${name}\\b`).test(art), false,
      `${name} is exported, which is how it would end up called live`);
  }
});
