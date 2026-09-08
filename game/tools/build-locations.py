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

# Which locations offer somewhere to hide, how many places, and what the player
# actually climbs into.
#
# All of them now. Hiding was tried in one building first, which is how the rest
# of this game was built, and it works — so the question stops being whether a
# corridor should offer somewhere to be when he is coming and becomes what you
# get into when it does. That is the second half of each entry: the tile
# character of the piece that has to be standing squarely in front of the spot.
# The school's is 'C', which its theme paints as a bank of lockers. Elsewhere the
# same character is a cupboard and 'W' is a wardrobe, and both are things a
# person fits inside; a bookshelf and a table are not, so neither is listed.
HIDES = {
    'Apartment': (2, 'WC'),
    'House':     (2, 'WC'),
    'Hotel':     (2, 'WC'),
    'Office':    (2, 'C'),
    'School':    (2, 'C'),
    'Hospital':  (2, 'C'),
    'Museum':    (2, 'C'),
    'Mansion':   (2, 'WC'),
    'Penthouse': (2, 'WC'),
    'Shop':      (2, 'WC'),
    'Vault':     (2, 'C'),
}
# ...and what each building has lying about on it, and how much of it.
#
# All eleven now. Standing on it costs noise, and how much depends on what it
# is — paper is nearly free, a bag left across a doorway is most of a dropped
# phone — which is a decision the player gets to make about their route, and
# there is no reason a hotel corridor should not offer it. What differs is the
# vocabulary and the sweeping. A shop floor is packaging, a museum is swept
# every night and has almost nothing on it, and nobody drops a crisp packet in
# a vault. The school's entry is what the school already had, so its five
# levels come out of this tool unchanged.
LITTER_AT = {
    'Apartment': (('paper', 'clutter', 'bag'), 0.7),
    'House':     (('paper', 'clutter'), 0.6),
    'Hotel':     (('paper', 'plastic', 'bag'), 0.7),
    'Office':    (('paper', 'clutter', 'plastic'), 0.9),
    'School':    (('paper', 'clutter', 'plastic', 'bag'), 1.0),
    'Hospital':  (('paper', 'plastic'), 0.8),
    # The museum is swept every night, and it has to be: its top floor is the
    # one level in the game that an efficient run cannot finish with four
    # things underfoot on it. Three it can.
    'Museum':    (('paper', 'clutter'), 0.2),
    'Mansion':   (('paper', 'clutter'), 0.5),
    'Penthouse': (('clutter',), 0.4),
    'Shop':      (('paper', 'plastic', 'bag'), 1.0),
    'Vault':     (('clutter',), 0.3),
}
# ...and which get their furniture pushed flush against the walls behind it.
# All of them. A cabinet standing one tile proud of the wall behind it is the
# single loudest tell that a room was generated rather than built, and the pass
# that fixes it puts every move back if the map came off worse for it.
SNUG = {'Apartment', 'House', 'Hotel', 'Office', 'School', 'Hospital',
        'Museum', 'Mansion', 'Penthouse', 'Shop', 'Vault'}

