import { p, rowOf, ceilingLights, curtainsV, curtainsH } from '../prop-helpers.mjs';

const W1 = { name: 'Ward 1',        x: 2,  y: 2,  w: 9,  h: 11, floor: ':' };
const W2 = { name: 'Ward 2',        x: 12, y: 2,  w: 9,  h: 11, floor: ':' };
const W3 = { name: 'Ward 3',        x: 22, y: 2,  w: 9,  h: 11, floor: ':' };
const W4 = { name: 'Ward 4',        x: 32, y: 2,  w: 10, h: 11, floor: ':' };
const COR= { name: 'Ward Corridor', x: 2,  y: 15, w: 40, h: 4,  floor: ':' };
const NS = { name: 'Nurse Station', x: 2,  y: 21, w: 11, h: 9,  floor: '.' };
const BR = { name: 'Break Room',    x: 15, y: 21, w: 9,  h: 9,  floor: ',' };
const SUP= { name: 'Supplies',      x: 26, y: 21, w: 7,  h: 9,  floor: '.' };
const WAIT= { name: 'Waiting Area', x: 35, y: 21, w: 7,  h: 9,  floor: ',' };

const ward = (x, y, n) => [
  ...ceilingLights(x + .5, y + .5, 8, 10, 2, 2),
  p('hospital-bed', x + .4, y + .4, { w: 3, h: 5 }),
  p('nightstand', x + 3.6, y + .5, { w: 1.2, h: 1.2 }),
  p('lamp-table', x + 3.9, y + .8),
  p('iv', x + 3.7, y + 2.2, { w: .8, h: 1.8 }),
  p('monitor-med', x + .5, y + 5.8, { w: 1.6, h: 1.2 }),
  p('screen', x + 4.9, y + .3, { w: .55, h: 5.2, d: 'v' }),
  p('hospital-bed', x + 5.6, y + .4, { w: 3, h: 5 }),
  p('nightstand', x + 5.6, y + 5.8, { w: 1.2, h: 1.2 }),
  p('chair', x + 7.3, y + 6, { d: 'n' }),
  p('sink', x + .3, y + 8.4, { w: 1.6, h: 1.1 }),
  p('trash', x + 2.4, y + 8.6),
  p('plant', x + 7.4, y + 8.4),
  p('tv-wall', x + 2.4, y + 9.9, { w: 2.4, h: .65 }),
  p('sign', x + .3, y - .82, { w: 2, h: .6, label: `WARD ${n}` }),
];

