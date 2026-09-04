/** Small authoring helpers shared by the map sources. */

/** one prop: type, position (tiles, fractions allowed), size, facing */
export const p = (t, x, y, extra = {}) => ({ t, x, y, ...extra });

/** n copies of a prop, stepping by (dx, dy) */
export const rowOf = (n, t, x, y, dx, dy, extra = {}) =>
  Array.from({ length: n }, (_, i) => p(t, x + dx * i, y + dy * i, extra));

/** chairs tucked in along the long sides of a table */
export function chairsAlong(table, perSide, extra = {}) {
  const { x, y, w, h } = table;
  const out = [];
  if (w >= h) {
    const step = w / (perSide + 1);
    for (let i = 1; i <= perSide; i++) {
      out.push(p('chair', x + step * i - 0.4, y - 0.9, { d: 's', ...extra }));
      out.push(p('chair', x + step * i - 0.4, y + h + 0.1, { d: 'n', ...extra }));
    }
  } else {
    const step = h / (perSide + 1);
    for (let i = 1; i <= perSide; i++) {
      out.push(p('chair', x - 0.9, y + step * i - 0.4, { d: 'e', ...extra }));
      out.push(p('chair', x + w + 0.1, y + step * i - 0.4, { d: 'w', ...extra }));
    }
  }
  return out;
}

/** four chairs around a small square/round table */
export const chairsAround = (x, y, extra = {}) => [
  p('chair', x, y - 1.1, { d: 's', ...extra }),
  p('chair', x, y + 1.1, { d: 'n', ...extra }),
  p('chair', x - 1.1, y, { d: 'e', ...extra }),
  p('chair', x + 1.1, y, { d: 'w', ...extra }),
];

/** a bed with its nightstands + lamps; d = which way the pillow points */
export function bedSet(x, y, w = 3, h = 4, extra = {}) {
  return [
    p('rug', x - 0.8, y + h - 1.5, { w: w + 1.6, h: 2.2, c: 'grey' }),
    p('bed', x, y, { w, h, ...extra }),
    p('nightstand', x - 1.3, y + 0.2, { w: 1.1, h: 1.1 }),
    p('lamp-table', x - 0.9, y + 0.5),
    p('nightstand', x + w + 0.2, y + 0.2, { w: 1.1, h: 1.1 }),
    p('lamp-table', x + w + 0.6, y + 0.5),
  ];
}

/** curtains hanging beside a window run (horizontal wall) */
export const curtainsH = (x, y, w, extra = {}) => [
  p('curtain', x, y, { w: w * 0.3, h: 0.75, d: 'h', ...extra }),
  p('curtain', x + w * 0.7, y, { w: w * 0.3, h: 0.75, d: 'h', ...extra }),
];

/** curtains beside a window run (vertical wall) */
export const curtainsV = (x, y, h, extra = {}) => [
  p('curtain', x, y, { w: 0.75, h: h * 0.3, d: 'v', ...extra }),
  p('curtain', x, y + h * 0.7, { w: 0.75, h: h * 0.3, d: 'v', ...extra }),
];

/** ceiling lights on a grid inside a rectangle */
export function ceilingLights(x, y, w, h, cols, rows) {
  const out = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      out.push(p('lamp-ceiling', x + (w * (c + 0.5)) / cols - 0.75, y + (h * (r + 0.5)) / rows - 0.35, { w: 1.5, h: 0.7 }));
  return out;
}

/** an office desk pod: desk + chair + monitor + a little clutter */
export function workstation(x, y, d = 's') {
  const out = [p('desk', x, y, { w: 2.6, h: 1.4 }), p('monitor', x + 0.75, y + 0.15, { d })];
  out.push(p('papers', x + 1.9, y + 0.5));
  if (d === 's') out.push(p('office-chair', x + 0.9, y + 1.7, { d: 'n' }));
  if (d === 'n') out.push(p('office-chair', x + 0.9, y - 1.3, { d: 's' }));
  return out;
}