# What each building has bolted to it, and how close together its lights are.
#
# Every location is lit, because a building the map does not light is a
# building the player cannot read — before this the school had a fitting every
# few metres and the other ten had between none and a dozen for a whole floor.
# What differs is the vocabulary and the spacing. An institution puts a light
# every seven tiles and an extinguisher by the fire door; a home lights itself
# more sparsely and would not thank you for the extinguisher. The school's own
# entry is the pair it already had, so its five levels come out unchanged.
FITTINGS = {
    'Apartment': (('radiator',), 9),
    'House':     (('radiator',), 9),
    'Hotel':     (('radiator', 'extinguisher'), 8),
    'Office':    (('radiator', 'extinguisher'), 7),
    'School':    (('radiator', 'extinguisher'), 7),
    'Hospital':  (('radiator', 'extinguisher'), 7),
    'Museum':    (('extinguisher',), 8),
    'Mansion':   (('radiator',), 9),
    'Penthouse': ((), 9),
    'Shop':      (('extinguisher',), 8),
    'Vault':     (('extinguisher',), 8),
}


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
    # Only where the player can actually get to. A free, standable tile is not
    # the same thing as a reachable one — a pocket of floor behind a bank of
    # display cases passes every local test and fails the only one that matters,
    # and the repair pass answers an unreachable coin by bulldozing whatever is
    # nearest to it. That is how a museum lost the middle row of its hall.
    reached = {(gx * 4 // TILE, gy * 4 // TILE) for (gx, gy) in g._reached()}
    # Walk the map on a coarse lattice so the extra loot ends up spread through
    # the building instead of clustered in whichever room is emptiest.
    for step in (5, 4, 3):
        for y in range(2, g.rows - 2, step):
            for x in range(2, g.cols - 2, step):
                if len(items()) >= target: return
                if g.g[y][x] != '.': continue
                if g._blocked(x * TILE + TILE / 2, y * TILE + TILE / 2): continue
                if (x, y) not in reached: continue
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


def scatter(g, tier, spots, box=True):
    """Drop loot at roughly these tiles, snapping each onto real floor.

    `box` asks for floor the player can actually stand on rather than merely a
    free tile, and it is the default because every one of these rooms is packed
    tightly enough to leave one-tile gaps somewhere: a gap that narrow looks
    like floor and is not, and a coin dropped into one used to be answered by
    the repair pass bulldozing the room around it."""
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
        d = place(x, w, True)
        g.fill(d, y1, 3, 1, 'D')
        # The lane, reserved before a stick of furniture is placed: three tiles
        # of doorway and one either side, run right through the room behind it
        # and out into the corridor in front of it. Everything the grammar lays
        # down afterwards goes into what is left, which is what stops the
        # connectivity repair from having to empty the room to open the door.
        g.lane(d, 1, 3, y1 - 1)
        g.lane(d, y1 + 1, 3, corridor_rows)
    for (x, w) in bots:
        d = place(x, w, False)
        g.fill(d, y2, 3, 1, 'D')
        g.lane(d, y2 + 1, 3, rows - y2 - 2)
        g.lane(d, y1 + 1, 3, corridor_rows)

    # ...and the way out gets one too, the length of the corridor: a wardrobe
    # parked between you and the door is the one obstruction the repair passes
    # cannot reason about, because from the far side it looks like a wall.
    mid = y1 + corridor_rows // 2
    g.lane(1, mid - 1, cols - 2, 3)

    furnish(tops, 1, y1 - 1, bots, y2 + 1, rows - y2 - 2, y1 + 1, corridor_rows)

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
            # Filled rather than laid: the plinth grid *is* the hall, and a
            # case nudged a tile aside to clear a lane merges into its
            # neighbour and stops being a case of its own.
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
        d = x + ww // 2 - 1
        g.fill(d, split_y, 3, 1, 'D')
        g.lane(d, split_y + 1, 3, rows - split_y - 2)
        g.lane(d, split_y - 3, 3, 3)
        rooms.append((x, ww))

    # The way out, and the lane up to it through the middle back room.
    ex = rooms[len(rooms) // 2]
    g.lane(ex[0] + ex[1] // 2 - 1, split_y, 3, rows - split_y - 1)

    furnish(blocks, rooms, split_y)

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
                dy = max(y, min(y + h - 3, dy))
                g.fill(x - 1, dy, 1, 3, 'D')
                # Three tiles deep either side of the opening, no more: a lane
                # driven the full width of a room this small leaves nowhere for
                # a bed, and an empty room is the thing this is here to stop.
                g.lane(x - 4, dy, 7, 3)
            row.append((x, y, ww, h))
        # Doorways between this band and the one above, staggered left/right so
        # the route through the building is not a straight line.
        if b:
            for i, (x, _, ww, _) in enumerate(row):
                off = 2 if (b + i) % 2 else ww - 5
                dx = x + max(1, min(ww - 4, off))
                g.fill(dx, y - 1, 3, 1, 'D')
                g.lane(dx, y - 4, 3, 7)
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
        dy = y + hh // 2 - 1
        g.fill(wall_x, dy, 1, 3, 'D')
        g.lane(wall_x - 4, dy, 7, 3)
        rooms.append((wall_x + 1, y, cols - wall_x - 2, hh))
    g.lane(1, rows // 2 - 1, wall_x, 3)
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
            g.lane(x + w // 2 - 1, y + h - 1 - step, 3, step * 2 + 1)
        else:
            g.fill(x + w // 2 - 1, y, 3, 1, 'D')
            g.lane(x + w // 2 - 1, y - step, 3, step * 2 + 1)
        rings.append((x, y, w, h))
    g.lane(cols // 2 - 1, rows - 1 - step, 3, step + 1)
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
# Digits first, then the uppercase letters no other tile uses — which is fewer
# than it was. H is a hiding place, and Y and Z became a tree and a hedge when
# the buildings went outdoors; a stash allocated one of those characters is not
# a cupboard with a diamond in it, it is a diamond inside a tree.
STASH_CHARS = '1234567890AFGIJKLMQRU'


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


# How much of a location's furniture is worth opening, as a share of the
# school's. A museum puts its value on plinths in the middle of the hall and a
# shop puts it on the shelves — the point of those buildings is that the loot is
# out where you have to cross the floor for it, so hiding all of it in the
# staff-room cupboards would be turning them into the school. The residential
# and office buildings are the other way about: a flat is drawers.
STASH_SHARE = {
    'Museum': 0.80, 'Shop': 0.85, 'Vault': 0.85, 'Penthouse': 0.90,
}
# The most of a location's furniture that may be searchable. A vault is racks
# and cabinets and nothing else, so the general cap would make almost every
# piece in it something to open — which is the chore the mechanic is supposed
# not to be.
SEARCH_CAP = {'Vault': 0.55}
# ...and how much is left lying about, the same way round.
FLOOR_SHARE = {
    'Museum': 2.4, 'Shop': 1.6, 'Vault': 1.9, 'Penthouse': 1.2,
}


def thin_floor_loot(g, tier, location='School'):
    """Take most of the loot off the floors.

    What is left is what section three of the brief asks visible loot to be:
    a few easy rewards to get you moving, and one thing worth crossing the map
    for. Everything else is now behind a cupboard door.
    """
    keep = max(2, round(TIER_FLOOR[tier] * FLOOR_SHARE.get(location, 1.0)))
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
    # What a museum is *for* is the things on the plinths, so those survive the
    # thinning first: a gallery whose display cases are empty and whose value is
    # all in the staff-room drawers is not a museum, it is a school with
    # sculpture in it.
    # Only what the player can actually get to. The thinning used to delete the
    # odd stranded coin by luck rather than by rule, and choosing survivors on
    # purpose exposed that: a coin behind a bank of display cases is not worth
    # visiting however many plinths it is beside.
    reached = {(gx * 4 // 20, gy * 4 // 20) for (gx, gy) in g._reached()}

    def cases(i):
        x, y, _ = found[i]
        return {(xx, yy)
                for yy in range(max(0, y - 3), min(g.rows, y + 4))
                for xx in range(max(0, x - 3), min(g.cols, x + 4))
                if g.g[yy][xx] == 'P'}
    here = [i for i in range(len(found)) if (found[i][0], found[i][1]) in reached]
    if not here:
        here = list(range(len(found)))
    best = max(here, key=lambda i: value.get(found[i][2], 0))
    on_show = {i for i in here if cases(i)}
    kept = {best} | on_show
    if len(kept) > keep:
        # More things on show than the level is allowed to leave lying about, so
        # which ones survive matters. Taking them in map order takes them in
        # clumps: two coins either side of one case, and the four cases at the
        # far end of the hall with nothing beside them at all. Spread instead —
        # each survivor beside a case none of the others is beside — so what the
        # thinning leaves is a hall where every case is worth the walk.
        spread, covered = [best], cases(best)
        pool = sorted(on_show - {best})
        while len(spread) < keep and pool:
            pick = max(pool, key=lambda i: (len(cases(i) - covered), -found[i][1], -found[i][0]))
            spread.append(pick)
            covered |= cases(pick)
            pool.remove(pick)
        kept = set(spread)
    rest = [i for i in range(len(found)) if i not in kept]
    rest.sort(key=lambda i: (found[i][1], found[i][0]))
    want = max(0, keep - len(kept))
    step = len(rest) / max(1, want) if want else 0
    for k in range(want):
        if not rest:
            break
        kept.add(rest[min(len(rest) - 1, int(k * step))])
    for i, (x, y, _) in enumerate(found):
        if i not in kept:
            g.g[y][x] = '.'
        else:
            g.g[y][x] = tempting if i == best else petty


def make_searchable(g, tier, location='School'):
    # The school's rooms already put their furniture down as discrete pieces —
    # a bank of lockers, a cupboard, a desk — so its blobs are taken whole and
    # the maps it already ships are untouched by the carving below.
    carve = location != 'School'
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

    # A whole run of shelving is not a cupboard.
    #
    # The game hangs what is inside a searchable piece on the largest rectangle
    # its character merges into, so a piece has to *be* a rectangle for this
    # tool's distance to be the game's distance. Several of the grammars lay
    # furniture down in continuous runs — a bank of desks across an office, a
    # wall of shelving down a shop — and those come out as one forty-cell blob
    # that is either not a rectangle or far too big to be a thing you open.
    #
    # So a piece is carved out of the run instead: one desk in the bank, one
    # section of the shelving, given its own character. The rest stays ordinary
    # furniture. Which piece is chosen is the one furthest from the person
    # listening, because that is the one worth putting anything in.
    def carved(blob):
        ch, cells = blob
        if 2 <= len(cells) <= 24 and rectangular(blob):
            return blob
        if not carve:
            return None
        have = set(cells)
        for (pw, ph) in ((4, 3), (3, 3), (3, 2), (2, 3), (4, 2), (2, 2),
                         (3, 1), (1, 3), (2, 1), (1, 2)):
            best, far = None, -1
            for (x, y) in cells:
                if any((x + dx, y + dy) not in have
                       for dx in range(pw) for dy in range(ph)):
                    continue
                cx, cy = x + pw / 2, y + ph / 2
                d = ((cx - watcher[0]) ** 2 + (cy - watcher[1]) ** 2) if watcher else 0
                if d > far:
                    far, best = d, (x, y)
            if best:
                bx, by = best
                return (ch, [(bx + dx, by + dy) for dx in range(pw) for dy in range(ph)])
        return None

    blobs = [p for p in (carved(b) for b in _blobs(g, SEARCHABLE_STYLES))
             if p and openable(p)]
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
    # ...and never most of the room. A cupboard worth opening is only worth
    # noticing if the furniture around it is furniture, so at most three pieces
    # in five may be something you can look inside.
    wanted = min(max(2, round(TIER_STASHES[tier] * STASH_SHARE.get(location, 1.0))),
                 len(blobs), len(STASH_CHARS))
    if carve:
        # Where pieces are carved out of runs, nearly every blob is a candidate
        # and the cap has to bite; the school lays its furniture down as
        # discrete pieces already, and most of them are not cupboards.
        wanted = min(wanted, max(4, int(len(blobs) * SEARCH_CAP.get(location, 0.65))))
    # Spread the choices across the range rather than taking the nearest few:
    # a level where every searchable thing is in one room is not an exploration.
    step = len(blobs) / wanted
    chosen = [blobs[min(len(blobs) - 1, int(i * step))] for i in range(wanted)]

    loot = TIER_STASH_LOOT[tier]
    filled = min(max(1, round(TIER_FILLED[tier] * STASH_SHARE.get(location, 1.0))), wanted)
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


# --- dressing the rooms ------------------------------------------------------
# None of this collides with anything. It is the layer between "there is a
# cabinet here" and "this is a stockroom": the floor treatment, the sign over
# the door, the bin in the corner, the clock on the corridor wall. The room
# grammar is the only thing that knows a room is a ward rather than a store
# cupboard, so it is the only thing that can say what belongs on its walls.
def dress(g, x, y, w, h, tag, sign=None, door=None, above=True, props=()):
    g.deco('floor', x, y, w, h, tag)
    if sign is not None and door is not None:
        g.deco('sign', door, y - 1 if above else y + h, 3, 1, sign)
    for item in props:
        kind, px, py = item[0], item[1], item[2]
        g.deco(kind, min(g.cols - 1, max(0, px)), min(g.rows - 1, max(0, py)))


def corner_props(x, y, w, h, kinds):
    """A prop in each spare corner of a room, in the order given."""
    spots = [(x + 1, y + 1), (x + w - 2, y + 1), (x + 1, y + h - 2), (x + w - 2, y + h - 2)]
    return [(k, spots[i % 4][0], spots[i % 4][1]) for i, k in enumerate(kinds)]


# The seven hand-drawn floorplans are recreations of reference drawings and
# have no room grammar behind them, so nothing knows which of their rooms is a
# ward and which is a store cupboard — and they were the only levels in the game
# with nothing on their walls. This is the general answer: find the quiet
# corners, and put something in them. It is less than a room grammar can do and
# far more than nothing.
CORNER_PROPS = ['plant', 'bin', 'lamp', 'plant', 'bin']

# What a hand-drawn building's floor is made of. One patch under the whole
# thing, inserted ahead of everything else so any room dressing that does exist
# still lands on top of it.
HAND_FLOOR = {
    'apartment': 'boards', 'cottage': 'boards', 'hotelfloor': 'carpet',
    'officefloor': 'carpet', 'school': 'tiles', 'hospital': 'tiles',
    'museum': 'tiles',
}


def floor_under(g, theme):
    tag = HAND_FLOOR.get(theme)
    if tag:
        g.decor.insert(0, ('floor', 1, 1, g.cols - 2, g.rows - 2, tag))


def dress_corners(g, every=3):
    """Props in the corners of a hand-drawn building: wherever two walls meet
    around a tile of open floor, and never in a doorway's approach."""
    put = 0
    spots = []
    for y in range(2, g.rows - 2):
        for x in range(2, g.cols - 2):
            if g.g[y][x] != '.' or (x, y) in g.keep:
                continue
            walls = sum(1 for (dx, dy) in ((1, 0), (-1, 0), (0, 1), (0, -1))
                        if g.g[y + dy][x + dx] in '#%')
            if walls < 2:
                continue
            if any(g.g[y + dy][x + dx] == 'D'
                   for dy in range(-2, 3) for dx in range(-2, 3)):
                continue
            spots.append((x, y))
    for i, (x, y) in enumerate(spots):
        if i % every:
            continue
        if any(max(abs(x - px), abs(y - py)) < 3 for (px, py) in
               [(d[1], d[2]) for d in g.decor if d[0] in ('plant', 'bin', 'lamp')]):
            continue
        g.deco(CORNER_PROPS[put % len(CORNER_PROPS)], x, y)
        put += 1
    return put


def place_watcher(g, x, y, w, h, wide=6, tall=3):
    """The bed, desk or couch the level's person is on, centred in its room with
    room to walk round it. This is the one piece of furniture that can never be
    moved to open a route, so it has to be placed somewhere that does not need
    opening."""
    ww = max(3, min(wide, w - 6))
    hh = max(2, min(tall, h - 6))
    # The one piece that has to exist: without it the level has nobody in it and
    # the tile reader throws. If every position in the room is spoken for, it
    # goes down anyway and the repair passes sort out the consequences.
    if not g.must(x + (w - ww) // 2, y + 2, ww, hh, 'E'):
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

    # What each room of a flat is, in the order the bands are laid out: the
    # bedroom Dad is asleep in first, then the rooms a flat actually has.
    # Naming them is what turns a grid of rectangles with furniture in it into
    # somewhere a person lives.
    ROOMS = [('Living room', 'boards', 'V'), ('Kitchen', 'tiles', 'C'),
             ('Study', 'carpet', 'T'), ('Spare room', 'carpet', 'W'),
             ('Dining room', 'boards', 'T'), ('Hall', 'boards', 'B')]

    def furnish(cells):
        placed = []
        for b, row in enumerate(cells):
            for i, (x, y, w, h) in enumerate(row):
                if b == 0 and i == 0:
                    g.must(x + 1, y + 1, min(6, w - 3), min(5, h - 3), 'E')   # Dad's bed
                    g.lay(x + 1, y + h - 3, 2, 2, 'N')
                    g.lay(x + w - 4, y + 1, 3, 2, 'W')
                    dress(g, x, y, w, h, 'carpet',
                          props=[('lamp', x + 3, y + 3)] + corner_props(x, y, w, h, ['plant']))
                    placed.append((x + w - 3, y + h - 3))
                    continue
                name, tag, extra = ROOMS[(b * 3 + i - 1) % len(ROOMS)]
                kind = 'TSCWV'[(b * 3 + i) % 5]
                g.lay(x + 1, y + 1, max(3, w // 2), max(2, h // 3), kind)
                if h > 7:
                    g.lay(x + w - max(4, w // 3) - 1, y + h - max(3, h // 3) - 1,
                          max(3, w // 3), max(2, h // 4), 'CTB'[(b + i) % 3])
                # A third and fourth piece. Two things in a room is a diagram;
                # four is somewhere a person keeps their things — and it is what
                # gives the search system anything to work with, because a
                # cupboard is only worth noticing among furniture that is not.
                g.lay(x + w - 4, y + 1, 3, 2, extra)
                g.lay(x + w - 3, y + h // 2, 2, 2, 'NC'[(b + i) % 2])
                if h > 11 and w > 10:
                    g.lay(x + w // 2 - 2, y + h // 2, 4, 2, ',')
                dress(g, x, y, w, h, tag,
                      props=corner_props(x, y, w, h, ['plant', 'bin', 'lamp'][:(b + i) % 3 + 1]))
                if name == 'Kitchen':
                    g.deco('kettle', x + 1, y + 2)
                placed.append((x + w // 2, y + h // 2))
                placed.append((x + 2, y + h - 2))
        scatter(g, tier, placed)
    # The way out, reserved before anything is furnished. Three tiles of doorway
    # need two rows of standing room in front of them, and a sofa laid along the
    # wall beside the door leaves one — which reads as a way out and is not.
    g.lane(1, g.rows // 2 - 2, 4, 5)
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
                    g.must(x + 2, y + 2, min(5, w - 4), min(3, h - 4), 'E')   # the armchair
                    g.lay(x + 1, y + 1, 2, 3, 'C')                            # the stove
                    g.lay(x + w - 4, y + h - 3, 3, 2, 'B')
                    dress(g, x, y, w, h, 'boards',
                          props=[('lamp', x + 3, y + 4), ('kettle', x + 1, y + 4)])
                    placed.append((x + w - 3, y + 2))
                    continue
                g.lay(x + 1, y + 1, max(4, w // 2), max(2, h // 4), 'TSB'[(b + i) % 3])
                if h > 7:
                    g.lay(x + 1, y + h - 3, max(4, w // 2), 2, 'CW'[(b * 2 + i) % 2])
                g.lay(x + w - 4, y + 2, 3, 2, 'CWB'[(b + i) % 3])
                if h > 10 and w > 9:
                    g.lay(x + w // 2 - 2, y + h // 2 - 1, 5, 3, ',')
                dress(g, x, y, w, h, 'boards' if (b + i) % 2 else 'carpet',
                      props=corner_props(x, y, w, h, ['plant', 'lamp', 'bin'][:(b + i) % 3 + 1]))
                placed.append((x + w - 3, y + h // 2))
                placed.append((x + 2, y + 2))
        scatter(g, tier, placed)
    g.lane(g.cols // 2 - 2, g.rows - 5, 5, 4)
    warren_plan(g, tier, bands, n, furnish)
    g.fill(g.cols // 2 - 1, g.rows - 1, 1 + 2, 1, 'X')
    g.drop(g.cols // 2, g.rows - 4, '@', radius=99, box=True)


def _suite_furnish(g, tier, bed_char='S'):
    def furnish(tops, ty, th, bots, by, bh, cy, ch):
        placed = []
        room = 0
        for (rooms, y0, h) in ((tops, ty, th), (bots, by, bh)):
            for i, (x, w) in enumerate(rooms):
                # Bed one side, storage the other, aisle down the middle under
                # the door — the shape that stops a room sealing itself.
                g.lay(x + 1, y0 + 1, max(3, w // 3), max(3, h // 2 - 1), bed_char)
                g.lay(x + w - max(3, w // 4) - 1, y0 + 1, max(2, w // 4), max(2, h // 3), 'W')
                if h > 7:
                    g.lay(x + 1, y0 + h - 3, max(3, w // 3), 2, 'C')
                # A writing desk and a bedside table: a hotel room with a bed
                # and a wardrobe in it is a diagram of a hotel room.
                g.lay(x + w - 4, y0 + h - 3, 3, 2, 'T')
                g.lay(x + 1 + max(3, w // 3), y0 + 1, 2, 2, 'N')
                room += 1
                dress(g, x, y0, w, h, 'carpet',
                      props=[('lamp', x + w - 3, y0 + 2), ('bin', x + 1, y0 + h - 1)])
                placed.append((x + w // 2, y0 + h - 2))
                placed.append((x + 2, y0 + h // 2))
        # Corridor units, kept clear of every door mouth.
        for i, (x, w) in enumerate(tops[:-1]):
            g.lay(x + w - 2, cy + 2, 2, max(1, ch - 4), 'C')
        # The corridor itself: carpet, a clock, a fire notice, a plant at each
        # end. A corridor is the part of a hotel you actually walk down.
        g.deco('floor', 1, cy, g.cols - 2, ch, 'carpet')
        g.deco('clock', g.cols // 4, cy)
        g.deco('notice', g.cols // 2 + 4, cy, 4, 1)
        g.deco('plant', 2, cy + ch - 1)
        g.deco('plant', g.cols - 3, cy + ch - 1)
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
        g.must(g.cols // 2 - 3, cy + 2, 6, 2, 'E')
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
                g.lay(xx, r, 2, 2, 'T')
        front = y + 1 if door_below else y + h - 2
        for i, xx in enumerate(bands(x, w, keep, wide=4)):
            g.lay(xx, front, 4, min(2, h - 2), 'T' if i == 0 else 'C')
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
            g.lay(xx, y + 1, 2, tall, 'B')
        # A table to read at, and a counter by the door. Stacks alone leave a
        # library reading as a warehouse.
        for xx in bands(x, w, keep, wide=5)[:1]:
            g.lay(xx, y + tall + 3, 5, 2, 'T')
        for xx in bands(x, w, keep, wide=3)[-1:]:
            if h > 9:
                g.lay(xx, y + h - 3, 3, 2, 'C')
        g.deco('floor', x, y, w, h, 'carpet')
        g.deco('lamp', x + w // 2, y + h // 2)
        g.deco('plant', x + w - 2, y + h - 2)
        g.deco('sign', x + w // 2 - 1, y + h if door_below else y - 1, 3, 1, 'Library')
        return drop_spot(x, w, y, h)

    def gym(x, w, y, h, door_above):
        """Benching round the edges and a floor left clear in the middle. A
        hall is mostly nothing, and filling it would make it a store room."""
        g.lay(x + 1, y + 2, 2, max(2, h - 4), 'S')
        g.lay(x + w - 3, y + 2, 2, max(2, h - 4), 'S')
        keep = lane(x, w)
        for xx in bands(x, w, keep, wide=4):
            if xx > x + 2 and xx + 4 < x + w - 2:
                g.lay(xx, y + h - 3, 4, 2, 'S')
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
            g.lay(xx, y + 1, 3, min(3, h - 4), 'B' if i % 2 == 0 else 'C')
        if h > 9:
            for i, xx in enumerate(bands(x, w, keep, wide=3)):
                g.lay(xx, y + 5, 3, 2, 'C' if i % 2 else 'B')
        for i, xx in enumerate(bands(x, w, keep, wide=3)):
            if y + h - 3 > y + 7:
                g.lay(xx, y + h - 3, 3, 2, 'C' if i % 2 == 0 else 'W')
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
            g.lay(xx, y + 1, 3, 2, 'T' if i == 0 else 'C')
        if h > 8 and spots:
            g.lay(spots[0], y + h - 3, 2, 2, 'W')          # the fridge
            for xx in spots[1:]:
                g.lay(xx, y + h - 3, 3, 2, 'C')            # pigeonholes
        if h > 11:
            for xx in bands(x, w, keep, wide=4)[:1]:
                g.lay(xx, y + 5, 4, 2, 'T')                # the table they sit at
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
                g.lay(xx, cy, 4, 2, 'C')
        # Along the lower wall, one bank deep and hard against it. Anything
        # further out leaves a single tile between the lockers and the wall,
        # and a single tile is not a gap — the player is taller than one — so
        # the whole bottom half of the building stops being reachable.
        for (x, w) in bots:
            if ch >= 5:
                keep = lane(x, w)
                for xx in bands(x, w, keep, wide=4):
                    g.lay(xx, cy + ch - 1, 4, 1, 'C')
        g.deco('floor', 1, cy, g.cols - 2, ch, 'tiles')
        g.deco('notice', g.cols // 2 - 2, cy, 4, 1)
        g.deco('clock', g.cols - 7, cy)
        scatter(g, tier, placed, box=True)

    corridor_plan(g, tier, top, bottom, furnish, door_at=door_x)


def hospital(g, tier):
    top = [2, 3, 3, 4, 4][tier]
    bottom = [2, 2, 3, 3, 4][tier]

    def furnish(tops, ty, th, bots, by, bh, cy, ch):
        placed = []
        for i, (x, w) in enumerate(tops):     # wards: beds down one wall
            if i == len(tops) - 1:
                # The staff room, with Dr. Marek out on the couch.
                place_watcher(g, x, ty, w, th, 7, 3)
                placed.append((x + 2, ty + th - 3))
                continue
            g.lay(x + 1, ty + 1, max(3, w // 3), max(4, th // 2), 'S')
            if th > 9:
                g.lay(x + 1, ty + th - 4, max(3, w // 3), 3, 'S')
            g.lay(x + w - 3, ty + 2, 2, 2, 'N')
            g.lay(x + w - 4, ty + th - 3, 3, 2, 'C')     # the ward's own cabinet
            dress(g, x, ty, w, th, 'tiles', 'Ward %d' % (i + 1), None,
                  props=[('bin', x + 1, ty + th - 1), ('plant', x + w - 2, ty + 1)])
            placed.append((x + w - 3, ty + th - 3))
        for j, (x, w) in enumerate(bots):     # dispensary, stores, treatment
            g.lay(x + 1, by + 1, max(4, w - 5), 2, 'B')
            if bh > 7:
                g.lay(x + 1, by + bh - 4, max(4, w - 5), 2, 'C')
            g.lay(x + w - 4, by + 2, 3, 2, 'C')
            dress(g, x, by, w, bh, 'tiles',
                  props=[('tools', x + 2, by + bh - 2), ('bin', x + w - 2, by + bh - 2)])
            placed.append((x + w - 3, by + bh // 2))
        g.lay(g.cols // 2 - 2, cy + 2, 5, max(1, ch - 4), 'T')   # nurses' station
        g.deco('floor', 1, cy, g.cols - 2, ch, 'tiles')
        g.deco('clock', 3, cy)
        g.deco('notice', g.cols - 8, cy, 4, 1)
        scatter(g, tier, placed)

    corridor_plan(g, tier, top, bottom, furnish)


def office(g, tier):
    top = [2, 2, 3, 3, 3][tier]
    bottom = [2, 2, 3, 3, 4][tier]

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
                g.lay(x + 1, yy, max(4, w // 3), 2, 'T')
                if w > 12:
                    g.lay(x + w - max(4, w // 3) - 1, yy, max(4, w // 3), 2, 'T')
            # Filing down the back wall of every open-plan bay.
            g.lay(x + 1, ty + th - 3, max(3, w // 3), 2, 'C')
            dress(g, x, ty, w, th, 'carpet', 'Open plan', None,
                  props=[('plant', x + w - 2, ty + 1), ('bin', x + 1, ty + th - 1),
                         ('desklamp', x + 2, ty + 2)])
            placed.append((x + w // 2, ty + th - 2))
        for j, (x, w) in enumerate(bots):     # meeting rooms and the lounge
            g.lay(x + 2, by + 2, max(4, w - 6), max(3, bh // 2 - 1), 'T')
            if bh > 8:
                g.lay(x + 1, by + bh - 3, max(4, w // 2), 2, 'S')
            g.lay(x + w - 4, by + bh - 3, 3, 2, 'C')
            dress(g, x, by, w, bh, 'carpet', ['Meeting', 'Boardroom', 'Lounge'][j % 3], None,
                  props=[('plant', x + 1, by + 1), ('bin', x + w - 2, by + bh - 1)])
            placed.append((x + w - 3, by + bh - 3))
        for (x, w) in tops[:-1]:
            g.lay(x + w - 3, cy + 2, 3, max(1, ch - 4), 'C')
        g.deco('floor', 1, cy, g.cols - 2, ch, 'tiles')
        g.deco('clock', 4, cy)
        g.deco('notice', g.cols // 2, cy, 4, 1)
        g.deco('plant', g.cols - 3, cy + ch - 1)
        scatter(g, tier, placed)

    corridor_plan(g, tier, top, bottom, furnish)


def museum(g, tier):
    pc = [2, 2, 3, 3, 4][tier]
    pr = [2, 2, 2, 3, 3][tier]
    back = [2, 2, 3, 3, 3][tier]

    def furnish(blocks, rooms, split_y):
        placed = []
        # In the aisle beside each case, not a room away from it: what a museum
        # is worth is out on the floor where you have to cross to reach it.
        for (bx, by) in blocks:
            placed.append((bx - 1, by + 1))
            placed.append((bx + 3, by + 1))
        back_h = g.rows - split_y - 2
        for i, (x, w) in enumerate(rooms):
            if i == 0:
                # The guard room: Bruno's monitor desk, and space around it.
                place_watcher(g, x, split_y + 1, w, back_h, 5, 3)
                g.lay(x + w - 4, split_y + back_h - 3, 3, 2, 'C')
                dress(g, x, split_y + 1, w, back_h, 'concrete', 'Security', None,
                      props=[('desklamp', x + 2, split_y + 3), ('kettle', x + 1, split_y + back_h - 2)])
                placed.append((x + 2, g.rows - 4))
                continue
            # Store rooms and the curators' office: the paperwork side of a
            # museum, and where anything not on show actually lives.
            g.lay(x + 1, split_y + 2, max(3, w // 3), 2, 'B')
            g.lay(x + w - 5, split_y + 2, 4, 2, 'C')
            g.lay(x + 1, split_y + back_h - 3, max(3, w // 3), 2, 'T')
            g.lay(x + w - 4, split_y + back_h - 3, 3, 2, 'C')
            dress(g, x, split_y + 1, w, back_h, 'concrete',
                  ['Store', 'Office', 'Archive'][i % 3], None,
                  props=[('bin', x + w - 2, split_y + back_h - 1), ('tools', x + 2, split_y + 4)])
            placed.append((x + w - 3, split_y + 3))
        # Benches down the sides of the hall, with a rope-line floor and the
        # gallery signage above it.
        g.lay(1, 3, 2, max(3, split_y // 3), 'S')
        g.lay(g.cols - 3, 3, 2, max(3, split_y // 3), 'S')
        g.deco('floor', 1, 1, g.cols - 2, split_y - 1, 'tiles')
        g.deco('poster', 4, 1, 5, 1)
        g.deco('poster', g.cols - 10, 1, 5, 1)
        g.deco('sign', g.cols // 2 - 1, 1, 3, 1, 'Gallery')
        g.deco('plant', 2, split_y - 2)
        g.deco('plant', g.cols - 3, split_y - 2)
        g.deco('lamp', g.cols // 2, split_y // 2)
        scatter(g, tier, placed)

    hall_plan(g, tier, pc, pr, back, furnish)


def shop(g, tier):
    pc = [3, 3, 4, 4, 5][tier]
    pr = [2, 2, 3, 3, 3][tier]
    back = [2, 3, 3, 3, 4][tier]

    def furnish(blocks, rooms, split_y):
        placed = []
        for (bx, by) in blocks:
            placed.append((bx + 1, by + 3))
        back_h = g.rows - split_y - 2
        for i, (x, w) in enumerate(rooms):
            if i == 0:
                # The night manager's counter.
                place_watcher(g, x, split_y + 1, w, back_h, 5, 3)
                g.lay(x + w - 4, split_y + back_h - 3, 3, 2, 'C')
                dress(g, x, split_y + 1, w, back_h, 'tiles', 'Counter', None,
                      props=[('kettle', x + 1, split_y + back_h - 2), ('desklamp', x + 2, split_y + 3)])
                placed.append((x + 2, g.rows - 4))
                continue
            g.lay(x + 1, split_y + 2, max(4, w - 5), 2, 'B')       # stockroom shelving
            g.lay(x + 1, split_y + back_h - 3, max(3, w // 3), 2, 'C')
            g.lay(x + w - 4, split_y + back_h - 3, 3, 2, 'W')
            dress(g, x, split_y + 1, w, back_h, 'concrete',
                  ['Stock', 'Back office'][i % 2], None,
                  props=[('tools', x + 2, split_y + 4), ('bin', x + w - 2, split_y + back_h - 1)])
            placed.append((x + w - 3, split_y + 3))
        # Shelving runs down both side walls: a shop is a corridor of goods.
        g.lay(1, 2, 2, max(4, split_y - 4), 'B')
        g.lay(g.cols - 3, 2, 2, max(4, split_y - 4), 'B')
        g.deco('floor', 1, 1, g.cols - 2, split_y - 1, 'tiles')
        g.deco('sign', g.cols // 2 - 1, 1, 3, 1, 'Sale')
        g.deco('poster', 3, 1, 4, 1)
        g.deco('poster', g.cols - 8, 1, 4, 1)
        g.deco('clock', g.cols // 2 + 5, 1)
        g.deco('bin', 2, split_y - 2)
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
                    g.must(x + 2, y + 2, min(7, w - 4), 3, 'E')    # the guard's desk
                    g.lay(x + 1, y + h - 3, 3, 2, 'C')
                    dress(g, x, y, w, h, 'parquet', 'Security', None,
                          props=[('desklamp', x + 3, y + 4), ('kettle', x + 1, y + h - 2)])
                    placed.append((x + w - 3, y + h - 3))
                    continue
                g.lay(x + 1, y + 1, max(4, w // 2), max(2, h // 4), 'STB'[(b + i) % 3])
                if h > 7:
                    g.lay(x + w - max(4, w // 3) - 1, y + h - 4, max(3, w // 3), 3, 'WC'[(b + i) % 2])
                g.lay(x + 1, y + h - 3, 3, 2, 'CB'[(b + i) % 2])
                if h > 10 and w > 10:
                    g.lay(x + w // 2 - 3, y + h // 2 - 1, 6, 3, ',')
                dress(g, x, y, w, h, 'parquet' if (b + i) % 2 else 'carpet',
                      props=corner_props(x, y, w, h, ['plant', 'lamp', 'bin'][:(b + i) % 3 + 1]))
                g.deco('poster', x + w // 2 - 2, y, 4, 1)
                placed.append((x + 2, y + h - 3))
                if w > 12:
                    placed.append((x + w - 4, y + 2))
        scatter(g, tier, placed)
    g.lane(g.cols // 2 - 2, g.rows - 5, 5, 4)
    warren_plan(g, tier, bands, n, furnish)
    g.fill(g.cols // 2 - 1, g.rows - 1, 3, 1, 'X')
    g.drop(g.cols // 2, g.rows - 4, '@', radius=99, box=True)


def penthouse(g, tier):
    side = [2, 2, 3, 3, 3][tier]
    islands = [3, 4, 5, 6, 7][tier]

    def furnish(rooms, wall_x):
        placed = []
        for i, (x, y, w, h) in enumerate(rooms):
            if i == 0:
                g.must(x + 1, y + 1, min(6, w - 2), min(5, h - 3), 'E')   # the owner's bed
                g.lay(x + 1, y + h - 3, 3, 2, 'N')
                dress(g, x, y, w, h, 'carpet', 'Bedroom', None,
                      props=[('lamp', x + 2, y + 2), ('plant', x + w - 2, y + h - 2)])
            else:
                g.lay(x + 1, y + 1, max(3, w - 3), max(2, h // 3), 'WC'[i % 2])
                g.lay(x + 1, y + h - 3, max(3, w // 2), 2, 'CT'[i % 2])
                dress(g, x, y, w, h, 'parquet',
                      ['Dressing room', 'Study', 'Store'][i % 3], None,
                      props=[('bin', x + w - 2, y + h - 1), ('plant', x + 1, y + 1)])
            placed.append((x + w // 2, y + h - 3))
        # Islands of furniture across the open floor.
        for k in range(islands):
            ix = 3 + (k % 3) * ((wall_x - 6) // 3)
            iy = 3 + (k // 3) * ((g.rows - 8) // 2)
            g.lay(ix, iy, min(6, wall_x - ix - 3), 3, 'STV'[k % 3])
            # ...each with something beside it, so the floor reads as arranged
            # rather than as three sofas dropped on a plan.
            g.lay(ix + min(6, wall_x - ix - 3) + 1, iy, 2, 2, 'NC'[k % 2])
            placed.append((ix + 1, iy + 5))
        g.lay(wall_x // 2 - 3, g.rows // 2 - 2, 7, 4, ',')
        g.deco('floor', 1, 1, wall_x - 1, g.rows - 2, 'parquet')
        g.deco('lamp', wall_x // 2, g.rows // 3)
        g.deco('lamp', wall_x // 3, 2 * g.rows // 3)
        g.deco('plant', 2, 2)
        g.deco('plant', wall_x - 2, g.rows - 3)
        g.deco('poster', wall_x // 2 - 2, 0, 5, 1)
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
            g.lay(x + 4, y + h - 5, 3, 3, 'C')
            g.lay(x + w - 7, y + h - 5, 3, 3, 'C')
            g.lay(x + 4, y + 2, 3, 2, 'C')
            g.lay(x + w - 7, y + 2, 3, 2, 'C')
            for k in range(max(2, (h - 12) // 6)):
                ry = y + 4 + k * 6
                if ry + 3 >= y + h - 5:
                    break
                # Deposit boxes: a solid block of steel doors, not a cupboard
                # you rummage in. Drawn as a plinth and, more to the point, not
                # something the search system will offer you — a vault whose
                # every rack opens is a chore with a guard in it.
                g.lay(x + 2, ry, 2, 3, 'P')
                g.lay(x + w - 4, ry, 2, 3, 'P')
                placed.append((x + 5, ry + 1))
                placed.append((x + w - 6, ry + 1))
            # Deposit boxes along the top and bottom of the band as well: a
            # vault is racks on every wall, and two racks in a ring is a
            # corridor with a cupboard in it.
            for k in range(max(1, (w - 20) // 8)):
                rx = x + 10 + k * 8
                if rx + 3 >= x + w - 10:
                    break
                g.lay(rx, y + 2, 3, 2, 'P')
                placed.append((rx + 1, y + 5))
            placed.append((x + w // 2, y + h - 2))
            # A clerk's table in each ring: somewhere a box gets opened, and one
            # more thing worth looking inside.
            g.lay(x + 4, y + 2, 3, 2, 'T')
            g.deco('floor', x + 1, y + 1, w - 2, h - 2, 'concrete')
            g.deco('sign', x + w // 2 - 1, y + 1, 3, 1, 'Level %d' % (i + 1))
            g.deco('lamp', x + w // 2, y + h // 2)
        if rings:
            x, y, w, h = rings[-1]
            g.lay(x + w // 2 - 2, y + h // 2 - 1, 4, 3, 'P')   # the prize, in the middle
            placed.append((x + w // 2 + 4, y + h // 2))
        # The guard's post is in a corner of the outer band. In the middle he
        # would cover every ring at once, which is not a stealth level — from
        # the corner the far side of the vault is genuinely out of his range.
        g.must(2, 1, 6, 2, 'E')
        g.lay(2, 4, 3, 2, 'C')
        g.deco('floor', 1, 1, g.cols - 2, g.rows - 2, 'concrete')
        g.deco('desklamp', 3, 3)
        g.deco('clock', 10, 1)
        g.deco('notice', g.cols - 8, 1, 4, 1)
        scatter(g, tier, placed)
    vault_plan(g, tier, layers, furnish)


# ------------------------------------------------------------------- grounds
# The outside of the building.
#
# A location is not an indoor rectangle with a way out cut into one wall; it is
# a place, and the place has surroundings. From part-way through each of the
# locations where it makes sense, the map is the building *and* its grounds: you
# come out of a corridor, through a door, into a yard, and the way out is a gate
# in the fence at the far side of it.
#
# The progression is the brief's: nothing at level one, a strip of yard at two,
# grounds down two sides at three, and a whole plot by five. Four locations get
# none at all — a hospital ward at night, a penthouse forty floors up, a shop
# with the shutters down and a vault underground do not have an outside you
# could walk into, and forcing one on them would be adding grass for the sake
# of grass.
#
# How many sides of the building are grounds, per tier. Nought is an indoor
# level; one is a yard along the side the way out is already on; four is a plot
# with the building standing in the middle of it.
YARDS = {
    'School':    [0, 1, 2, 3, 4],
    'Apartment': [0, 0, 1, 2, 3],
    'House':     [0, 1, 2, 3, 4],
    'Hotel':     [0, 0, 1, 2, 3],
    'Office':    [0, 0, 1, 2, 3],
    'Museum':    [0, 0, 1, 2, 4],
    'Mansion':   [0, 1, 2, 3, 4],
}
# ...and how deep, in tiles. Deep enough to be a place rather than a verge: a
# yard you cross in one step is the "patch of grass outside the building" the
# brief specifically says not to build.
YARD_DEEP = [0, 7, 7, 6, 6]

# What the grounds of each location are made of: the surface underfoot, what is
# planted in them, and the one thing that says which place this is.
GROUNDS = {
    'School':    dict(surface='grass', path='paving', props=('bike', 'bin'),
                      court=True, sign='Playground', shed='K'),
    'Apartment': dict(surface='grass', path='paving', props=('car', 'bin'),
                      sign='Parking', shed='C'),
    'House':     dict(surface='grass', path='gravel', props=('bin',),
                      sign='Garden', shed='B'),
    'Hotel':     dict(surface='grass', path='tarmac', props=('car',),
                      sign='Reception', shed='W'),
    'Office':    dict(surface='gravel', path='tarmac', props=('car', 'bin'),
                      sign='Car park', shed='C'),
    'Museum':    dict(surface='paving', path='paving', props=('bin',),
                      plinths=True, sign='Sculpture garden', shed='C'),
    'Mansion':   dict(surface='grass', path='gravel', props=('car',),
                      sign='Grounds', shed='W'),
}

# Which sides get grounds, and in what order they are added. The side the
# building's own way out is already cut into comes first, always: that door
# becomes the way into the yard, and a yard on the other side of the building
# from the only door is a yard nobody can reach.
SIDE_ORDER = {
    'left':   ['left', 'bottom', 'top', 'right'],
    'right':  ['right', 'bottom', 'top', 'left'],
    'bottom': ['bottom', 'left', 'right', 'top'],
    'top':    ['top', 'left', 'right', 'bottom'],
}


def find_exit(g):
    for y in range(g.rows):
        for x in range(g.cols):
            if g.g[y][x] == 'X':
                side = ('left' if x == 0 else 'right' if x == g.cols - 1
                        else 'top' if y == 0 else 'bottom')
                return (x, y, side)
    return None


def ground_bands(cols, rows, pad):
    """The margin round the building, as up to four rectangles, each knowing
    which way is out — planting goes against the fence, not across the middle of
    the yard."""
    l, t, r, b = pad
    out = []
    if l:
        out.append(((0, 0, l, rows), 'left'))
    if r:
        out.append(((cols - r, 0, r, rows), 'right'))
    if t:
        out.append(((l, 0, cols - l - r, t), 'top'))
    if b:
        out.append(((l, rows - b, cols - l - r, b), 'bottom'))
    return out


# Which corner of the building gets bitten out, per tier. This is what stops a
# location's five levels being the same rectangle at five sizes: with every
# stick of furniture removed, level three is an L, level four is a T with the
# bite in the middle of a side, and level five is a C. The bite becomes yard,
# so the building's shape and the shape of its grounds are the same decision
# seen from two sides.
NOTCHES = [None, None, 'ne', 'sw', 'nw']


def notch(g, bx, by, bw, bh, where):
    """Take a bite out of the building. Everything inside the bite becomes plot,
    and the outer wall closes round it.

    Refuses if the bite would swallow the person, the spawn or the way out —
    those are the three things a level cannot be built without, and moving them
    to suit a silhouette is the tail wagging the dog."""
    nw = max(6, bw // 3)
    nh = max(5, bh // 3)
    nx = bx if where in ('nw', 'sw') else bx + bw - nw
    ny = by if where in ('nw', 'ne') else by + bh - nh
    for y in range(ny, ny + nh):
        for x in range(nx, nx + nw):
            if g.g[y][x] in 'E@X':
                return False
    for y in range(ny, ny + nh):
        for x in range(nx, nx + nw):
            g.g[y][x] = '.'
            g.keep.discard((x, y))
    # Anything the demolished rooms had on their walls or floors goes with
    # them: a blackboard hanging in a car park is worse than no blackboard.
    g.decor = [d for d in g.decor
               if not (nx - 1 <= d[1] < nx + nw and ny - 1 <= d[2] < ny + nh)]
    # ...and the building's wall follows the new corner round.
    left = nx > bx
    top = ny > by
    if left:
        g.vwall(nx, ny, nh, '#')
    else:
        g.vwall(nx + nw - 1, ny, nh, '#')
    if top:
        g.hwall(nx, ny, nw, '#')
    else:
        g.hwall(nx, ny + nh - 1, nw, '#')
    # Whatever the demolition left standing against the new wall gets cleared
    # back a couple of tiles. A classroom cut down to a two-tile strip with its
    # desks jammed against a fresh wall reads as damage rather than as a
    # building of that shape, which is the opposite of the point.
    for y in range(max(0, ny - 2), min(g.rows, ny + nh + 2)):
        for x in range(max(0, nx - 2), min(g.cols, nx + nw + 2)):
            near_wall = (nx - 2 <= x < nx + nw + 2 and ny - 2 <= y < ny + nh + 2)
            inside_bite = nx <= x < nx + nw and ny <= y < ny + nh
            if near_wall and not inside_bite and g.g[y][x] in 'TSWNVCBP':
                g.g[y][x] = '.'
    return (nx, ny, nw, nh)


def reachable_yards(g, yards, pad):
    """Which of the building's missing corners you can actually walk into.

    A silhouette leaves the plot in pieces, and not every piece touches the
    grounds: a wing running out to the edge of an unpadded side can shut a strip
    of yard off behind it completely. Left as ground that is a courtyard with no
    way in, which is scenery pretending to be a place; left as mass it is simply
    the building being a bit thicker there, which is true and reads fine. So the
    parts that reach the grounds become yard and the rest stay solid."""
    l, t, r, b = pad
    inside = {}
    for i, (yx, yy, yw, yh) in enumerate(yards):
        for y in range(yy, yy + yh):
            for x in range(yx, yx + yw):
                inside[(x, y)] = i
    # Start from the padding ring, which is grounds by construction.
    stack = []
    for y in range(1, g.rows - 1):
        for x in range(1, g.cols - 1):
            if x < l or y < t or x >= g.cols - r or y >= g.rows - b:
                stack.append((x, y))
    seen, found = set(), set()
    while stack:
        x, y = stack.pop()
        if (x, y) in seen or not (0 < x < g.cols - 1 and 0 < y < g.rows - 1):
            continue
        here = inside.get((x, y))
        if here is None and g.g[y][x] in '#%+':
            continue
        seen.add((x, y))
        if here is not None:
            found.add(here)
        stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    return [rect for i, rect in enumerate(yards) if i in found]


def add_grounds(inner, sides, deep, flavour, loot, bite=True, voids=(), plant_yards=False):
    """Wrap a finished building in its own grounds, and move the way out into
    them. Returns the new grid."""
    found = find_exit(inner)
    if not found:
        return inner
    ex, ey, side = found
    pad = {'left': 0, 'top': 0, 'right': 0, 'bottom': 0}
    for name in SIDE_ORDER[side][:sides]:
        pad[name] = deep
    l, t, r, b = pad['left'], pad['top'], pad['right'], pad['bottom']
    g = draft.surround(inner, l, t, r, b)
    cols, rows = g.cols, g.rows
    style = GROUNDS[flavour]

    # The building's own way out becomes a door into the yard: you are not out
    # of the place until you are off the plot.
    door = (ex + l, ey + t)
    for y in range(rows):
        for x in range(cols):
            if g.g[y][x] == 'X':
                g.g[y][x] = 'D'

    # The plot's edge is a fence, not a wall — the grounds have to read as
    # outdoors, and you have to be able to see where the map ends.
    g.box(0, 0, cols, rows, '+')

    # The gate, straight out from the door, so the route reads at a glance:
    # room, corridor, door, yard, gate.
    if side == 'left':
        gate = (0, min(rows - 3, max(2, door[1])))
        g.fill(0, gate[1] - 1, 1, 3, 'X')
    elif side == 'right':
        gate = (cols - 1, min(rows - 3, max(2, door[1])))
        g.fill(cols - 1, gate[1] - 1, 1, 3, 'X')
    elif side == 'top':
        gate = (min(cols - 3, max(2, door[0])), 0)
        g.fill(gate[0] - 1, 0, 3, 1, 'X')
    else:
        gate = (min(cols - 3, max(2, door[0])), rows - 1)
        g.fill(gate[0] - 1, rows - 1, 3, 1, 'X')
    g.lane(max(1, gate[0] - 2), max(1, gate[1] - 2), 5, 5)
    g.lane(max(1, door[0] - 2), max(1, door[1] - 2), 5, 5)

    # The bite out of the building, taken before the grounds are dressed so the
    # yard grows into it: an L-shaped block with an L-shaped yard round it.
    where = NOTCHES[min(4, max(0, sides))] if bite else None
    bite = notch(g, l, t, inner.cols, inner.rows, where) if where else None

    # The plot the building does not stand on. Now that the silhouettes are
    # authored rather than bitten out, this is where an L's missing corner and a
    # U's courtyard actually live: the shape arrives as solid mass and leaves as
    # ground, so the building's outline and the shape of its yard are the same
    # decision seen from two sides. Kept a tile clear of the fence, which is
    # already drawn by the time we get here.
    yards = []
    for (vx, vy, vw, vh) in voids:
        x0, y0 = max(1, vx + l), max(1, vy + t)
        x1, y1 = min(cols - 1, vx + l + vw), min(rows - 1, vy + t + vh)
        if x1 <= x0 or y1 <= y0:
            continue
        yards.append((x0, y0, x1 - x0, y1 - y0))
    yards = reachable_yards(g, yards, (l, t, r, b))
    opened = set()
    for (yx, yy, yw, yh) in yards:
        for y in range(yy, yy + yh):
            for x in range(yx, yx + yw):
                g.g[y][x] = '.'
                g.keep.discard((x, y))
                opened.add((x, y))
    # ...and the building keeps its wall. A block cut out of a silhouette is
    # frequently the only thing standing between a room and the outside — a
    # school's gymnasium has no wall of its own along the corner the drawing
    # left out, because the corner *was* the wall. Opening it wholesale puts the
    # gym hall in the car park. So the tile where new ground meets old inside
    # goes back to being masonry, which is exactly where the outer wall belongs.
    outside = opened | {(x, y) for y in range(rows) for x in range(cols)
                        if x < l or y < t or x >= cols - r or y >= rows - b}
    for (x, y) in sorted(opened):
        for (nx, ny) in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if not (0 <= nx < cols and 0 <= ny < rows):
                continue
            if (nx, ny) in outside or g.g[ny][nx] in '#+':
                continue
            g.g[y][x] = '#'
            opened.discard((x, y))
            break

    bands = ground_bands(cols, rows, (l, t, r, b))
    for ((bx, by, bw, bh), _) in bands:
        g.deco('floor', bx, by, bw, bh, style['surface'])
    # The bite is grounds too — it is the yard growing into the building's
    # corner, and it has to look like it or it reads as a room somebody forgot
    # to furnish.
    if bite:
        g.deco('floor', bite[0], bite[1], bite[2], bite[3], style['surface'])
    for (yx, yy, yw, yh) in yards:
        g.deco('floor', yx, yy, yw, yh, style['surface'])
        # ...and something in it. A corner the building does not fill is still
        # part of the campus, and an acre of unbroken lawn reads as the place
        # the map ran out rather than as anywhere. Trees in from the corners, a
        # bench to sit on, a lamp — laid strictly, so nothing lands in a lane or
        # across the path out.
        #
        # Asked for rather than assumed: this went in for the school, and a
        # school-only pass has no business rearranging the other ten locations'
        # gardens on its way past.
        if not plant_yards:
            continue
        if yw >= 7 and yh >= 7:
            for (tx, ty) in ((yx + 2, yy + 2), (yx + yw - 4, yy + 2),
                             (yx + 2, yy + yh - 4), (yx + yw - 4, yy + yh - 4)):
                g.lay(tx, ty, 2, 2, 'Y', shift=1, strict=True)
            if yw >= yh:
                g.lay(yx + yw // 2 - 2, yy + yh // 2, 4, 1, 'S', shift=2, strict=True)
            else:
                g.lay(yx + yw // 2, yy + yh // 2 - 2, 1, 4, 'S', shift=2, strict=True)
            g.deco('lamp', yx + yw // 2, yy + yh // 2)
            g.drop(yx + yw // 2, yy + 2 + yh // 3, loot.next(), radius=4, box=True)
        elif yw >= 5 and yh >= 5:
            g.lay(yx + yw // 2 - 1, yy + yh // 2 - 1, 2, 2, 'Y', shift=1, strict=True)
    # The path: a run of hard standing from the door out to the gate, drawn as
    # dressing rather than built as geometry — it is a surface, not a wall, and
    # the player can step off it wherever they like.
    px0, px1 = sorted((door[0], gate[0]))
    py0, py1 = sorted((door[1], gate[1]))
    g.deco('floor', px0, max(0, min(door[1], gate[1]) - 1),
           px1 - px0 + 1, 3 if py1 == py0 else 3, style['path'])
    if py1 > py0:
        g.deco('floor', max(0, gate[0] - 1), py0, 3, py1 - py0 + 1, style['path'])
    g.lane(px0, max(0, min(door[1], gate[1]) - 1), px1 - px0 + 1, 3)
    g.deco('sign', max(1, min(cols - 4, gate[0] - 1)), max(1, min(rows - 2, gate[1] - 3)),
           3, 1, style['sign'])

    # Planting, along the fence and in the corners of the plot. Trees are laid
    # rather than filled, so nothing lands in the gate's lane or across the
    # path — a yard you cannot cross is a worse yard than no yard at all.
    for ((bx, by, bw, bh), where) in bands:
        wide = bw >= bh
        # Trees along the inside of the fence, not down the middle of the yard.
        row = {'top': by + 1, 'bottom': by + bh - 3,
               'left': bx + 1, 'right': bx + bw - 3}[where]
        for k in range(2, (bw if wide else bh) - 3, 5):
            tx = bx + k if wide else row
            ty = row if wide else by + k
            g.lay(tx, ty, 2, 2, 'Y', shift=1, strict=True)
        # ...and a hedge in lengths with gaps between them. A single unbroken
        # run across a yard is a wall with leaves on, and it seals the yard off
        # from the rest of the plot as thoroughly as one.
        hedge = {'top': by, 'bottom': by + bh - 1,
                 'left': bx, 'right': bx + bw - 1}[where]
        span = bw if wide else bh
        for k in range(3, span - 4, 9):
            if wide:
                g.lay(bx + k, hedge, 5, 1, 'Z', shift=1, strict=True)
            else:
                g.lay(hedge, by + k, 1, 5, 'Z', shift=1, strict=True)

    # Benches, an outbuilding, and the one thing that says which place this is.
    biggest = max((r for (r, _) in bands), key=lambda rect: rect[2] * rect[3]) if bands else None
    if biggest:
        bx, by, bw, bh = biggest
        if bw >= bh:
            g.lay(bx + bw // 3, by + bh // 2, 4, 1, 'S', shift=2, strict=True)
            g.lay(bx + 2 * bw // 3, by + bh // 2, 4, 1, 'S', shift=2, strict=True)
            sx, sy = bx + (bw - 4) // 2, by + 1
        else:
            g.lay(bx + bw // 2, by + bh // 3, 1, 4, 'S', shift=2, strict=True)
            g.lay(bx + bw // 2, by + 2 * bh // 3, 1, 4, 'S', shift=2, strict=True)
            sx, sy = bx + 1, by + (bh - 4) // 2
        # An outbuilding: a store, a garage, a bin shed. Somewhere outside
        # actually worth walking to, and something the search system can offer.
        g.lay(sx, sy, 3, 2, style['shed'], shift=2, strict=True)
        if style.get('court') and bw >= 11 and bh >= 5:
            g.deco('court', bx + 3, by + 2, bw - 6, bh - 3)
            g.deco('hoop', bx + bw // 2 - 1, by + 1, 3, 1)
        if style.get('plinths'):
            # A sculpture garden. Same rule as the hall inside: what is on show
            # is out where you have to cross to reach it, so each piece gets
            # something worth the walk standing beside it.
            span = bw if bw >= bh else bh
            for k in range(3, span - 3, 6):
                if bw >= bh:
                    if g.lay(bx + k, by + bh // 2 - 1, 2, 2, 'P', shift=1, strict=True):
                        g.drop(bx + k + 3, by + bh // 2, loot.next(), radius=3, box=True)
                else:
                    if g.lay(bx + bw // 2 - 1, by + k, 2, 2, 'P', shift=1, strict=True):
                        g.drop(bx + bw // 2 + 2, by + k, loot.next(), radius=3, box=True)
        for i, kind in enumerate(style['props']):
            g.deco(kind, min(cols - 5, bx + 2 + i * 5), min(rows - 3, by + bh - 3), 4, 2)
        g.deco('lamp', bx + bw // 2, by + bh // 2)

    # ...and something to find out here. The grounds are playable or they are
    # scenery, and scenery is exactly what the brief says not to build.
    for ((bx, by, bw, bh), _) in bands:
        g.drop(bx + bw // 2, by + bh // 2, loot.next(), radius=6, box=True)
    return g


# ------------------------------------------------------------- hiding places
# Somewhere to be, when he is coming and the corridor is long.
#
# Not placed by hand: a hiding place is only worth the name if there is
# genuinely something between you and the room — the back of a bank of lockers,
# the gap behind the shelving in the stores, the corner a wall turns — and the
# map already knows where those are. So the rule is the definition: standable
# floor, tucked in on most sides, off the routes anyone has to take, and far
# enough from the spawn and the way out that it is a decision rather than a
# doorstep.
# Measured on the ring *two* tiles out rather than the one next door, and that
# is forced rather than chosen: the player is 22 units wide and a tile is 20, so
# the box always overlaps its neighbours' columns. A tile with a cabinet
# immediately beside it is a tile nobody can stand on. Two out is where "behind
# the cabinet" actually lives for this collision model.
# Of the sixteen cells two tiles out, how many are solid. Eleven, not eight,
# and the difference is what "behind" means: eight covers the gap between two
# banks of lockers down opposite sides of a corridor, which is covered from the
# north and the south and wide open along the corridor in both directions —
# standing in the middle of a hallway with lockers either side. Eleven is an
# alcove, a dead end, the back of a bank: somewhere the room does not see into.
HIDE_MIN_COVER = 11
HIDE_MIN_PIECES = 3       # ...and how many of those have to be furniture
HIDE_APART = 13           # tiles between one hiding place and the next
HIDE_CLEAR = 6            # ...and from the spawn and the way out
# ...and the same figure for a spot you climb *inside*. Cover is what makes a
# patch of floor a hiding place, and a locker door is not a patch of floor: once
# the player is in the cabinet the room can see the cabinet and nothing else, so
# what the surroundings have to supply is only that the spot reads as a corner
# of the school rather than the middle of the assembly hall. Holding out for an
# alcove *and* a locker leaves two of the five levels with nowhere to hide.
HIDE_DOOR_COVER = 7


def add_hides(g, want=2, least=2, into=''):
    """Mark up to `want` hiding places. Returns how many it found.

    Two passes, and the second one matters. Eleven-of-sixteen cover is a proper
    alcove — the back of a bank of lockers, a dead end behind the shelving — and
    on a floorplan with long straight corridors there may be only one of those.
    Rather than ship a level with nowhere to hide, the requirement comes down a
    notch at a time until the level has at least a couple. A shallower nook is a
    worse hiding place than an alcove; it is a far better one than none.

    `into` is what the player actually climbs into — the school passes 'C', the
    lockers. A spot is only usable if one of those stands squarely two tiles
    away, north/south/east/west: two, because a tile with furniture immediately
    beside it is a tile a 22-wide player cannot stand on, and squarely, because
    he opens the door and steps straight in rather than sidling in diagonally.
    Every spot that survives is a locker you can be standing in front of.
    """
    TILE = 20
    solid = set('#%OTSWNVCBPEYZ+')
    marker = {}
    for y in range(g.rows):
        for x in range(g.cols):
            if g.g[y][x] in '@X':
                marker.setdefault(g.g[y][x], (x, y))
    reached = {(gx * 4 // TILE, gy * 4 // TILE) for (gx, gy) in g._reached()}

    def cover(x, y):
        """How covered this tile is, and how much of that cover is furniture.

        Both, because they are different things. A corner of a room is covered
        on two sides and is somewhere you can be missed, but it is architecture
        — you are standing in the open and hoping. Behind a bank of lockers you
        are behind an object, which is what a hiding place should read as, so
        furniture is what the ranking is really on and walls only break ties."""
        n = 0
        pieces = 0
        doors = 0
        for dy in range(-2, 3):
            for dx in range(-2, 3):
                if max(abs(dx), abs(dy)) != 2:
                    continue
                nx, ny = x + dx, y + dy
                if not (0 <= nx < g.cols and 0 <= ny < g.rows):
                    n += 1
                    continue
                ch = g.g[ny][nx]
                if ch in solid:
                    n += 1
                    if ch in 'TSWNVCBPEYZ':
                        pieces += 1
                    # Straight ahead, and something you can climb inside.
                    if into and ch in into and (dx == 0 or dy == 0):
                        doors += 1
        return n, pieces, doors

    def usable(x, y):
        if not (0 <= x < g.cols and 0 <= y < g.rows) or g.g[y][x] != '.':
            return False
        if (x, y) in g.keep or (x, y) not in reached:
            return False
        return not g._blocked(x * TILE + TILE / 2, y * TILE + TILE / 2)

    def gather(min_cover, apart):
        found = []
        spots = []
        for y in range(1, g.rows - 1):
            for x in range(1, g.cols - 1):
                if not usable(x, y):
                    continue
                c, pieces, doors = cover(x, y)
                if into and not doors:
                    continue
                if c < min_cover or pieces < HIDE_MIN_PIECES:
                    continue
                if any(marker.get(m)
                       and max(abs(x - marker[m][0]), abs(y - marker[m][1])) < HIDE_CLEAR
                       for m in ('@', 'X')):
                    continue
                spots.append((doors, pieces, c, x, y))
        # Most locker frontage first, then most furniture, then most covered,
        # then spread out: two hiding places in the same alcove is one hiding
        # place. Without `into` the first key is a constant zero and this is the
        # ranking it has always been.
        spots.sort(key=lambda t: (-t[0], -t[1], -t[2], t[4], t[3]))
        for (doors, pieces, c, x, y) in spots:
            if len(found) >= want:
                break
            if any(max(abs(x - px), abs(y - py)) < apart for (px, py) in found):
                continue
            found.append((x, y))
        return found

    picks = []
    start = HIDE_DOOR_COVER if into else HIDE_MIN_COVER
    for step in range(6):
        picks = gather(start - step, HIDE_APART - step)
        if len(picks) >= least:
            break
    for (x, y) in picks:
        cells = [(x, y)]
        # A neighbour if there is a sensible one, so the spot is a place to
        # stand rather than a tile to be precisely on. Only ever floor that is
        # already covered: growing into the open would make it a worse hiding
        # place than the tile it started from.
        for (nx, ny) in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if len(cells) >= 2:
                break
            if not usable(nx, ny) or cover(nx, ny)[0] < start - 2:
                continue
            # ...and still in front of a door. The spot is where the player
            # stands to step into the locker, so a second tile that has drifted
            # off the front of it is a tile the animation cannot start from.
            if into and not cover(nx, ny)[2]:
                continue
            cells.append((nx, ny))
        for (cx, cy) in cells:
            g.g[cy][cx] = 'H'
    return len(picks)


# ------------------------------------------------------- pushed against the wall
# A tile is twenty units and the player is twenty-two wide, so a cabinet parked
# one tile off the wall behind it leaves a channel nobody can walk down. From
# above it reads as a mistake — the thing is obviously meant to be against the
# wall and obviously is not — and it plays as a dead end you keep trying.
#
# So: find the blobs with exactly one clear tile between them and the building,
# and slide them over. Only when the tiles they are moving into are free and
# unreserved, and only by the one tile; a piece that has to travel further than
# that was put where it is on purpose.
def snug_to_walls(g):
    """Push furniture flush against the wall it is standing a tile away from.

    One piece at a time, and each move is checked before it is kept. Sliding a
    bookcase back against the wall can take the last standable tile beside it
    with it — or, worse, seal the approach to something else entirely — and a
    cupboard nobody can walk up to is a worse outcome than a cupboard standing a
    tile proud of the wall. So: move, look at the whole map, and put it back if
    anything came off worse.
    """
    solid = set('#%O')
    # Indoors only. A tree standing a tile from the fence is a tree on a lawn,
    # not a cabinet somebody failed to push back.
    pieces = 'TSWNVCBP'
    TILE = 20

    def blobs():
        seen = set()
        out = []
        for y in range(g.rows):
            for x in range(g.cols):
                if (x, y) in seen or g.g[y][x] not in pieces:
                    continue
                ch = g.g[y][x]
                blob, stack = set(), [(x, y)]
                while stack:
                    cx, cy = stack.pop()
                    if (cx, cy) in blob:
                        continue
                    if not (0 <= cx < g.cols and 0 <= cy < g.rows) or g.g[cy][cx] != ch:
                        continue
                    blob.add((cx, cy))
                    stack += [(cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)]
                seen |= blob
                out.append((ch, frozenset(blob)))
        return out

    def stranded():
        """How many pieces of furniture nobody can get to.

        Counted rather than asserted, and compared against what the map started
        with. A big school has a piece or two the grounds pass walled in behind
        a hedge before this ran; demanding perfection means every move is
        rejected on those maps and nothing is ever pushed against a wall. What
        matters is that a move does not make things worse.

        Measured two tiles out, not one: the tile immediately beside a cabinet
        is never standable, because the player is wider than a tile.
        """
        reached = {(gx * 4 // TILE, gy * 4 // TILE) for (gx, gy) in g._reached()}
        count = 0
        for (_, blob) in blobs():
            ok = False
            for (bx, by) in blob:
                for dy in range(-2, 3):
                    for dx in range(-2, 3):
                        if max(abs(dx), abs(dy)) != 2:
                            continue
                        nx, ny = bx + dx, by + dy
                        if not (0 <= nx < g.cols and 0 <= ny < g.rows):
                            continue
                        if (nx, ny) in reached and not g._blocked(nx * TILE + 10, ny * TILE + 10):
                            ok = True
                            break
                    if ok:
                        break
                if ok:
                    break
            if not ok:
                count += 1
        return count

    baseline = None

    def shift(blob, ch, dx, dy):
        """Slide a blob one tile, keep it if the map is no worse for it."""
        to = [c for c in ((bx + dx, by + dy) for (bx, by) in blob) if c not in blob]
        if not to or not all(0 <= cx < g.cols and 0 <= cy < g.rows for cx, cy in to):
            return False
        if any(g.g[cy][cx] != '.' or (cx, cy) in g.keep for cx, cy in to):
            return False
        for (bx, by) in blob:
            g.g[by][bx] = '.'
        for (bx, by) in blob:
            g.g[by + dy][bx + dx] = ch
        if stranded() <= baseline:
            return True
        for (bx, by) in blob:
            g.g[by + dy][bx + dx] = '.'
        for (bx, by) in blob:
            g.g[by][bx] = ch
        return False

    baseline = stranded()
    moved = 0
    for (ch, blob) in blobs():
        for (dx, dy) in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            near = [c for c in ((bx + dx, by + dy) for (bx, by) in blob) if c not in blob]
            far = [c for c in ((bx + dx * 2, by + dy * 2) for (bx, by) in blob) if c not in blob]
            if not near or not far:
                continue
            if not all(0 <= cx < g.cols and 0 <= cy < g.rows for cx, cy in near + far):
                continue
            # Clear next door, building the step after: that is the gap.
            if any(g.g[cy][cx] != '.' for cx, cy in near):
                continue
            if not any(g.g[cy][cx] in solid for cx, cy in far):
                continue
            # Flush against the wall is the answer. Where it is not available —
            # the tile between is a doorway's landing, or closing the gap would
            # seal something off — the other way to stop a channel nobody fits
            # through being a channel is to make it one they do, so the piece
            # steps back instead and the dead tile becomes an aisle.
            if shift(blob, ch, dx, dy) or shift(blob, ch, -dx, -dy):
                moved += 1
            break
    return moved


# ---------------------------------------------------- fittings and the lights
# The things a building has that nobody chooses: radiators under the windows,
# an extinguisher by the corridor doors, coat pegs along a wall, and the strip
# lights overhead.
#
# All of it is decoration rather than geometry — nothing here collides — so it
# costs a rectangle in the emitted map and one draw into the room cache, and
# nothing per frame. That is what makes it affordable to have a lot of.
def add_fittings(g, tier, kinds=('radiator', 'extinguisher'), step=7):
    """Radiators, extinguishers, coat pegs, and the lights."""
    put = 0
    inside = set('.,~abeq')

    def floor_at(x, y):
        return 0 <= x < g.cols and 0 <= y < g.rows and g.g[y][x] in inside

    # Radiators under the windows, on whichever side of the wall is indoors.
    for y in range(g.rows) if 'radiator' in kinds else ():
        for x in range(g.cols):
            if g.g[y][x] != 'O':
                continue
            if g.g[y][max(0, x - 1)] == 'O' and x > 0:
                continue                      # only the start of each run
            run = 0
            while x + run < g.cols and g.g[y][x + run] == 'O':
                run += 1
            if run >= 3:                      # a horizontal window: below or above
                below = floor_at(x + 1, y + 1)
                at = y + (1 if below else -1)
                # Only where the room actually is. A window in the outer wall of
                # a building with grounds round it has floor on one side and
                # lawn on the other, and a radiator on the lawn is worse than no
                # radiator; a window at the very edge of the map has neither.
                if floor_at(x + 1, at):
                    g.deco('radiator', x + 1, at, run - 2, 1)
                    put += 1
                continue
            tall = 0
            while y + tall < g.rows and g.g[y + tall][x] == 'O':
                tall += 1
            if tall >= 3 and (y == 0 or g.g[y - 1][x] != 'O'):
                right = floor_at(x + 1, y + 1)
                at = x + (1 if right else -1)
                if floor_at(at, y + 1):
                    g.deco('radiator', at, y + 1, 1, tall - 2)
                    put += 1

    # An extinguisher beside every other doorway, and coat pegs on the wall
    # opposite the first of them: both are corridor things, and both go where
    # there is wall to put them on.
    doors = [(x, y) for y in range(g.rows) for x in range(g.cols)
             if g.g[y][x] == 'D' and g.g[y][max(0, x - 1)] != 'D'] \
        if 'extinguisher' in kinds else []
    for i, (x, y) in enumerate(doors):
        if i % 2:
            continue
        for (dx, dy) in ((-2, 0), (3, 0), (0, -2), (0, 3)):
            wx, wy = x + dx, y + dy
            if not (0 <= wx < g.cols and 0 <= wy < g.rows):
                continue
            if g.g[wy][wx] in '#%' and (floor_at(wx, wy + 1) or floor_at(wx, wy - 1)
                                        or floor_at(wx + 1, wy) or floor_at(wx - 1, wy)):
                g.deco('extinguisher', wx, wy)
                put += 1
                break

    # The lights. On a lattice, wherever there is floor under them and no light
    # already nearby — so a long corridor gets a row of them and a cupboard gets
    # one, which is how a building is actually lit.
    lit = []
    for y in range(2, g.rows - 2, step):
        for x in range(2, g.cols - 2, step):
            spot = None
            for (ox, oy) in ((0, 0), (1, 0), (0, 1), (-1, 0), (0, -1), (1, 1)):
                if floor_at(x + ox, y + oy):
                    spot = (x + ox, y + oy)
                    break
            if not spot:
                continue
            if any(max(abs(spot[0] - lx), abs(spot[1] - ly)) < step - 2 for (lx, ly) in lit):
                continue
            lit.append(spot)
            g.deco('ceiling', spot[0] - 1, spot[1] - 1, 3, 3)
            put += 1
    return put


# --------------------------------------------------------- what happened here
# Section 16. One or two props per building that could only be in that
# building, placed where they would actually be rather than scattered.
#
# A room full of correct furniture is a floorplan that has been dressed. A room
# where somebody has left half a cup of tea is a room somebody was in — and the
# difference between those two is most of what separates a level from a level
# you believe in. The school got this the long way round, with chalk in the
# tray and a bag by the door and paper under the desks; this is the same idea
# for the other ten, in one table.
#
# Each entry is (kind, where, how many per tier step). `where` is the rule for
# what a sensible spot looks like:
#
#   'against'  next to furniture — a plate on the side, a suitcase by a chest
#   'open'     out in the middle of a room, where you have to walk round it
#   'door'     near a doorway, which is where people put things down
#
# A prop is one tile unless it is listed in STORY_SPAN. Only the rope barrier
# is: a rope slung between two posts a single tile apart is not a barrier, it
# is a pair of posts, and a museum uses these to close off half a gallery.
STORY_SPAN = {'barrier': (2, 1)}
# No two buildings may carry the same pair, or two of them tell the same story
# in different wallpaper — which is what the first draft did, with the flat and
# the house both on a plate and a scattered game, and the museum and the vault
# both on a rope and a crate.
STORY = {
    'Apartment': [('meal', 'against', 1.0), ('toys', 'open', 0.8)],
    # A bag half packed in the hall, and whatever the child left on the floor.
    'House':     [('toys', 'open', 1.2), ('luggage', 'door', 0.7)],
    'Hotel':     [('luggage', 'door', 1.2), ('meal', 'against', 0.6)],
    'Office':    [('meal', 'against', 1.2), ('crate', 'open', 0.5)],
    # The school already tells its own story, at length, and the whole of this
    # pass is the other ten catching up with it.
    'School':    [],
    'Hospital':  [('drip', 'door', 1.4), ('meal', 'against', 0.5)],
    'Museum':    [('barrier', 'open', 1.4), ('crate', 'against', 0.7)],
    'Mansion':   [('glasses', 'against', 1.0), ('toys', 'open', 0.5)],
    'Penthouse': [('glasses', 'against', 1.2)],
    'Shop':      [('till', 'against', 1.0), ('crate', 'open', 1.2)],
    # A bank: the rope that keeps a queue in line, and the counter it ends at.
    'Vault':     [('barrier', 'door', 0.9), ('till', 'against', 0.7)],
}


def add_story(g, tier, wants):
    """Place this building's own props. Returns how many went down."""
    if not wants:
        return 0
    TILE = 20
    reached = {(gx * 4 // TILE, gy * 4 // TILE) for (gx, gy) in g._reached()}
    doors = [(x, y) for y in range(g.rows) for x in range(g.cols) if g.g[y][x] == 'D']
    # What a prop has to keep away from is other things standing on the floor,
    # and nothing else. Counting the ceiling lights here — which is what the
    # first draft did, and there is one every seven tiles now — left almost no
    # tile in the building more than five from one, so the hotel got its
    # suitcase and never its supper, and the bank got its rope and never its
    # counter.
    ON_FLOOR = ('plant', 'bin', 'lamp', 'kettle', 'bike', 'car', 'coats',
                'luggage', 'barrier', 'till', 'drip', 'meal', 'toys', 'crate',
                'glasses')
    taken = [(d[1], d[2]) for d in g.decor if d[0] in ON_FLOOR]

    def free(x, y, sw=1, sh=1):
        for dy in range(sh):
            for dx in range(sw):
                cx, cy = x + dx, y + dy
                if not (2 <= cx < g.cols - 2 and 2 <= cy < g.rows - 2):
                    return False
                if g.g[cy][cx] != '.' or (cx, cy) in g.keep or (cx, cy) not in reached:
                    return False
                if g._blocked(cx * TILE + TILE / 2, cy * TILE + TILE / 2):
                    return False
        return True

    def beside(x, y):
        # Two tiles out, not one, and forced rather than chosen: the player is
        # 22 units wide and a tile is 20, so the tile immediately beside a
        # cabinet is a tile nobody can stand on and every prop asked to go
        # there was silently dropped. Two out is where "on the side" lives.
        return any(0 <= x + dx < g.cols and 0 <= y + dy < g.rows
                   and g.g[y + dy][x + dx] in 'TSWNVCBPE'
                   for dy in range(-2, 3) for dx in range(-2, 3))

    def near_door(x, y):
        return any(3 <= max(abs(x - dx), abs(y - dy)) <= 6 for (dx, dy) in doors)

    rules = {'against': beside,
             'open': lambda x, y: not beside(x, y) and not near_door(x, y),
             'door': near_door}
    put = 0
    for (kind, where, per) in wants:
        want = max(1, int(round(per * LITTER_TIER[tier])))
        fits = rules[where]
        sw, sh = STORY_SPAN.get(kind, (1, 1))
        placed = 0
        # A coarse lattice first, so the props are spread through the building
        # rather than piled in whichever room the scan reaches first.
        for step in (5, 3, 2):
            if placed >= want:
                break
            for y in range(2, g.rows - 2, step):
                for x in range(2, g.cols - 2, step):
                    if placed >= want:
                        break
                    if not free(x, y, sw, sh) or not fits(x, y):
                        continue
                    # Never on top of something else, and never so close to
                    # another prop that the two read as one heap.
                    if any(max(abs(x - px), abs(y - py)) < 5 for (px, py) in taken):
                        continue
                    g.deco(kind, x, y, sw, sh)
                    taken.append((x, y))
                    placed += 1
                    put += 1
    return put


# ------------------------------------------------------------ things underfoot
# What a school floor has on it, and what standing on it costs.
#
# Not scattered: placed where each thing would actually be. Paper and pencils
# collect under desks and along the foot of the lockers; a crisp packet gets
# dropped in the middle of a corridor where there is nothing to sweep it under;
# a bag gets left near a doorway, because that is where people put bags down.
#
# The bag never goes *in* a doorway lane. A noise you cannot route around is not
# a decision, it is a toll — and the whole point of these is that the cheap ones
# are worth walking over and the expensive one is worth going round.
LITTER = {
    'paper':   ('a', 5),      # character, and how many per level per tier step
    'clutter': ('e', 4),
    'plastic': ('b', 3),
    'bag':     ('q', 2),
}
LITTER_TIER = [0.6, 0.8, 1.0, 1.2, 1.4]


def add_litter(g, tier, kinds=('paper', 'clutter', 'plastic', 'bag'), scale=1.0):
    """Drop paper, pencils, packets and bags where they would actually be."""
    TILE = 20
    solid = set('#%OTSWNVCBPEYZ+H')
    reached = {(gx * 4 // TILE, gy * 4 // TILE) for (gx, gy) in g._reached()}
    doors = [(x, y) for y in range(g.rows) for x in range(g.cols) if g.g[y][x] == 'D']

    def free(x, y):
        if not (1 <= x < g.cols - 1 and 1 <= y < g.rows - 1):
            return False
        if g.g[y][x] != '.' or (x, y) in g.keep or (x, y) not in reached:
            return False
        return not g._blocked(x * TILE + TILE / 2, y * TILE + TILE / 2)

    def near_furniture(x, y):
        return any(g.g[y + dy][x + dx] in 'TSWNVCBPE'
                   for dy in range(-2, 3) for dx in range(-2, 3)
                   if 0 <= x + dx < g.cols and 0 <= y + dy < g.rows)

    def near_door(x, y):
        return any(max(abs(x - dx), abs(y - dy)) <= 4 for (dx, dy) in doors)

    # Where each kind belongs. A tile can serve more than one, and the order
    # below is the order they get first refusal.
    wants = {
        'paper': lambda x, y: near_furniture(x, y),
        'clutter': lambda x, y: near_furniture(x, y),
        'bag': lambda x, y: near_door(x, y) and not near_furniture(x, y),
        'plastic': lambda x, y: not near_furniture(x, y),
    }
    taken = []
    for kind in ('bag', 'plastic', 'paper', 'clutter'):
        if kind not in kinds:
            continue
        ch, per = LITTER[kind]
        want = max(1, int(round(per * LITTER_TIER[tier] * scale)))
        fits = wants[kind]
        placed = 0
        # Walked on a coarse lattice so the litter is spread through the
        # building rather than piled in whichever room comes first.
        for step in (4, 3, 2):
            if placed >= want:
                break
            for y in range(2, g.rows - 2, step):
                for x in range(2, g.cols - 2, step):
                    if placed >= want:
                        break
                    if not free(x, y) or not fits(x, y):
                        continue
                    if any(max(abs(x - px), abs(y - py)) < 4 for (px, py) in taken):
                        continue
                    g.g[y][x] = ch
                    taken.append((x, y))
                    placed += 1
    return len(taken)


# ============================================================== the silhouette
# What shape the building is, before a single stick of furniture is in it.
#
# A room grammar fills a rectangle, so a grammar on its own can only ever draw
# rectangles: take the furniture out of the old ten locations and you had ten
# stacks of the same box at five sizes. The school was the exception only
# because its five levels are drawn by hand.
#
# Drawing fifty more by hand is one answer. This is the other: keep the grammar
# on a rectangle and make the *building* more than one rectangle. The grammar
# runs in the core, wings hang off it, and the wall each wing shares with the
# core carries the door between them. Read off the walls alone — every stick of
# furniture removed — level three of a location is now an L and level five is a
# U or a cross, and no two locations climb through the same five shapes.
#
# A wing is (side, align, along, deep): which face of the core it hangs off and
# whereabouts along that face, how much of the face it takes, and how far it
# reaches out as a multiple of the tier's wing depth.

# How far a wing reaches out, by tier, and how much of it the core pays for.
#
# The first pass at this took the wing out of the core so the plot stayed the
# size it had always been, and it was wrong in a way worth writing down: every
# room grammar in this file is *tuned* to the tier sizes below. Take eight
# columns off an apartment and its two rooms per band go from fifteen tiles wide
# to eleven, the furnishing rules keep laying the same pieces, and what comes
# out is a room furnished wall to wall with a one-tile gap down it — which looks
# furnished, is not walkable, and made the connectivity pass bulldoze eighty
# pieces to open a route. So the core keeps its envelope, the plot grows by most
# of the wing, and the clocks are recalibrated to pay for the extra ground.
WING_DEEP = [0, 7, 8, 8, 9]
# ...and the core pays none of it. Two tiles looked harmless and was not: an
# apartment's rooms went from fifteen tiles wide to fourteen, which is the exact
# width at which its two furniture runs leave a one-tile gap between them
# instead of two — and a one-tile gap is not a gap, because the player is wider
# than one tile. The grammars are tuned to the sizes above and get them.
SQUEEZE = [0, 0, 0, 0, 0]

SHAPES = {
    # A rectangle. Every location's first level, because the level that teaches
    # the building should be the one you can hold in your head.
    'bar':   [],
    # An L: one wing off one end of the far face.
    'ell':   [('far', 'far', 0.46, 1.0)],
    # A T: the wing off the middle instead, so there are two ways round to most
    # of the building and one dead end at the bottom of the stem.
    'tee':   [('far', 'mid', 0.42, 1.0)],
    # A U: two wings off the ends, and the gap between them is a courtyard —
    # open ground the building wraps round on three sides.
    'you':   [('far', 'near', 0.30, 1.0), ('far', 'far', 0.30, 1.0)],
    # A C on its side: two arms reaching off the same flank.
    'cee':   [('a', 'near', 0.34, 1.0), ('a', 'far', 0.34, 1.0)],
    # Branching wings: one off a flank and one off the far end, at different
    # depths, so the building is not symmetrical and neither is the route.
    'wings': [('a', 'near', 0.30, 0.8), ('far', 'far', 0.34, 1.0)],
    # Irregular: a leg and an alcove that do not line up with anything.
    'jag':   [('far', 'far', 0.34, 1.0), ('b', 'near', 0.28, 0.8)],
}

# Which five shapes each location climbs through. The sequences differ on
# purpose: a flat gains a hallway and an alcove, a hotel branches into wings, a
# museum hangs side galleries off its hall, and the mansion ends up round a
# court. Same machinery, and no two locations read alike from the walls.
#
# Which is what this comment said while the hotel, the hospital and the mansion
# were climbing through exactly the same five — bar, ell, tee, wings, you —
# so their third, fourth and fifth floors were the same building three times
# over with different furniture in it. The hospital and the mansion have their
# own now, and a test holds all ten sequences apart rather than the comment.
FOOTPRINTS = {
    'Apartment': ['bar', 'ell', 'jag', 'tee', 'wings'],
    'House':     ['bar', 'ell', 'tee', 'cee', 'you'],
    'Hotel':     ['bar', 'ell', 'tee', 'wings', 'you'],
    'Office':    ['bar', 'ell', 'cee', 'tee', 'jag'],
    # Straight to a T and then out to both flanks: a hospital is a spine with
    # wards hanging off it, and it never reads as a house that grew.
    'Hospital':  ['bar', 'tee', 'wings', 'cee', 'you'],
    'Museum':    ['bar', 'ell', 'wings', 'cee', 'tee'],
    # ...and the mansion ends up round its court by way of an irregular wing,
    # which is what a house that has been added to for two hundred years does.
    'Mansion':   ['bar', 'tee', 'cee', 'jag', 'you'],
    'Penthouse': ['bar', 'ell', 'tee', 'cee', 'jag'],
    'Shop':      ['bar', 'ell', 'tee', 'wings', 'cee'],
    'Vault':     ['bar', 'ell', 'cee', 'tee', 'you'],
}

# Which wall each grammar cuts its way out of. A wing may never cover it: the
# exit has to sit in the outer wall of the whole plot for the game to read which
# side it is on, so the core is always flush against that face and the wings go
# somewhere else. 'far' below means the face opposite the way out, 'near' the
# one beside it, 'side' either flank.
EXIT_SIDE = {
    'Apartment': 'left', 'House': 'bottom', 'Hotel': 'left', 'Office': 'left',
    'Hospital': 'left', 'Museum': 'bottom', 'Mansion': 'bottom',
    'Penthouse': 'left', 'Shop': 'bottom', 'Vault': 'bottom',
}

# Reading a wing's abstract face against the wall the way out is cut into.
# 'far' is the face opposite the exit; 'a' and 'b' are the two flanks. The exit
# face itself is never offered, which is the whole constraint: the core stays
# flush against it so the way out lands in the outer wall of the plot, where the
# game reads which side it is on.
FACES = {
    'left':   {'far': 'right',  'a': 'top',  'b': 'bottom'},
    'right':  {'far': 'left',   'a': 'top',  'b': 'bottom'},
    'bottom': {'far': 'top',    'a': 'left', 'b': 'right'},
    'top':    {'far': 'bottom', 'a': 'left', 'b': 'right'},
}


def footprint(cols, rows, shape, tier, exit_side):
    """Work out the core and its wings inside a plot of about this size.

    Returns (cols, rows, core, wings) where each wing is (rect, face) and every
    rectangle includes its own walls. Wings overlap the core by exactly one
    tile: that shared line is the wall between them."""
    spec = SHAPES[shape]
    faces = FACES[exit_side]
    wings = [(faces[side], align, along, deep) for (side, align, along, deep) in spec]
    deep = {'left': 0, 'top': 0, 'right': 0, 'bottom': 0}
    reach = []
    for (face, align, along, mult) in wings:
        across = cols if face in ('left', 'right') else rows
        d = max(7, int(round(WING_DEEP[tier] * mult)))
        d = min(d, across // 2 - 4)
        reach.append(d)
        deep[face] = max(deep[face], d)
    across_x = deep['left'] + deep['right']
    across_y = deep['top'] + deep['bottom']
    core_w = cols - min(across_x, SQUEEZE[tier])
    core_h = rows - min(across_y, SQUEEZE[tier])
    cols = core_w + across_x
    rows = core_h + across_y
    core = (deep['left'], deep['top'], core_w, core_h)
    out = []
    for (face, align, along, _), d in zip(wings, reach):
        if face in ('top', 'bottom'):
            w = max(11, int(round(along * core_w)))
            w = min(w, core_w - 2)
            x = {'near': core[0] + 1, 'mid': core[0] + (core_w - w) // 2,
                 'far': core[0] + core_w - w - 1}[align]
            y = core[1] + core_h - 1 if face == 'bottom' else core[1] - d + 1
            out.append(((x, y, w, d), face))
        else:
            h = max(10, int(round(along * core_h)))
            h = min(h, core_h - 2)
            y = {'near': core[1] + 1, 'mid': core[1] + (core_h - h) // 2,
                 'far': core[1] + core_h - h - 1}[align]
            x = core[0] + core_w - 1 if face == 'right' else core[0] - d + 1
            out.append(((x, y, d, h), face))
    # Pull the plot in tight around the building. Without this a wing hanging
    # off the left leaves a one-tile strip of nothing down that edge, and once
    # the grounds are wrapped round the outside that strip becomes a ribbon of
    # yard with a wall down one side of it and no way in — which the
    # connectivity pass then tries to solve by demolishing the building.
    rects = [core] + [r for (r, _) in out]
    x0 = min(r[0] for r in rects)
    y0 = min(r[1] for r in rects)
    cols = max(r[0] + r[2] for r in rects) - x0
    rows = max(r[1] + r[3] for r in rects) - y0
    core = (core[0] - x0, core[1] - y0, core[2], core[3])
    out = [((r[0] - x0, r[1] - y0, r[2], r[3]), face) for (r, face) in out]
    return cols, rows, core, out


def void_rects(cols, rows, rects):
    """The plot the building does not stand on, as few rectangles as possible.

    Merged rather than listed tile by tile because these become floor patches in
    the emitted map, and a courtyard written down as three hundred one-tile
    patches is three hundred entries nobody can read."""
    used = [[False] * cols for _ in range(rows)]
    for (x, y, w, h) in rects:
        for yy in range(max(0, y), min(rows, y + h)):
            for xx in range(max(0, x), min(cols, x + w)):
                used[yy][xx] = True
    taken = [[False] * cols for _ in range(rows)]
    out = []
    for y in range(rows):
        for x in range(cols):
            if used[y][x] or taken[y][x]:
                continue
            w = 0
            while x + w < cols and not used[y][x + w] and not taken[y][x + w]:
                w += 1
            h = 1
            while y + h < rows:
                if any(used[y + h][x + i] or taken[y + h][x + i] for i in range(w)):
                    break
                h += 1
            for dy in range(h):
                for dx in range(w):
                    taken[y + dy][x + dx] = True
            out.append((x, y, w, h))
    return out


# What a wing of each location is made of. A wing is not a spare room with two
# boxes in it: it is the part of the building the grammar did not build, and it
# has to be recognisably the same place — a hotel's wing has wardrobes and
# linen in it, a museum's has a workshop, a vault's has deposit boxes.
# What a wing of each location is made of. A wing is not a spare room with two
# boxes in it: it is the part of the building the grammar did not build, and it
# has to be recognisably the same place — a hotel's wing has wardrobes and linen
# in it, a museum's has a workshop, a vault's has deposit boxes.
#
# Which pieces, exactly, is not a free choice. What you can open in a building
# is read off the characters its rooms are furnished with, so a wing that fills
# itself from a generic kit quietly rewrites the location's vocabulary: adding a
# table to a shop and a bookshelf to a vault collapsed seven distinct buildings
# into four that all open the same three things. Each kit below is drawn from
# what its own location already uses, and a piece that is deliberately *not*
# openable — a bench, a plinth, a nightstand — carries the rest of the room.
ANNEX = {
    'Apartment': dict(rooms=['Hall', 'Box room', 'Alcove'], floor='boards',
                      big='W', mid='C', small='N', props=['plant', 'bin']),
    'House':     dict(rooms=['Scullery', 'Pantry', 'Back room'], floor='boards',
                      big='B', mid='C', small='T', props=['kettle', 'plant']),
    'Hotel':     dict(rooms=['Suite', 'Linen', 'Service'], floor='carpet',
                      big='W', mid='C', small='N', props=['lamp', 'plant']),
    'Office':    dict(rooms=['Meeting room', 'Filing', 'Copy room'], floor='carpet',
                      big='V', mid='T', small='B', props=['plant', 'bin']),
    'Hospital':  dict(rooms=['Side ward', 'Supplies', 'Sluice'], floor='tiles',
                      big='C', mid='B', small='N', props=['bin', 'plant']),
    # A bench rather than another plinth: what is on show in a museum is on show
    # in the hall, and side galleries full of empty cases make the hall's cases
    # look like scenery too.
    'Museum':    dict(rooms=['Side gallery', 'Store', 'Workshop'], floor='parquet',
                      big='B', mid='C', small='S', props=['plant', 'lamp']),
    'Mansion':   dict(rooms=['Drawing room', 'Study', 'Gun room'], floor='carpet',
                      big='B', mid='C', small='T', props=['lamp', 'plant']),
    'Penthouse': dict(rooms=['Dressing room', 'Snug', 'Gallery'], floor='carpet',
                      big='W', mid='C', small='T', props=['lamp', 'plant']),
    'Shop':      dict(rooms=['Stockroom', 'Fitting rooms', 'Back office'], floor='tiles',
                      big='B', mid='C', small='W', props=['bin', 'plant']),
    'Vault':     dict(rooms=['Deposit room', 'Records', 'Anteroom'], floor='concrete',
                      big='C', mid='T', small='P', props=['lamp']),
}


def annex(g, rect, face, tier, location, loot, door):
    """Furnish a wing: a spine off the door and the rooms that hang off it, or
    one open room where the wing is too shallow for both.

    Nothing here places a spawn, a way out or a person — the core has all three,
    and a building with two ways out of it is not a harder level, it is a
    broken one."""
    kit = ANNEX[location]
    wx, wy, ww, wh = rect
    # (along, deep) -> a rectangle on the grid. `along` runs parallel to the
    # wall the wing shares with the core; `deep` runs away from it. Writing the
    # wing in these two axes is what lets one routine furnish a wing hanging off
    # any of the four faces without four copies of it.
    if face in ('top', 'bottom'):
        span, depth = ww - 2, wh - 2
        a0 = wx + 1
        d0 = wy + 1 if face == 'bottom' else wy + wh - 2
        step = 1 if face == 'bottom' else -1
        def box(a, d, al, dl):
            return (a0 + a, d0 + d if step > 0 else d0 - d - dl + 1, al, dl)
    else:
        span, depth = wh - 2, ww - 2
        a0 = wy + 1
        d0 = wx + 1 if face == 'right' else wx + ww - 2
        step = 1 if face == 'right' else -1
        def box(a, d, al, dl):
            return (d0 + d if step > 0 else d0 - d - dl + 1, a0 + a, dl, al)

    # The way in, reserved through the whole depth of the wing before a stick
    # of furniture is placed. Three tiles beyond the doorway is enough for a
    # room with a corridor in front of it and nowhere near enough for a wing:
    # what it leaves is a bookcase across the only route in, which from the far
    # side is indistinguishable from a wall.
    da = (door[0] if face in ('top', 'bottom') else door[1]) - a0
    da = max(0, min(span - 3, da))
    g.lane(*box(da, 0, 3, depth))

    rooms = []
    if depth >= 8 and span >= 13:
        # Deep enough for a passage and rooms off it: the wing reads as part of
        # the building rather than as a bay off the end of it.
        g.lane(*box(0, 0, span, 3))
        cut = 4
        n = 3 if span >= 22 else 2
        w = span // n
        for i in range(n):
            a = i * w
            aw = span - a if i == n - 1 else w
            if i:
                r = box(a - 1, cut, 1, depth - cut)
                g.fill(r[0], r[1], r[2], r[3], '%')
            d = a + aw // 2 - 1
            door = box(d, cut - 1, 3, 1)
            g.fill(door[0], door[1], door[2], door[3], 'D')
            g.lane(*box(d, cut - 3, 3, 5))
            rooms.append(box(a, cut, aw, depth - cut))
        band = box(0, 0, span, 3)
        g.deco('floor', band[0], band[1], band[2], band[3], kit['floor'])
    else:
        rooms.append(box(0, 0, span, depth))

    for i, (rx, ry, rw, rh) in enumerate(rooms):
        if rw < 3 or rh < 2:
            continue
        # Five pieces where there is room for five. Two of them was the first
        # pass and it showed: a side ward with a cabinet and a pot plant in it
        # reads as a room somebody forgot to finish, and it gives the search
        # system nothing to work with either — a cupboard is only worth
        # noticing among furniture that is not one. They go along the back wall
        # in two runs and against each side, and `lay` shifts them out of the
        # lane rather than standing in it.
        back = max(3, rw // 3)
        g.lay(rx + 1, ry + 1, back, max(2, rh // 2), kit['big'])
        g.lay(rx + rw - back - 1, ry + 1, back, max(2, rh // 3), kit['mid'])
        g.lay(rx + 1, ry + rh - 3, max(3, rw // 4), 2, kit['small'])
        g.lay(rx + rw - 4, ry + rh - 3, 3, 2, kit['big'])
        if rw > 11 and rh > 4:
            g.lay(rx + rw // 2 - 2, ry + rh // 2 - 1, 4, 2, kit['mid'])
        if rw > 9 and rh > 5 and kit['floor'] in ('carpet', 'boards'):
            g.lay(rx + rw // 2 - 2, ry + rh - 4, 5, 2, ',')
        dress(g, rx, ry, rw, rh, kit['floor'],
              props=corner_props(rx, ry, rw, rh, kit['props']))
        g.deco('sign', rx + rw // 2 - 1, ry, 3, 1,
               kit['rooms'][i % len(kit['rooms'])])
        g.drop(rx + rw // 2, ry + rh // 2, loot.next(), radius=3, box=True)
        if rw > 8:
            g.drop(rx + 2, ry + rh - 2, loot.next(), radius=3, box=True)


def shaped(cols, rows, shape, tier, location, grammar, loot):
    """Build one level as a core the grammar fills and wings hanging off it."""
    cols, rows, core, wings = footprint(cols, rows, shape, tier,
                                        EXIT_SIDE[location])
    rects = [core] + [r for (r, _) in wings]
    g = draft.blocks(cols, rows, rects)
    # The doors first, so their lanes are reserved before the grammar or the
    # wings put anything down. This is the same lesson as every other doorway in
    # this file: reserve, then furnish, and there is nothing left to repair.
    grammar(draft.Wing(g, *core), tier)
    # The doors after the grammar, so each one can be put where the grammar left
    # the core open — and before the wings are furnished, so the lane through
    # each wing is reserved before anything can stand in it.
    kept, doors = [core], []
    for (r, face) in wings:
        # A wing is not owed the exact spot the silhouette asked for. If the
        # grammar has left the wall there packed, slide the wing along that face
        # and ask again — a bedroom wing four tiles further down the building is
        # the same silhouette to anyone looking at it, and it is the difference
        # between a wing and no wing at all.
        r, door = slide(g, core, r, face)
        if door:
            annex(g, r, face, tier, location, loot, door)
            kept.append(r)
            doors.append((r, door))
        else:
            # No way in that a person fits through. Fill it back in: a wing you
            # cannot enter is a sealed room the connectivity pass will tear the
            # building apart trying to open.
            seal(g, core, r)

    # ...and then check rather than trust. Choosing a doorway with clear floor
    # on both sides is a local test, and a local test cannot see that the floor
    # it found is itself walled off from the rest of the building — which is how
    # a museum ended up with a wing behind its own display cases and the repair
    # pass carving nine tiles deep to reach it. Walk the map and believe the
    # walk: a wing the player cannot get to is not a wing.
    reach = {(gx * 4 // 20, gy * 4 // 20) for (gx, gy) in g._reached()}
    for (r, door) in doors:
        if any((door[0] + dx, door[1] + dy) in reach
               for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
            continue
        seal(g, core, r)
        kept.remove(r)
    return g, void_rects(cols, rows, kept)


def slide(g, core, rect, face, reach=8):
    """Find somewhere along the core's face this wing can actually join it.

    Returns the wing (moved, perhaps) and its doorway, or the wing unmoved and
    None. Tries where the silhouette asked first, then works outwards in steps
    of two, staying inside the core's own span so the wing never hangs off the
    end of the building it is attached to."""
    cx, cy, cw, ch = core
    x, y, w, h = rect
    along = face in ('top', 'bottom')
    lo = (cx + 1) if along else (cy + 1)
    hi = (cx + cw - w - 1) if along else (cy + ch - h - 1)
    at = x if along else y
    for step in [0] + [s * d for s in range(2, reach + 1, 2) for d in (1, -1)]:
        here = max(lo, min(hi, at + step))
        moved = (here, y, w, h) if along else (x, here, w, h)
        # Carve the wing where it now stands. Cheap enough to redo: this runs
        # once per wing at authoring time and never in the game.
        g.fill(moved[0] + 1, moved[1] + 1, moved[2] - 2, moved[3] - 2, '.')
        g.box(*moved, '#')
        door = draft.join(g, core, moved)
        if door:
            return moved, door
        seal(g, core, moved)
    return rect, None


def seal(g, core, rect):
    """Fill a wing back in, and put the core's own wall back across the doorway
    the wing had opened in it.

    Only that stretch of wall: re-boxing the whole core paints over the way out,
    which the grammar cut into one of these same four walls, and a level with no
    exit does not load."""
    cx, cy, cw, ch = core
    x, y, w, h = rect
    g.fill(x, y, w, h, '#')
    if y + h - 1 == cy or cy + ch - 1 == y:          # a wing above or below
        row = cy if y + h - 1 == cy else cy + ch - 1
        g.fill(max(cx, x), row, min(cx + cw, x + w) - max(cx, x), 1, '#')
    else:                                            # ...or off a flank
        col = cx if x + w - 1 == cx else cx + cw - 1
        g.fill(col, max(cy, y), 1, min(cy + ch, y + h) - max(cy, y), '#')


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

# A location may hand-draw all five of its levels rather than only its last.
# The school does, because the point of its five levels is that they are five
# different shapes of building — a rectangle, an L, a T, a U round a courtyard,
# and one irregular floor with wings — and a room grammar that fills a rectangle
# can only ever produce rectangles. Read off the walls alone, with every stick of
# furniture removed, these are five plans.
SHAPED = {
    'School': [draft.school_1, draft.school_2, draft.school_3,
               draft.school_4, draft.school],
}

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
            # Does this level have an outside? If so the building is built
            # first, exactly as it always was, and then put in the middle of
            # its own plot — which is why nothing below here has to know.
            pad = (YARDS.get(name) or [0] * 5)[tier]
            if name in SHAPED:
                g = SHAPED[name][tier]()
                # No bite here. The school's five levels are five hand-drawn
                # silhouettes already — a rectangle, an L, a T, a U round a
                # courtyard and one irregular floor with wings — and taking a
                # corner off one of them is vandalism, not variety.
                if pad:
                    # The corners the drawing left out become campus rather than
                    # masonry: an L-shaped school has an L-shaped playground.
                    g = add_grounds(g, pad, YARD_DEEP[tier], name, Loot(tier),
                                    bite=False, voids=list(g.solids),
                                    plant_yards=True)
                g.clear_landings(); draft.clear_exit(g)
                top_up_loot(g, tier)
                promote_prize(g, tier)
                g.clear_freebies()
                g.rehome_loot()
                if g.open_until_connected() is None:
                    g.open_by_removal()
            elif tier == 4 and handdrawn:
                g = HANDDRAWN[handdrawn]()
                floor_under(g, theme)
                dress_corners(g, every=3)
                if pad:
                    g = add_grounds(g, pad, YARD_DEEP[tier], name, Loot(tier),
                                    bite=False)
                g.clear_landings(); draft.clear_exit(g)
                promote_prize(g, tier)
                g.clear_freebies()
                g.rehome_loot()
                if g.open_until_connected() is None:
                    g.open_by_removal()
            else:
                # The building's outline, then the grammar inside it. Level one
                # of every location is still a plain rectangle; from level two
                # the walls alone tell you which level you are on.
                shape = FOOTPRINTS[name][tier]
                g, voids = shaped(*TIER_SIZE[tier], shape, tier, name,
                                  grammar, Loot(tier))
                if pad:
                    g = add_grounds(g, pad, YARD_DEEP[tier], name, Loot(tier),
                                    bite=False, voids=voids)
                g.clear_landings()
                draft.clear_exit(g)
                top_up_loot(g, tier)
                promote_prize(g, tier)
                g.clear_freebies()
                g.rehome_loot()
                depth = g.open_until_connected()
                if depth is None and not g.open_by_removal():
                    problems.append(f'{name} L{tier + 1}: no route to everything')
            # The repair passes move furniture, and moving furniture can strand
            # a coin behind whatever they left standing. So the last word on
            # where the loot is comes after they have all had theirs.
            g.rehome_loot()
            # Furniture you can look inside, and the floor swept of most of
            # what used to be lying on it. This runs last because it only
            # rewrites characters in place: nothing it does can move a wall or
            # close a route that the passes above just opened.
            #
            # Every location gets it now. What differs is the vocabulary — a
            # hotel hides things in wardrobes and a bank of lockers is a school
            # thing — and that falls out of what each grammar builds with,
            # because a searchable piece is named by the character the room
            # grammar already used for it.
            thin_floor_loot(g, tier, name)
            # Hiding places go down after every pass that can move furniture
            # and before the one that renames it. `make_searchable` rewrites a
            # cupboard's character to a digit, and the tool's idea of what is
            # solid is a list of the *furniture* letters — so a hiding place
            # chosen after that pass can be tucked in beside what the tool reads
            # as thin air and turns out to be a locker. Only the school has
            # them: hiding is a beta mechanic and this is the building it is
            # being tried in.
            if name in SNUG:
                # Again and again: pushing one bank of lockers flat frequently
                # frees the tile the next one needed, and each pass is cheap.
                #
                # Bounded, because two of these buildings do not settle. A pass
                # accepts any move that leaves the map no worse, and "no worse"
                # is not "better" — so an office chair can be pushed north on
                # one pass and south on the next, forever, and the loop that
                # ran to exhaustion on the school (twelve passes, five levels)
                # ran to exhaustion for good on the office. Twenty is well past
                # where every building that does settle has settled; the two
                # that do not are stopped mid-shuffle with their furniture
                # against a wall either way, which is the whole point of it.
                for _ in range(20):
                    if not snug_to_walls(g):
                        break
            spots, climb_into = HIDES[name]
            add_hides(g, spots, into=climb_into)
            underfoot, sweeping = LITTER_AT[name]
            add_litter(g, tier, underfoot, sweeping)
            fittings, light_step = FITTINGS[name]
            add_fittings(g, tier, fittings, light_step)
            # ...and the one or two things that say who was here and what they
            # were doing. Last of the dressing passes, so it can see everything
            # already placed and avoid standing on top of it.
            add_story(g, tier, STORY[name])
            stashes = make_searchable(g, tier, name)
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