export default {
  id: 'hospital',
  name: 'St. Vitus, Third Floor',
  subtitle: 'Night ward, lights down',
  objective: 'Your clothes are locked in the break-room cabinet — and Dr. Marek is asleep on the couch two metres away. Take them, get past the nurse station, and use the lift before the 03:00 rounds.',
  difficulty: 4,
  w: 45, h: 32,

  rooms: [W1, W2, W3, W4, COR, NS, BR, SUP, WAIT],

  walls: [
    { x: 8, y: 21, w: 1, h: 3 },      // nurse station back office
    { x: 30, y: 25, w: 3, h: 1 },     // supply shelving bay
  ],

  windows: [
    { x: 3, y: 1, w: 5, h: 1 }, { x: 13, y: 1, w: 5, h: 1 },
    { x: 23, y: 1, w: 5, h: 1 }, { x: 34, y: 1, w: 6, h: 1 },
    { x: 1, y: 4, w: 1, h: 4 }, { x: 43, y: 4, w: 1, h: 4 },
    { x: 1, y: 23, w: 1, h: 4 }, { x: 43, y: 23, w: 1, h: 5 },
    { x: 4, y: 31, w: 5, h: 1 }, { x: 36, y: 31, w: 5, h: 1 },
    { x: 14, y: 21, w: 1, h: 3, glass: true },     // break-room window onto the corridor
    { x: 2, y: 20, w: 4, h: 1, glass: true },      // nurse station glazing
  ],

  openings: [
    { x: 6,  y: 13, h: 2, axis: 'h', t: 'door' }, { x: 16, y: 13, h: 2, axis: 'h', t: 'door' },
    { x: 26, y: 13, h: 2, axis: 'h', t: 'door' }, { x: 36, y: 13, h: 2, axis: 'h', t: 'door' },
    { x: 7,  y: 19, w: 2, h: 2, axis: 'h', t: 'open', note: 'Nurse station' },
    { x: 19, y: 19, h: 2, axis: 'h', t: 'door', note: 'Break room — HE is in here' },
    { x: 29, y: 19, h: 2, axis: 'h', t: 'door', note: 'Supplies, keypad already open' },
    { x: 37, y: 19, w: 2, h: 2, axis: 'h', t: 'open' },
    { x: 24, y: 24, w: 2, axis: 'v', t: 'vent', note: 'Linen chute, break room -> supplies' },
    { x: 33, y: 24, w: 2, axis: 'v', t: 'vent' },
    { x: 1,  y: 16, h: 2, t: 'exit', note: 'Fire stairs' },
    { x: 43, y: 16, h: 2, t: 'elevator', note: 'The lift pings. Loudly.' },
  ],

  spawn:   { x: 3.4, y: 4.4, facing: 's', note: 'Bed 1, Ward 1 — your bed' },
  exit:    { x: 1.5, y: 16.5 },
  sleeper: { x: 17.2, y: 26.4, name: 'Dr. Marek', sense: 6, note: 'Flat out on the staff couch, pager on his chest' },

  hideSpots: [
    { x: 26, y: 21, w: 7, h: 4, kind: 'between the supply racks' },
    { x: 22, y: 8, w: 3, h: 4, kind: 'behind a privacy curtain' },
    { x: 35, y: 27, w: 4, h: 3, kind: 'behind the waiting-room plants' },
    { x: 2, y: 27, w: 4, h: 3, kind: 'under the nurses’ desk' },
  ],

  patrols: [
    { name: 'Night nurse', loop: [[7, 24], [7, 17], [20, 17], [33, 17], [40, 17], [20, 17]] },
    { name: 'Porter', loop: [[38, 25], [38, 17], [3, 17], [38, 17]] },
  ],

  props: [
    ...ward(2, 2, 1), ...ward(12, 2, 2), ...ward(22, 2, 3), ...ward(32, 2, 4),

    /* ---------------- Corridor ---------------- */
    ...ceilingLights(3, 16, 38, 2, 8, 1),
    p('bench', 3.4, 15.2, { w: 3.4, h: 1.2, d: 'h' }),
    p('bench', 30.4, 17.6, { w: 3.4, h: 1.2, d: 'h' }),
    p('cart', 20.4, 15.3, { w: 2.2, h: 1.5 }),
    p('cart', 39.2, 17.4, { w: 2.2, h: 1.5 }),
    p('plant-big', 9.4, 17.4), p('plant-big', 24.4, 15.3), p('plant', 33.4, 15.4),
    p('extinguisher', 2.2, 18.2), p('trash', 13.4, 17.6), p('trash', 41, 15.4),
    p('board', 11.2, 15.2, { w: 2.4, h: .8 }),
    p('sign', 41, 18.3, { w: 2, h: .6, label: 'LIFT' }),
    p('doormat', 2.1, 16, { w: 1.4, h: 2 }),
    p('wheelchair', 17.4, 17.4),

    /* ---------------- Nurse Station ---------------- */
    ...ceilingLights(3, 22, 9, 7, 3, 2),
    p('counter', 2.2, 21.2, { w: 5.4, h: 1.6, label: 'NURSES' }),
    p('computer', 3.2, 21.5), p('computer', 5.4, 21.5),
    p('office-chair', 3.6, 23.4, { d: 'n' }), p('office-chair', 5.8, 23.4, { d: 'n' }),
    p('papers', 6.9, 21.7),
    p('desk', 9.2, 21.3, { w: 3.2, h: 1.6 }),
    p('monitor-med', 9.6, 21.5, { w: 1.6, h: 1.2 }),
    p('office-chair', 10.6, 23.2, { d: 'n' }),
    p('cabinet', 11.4, 25.4, { w: 1.4, h: 2.6 }),
    p('shelf', 2.2, 25.4, { w: 4.4, h: 1.1 }),
    p('filing', 2.2, 27.6, { w: 1.6, h: 1.2 }),
    p('trash', 8.4, 28.4), p('plant', 11.4, 28.4),
    p('mug', 4.6, 21.6), p('phone', 7.2, 22.6),
    ...curtainsV(2.1, 23, 4, { c: 'green' }),

    /* ---------------- Break Room (HIM) ---------------- */
    ...ceilingLights(15.5, 22, 8, 7, 2, 2),
    p('rug', 15.4, 25.2, { w: 5.4, h: 3.6, c: 'green' }),
    p('sofa', 15.6, 25.4, { w: 4.4, h: 2.2, d: 's' }),
    p('sleeper', 17.2, 26.4, { w: 1.8, h: 1.8, label: 'Dr. Marek' }),
    p('coffee-table', 16.6, 28.2, { w: 2.6, h: 1.4 }),
    p('mug', 17.4, 28.5), p('papers', 18.4, 28.4),
    p('counter', 15.2, 21.15, { w: 4.4, h: 1.4 }),
    p('sink', 15.4, 21.3, { w: 1.4, h: 1 }), p('kettle', 17.4, 21.4), p('microwave', 18.4, 21.3, { w: 1.3, h: .9 }),
    p('fridge', 22.4, 21.3, { w: 1.4, h: 2 }),
    p('lockers', 20.4, 24.4, { w: 1.3, h: 3.4, d: 'v', label: 'your clothes' }),
    p('keys', 20.6, 25.4),
    p('table-round', 21.6, 27.2, { w: 2, h: 2 }),
    p('stool', 21.1, 26.4, { w: 1, h: 1 }),
    p('lamp-floor', 15.4, 23.4),
    p('tv-wall', 22.2, 29.9, { w: 1.8, h: .65 }),
    p('plant', 23.4, 23.4),

    /* ---------------- Supplies ---------------- */
    p('lamp-ceiling', 29, 22, { w: 1.5, h: .7 }), p('lamp-ceiling', 29, 28, { w: 1.5, h: .7 }),
    p('shelf', 26.2, 21.15, { w: 6.4, h: 1.2 }),
    p('shelf', 26.15, 23.4, { w: 1.1, h: 4, d: 'v' }),
    p('shelf', 31.9, 23.4, { w: 1.1, h: 4, d: 'v' }),
    p('shelf', 27.4, 26.2, { w: 4.4, h: 1.1 }),
    p('crate', 27.4, 28.2, { w: 1.6, h: 1.6 }),
    p('box', 29.4, 28.6, { w: 1.2, h: 1.1 }),
    p('cart', 30.8, 28.4, { w: 1.8, h: 1.4 }),
    p('bucket', 26.4, 28.6),

    /* ---------------- Waiting Area ---------------- */
    ...ceilingLights(35.5, 22, 6, 7, 2, 2),
    p('rug', 35.4, 22.4, { w: 5.4, h: 3, c: 'blue' }),
    p('bench', 35.4, 22.6, { w: 4.4, h: 1.3, d: 'h' }),
    p('bench', 35.4, 24.4, { w: 4.4, h: 1.3, d: 'h' }),
    p('armchair', 40.2, 22.6, { w: 1.8, h: 1.8, d: 'w' }),
    p('coffee-table', 36.4, 26.4, { w: 2.6, h: 1.4 }),
    p('papers', 37.2, 26.7),
    p('vending', 40, 26.4, { w: 1.8, h: 1.6 }),
    p('plant-big', 35.4, 28.2), p('plant-big', 40.2, 28.6),
    p('trash', 38.6, 28.6), p('clock', 35.4, 21.3),
    ...curtainsH(36, 30.4, 5, { c: 'cream' }),
  ],
};
