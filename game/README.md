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
| `nav.js` | walkable grid + breadth-first routing, for characters nobody is steering |
| `sim.js` | fixed-step simulation, entity list, event output |
| `replay.js` | input quantisation, run-length recording, replay |
| `save.js` | versioned save with a migration chain (progress, stars, shop, settings) |
| `fsm.js` | screen state machine with enter/exit hooks |
| `input.js` | keyboard + multi-touch into one `read()` |
| `audio.js` | master gain, persisted mute, context revival |
| `art.js` | room, furniture and character painting |
| `gait.js` | the mechanics of a step: planted feet, solved hips, knees by IK |
| `figure.js` | the drawn people: one function, any heading, any speed |
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

### Eleven locations, five levels each

The campaign is eleven locations of five levels: Apartment, House, Hotel,
Office, School, Hospital, Museum, Mansion, Penthouse, Shop, Vault. Level 1 of a
location is a couple of rooms you can clear; level 5 is a floor of a building
you cannot. Within a location the theme, the furniture vocabulary and the person
stay the same — it is the same place, five times, harder each time.

Every level is a character grid. `tools/build-locations.py` runs at authoring
time and writes `src/maps.js`; the grids are committed, so level 27 is the same
building every time anyone plays it and nothing is decided at runtime. The seven
hand-drawn floorplans are not generated — they are recreations of reference
drawings, and each is the fifth level of its location at exactly the size it was
drawn.

Difficulty climbs on five axes at once, all read off the tier:

| | level 1 | level 5 |
|---|---|---|
| map | 30x26 tiles | 44x38, or the hand-drawn size |
| items | 8 | 18 |
| loot | coins and wallets | diamonds and gold |
| the person watching | half his range | all of it |
| clock | most slack | least |

The most valuable thing on a map is promoted to whatever is furthest from the
way out, so the best haul is always the longest walk back.

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

### The clock

Time is stated per level, not derived from a campaign-wide slope — with eleven
locations there is no such slope to derive from. `tools/calibrate-clocks.mjs`
plays every level with the harness, measures how long the map takes to *work*
(the full efficient haul and the walk out, with the clock lifted so the
measurement is not circular), and sets

```
clock = max(24s per window of map x slack[tier], measured run x 1.35)
slack = 2.15, 1.88, 1.65, 1.45, 1.28
```

So difficulty is **pressure**, not raw seconds: the same building with less and
less room to breathe. In practice every location runs 56s, 53s, 51s, 50s and
then whatever its fifth map's size demands — a bigger building genuinely takes
longer to cross, which is the one case where the seconds go back up. The floor
term means no level can be tighter than a good run needs.

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
1-9 0  a searchable piece — the level's `search` block says which style
       it is and what, if anything, is inside it
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
| `caretaker` | NOISE | noise, scaled by distance — **and he gets up and comes looking** |
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

### One location's own rules

`TUNING.locations` is the only place a location may ask for behaviour the rest
of the game does not have. A level whose location is not listed there gets an
empty object and is bit-for-bit the game it was before the block existed — the
golden replay fixture and a suite of isolation tests hold that line, asserting
that every other location has no investigator, no proximity curve, no altered
decay, and charges exactly the printed noise for an item.

Today the School is the only entry, and it changes three things.

**Noise depends on how close you are to Mr. Vrána.** Everything you do — a step,
a knock, opening a drawer, lifting something out of it — is multiplied by one
continuous curve: **3.0x** standing over him, easing to **0.85x** at the far end
of the building. Both ends are deliberate. The near end is what makes his room
frightening; the far end is what stops there being a safe corner — the quietest
place in the school is quieter, never silent, and the whole of even the largest
map sits on the sloping part of the curve rather than pinned at the bottom.

The meter says which end you are at (`‼‼ HE IS RIGHT THERE`, `‼ LOUD HERE`, `▲`,
`▼ MUFFLED`), because a hidden multiplier is a trap rather than a mechanic.
Distance is measured to where he actually *is*, so once he is up and walking the
quiet end of the corridor moves with him.

**And once he is awake, he is listening.** A second, tighter curve rides on top
of the first, centred on wherever he is standing: up to **1.7x** again at his
feet, easing to nothing at 220 units. It travels with him, so waking him does
not just send a man to one place — it drags a loud circle around the building
behind him. Asleep, that boost is not applied at all.

