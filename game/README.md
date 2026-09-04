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
| `rules.js` | pure rules: item stats, noise, sleep stage, win/lose |
| `levels.js` | level data as tagged objects (`{type:'furniture', …}`) |
| `validate.js` | level schema + reachability checks |
| `physics.js` | `solveMove` — sub-stepped AABB, used by every mover |
| `sim.js` | fixed-step simulation, entity list, event output |
| `replay.js` | input quantisation, run-length recording, replay |
| `save.js` | versioned save with a migration chain |
| `fsm.js` | screen state machine with enter/exit hooks |
| `input.js` | keyboard + multi-touch into one `read()` |
| `audio.js` | master gain, persisted mute, context revival |
| `render.js` | canvas drawing with interpolation + debug overlay |
| `main.js` | wiring and the fixed-timestep loop |

### Simulation

Fixed 1/60 steps from an accumulator; rendering interpolates between the last
two steps. A long frame costs catch-up steps, never simulated distance.

Runs are deterministic: `(level id, seed, input log)` fully reproduces a run,
including screen shake. `test/fixtures/golden-l3.json` is a recorded 960-frame
playthrough asserted to still pay out exactly $330.

### Adding a level

Append to `LEVELS` in `src/levels.js`, then `npm run build`. The validator
rejects a level whose spawn is inside a wall, whose exit or items cannot be
reached, whose items sit inside furniture, or whose furniture overlaps.

### Debug build

Open with `?debug=1` for fps/step counters, collider boxes, pickup radii, the
player's collision box, boot-time level validation, number keys to jump levels,
and `window.__dwh` holding the live sim and the current recording.
