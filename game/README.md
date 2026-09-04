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

### Chapters

Levels are grouped into themed chapters (Bedroom, Apartment, Hotel, Office,
Luxury, Penthouse). Each chapter opens easier than the last one ended and then
climbs; tests assert both. Levels 1-10 are the original beta set and are
deliberately unchanged.

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

### Hazards

Creaky boards are plain trigger rectangles in `level.creaks`. Stepping onto one
costs noise once, then it goes quiet for a cooldown, so a board can neither be
milked nor drain you while you stand on it. Soft Shoes reduce and eventually
silence them.

### Adding a level

Append to `LEVELS` in `src/levels.js`, then `npm run build`. The validator
rejects a level whose spawn is inside a wall, whose exit or items cannot be
reached, whose items sit inside furniture, or whose furniture overlaps.

### Debug build

Open with `?debug=1` for fps/step counters, collider boxes, pickup radii, the
player's collision box, boot-time level validation, number keys to jump levels,
and `window.__dwh` holding the live sim and the current recording.
