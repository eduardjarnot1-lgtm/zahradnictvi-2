# Don't Wake Him!

A small stealth game. Steal what you can, every item makes noise, get out before
he wakes up.

**Play:** open `index.html` — it is a single self-contained file with no
dependencies and no build step needed to run it.

## Layout

```
game/
  index.html        the built game (committed; this is what ships)
  dist/artifact.html the same build without the html/head/body wrapper
  shell.html        page shell with a /*BUNDLE*/ placeholder
  build.mjs         validates levels, inlines src/ into index.html
  src/              ES modules (the actual source)
  test/             headless tests — no browser required
```

Edit `src/`, then `npm run build`. Editing `index.html` by hand loses the change
on the next build.

## Commands

| command | what it does |
| --- | --- |
| `npm run build` | validate levels, bundle `src/` into `index.html` |
| `npm run validate` | validate levels only |
| `npm test` | headless simulation + level + save + replay tests |
| — | the node suite covers the simulation; only a browser run catches a drawing path that throws, so every level is also rendered in Chromium before release |
| `npm run check` | test, then build |

## Architecture

The rule that keeps this testable: **`sim.js` never touches `document`, `ctx`,
`Date` or `Math.random`.** It takes a state and one input frame and returns a
new state, so the whole game runs in node with no browser.

| module | responsibility |
| --- | --- |
| `tuning.js` | every balance number, in one object |
| `rules.js` | pure rules: item stats, noise, sleep bands, stars, upgrades, win/lose |
| `levels.js` | level data as tagged objects (`{type:'furniture', …}`) |
| `validate.js` | level schema + reachability checks |
| `physics.js` | `solveMove` — sub-stepped AABB, used by every mover |
| `sim.js` | fixed-step simulation, entity list, event output |
| `replay.js` | input quantisation, run-length recording, replay |
| `save.js` | versioned save with a migration chain (progress, stars, shop, settings) |
| `fsm.js` | screen state machine with enter/exit hooks |
| `input.js` | keyboard + multi-touch into one `read()` |
| `audio.js` | master gain, persisted mute, context revival |
| `art.js` | room, furniture and character painting |
| `render.js` | canvas drawing with interpolation + debug overlay |
| `main.js` | wiring and the fixed-timestep loop |

### Simulation

Fixed 1/60 steps from an accumulator; rendering interpolates between the last
two steps. A long frame costs catch-up steps, never simulated distance.

Runs are deterministic: `(level id, seed, input log)` fully reproduces a run,
including screen shake. `test/fixtures/golden-l3.json` is a recorded 960-frame
playthrough asserted to still pay out exactly $330.

### Look and feel

Movement runs through an acceleration/deceleration ramp (top speed unchanged),
with eased turning and a walk cycle driven by distance travelled, so feet never
skate. Taking an item plays a ~0.4s reach: the thief slows, extends an arm, and
the item flies into his hand. Money and noise are credited when TAKE is pressed,
so the animation is presentation only and can never change an outcome.

The room is painted once per level into an offscreen canvas at device
resolution and blitted 1:1, so detail costs nothing per frame. Furniture style
and tone are derived from each collider's shape and position — level files say
`furniture` and get a bookshelf, chest, sofa, wardrobe, TV bench, table or
nightstand — so a room can be redecorated without touching level data.

### Progression

Money is banked on escape; stars are judged on the **raw** haul (before the
Velvet Bag multiplier), so an upgrade can never buy a star. The shop holds three
upgrades and none of them makes a stolen item quieter — a test asserts this,
because the moment the shop can soften the risk, the core decision stops
mattering.

### Map structure

Doorways are declared data, not gaps inferred from where walls stop. The
renderer frames each one with a threshold board and jambs — the single clearest
readability cue in the reference floorplans — and the validator checks it is
wide enough to walk through and actually open.

Two placement rules the validator now enforces, both learned the hard way: an
item on the spawn is free money for no travel, and an item on the exit hides
the way out and gets taken on the way past. Neither is a decision, so neither
is allowed.



Levels 1-24 are single rooms. From 25 on they are **multi-area maps**: interior
walls (`partition` colliders) divide the space into connected rooms joined by
doorways. Partitions are part of the building, so like the outer walls they
cost no noise to brush — furniture remains the hazard.

The layouts are designed around choices rather than complexity for its own
sake. Layout `G` joins two rooms with *two* doorways, so there is a short noisy
route and a long clear one; a test seals each doorway in turn and asserts the
level is still completable through the other, then seals both and asserts it
breaks — otherwise the first half of the test would prove nothing. Layout `H`
puts the study, which holds the best things, furthest from the way out. Layout
`I` is a corridor with a room off each side and the bed at its head, so both
side rooms cost a walk past him.

Bigger maps take longer to cross, so a partitioned level declares its own
`extraTime` on top of the campaign's shrinking clock. Without it the
sophisticated levels land on the 15s floor and are simply unwinnable; a test
asserts the allowance and the partitions go together in both directions.

### Late-campaign layouts

