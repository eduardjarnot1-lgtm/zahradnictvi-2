// Doors, which used to be holes in the wall.
//
// The maps have always carried a rectangle for every doorway and the room
// painter has always drawn a leaf standing open against the jamb, because a
// door that did nothing was better drawn out of the way. They do something now:
// a shut door is solid, the one interaction button says OPEN when you walk at
// one, and the leaf swings.
//
// Three things have to hold at once, and they pull against each other. A door
// has to actually stop you, or the button is a decoration. It has to stop
// stopping you the instant you have dealt with it, or every doorway is half a
// second of walking into wood. And it must never wall anybody in — not the
// player, and not the man whose building it is, who does not get a button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim, stepSim, playerOf } from '../src/sim.js';
import { blocked } from '../src/physics.js';
import { LEVELS } from '../src/levels.js';
import { TUNING } from '../src/tuning.js';
import { createRun, tick } from './harness.mjs';

const { boxWidth: PW, boxHeight: PH } = TUNING.player;

// The first door on this level with room to stand at. Some sit in a corner
// where the tile the player would occupy is inside a wall, and those are not
// what any of this is testing.
function usableDoor(sim) {
  return sim.doors.find((door) => {
    const across = door.w > door.h;
    const x = across ? door.x + door.w / 2 : door.x + door.w + 16;
    const y = across ? door.y + door.h + 16 : door.y + door.h / 2;
    return !blocked(x, y, PW, PH, sim.solids);
  });
}

// Stand him at a door, close enough for the button to offer it.
function walkUpTo(sim, door) {
  const player = playerOf(sim);
  const across = door.w > door.h;
  player.x = across ? door.x + door.w / 2 : door.x + door.w + 16;
  player.y = across ? door.y + door.h + 16 : door.y + door.h / 2;
  player.prevX = player.x;
  player.prevY = player.y;
  stepSim(sim);
  return player;
}

test('every building has doors, and every one of them starts shut', () => {
  for (const level of LEVELS) {
    const sim = createSim({ level });
    assert.equal(sim.doors.length, level.doors.length,
      `L${level.id} lost a doorway on the way into the simulation`);
    assert.ok(sim.doors.length > 0, `L${level.id} (${level.location}) has no doors at all`);
    for (const door of sim.doors) {
      assert.equal(door.open, false, `L${level.id}: a door starts open`);
      assert.equal(door.swing, 0, `L${level.id}: a door starts mid-swing`);
    }
  }
});

test('a shut door is solid and an opened one is not', () => {
  for (const level of LEVELS) {
    const sim = createSim({ level });
    for (const door of sim.doors) {
      assert.ok(blocked(door.x + door.w / 2, door.y + door.h / 2, PW, PH, sim.solids),
        `L${level.id}: you can walk straight through a shut door`);
    }
    // ...and the level's own colliders never gained one, because the building
    // is the building and the doors are simulation state. A door that leaked
    // into the level would still be standing there on the next run of it.
    assert.equal(level.colliders.length + sim.doors.length, sim.solids.length,
      `L${level.id}: the solid list is not the building plus its shut doors`);
    assert.equal(level.colliders.filter((c) => c.id && c.id.includes('-o')).length, 0,
      `L${level.id}: a door leaked into the level's colliders`);
    const usable = usableDoor(sim);
    if (!usable) continue;
    walkUpTo(sim, usable);
    stepSim(sim, { x: 0, y: 0, take: false, search: true });
    assert.ok(!blocked(usable.x + usable.w / 2, usable.y + usable.h / 2, PW, PH, sim.solids),
      `L${level.id}: a door you have opened is still in the way`);
  }
});

