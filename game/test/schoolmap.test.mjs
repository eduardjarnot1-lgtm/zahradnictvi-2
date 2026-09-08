// The school as a building: is there enough in it, is it all reachable, and is
// every bit of it still the school's own?
//
// "Detailed" is not a thing you can assert, but the things that make a map feel
// detailed are: how many separate pieces of furniture there are, how many kinds,
// whether rooms differ from each other, and whether the dressing that says what
// a room is for is actually present. Those are all countable, and counting them
// is what stops the next change to the generator quietly hollowing the place out
// again — which is exactly what happened twice while this was being written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FLOORPLANS } from '../src/maps.js';
import { TUNING } from '../src/tuning.js';
import { navGrid, flowField } from '../src/nav.js';

const SCHOOL = FLOORPLANS.filter((l) => l.location === 'School');
const OTHERS = FLOORPLANS.filter((l) => l.location !== 'School');
const pieces = (l) => l.colliders.filter((c) => c.type === 'furniture');
const styles = (l) => new Set(pieces(l).map((c) => c.style));

test('there are five school levels and they grow', () => {
  assert.equal(SCHOOL.length, 5);
  let last = 0;
  for (const l of SCHOOL) {
    assert.ok(l.width * l.height >= last, `L${l.id} is smaller than the level before it`);
    last = l.width * l.height;
  }
});

test('every school level is properly furnished', () => {
  // A floor of a building with a dozen things in it reads as a warehouse. The
  // figures here are a floor, not a target: they are roughly what the level had
  // before this pass, so a regression is caught rather than a shortfall argued
  // about.
  // Re-baselined when the five levels became five different buildings rather
  // than one rectangle at five sizes: an L-shaped floor of the same tier simply
  // has fewer rooms on it than a rectangle of the same bounding box, and the
  // early levels are meant to be the readable ones.
  const floor = { 21: 14, 22: 12, 23: 20, 24: 20, 25: 60 };
  for (const l of SCHOOL) {
    assert.ok(pieces(l).length >= floor[l.id],
      `L${l.id} has only ${pieces(l).length} pieces of furniture`);
  }
});

test('the furniture is varied rather than one thing repeated', () => {
  for (const l of SCHOOL) {
    assert.ok(styles(l).size >= 3,
      `L${l.id} is built from only ${[...styles(l)].join(', ')}`);
  }
  // The biggest level should use most of the vocabulary the game has.
  const five = SCHOOL[4];
  assert.ok(styles(five).size >= 5,
    `level five uses only ${[...styles(five)].join(', ')}`);
});

test('the density is real rather than a few enormous slabs', () => {
  // The failure mode this guards against: merging every desk in a classroom
  // into one rectangle counts as "furniture" and looks like a table tennis
  // table. Most pieces should be the size of a piece of furniture.
  for (const l of SCHOOL) {
    const big = pieces(l).filter((c) => c.w * c.h > 140 * 140);
    assert.ok(big.length <= 1, `L${l.id} has ${big.length} enormous slabs`);
    const median = pieces(l).map((c) => c.w * c.h).sort((a, b) => a - b)[
      Math.floor(pieces(l).length / 2)];
    assert.ok(median < 90 * 90, `L${l.id}'s typical piece is ${Math.round(median)} sq units`);
  }
});

test('every room says what it is', () => {
  // Signs, boards, floor treatments: the dressing that makes a corridor read as
  // a corridor and a store room as a store room.
  for (const l of SCHOOL) {
    const kinds = new Set((l.decor || []).map((d) => d.kind));
    assert.ok(kinds.has('sign'), `L${l.id} has no room signs`);
    assert.ok(kinds.has('floor'), `L${l.id} has one floor surface throughout`);
    const floors = new Set((l.decor || []).filter((d) => d.kind === 'floor').map((d) => d.tag));
    assert.ok(floors.size >= 3,
      `L${l.id} uses only ${[...floors].join(', ')} underfoot`);
    assert.ok((l.decor || []).length >= 12, `L${l.id} has only ${(l.decor || []).length} pieces of dressing`);
  }
});

test('the dressing is decoration and never a wall', () => {
  // Decor exists precisely because it is not in the tile grid. If a poster ever
  // became something you could walk into, it would start closing routes.
  for (const l of SCHOOL) {
    for (const d of l.decor || []) {
      // Floor treatments cover whole rooms, so one can legitimately share its
      // rectangle with a walled-off block; it is the *things* that must never
      // become solid.
      if (d.kind === 'floor' || d.kind === 'court') continue;
      assert.ok(!l.colliders.some((c) => c.x === d.x && c.y === d.y && c.w === d.w && c.h === d.h),
        `L${l.id}: a ${d.kind} turned into a collider`);
      assert.ok(d.x >= 0 && d.y >= 0 && d.x < l.width && d.y < l.height,
        `L${l.id}: a ${d.kind} is off the map`);
    }
  }
});