**The school settles faster.** 7/second after 0.9s of standing perfectly still,
against 2/second after 0.6s everywhere else — fast enough that going still is a
tactic rather than a consolation, and it has to be, because it is how you send
him back to bed.

**Over 80 he gets up and investigates.** The moment the meter crosses 80 his
target is set to *where you were standing at that instant*, and it is never
updated. He swings his legs off the couch, walks there — through the doorways,
respecting every collider, at his own 78 units/second with his own acceleration
— stands and looks around for three seconds, then goes home and lies back down.
Under 50 he gives up wherever he is and turns round. Walking into you ends the
level through the ordinary loss path, with `caught` as the reason.

He is investigating a **place, not a person**, which is the whole mechanic: move
away quietly and he walks past you to an empty corridor. A pulsing marker shows
the spot he is heading for, so "can I be gone before he gets there?" is a
question the player can actually answer.

**Until you let him get close enough to see you.** Inside 58 units he stops
guessing: he switches to following, and his target becomes wherever you are,
re-read every 0.3 seconds or whenever you have moved 28 units. This is the one
place he knows where you actually are, and he only earns it by nearly touching
you — everywhere else he is still walking towards a memory.

Losing him takes ground, held. He gives up after **2 seconds beyond 150 units**,
and that timer *decays* rather than resetting, because snapping it to zero the
instant you clipped the edge of his range threw away four seconds of running and
made being followed permanent. He walks at 78 against your 132, so you gain
about fifty units a second in the open — a second and a half of clear running to
break contact, two more to keep it. The two distances are far apart on purpose:
one number and he would flicker between chasing and not chasing on every step.

That gives the school three stages rather than two:

| | Mr. Vrána | what the player is managing |
|---|---|---|
| 1 | asleep on the couch | distance, and how much noise each thing is worth |
| 2 | up and investigating | the same, plus a loud circle walking around the building |
| 3 | following | getting away, and only then getting out |

    make noise → he wakes → he walks to the spot → go still → the meter falls
      → under 50 he gives up → he walks home → he goes back to sleep

**And he is drawn, rather than abstracted.** `figures: true` in the school's
rules is what switches both characters over to `figure.js`; every other location
keeps the character it has always had. Getting off the couch is four beats
rather than a fade — he stirs where he lies, sits up, gets his feet under him,
then has a look round before he sets off. It takes 1.35 seconds, and those are
seconds the player can use, which is the point of showing it at all instead of
cutting to a man already walking. A test asserts he does not move an inch until
he is upright: a sleeping figure sliding towards you is the exact bug the
sequence exists to prevent.

**And some of the furniture opens.** Certain cabinets, desks, lockers and
shelves in the school are searchable: stand beside one, press SEARCH, and after
a second and a quarter you find out whether there was anything in it. Roughly
half of them are empty, which is the entire point — a level where every drawer
pays out is a chore, not a decision.

Opening one costs noise before you know the answer, so you cannot learn a
cupboard is empty for free; lifting something out costs the same as lifting the
same item off a shelf. Both go through the proximity curve, so the cupboard
beside his couch is a very different proposition from the one at the far end of
the corridor. Searching does not settle the meter either — rummaging is not
holding your breath — and it barely lets you move, so it is a real second and a
quarter of standing in one place.

Crossing 80 while your hands are in a drawer wakes him exactly as any other
noise does, and the spot he walks to is the cupboard you were opening. There is
no separate reaction; a search is just another way to make noise.

Most of what a school level is worth is now behind those doors. The floors keep
three to five things: a couple of coins to get you moving, and one thing worth
crossing the map for. Everything else has to be found.

| level | on the floor | searchable | holding something | hidden share |
|---|---|---|---|---|
| 21 | 3 | 5 | 4 | 76% |
| 22 | 3 | 8 | 6 | 78% |
| 23 | 4 | 9 | 8 | 80% |
| 24 | 4 | 12 | 9 | 84% |
| 25 | 5 | 14 | 11 | 82% |

The star targets count what is hidden as well as what is lying about — otherwise
three stars would be reachable without opening anything, and the mechanic would
be decoration. A test asserts three stars is out of reach of the floor alone.

Which cupboards hold what is decided at authoring time, by cost:

    (search noise + item noise) x proximity at that distance  <=  60

Every item is placed in the riskiest cupboard it fits that ceiling in. Big
prizes therefore land at middle distance, small change can sit right beside his
couch, and the cupboards nearest him mostly hold nothing. That shape is what
makes it a gamble rather than a trap — a diamond in the cabinet by his head
costs more meter than the game has to give, so taking it would not be a
decision, it would be a loss with extra steps. A test re-derives the ceiling
from the game's own numbers, which is also what keeps the generator's copy of
the proximity curve honest.