- `G` two rooms, two doorways: a short noisy route and a long clear one.
- `H` the study, holding the best things, furthest from the door.
- `I` a corridor with a room off each side and the bed at its head.
- `J` a private gallery: a 3x2 grid of display plinths in an open hall, so the
  value is out in the middle rather than around the edges.
- `K` rooms hanging off a shared hall, each with its own door.
- `L` a long apartment: a closed storage spine down one side, an open living
  run down the other, bedroom behind a return wall at the far end.
- `M` a museum: display plinths in an open hall, ticket and security wing below.
- `N` a hotel floor: suites hanging off a corridor spine, exit at its far end.
- `O` a school after hours: classrooms and a library across the top, a
  locker-lined corridor, the gym and staff room below.
- `P` an office floor at night: desk banks and a meeting room upstairs, a
  conference room and the lounge security sits in below.

### Two kinds of level

Levels 1-56 are **generated rooms**: a layout template plus a list of items, all
exactly one screen across. Levels 57-63 are **hand-drawn floorplans**, recreated
tile for tile from reference drawings, larger than the screen and walked with a
following camera. Both produce the same level object, so nothing downstream —
the simulation, the validator, the save, the test harness — knows there is more
than one kind.

### Map size and the camera

A level declares its own `width` and `height`. `TUNING.world.width/height` is
now the **window**: how much of a level you can see at once. A level exactly that
size never scrolls, which is every one of the first fifty-six — the camera is a
no-op there and they render identically to before it existed.

The camera lives in the renderer, because where you are looking is presentation
and the simulation must stay pure. It follows the *interpolated* player position
rather than the stepped one (following the stepped one would reintroduce exactly
the judder the interpolation exists to remove), eases exponentially so the feel
is identical at 60 and 120Hz, and is clamped so no frame can show anything
outside the map. A map narrower than the window is centred rather than shoved
against an edge. Impact shake rides on top of the camera transform, so a bang
can never knock the view off the thief.

The room cache is capped: a whole floorplan at full device resolution can be
several times the canvas budget, so it is painted at whatever scale fits and the
small remainder is made up on the blit — and only the visible slice is blitted,
so drawing the room costs the size of the screen, not the size of the map.
Items outside the view are skipped entirely.

### Hand-drawn maps

`src/maps.js` holds the seven floorplans as character grids, and the grid *is*
the map — you can read the building in it. `tilemap.js` turns a grid into a
level: runs of the same character merge into maximal rectangles (fewer, larger
colliders, and the physics loop is linear in collider count), and the tile size
is the only conversion in the system, so a 43x40 drawing becomes a 43x40 map
rather than 43x38. A test asserts each of the seven is exactly the size it was
drawn at.

```
#  outer wall    %  interior wall   O  window    D  doorway
.  floor         ,  rug (silent)    ~  creaky boards
E  the sleeper's own furniture      @  spawn     X  the way out
T table   S sofa/bed   W wardrobe   N nightstand   V tv bench
C cabinet   B shelving   P display plinth        anything else: loot
```

Two rules the grids have to respect, both learned by watching rooms seal
themselves: a doorway needs **two clear tiles** behind it, because the player is
taller than one tile; and a room needs a walkable aisle from its door, because a
landing on its own is not enough when the room behind is packed. The maps are
drafted rather than typed by hand, and the drafting pass carves those aisles —
but only as deep as connectivity actually needs, or a conference room loses its
table and the map stops being the drawing.

### Side exits

The way out is a doorway in the bottom wall unless a level says otherwise:
`{ side: 'left', at: y }` puts it in a side wall instead, which is where the
corridor floorplans want theirs. `boundary()` leaves the gap on whichever wall
is named, the exit test is a plain box overlap so it works on any of them, and
both the validator and the test harness read the side rather than assuming
down.

### Who is in the room

Every level declares a `watcher`: `{ kind, x, y }`. The kind is the only thing
that changes, and it drives everything — the art, what the HUD calls the meter,
the warnings, the loss text, and whether being *seen* fills the meter at all.

| kind | meter | threat |
|---|---|---|
| `sleeper` | NOISE | noise |
| `guest` | NOISE | noise, on a tighter clock |
| `caretaker` | NOISE | noise, across a much larger building |
| `guard` | ALERT | noise **and** being seen |
| `security` | ALERT | noise and a longer line of sight |

A watcher with `sees > 0` is not asleep. Moving inside their radius raises the
meter in complete silence, at a rate that falls off linearly with distance and
scales with how fast you are going — so **freezing costs nothing**, and the
answer to a guard is to stop rather than to run. That plays directly against
the clock, which is what makes the guard levels feel different rather than just
harder. Everything still feeds the same 0-100 meter, so nothing else in the
game had to learn about any of this.

Levels 1-40 predate the system and a test asserts all forty still default to
`sleeper`; another asserts every kind that exists is actually used somewhere.

### The seven floorplans