test('everything on every school level can still be reached', () => {
  // The whole point of a denser map is that it stays walkable. Every item, the
  // way out and every doorway, from the spawn, at the resolution the game
  // actually moves at.
  for (const l of SCHOOL) {
    const grid = navGrid(l, TUNING.player.boxWidth, TUNING.player.boxHeight);
    const field = flowField(grid, l.spawn.x, l.spawn.y);
    const reached = (x, y, slack = 24) => {
      const cells = Math.ceil(slack / grid.cell);
      const cx = Math.floor(x / grid.cell);
      const cy = Math.floor(y / grid.cell);
      for (let dy = -cells; dy <= cells; dy++) {
        for (let dx = -cells; dx <= cells; dx++) {
          const gx = cx + dx;
          const gy = cy + dy;
          if (gx < 0 || gy < 0 || gx >= grid.cols || gy >= grid.rows) continue;
          if (field[gy * grid.cols + gx] >= 0) return true;
        }
      }
      return false;
    };
    for (const item of l.items) {
      assert.ok(reached(item.x, item.y), `L${l.id}: ${item.type} at ${item.x},${item.y} is cut off`);
    }
    // A cupboard is opened from beside it, not from on top of it, so this is
    // the distance to the *piece* against the reach the rules actually use.
    // Measuring from its centre instead marks every wide cupboard unreachable.
    const reach = TUNING.locations.School.search.reach;
    for (const s of l.stashes) {
      let closest = Infinity;
      for (let i = 0; i < field.length; i++) {
        if (field[i] < 0) continue;
        const cx = i % grid.cols;
        const px = cx * grid.cell + grid.cell / 2;
        const py = ((i - cx) / grid.cols) * grid.cell + grid.cell / 2;
        const dx = Math.max(s.x - px, 0, px - (s.x + s.w));
        const dy = Math.max(s.y - py, 0, py - (s.y + s.h));
        closest = Math.min(closest, Math.hypot(dx, dy));
      }
      assert.ok(closest <= reach,
        `L${l.id}: a ${s.style} at ${s.x},${s.y} is ${closest.toFixed(0)} from anywhere you could stand`);
    }
    for (const d of l.doors) {
      assert.ok(reached(d.x + d.w / 2, d.y + d.h / 2, 30),
        `L${l.id}: a doorway at ${d.x},${d.y} is blocked`);
    }
    assert.ok(reached(l.exit.x + l.exit.w / 2, l.exit.y + l.exit.h / 2, 40),
      `L${l.id}: the way out is cut off`);
  }
});

test('the rooms differ from one another', () => {
  // Section 9: a classroom, a corridor and a store should not be the same room
  // three times. Read off the floor treatments, which are per-room.
  for (const l of SCHOOL) {
    const tags = (l.decor || []).filter((d) => d.kind === 'floor').map((d) => d.tag);
    const counts = {};
    for (const t of tags) counts[t] = (counts[t] || 0) + 1;
    const commonest = Math.max(...Object.values(counts));
    assert.ok(commonest <= tags.length - 2,
      `L${l.id} is ${commonest} of ${tags.length} rooms the same`);
  }
});

test('every location is dressed and searchable now, not just the school', () => {
  // The isolation test, inverted. Room dressing and furniture you can look
  // inside were the school's alone while they were being proved; they are the
  // game's now, and a location with neither is a location that was missed.
  for (const l of OTHERS) {
    assert.ok((l.decor || []).length > 0 || l.tier === 5,
      `${l.name} L${l.id} has no room dressing at all`);
    assert.ok(l.stashes.length > 0, `${l.name} L${l.id} has nothing to look inside`);
  }
});

test('every building is lit, and lit in its own way', () => {
  // Section 13. Before this pass the school had a fitting every few metres and
  // the other ten had between none and a dozen for a whole floor of a building
  // — which is why washing them all to the same darkness made the school
  // atmospheric and the hospital unreadable. Every location lights itself now.
  const lights = (l) => (l.decor || []).filter(
    (d) => d.kind === 'ceiling' || d.kind === 'lamp' || d.kind === 'desklamp').length;
  const per = new Map();
  for (const l of FLOORPLANS) {
    assert.ok(lights(l) >= 4,
      `${l.location} L${l.id} has ${lights(l)} lights in ${l.width}x${l.height}`);
    per.set(l.location, (per.get(l.location) || 0) + lights(l));
  }
  // ...and not all to the same recipe. An institution is lit on a tighter
  // lattice than a home, so the totals must not come out as one number.
  assert.ok(new Set(per.values()).size >= 6,
    `only ${new Set(per.values()).size} distinct lighting densities across 11 buildings`);
});