Searchable furniture wears two brass handles on a dark plate, and stays open
once you have been through it — no counter, no checklist, just a drawer hanging
out. A test asserts every school level keeps at least one empty and at least one
full, and another asserts each of the five is still winnable while ignoring the
furniture completely: option A has to stay open, or the mechanic is a tax rather
than a choice.

He walks on a coarse breadth-first distance field over the building
(`src/nav.js`), flooded from wherever he is going and followed downhill with a
line-of-sight shortcut so he cuts the corner of a doorway instead of shuffling
along the grid. The field is a pure function of the level, built lazily and only
for levels that need one — sub-millisecond on the largest school map, recomputed
at most twice per investigation. A test walks the whole grid and asserts it
never claims a spot the physics would refuse; another triggers him from a sample
of every standable cell on all five school maps and asserts he always arrives
and always gets home.

### The eleven locations

| # | Location | Levels | Who | Hand-drawn level 5 |
|---|---|---|---|---|
| 1 | Apartment | 1-5 | Dad, in bed | The Flat, 02:14 — 36x57 |
| 2 | House | 6-10 | Grandpa, in the armchair | Grandpa's Cottage — 43x36 |
| 3 | Hotel | 11-15 | Otakar, at the floor desk | Grand Hotel Bohemia — 49x34 |
| 4 | Office | 16-20 | Mr. Halas, on the report | Fourth Floor — 44x33 |
| 5 | School | 21-25 | Mr. Vrána — **wakes at 80 and comes looking** | Komenský Primary — 49x36 |
| 6 | Hospital | 26-30 | Dr. Marek, on the staff couch | St. Vitus — 45x32 |
| 7 | Museum | 31-35 | Bruno, night guard — **he can see you** | The Museum — 43x40 |
| 8 | Mansion | 36-40 | Security — **he can see you** | — |
| 9 | Penthouse | 41-45 | The owner, in bed | — |
| 10 | Shop | 46-50 | The night manager, at the counter | — |
| 11 | Vault | 51-55 | The vault guard — **the widest range in the game** | — |

Eight of the eleven are asleep and raise NOISE; three are awake and raise ALERT,
where moving inside their range costs you in complete silence and standing still
costs nothing.

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
never skate at any speed and footsteps land on the actual footfalls.

There are three gaits, blended rather than switched, and which one you see is
read off the speed the character is *actually* travelling at:

| share of top speed | gait | steps per unit | drawn stride |
|---|---|---|---|
| 0 | standing | — | none |
| up to 30% | tiptoe — short careful steps, crouched, arms in | 0.088 | 0.70x |
| 30-46% | blending | 0.088 → 0.062 | 0.70 → 1.0x |
| 46-72% | walking | 0.062 | 1.0x |
| 72-100% | running — long strides, bounce, lean | 0.062 → 0.047 | 1.0 → 1.32x |

Cadence and stride length multiply to speed, so once the cadence is fixed the
drawn step length is not a matter of taste: it is the reciprocal, and `gaitBlend`
derives it rather than guessing. A test asserts the two agree to nine decimal
places at every speed.

The body turns to face where it is going, not just the feet: the torso narrows
and leads with the near shoulder, the face slides towards the direction of
travel, hair and ear stay behind, a nose leads, and one eye goes behind the nose
once he is properly side-on. Walking away shows the back of his head.

Arms oppose legs — left arm forward with the right leg. That is one sign in the
source and it is the whole difference between a person walking and a toy
marching; it was the wrong way round until it was drawn out large enough to see.

### The school's meter is not a fuse

Everywhere else in the game the meter is called NOISE, a hundred means he woke
up, and that is the level over. **In the school, filling it ends nothing.** It
makes one man quick and it makes him right, and what actually loses you the
level is him walking into you or the clock running out.

That is not a softer game. It is a different one: instead of watching a bar and
stopping before it fills, you are being hunted by someone who gets better at it
the more you give him — and worse at it if you go quiet and let him lose the
thread. `alertnessOf` smoothsteps the meter onto nought-to-one and *everything*
about him reads off it, continuously, with no bands and nothing that steps:

