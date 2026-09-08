// The school's finish, and the fence round it.
//
// Everything the polish pass added is gated on one flag, set from the level's
// own location. These tests are here because that flag is easy to lose: a
// painter that forgets to branch, or a look object handed to the wrong figure,
// would quietly repaint the other ten locations, and nothing else in the suite
// would notice until someone opened a bedroom and found it lit like a school.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEVELS } from '../src/levels.js';
import { THIEF_LOOK, CARETAKER_LOOK, SCHOOL_THIEF_LOOK, SCHOOL_CARETAKER_LOOK }
  from '../src/figure.js';
import { createSim } from '../src/sim.js';

const art = readFileSync(new URL('../src/art.js', import.meta.url), 'utf8');
const render = readFileSync(new URL('../src/render.js', import.meta.url), 'utf8');

test('the finish is switched on by the location and by nothing else', () => {
  // One assignment, reading one field. If a second way to turn it on appears,
  // the scope of this pass stops being checkable by reading a line.
  const sets = art.match(/^\s*polish = .*$/gm) || [];
  assert.equal(sets.length, 1, `polish is assigned ${sets.length} times`);
  assert.match(sets[0], /polish = level\.location === 'School';/);
});

test('every polished painter still has the old one behind it', () => {
  // Each of these is a `if (polish) return <other>(...)` at the top of the
  // painter the other ten locations share. The point is that the branch is an
  // early return into a separate function rather than a rewrite of the
  // original: whatever a bedroom drew before this pass, it still draws.
  for (const [painter, polished] of [
    ['drawLockers', 'drawLockersMetal'],
    ['drawDesk', 'drawDeskWood'],
    ['drawBench', 'drawBenchWood'],
    ['drawWindowPane', 'drawWindowGlass'],
    ['drawDoorway', 'drawDoorwayLeaf'],
    ['drawWallSlab', 'wallSlabLit']
  ]) {
    const at = art.indexOf(`function ${painter}(ctx,`);
    assert.ok(at > 0, `${painter} is gone`);
    const head = art.slice(at, at + 220);
    assert.match(head, new RegExp(`if \\(polish\\) return ${polished}\\(`),
      `${painter} no longer defers to ${polished}`);
  }
});

test('only the school hands its people the lit look', () => {
  // The figure painter does the extra passes when the look it is given has a
  // `lit` colour on it, so the gate is which object the renderer reaches for.
  assert.equal(THIEF_LOOK.lit, undefined, 'the shared thief is lit');
  assert.equal(CARETAKER_LOOK.lit, undefined, 'the shared caretaker is lit');
  assert.ok(SCHOOL_THIEF_LOOK.lit, 'the school thief is not lit');
  assert.ok(SCHOOL_CARETAKER_LOOK.lit, 'the school caretaker is not lit');
  // ...and the lit ones are the same people, not a redesign. Section 2 asks for
  // their identities kept: same clothes, same build, same silhouette.
  for (const [base, school] of [
    [THIEF_LOOK, SCHOOL_THIEF_LOOK], [CARETAKER_LOOK, SCHOOL_CARETAKER_LOOK]
  ]) {
    for (const key of Object.keys(base)) {
      assert.deepEqual(school[key], base[key], `the school changed ${key}`);
    }
  }
  // Every use of a lit look in the renderer is behind the school's own flag.
  for (const name of ['SCHOOL_THIEF_LOOK', 'SCHOOL_CARETAKER_LOOK']) {
    const uses = render.split(name).length - 1;
    // Once in the import, once at the call site.
    assert.equal(uses, 2, `${name} is used ${uses} times`);
    const at = render.lastIndexOf(name);
    assert.match(render.slice(Math.max(0, at - 120), at), /sim\.rules\.reacts \?/,
      `${name} is not gated on the school's flag`);
  }
});

test('the school is the only location with a finish to lose', () => {
  // The flag reads `level.location`, so this is the set of levels it can ever
  // be true for — five, and the five the whole beta is about.
  const lit = LEVELS.filter((l) => l.location === 'School');
  assert.equal(lit.length, 5);
  assert.deepEqual(lit.map((l) => l.id), [21, 22, 23, 24, 25]);
  // ...and they are the same five the rest of the beta is gated on, so there is
  // one scope here and not two that have to be kept in step.
  for (const level of LEVELS) {
    const reacts = !!createSim({ level }).rules.reacts;
    assert.equal(reacts, level.location === 'School',
      `L${level.id} (${level.location}) disagrees about being the school`);
  }
});

test('nothing in the finish is drawn per frame', () => {
  // The whole affordability argument. Every painter the pass added is called
  // from `paintStaticRoom`, which runs once when a level loads and never again
  // — so none of it can cost a millisecond while the game is running. If one of
  // these ever gets called from `draw`, that argument is gone.
  const live = render.slice(render.indexOf('function draw('));
  for (const name of ['drawLockersMetal', 'drawDeskWood', 'drawBenchWood',
    'drawWindowGlass', 'drawDoorwayLeaf', 'wallSlabLit', 'paintSchoolNight',
    'tileFloor', 'boardFloor', 'grassFloor', 'parquetFloor']) {
    assert.equal(live.includes(name), false, `${name} is called live`);
    assert.equal(art.includes(`export function ${name}`), false,
      `${name} is exported, which is how it would end up called live`);
  }
});
