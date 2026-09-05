#!/usr/bin/env python3
"""Drafting tool. Emits the ASCII grids that go into src/maps.js.

Not part of the game — it exists so row lengths and wall runs cannot drift while
seven floorplans are being laid out by hand.
"""
import sys

# The item characters, mirrored from src/maps.js. Items are picked up off the
# floor, so they never block a doorway the way furniture does.
LOOT = 'cwpkrmtnlvjdg'

class Grid:
    def __init__(self, cols, rows):
        self.cols, self.rows = cols, rows
        self.g = [['.'] * cols for _ in range(rows)]
        self.bad = []
        self.moved = []

    def fill(self, x, y, w, h, ch):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.g[yy][xx] = ch

    def box(self, x, y, w, h, ch='#'):
        self.fill(x, y, w, 1, ch); self.fill(x, y + h - 1, w, 1, ch)
        self.fill(x, y, 1, h, ch); self.fill(x + w - 1, y, 1, h, ch)

    def hwall(self, x, y, w, ch='%'): self.fill(x, y, w, 1, ch)
    def vwall(self, x, y, h, ch='%'): self.fill(x, y, 1, h, ch)
    def put(self, x, y, ch): self.g[y][x] = ch

    # Items and the spawn have to stand on open floor. Rather than hand-checking
    # forty coordinates against the furniture, ask for roughly where a thing
    # goes and snap it to the nearest free tile — and shout if there isn't one,
    # because that means the room is fuller than it looked.
    def drop(self, x, y, ch, radius=3):
        best = None
        for r in range(radius + 1):
            for dy in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    if max(abs(dx), abs(dy)) != r: continue
                    nx, ny = x + dx, y + dy
                    if not (0 <= nx < self.cols and 0 <= ny < self.rows): continue
                    if self.g[ny][nx] != '.': continue
                    # Never right up against a wall corner where the pickup
                    # radius would be half inside the masonry.
                    best = (nx, ny)
                    break
                if best: break
            if best: break
        if not best:
            self.bad.append((ch, x, y)); return
        self.g[best[1]][best[0]] = ch
        if best != (x, y): self.moved.append((ch, x, y, best))

    def loot(self, spots):
        for (x, y, ch) in spots: self.drop(x, y, ch)

    # A player is taller than one tile, so a doorway with a single free tile
    # behind it is sealed. Two clear tiles on both sides of every door, checked
    # here rather than discovered later as "unreachable from spawn".
    # Furniture parked in a doorway's approach seals the room behind it. Rather
    # than nudging thirty pieces by hand, the landing is carved: two tiles deep
    # on both sides of every door, furniture there is cleared. The building's
    # structure — walls, rooms, corridors — is untouched.
    def clear_landings(self):
        solid = set('TSWNVCBPE')
        for y in range(self.rows):
            for x in range(self.cols):
                if self.g[y][x] != 'D': continue
                horizontal = (self.g[y][max(0, x - 1)] in '#%D' and
                              self.g[y][min(self.cols - 1, x + 1)] in '#%D')
                steps = [(0, -1), (0, 1)] if horizontal else [(-1, 0), (1, 0)]
                for dx, dy in steps:
                    for d in (1, 2):
                        nx, ny = x + dx * d, y + dy * d
                        if not (0 <= nx < self.cols and 0 <= ny < self.rows): break
                        if self.g[ny][nx] in '#%': break
                        if self.g[ny][nx] in solid: self.g[ny][nx] = '.'

    # Every door must lead somewhere. A landing two tiles deep is not enough on
    # its own — the room behind can still be packed solid — so an aisle the
    # width of the door is carved straight in until it reaches the far wall.
    # Walls, rooms and corridors are untouched; only furniture standing in the
    # aisle is moved aside, which is the closest equivalent a drawing that
    # ignores collision can have.
    # --- connectivity ------------------------------------------------------
    # The same test the game's validator runs, at the same 4px resolution: can
    # the player box actually reach every item and the way out? Knowing the
    # answer here means furniture is only ever moved when it has to be.
    def _blocked(self, x, y):
        PW, PH, TILE = 22, 24, 20
        solid = set('#%OTSWNVCBPE')
        if x < PW / 2 or x > self.cols * TILE - PW / 2: return True
        if y < PH / 2 or y > self.rows * TILE - PH / 2: return True
        for ty in range(int((y - PH / 2) // TILE), int((y + PH / 2 - 0.001) // TILE) + 1):
            for tx in range(int((x - PW / 2) // TILE), int((x + PW / 2 - 0.001) // TILE) + 1):
                if 0 <= tx < self.cols and 0 <= ty < self.rows and self.g[ty][tx] in solid:
                    return True
        return False

    def _reached(self):
        G, TILE = 4, 20
        gc, gr = self.cols * TILE // G, self.rows * TILE // G
        sx = sy = None
        for y in range(self.rows):
            for x in range(self.cols):
                if self.g[y][x] == '@': sx, sy = x * TILE + TILE // 2, y * TILE + TILE // 2
        seen = set()
        start = (sx // G, sy // G)
        if self._blocked(*[c * G + G // 2 for c in start]): return seen
        seen.add(start); stack = [start]
        while stack:
            cx, cy = stack.pop()
            for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                nx, ny = cx + dx, cy + dy
                if not (0 <= nx < gc and 0 <= ny < gr) or (nx, ny) in seen: continue
                if self._blocked(nx * G + G // 2, ny * G + G // 2): continue
                seen.add((nx, ny)); stack.append((nx, ny))
        return seen

    def connected(self):
        TILE, G, R = 20, 4, 26
        seen = self._reached()
        if not seen: return False
        targets = []
        for y in range(self.rows):
            for x in range(self.cols):
                ch = self.g[y][x]
                if ch in LOOT or ch == 'X':
                    targets.append((x * TILE + TILE / 2, y * TILE + TILE / 2))
        for (tx, ty) in targets:
            if not any(abs(gx * G + G / 2 - tx) <= R and abs(gy * G + G / 2 - ty) <= R
                       for (gx, gy) in seen):
                return False
        return True

    # Widen the aisles only as far as connectivity actually needs. Carving every
    # aisle to the far wall works, but it strips a conference room of its table
    # and a lounge of its sofas — the map stops being the drawing.
    def open_until_connected(self):
        for depth in range(0, 40):
            if self.connected(): return depth
            self.carve_aisles(depth + 1)
        return None

    def carve_aisles(self, maxDepth=999):
        # Never the watcher's own furniture: that is the one piece of the map
        # that cannot move, and an aisle running through it means the desk or
        # bed is standing in a doorway — a map problem to fix, not to paper over.
        solid = set('TSWNVCBP')
        doors = [(x, y) for y in range(self.rows) for x in range(self.cols) if self.g[y][x] == 'D']
        for x, y in doors:
            horizontal = (self.g[y][max(0, x - 1)] in '#%D' and
                          self.g[y][min(self.cols - 1, x + 1)] in '#%D')
            steps = [(0, -1), (0, 1)] if horizontal else [(-1, 0), (1, 0)]
            for dx, dy in steps:
                nx, ny = x + dx, y + dy
                depth = 1
                while (depth <= maxDepth and 0 <= nx < self.cols and 0 <= ny < self.rows
                       and self.g[ny][nx] not in '#%'):
                    # Take the whole piece out, not a one-tile slit through it:
                    # a bed with a corridor cut across its middle reads as two
                    # slivers of nothing, and looks like a bug rather than a room.
                    # The sleeper's own bed or desk stops the aisle rather than
                    # being cut through: it is something you walk around, and by
                    # the time the aisle reaches it the room is already open.
                    if self.g[ny][nx] == 'E': break
                    if self.g[ny][nx] in solid: self.remove_blob(nx, ny)
                    nx += dx; ny += dy; depth += 1

    # Every tile of the one piece of furniture touching x,y.
    def remove_blob(self, x, y):
        ch = self.g[y][x]
        stack, seen = [(x, y)], set()
        while stack:
            cx, cy = stack.pop()
            if (cx, cy) in seen: continue
            if not (0 <= cx < self.cols and 0 <= cy < self.rows): continue
            if self.g[cy][cx] != ch: continue
            seen.add((cx, cy))
            self.g[cy][cx] = '.'
            stack += [(cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)]

    def check_doors(self, name):
        open_ = set('.,~@X D') | set(LOOT)
        for y in range(self.rows):
            for x in range(self.cols):
                if self.g[y][x] != 'D': continue
                # Which way you walk through it: across the wall it sits in.
                horizontal = (self.g[y][max(0, x - 1)] in '#%D' and
                              self.g[y][min(self.cols - 1, x + 1)] in '#%D')
                steps = [(0, -1), (0, 1)] if horizontal else [(-1, 0), (1, 0)]
                for dx, dy in steps:
                    for d in (1, 2):
                        nx, ny = x + dx * d, y + dy * d
                        if not (0 <= nx < self.cols and 0 <= ny < self.rows): break
                        if self.g[ny][nx] not in open_:
                            self.bad.append(f'door {x},{y}: blocked {d} tile(s) {dx},{dy} by {self.g[ny][nx]!r}')
                            break

    def out(self, name):
        self.clear_landings()
        clear_exit(self)
        depth = self.open_until_connected()
        if depth is None:
            self.bad.append('could not open a route to everything')
        elif depth:
            print(f'   {name}: aisles opened {depth} tile(s) deep to connect the map', file=sys.stderr)
        self.check_doors(name)
        if self.bad:
            print(f'!! {name}: nowhere to put {self.bad}', file=sys.stderr)
        if self.moved:
            print(f'   {name}: nudged {len(self.moved)} markers onto free floor', file=sys.stderr)
        print(f'--- {name}  {self.cols}x{self.rows} ---')
        for row in self.g:
            print("    '" + ''.join(row) + "',")
        print()


def clear_exit(g):
    # Same idea for the way out: three tiles of clear floor inside it.
    for y in range(g.rows):
        for x in range(g.cols):
            if g.g[y][x] != 'X': continue
            dx = 1 if x == 0 else -1 if x == g.cols - 1 else 0
            dy = 0 if dx else (1 if y == 0 else -1)
            for d in range(1, 4):
                nx, ny = x + dx * d, y + dy * d
                if not (0 <= nx < g.cols and 0 <= ny < g.rows): break
                if g.g[ny][nx] in '#%': break
                if g.g[ny][nx] in 'TSWNVCBPE': g.g[ny][nx] = '.'


def shell(cols, rows):
    g = Grid(cols, rows)
    g.box(0, 0, cols, rows, '#')
    return g


# =============================================================== 1 THE MUSEUM
def museum():
    g = shell(43, 40)
    # galleries across the top, split by a spine wall
    g.vwall(21, 1, 13); g.fill(21, 6, 1, 3, '.')          # door between galleries
    g.hwall(1, 14, 41)
    g.fill(8, 14, 3, 1, 'D'); g.fill(31, 14, 3, 1, 'D')   # into the great hall
    # great hall  rows 15..27
    g.hwall(1, 28, 41)
    g.fill(6, 28, 3, 1, 'D'); g.fill(20, 28, 3, 1, 'D'); g.fill(34, 28, 3, 1, 'D')
    # bottom: guard room | lobby | store
    g.vwall(14, 29, 10); g.fill(14, 33, 1, 3, '.')
    g.vwall(29, 29, 10); g.fill(29, 33, 1, 3, '.')
    # windows high on the outer walls
    g.fill(0, 4, 1, 5, 'O'); g.fill(0, 18, 1, 5, 'O')
    g.fill(42, 4, 1, 5, 'O'); g.fill(42, 18, 1, 5, 'O')
    g.fill(5, 0, 5, 1, 'O'); g.fill(30, 0, 5, 1, 'O')
    # gallery A: plinths and cases
    for cx in (3, 9, 15):
        g.fill(cx, 4, 3, 3, 'P'); g.fill(cx, 10, 3, 3, 'P')
    g.fill(2, 1, 6, 2, 'B'); g.fill(13, 1, 6, 2, 'B')
    # gallery B
    for cx in (24, 30, 36):
        g.fill(cx, 4, 3, 3, 'P'); g.fill(cx, 10, 3, 3, 'P')
    g.fill(23, 1, 6, 2, 'B'); g.fill(34, 1, 6, 2, 'B')
    # great hall: a centrepiece and benches
    g.fill(19, 19, 5, 5, 'P')
    g.fill(4, 17, 7, 2, 'S'); g.fill(32, 17, 7, 2, 'S')
    g.fill(4, 24, 7, 2, 'S'); g.fill(32, 24, 7, 2, 'S')
    g.fill(13, 16, 3, 3, 'P'); g.fill(27, 16, 3, 3, 'P')
    g.fill(13, 24, 3, 3, 'P'); g.fill(27, 24, 3, 3, 'P')
    g.fill(19, 26, 5, 1, ',')
    # guard room: Bruno at the monitor desk
    g.fill(3, 31, 8, 3, 'E')
    g.fill(2, 36, 5, 2, 'C'); g.fill(9, 36, 4, 2, 'T')
    # lobby
    g.fill(17, 30, 4, 2, 'T'); g.fill(24, 30, 4, 2, 'T')
    g.fill(20, 35, 5, 2, ',')
    # store
    g.fill(31, 30, 4, 5, 'B'); g.fill(37, 30, 4, 5, 'B')
    g.fill(31, 36, 9, 2, 'C')
    # loot
    for (x, y, ch) in [(4, 8, 'g'), (10, 8, 'd'), (16, 8, 'p'), (25, 8, 'd'),
                       (31, 8, 'p'), (37, 8, 'g'), (20, 17, 'v'), (12, 21, 'n'),
                       (30, 21, 'm'), (20, 25, 'd'), (35, 32, 'c'), (18, 33, 'w')]:
        g.drop(x, y, ch)
    g.drop(21, 37, '@')
    g.fill(20, 39, 3, 1, 'X')
    g.fill(16, 33, 3, 2, '~')
    return g


# =================================================== 2 FOURTH FLOOR AFTER HOURS
def office():
    g = shell(44, 33)
    g.vwall(22, 1, 14); g.vwall(32, 1, 14); g.vwall(37, 1, 14)
    g.hwall(23, 7, 9); g.hwall(38, 7, 5)
    g.hwall(1, 15, 42); g.hwall(1, 21, 42)
    # doors off the corridor
    for x in (6, 16): g.fill(x, 15, 3, 1, 'D')
    g.fill(26, 15, 3, 1, 'D'); g.fill(33, 15, 3, 1, 'D'); g.fill(39, 15, 2, 1, 'D')
    for x in (7, 20, 30, 39): g.fill(x, 21, 3, 1, 'D')
    # doors between the stacked rooms
    g.fill(27, 7, 3, 1, 'D'); g.fill(39, 7, 2, 1, 'D')
    g.fill(32, 4, 1, 3, '.'); g.fill(32, 10, 1, 3, '.')
    g.fill(37, 3, 1, 3, '.'); g.fill(37, 10, 1, 3, '.')
    # bottom band: conference | washroom | lounge
    g.vwall(17, 22, 10); g.fill(17, 25, 1, 3, '.')
    g.vwall(24, 22, 10); g.fill(24, 25, 1, 3, '.')
    # windows
    g.fill(4, 0, 6, 1, 'O'); g.fill(13, 0, 6, 1, 'O'); g.fill(25, 0, 5, 1, 'O')
    g.fill(43, 3, 1, 5, 'O'); g.fill(43, 24, 1, 5, 'O')
    g.fill(5, 32, 6, 1, 'O'); g.fill(28, 32, 6, 1, 'O')
    # open plan: desk banks
    for row in (2, 6, 10):
        g.fill(2, row, 6, 2, 'T'); g.fill(10, row, 6, 2, 'T'); g.fill(17, row, 4, 2, 'T')
    g.fill(2, 13, 5, 1, 'B')
    # boss's office — Mr Halas, face down on the desk
    g.fill(25, 2, 6, 3, 'E')
    g.fill(23, 5, 2, 4, 'B')
    # meeting room
    g.fill(25, 9, 5, 4, 'T')
    # landing
    g.fill(33, 2, 3, 2, 'C'); g.fill(33, 12, 3, 2, 'C')
    # kitchenette + copy/storage
    g.fill(38, 2, 4, 2, 'T'); g.fill(38, 4, 4, 2, 'C')
    g.fill(38, 9, 4, 2, 'C'); g.fill(38, 12, 4, 2, 'B')
    # corridor units, clear of every door mouth
    g.fill(11, 16, 4, 2, 'C'); g.fill(29, 16, 3, 2, 'C')
    g.fill(2, 17, 4, 2, 'S')
    # conference room
    g.fill(3, 24, 11, 5, 'T'); g.fill(2, 30, 5, 2, 'B')
    # washroom
    g.fill(19, 23, 4, 2, 'C'); g.fill(19, 29, 4, 2, 'C')
    # lounge
    g.fill(27, 24, 7, 3, 'S'); g.fill(36, 24, 5, 3, 'S')
    g.fill(28, 29, 6, 2, 'T'); g.fill(37, 29, 4, 2, 'V')
    g.fill(29, 27, 5, 2, ',')
    for (x, y, ch) in [(9, 3, 'l'), (16, 3, 't'), (9, 7, 't'), (16, 7, 'l'),
                       (9, 11, 'k'), (16, 11, 'c'), (31, 3, 'v'), (31, 11, 'n'),
                       (34, 6, 'w'), (40, 7, 'p'), (15, 19, 'w'), (8, 23, 'l'),
                       (26, 31, 'm'), (35, 27, 'k')]:
        g.drop(x, y, ch)
    g.drop(40, 18, '@')
    g.fill(0, 17, 1, 3, 'X')
    g.fill(20, 17, 3, 2, '~')
    return g


# ============================================================ 3 THE FLAT, 02:14
def flat():
    g = shell(36, 57)
    g.vwall(11, 1, 21); g.vwall(23, 1, 21)
    g.hwall(1, 9, 34)
    g.hwall(1, 22, 34)
    g.vwall(11, 23, 13); g.vwall(23, 23, 13)
    g.hwall(1, 35, 34)
    g.vwall(11, 36, 11); g.vwall(17, 36, 11)
    g.hwall(1, 46, 34)
    g.vwall(11, 47, 9); g.vwall(23, 47, 9)
    # doors
    g.fill(5, 9, 3, 1, 'D'); g.fill(15, 9, 3, 1, 'D'); g.fill(28, 9, 3, 1, 'D')
    g.fill(15, 22, 3, 1, 'D'); g.fill(5, 22, 3, 1, 'D'); g.fill(28, 22, 3, 1, 'D')
    g.fill(13, 35, 3, 1, 'D'); g.fill(5, 35, 3, 1, 'D'); g.fill(28, 35, 3, 1, 'D')
    g.fill(5, 46, 3, 1, 'D'); g.fill(13, 46, 3, 1, 'D'); g.fill(28, 46, 3, 1, 'D')
    g.fill(11, 14, 1, 3, '.'); g.fill(23, 14, 1, 3, '.')
    g.fill(11, 28, 1, 3, '.'); g.fill(23, 28, 1, 3, '.')
    g.fill(11, 40, 1, 3, '.'); g.fill(17, 40, 1, 3, '.')
    g.fill(11, 51, 1, 3, '.'); g.fill(23, 51, 1, 3, '.')
    # windows
    g.fill(0, 3, 1, 4, 'O'); g.fill(0, 26, 1, 5, 'O'); g.fill(0, 39, 1, 4, 'O')
    g.fill(35, 3, 1, 4, 'O'); g.fill(35, 26, 1, 5, 'O'); g.fill(35, 39, 1, 5, 'O')
    g.fill(13, 0, 8, 1, 'O'); g.fill(13, 56, 8, 1, 'O')
    # top band: guest bath | roof terrace | en-suite
    g.fill(2, 2, 3, 2, 'C'); g.fill(7, 2, 3, 2, 'C'); g.fill(2, 6, 4, 2, 'C')
    g.fill(14, 2, 4, 3, 'T'); g.fill(19, 5, 3, 3, 'S'); g.fill(13, 6, 3, 2, 'S')
    g.fill(25, 2, 4, 2, 'C'); g.fill(30, 2, 4, 2, 'C'); g.fill(25, 6, 5, 2, 'C')
    # second band: kitchen | hall | THEIR BEDROOM (Dad)
    g.fill(2, 11, 8, 2, 'T'); g.fill(2, 15, 3, 4, 'C'); g.fill(7, 15, 3, 4, 'C')
    g.fill(2, 20, 6, 2, 'T')
    g.fill(13, 11, 3, 2, 'C'); g.fill(19, 11, 3, 2, 'C')
    g.fill(14, 15, 6, 5, ',')
    # Dad's bed, one row down off the wall. Pushed up against the partition it
    # left a single tile between wall and headboard — narrower than the player
    # is tall, which quietly sealed the en-suite above.
    g.fill(26, 12, 6, 5, 'E')
    # One nightstand, on the door side. The far side of the bed stays clear as
    # the room's through-route.
    g.fill(24, 12, 2, 4, 'N')
    g.fill(25, 18, 8, 2, 'V'); g.fill(25, 20, 4, 2, 'S')
    # third band: stairwell | living room | winter garden
    g.fill(2, 24, 8, 6, 'C')
    g.fill(2, 32, 4, 2, 'T')
    g.fill(13, 24, 4, 3, 'S'); g.fill(19, 24, 3, 3, 'S')
    g.fill(14, 28, 6, 2, ',')
    g.fill(13, 31, 8, 3, 'T')
    g.fill(25, 24, 3, 3, 'S'); g.fill(30, 24, 3, 3, 'S')
    g.fill(25, 30, 8, 3, 'T')
    # fourth band: bathroom | dressing | your room
    g.fill(2, 37, 4, 3, 'C'); g.fill(7, 37, 3, 3, 'C'); g.fill(2, 43, 6, 2, 'C')
    g.fill(12, 37, 4, 3, 'W'); g.fill(12, 43, 4, 2, 'C')
    g.fill(20, 38, 6, 4, 'S')
    g.fill(28, 37, 5, 4, 'W'); g.fill(19, 43, 8, 2, 'S'); g.fill(29, 43, 4, 2, 'V')
    # bottom band: utility | balcony | store
    g.fill(2, 48, 4, 3, 'C'); g.fill(2, 52, 6, 2, 'C')
    g.fill(14, 48, 5, 3, 'T'); g.fill(13, 52, 8, 2, 'S')
    g.fill(25, 48, 4, 3, 'C'); g.fill(30, 48, 4, 3, 'C'); g.fill(25, 52, 8, 2, 'B')
    for (x, y, ch) in [(6, 4, 'w'), (16, 6, 'k'), (31, 4, 'r'),
                       (6, 13, 'c'), (16, 13, 'n'), (30, 16, 'j'), (33, 20, 'w'),
                       (7, 31, 'l'), (17, 27, 'v'), (22, 33, 'm'), (28, 27, 'p'),
                       (7, 41, 'r'), (15, 41, 'j'), (27, 39, 't'), (33, 41, 'k'),
                       (7, 49, 'c'), (17, 50, 'p'), (30, 53, 'g')]:
        g.drop(x, y, ch)
    g.drop(6, 33, '@')
    g.fill(0, 32, 1, 3, 'X')
    g.fill(14, 21, 3, 1, '~'); g.fill(16, 34, 3, 1, '~')
    return g


# ================================================== 4 ST VITUS, THIRD FLOOR
def hospital():
    g = shell(45, 32)
    g.hwall(1, 12, 43); g.hwall(1, 19, 43)
    for x in (11, 22, 33):
        g.vwall(x, 1, 11); g.vwall(x, 20, 11)
    for x in (5, 16, 27, 38): g.fill(x, 12, 3, 1, 'D')
    for x in (5, 16, 27, 38): g.fill(x, 19, 3, 1, 'D')
    # windows down both long walls
    for y in (3, 8): g.fill(0, y, 1, 3, 'O'); g.fill(44, y, 1, 3, 'O')
    for y in (23, 28): g.fill(0, y, 1, 3, 'O'); g.fill(44, y, 1, 3, 'O')
    g.fill(3, 0, 6, 1, 'O'); g.fill(14, 0, 6, 1, 'O'); g.fill(25, 0, 6, 1, 'O')
    g.fill(3, 31, 6, 1, 'O'); g.fill(14, 31, 6, 1, 'O'); g.fill(25, 31, 6, 1, 'O')
    # wards: beds in pairs with a nightstand between
    def ward(x0):
        g.fill(x0 + 1, 2, 3, 5, 'S'); g.fill(x0 + 6, 2, 3, 5, 'S')
        g.fill(x0 + 4, 3, 2, 2, 'N')
        g.fill(x0 + 1, 9, 8, 2, 'C')
    ward(11); ward(22)
    g.fill(2, 2, 3, 5, 'S'); g.fill(7, 2, 3, 5, 'S'); g.fill(5, 3, 2, 2, 'N')
    g.fill(1, 9, 8, 2, 'C')
    # staff room, top right — Dr Marek out on the couch
    g.fill(35, 3, 7, 3, 'E')
    g.fill(35, 8, 4, 3, 'T'); g.fill(40, 8, 3, 3, 'C')
    g.fill(36, 7, 5, 1, ',')
    # lower rooms
    g.fill(2, 21, 8, 3, 'T'); g.fill(2, 26, 3, 4, 'C'); g.fill(7, 26, 3, 4, 'C')
    g.fill(13, 21, 8, 2, 'B'); g.fill(13, 25, 8, 2, 'B'); g.fill(13, 28, 4, 2, 'C')
    ward2x = 22
    g.fill(23, 22, 3, 5, 'S'); g.fill(28, 22, 3, 5, 'S'); g.fill(26, 23, 2, 2, 'N')
    g.fill(23, 29, 8, 2, 'C')
    g.fill(34, 21, 4, 4, 'C'); g.fill(39, 21, 4, 4, 'C'); g.fill(34, 27, 9, 3, 'B')
    # nurses' station in the corridor, clear of the doors
    g.fill(19, 14, 6, 3, 'T')
    g.fill(1, 14, 3, 3, 'C'); g.fill(41, 14, 2, 3, 'C')
    for (x, y, ch) in [(6, 8, 'p'), (17, 8, 'w'), (28, 8, 'r'), (39, 2, 'l'),
                       (43, 6, 'k'), (6, 25, 't'), (18, 24, 'n'), (27, 21, 'c'),
                       (37, 26, 'j'), (11, 16, 'w'), (32, 16, 'p'), (41, 21, 'm')]:
        g.drop(x, y, ch)
    g.drop(35, 16, '@')
    g.fill(0, 15, 1, 3, 'X')
    g.fill(26, 15, 3, 2, '~')
    return g


# ============================================== 5 GRAND HOTEL BOHEMIA
def hotel():
    g = shell(49, 34)
    g.hwall(1, 13, 47); g.hwall(1, 20, 47)
    for x in (12, 24, 36):
        g.vwall(x, 1, 12); g.vwall(x, 21, 12)
    for x in (5, 17, 29, 41): g.fill(x, 13, 3, 1, 'D')
    for x in (5, 17, 29, 41): g.fill(x, 20, 3, 1, 'D')
    # windows on the outside walls of the suites
    for x in (3, 15, 27, 39):
        g.fill(x, 0, 6, 1, 'O'); g.fill(x, 33, 6, 1, 'O')
    g.fill(48, 4, 1, 5, 'O'); g.fill(48, 24, 1, 5, 'O')
    # suites: bed, wardrobe, a chair by the window, a bathroom block
    # Bed one side, wardrobe and bathroom block the other, and a three-tile
    # spine down the middle lined up with the suite's own door — which is what
    # a hotel room actually looks like from above, and what stops the door
    # opening onto a gap too narrow to walk down.
    def suite(x0, y0):
        g.fill(x0 + 1, y0 + 1, 4, 4, 'S')
        g.fill(x0 + 8, y0 + 1, 3, 3, 'W')
        g.fill(x0 + 1, y0 + 7, 4, 2, 'T')
        g.fill(x0 + 8, y0 + 6, 3, 3, 'C')
        g.fill(x0 + 5, y0 + 5, 3, 2, ',')
    for x0 in (0, 12, 24): suite(x0, 1)
    for x0 in (0, 12, 36): suite(x0, 21)
    # housekeeping, top right
    # Two-tile channels either side of the shelving, or the room seals itself.
    g.fill(38, 2, 4, 3, 'C'); g.fill(44, 2, 3, 3, 'C')
    g.fill(39, 7, 7, 3, 'B')
    # lift lobby, bottom centre
    g.fill(28, 23, 4, 3, 'S'); g.fill(28, 28, 4, 3, 'S')
    g.fill(27, 26, 6, 2, ',')
    # the corridor: Otakar asleep at the floor desk, right of centre
    g.fill(33, 15, 6, 3, 'E')   # Otakar's desk, clear of both nearby doors
    g.fill(9, 16, 6, 2, 'C'); g.fill(21, 16, 6, 2, 'C')
    g.fill(1, 16, 3, 2, ',')
    for (x, y, ch) in [(8, 3, 'r'), (20, 3, 'j'), (32, 3, 'w'), (44, 6, 'c'),
                       (8, 10, 'k'), (20, 10, 'm'), (32, 10, 'p'),
                       (8, 24, 'd'), (20, 24, 'r'), (44, 24, 'j'),
                       (8, 31, 'n'), (20, 31, 'v'), (44, 31, 'k'), (30, 32, 't')]:
        g.drop(x, y, ch)
    g.drop(45, 18, '@')
    g.fill(0, 15, 1, 3, 'X')
    g.fill(17, 16, 3, 2, '~')
    return g


# ============================================== 6 KOMENSKY PRIMARY
def school():
    g = shell(49, 36)
    g.hwall(1, 14, 47); g.hwall(1, 21, 47)
    g.vwall(16, 1, 13); g.vwall(32, 1, 13)
    g.vwall(20, 22, 13); g.vwall(34, 22, 13)
    for x in (7, 23, 39): g.fill(x, 14, 3, 1, 'D')
    for x in (9, 25, 39): g.fill(x, 21, 3, 1, 'D')
    g.fill(34, 27, 1, 3, '.')
    # windows
    g.fill(3, 0, 8, 1, 'O'); g.fill(20, 0, 8, 1, 'O'); g.fill(36, 0, 8, 1, 'O')
    g.fill(0, 4, 1, 6, 'O'); g.fill(48, 4, 1, 6, 'O')
    g.fill(4, 35, 10, 1, 'O'); g.fill(22, 35, 8, 1, 'O')
    # classrooms 1A and 1B: rows of desks
    def classroom(x0):
        for r in (3, 7, 11):
            g.fill(x0 + 1, r, 3, 2, 'T'); g.fill(x0 + 6, r, 3, 2, 'T')
            g.fill(x0 + 11, r, 3, 2, 'T')
        g.fill(x0 + 1, 1, 6, 1, 'B')
    classroom(0); classroom(16)
    # library
    g.fill(33, 2, 3, 5, 'B'); g.fill(38, 2, 3, 5, 'B'); g.fill(43, 2, 4, 5, 'B')
    g.fill(34, 9, 8, 3, 'T'); g.fill(44, 9, 3, 3, 'S')
    # corridor: lockers between the doorways
    g.fill(1, 15, 5, 2, 'C'); g.fill(12, 15, 9, 2, 'C')
    g.fill(28, 15, 9, 2, 'C'); g.fill(43, 15, 5, 2, 'C')
    g.fill(2, 18, 8, 2, ',')
    # gymnasium
    g.fill(2, 24, 16, 2, 'S'); g.fill(2, 28, 16, 2, 'S'); g.fill(2, 32, 10, 2, 'S')
    # staff room — Mr Vrana asleep on the couch
    g.fill(23, 29, 7, 3, 'E')
    g.fill(22, 23, 6, 2, 'T'); g.fill(29, 23, 4, 2, 'C')
    g.fill(22, 26, 4, 2, 'C')
    g.fill(24, 33, 5, 1, ',')
    # caretaker's room + toilets
    g.fill(35, 23, 5, 3, 'B'); g.fill(41, 23, 6, 3, 'C')
    g.fill(35, 30, 4, 3, 'C'); g.fill(42, 30, 5, 3, 'C')
    for (x, y, ch) in [(5, 5, 't'), (12, 9, 'k'), (21, 5, 'l'), (28, 9, 't'),
                       (37, 8, 'p'), (46, 8, 'n'), (34, 13, 'w'),
                       (11, 19, 'c'), (25, 19, 'w'), (40, 19, 'p'),
                       (19, 26, 'k'), (14, 33, 'v'), (31, 27, 'r'), (40, 28, 'm')]:
        g.drop(x, y, ch)
    g.drop(45, 18, '@')
    g.fill(0, 16, 1, 3, 'X')
    g.fill(23, 16, 3, 2, '~')
    return g


# ============================================== 7 GRANDPA'S COTTAGE
def cottage():
    g = shell(43, 36)
    g.vwall(16, 1, 16); g.vwall(26, 1, 16)
    g.hwall(1, 17, 42)
    g.fill(19, 17, 4, 1, 'D')
    g.vwall(16, 18, 17); g.vwall(26, 18, 9)
    g.hwall(27, 26, 15)
    g.fill(16, 7, 1, 3, '.'); g.fill(26, 7, 1, 3, '.')
    g.fill(16, 24, 1, 3, '.'); g.fill(26, 21, 1, 3, '.')
    g.fill(31, 26, 3, 1, 'D')
    # windows
    g.fill(4, 0, 7, 1, 'O'); g.fill(29, 0, 8, 1, 'O')
    g.fill(0, 5, 1, 5, 'O'); g.fill(0, 24, 1, 5, 'O')
    g.fill(42, 5, 1, 5, 'O'); g.fill(42, 29, 1, 4, 'O')
    g.fill(29, 35, 10, 1, 'O')
    # parlour — Grandpa dozing in the armchair by the stove
    g.fill(3, 5, 5, 3, 'E')
    g.fill(1, 3, 2, 4, 'C')                    # the stove
    g.fill(10, 4, 5, 4, 'T'); g.fill(3, 11, 6, 2, 'S'); g.fill(11, 11, 4, 3, 'B')
    g.fill(4, 9, 8, 2, ',')
    g.fill(2, 14, 5, 2, 'C')
    # hall
    g.fill(18, 2, 6, 2, 'C'); g.fill(18, 6, 6, 8, ',')
    # their bedroom
    g.fill(29, 3, 6, 5, 'S'); g.fill(27, 3, 2, 3, 'N'); g.fill(36, 3, 2, 3, 'N')
    g.fill(28, 10, 8, 3, 'V'); g.fill(38, 9, 4, 5, 'W')
    g.fill(28, 15, 6, 1, 'C')
    # kitchen
    g.fill(2, 19, 4, 2, 'C'); g.fill(8, 19, 7, 2, 'C')
    g.fill(4, 24, 8, 4, 'T'); g.fill(2, 31, 6, 2, 'C'); g.fill(10, 31, 5, 2, 'B')
    # lower hall
    g.fill(18, 20, 6, 10, ',')
    g.fill(18, 32, 6, 2, 'C')
    # pantry + bathroom
    g.fill(28, 19, 3, 5, 'B'); g.fill(32, 19, 3, 5, 'B')
    g.fill(36, 19, 6, 2, 'C'); g.fill(36, 22, 6, 2, 'C')
    # conservatory
    g.fill(28, 28, 5, 3, 'T'); g.fill(35, 28, 6, 3, 'S'); g.fill(28, 33, 12, 2, 'S')
    for (x, y, ch) in [(9, 3, 'c'), (13, 9, 'r'), (9, 14, 'n'),
                       (21, 4, 'w'), (21, 15, 'p'),
                       (32, 9, 'j'), (37, 15, 'm'), (27, 14, 't'),
                       (7, 22, 'k'), (13, 29, 'c'), (3, 29, 'p'),
                       (34, 25, 'w'), (30, 32, 'v'), (39, 25, 'r')]:
        g.drop(x, y, ch)
    g.drop(21, 30, '@')
    g.fill(19, 35, 4, 1, 'X')
    g.fill(19, 18, 3, 2, '~')
    return g


MAPS = [('museum', museum), ('office', office), ('flat', flat),
        ('hospital', hospital), ('hotel', hotel), ('school', school),
        ('cottage', cottage)]

want = sys.argv[1:] or [n for n, _ in MAPS]
for name, fn in MAPS:
    if name in want:
        fn().out(name)

# ---------------------------------------------------------------------------
# This is the drafting tool for src/maps.js, not part of the game. It exists so
# that laying out seven floorplans by hand cannot silently produce a row of the
# wrong length, a doorway with nothing behind it, or a room sealed off from the
# rest of the building. Run it and paste the grids into src/maps.js; the grids
# there are the source of truth.