| meter | alert | how far out his guess is | his pace | out of the chair in | time spent searching |
|---|---|---|---|---|---|
| 62 (just up) | 0.07 | 216 units — the wrong end of the wrong room | 58 | 2.0s | 4.0s |
| 70 | 0.26 | 175 | 66 | 1.8s | 3.6s |
| 80 | 0.58 | 105 | 81 | 1.3s | 2.8s |
| 90 | 0.87 | 43 | 94 | 1.0s | 2.1s |
| 100 | 1.00 | 16 — near enough on top of you | 100 | 0.8s | 1.8s |

He does not know where you are. He knows roughly where a sound came from, and
"roughly" is a number: a random point inside a disc of that radius, square-rooted
so the error spreads over the disc rather than bunching at its edge, then snapped
onto floor he can actually stand on. Forty wakes at the bottom of the curve
scatter his guesses across most of a wing; forty at the top put him on you.

**Each fresh bang narrows the last guess** rather than replacing it, so a thief
who keeps making noise is closed in on and one who goes quiet is not. Two things
about that were learned the hard way and are the reason it works at all:

- **A refix needs an event, not a drift.** It triggers on the meter jumping in a
  single step — something lifted, knocked into or opened moves it several points
  at once; walking across a room moves it a fiftieth of one. Comparing against
  the meter at the last fix instead meant a player *running for their life* fed
  him a fresh fix every few seconds, which made escaping impossible.
- **A man walking back to his desk is not a man asleep at it.** Asleep, the level
  of the noise wakes him. Already up and heading home, it takes a fresh bang to
  turn him round — otherwise a meter still sitting above the line re-fixed him on
  you the instant he gave up, over and over, and a thief who had done everything
  right could never shake him.

The line he gets up at came down from 80 to 62, and the line he gives up at from
50 to 40. The stretch from there to a hundred used to be twenty points of
imminent death; it is now the part of the game where he is hunting you, and it
needs to be wide enough to have a shape in it.

The loop this creates, and the one the tests drive:

    make a noise → he takes a fix on it and gets up → get off the spot he has
      a fix on → go quiet → the meter falls → he loses the thread → he goes home

Note the order. **Standing still on the spot he has a fix on is not hiding, it is
waiting to be found** — the test that tried it got caught in two seconds flat.

**And he sleeps at a desk.** Not a couch and certainly not a bed: he is the
caretaker, he was doing the rota, and he nodded off over it. The desk carries the
lamp, the paperwork, a monitor with its back to the room and a mug that went cold
hours ago, and it is painted into the room cache rather than drawn with him — so
it is still standing there after he gets up and walks off. The place he sleeps is
a landmark you plan routes around and the place he eventually returns to; having
it wink out of existence the moment he left it was daft.

### Five buildings, not one building five times

### The school is a building, not a floorplan

The five levels are five different plans, and the difference is in the walls
rather than in the furniture. Read them with every stick of furniture removed and
they are still a rectangle, an L, a T, a U round a courtyard, and one irregular
floor with wings:

| | shape | what that does to the play |
|---|---|---|
| 1 | rectangle | one corridor, three rooms, the office at the end — the level that teaches the building |
| 2 | **L** | a teaching corridor with a wing turning down at the far end; the hall and stores are a dead end off it |
| 3 | **T** | a stem drops out of the middle of the corridor, so most things have two ways round and the bottom is a dead end |
| 4 | **U** | two wings either side of a courtyard you cannot cross, so the ends of the building are a long walk apart |
| 5 | irregular | wings, recesses, a library, a hall, a staff end, and the caretaker's store |

The grid stays rectangular because everything downstream assumes it is; the
*building* becomes an L or a U by walling off what is outside it. Two walls
running one row too far turned the teaching corridor into three sealed pieces on
the T and the U at once — invisible in the source, impossible to miss on a
reachability map, and the reason there is now a test that floods every school
level from the spawn and insists every item, every cupboard, every doorway and
the way out are all reachable.

The school's five levels are furnished from what each room is *for*. A classroom
is rows of paired desks either side of a centre aisle, with the teacher's desk at
the front, cupboards along the back and a board on the wall; a corridor is
lockers down both sides with benches between them; a store is shelving with
cupboards under it. That is what makes the map readable — you know which room you
are in from the furniture, before you read the sign over the door.

| | pieces of furniture | kinds | searchable | room dressing |
|---|---|---|---|---|
| level 1 | 5 → **17** | 2 → **4** | 6 | 0 → **19** |
| level 2 | 10 → **22** | 3 → **5** | 8 | 0 → **19** |
| level 3 | 9 → **28** | 3 → **5** | 10 | 0 → **22** |
| level 4 | 14 → **33** | 3 → **5** | 12 | 0 → **27** |
| level 5 | 33 → **69** | 4 → **5** | 14 | 0 → **35** |

