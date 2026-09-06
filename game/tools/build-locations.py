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


def scatter(g, tier, spots):
    """Drop loot at roughly these tiles, snapping each onto real floor."""
    loot = Loot(tier)
    for (x, y) in spots:
        g.drop(x, y, loot.next())


# --------------------------------------------------------------- room grammars
# Each grammar builds one kind of building. They take the tier so the same
# grammar produces a small two-room flat and a sprawling one, and they all leave
# the same things behind: an outer wall, interior walls with doorways, one
# watcher, one spawn, one way out.

def corridor_plan(g, tier, top, bottom, furnish, corridor_rows=6, exit_side='left'):
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
    # One doorway per room, centred, three tiles wide.
    for (x, w) in tops:
        g.fill(x + w // 2 - 1, y1, 3, 1, 'D')
    for (x, w) in bots:
        g.fill(x + w // 2 - 1, y2, 3, 1, 'D')

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
PROX_NEAR, PROX_FAR = 92.0, 320.0
PROX_NEAR_SCALE, PROX_FAR_SCALE = 2.5, 0.45
SEARCH_NOISE = {'table': 3, 'nightstand': 3, 'chest': 4, 'tvBench': 4,
                'sofa': 2, 'wardrobe': 5, 'bookshelf': 5, 'plinth': 6}
ITEM_NOISE = {'c': 3, 'w': 6, 'p': 8, 'k': 11, 'r': 13, 'm': 14, 't': 15,
              'n': 18, 'l': 22, 'v': 30, 'j': 16, 'd': 32, 'g': 38}

# The most one cupboard may cost. The meter holds 100, you arrive with some of it
# already spent, and you still have to walk away afterwards — so a single search
# that can run to eighty is not a risk, it is a trap. Sixty leaves somewhere to go.
COST_CEILING = 60


# What the school multiplies noise by at this range. Same curve as rules.js.
def proximity(distance):
    if distance <= PROX_NEAR:
        return PROX_NEAR_SCALE
    if distance >= PROX_FAR:
        return PROX_FAR_SCALE
    t = (distance - PROX_NEAR) / (PROX_FAR - PROX_NEAR)
    return PROX_NEAR_SCALE + (PROX_FAR_SCALE - PROX_NEAR_SCALE) * (t * t * (3 - 2 * t))


TIER_STASHES = [3, 5, 7, 9, 10]
TIER_FILLED = [2, 3, 4, 5, 6]

# What turns up inside, worst first. A tier draws from the front of its own list
# and the best of them goes in the piece nearest Mr. Vrána — which is the whole
# point of level five: the good stuff is where you least want to be standing.
# Best first: the front of each list lands in the piece nearest Mr. Vrána.
TIER_STASH_LOOT = [
    ['w', 'c'],                          # a wallet, then coins
    ['k', 'w', 'c'],                     # headphones
    ['r', 'k', 'p', 'w'],                # a ring
    ['n', 'j', 'r', 'k', 'p'],           # a games console, jewellery
    ['d', 'v', 'l', 'n', 'j', 'r'],      # a diamond, in the worst place on the map
]

# Furniture a person would actually open. Desks and cabinets yes; the couch the
# caretaker is asleep on, obviously not.
SEARCHABLE_STYLES = {'C': 'chest', 'B': 'bookshelf', 'W': 'wardrobe',
                     'T': 'table', 'V': 'tvBench'}
STASH_CHARS = '1234567890'


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


def make_searchable(g, tier):
    """Turn some of the school's furniture into things you can look inside.

    Returns the legend the level needs: digit -> {style, item}. Nothing else
    about the map changes — a searchable cabinet is the same cabinet, in the
    same place, blocking the same route.
    """
    watcher = None
    for y in range(g.rows):
        for x in range(g.cols):
            if g.g[y][x] == 'E':
                watcher = (x, y)
                break
        if watcher:
            break

    blobs = [b for b in _blobs(g, SEARCHABLE_STYLES) if 2 <= len(b[1]) <= 24]
    if not blobs:
        return {}

    def key(blob):
        cells = blob[1]
        cx = sum(c[0] for c in cells) / len(cells)
        cy = sum(c[1] for c in cells) / len(cells)
        far = ((cx - watcher[0]) ** 2 + (cy - watcher[1]) ** 2) ** 0.5 if watcher else 0
        return (far, cx, cy)

    def spread(blob):
        cells = blob[1]
        cx = sum(c[0] for c in cells) / len(cells)
        cy = sum(c[1] for c in cells) / len(cells)
        if not watcher:
            return 0.0
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
            placed = free[-1]        # nowhere safe: the furthest is the least bad
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
    top = [2, 2, 3, 3, 3][tier]
    bottom = [1, 2, 2, 2, 3][tier]

    def furnish(tops, ty, th, bots, by, bh, cy, ch):
        placed = []
        for i, (x, w) in enumerate(tops):     # classrooms: rows of desks
            for r in range(max(2, th // 5)):
                yy = ty + 2 + r * 4
                if yy + 2 >= ty + th:
                    break
                g.fill(x + 1, yy, max(3, w // 3), 2, 'T')
                if w > 11:
                    g.fill(x + w - max(3, w // 3) - 1, yy, max(3, w // 3), 2, 'T')
            placed.append((x + w // 2, ty + th - 2))
        for i, (x, w) in enumerate(bots):     # gym, staff room, stores
            if i == len(bots) - 1:
                # The staff room: Mr. Vrána's couch and nothing else in the way.
                place_watcher(g, x, by, w, bh, 7, 3)
                placed.append((x + 2, by + bh - 3))
                continue
            g.fill(x + 1, by + 1, max(4, w - 4), 2, 'S')
            if bh > 7:
                g.fill(x + 1, by + bh - 4, max(4, w - 6), 2, 'B')
            placed.append((x + w // 2, by + bh // 2))
        # Lockers along the corridor, away from the doorways.
        for (x, w) in tops[:-1]:
            g.fill(x + w - 3, cy + 2, 3, max(1, ch - 4), 'C')
        scatter(g, tier, placed)

    corridor_plan(g, tier, top, bottom, furnish)


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
            stashes = make_searchable(g, tier) if name == 'School' else {}
            if g.bad:
                problems.append(f'{name} L{tier + 1}: {g.bad}')
            base = SIGHT_BASE.get(watcher, 0)
            out.append(dict(id=lid, name=name, theme=theme, watcher=watcher,
                            seated=seated, tier=tier + 1, location=name,
                            sight=round(base * TIER_SIGHT[tier]) if base else 0,
                            stashes=stashes,
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
            "    legend: LOOT,\n"
            "    tiles: [\n%s\n    ]\n"
            "  }),"
            % (lv['id'], title, lv['tier'], '-' * 20, lv['id'], quoted, quoted,
               lv['tier'], lv['theme'], lv['watcher'], str(lv['seated']).lower(),
               ('    sight: %d,\n' % lv['sight']) if lv['sight'] else '',
               ('    clock: %d,\n' % clock) if clock else '',
               stash_legend(lv.get('stashes')), rows))
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
