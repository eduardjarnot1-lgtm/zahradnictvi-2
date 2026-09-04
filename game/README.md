# Don't Wake Him — map pack

Seven hand-authored levels for the stealth game *Don't Wake Him*, drawn top-down in the
style of the reference art: solid highlighted walls, floor material per room, and every
piece of furniture placed individually — tables, chairs, beds, lamps, curtains, rugs,
plants, doors and windows.

Open **`game/maps.html`** in a browser to page through all seven. Nothing to install; it
reads `maps-data.js` and draws with `map-renderer.js`, so it works from `file://` too.

| # | Level | Size | Rooms | Objects | Him |
|---|-------|------|-------|---------|-----|
| 1 | The Museum | 43×40 | 6 | 165 | Bruno, the night guard |
| 2 | Fourth Floor, After Hours | 44×33 | 10 | 228 | Mr. Halas, asleep at his desk |
| 3 | The Flat, 02:14 | 36×57 | 15 | 210 | Dad |
| 4 | St. Vitus, Third Floor | 45×32 | 9 | 167 | Dr. Marek |
| 5 | Grand Hotel Bohemia, Floor 4 | 49×34 | 9 | 220 | Otakar, floor concierge |
| 6 | Komenský Primary, 21:40 | 49×36 | 9 | 253 | Mr. Vrána, caretaker |
| 7 | Grandpa's Cottage | 43×36 | 7 | 161 | Grandpa |

## Layout

```
game/
  maps.html          viewer — level list, wall highlight, noise heat-map, tile grid, zoom
  map-renderer.js    canvas renderer: floors, walls, doors and ~90 furniture types
  maps-data.js       all seven maps inlined (generated)
  maps/<id>.json     one file per map — this is what the game loads (generated)
  maps/index.json    manifest + the tile table
tools/
  maps-src/*.mjs     the authoring source: rooms, doors, windows, props
  prop-helpers.mjs   shorthand for beds, chair rows, desk pods, curtains, ceiling lights
  build-maps.mjs     compiles maps-src -> game/maps/*.json + maps-data.js
  check-maps.mjs     validator (reachability, spawn/exit/sleeper, props inside walls)
```

```bash
node tools/build-maps.mjs    # rebuild after editing anything in tools/maps-src
node tools/check-maps.mjs    # verify every room is reachable and nothing is buried in a wall
```

## Tile alphabet

Walls are generated, not typed by hand: the compiler carves the room rectangles, then
turns every empty cell touching a floor into a wall. Doors, windows and glass are then
punched into those walls.

| char | tile | walkable | noise |
|------|------|----------|-------|
| `#` | wall | – | – |
| `W` | window in wall | – | – |
| `G` | glass partition | – | – |
| `D` | closed door (clicks when opened) | yes | 3 |
| `d` | open doorway | yes | 0 |
| `L` | locked door | no | – |
| `V` | vent / crawl space | yes | 1 |
| `S` | stairs | yes | 2 |
| `E` | elevator | yes | 4 |
| `X` | level exit | yes | 0 |
| `,` | carpet | yes | **0 — silent** |
| `"` | grass | yes | 0 |
| `.` | concrete / lino | yes | 2 |
| `=` | polished marble | yes | 2 |
| `o` | balcony decking | yes | 2 |
| `:` | ceramic tile | yes | 3 |
| `~` | old parquet | yes | **4 — creaks** |
| `%` | gravel | yes | **5 — very loud** |

`noise` is what a footstep on that tile costs you; the sleeper's `sense` value is the
radius in tiles at which he starts to stir. That's the whole design lever — carpet lets
you run, the cottage has no quiet floor at all, which is why it is the hardest level.

## Map JSON

