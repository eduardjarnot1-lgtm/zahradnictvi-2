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
        # Things that are drawn but not walked into: blackboards, notice
        # boards, posters, bins, plants, floor markings. They live beside the
        # grid rather than in it because the grid is the *building* — every
        # character in it is something you can collide with — and a poster on a
        # wall is not. Kept in tile coordinates; tilemap.js scales them.
        self.decor = []
        # Tiles no piece of furniture may stand on: the lane in front of every
        # doorway, the way out, and the spot you start on.
        #
        # This exists because the repair passes below cannot tell the difference
        # between "this wardrobe is in the way" and "this room is furnished".
        # Carving an aisle out of a room whose door is blocked works, and what
        # it leaves is an empty room — which is how ten of the eleven locations
        # ended up as bare shells with a coin in them. Reserving the lane before
        # anything is placed means there is nothing to repair.
        self.keep = set()

    def reserve(self, x, y, w, h):
        for yy in range(max(0, y), min(self.rows, y + h)):
            for xx in range(max(0, x), min(self.cols, x + w)):
                self.keep.add((xx, yy))

    # Never over a wall, a doorway, the way out or the spot you start on: those
    # are the building, and furniture is what stands in it.
    STRUCTURE = set('#%ODX@')

    def clear_of_keep(self, x, y, w, h):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                if not (0 <= xx < self.cols and 0 <= yy < self.rows):
                    return False
                if (xx, yy) in self.keep:
                    return False
                if self.g[yy][xx] in Grid.STRUCTURE:
                    return False
        return True

    def lay(self, x, y, w, h, ch, shift=3, strict=False):
        """Place a piece of furniture, out of the way of every doorway.

        Tries where it was asked for first, then a few tiles either side along
        the room's long axis, and gives up rather than standing in a lane. A
        piece that has to be moved aside is a piece that reads as arranged
        around the door, which is what furniture in a real room does."""
        offsets = [0]
        for i in range(1, shift + 1):
            offsets += [i, -i]
        along_x = w <= h
        for swap in (False, True):
            for d in offsets:
                across = along_x != swap
                nx = x + (d if across else 0)
                ny = y + (0 if across else d)
                # Where it was asked for, it may stand on whatever is there —
                # that is what the room grammar meant. Anywhere else it has been
                # moved aside, and shoving a second piece through the first one
                # is not moving aside, it is losing furniture.
                if not self.clear_of_keep(nx, ny, w, h):
                    continue
                if (d != 0 or strict) and not self.empty(nx, ny, w, h):
                    continue
                self.fill(nx, ny, w, h, ch)
                return True
        # A run too long to be moved aside is broken around the lane instead.
        # A wall of shelving with a gap where the door is reads exactly right,
        # and it is the difference between a stockroom and an empty rectangle.
        if w >= 6 or h >= 6:
            return self.spread(x, y, w, h, ch)
        return False

    def spread(self, x, y, w, h, ch, least=2):
        """Lay a long run in the segments left between the reserved lanes."""
        along = w >= h
        span = w if along else h
        placed = False
        start = None
        for i in range(span + 1):
            if along:
                free = i < span and self.clear_of_keep(x + i, y, 1, h)
            else:
                free = i < span and self.clear_of_keep(x, y + i, w, 1)
            if free:
                if start is None:
                    start = i
                continue
            if start is not None and i - start >= least:
                if along:
                    self.fill(x + start, y, i - start, h, ch)
                else:
                    self.fill(x, y + start, w, i - start, ch)
                placed = True
            start = None
        return placed

    def empty(self, x, y, w, h):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                if self.g[yy][xx] in 'TSWNVCBPE':
                    return False
        return True

    def must(self, x, y, w, h, ch):
        """A piece the level cannot do without — the sleeper's own bed, desk or
        couch. Placed out of the way if there is anywhere out of the way, and
        placed anyway if there is not."""
        if not self.lay(x, y, w, h, ch):
            self.fill(x, y, w, h, ch)

    def lane(self, x, y, w, h):
        """Reserve a doorway's approach: the three tiles of the opening and one
        either side of them, run right through whatever is behind it."""
        self.reserve(x, y, w, h)

    def deco(self, kind, x, y, w=1, h=1, tag=None):
        """Mark a rectangle of tiles as carrying a piece of decoration. The
        generator is the only thing that knows a room is a classroom rather
        than a store cupboard, so it is the only thing that can say a
        blackboard goes here — the renderer just draws what it is told."""
        self.decor.append((kind, x, y, w, h, tag))

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
    def drop(self, x, y, ch, radius=3, box=False):
        best = None
        for r in range(radius + 1):
            for dy in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    if max(abs(dx), abs(dy)) != r: continue
                    nx, ny = x + dx, y + dy
                    if not (0 <= nx < self.cols and 0 <= ny < self.rows): continue
                    if self.g[ny][nx] != '.': continue
                    # The spawn has to be somewhere the player can actually
                    # stand. A free tile is not enough: the box is wider than a
                    # tile, so a gap beside a wall looks free and is not.
                    if box and self._blocked(nx * 20 + 10, ny * 20 + 10): continue
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
        TILE, G = 20, 4
        seen = self._reached()
        if not seen: return False
        # Loot and the way out have to be within reach of somewhere you can
        # stand; a doorway has to be somewhere you can stand *in*. The game's
        # validator checks all three, so this does too — otherwise the tool
        # calls a map finished and the build rejects it.
        targets = []
        for y in range(self.rows):
            for x in range(self.cols):
                ch = self.g[y][x]
                if ch in LOOT or ch == 'X':
                    targets.append((x * TILE + TILE / 2, y * TILE + TILE / 2, 26))
                elif ch == 'D':
                    targets.append((x * TILE + TILE / 2, y * TILE + TILE / 2, G * 3))
        for (tx, ty, r) in targets:
            if not any(abs(gx * G + G / 2 - tx) <= r and abs(gy * G + G / 2 - ty) <= r
                       for (gx, gy) in seen):
                return False
        return True

    # An item on the spawn is free money and an item in the doorway you leave by
    # is taken on the way past. Neither is a decision, so neither survives.
    def clear_freebies(self):
        spawn = exit_ = None
        for y in range(self.rows):
            for x in range(self.cols):
                if self.g[y][x] == '@': spawn = (x, y)
                elif self.g[y][x] == 'X': exit_ = (x, y)
        for y in range(self.rows):
            for x in range(self.cols):
                if self.g[y][x] not in LOOT: continue
                if spawn and max(abs(x - spawn[0]), abs(y - spawn[1])) <= 2:
                    self.g[y][x] = '.'
                elif exit_ and max(abs(x - exit_[0]), abs(y - exit_[1])) <= 2:
                    self.g[y][x] = '.'

    # Loot the player cannot get to is not a decision, it is a bug — and worse,
    # it is a bug the repair pass answers by demolishing whatever furniture is
    # nearest, because from its point of view the room is sealed. So anything
    # stranded is picked up and put down again somewhere it can be reached,
    # before the repair pass is ever asked to look at the map.
    def rehome_loot(self):
        cells = self._reached()
        if not cells:
            return
        reach = {(gx * 4 // 20, gy * 4 // 20) for (gx, gy) in cells}
        open_floor = sorted(t for t in reach
                            if self.g[t[1]][t[0]] == '.'
                            and not self._blocked(t[0] * 20 + 10, t[1] * 20 + 10))
        if not open_floor:
            return
        taken = set()
        for y in range(self.rows):
            for x in range(self.cols):
                if self.g[y][x] not in LOOT or (x, y) in reach:
                    continue
                ch = self.g[y][x]
                self.g[y][x] = '.'
                spot = min((t for t in open_floor if t not in taken),
                           key=lambda t: (t[0] - x) ** 2 + (t[1] - y) ** 2, default=None)
                if spot is None:
                    continue
                taken.add(spot)
                self.g[spot[1]][spot[0]] = ch
                self.moved.append((ch, x, y, spot))

    # Widen the aisles only as far as connectivity actually needs. Carving every
    # aisle to the far wall works, but it strips a conference room of its table
    # and a lounge of its sofas — the map stops being the drawing.
    def open_until_connected(self):
        for depth in range(0, 40):
            if self.connected(): return depth
            self.carve_aisles(depth + 1)
        return None

    # Aisles are carved from doorways, which handles a room packed behind its
    # own door. It does not handle a piece of furniture sitting mid-corridor
    # leaving a one-tile channel — the player is taller than a tile, so that
    # reads as free floor and is not walkable. This pass finds whatever is
    # actually separating the map and takes out the smallest thing that fixes
    # it, so the room keeps as much of its furniture as it can.
    def open_by_removal(self, limit=60):
        TILE, G = 20, 4
        for _ in range(limit):
            if self.connected():
                return True
            cells = self._reached()
            reached = set()
            for (gx, gy) in cells:
                reached.add(((gx * G) // TILE, (gy * G) // TILE))
            # Blobs of furniture, and whether each touches both sides of the split.
            solid = set('TSWNVCBP')
            seen_tile = set()
            best = None
            for y in range(self.rows):
                for x in range(self.cols):
                    if (x, y) in seen_tile or self.g[y][x] not in solid:
                        continue
                    ch = self.g[y][x]
                    blob, stack = set(), [(x, y)]
                    while stack:
                        cx, cy = stack.pop()
                        if (cx, cy) in blob: continue
                        if not (0 <= cx < self.cols and 0 <= cy < self.rows): continue
                        if self.g[cy][cx] != ch: continue
                        blob.add((cx, cy))
                        stack += [(cx+1,cy),(cx-1,cy),(cx,cy+1),(cx,cy-1)]
                    seen_tile |= blob
                    touches_open = touches_closed = False
                    for (bx, by) in blob:
                        for (nx, ny) in ((bx+1,by),(bx-1,by),(bx,by+1),(bx,by-1)):
                            if not (0 <= nx < self.cols and 0 <= ny < self.rows): continue
                            if self.g[ny][nx] in '#%' or self.g[ny][nx] in solid: continue
                            if (nx, ny) in reached: touches_open = True
                            else: touches_closed = True
                    # A blob with open floor on one side and cut-off floor on the
                    # other is exactly what is holding the map apart.
                    if touches_open and touches_closed and (best is None or len(blob) < len(best)):
                        best = blob
            if not best:
                return False
            for (bx, by) in best:
                self.g[by][bx] = '.'
        return self.connected()

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


def surround(inner, left, top, right, bottom):
    """Put a finished building in the middle of a bigger plot.

    Everything comes across: the characters, the room dressing, the reserved
    lanes. What is new is the margin round it, which starts as open ground and
    is then made into somewhere — a yard, a car park, a garden — by whichever
    location this is.
    """
    g = Grid(inner.cols + left + right, inner.rows + top + bottom)
    for y in range(inner.rows):
        for x in range(inner.cols):
            g.g[y + top][x + left] = inner.g[y][x]
    for (kind, x, y, w, h, tag) in inner.decor:
        g.decor.append((kind, x + left, y + top, w, h, tag))
    for (x, y) in inner.keep:
        g.keep.add((x + left, y + top))
    g.bad = list(inner.bad)
    g.moved = list(inner.moved)
    return g


class Wing:
    """A rectangle of a bigger plot, addressed as if it were the whole map.

    The room grammars were all written against a grid that *is* the building:
    they read `cols` and `rows` and lay walls along the edges. Putting a
    building inside grounds means the building is no longer the map, and the
    choice is either to thread an offset through every grammar or to hand them
    something that looks exactly like the grid they expect. This is the second
    one: the same methods, shifted.

    Everything downstream — the repair passes, the searchable-furniture pass,
    the emitter — works on the real grid underneath, because by then the
    building and its grounds are one map and that is the point of them.
    """

    def __init__(self, grid, x, y, cols, rows):
        self.grid = grid
        self.x0, self.y0 = x, y
        self.cols, self.rows = cols, rows

    # --- the parts of Grid a room grammar actually touches -------------------
    @property
    def bad(self):
        return self.grid.bad

    @property
    def moved(self):
        return self.grid.moved

    def fill(self, x, y, w, h, ch):
        self.grid.fill(x + self.x0, y + self.y0, w, h, ch)

    def box(self, x, y, w, h, ch='#'):
        self.grid.box(x + self.x0, y + self.y0, w, h, ch)

    def hwall(self, x, y, w, ch='%'):
        self.grid.hwall(x + self.x0, y + self.y0, w, ch)

    def vwall(self, x, y, h, ch='%'):
        self.grid.vwall(x + self.x0, y + self.y0, h, ch)

    def put(self, x, y, ch):
        self.grid.put(x + self.x0, y + self.y0, ch)

    def lane(self, x, y, w, h):
        self.grid.lane(x + self.x0, y + self.y0, w, h)

    def deco(self, kind, x, y, w=1, h=1, tag=None):
        self.grid.deco(kind, x + self.x0, y + self.y0, w, h, tag)

    def lay(self, x, y, w, h, ch, shift=3):
        return self.grid.lay(x + self.x0, y + self.y0, w, h, ch, shift)

    def must(self, x, y, w, h, ch):
        self.grid.must(x + self.x0, y + self.y0, w, h, ch)

    def spread(self, x, y, w, h, ch, least=2):
        return self.grid.spread(x + self.x0, y + self.y0, w, h, ch, least)

    def drop(self, x, y, ch, radius=3, box=False):
        # Bounded to the wing: a coin nudged out of a bedroom and onto the lawn
        # is not what the room grammar meant, and the grounds place their own.
        for r in range(radius + 1):
            for dy in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    if max(abs(dx), abs(dy)) != r:
                        continue
                    nx, ny = x + dx, y + dy
                    if not (0 <= nx < self.cols and 0 <= ny < self.rows):
                        continue
                    gx, gy = nx + self.x0, ny + self.y0
                    if self.grid.g[gy][gx] != '.':
                        continue
                    if box and self.grid._blocked(gx * 20 + 10, gy * 20 + 10):
                        continue
                    self.grid.g[gy][gx] = ch
                    if (nx, ny) != (x, y):
                        self.grid.moved.append((ch, x, y, (nx, ny)))
                    return
        self.grid.bad.append((ch, x, y))


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
# --------------------------------------------------------- the school's rooms
# Five authored floorplans share these, so a classroom is furnished the same way
# whichever wing of the building it is in and each layout can be read as
# architecture rather than as a list of fills.

def solid(g, x, y, w, h):
    """Mark a block as not part of the building. This is how the silhouettes are
    cut: the grid stays rectangular because everything downstream assumes it is,
    and the *building* becomes an L or a U or a courtyard by walling off what is
    outside it. Read off the walls alone, the five levels are five shapes."""
    g.fill(x, y, w, h, '#')


def pack(a, b, wide, gap=1):
    """Fill the run of columns a..b with pieces `wide` across, one clear tile
    between them, centred."""
    span = b - a + 1
    n = (span + gap) // (wide + gap)
    if n <= 0:
        return []
    used = n * wide + (n - 1) * gap
    start = a + (span - used) // 2
    return [start + i * (wide + gap) for i in range(n)]


def sch_classroom(g, x, y, w, h, door, name, board_above=True):
    """Paired desks either side of an aisle running back to the door, the
    teacher's desk at the front and cupboards along the back wall."""
    lane = (door - 1, door + 3)
    # Two-tall desks need two-tall gaps between them, so the pitch is four; the
    # range starts as high in the room as the front row allows.
    rows = [r for r in range(y + 3, y + h, 4) if r + 1 <= y + h - 1]
    for r in rows:
        for xx in pack(x, lane[0] - 1, 2) + pack(lane[1] + 1, x + w - 1, 2):
            g.fill(xx, r, 2, 2, 'T')
    front = y if board_above else y + h - 2
    spots = pack(x, lane[0] - 1, 4) + pack(lane[1] + 1, x + w - 1, 4)
    for i, xx in enumerate(spots):
        g.fill(xx, front, 4, 2, 'T' if i == 0 else 'C')
    g.deco('board', x, y - 1 if board_above else y + h, w, 1)
    g.deco('bin', x + w - 1, front + 1)
    g.deco('desklamp', x + 1, front + 1)
    g.deco('floor', x, y, w, h, 'boards')
    g.deco('sign', door, y + h if board_above else y - 1, 3, 1, name)


def sch_library(g, x, y, w, h, door):
    """Stacks with aisles you can walk down and a table to read at."""
    lane = (door - 1, door + 3)
    tall = max(2, min(h - 5, h // 2))
    for xx in pack(x, lane[0] - 1, 2, 2) + pack(lane[1] + 1, x + w - 1, 2, 2):
        g.fill(xx, y, 2, tall, 'B')
    for xx in pack(x, x + w - 1, 5)[:1]:
        g.fill(xx, y + tall + 2, 5, 2, 'T')
    g.deco('floor', x, y, w, h, 'carpet')
    g.deco('lamp', x + w // 2, y + h // 2)
    g.deco('plant', x + w - 1, y + h - 1)
    g.deco('sign', door, y + h, 3, 1, 'Library')


def sch_store(g, x, y, w, h, door, name='Store'):
    """Shelving, cupboards under it, boxes wherever they will go."""
    lane = (door - 1, door + 3)
    band = pack(x, lane[0] - 1, 3) + pack(lane[1] + 1, x + w - 1, 3)
    for i, xx in enumerate(band):
        g.fill(xx, y, 3, min(3, h - 2), 'B' if i % 2 == 0 else 'C')
    if h >= 7:
        for i, xx in enumerate(band):
            g.fill(xx, y + h - 2, 3, 2, 'C' if i % 2 == 0 else 'W')
    g.deco('floor', x, y, w, h, 'concrete')
    if band:
        g.deco('tools', band[0], y + h // 2, 3, 1)
    g.deco('sign', door, y - 1, 3, 1, name)


def sch_gym(g, x, y, w, h, door, above=True):
    """Benching round the edges, floor clear in the middle."""
    g.fill(x, y + 1, 2, max(2, h - 3), 'S')
    g.fill(x + w - 2, y + 1, 2, max(2, h - 3), 'S')
    for xx in pack(x + 3, x + w - 4, 5)[:2]:
        g.fill(xx, y + h - 2, 5, 2, 'S')
    g.deco('floor', x, y, w, h, 'parquet')
    g.deco('court', x + 3, y + 1, max(3, w - 6), max(3, h - 4))
    g.deco('hoop', x + w // 2 - 1, y, 3, 1)
    g.deco('sign', door, y - 1 if above else y + h, 3, 1, 'Gymnasium')


def sch_office(g, x, y, w, h, door, name='Caretaker'):
    """Mr. Vrána's room: his desk, the cabinets behind it, a place to sit.

    The desk is the level's landmark — it is where he starts, where he goes back
    to, and the thing the player plans routes around — so it is placed rather
    than dropped wherever there was room."""
    # Against one wall, with a lane beside it. Centred in the room it left a
    # single tile down each side, and a single tile is not a gap — the player is
    # wider than one — so everything past the desk was sealed off behind it.
    dw = max(4, min(7, w - 4))
    dx = x
    dy = y + max(1, h // 2 - 1)
    g.fill(dx, dy, dw, 3, 'E')
    lane = (door - 1, door + 3)
    for i, xx in enumerate(pack(x, lane[0] - 1, 3) + pack(lane[1] + 1, x + w - 1, 3)):
        g.fill(xx, y, 3, 2, 'C' if i % 2 == 0 else 'B')
    if h >= 9:
        g.fill(x, y + h - 2, 2, 2, 'W')
    g.deco('floor', x, y, w, h, 'carpet')
    g.deco('lamp', dx + dw // 2, dy + 1)
    g.deco('kettle', x, y + h - 3)
    g.deco('sign', door, y - 1, 3, 1, name)


def sch_lockers(g, x, y, w, doors, deep=2):
    """Lockers along a corridor wall, into the runs between the doorways."""
    blocked = sorted(doors)
    run, at = [], x
    for d in blocked:
        if d - 2 > at:
            run.append((at, d - 2 - at))
        at = d + 5
    if x + w - 1 > at:
        run.append((at, x + w - 1 - at))
    for (rx, rw) in run:
        if rw >= 3:
            g.fill(rx, y, rw, deep, 'C')


def school_1():
    """Level one: one straight corridor, three rooms off it, the caretaker's
    office at the end. Rectangular on purpose — it is the level that teaches
    the building, and it should be the one you can hold in your head."""
    g = shell(30, 26)
    g.hwall(1, 9, 28); g.hwall(1, 16, 28)
    g.vwall(14, 1, 8)
    g.vwall(11, 17, 8); g.vwall(21, 17, 8)
    for x in (4, 20): g.fill(x, 9, 3, 1, 'D')
    for x in (5, 15, 24): g.fill(x, 16, 3, 1, 'D')
    g.fill(3, 0, 7, 1, 'O'); g.fill(18, 0, 8, 1, 'O')
    g.fill(0, 3, 1, 4, 'O'); g.fill(29, 3, 1, 4, 'O')
    g.fill(6, 25, 8, 1, 'O')

    sch_classroom(g, 1, 1, 13, 8, 4, '1A')
    sch_classroom(g, 15, 1, 14, 8, 20, '1B')
    sch_lockers(g, 1, 10, 28, [4, 20])
    sch_lockers(g, 1, 14, 28, [5, 15, 24], deep=1)
    g.deco('floor', 1, 10, 28, 6, 'tiles')
    g.deco('notice', 12, 10, 4, 1)
    g.deco('clock', 25, 10)
    g.deco('sign', 1, 12, 3, 1, 'EXIT')

    sch_store(g, 1, 17, 10, 8, 5)
    sch_gym(g, 12, 17, 9, 8, 15, above=True)
    sch_office(g, 22, 17, 7, 8, 24)

    for (x, y, ch) in [(2, 2, 'c'), (7, 2, 'p'), (4, 5, 'w'), (7, 7, 'k'), (12, 7, 'c'),
                       (20, 2, 'p'), (2, 11, 'w'), (6, 12, 'c'), (6, 17, 'r')]:
        g.drop(x, y, ch, box=True)
    g.drop(27, 12, '@', box=True)
    g.fill(0, 11, 1, 3, 'X')
    g.fill(9, 12, 3, 2, '~')
    return g


def school_2():
    """Level two: an L. A long teaching corridor along the top, and a wing that
    turns down at the far end for the hall and the stores. The bottom-left
    quarter of the plot is not part of the building at all."""
    g = shell(34, 29)
    solid(g, 0, 17, 18, 12)              # the corner the building does not fill
    g.hwall(1, 9, 32); g.hwall(18, 16, 15)
    g.vwall(11, 1, 8); g.vwall(22, 1, 8)
    g.vwall(26, 17, 11)
    for x in (5, 15, 27): g.fill(x, 9, 3, 1, 'D')
    for x in (21, 29): g.fill(x, 16, 3, 1, 'D')
    g.fill(3, 0, 6, 1, 'O'); g.fill(14, 0, 6, 1, 'O'); g.fill(25, 0, 7, 1, 'O')
    g.fill(0, 3, 1, 4, 'O'); g.fill(33, 4, 1, 8, 'O')
    g.fill(20, 28, 10, 1, 'O')

    sch_classroom(g, 1, 1, 10, 8, 5, '1A')
    sch_classroom(g, 12, 1, 10, 8, 15, '1B')
    sch_library(g, 23, 1, 10, 8, 27)
    sch_lockers(g, 1, 10, 32, [5, 15, 27])
    sch_lockers(g, 18, 14, 15, [21, 29], deep=1)
    g.deco('floor', 1, 10, 32, 6, 'tiles')
    g.deco('notice', 9, 10, 4, 1)
    g.deco('clock', 20, 10)
    g.deco('sign', 1, 12, 3, 1, 'EXIT')

    sch_gym(g, 19, 17, 7, 11, 21)
    sch_office(g, 27, 17, 6, 11, 29)

    for (x, y, ch) in [(2, 2, 'w'), (7, 2, 'k'), (4, 5, 'p'), (7, 7, 'c'), (13, 2, 'm'),
                       (18, 2, 'w'), (15, 5, 'k'), (2, 11, 'c'), (6, 12, 'p'),
                       (10, 13, 'w'), (3, 15, 'r')]:
        g.drop(x, y, ch, box=True)
    g.drop(31, 12, '@', box=True)
    g.fill(0, 11, 1, 3, 'X')
    g.fill(12, 12, 3, 2, '~')
    return g


def school_3():
    """Level three: a T. The teaching corridor runs the width of the building
    and a stem drops out of the middle of it to the hall and the offices, so
    there are two ways round to most things and a dead end at the bottom."""
    g = shell(38, 32)
    solid(g, 0, 18, 12, 14)              # left of the stem
    solid(g, 27, 18, 11, 14)             # ...and right of it
    g.hwall(1, 10, 36); g.hwall(12, 17, 15)
    # The stem's walls start *below* the corridor. Running them up through it
    # cut the teaching corridor into three sealed pieces, which is the kind of
    # thing you cannot see in the source and cannot miss on a reachability map.
    g.vwall(12, 18, 14); g.vwall(26, 18, 14)
    g.vwall(13, 1, 9); g.vwall(25, 1, 9)
    for x in (6, 18, 30): g.fill(x, 10, 3, 1, 'D')
    for x in (14, 22): g.fill(x, 17, 3, 1, 'D')
    g.fill(3, 0, 8, 1, 'O'); g.fill(15, 0, 8, 1, 'O'); g.fill(27, 0, 8, 1, 'O')
    g.fill(0, 4, 1, 5, 'O'); g.fill(37, 4, 1, 5, 'O')
    g.fill(15, 31, 8, 1, 'O')

    sch_classroom(g, 1, 1, 12, 9, 6, '1A')
    sch_classroom(g, 14, 1, 11, 9, 18, '1B')
    sch_library(g, 26, 1, 11, 9, 30)
    sch_lockers(g, 1, 11, 36, [6, 18, 30])
    sch_lockers(g, 1, 15, 36, [14, 22], deep=1)
    g.deco('floor', 1, 11, 36, 6, 'tiles')
    g.deco('notice', 10, 11, 4, 1)
    g.deco('clock', 26, 11)
    g.deco('sign', 1, 13, 3, 1, 'EXIT')

    sch_gym(g, 13, 18, 6, 13, 14)
    sch_office(g, 20, 18, 6, 13, 22)
    g.deco('floor', 13, 18, 13, 13, 'tiles')

    for (x, y, ch) in [(6, 2, 'm'), (5, 6, 'k'), (11, 2, 'r'), (16, 2, 'p'), (19, 4, 'l'),
                       (23, 2, 'w'), (29, 4, 'k'), (32, 2, 'm'), (35, 6, 'p'),
                       (8, 8, 'c'), (5, 12, 'w'), (9, 13, 'c'), (32, 8, 't')]:
        g.drop(x, y, ch, box=True)
    g.drop(35, 13, '@', box=True)
    g.fill(0, 12, 1, 3, 'X')
    g.fill(20, 13, 3, 2, '~')
    return g


def school_4():
    """Level four: a U round a courtyard. Two wings down either side joined by
    the teaching corridor along the top; the middle of the plot is open ground
    you cannot cross, so the two wings are a long walk apart."""
    g = shell(42, 35)
    solid(g, 11, 19, 20, 16)             # the courtyard
    g.hwall(1, 10, 40)
    g.hwall(1, 18, 10); g.hwall(31, 18, 10)
    # ...and the wings' walls start below the corridor too, for the same reason.
    g.vwall(10, 19, 16); g.vwall(31, 19, 16)
    g.vwall(14, 1, 9); g.vwall(28, 1, 9)
    for x in (5, 19, 34): g.fill(x, 10, 3, 1, 'D')
    g.fill(4, 18, 3, 1, 'D'); g.fill(34, 18, 3, 1, 'D')
    g.fill(3, 0, 8, 1, 'O'); g.fill(17, 0, 8, 1, 'O'); g.fill(31, 0, 8, 1, 'O')
    g.fill(0, 4, 1, 6, 'O'); g.fill(41, 4, 1, 6, 'O')
    g.fill(0, 24, 1, 6, 'O'); g.fill(41, 24, 1, 6, 'O')

    sch_classroom(g, 1, 1, 13, 9, 5, '1A')
    sch_classroom(g, 15, 1, 13, 9, 19, '1B')
    sch_library(g, 29, 1, 12, 9, 34)
    sch_lockers(g, 1, 11, 40, [5, 19, 34])
    sch_lockers(g, 1, 15, 40, [5, 19, 34], deep=1)
    g.deco('floor', 1, 11, 40, 6, 'tiles')
    g.deco('notice', 12, 11, 4, 1)
    g.deco('clock', 27, 11)
    g.deco('sign', 1, 13, 3, 1, 'EXIT')

    sch_store(g, 1, 19, 9, 15, 4, 'Stores')
    sch_office(g, 32, 19, 9, 15, 34)
    g.deco('floor', 11, 19, 20, 16, 'concrete')

    for (x, y, ch) in [(2, 2, 'n'), (7, 2, 'l'), (4, 5, 'k'), (7, 7, 'v'), (16, 2, 'v'),
                       (18, 5, 'j'), (21, 2, 'l'), (2, 12, 'c'), (6, 11, 'w'),
                       (4, 15, 'm'), (8, 14, 'n'), (2, 20, 'r'), (7, 20, 'v'),
                       (4, 23, 'm'), (2, 27, 'k'), (2, 32, 'l')]:
        g.drop(x, y, ch, box=True)
    g.drop(38, 13, '@', box=True)
    g.fill(0, 12, 1, 3, 'X')
    g.fill(15, 13, 3, 2, '~')
    return g


def school():
    """A real school, laid out the way one actually is: two teaching rooms and a
    library off the top of a spine, the hall and the staff end off the bottom,
    and a corridor lined with lockers running between them.

    The density is the point. A classroom is not a room with three desks in it —
    it is rows of paired desks either side of a centre aisle, a teacher's desk
    facing them, cupboards down the back wall and a board on the front one.
    Every room is furnished from what it is *for*, which is what makes the map
    readable: you know where you are from the furniture before you read a sign.

    The one hard constraint the density has to respect is that a door is only a
    door if you can walk through it. Every doorway here has a lane kept clear in
    front of it and driven into the room behind, and the furniture is laid out
    around those lanes rather than dropped on top of them and carved back out."""
    g = shell(49, 36)
    g.hwall(1, 14, 47); g.hwall(1, 21, 47)
    g.vwall(16, 1, 13); g.vwall(32, 1, 13)
    g.vwall(20, 22, 13); g.vwall(34, 22, 13)
    top_doors = (7, 23, 39)
    bot_doors = (9, 25, 39)
    for x in top_doors: g.fill(x, 14, 3, 1, 'D')
    for x in bot_doors: g.fill(x, 21, 3, 1, 'D')
    g.fill(34, 27, 1, 3, '.')            # staff room through to the store
    # windows
    g.fill(3, 0, 8, 1, 'O'); g.fill(20, 0, 8, 1, 'O'); g.fill(36, 0, 8, 1, 'O')
    g.fill(0, 4, 1, 6, 'O'); g.fill(48, 4, 1, 6, 'O')
    g.fill(4, 35, 10, 1, 'O'); g.fill(22, 35, 8, 1, 'O')

    def spans(width, blocked, pad=2):
        """The runs of wall left over once every doorway has been given room to
        breathe. Everything that lines a wall is placed into these rather than
        laid down and cut back, so no piece of furniture ever half-blocks a door."""
        free, x = [], 1
        for d in sorted(blocked):
            if d - pad > x:
                free.append((x, d - pad - x))
            x = d + 3 + pad
        if width - 1 > x:
            free.append((x, width - 1 - x))
        return free

    # --- classrooms 1A and 1B ------------------------------------------------
    # Four pairs of desks a side, a centre aisle running back to the door, the
    # teacher's desk at the front and cupboards along the back wall.
    def classroom(x0, name):
        for r in (4, 8, 12):
            for dx in (1, 4, 11, 14):
                g.fill(x0 + dx, r, 2, 2, 'T')
        g.fill(x0 + 1, 1, 4, 2, 'T')            # the teacher's desk
        g.fill(x0 + 11, 1, 4, 2, 'C')           # cupboards behind it
        g.fill(x0 + 6, 1, 2, 1, 'B')            # a shelf of textbooks
        g.deco('board', x0 + 1, 0, 14, 1)
        g.deco('bin', x0 + 15, 3)
        g.deco('poster', x0 + 15, 7, 1, 3)
        g.deco('desklamp', x0 + 2, 2)
        g.deco('sign', x0 + 6, 14, 3, 1, name)
        g.deco('floor', x0 + 1, 1, 15, 13, 'boards')
    classroom(0, '1A'); classroom(16, '1B')

    # --- library -------------------------------------------------------------
    # Stacks with aisles you can walk down, a reading table under the window, a
    # counter by the door — and the lane in from the corridor kept clear.
    for x in (33, 36, 39):
        g.fill(x, 2, 2, 6, 'B')
    g.fill(43, 2, 4, 2, 'B'); g.fill(43, 5, 4, 2, 'B')
    g.fill(34, 10, 5, 2, 'T'); g.fill(43, 9, 4, 3, 'S')
    g.fill(33, 12, 3, 1, 'C')                   # the counter
    g.deco('sign', 38, 14, 3, 1, 'Library')
    g.deco('plant', 47, 8)
    g.deco('lamp', 41, 10)
    g.deco('floor', 33, 1, 15, 13, 'carpet')

    # --- the corridor --------------------------------------------------------
    # Lockers along both walls, but only into the runs between the doorways, and
    # only one bank deep on the lower wall — the middle of the corridor has to
    # stay walkable from end to end or the whole floor stops connecting.
    for (x, w) in spans(49, top_doors):
        g.fill(x, 15, w, 2, 'C')
    for (x, w) in spans(49, bot_doors):
        g.fill(x, 20, w, 1, 'C')
    g.fill(15, 19, 2, 1, 'S'); g.fill(31, 19, 2, 1, 'S')     # benches
    g.deco('notice', 21, 15, 4, 1)
    g.deco('clock', 36, 15)
    g.deco('poster', 12, 15, 2, 1)
    g.deco('floor', 1, 15, 47, 6, 'tiles')
    g.deco('sign', 1, 17, 3, 1, 'EXIT')

    # --- gymnasium -----------------------------------------------------------
    # Benching and apparatus round the edges and a floor left deliberately clear
    # in the middle: a hall is the one room in a school that is mostly nothing,
    # and filling it in would make it read as a store.
    g.fill(2, 23, 2, 3, 'S'); g.fill(2, 27, 2, 3, 'S'); g.fill(2, 31, 2, 3, 'S')
    g.fill(16, 23, 3, 2, 'C'); g.fill(16, 26, 3, 2, 'C'); g.fill(16, 30, 3, 2, 'B')
    g.fill(5, 33, 5, 2, 'S'); g.fill(13, 33, 5, 2, 'S')
    # Floor before court: the decoration list is painted in order, and a floor
    # laid after its markings simply covers them up.
    g.deco('floor', 1, 22, 19, 13, 'parquet')
    g.deco('court', 5, 23, 11, 9)
    g.deco('hoop', 9, 22, 3, 1)
    g.deco('sign', 9, 21, 3, 1, 'Gymnasium')

    # --- staff room ----------------------------------------------------------
    # Mr. Vrána on the couch, a table people sit at, a fridge and pigeonholes,
    # and a clear lane from the door down to him.
    g.fill(23, 29, 7, 3, 'E')
    g.fill(21, 24, 4, 2, 'T'); g.fill(30, 23, 3, 2, 'C')
    g.fill(21, 27, 2, 2, 'W')                   # the fridge
    g.fill(32, 27, 2, 4, 'C')                   # pigeonholes
    g.fill(22, 33, 4, 1, 'B')
    g.deco('sign', 24, 21, 3, 1, 'Staff Room')
    g.deco('kettle', 21, 26)
    g.deco('plant', 33, 33)
    g.deco('lamp', 26, 27)
    g.deco('floor', 21, 22, 13, 13, 'carpet')

    # --- caretaker's store and the changing room -----------------------------
    # The densest rooms on the map, because a caretaker's store is: shelving to
    # the ceiling, cupboards under it, boxes wherever they will go.
    g.fill(35, 23, 3, 3, 'B'); g.fill(43, 23, 4, 3, 'B')
    g.fill(35, 27, 3, 2, 'C'); g.fill(39, 27, 2, 2, 'W'); g.fill(43, 27, 4, 2, 'C')
    g.deco('sign', 40, 21, 3, 1, 'Caretaker')
    g.deco('tools', 39, 24, 3, 2)
    g.deco('floor', 35, 22, 13, 7, 'concrete')

    g.fill(35, 31, 4, 3, 'C'); g.fill(42, 31, 5, 3, 'C')
    g.deco('sign', 40, 30, 3, 1, 'Changing')
    g.deco('floor', 35, 29, 13, 6, 'tiles')

    # In the aisles, not in the gaps between desks: a one-tile gap is not floor
    # a player can stand on, however much it looks like it.
    for (x, y, ch) in [(6, 6, 't'), (8, 10, 'k'), (22, 6, 'l'), (24, 10, 't'),
                       (37, 9, 'p'), (41, 10, 'n'), (37, 13, 'w'),
                       (11, 18, 'c'), (25, 18, 'w'), (43, 18, 'p'),
                       (10, 28, 'k'), (12, 31, 'v'), (28, 27, 'r'), (41, 30, 'm')]:
        # box=True: the desks are packed with one-tile gaps between them, and a
        # one-tile gap is not somewhere a player can stand.
        g.drop(x, y, ch, box=True)
    g.drop(45, 18, '@')
    g.fill(0, 16, 1, 3, 'X')
    g.fill(23, 17, 3, 2, '~')
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

# Guarded so build-locations.py can import the seven hand-drawn maps without
# this file printing all of them as a side effect.
if __name__ == '__main__':
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