**Room dressing is a separate channel.** Blackboards, notice boards, posters,
signs, floor treatments, bins, plants, the gym's court markings — none of it is
in the tile grid, because every character in that grid is something you can walk
into and a poster is not. The generator emits a `decor` list beside the grid,
because only the generator knows a room is a classroom rather than a store
cupboard; the renderer just draws what it is told. All of it is painted into the
room cache, which is built once per level and blitted a slice at a time, so the
entire dressing costs **nothing per frame** however dense it gets. That is the
whole reason it can be this dense on a phone.

**Five floor surfaces**, one per kind of room: boards in the classrooms, carpet
in the library and staff room, tile in the corridors and changing room, sprung
parquet in the hall, bare concrete in the caretaker's store. A school is not one
surface, and telling the rooms apart underfoot is most of what makes a floorplan
scan at a glance.

**The school gets its own furniture painters** for the two pieces the shared ones
get wrong: `sofa` becomes a bench and `chest` becomes a bank of lockers with
doors, vents and handles. A sports hall does not contain three-cushion settees,
and drawing its benching as one was the single thing most stopping the building
from reading as a school. Desks get their own painter too — the shared table
scatters whatever a table in a house might have on it, and a classroom full of
pot plants growing out of the desks is the sort of thing you only see once you
look at the whole map at once. Chairs are drawn rather than placed: a chair is
not something you collide with here, and giving each one a tile would wall the
room in.

Four things were learned the hard way and are worth keeping in mind before
touching the generator again:

- **A door needs a lane, and the lane comes first.** Furniture laid down and
  then carved back out is how whole classrooms came back empty: the connectivity
  pass can only restore a blocked route by deleting what is in it. Every piece
  is now placed *into* the runs left over once the doorways have their lanes.
- **A door in the middle of a wall ruins a classroom.** It cuts the room into
  two slivers either side of the lane it needs. The school puts its doors two
  tiles in from a corner, which leaves one block to furnish; `corridor_plan`
  takes an optional `door_at` and every other location keeps the centred door it
  has always had.
- **A one-tile gap is not a gap.** The player is 22 by 24 units and a tile is 20,
  so a single tile between two pieces looks like floor and is not. It is fine as
  the visual separation between desks — it is not somewhere to drop a coin, and
  it is not a corridor. Lockers one bank deep against the lower corridor wall
  rather than one tile off it, for the same reason.
- **A cupboard you cannot reach is a bug, not a locked door.** Furniture is only
  made searchable if the reachability flood puts standable floor within the
  search reach of it. On a sparse map this never came up; on a furnished one it
  came up immediately.

### The school walks differently

The table above is the whole game's walk. The school has its own, in
`src/gait.js` and `TUNING.locations.School.gait`, and it is a different model
rather than different numbers.

**The old one slid.** A foot's offset was `sin(phase) * stride`, which never
stops moving — so at every instant the foot was travelling at the body's speed
*plus* whatever the sine was doing, and it was doing something at all times.
Standing on it did not help; there was no standing on it. A test measures the
old curve at a walking pace and finds a planted foot travelling **over five
world units** while it was supposed to be still.

**The new one cannot slide.** A stance foot moves backwards through the body's
frame at exactly the body's speed, which is a straight line whose slope is that
speed with the sign flipped, which means it does not move across the floor at
all. Not less; none. A test walks a character at eight speeds and asserts the
planted foot stays put to within a fiftieth of a shoe.

That one decision pays for everything else:

- **The hips are derived, not tuned.** With a foot planted and a leg of known
  length there is exactly one height the hip can be at, so `pelvisRise` solves
  for it and takes the lower answer when both feet are down. The body dips as
  the legs splay and rises over the support leg — two dips a cycle, in the right
  phase. The hand-tuned sine it replaces was **upside down**: it lifted the body
  at contact, which is the moment a person sinks.
- **The knees are inverse kinematics.** Given a hip and an ankle, the knee is
  the third corner of a triangle with two known sides. One square root, and the
  leg is straight when it reaches out at contact and folded when the foot is up
  under the hip. The ad-hoc bend it replaces was *also* upside down — it bent
  the knee hardest when the leg was reaching forward.
