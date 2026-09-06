#!/usr/bin/env python3
"""Builds src/maps.js: eleven locations of five levels each.

This runs at authoring time, not in the game. It emits fixed character grids
that are committed to src/maps.js, so level 27 is the same building every time
anyone plays it — there is nothing procedural at runtime. The tool exists
because eleven room grammars scaled across five difficulties is a thing you can
read and adjust, and fifty-five hand-typed grids is not.

The seven hand-drawn floorplans are not generated: they are imported from
draft-floorplans.py verbatim and slotted in as the hardest level of their
location, exactly as drawn.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib.util

_spec = importlib.util.spec_from_file_location(
    'draft', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'draft-floorplans.py'))
draft = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(draft)
Grid, shell = draft.Grid, draft.shell

# Loot by difficulty tier: cheap and safe at the start of a location, valuable
# and loud at the end. The most expensive things go furthest from the way out,
# which is what makes the last level of a location a decision rather than a walk.
TIER_LOOT = [
    'cwpk',      # coins, wallets, phones, headphones
    'wpkrm',     # ...rings and cameras
    'rmtnl',     # tablets, consoles, laptops
    'nlvjm',     # TVs and jewels
    'vjdgl',     # diamonds and gold
]

# Map size per tier. Level 1 of a location is a room or two; level 5 is a floor
# of a building. Level 5 is usually a hand-drawn map and uses its own size.
# Level 1 of a location is a couple of rooms; level 5 is a floor of a building.
# The ramp is deliberately gentle: difficulty comes mostly from how the space is
# cut up, how much is in it and how awake the person is, not from making you
# walk twice as far. A map that doubles in size can only ever be given more
# seconds, which would put the clock curve in reverse.
TIER_SIZE = [(30, 26), (33, 28), (36, 31), (40, 34), (44, 38)]


LOOT_CHARS = 'cwpkrmtnlvjdg'


class Loot:
    """Hands out loot characters for a tier, cycling so a room gets variety."""
    def __init__(self, tier):
        self.pool = TIER_LOOT[tier]
        self.i = 0

    def next(self):
        ch = self.pool[self.i % len(self.pool)]
        self.i += 1
        return ch


# How much there is to steal, by tier. Level 1 of a location is learnable — you
# can clear it — and from level 3 the room holds more noise than the meter can
# take, so you have to choose. Two items on a map is not a decision.
TIER_ITEMS = [8, 10, 12, 15, 18]

# The loudest, most valuable thing in each tier. It goes wherever is furthest
# from the way out, so the best haul is always the longest walk back.
TIER_PRIZE = ['k', 'm', 'l', 'v', 'g']

# How far the guard is watching, as a share of his kind's full range. He is the
# same man across a location's five levels; he is just paying more attention by
# the end. On a small early map his full range would cover the whole building,
# which is not a stealth level, it is a coin toss.
TIER_SIGHT = [0.50, 0.62, 0.75, 0.88, 1.0]
SIGHT_BASE = {'nightguard': 150, 'security': 158, 'vaultguard': 150}


def top_up_loot(g, tier):
    """Bring the level up to its tier's item count, spreading the extra loot
    across whatever floor is going spare rather than piling it by the door."""
    TILE = 20
    loot = Loot(tier)
    def items():
        return [(x, y) for y in range(g.rows) for x in range(g.cols) if g.g[y][x] in LOOT_CHARS]
    def marker(ch):
        for y in range(g.rows):
            for x in range(g.cols):
                if g.g[y][x] == ch: return (x, y)
        return None
    spawn, exit_ = marker('@'), marker('X')
    target = TIER_ITEMS[tier]
    # Walk the map on a coarse lattice so the extra loot ends up spread through
    # the building instead of clustered in whichever room is emptiest.
    for step in (5, 4, 3):
        for y in range(2, g.rows - 2, step):
            for x in range(2, g.cols - 2, step):
                if len(items()) >= target: return
                if g.g[y][x] != '.': continue
                if g._blocked(x * TILE + TILE / 2, y * TILE + TILE / 2): continue
                near = items()
                if any(max(abs(x - ix), abs(y - iy)) < 3 for (ix, iy) in near): continue
                if spawn and max(abs(x - spawn[0]), abs(y - spawn[1])) <= 3: continue
                if exit_ and max(abs(x - exit_[0]), abs(y - exit_[1])) <= 3: continue
                g.g[y][x] = loot.next()


def promote_prize(g, tier):
    """Upgrade whichever item is furthest from the way out to the tier's best.
    Risk and reward should point in the same direction."""
    exit_ = None
    for y in range(g.rows):
        for x in range(g.cols):
            if g.g[y][x] == 'X': exit_ = (x, y)
    if not exit_: return
    best, bestd = None, -1
    for y in range(g.rows):
        for x in range(g.cols):
            if g.g[y][x] not in LOOT_CHARS: continue
            d = abs(x - exit_[0]) + abs(y - exit_[1])
            if d > bestd: best, bestd = (x, y), d
    if best:
        g.g[best[1]][best[0]] = TIER_PRIZE[tier]


def scatter(g, tier, spots, box=False):
    """Drop loot at roughly these tiles, snapping each onto real floor.

    `box` asks for floor the player can actually stand on rather than merely a
    free tile. It matters wherever furniture is packed tightly enough to leave
    one-tile gaps: a gap that narrow looks like floor and is not, and a coin
    dropped into one is a level that cannot be finished."""
    loot = Loot(tier)
    for (x, y) in spots:
        g.drop(x, y, loot.next(), box=box)


# --------------------------------------------------------------- room grammars
# Each grammar builds one kind of building. They take the tier so the same
# grammar produces a small two-room flat and a sprawling one, and they all leave
# the same things behind: an outer wall, interior walls with doorways, one
# watcher, one spawn, one way out.

def corridor_plan(g, tier, top, bottom, furnish, corridor_rows=6, exit_side='left',
                  door_at=None):
    """A spine with rooms hanging off both sides. Hotels, schools, wards,
    offices — anywhere the building is organised around a route rather than a
    room."""
    cols, rows = g.cols, g.rows
    band = (rows - corridor_rows - 4) // 2
    y1, y2 = 1 + band, 1 + band + corridor_rows + 1

    g.hwall(1, y1, cols - 2)
    g.hwall(1, y2, cols - 2)

    def split(y0, h, n):
        """n rooms across, returning each room's (x, width) and cutting doors."""
        inner = cols - 2
        w = inner // n
        out = []
        for i in range(n):
            x = 1 + i * w
            ww = (inner - i * w) if i == n - 1 else w
            if i:
                g.vwall(x - 1, y0, h)
            out.append((x, ww))
        return out

    tops = split(1, y1 - 1, top)
    bots = split(y2 + 1, rows - y2 - 2, bottom)
    # One doorway per room, three tiles wide. Centred unless the caller says
    # otherwise: a door in the middle of a wall cuts the room into two slivers
    # either side of the lane it needs, which is fine in a hotel room and ruins
    # a classroom. Every location that does not ask keeps the centred door it
    # has always had.
    place = door_at or (lambda x, w, top_side: x + w // 2 - 1)
    for (x, w) in tops:
        g.fill(place(x, w, True), y1, 3, 1, 'D')
    for (x, w) in bots:
        g.fill(place(x, w, False), y2, 3, 1, 'D')

    furnish(tops, 1, y1 - 1, bots, y2 + 1, rows - y2 - 2, y1 + 1, corridor_rows)

    mid = y1 + corridor_rows // 2
    if exit_side == 'left':
        g.fill(0, mid - 1, 1, 3, 'X')
        g.drop(cols - 3, mid, '@', radius=99, box=True)
    else:
        g.fill(cols - 1, mid - 1, 1, 3, 'X')
        g.drop(2, mid, '@', radius=99, box=True)
    return tops, bots, y1, y2


def hall_plan(g, tier, plinth_cols, plinth_rows, back_rooms, furnish):
    """A big top-lit hall with a grid of display blocks, and a service band
    below it. Museums and shops: the value is out in the open, so crossing the
    floor is the whole problem."""
    cols, rows = g.cols, g.rows
    split_y = rows - max(8, rows // 3)
    g.hwall(1, split_y, cols - 2)

    # The hall's grid, centred, with aisles between.
    bw, bh, gap = 3, 3, 3
    total_w = plinth_cols * bw + (plinth_cols - 1) * gap
    total_h = plinth_rows * bh + (plinth_rows - 1) * gap
    x0 = (cols - total_w) // 2
    y0 = max(2, (split_y - total_h) // 2)
    blocks = []
    for r in range(plinth_rows):
        for c in range(plinth_cols):
            bx = x0 + c * (bw + gap)
            by = y0 + r * (bh + gap)
            g.fill(bx, by, bw, bh, 'P')
            blocks.append((bx, by))

    # The service band: back_rooms rooms across, each with a door into the hall.
    inner = cols - 2
    w = inner // back_rooms
    rooms = []
    for i in range(back_rooms):
        x = 1 + i * w
        ww = (inner - i * w) if i == back_rooms - 1 else w
        if i:
            g.vwall(x - 1, split_y + 1, rows - split_y - 2)
        g.fill(x + ww // 2 - 1, split_y, 3, 1, 'D')
        rooms.append((x, ww))

    furnish(blocks, rooms, split_y)

    # Out through the bottom, under the middle room.
    ex = rooms[len(rooms) // 2]
    g.fill(ex[0] + ex[1] // 2 - 1, rows - 1, 3, 1, 'X')
    g.drop(ex[0] + ex[1] // 2, rows - 4, '@', radius=99, box=True)
    return blocks, rooms, split_y


def warren_plan(g, tier, bands, per_band, furnish):
    """Bands of rooms stacked up the map, doors staggered so you weave rather
    than walk straight through. Flats, houses, mansions."""
    cols, rows = g.cols, g.rows
    band_h = (rows - 2 - (bands - 1)) // bands
    cells = []
    for b in range(bands):
        y = 1 + b * (band_h + 1)
        h = band_h if b < bands - 1 else rows - 1 - y
        if b:
            g.hwall(1, y - 1, cols - 2)
        inner = cols - 2
        w = inner // per_band
        row = []
        for i in range(per_band):
            x = 1 + i * w
            ww = (inner - i * w) if i == per_band - 1 else w
            if i:
                g.vwall(x - 1, y, h)
                # ...and a way through it. Without this the bands are only
                # joined top-to-bottom and the map is two separate towers that
                # never meet.
                dy = y + (h // 3 if (b + i) % 2 else 2 * h // 3) - 1
                g.fill(x - 1, max(y, min(y + h - 3, dy)), 1, 3, 'D')
            row.append((x, y, ww, h))
        # Doorways between this band and the one above, staggered left/right so
        # the route through the building is not a straight line.
        if b:
            for i, (x, _, ww, _) in enumerate(row):
                off = 2 if (b + i) % 2 else ww - 5
                g.fill(x + max(1, min(ww - 4, off)), y - 1, 3, 1, 'D')
        cells.append(row)
    furnish(cells)
    return cells


def open_plan(g, tier, islands, side_rooms, furnish):
    """One large space with furniture islands, and a couple of rooms off it.
    Penthouses: nowhere to hide, and the loot is spread across the floor."""
    cols, rows = g.cols, g.rows
    wall_x = cols - max(9, cols // 4)
    g.vwall(wall_x, 1, rows - 2)
    h = (rows - 2) // side_rooms
    rooms = []
    for i in range(side_rooms):
        y = 1 + i * h
        hh = h if i < side_rooms - 1 else rows - 1 - y
        if i:
            g.hwall(wall_x + 1, y - 1, cols - wall_x - 2)
        g.fill(wall_x, y + hh // 2 - 1, 1, 3, 'D')
        rooms.append((wall_x + 1, y, cols - wall_x - 2, hh))
    furnish(rooms, wall_x)
    g.fill(0, rows // 2 - 1, 1, 3, 'X')
    g.drop(wall_x - 3, rows - 4, '@', radius=99, box=True)
    return rooms, wall_x


def vault_plan(g, tier, layers, furnish):
    """Nested chambers with offset doors: the only high-security building shape
    that reads instantly from above. The prize is in the middle and there is one
    way in and out of each ring."""
    cols, rows = g.cols, g.rows
    # Five, not four: the outer band has to stay walkable past the guard's post,
    # and a three-tile band with a two-tile desk in it leaves a gap narrower
    # than the player is tall.
    step = 5
    rings = []
    for i in range(1, layers + 1):
        x, y = i * step, i * step
        w, h = cols - 2 * x, rows - 2 * y
        if w < 9 or h < 9:
            break
        g.box(x, y, w, h, '%')
        # The way through each ring turns a quarter each layer, so you work
        # round the vault rather than walking straight to the middle — but not
        # a full half-turn per ring, which made the walk longer than the level
        # was ever worth.
        # The outer ring opens near the way out and the strongroom opens on the
        # far side, so getting to the middle costs one crossing of the ring —
        # not a lap of it, which is what a quarter-turn per layer worked out to.
        if i % 2:
            g.fill(x + w // 2 - 1, y + h - 1, 3, 1, 'D')
        else:
            g.fill(x + w // 2 - 1, y, 3, 1, 'D')
        rings.append((x, y, w, h))
    furnish(rings)
    g.fill(cols // 2 - 1, rows - 1, 3, 1, 'X')
    g.drop(cols // 2, rows - 3, '@', radius=99, box=True)
    return rings


# ------------------------------------------------------------------- locations
# Each entry says what the building is made of, who is in it, and how it grows
# across the five levels.

# --- searchable furniture (the school, and nowhere else yet) ------------------
# How many pieces a tier makes searchable, and how many of those hold anything.
# The gap between the two is the mechanic: if every cabinet paid out there would
# be no decision to make, only a chore to finish.
TILE = 20                # world units per grid tile, mirrored from tuning.js

# The school's proximity curve and the noise numbers, mirrored from tuning.js so
# this tool can work out what a given cupboard would actually cost to open. It is
# the one duplication in here, and a test asserts the two still agree.
PROX_NEAR, PROX_FAR = 90.0, 560.0
PROX_NEAR_SCALE, PROX_FAR_SCALE = 3.0, 0.85
SEARCH_NOISE = {'table': 3, 'nightstand': 3, 'chest': 4, 'tvBench': 4,
                'sofa': 2, 'wardrobe': 5, 'bookshelf': 5, 'plinth': 6}
ITEM_NOISE = {'c': 3, 'w': 6, 'p': 8, 'k': 11, 'r': 13, 'm': 14, 't': 15,
              'n': 18, 'l': 22, 'v': 30, 'j': 16, 'd': 32, 'g': 38}

# The most one cupboard may cost. The meter holds 100, you arrive with some of it
# already spent, and you still have to walk away afterwards — so a single search
# that can run to eighty is not a risk, it is a trap. Sixty was the figure until
# the school got properly furnished and put a shelf within four tiles of the
# couch: at that range sixty is survivable on paper and not in play, and the
# test that opens the dearest cupboard on level five and then tries to leave is
# what caught it.
COST_CEILING = 52


# What the school multiplies noise by at this range. Same curve as rules.js.
def proximity(distance):
    if distance <= PROX_NEAR:
        return PROX_NEAR_SCALE
    if distance >= PROX_FAR:
        return PROX_FAR_SCALE
    t = (distance - PROX_NEAR) / (PROX_FAR - PROX_NEAR)
    return PROX_NEAR_SCALE + (PROX_FAR_SCALE - PROX_NEAR_SCALE) * (t * t * (3 - 2 * t))


TIER_STASHES = [6, 8, 10, 12, 14]
TIER_FILLED = [4, 6, 8, 9, 11]
# How much loot the school leaves lying about. The rest of what a level is worth
# is inside the furniture, which is the point: the school should not be a floor
# to be swept, it should be a building to be searched.
TIER_FLOOR = [3, 3, 4, 4, 5]
# (the one tempting thing, everything else) for each tier's floor
FLOOR_LOOT = [('p', 'c'), ('k', 'c'), ('r', 'w'), ('m', 'w'), ('v', 'w')]

# What turns up inside, worst first. A tier draws from the front of its own list
# and the best of them goes in the piece nearest Mr. Vrána — which is the whole
# point of level five: the good stuff is where you least want to be standing.
# Best first. Most of what a school level is worth is in here now, so these are
# the lists that decide what the place is actually worth turning over.
TIER_STASH_LOOT = [
    ['r', 'k', 'p', 'c'],
    ['m', 'r', 'k', 'p', 'w', 'c'],
    ['l', 'n', 't', 'm', 'r', 'k', 'p', 'w'],
    ['v', 'j', 'l', 'n', 't', 'm', 'r', 'k', 'p'],
    ['g', 'd', 'v', 'l', 'n', 'j', 't', 'm', 'r', 'k', 'p'],
]

# Furniture a person would actually open. Desks and cabinets yes; the couch the
# caretaker is asleep on, obviously not.
SEARCHABLE_STYLES = {'C': 'chest', 'B': 'bookshelf', 'W': 'wardrobe',
                     'T': 'table', 'V': 'tvBench'}
# Digits first, then the uppercase letters no other tile uses.
STASH_CHARS = '1234567890AFGHIJKLMQRUYZ'


def _blobs(g, chars):
    """Every connected run of one searchable character, as (char, cells)."""
    seen = set()
    out = []
    for y in range(g.rows):
        for x in range(g.cols):
            ch = g.g[y][x]
            if ch not in chars or (x, y) in seen:
                continue
            stack = [(x, y)]
            seen.add((x, y))
            cells = []
            while stack:
                cx, cy = stack.pop()
                cells.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if (nx, ny) in seen or not (0 <= nx < g.cols and 0 <= ny < g.rows):
                        continue
                    if g.g[ny][nx] == ch:
                        seen.add((nx, ny))
                        stack.append((nx, ny))
            out.append((ch, cells))
    return out


def thin_floor_loot(g, tier):
    """Take most of the loot off the school's floors.

    What is left is what section three of the brief asks visible loot to be:
    a few easy rewards to get you moving, and one thing worth crossing the map
    for. Everything else is now behind a cupboard door.
    """
    keep = TIER_FLOOR[tier]
    found = [(x, y, g.g[y][x]) for y in range(g.rows) for x in range(g.cols)
             if g.g[y][x] in LOOT_CHARS]
    if len(found) <= keep:
        return
    value = {'c': 10, 'w': 25, 'p': 30, 'k': 50, 'r': 65, 'm': 75, 't': 85,
             'n': 100, 'l': 120, 'v': 180, 'j': 90, 'd': 220, 'g': 300}
    # What the survivors become. One thing worth crossing the map for, and
    # small change everywhere else — visible loot is there to start you moving
    # and to point at rooms, not to be the level.
    tempting, petty = FLOOR_LOOT[tier]
    # Keep the single best one — the tempting thing out in the open — and then
    # spread the rest of the survivors across the map rather than leaving a
    # cluster in whichever room happened to come first.
    best = max(range(len(found)), key=lambda i: value.get(found[i][2], 0))
    kept = {best}
    rest = [i for i in range(len(found)) if i != best]
    rest.sort(key=lambda i: (found[i][1], found[i][0]))
    step = len(rest) / max(1, keep - 1)
    for k in range(keep - 1):
        kept.add(rest[min(len(rest) - 1, int(k * step))])
    for i, (x, y, _) in enumerate(found):
        if i not in kept:
            g.g[y][x] = '.'
        else:
            g.g[y][x] = tempting if i == best else petty


def make_searchable(g, tier):
    """Turn some of the school's furniture into things you can look inside.

    Returns the legend the level needs: digit -> {style, item}. Nothing else
    about the map changes — a searchable cabinet is the same cabinet, in the
    same place, blocking the same route.
    """
    # Where the game thinks he is: the centre of his couch across, and a
    # quarter of the way down it — tilemap.js puts a sleeper's head there, and
    # every distance in the school is measured from that point. Measuring from
    # the first 'E' tile instead put this tool seventy units out, which is
    # enough to slip a gold bar past the noise ceiling.
    cells = [(x, y) for y in range(g.rows) for x in range(g.cols) if g.g[y][x] == 'E']
    watcher = None
    if cells:
        xs = [c[0] for c in cells]
        ys = [c[1] for c in cells]
        watcher = ((min(xs) + (max(xs) - min(xs) + 1) / 2),
                   (min(ys) + (max(ys) - min(ys) + 1) * 0.26))

    # Only rectangular pieces. The game merges a character into maximal
    # rectangles and hangs the contents on the largest of them, so an L-shaped
    # bank of lockers would sit somewhere other than where this tool measured
    # its distance from — and the whole placement is built on that distance.
    # Requiring a rectangle makes the two agree by construction.
    def rectangular(blob):
        cells = blob[1]
        xs = [c[0] for c in cells]
        ys = [c[1] for c in cells]
        return len(cells) == (max(xs) - min(xs) + 1) * (max(ys) - min(ys) + 1)

    # ...and only pieces you can actually get to. A cupboard walled in behind
    # other furniture is a cupboard the player can see, walk around, and never
    # open, which reads as a bug rather than as a locked door. On a sparse map
    # this never came up; on a properly furnished one it comes up immediately.
    TILE = 20
    REACH = 34          # TUNING.locations.School.search.reach
    # Reachable from the spawn, at the resolution the game moves at — not
    # merely "there is floor beside it". A pocket of floor walled in behind
    # other furniture passes the second test and fails the first, and a
    # cupboard you can see but never open reads as a bug, not as a locked door.
    reached = [(gx * 4 + 2, gy * 4 + 2) for (gx, gy) in g._reached()]

    def openable(blob):
        cs = blob[1]
        x0 = min(c[0] for c in cs) * TILE
        y0 = min(c[1] for c in cs) * TILE
        x1 = (max(c[0] for c in cs) + 1) * TILE
        y1 = (max(c[1] for c in cs) + 1) * TILE
        for (px, py) in reached:
            if px < x0 - REACH or px > x1 + REACH: continue
            if py < y0 - REACH or py > y1 + REACH: continue
            dx = max(x0 - px, 0, px - x1)
            dy = max(y0 - py, 0, py - y1)
            if dx * dx + dy * dy <= REACH * REACH:
                return True
        return False

    blobs = [b for b in _blobs(g, SEARCHABLE_STYLES)
             if 2 <= len(b[1]) <= 24 and rectangular(b) and openable(b)]
    if not blobs:
        return {}

    # Measured the way the game measures it: from the centre of the piece, not
    # from the average of its tiles, which sit half a tile in.
    def centre(blob):
        cs = blob[1]
        xs = [c[0] for c in cs]
        ys = [c[1] for c in cs]
        return (min(xs) + (max(xs) - min(xs) + 1) / 2,
                min(ys) + (max(ys) - min(ys) + 1) / 2)

    def key(blob):
        cx, cy = centre(blob)
        far = ((cx - watcher[0]) ** 2 + (cy - watcher[1]) ** 2) ** 0.5 if watcher else 0
        return (far, cx, cy)

    def spread(blob):
        if not watcher:
            return 0.0
        cx, cy = centre(blob)
        return (((cx - watcher[0]) ** 2 + (cy - watcher[1]) ** 2) ** 0.5) * TILE

    blobs.sort(key=key)                   # nearest the caretaker first
    wanted = min(TIER_STASHES[tier], len(blobs), len(STASH_CHARS))
    # Spread the choices across the range rather than taking the nearest few:
    # a level where every searchable thing is in one room is not an exploration.
    step = len(blobs) / wanted
    chosen = [blobs[min(len(blobs) - 1, int(i * step))] for i in range(wanted)]

    loot = TIER_STASH_LOOT[tier]
    filled = min(TIER_FILLED[tier], wanted)
    distances = [spread(b) for b in chosen]

    # Where the best thing on the map goes. Not the very nearest piece: at the
    # top of the school's proximity curve a diamond costs more noise to lift
    # than the meter has room for, so it stops being a decision and becomes a
    # trap. PRIZE_AT is the distance where the curve has eased off enough that
    # taking it wakes him but does not lose the level outright — measured
    # against the same numbers the game reads, not picked by eye.
    contents = [None] * wanted
    # Each item goes in the riskiest cupboard it can go in without the search
    # costing more than the meter can absorb. Big prizes end up at middle
    # distance, small ones can sit right beside him, and the cupboards nearest
    # his couch mostly hold nothing — which is exactly the shape the mechanic
    # wants, and it falls out of the numbers rather than being placed by hand.
    free = sorted(range(wanted), key=lambda i: distances[i])   # nearest first
    for item in loot[:filled]:
        placed = None
        for i in free:
            style = SEARCHABLE_STYLES[chosen[i][0]]
            cost = (SEARCH_NOISE[style] + ITEM_NOISE[item]) * proximity(distances[i])
            if cost <= COST_CEILING:
                placed = i
                break
        if placed is None:
            # Nowhere on this map is far enough from him to open that quietly.
            # Better to leave it out than to hide something nobody can take.
            g.bad.append('no room for a %s within the noise ceiling' % item)
            continue
        contents[placed] = item
        free.remove(placed)

    legend = {}
    for i, (ch, cells) in enumerate(chosen):
        digit = STASH_CHARS[i]
        for (x, y) in cells:
            g.put(x, y, digit)
        legend[digit] = (SEARCHABLE_STYLES[ch], contents[i])
    return legend


def place_watcher(g, x, y, w, h, wide=6, tall=3):
    """The bed, desk or couch the level's person is on, centred in its room with
    room to walk round it. This is the one piece of furniture that can never be
    moved to open a route, so it has to be placed somewhere that does not need
    opening."""
    ww = max(3, min(wide, w - 6))
    hh = max(2, min(tall, h - 6))
    g.fill(x + (w - ww) // 2, y + 2, ww, hh, 'E')


def _rowsof(x, y, w, h, n):
    """n evenly spaced furniture slots down a room."""
    if n <= 0 or h < 6:
        return []
    gap = h // (n + 1)
    return [(x + 2, y + gap * (i + 1) - 1) for i in range(n)]


def apartment(g, tier):
    n = [2, 2, 3, 3, 3][tier]
    bands = [2, 3, 3, 4, 4][tier]

    def furnish(cells):
        placed = []
        for b, row in enumerate(cells):
            for i, (x, y, w, h) in enumerate(row):
                if b == 0 and i == 0:
                    g.fill(x + 1, y + 1, min(6, w - 3), min(5, h - 3), 'E')   # Dad's bed
                    g.fill(x + 1, y + h - 3, 2, 2, 'N')
                    continue
                kind = 'TSCWV'[(b * 3 + i) % 5]
                g.fill(x + 1, y + 1, max(3, w // 2), max(2, h // 3), kind)
                if h > 9:
                    g.fill(x + w - max(4, w // 3) - 1, y + h - max(3, h // 3) - 1,
                           max(3, w // 3), max(2, h // 4), 'CTB'[(b + i) % 3])
                if h > 11 and w > 10:
                    g.fill(x + w // 2 - 2, y + h // 2, 4, 2, ',')
                placed.append((x + w // 2, y + h // 2))
        scatter(g, tier, placed)
    warren_plan(g, tier, bands, n, furnish)
    g.fill(0, g.rows // 2 - 1, 1, 3, 'X')
    g.drop(g.cols - 3, g.rows - 3, '@', radius=99, box=True)


def house(g, tier):
    n = [2, 2, 2, 3, 3][tier]
    bands = [2, 2, 3, 3, 4][tier]

    def furnish(cells):
        placed = []
        for b, row in enumerate(cells):
            for i, (x, y, w, h) in enumerate(row):
                if b == 0 and i == 0:
                    g.fill(x + 2, y + 2, min(5, w - 4), min(3, h - 4), 'E')   # the armchair
                    g.fill(x + 1, y + 1, 2, 3, 'C')                           # the stove
                    continue
                g.fill(x + 1, y + 1, max(4, w // 2), max(2, h // 4), 'TSB'[(b + i) % 3])
                if h > 8:
                    g.fill(x + 1, y + h - 3, max(4, w // 2), 2, 'CW'[(b * 2 + i) % 2])
                if h > 10 and w > 9:
                    g.fill(x + w // 2 - 2, y + h // 2 - 1, 5, 3, ',')
                placed.append((x + w - 3, y + h // 2))
        scatter(g, tier, placed)
    warren_plan(g, tier, bands, n, furnish)
    g.fill(g.cols // 2 - 1, g.rows - 1, 1 + 2, 1, 'X')
    g.drop(g.cols // 2, g.rows - 4, '@', radius=99, box=True)


def _suite_furnish(g, tier, bed_char='S'):
    def furnish(tops, ty, th, bots, by, bh, cy, ch):
        placed = []
        for (rooms, y0, h) in ((tops, ty, th), (bots, by, bh)):
            for i, (x, w) in enumerate(rooms):
                # Bed one side, storage the other, aisle down the middle under
                # the door — the shape that stops a room sealing itself.
                g.fill(x + 1, y0 + 1, max(3, w // 3), max(3, h // 2 - 1), bed_char)
                g.fill(x + w - max(3, w // 4) - 1, y0 + 1, max(2, w // 4), max(2, h // 3), 'W')
                if h > 7:
                    g.fill(x + 1, y0 + h - 3, max(3, w // 3), 2, 'C')
                placed.append((x + w // 2, y0 + h - 2))
                placed.append((x + 2, y0 + h // 2))
        # Corridor units, kept clear of every door mouth.
        for i, (x, w) in enumerate(tops[:-1]):
            g.fill(x + w - 2, cy + 2, 2, max(1, ch - 4), 'C')
        scatter(g, tier, placed)
    return furnish


def hotel(g, tier):
    top = [2, 2, 3, 3, 4][tier]
    bottom = [1, 2, 2, 3, 3][tier]
    base = _suite_furnish(g, tier)

    def furnish(tops, ty, th, bots, by, bh, cy, ch):
        base(tops, ty, th, bots, by, bh, cy, ch)
        # Otakar's desk, in the middle of the corridor. The corridor is six
        # tiles deep, so there is a way past it whichever side you take.
        g.fill(g.cols // 2 - 3, cy + 2, 6, 2, 'E')
    corridor_plan(g, tier, top, bottom, furnish)


def school(g, tier):
    """Classrooms and a library off the top of a corridor, the hall and the
    staff end off the bottom — the same building as the hand-drawn fifth level,
    at whatever size the tier can carry.

    Every room is furnished from what it is *for*, and every piece is laid into
    the runs of floor left over once the doorway has been given a lane. Placing
    furniture first and carving the lane back out afterwards is what the earlier
    version did, and it is why whole rooms came back empty: the connectivity
    pass could only restore the route by deleting everything in it."""
    # Fewer, larger rooms than the other corridor buildings get. A classroom
    # has to hold rows of desks with aisles between them and still leave a lane
    # from the door; split the same width into four and every room becomes a
    # cupboard with a desk in it. The references are the same shape — a school
    # is a handful of big rooms, not a hotel's worth of small ones.
    top = [2, 2, 2, 3, 3][tier]
    bottom = [2, 2, 3, 3, 3][tier]

    def door_x(x, w, top_side):
        """Two tiles in from the room's near corner, alternating sides so the
        building does not read as a row of identical boxes. A door in a corner
        leaves the rest of the room as one block to furnish instead of two
        slivers either side of the lane."""
        return x + 2 if (x // 7) % 2 == 0 else x + w - 5

    def lane(x, w, top_side=True):
        """The columns kept clear for the room's doorway."""
        d = door_x(x, w, top_side)
        return (d - 1, d + 3)

    def pack(a, b, wide, gap=1):
        """Fill the run of columns a..b with pieces `wide` across, one clear
        tile between them, centred. Packing a block rather than stepping a
        uniform pitch across the whole room is the difference between four desks
        in a row and one: a pitch that has to clear the doorway loses every slot
        that straddles it, and in a room this size that is most of them."""
        span = b - a + 1
        n = (span + gap) // (wide + gap)
        if n <= 0:
            return []
        used = n * wide + (n - 1) * gap
        start = a + (span - used) // 2
        return [start + i * (wide + gap) for i in range(n)]

    def bands(x, w, keep, wide=2, gap=1):
        """Both runs of floor either side of the doorway's lane, each packed
        with pieces of its own."""
        # x + w - 2, not x + w - 1: the last column of a room is the partition
        # its neighbour is walled off by, and a cupboard written over it makes
        # the two rooms one.
        return (pack(x + 1, keep[0] - 1, wide, gap)
                + pack(keep[1] + 1, x + w - 2, wide, gap))

    def drop_spot(x, w, y, h):
        """Somewhere in this room to leave a coin. The doorway's lane, a few
        tiles in — the one strip of every room that is guaranteed clear, now
        that the rooms are furnished densely enough that the middle of one is
        usually a cupboard."""
        return (door_x(x, w, True) + 1, y + h // 2)

    def classroom(x, w, y, h, name, door_below):
        """Paired desks either side of a centre aisle, the teacher's desk at
        the front, cupboards along the back wall, a board on the front one."""
        keep = lane(x, w)
        # Leave the two rows nearest the corridor clear, so the aisle from the
        # door reaches the room rather than the back of a desk.
        rows = [r for r in range(y + 4, y + h, 4) if r + 1 <= y + h - 1]
        for r in rows:
            for xx in bands(x, w, keep):
                g.fill(xx, r, 2, 2, 'T')
        front = y + 1 if door_below else y + h - 2
        for i, xx in enumerate(bands(x, w, keep, wide=4)):
            g.fill(xx, front, 4, min(2, h - 2), 'T' if i == 0 else 'C')
        g.deco('board', x + 1, (y - 1) if door_below else (y + h), w - 2, 1)
        g.deco('bin', x + w - 2, front)
        g.deco('desklamp', x + 2, front + 1)
        g.deco('floor', x, y, w, h, 'boards')
        g.deco('sign', x + w // 2 - 1, y + h if door_below else y - 1, 3, 1, name)
        return drop_spot(x, w, y, h)

    def library(x, w, y, h, door_below):
        """Stacks with aisles you can walk down and a table to read at."""
        keep = lane(x, w)
        tall = max(2, min(h - 6, h // 2))
        for xx in bands(x, w, keep, wide=2, gap=2):
            g.fill(xx, y + 1, 2, tall, 'B')
        # A table to read at, and a counter by the door. Stacks alone leave a
        # library reading as a warehouse.
        for xx in bands(x, w, keep, wide=5)[:1]:
            g.fill(xx, y + tall + 3, 5, 2, 'T')
        for xx in bands(x, w, keep, wide=3)[-1:]:
            if h > 9:
                g.fill(xx, y + h - 3, 3, 2, 'C')
        g.deco('floor', x, y, w, h, 'carpet')
        g.deco('lamp', x + w // 2, y + h // 2)
        g.deco('plant', x + w - 2, y + h - 2)
        g.deco('sign', x + w // 2 - 1, y + h if door_below else y - 1, 3, 1, 'Library')
        return drop_spot(x, w, y, h)

    def gym(x, w, y, h, door_above):
        """Benching round the edges and a floor left clear in the middle. A
        hall is mostly nothing, and filling it would make it a store room."""
        g.fill(x + 1, y + 2, 2, max(2, h - 4), 'S')
        g.fill(x + w - 3, y + 2, 2, max(2, h - 4), 'S')
        keep = lane(x, w)
        for xx in bands(x, w, keep, wide=4):
            if xx > x + 2 and xx + 4 < x + w - 2:
                g.fill(xx, y + h - 3, 4, 2, 'S')
        # Floor before court: the list is painted in order, and a floor laid
        # after its markings covers them up.
        g.deco('floor', x, y, w, h, 'parquet')
        g.deco('court', x + 3, y + 1, max(3, w - 6), max(3, h - 3))
        g.deco('sign', x + w // 2 - 1, y - 1 if door_above else y + h, 3, 1, 'Gymnasium')
        return drop_spot(x, w, y, h)

    def store(x, w, y, h):
        """The densest room on the map, because a caretaker's store is:
        shelving, cupboards under it, and boxes wherever they will go."""
        keep = lane(x, w)
        for i, xx in enumerate(bands(x, w, keep, wide=3)):
            g.fill(xx, y + 1, 3, min(3, h - 4), 'B' if i % 2 == 0 else 'C')
        if h > 9:
            for i, xx in enumerate(bands(x, w, keep, wide=3)):
                g.fill(xx, y + 5, 3, 2, 'C' if i % 2 else 'B')
        for i, xx in enumerate(bands(x, w, keep, wide=3)):
            if y + h - 3 > y + 7:
                g.fill(xx, y + h - 3, 3, 2, 'C' if i % 2 == 0 else 'W')
        g.deco('floor', x, y, w, h, 'concrete')
        g.deco('tools', x + 1, y + h // 2, 2, 1)
        g.deco('sign', x + w // 2 - 1, y - 1, 3, 1, 'Store')
        return drop_spot(x, w, y, h)

    def staff(x, w, y, h):
        """Mr. Vrána's couch, a table people sit at, a fridge, pigeonholes."""
        place_watcher(g, x, y, w, h, 7, 3)
        keep = lane(x, w)
        spots = bands(x, w, keep, wide=3)
        for i, xx in enumerate(spots):
            g.fill(xx, y + 1, 3, 2, 'T' if i == 0 else 'C')
        if h > 8 and spots:
            g.fill(spots[0], y + h - 3, 2, 2, 'W')          # the fridge
            for xx in spots[1:]:
                g.fill(xx, y + h - 3, 3, 2, 'C')            # pigeonholes
        if h > 11:
            for xx in bands(x, w, keep, wide=4)[:1]:
                g.fill(xx, y + 5, 4, 2, 'T')                # the table they sit at
        g.deco('floor', x, y, w, h, 'carpet')
        g.deco('kettle', x + w - 3, y + 3)
        g.deco('lamp', x + w // 2, y + h - 4)
        g.deco('sign', x + w // 2 - 1, y - 1, 3, 1, 'Staff Room')
        return drop_spot(x, w, y, h)

    def furnish(tops, ty, th, bots, by, bh, cy, ch):
        placed = []
        for i, (x, w) in enumerate(tops):
            if i == len(tops) - 1 and w >= 10 and th >= 7:
                placed.append(library(x, w, ty, th, True))
            else:
                placed.append(classroom(x, w, ty, th, chr(ord('A') + i), True))
        for i, (x, w) in enumerate(bots):
            if i == len(bots) - 1:
                placed.append(staff(x, w, by, bh))
            elif i == 0 and w >= 10:
                placed.append(gym(x, w, by, bh, True))
            else:
                placed.append(store(x, w, by, bh))
        # Lockers down both corridor walls, into the runs between the doorways.
        for (x, w) in tops:
            keep = lane(x, w)
            for xx in bands(x, w, keep, wide=4):
                g.fill(xx, cy, 4, 2, 'C')
        # Along the lower wall, one bank deep and hard against it. Anything
        # further out leaves a single tile between the lockers and the wall,
        # and a single tile is not a gap — the player is taller than one — so
        # the whole bottom half of the building stops being reachable.
        for (x, w) in bots:
            if ch >= 5:
                keep = lane(x, w)
                for xx in bands(x, w, keep, wide=4):
                    g.fill(xx, cy + ch - 1, 4, 1, 'C')
        g.deco('floor', 1, cy, g.cols - 2, ch, 'tiles')
        g.deco('notice', g.cols // 2 - 2, cy, 4, 1)
        g.deco('clock', g.cols - 7, cy)
        scatter(g, tier, placed, box=True)

    corridor_plan(g, tier, top, bottom, furnish, door_at=door_x)


def hospital(g, tier):
    top = [2, 3, 3, 4, 4][tier]
    bottom = [1, 2, 3, 3, 4][tier]

    def furnish(tops, ty, th, bots, by, bh, cy, ch):
        placed = []
        for i, (x, w) in enumerate(tops):     # wards: beds down one wall
            if i == len(tops) - 1:
                # The staff room, with Dr. Marek out on the couch.
                place_watcher(g, x, ty, w, th, 7, 3)
                placed.append((x + 2, ty + th - 3))
                continue
            g.fill(x + 1, ty + 1, max(3, w // 3), max(4, th // 2), 'S')
            if th > 9:
                g.fill(x + 1, ty + th - 4, max(3, w // 3), 3, 'S')
            g.fill(x + w - 3, ty + 2, 2, 2, 'N')
            placed.append((x + w - 3, ty + th - 3))
        for (x, w) in bots:                   # dispensary, stores, treatment
            g.fill(x + 1, by + 1, max(4, w - 5), 2, 'B')
            if bh > 7:
                g.fill(x + 1, by + bh - 4, max(4, w - 5), 2, 'C')
            placed.append((x + w - 3, by + bh // 2))
        g.fill(g.cols // 2 - 2, cy + 2, 5, max(1, ch - 4), 'T')   # nurses' station
        scatter(g, tier, placed)

    corridor_plan(g, tier, top, bottom, furnish)


def office(g, tier):
    top = [1, 2, 2, 3, 3][tier]
    bottom = [1, 2, 3, 3, 4][tier]

    def furnish(tops, ty, th, bots, by, bh, cy, ch):
        placed = []
        for i, (x, w) in enumerate(tops):     # open plan: banks of desks
            if i == 0:
                # The boss's office — Mr. Halas, face down on the report.
                place_watcher(g, x, ty, w, th, 6, 3)
                placed.append((x + 2, ty + th - 3))
                continue
            for r in range(max(2, th // 4)):
                yy = ty + 1 + r * 3
                if yy + 2 >= ty + th:
                    break
                g.fill(x + 1, yy, max(4, w // 3), 2, 'T')
                if w > 12:
                    g.fill(x + w - max(4, w // 3) - 1, yy, max(4, w // 3), 2, 'T')
            placed.append((x + w // 2, ty + th - 2))
        for (x, w) in bots:                   # meeting rooms and the lounge
            g.fill(x + 2, by + 2, max(4, w - 6), max(3, bh // 2 - 1), 'T')
            if bh > 8:
                g.fill(x + 1, by + bh - 3, max(4, w // 2), 2, 'S')
            placed.append((x + w - 3, by + bh - 3))
        for (x, w) in tops[:-1]:
            g.fill(x + w - 3, cy + 2, 3, max(1, ch - 4), 'C')
        scatter(g, tier, placed)

    corridor_plan(g, tier, top, bottom, furnish)


def museum(g, tier):
    pc = [2, 2, 3, 3, 4][tier]
    pr = [2, 2, 2, 3, 3][tier]
    back = [2, 2, 3, 3, 3][tier]

    def furnish(blocks, rooms, split_y):
        placed = []
        # Right beside each case, not a room away from it.
        for (bx, by) in blocks:
            placed.append((bx + 1, by + 3))
        for i, (x, w) in enumerate(rooms):
            if i == 0:
                # The guard room: Bruno's monitor desk, and space around it.
                place_watcher(g, x, split_y + 1, w, g.rows - split_y - 2, 5, 3)
                placed.append((x + 2, g.rows - 4))
                continue
            g.fill(x + 1, split_y + 2, max(3, w // 3), 2, 'B')
            placed.append((x + w - 3, split_y + 3))
        # Benches down the sides of the hall.
        g.fill(1, 3, 2, max(3, split_y // 3), 'S')
        g.fill(g.cols - 3, 3, 2, max(3, split_y // 3), 'S')
        scatter(g, tier, placed)

    hall_plan(g, tier, pc, pr, back, furnish)


def shop(g, tier):
    pc = [3, 3, 4, 4, 5][tier]
    pr = [1, 2, 2, 2, 3][tier]
    back = [2, 2, 2, 3, 3][tier]

    def furnish(blocks, rooms, split_y):
        placed = []
        for (bx, by) in blocks:
            placed.append((bx + 1, by + 3))
        for i, (x, w) in enumerate(rooms):
            if i == 0:
                # The night manager's counter.
                place_watcher(g, x, split_y + 1, w, g.rows - split_y - 2, 5, 3)
                placed.append((x + 2, g.rows - 4))
                continue
            g.fill(x + 1, split_y + 2, max(4, w - 5), 2, 'B')       # stockroom shelving
            placed.append((x + w - 3, split_y + 3))
        # Shelving runs down both side walls: a shop is a corridor of goods.
        g.fill(1, 2, 2, max(4, split_y - 4), 'B')
        g.fill(g.cols - 3, 2, 2, max(4, split_y - 4), 'B')
        scatter(g, tier, placed)

    hall_plan(g, tier, pc, pr, back, furnish)


def mansion(g, tier):
    n = [2, 2, 3, 3, 3][tier]
    bands = [2, 3, 3, 3, 4][tier]

    def furnish(cells):
        placed = []
        for b, row in enumerate(cells):
            for i, (x, y, w, h) in enumerate(row):
                if b == 0 and i == 0:
                    g.fill(x + 2, y + 2, min(7, w - 4), 3, 'E')    # the guard's desk
                    continue
                g.fill(x + 1, y + 1, max(4, w // 2), max(2, h // 4), 'STB'[(b + i) % 3])
                if h > 8:
                    g.fill(x + w - max(4, w // 3) - 1, y + h - 4, max(3, w // 3), 3, 'WC'[(b + i) % 2])
                if h > 10 and w > 10:
                    g.fill(x + w // 2 - 3, y + h // 2 - 1, 6, 3, ',')
                placed.append((x + 2, y + h - 3))
                if w > 12:
                    placed.append((x + w - 4, y + 2))
        scatter(g, tier, placed)
    warren_plan(g, tier, bands, n, furnish)
    g.fill(g.cols // 2 - 1, g.rows - 1, 3, 1, 'X')
    g.drop(g.cols // 2, g.rows - 4, '@', radius=99, box=True)


def penthouse(g, tier):
    side = [1, 2, 2, 3, 3][tier]
    islands = [2, 3, 4, 5, 6][tier]

    def furnish(rooms, wall_x):
        placed = []
        for i, (x, y, w, h) in enumerate(rooms):
            if i == 0:
                g.fill(x + 1, y + 1, min(6, w - 2), min(5, h - 3), 'E')   # the owner's bed
            else:
                g.fill(x + 1, y + 1, max(3, w - 3), max(2, h // 3), 'WC'[i % 2])
            placed.append((x + w // 2, y + h - 3))
        # Islands of furniture across the open floor.
        for k in range(islands):
            ix = 3 + (k % 3) * ((wall_x - 6) // 3)
            iy = 3 + (k // 3) * ((g.rows - 8) // 2)
            g.fill(ix, iy, min(6, wall_x - ix - 3), 3, 'STV'[k % 3])
            placed.append((ix + 1, iy + 5))
        g.fill(wall_x // 2 - 3, g.rows // 2 - 2, 7, 4, ',')
        scatter(g, tier, placed)
    open_plan(g, tier, islands, side, furnish)


def vault(g, tier):
    # One ring and a strongroom, growing to two. Three concentric rings with the
    # way through turning each time made the walk longer than the level was
    # worth — the vault should be tense, not a marathon.
    layers = [1, 1, 1, 2, 2][tier]

    def furnish(rings):
        placed = []
        for i, (x, y, w, h) in enumerate(rings):
            # Racks of deposit boxes down the long walls of each ring, and a
            # cabinet at each end of the far side. Everything is inset well
            # clear of the ring walls: a rack in the corner leaves a one-tile
            # channel round the outside of the next ring and the layer stops
            # being walkable.
            g.fill(x + 4, y + h - 5, 3, 3, 'C')
            g.fill(x + w - 7, y + h - 5, 3, 3, 'C')
            for k in range(max(1, (h - 12) // 6)):
                ry = y + 4 + k * 6
                if ry + 3 >= y + h - 5:
                    break
                g.fill(x + 2, ry, 2, 3, 'B')
                g.fill(x + w - 4, ry, 2, 3, 'B')
                placed.append((x + 5, ry + 1))
                placed.append((x + w - 6, ry + 1))
            placed.append((x + w // 2, y + h - 2))
        if rings:
            x, y, w, h = rings[-1]
            g.fill(x + w // 2 - 2, y + h // 2 - 1, 4, 3, 'P')   # the prize, in the middle
            placed.append((x + w // 2 + 4, y + h // 2))
        # The guard's post is in a corner of the outer band. In the middle he
        # would cover every ring at once, which is not a stealth level — from
        # the corner the far side of the vault is genuinely out of his range.
        g.fill(2, 1, 6, 2, 'E')
        scatter(g, tier, placed)
    vault_plan(g, tier, layers, furnish)


# name, theme, watcher, seated, grammar, and which hand-drawn map is its level 5
LOCATIONS = [
    ('Apartment', 'apartment',  'dad',        False, apartment, 'flat'),
    ('House',     'cottage',    'grandpa',    False, house,     'cottage'),
    ('Hotel',     'hotelfloor', 'porter',     True,  hotel,     'hotel'),
    ('Office',    'officefloor','worker',     True,  office,    'office'),
    ('School',    'school',     'caretaker',  False, school,    'school'),
    ('Hospital',  'hospital',   'doctor',     False, hospital,  'hospital'),
    ('Museum',    'museum',     'nightguard', True,  museum,    'museum'),
    ('Mansion',   'mansion',    'security',   True,  mansion,   None),
    ('Penthouse', 'penthouse',  'owner',      False, penthouse, None),
    ('Shop',      'shop',       'shopkeeper', True,  shop,      None),
    ('Vault',     'vault',      'vaultguard', True,  vault,     None),
]

HANDDRAWN = {
    'flat': draft.flat, 'cottage': draft.cottage, 'hotel': draft.hotel,
    'office': draft.office, 'school': draft.school, 'hospital': draft.hospital,
    'museum': draft.museum,
}


def build():
    out = []
    lid = 1
    problems = []
    for (name, theme, watcher, seated, grammar, handdrawn) in LOCATIONS:
        for tier in range(5):
            if tier == 4 and handdrawn:
                g = HANDDRAWN[handdrawn]()
                g.clear_landings(); draft.clear_exit(g)
                promote_prize(g, tier)
                g.clear_freebies()
                if g.open_until_connected() is None:
                    g.open_by_removal()
            else:
                cols, rows = TIER_SIZE[tier]
                g = shell(cols, rows)
                grammar(g, tier)
                g.clear_landings()
                draft.clear_exit(g)
                top_up_loot(g, tier)
                promote_prize(g, tier)
                g.clear_freebies()
                depth = g.open_until_connected()
                if depth is None and not g.open_by_removal():
                    problems.append(f'{name} L{tier + 1}: no route to everything')
            # Searchable furniture is the school's alone for now, and it runs
            # last: it only rewrites characters in place, so nothing it does can
            # move a wall or close a route that the passes above just opened.
            if name == 'School':
                thin_floor_loot(g, tier)
            stashes = make_searchable(g, tier) if name == 'School' else {}
            if g.bad:
                problems.append(f'{name} L{tier + 1}: {g.bad}')
            base = SIGHT_BASE.get(watcher, 0)
            out.append(dict(id=lid, name=name, theme=theme, watcher=watcher,
                            seated=seated, tier=tier + 1, location=name,
                            sight=round(base * TIER_SIGHT[tier]) if base else 0,
                            stashes=stashes,
                            decor=list(getattr(g, 'decor', [])),
                            rows=[''.join(r) for r in g.g]))
            lid += 1
    for p in problems:
        print('!! ' + p, file=sys.stderr)
    return out, problems


LOOT_LEGEND = """// One legend for all the maps, so a `d` is a diamond wherever you see it.
const LOOT = {
  c: 'coin', w: 'wallet', p: 'phone', k: 'headphones', r: 'ring',
  m: 'camera', t: 'tablet', n: 'console', l: 'laptop', v: 'tv',
  j: 'jewel', d: 'diamond', g: 'goldbar'
};"""

HEADER = '''// Eleven locations of five levels each, generated by tools/build-locations.py
// and committed here as fixed grids. Nothing about a level is decided at
// runtime: level 27 is the same building every time anyone plays it.
//
// Within a location the five levels share a theme, a furniture vocabulary and a
// person, and grow from a couple of rooms to a floor of a building. The seven
// hand-drawn floorplans are not generated — they are recreations of reference
// drawings, and each is the hardest level of its location, at exactly the size
// it was drawn.
//
// See tilemap.js for what every character means. The short version:
//   #  outer wall    %  interior wall   O  window    D  doorway
//   .  floor         ,  rug (silent)    ~  creaky boards
//   E  the sleeper's own furniture      @  spawn     X  the way out
//   T table   S sofa/bed   W wardrobe   N nightstand   V tv bench
//   C cabinet   B shelving   P display plinth        anything else: loot
import { tileLevel } from './tilemap.js';

'''


def stash_legend(stashes):
    """The `search` block for a level: which digit is which cabinet, and what
    is inside it. Written out in full rather than as a count, so the map file
    stays the one place that says what a level contains."""
    if not stashes:
        return ''
    lines = []
    for digit in STASH_CHARS:
        if digit not in stashes:
            continue
        style, item = stashes[digit]
        lines.append("      '%s': { style: '%s', item: %s }," %
                     (digit, style, ("'%s'" % item) if item else 'null'))
    return '    search: {\n' + '\n'.join(lines) + '\n    },\n'


def decor_block(decor):
    """The room dressing: blackboards, notice boards, floor treatments, signs.
    None of it is collidable and none of it is in the grid, because the grid is
    the building and everything in it is something you can walk into."""
    if not decor:
        return ''
    lines = []
    for (kind, x, y, w, h, tag) in decor:
        parts = ["kind: '%s'" % kind, 'x: %d' % x, 'y: %d' % y]
        if w != 1:
            parts.append('w: %d' % w)
        if h != 1:
            parts.append('h: %d' % h)
        if tag:
            parts.append("tag: '%s'" % tag)
        lines.append('      { %s },' % ', '.join(parts))
    return '    decor: [\n' + '\n'.join(lines) + '\n    ],\n'


def emit(levels, clocks=None):
    parts = []
    for lv in levels:
        clock = (clocks or {}).get(lv['id'])
        rows = '\n'.join("      '" + r + "'," for r in lv['rows'])
        title = lv['name']
        quoted = ('"%s"' % title) if "'" in title else ("'%s'" % title)
        parts.append(
            "  // ---- %d. %s %d/5 %s\n"
            "  tileLevel({\n"
            "    id: %d,\n"
            "    name: %s,\n"
            "    location: %s,\n"
            "    tier: %d,\n"
            "    theme: '%s',\n"
            "    watcher: '%s',\n"
            "    seated: %s,\n"
            "%s"
            "%s"
            "%s"
            "%s"
            "    legend: LOOT,\n"
            "    tiles: [\n%s\n    ]\n"
            "  }),"
            % (lv['id'], title, lv['tier'], '-' * 20, lv['id'], quoted, quoted,
               lv['tier'], lv['theme'], lv['watcher'], str(lv['seated']).lower(),
               ('    sight: %d,\n' % lv['sight']) if lv['sight'] else '',
               ('    clock: %d,\n' % clock) if clock else '',
               stash_legend(lv.get('stashes')),
               decor_block(lv.get('decor')), rows))
    return HEADER + LOOT_LEGEND + '\n\nexport const FLOORPLANS = [\n' + '\n'.join(parts).rstrip(',') + '\n];\n'


if __name__ == '__main__':
    levels, problems = build()
    clocks = {}
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'maps.js')
    if os.path.exists(path + '.clocks'):
        import json
        clocks = {int(k): v for k, v in json.load(open(path + '.clocks')).items()}
    open(path, 'w').write(emit(levels, clocks))
    print(f'wrote {len(levels)} levels ({len(problems)} problems)')