```jsonc
{
  "id": "museum",
  "name": "The Museum",
  "subtitle": "Night shift, closed wing",
  "objective": "…what the player has to do",
  "difficulty": 2,                     // 1..5
  "width": 43, "height": 40, "tileSize": 16,
  "spawn":   { "x": 4, "y": 37, "facing": "e" },
  "exit":    { "x": 34.5, "y": 38.5 },
  "sleeper": { "x": 21.4, "y": 35.2, "name": "Bruno…", "sense": 7, "note": "…" },
  "rooms":   [ { "name": "Great Hall", "x": 3, "y": 2, "w": 38, "h": 18, "floor": "=" } ],
  "openings":[ { "x": 20, "y": 32, "t": "door", "w": 1, "h": 1, "axis": "h", "note": "…" } ],
  "windows": [ { "x": 2, "y": 6, "w": 1, "h": 4, "glass": false } ],
  "props":   [ { "t": "display-case", "x": 13.4, "y": 9, "w": 4.6, "h": 3.4 } ],
  "hideSpots":[{ "x": 5, "y": 16, "w": 4, "h": 3, "kind": "behind display case" }],
  "patrols": [ { "name": "Bruno (if woken)", "loop": [[21,36],[21,31],[12,25]] } ],
  "tiles":   ["   ###…", "…"]          // height strings of width characters
}
```

Room and prop coordinates are in tiles and may be fractional — a chair at `x: 6.8` sits
four fifths of a tile in. `d` on a prop is its facing (`n`/`e`/`s`/`w`), `c` is a colour
variant (`red`, `blue`, `cream`, `green`, `gold`, `clay`, `silver`, `jade`, `warm`, `grey`).

## Adding a level

Drop a new file in `tools/maps-src/` (they compile in filename order):

```js
import { p, ceilingLights, bedSet, curtainsH } from '../prop-helpers.mjs';

const BED = { name: 'Bedroom', x: 2, y: 2, w: 10, h: 8, floor: ',' };

export default {
  id: 'attic', name: 'The Attic', subtitle: '…', objective: '…', difficulty: 3,
  w: 20, h: 14,
  rooms: [BED],
  windows:  [{ x: 4, y: 1, w: 3, h: 1 }],
  openings: [{ x: 6, y: 10, t: 'door' }, { x: 1, y: 5, t: 'exit' }],
  spawn: { x: 3, y: 8 }, exit: { x: 1.5, y: 5.5 },
  sleeper: { x: 6, y: 4, name: 'Him', sense: 7, note: '…' },
  props: [ ...ceilingLights(3, 3, 8, 6, 2, 2), ...bedSet(5, 3), ...curtainsH(4, 2.05, 3) ],
};
```

Leave exactly one empty column or row between two rooms and the compiler puts a shared
wall there. Two empty rows means a thick wall — a door across one then needs
`{ h: 2, axis: 'h' }` so it is drawn the right way round and actually connects the rooms.
`node tools/check-maps.mjs` will tell you if it doesn't.

## Furniture types

Roughly ninety, each with its own drawing:

*Surfaces* — table, table-round, dining-table, conference-table, coffee-table, desk,
desk-l, nightstand, counter, island, bar.
*Seating* — chair, office-chair, stool, bench, armchair, sofa.
*Sleeping* — bed, bunk, crib, hospital-bed.
*Storage* — shelf, bookcase, cabinet, wardrobe, dresser, filing, lockers, crate, box,
safe, suitcase, display-case, pedestal, vending.
*Kitchen & bathroom* — fridge, stove, stove-wood, sink, basin, dishwasher, washer,
microwave, kettle, toilet, bathtub, shower, radiator, fireplace.
*Electronics* — tv, tv-wall, monitor, computer, laptop, printer, copier, register,
monitor-med, iv, projector, phone, piano, whiteboard, chalkboard, board.
*Light* — lamp-ceiling, lamp-floor, lamp-table, chandelier, sconce, candle, nightlight.
*Textiles & decor* — rug, rug-round, curtain, blinds, screen, mat, painting, mirror,
clock, grandfather-clock, sign, doormat.
*Greenery* — plant, plant-big, tree, vase, amphora, statue.
*Odds and ends* — rope, turnstile, scanner, extinguisher, trash, coat-rack, cart, mug,
papers, book, keys, camera, stairs, glass-screen, hoop, ball, broom, bucket, ladder,
jars, sewing, globe, wheelchair, umbrella, teddy, blocks, cat, pram, tray, water-cooler.
*Actors* — sleeper (him, with his Zs), player (your spawn).

An unknown type still draws — as an orange placeholder box, so a typo is visible rather
than silent.