test('nothing stands one tile proud of the wall behind it', () => {
  // Sections 3 to 5. A cabinet with a one-tile gap between it and the wall is
  // the loudest tell that a room was generated rather than built, and the gap
  // is not even walkable: the player's box is 22 units wide and a tile is 20.
  // The pass that pushes furniture back used to run on the school alone.
  //
  // Counted rather than forbidden. A piece can legitimately stand proud when
  // pushing it back would strand something else, and the pass puts any move
  // back that leaves the map worse — so what is being held to is that the gap
  // is now the exception. Across all fifty-five levels it was 47% of every
  // piece of furniture in the game and one hotel floor where it was every
  // single piece; it is 13% and one floor at 52% now.
  let proud = 0;
  let total = 0;
  for (const l of FLOORPLANS) {
    const walls = l.colliders.filter((c) => c.type === 'wall' || c.type === 'partition');
    const furniture = l.colliders.filter((c) => c.type === 'furniture');
    let here = 0;
    for (const f of furniture) {
      // A gap of about one tile, between faces that actually front each other.
      const gap = walls.some((w) => {
        const alongX = f.x < w.x + w.w - 4 && w.x < f.x + f.w - 4;
        const alongY = f.y < w.y + w.h - 4 && w.y < f.y + f.h - 4;
        const tile = (g) => g > 12 && g < 28;
        return (alongX && (tile(f.y - (w.y + w.h)) || tile(w.y - (f.y + f.h))))
          || (alongY && (tile(f.x - (w.x + w.w)) || tile(w.x - (f.x + f.w))));
      });
      if (gap) here++;
    }
    proud += here;
    total += furniture.length;
    assert.ok(here <= furniture.length * 0.60,
      `${l.location} L${l.id}: ${here} of ${furniture.length} pieces stand proud of a wall`);
  }
  assert.ok(proud <= total * 0.20,
    `${proud} of ${total} pieces of furniture in the game stand a tile off the wall`);
});

test('every floor has something on it, in its own vocabulary', () => {
  // Sections 11 and 12. Standing on something costs noise and how much depends
  // on what it is — paper is nearly free, a bag left across a doorway is most
  // of a dropped phone — and that is a decision about the player's route, not
  // an effect. It was the school's alone; every building offers it now.
  //
  // What each one offers differs. A shop floor is packaging, a museum is swept
  // every night, and nobody drops a crisp packet in a vault, so the set of
  // materials must not come out the same everywhere.
  const kindsAt = new Map();
  for (const l of FLOORPLANS) {
    assert.ok(l.creaks.length > 0, `${l.location} L${l.id} has nothing underfoot`);
    for (const c of l.creaks) {
      assert.ok(TUNING.hazards.underfoot[c.kind],
        `${l.location} L${l.id}: ${c.kind} has no price`);
    }
    const set = kindsAt.get(l.location) || new Set();
    for (const c of l.creaks) set.add(c.kind);
    kindsAt.set(l.location, set);
  }
  const vocab = new Set([...kindsAt.values()].map(
    (s) => [...s].sort().join(',')));
  assert.ok(vocab.size >= 4,
    `only ${vocab.size} distinct sets of materials across 11 buildings`);
});

test('every building has something in it that says who was here', () => {
  // Section 16. A room full of correct furniture is a floorplan that has been
  // dressed; a room where somebody has left half a cup of tea is a room
  // somebody was in. So each of the ten carries one or two props that could
  // only be in that building — a rope barrier belongs to the museum the way a
  // drip stand belongs to the hospital — and no two of them carry the same set.
  //
  // The school is exempt, and has been all along: it tells its own story at
  // length, with chalk in the tray and a bag by the door, and this whole pass
  // is the other ten catching up with it.
  const STORY = new Set(['luggage', 'barrier', 'till', 'drip', 'meal', 'toys',
    'crate', 'glasses']);
  const kit = new Map();
  for (const l of FLOORPLANS) {
    if (l.location === 'School') continue;
    const here = kit.get(l.location) || new Set();
    for (const d of l.decor || []) if (STORY.has(d.kind)) here.add(d.kind);
    kit.set(l.location, here);
  }
  for (const [location, here] of kit) {
    assert.ok(here.size > 0, `${location} has nothing in it that says who was here`);
  }
  const sets = [...kit.values()].map((h) => [...h].sort().join(','));
  assert.equal(new Set(sets).size, sets.length,
    `two buildings tell the same story: ${sets.join(' | ')}`);
});

test('a searchable piece is always furniture you would actually open', () => {
  const openable = new Set(['chest', 'bookshelf', 'wardrobe', 'table', 'tvBench']);
  for (const l of SCHOOL) {
    for (const s of l.stashes) {
      assert.ok(openable.has(s.style), `L${l.id}: a ${s.style} is not something you open`);
    }
    // ...and not all of it, or the mechanic is a chore rather than a choice.
    const searchable = pieces(l).filter((c) => c.searchable).length;
    assert.ok(searchable < pieces(l).length * 0.7,
      `L${l.id}: ${searchable} of ${pieces(l).length} pieces are searchable`);
  }
});
