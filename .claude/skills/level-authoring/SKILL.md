---
name: level-authoring
description: Design data-driven level formats for games — levels as JSON/data rather than hardcoded, with schema versioning, validation, a tuning-constants file, and an in-browser level editor. Use this whenever adding levels, rooms, stages, waves, or puzzles to a game; when level content is currently hardcoded in JS and needs extracting; when balancing difficulty across a progression; when building a level editor or map tool; or when deciding how to store and load game content.
---

# Data-driven level authoring

The single most valuable structural decision in a small game: **content is data, code is
the engine that runs it.** GemRB rebuilt the Infinity Engine on exactly this split —
areas, actors and dialogue live in files, logic lives in the engine. The payoff is not
architectural purity, it is speed: once levels are data you can add ten of them in an
afternoon, tune difficulty without touching logic, hand authoring to a non-programmer,
and let a generator produce content the engine already knows how to run.

The failure mode this prevents: level 7 needs a door that opens on a timer, so you add
an `if (levelIndex === 7)` to the update loop. Do that five times and the engine is
unmaintainable and every new level is a code change.

## The test for whether something is data

Ask: *would two levels ever want different values for this?* If yes, it is data.
If it is the same in every level forever, it is code.

Borderline cases resolve toward data more often than you expect. Gravity feels like a
constant until the moon level. Player speed feels like a constant until the mud level.
Putting them in a tuning file costs nothing and buys the option.

## Three files, three jobs

Keep these separate — they change at different rates and for different reasons.

```
game/
├── engine/        code: only reads data, contains no level-specific branches
├── data/
│   ├── tuning.json   global constants and difficulty curve
│   ├── levels/       one file per level (or one file with an array, if small)
│   └── schema.md     what every field means and its valid range
└── tools/editor.html a standalone editor that reads and writes the same format
```

`tuning.json` is where the game's *feel* lives — speeds, timings, thresholds. Being able
to open one file and see every number that governs the game, with comments, is worth
the small awkwardness of indirection. It also makes difficulty curves visible: if
level 8 is a spike, you can see it in the data instead of inferring it from play.

## Designing the level format

Start from what the level actually contains, not from a generic tile engine. A format
that fits the game is short and readable; a generic one is long and full of nulls.

Some principles that keep formats pleasant to hand-edit:

**Version it from day one.** A `"version": 1` field costs one line now and saves you when
level 20 exists and the format needs to change. Write a migration function that upgrades
old level data on load rather than rewriting every file.

**Prefer named types over raw numbers.** `"type": "creakyBoard"` survives refactoring and
reads at a glance; `"t": 3` does not. The lookup from name to behavior lives in code,
which is exactly where the coupling belongs.

**Let entities carry overrides.** Give each entity type sensible defaults in code, and
allow any level to override any field. This is what makes one-off variations possible
without new types: the boss room's guard is just a guard with `"speed": 2.5`.

**ASCII grids are legitimate and underrated** for tile layouts. A 2D array of strings is
far easier to author and review in a diff than nested coordinate objects, and the parse
is ten lines. Use them for static geometry, and an entity list for anything with state.

```json
{
  "version": 1,
  "id": "hallway",
  "name": "The Hallway",
  "grid": [
    "##########",
    "#..c...s.#",
    "#.####.#.#",
    "#......#@#",
    "##########"
  ],
  "legend": { "#": "wall", ".": "floor", "c": "creakyBoard", "s": "sleeper", "@": "start" },
  "entities": [
    { "type": "creakyBoard", "at": [3, 1], "noise": 0.8 },
    { "type": "sleeper", "at": [7, 1], "snoreDepth": 0.6, "wakeThreshold": 100 }
  ],
  "par": { "seconds": 45 }
}
```

## Validate at load, loudly

Hand-authored data has typos. An engine that reads `undefined` and silently renders
nothing wastes hours; one that says *"level 'hallway': entity 3 has unknown type
'creakybaord' (did you mean 'creakyBoard'?)"* costs ten minutes to write and pays for
itself the first time.

Validate on load in development builds:
- every legend character used in the grid is defined, and vice versa
- every entity type is known to the engine (suggest near-matches on failure)
- every entity's position is inside the grid and not inside a wall
- required entities exist (exactly one start, at least one objective)
- the level is *completable* — flood-fill from start to objective. This catches the most
  common and most embarrassing authoring bug, a level nobody can finish.

Run the validator over all levels in CI. A broken level file should fail the build the
same way a syntax error would.

## The editor is worth building

An in-browser editor that reads and writes the same JSON pays for itself once you have
about four levels. It does not need to be good — a grid you can paint with the mouse, a
palette of entity types, a JSON textarea, and load/save via `localStorage` and a file
download. A few hundred lines.

What makes it actually useful, in rough order of value:
1. **Test-play from the editor** without a reload, and return to editing on death.
2. **Live reload** — edit the JSON textarea, see the level update.
3. Paint tools: single tile, rectangle, flood fill.
4. The validator wired in, showing errors inline as you edit.
5. Undo (keep a stack of JSON snapshots — cheap and completely reliable).

`references/editor-pattern.md` has a working structure for this, including the
edit/play round-trip.

## Progression and difficulty

Difficulty in a level-based game is a curve, and curves are easier to reason about when
they are explicit. Two things worth putting in data:

**Per-level difficulty inputs**, not a single opaque "difficulty" number. A level is hard
because of specific things — less time, more hazards, tighter windows. Naming those
separately lets you build a curve that varies *which* pressure applies, instead of
turning one dial up.

**An intent tag per level** (`"teach"`, `"practice"`, `"test"`, `"twist"`). Good
progressions teach one idea at a time, let the player practise it safely, then test it
under pressure, then subvert it. Writing the intent down keeps you honest — if six
consecutive levels are all tagged `test`, the progression is a grind and the data says so.

Level 1 should be unloseable. Its job is to teach the controls, not to filter players.

## Loading, saving, and cheating

- **Bundle levels, don't fetch them** for a small game — an import or an inline `<script>`
  avoids CORS problems when someone opens the file with `file://`, which people do.
- **Save progress in `localStorage`** under a versioned key (`game:v1:progress`) so a
  format change doesn't crash on old saves. Wrap reads in try/catch: storage can be
  disabled, full, or hold garbage from an earlier version.
- **Assume the client is lying.** Anything stored client-side can be edited, so treat
  local scores as local. If a leaderboard is ever shared, it needs server validation —
  no amount of obfuscation in the browser changes this.

## Generated levels

If levels are procedural, generate *into the same data format* and run the same
validator. The generator becomes just another author, you can seed it and reproduce
bugs, and hand-authored and generated levels stay interchangeable. Generating directly
into engine structures throws away all of that.