- **The crouch is one number.** Shortening the legs lowers the body and folds
  the knees together, so the whole tiptoe posture falls out of `crouch`.
- **The heel comes off before the toe does.** The last part of the stance rides
  up on the ball of the foot. Without it the trailing leg goes on reaching
  backwards flat-footed and drags the hips into a second, smaller dip: a limp.

The bands are §4's, and `step` — how much ground one step covers — is the one
that matters, because it fixes the cadence (speed ÷ step) and the drawn foot
travel at the same time:

| | ground per step | duty | at that speed |
|---|---|---|---|
| tiptoe | 7.0 | 0.70 | 2.3 steps/sec, crouched, arms in, heel never down |
| walk | 12.5 | 0.62 | 4.3 steps/sec, near upright, heel-to-toe |
| power walk | 17.0 | 0.50 | 5.4 steps/sec, leaning in, arms working |
| run | 24.0 | 0.30 | 5.5 steps/sec, **airborne 40% of the cycle** |

The duty factor is what makes the run a run rather than a fast walk: under a
half means there is a moment with neither foot down, and through it the body is
a projectile rather than a constraint. A test asserts a walk never leaves the
ground and a run always does.

The steps are short for these characters' height on purpose. Their legs are
under a third of the body where a person's are about half, so the same ground
has to be covered in more, quicker steps; trying to hide that with long strides
only produces a figure doing the splits. There is a test for each failure mode —
one capping the cadence at what a person could plausibly do, one capping the
reach at what the legs are actually long enough for.

**Mr. Vrána is not the thief with different numbers.** His share is measured
against the *player's* top speed rather than his own, which is the whole trick:
at his 78 against the thief's 132 he sits at 0.59, a purposeful walk. Measured
against himself, walking at all put him at 1.0 and drew him sprinting to the
staff room every time he stood up. He gets shorter steps, less lift, more roll
from side to side, and no run in him at all — a test asserts he never leaves the
ground however urgently he is following you. Catching sight of you adds a little
urgency, eased in over about half a second rather than switched, so his stride
opens up instead of changing between one frame and the next.

Two more things the speed alone does not say. `drive` is the only part of the
pose that is not a function of how fast he is going: it is positive while
getting up to speed and negative while shedding it, so he tips forward off the
mark and settles back as he stops instead of arriving upright at both ends. And
the head keeps most of the bob out of itself — a neck spends the whole cycle
giving back what the legs put in, and a head that rides the hips is the
difference between a walk and a bobblehead.

All of this is school-only, and tested as such: no other location declares a
gait, and `stridePerUnit` called the way everywhere else calls it returns the
original table's own numbers.


### The drawn people

`figure.js` is one function that draws one human from any heading at any speed
out of flat shapes. No sprite sheets and no eight baked directions: the pose is
computed, which is what lets a diagonal look like a diagonal instead of like a
left-facing character shoved sideways.

Its proportions come from a reference drawing — a big head on a chunky body,
about three and a bit heads tall, with visible trouser legs and real shoes. The
shading is flat: a base tone, a lit tone for the top of each mass, a dark tone
underneath. Three fills rather than a gradient, because a gradient is rasterised
per pixel per frame and these are not.

The cycle underneath is a proper walk, and in the school it is the derived one
described above: planted feet, hips solved for rather than tuned, knees by
inverse kinematics, shoulders counter-rotating against the hips, the shoe
rolling heel-to-toe and pointing where he is going. Creeping crouches, shortens
the step, holds the arms in and keeps the heel up; running leans in, lengthens
the stride and bends the arms.

One drawing note that is not obvious until you see it fail: an arm crosses a
torso painted the same colour as itself, so the near arm carries a heavier dark
rim than the legs ever need. The legs are out in clear air below the hem and
separate on their own; without the extra edge the arms simply vanish into the
sweater.

Two things worth knowing before editing it:

- **Strokes are the expensive part.** A limb is two of them, not four, and the
  thigh-to-shin taper that costs bought nothing at sixteen pixels.
- **Never clip.** The first draft clipped a highlight to the sweater's own
  outline. That single call cost a fifth of the frame budget under software
  rasterisation — an inset shape stays inside by construction and costs nothing.

Measured against the old character on the same level, the new one is free: the
frame times are identical. Big maps do cost frames, but they cost them equally
on locations that have none of this — the hotel and office floors are worse than
the school is.

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
bleeds off at 2/second once you have stood perfectly still for 0.6s — except in
the School, which sets its own rate (see **One location's own rules**).

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
