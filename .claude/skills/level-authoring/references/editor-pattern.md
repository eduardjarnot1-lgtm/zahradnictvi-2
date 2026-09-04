# In-browser level editor pattern

A standalone `tools/editor.html` that reads and writes the same JSON the game loads.
Single file, no build step, opens with `file://`. Structure below; adapt the level shape
to your format.

## State

```js
const state = {
  level: structuredClone(BLANK_LEVEL),
  tool: 'paint',        // paint | rect | fill | entity | erase
  brush: '#',           // legend char, or an entity type when tool === 'entity'
  undo: [],             // JSON snapshots
  mode: 'edit',         // edit | play
};

function snapshot() {
  state.undo.push(JSON.stringify(state.level));
  if (state.undo.length > 100) state.undo.shift();
}
function undo() {
  const prev = state.undo.pop();
  if (prev) { state.level = JSON.parse(prev); render(); }
}
```

Snapshotting whole-level JSON is inefficient and completely reliable. For levels of a
few kilobytes that tradeoff is correct — do not build a command-pattern undo system for
this.

Take a snapshot at the *start* of a gesture (mousedown), not per painted cell, or a drag
becomes fifty undo steps.

## Painting

```js
canvas.addEventListener('mousedown', e => { snapshot(); dragging = true; apply(cellAt(e)); });
canvas.addEventListener('mousemove', e => { if (dragging) apply(cellAt(e)); });
addEventListener('mouseup', () => { dragging = false; });

function cellAt(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: Math.floor((e.clientX - r.left) / (r.width  / cols)),
    y: Math.floor((e.clientY - r.top)  / (r.height / rows)),
  };
}

function apply({ x, y }) {
  if (x < 0 || y < 0 || y >= state.level.grid.length || x >= state.level.grid[y].length) return;
  const row = state.level.grid[y];
  state.level.grid[y] = row.slice(0, x) + state.brush + row.slice(x + 1);
  render();
}
```

Grid rows as strings keep the JSON readable and diffable; the slice-based write is the
small price.

## Edit ↔ play round-trip

The feature that makes the editor worth using. Keep the game engine importable and
runnable against an in-memory level, with no page reload:

```js
let session = null;
function play() {
  const errs = validate(state.level);
  if (errs.length) return showErrors(errs);   // never launch an invalid level
  state.mode = 'play';
  session = Game.start(canvas, structuredClone(state.level), {
    onExit: () => { state.mode = 'edit'; session = null; render(); },
  });
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && state.mode === 'play') session.stop();
  if (e.key === 'p' && state.mode === 'edit') play();
});
```

`structuredClone` matters: without it the running game mutates the level you are editing
and your entities end up wherever the playtest left them.

This requires the engine to accept a level *object* rather than fetching one by id. Design
for that from the start — `Game.start(canvas, levelData, opts)` — and the editor is nearly
free.

## Validation panel

Reuse the game's validator; do not write a second one. Show errors inline, and keep the
Play button disabled while any exist.

```js
function showErrors(errs) {
  panel.innerHTML = errs.length
    ? errs.map(e => `<li class="err">${e}</li>`).join('')
    : '<li class="ok">Valid</li>';
  playBtn.disabled = errs.length > 0;
}
```

## Import / export

```js
// Export: download as a file named after the level id.
function exportLevel() {
  const blob = new Blob([JSON.stringify(state.level, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${state.level.id || 'level'}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// Import: drag a .json onto the page.
addEventListener('drop', async e => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const errs = validate(data);
    if (errs.length) return showErrors(errs);
    snapshot(); state.level = migrate(data); render();
  } catch (err) { showErrors([`Not valid JSON: ${err.message}`]); }
});
addEventListener('dragover', e => e.preventDefault());
```

Also autosave the working level to `localStorage` on every change, and restore it on
load. Losing twenty minutes of level design to an accidental refresh is the fastest way
to stop using your own tool.

## Migration

Keep one function that upgrades any older level to the current version, and run it on
every load — from file, from `localStorage`, and from the bundled level set. Then old
level files keep working forever and there is exactly one place that knows about format
history.

```js
function migrate(level) {
  let l = structuredClone(level);
  if (l.version === undefined) { l.version = 1; l.entities ??= []; }
  if (l.version === 1) { l.par = { seconds: l.timeLimit ?? 60 }; delete l.timeLimit; l.version = 2; }
  return l;
}
```