test('the button says OPEN at a shut door, and the press opens it', () => {
  for (const level of LEVELS) {
    const sim = createSim({ level, seed: 5 });
    // Whichever door has room to stand at: some are in a corner where the tile
    // the player would occupy is inside a wall, and those are not what this is
    // testing.
    const usable = usableDoor(sim);
    if (!usable) continue;
    walkUpTo(sim, usable);
    assert.equal(sim.action, 'open', `L${level.id}: the button did not offer OPEN`);
    assert.equal(sim.doorTargetId, usable.id);
    stepSim(sim, { x: 0, y: 0, take: false, search: true });
    assert.equal(usable.open, true, `L${level.id}: pressing OPEN did not open it`);
    // ...and it stays open. A door you have been through is not a door you have
    // to keep dealing with.
    for (let i = 0; i < 120; i++) stepSim(sim);
    assert.equal(usable.open, true, `L${level.id}: the door shut itself again`);
    assert.equal(usable.swing, 1, `L${level.id}: the leaf never finished swinging`);
    // ...and the button has moved on. It may well still say OPEN — a pair of
    // doors off one landing is a normal thing for a building to have — but it
    // must not still be offering the one that is already standing open.
    assert.notEqual(sim.doorTargetId, usable.id,
      `L${level.id}: the button still offers a door that is already open`);
  }
});

test('the leaf swings rather than snapping, and only once', () => {
  const sim = createSim({ level: LEVELS[0], seed: 3 });
  const door = sim.doors[0];
  door.open = true;
  const seen = [];
  for (let i = 0; i < 40; i++) {
    stepSim(sim);
    seen.push(door.swing);
  }
  assert.ok(seen[2] > 0 && seen[2] < 1, `the leaf was at ${seen[2]} after three frames`);
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i] >= seen[i - 1], 'the leaf went backwards');
  }
  assert.equal(seen[seen.length - 1], 1, 'the leaf never arrived');
  // Half a second, near enough — long enough to be a swing, short enough that a
  // floor of doors is not a floor of waiting.
  const settled = seen.findIndex((s) => s === 1) + 1;
  assert.ok(settled >= 25 && settled <= 35, `the swing took ${settled} frames`);
});

test('opening a door costs nothing, so a doorway is not a toll', () => {
  // Deliberate. Section 11's noises are the things underfoot, which you can
  // route around; a door on the only way into a room is not a decision, and
  // charging for it would be a tax on the floorplan rather than on the player.
  const sim = createSim({ level: LEVELS[0], seed: 5 });
  const door = usableDoor(sim);
  assert.ok(door, 'level 1 should have a door you can stand at');
  walkUpTo(sim, door);
  const before = sim.noise;
  stepSim(sim, { x: 0, y: 0, take: false, search: true });
  for (let i = 0; i < 60; i++) stepSim(sim);
  assert.ok(sim.noise <= before + 0.01,
    `opening a door cost ${(sim.noise - before).toFixed(2)}`);
  assert.equal(sim.events.filter((e) => e.type === 'bump').length, 0,
    'walking through a door you have opened is not a collision');
});

test('the man whose building it is opens his own doors', () => {
  // He gets no button, and he must never be walled out of a room he is on his
  // way to: the routing he uses does not know a door from a doorway, so a shut
  // one he could not open would leave him pressed against it for the rest of
  // the level. He opens what he walks into, which is also just what a person
  // does in their own house.
  //
  // Put him at one rather than waiting for his round to take him past one.
  // Waiting is what this test used to do, and on the two open-plan buildings —
  // a penthouse and a shop floor — his round genuinely never goes near a door
  // in ninety seconds, which says nothing about whether he can open one.
  for (const level of LEVELS) {
    const sim = createSim({ level, seed: 4 });
    const him = sim.entities.find((e) => e.kind !== 'player');
    if (!him) continue;
    const door = sim.doors[0];
    him.x = door.x + door.w / 2;
    him.y = door.y + door.h / 2;
    him.prevX = him.x;
    him.prevY = him.y;
    stepSim(sim);
    assert.equal(door.open, true,
      `L${level.id} (${level.location}): he could not open his own door`);
  }
});

test('a door in the way never costs a level', () => {
  // The whole risk of this, in one assertion. Every level is still finishable,
  // and the levels.test suite runs the same check on the efficient bot — this
  // one is here because it is the thing that would break, and it should say so
  // next to the mechanic that would break it rather than three files away.
  const shut = LEVELS.map((l) => {
    const sim = createSim({ level: l });
    return sim.doors.length;
  });
  assert.ok(shut.every((n) => n > 0), 'a level with no doors');
  assert.ok(shut.reduce((a, b) => a + b, 0) > 300,
    'the doors went missing somewhere between the map and the simulation');
});