| # | Level | Size | Who |
|---|---|---|---|
| 57 | The Museum | 43x40 | Bruno, night guard dozing in the guard room |
| 58 | Fourth Floor, After Hours | 44x33 | Mr. Halas, face down on the quarterly report |
| 59 | The Flat, 02:14 | 36x57 | Dad |
| 60 | St. Vitus, Third Floor | 45x32 | Dr. Marek, out on the staff couch |
| 61 | Grand Hotel Bohemia | 49x34 | Otakar, asleep at the floor desk |
| 62 | Komenský Primary | 49x36 | Mr. Vrána, the caretaker |
| 63 | Grandpa's Cottage | 43x36 | Grandpa, by the fire |

Sizes are in tiles and are exactly as specified — the aspect ratios differ on
purpose and are never rounded to fit the screen. Bruno is the only one of the
seven who can see you; the other six are noise alone, in four different poses
(a bed, a couch, an armchair, face down at a desk), each drawn as its own person
rather than one model in a different shirt.

Their clocks are longer than the generated rooms', because they are much bigger
to cross. The test that stops a level being leisurely scales its allowance with
the map's diagonal, so no level is ever more generous *per step* than the
tightest single-screen room.

### Chapters

Levels are grouped into themed chapters — Bedroom, Apartment, Hotel Room,
Office, Luxury Bedroom, Penthouse, Large House, Mansion, Private Gallery, Grand
Suite, Museum, Hotel Floor, School, Office Floor. A chapter is a location: its
palette, furniture flavour, loot and watcher all change together, so entering
one should read as a different building rather than a re-skin. Each chapter
opens easier than the last one ended and then
climbs; tests assert both. Levels 1-10 are the original beta set and are
deliberately unchanged.

### Risk, reward and grading

Item rarity is read off the value, so a new type cannot forget to declare its
risk: rarer things cost more noise, take longer to lift, and tint their own
price label. Stealing without dawdling builds a streak worth up to 15%, and the
escape itself is graded — quiet and unhurried pays a Perfect Escape bonus, loud
or last-second is a Close Call.

Star targets come from an exact knapsack over each room: the best haul actually
gettable inside a 92-noise budget. Setting them against the room's raw total
(the obvious approach) would routinely demand hauls that wake him every time —
a test asserts every three-star target is reachable.

### The movement chain

Stick displacement maps **one-to-one** onto speed: a quarter push is a quarter
speed. A dead zone stops a resting thumb creeping, and above it the magnitude
passes through unchanged — the usual trick of re-stretching the remaining range
would mean a quarter push gave noticeably less than a quarter speed.

The walk cycle advances with **distance travelled**, not with time, so feet
never skate at any speed and footsteps land on the actual footfalls. Stride
length, bounce and lean grow into a run past 72% speed.

Collision noise scales with how hard you hit: the same cabinet costs +2 at a
crawl and +8 at a sprint, a bookshelf +13. Impact is measured on the blocked
axis, a hard hit bounces you back and shakes the room, and it makes the sleeper
visibly flinch on top of what it does to the meter. So:

    stick position → speed → animation → footsteps
    speed → impact → noise → how he reacts

Moving fast is a real decision, not a free upgrade.

### Two resources

The clock and the meter are managed together. Time starts at 30s on level 1 and
shrinks by roughly half a second a level to a floor of 15s. Noise comes from
three places now — stealing, creaky boards, and walking into furniture — and
bleeds off at 2/second once you have stood perfectly still for 0.6s.

Those two systems only work as a pair. Recovery on its own would dissolve the
one-way commitment that makes "one more thing?" a real question; the clock is
what stops you from simply waiting the meter down. A test asserts recovery is
far too slow to be a reset button, and another asserts every level is winnable
by playing efficiently with time to spare — rule 26 made executable.

Collision noise is measured on the **blocked axis** of the move, not on the
resulting speed: a head-on walk into a cabinet stops you dead, so reading speed
after the move would score the hardest collisions as the gentlest ones.

### Surfaces

Rugs live in level data, not in the renderer, because they are gameplay:
footsteps are silent on them and audible on bare boards, which is what makes a
longer route worth considering. The renderer draws them from that same data, so
what looks soft is soft.

### Hazards

Creaky boards are plain trigger rectangles in `level.creaks`. Stepping onto one
costs noise once, then it goes quiet for a cooldown, so a board can neither be
milked nor drain you while you stand on it. Soft Shoes reduce and eventually
silence them.

### Adding a level

Append to `LEVELS` in `src/levels.js`, then `npm run build`. The validator
rejects a level whose spawn is inside a wall, whose exit or items cannot be
reached, whose items sit inside furniture, or whose furniture overlaps.

Two rules the validator learned the hard way and now enforces for you: leave a
clear landing of at least a player-height inside every doorway (furniture
parked 16-20px past a door mouth seals the room behind it, and the flood fill
will say so), and never put an item on the spawn or on the exit — one is free
money, the other hides the way out.

### Debug build

Open with `?debug=1` for fps/step counters, collider boxes, pickup radii, the
player's collision box, boot-time level validation, number keys to jump levels,
and `window.__dwh` holding the live sim and the current recording.
