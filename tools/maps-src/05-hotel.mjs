import { p, ceilingLights, bedSet, curtainsH, curtainsV } from '../prop-helpers.mjs';

const S401 = { name: 'Suite 401',    x: 2,  y: 2,  w: 11, h: 11, floor: ',' };
const S402 = { name: 'Suite 402',    x: 15, y: 2,  w: 11, h: 11, floor: ',' };
const S403 = { name: 'Suite 403',    x: 28, y: 2,  w: 11, h: 11, floor: ',' };
const HK   = { name: 'Housekeeping', x: 41, y: 2,  w: 6,  h: 11, floor: '.' };
const COR  = { name: 'Corridor',     x: 2,  y: 15, w: 45, h: 4,  floor: ',' };
const S404 = { name: 'Suite 404',    x: 2,  y: 21, w: 11, h: 11, floor: ',' };
const S405 = { name: 'Suite 405',    x: 15, y: 21, w: 11, h: 11, floor: ',' };
const LIFT = { name: 'Lift Lobby',   x: 28, y: 21, w: 11, h: 11, floor: '=' };
const S406 = { name: 'Suite 406',    x: 41, y: 21, w: 6,  h: 11, floor: ',' };

/** a hotel suite: en-suite in one corner, bed, desk, armchair, curtains */
const suite = (x, y, n, flip = false) => {
  const bx = flip ? x + 5.6 : x + 1.4;
  return [
    ...ceilingLights(x + .5, y + .5, 10, 10, 2, 2),
    ...bedSet(bx, y + 1.4, 3.6, 4.6),
    p('desk', x + 7.2, y + 7.4, { w: 3, h: 1.5 }),
    p('office-chair', x + 8.3, y + 9.1, { d: 'n' }),
    p('lamp-table', x + 9.6, y + 7.6),
    p('armchair', x + 1.2, y + 7.6, { w: 2.2, h: 2.2, d: 'e' }),
    p('coffee-table', x + 3.6, y + 8, { w: 1.8, h: 1.4 }),
    p('mug', x + 4.1, y + 8.3),
    p('lamp-floor', x + 1.2, y + 6.2),
    p('wardrobe', x + 9.3, y + 1.4, { w: 1.4, h: 3 }),
    p('suitcase', x + 8.9, y + 5, { w: 1.4, h: 1 }),
    p('tv-wall', x + 6.4, y + 10.25, { w: 2.6, h: .7 }),
    p('rug', x + 1, y + 6.9, { w: 6, h: 3.6, c: 'red' }),
    p('plant', x + 9.4, y + 9.4),
    p('sign', x + .2, n < 404 ? y + 10.2 : y - .8, { w: 2, h: .6, label: String(n) }),
  ];
};

/** compact en-suite: (x, y) is the top-left interior corner of a 3x4 bathroom */
const ensuite = (x, y) => [
  p('lamp-ceiling', x + .75, y + .05, { w: 1.3, h: .55 }),
  p('basin', x + .1, y + .8, { w: 1.4, h: 1 }),
  p('toilet', x + 1.75, y + .75, { w: 1.1, h: 1.5 }),
  p('bathtub', x + .1, y + 2.3, { w: 2.8, h: 1.5, d: 'h' }),
  p('mat', x + .6, y + 2.05, { w: 1.4, h: .5 }),
];

export default {
  id: 'hotel',
  name: 'Grand Hotel Bohemia, Floor 4',
  subtitle: 'Corridor carpet, forty metres of it',
  objective: 'The courier left a briefcase in 405. Get it and take the service stairs — but the floor concierge is asleep at his desk in the middle of the corridor, and the lift lobby is marble.',
  difficulty: 3,
  w: 49, h: 34,

  rooms: [S401, S402, S403, HK, COR, S404, S405, LIFT, S406],

  walls: [
    // en-suite corners, one per suite
    { x: 9, y: 2, w: 1, h: 4 }, { x: 9, y: 6, w: 4, h: 1 },
    { x: 15, y: 6, w: 4, h: 1 }, { x: 18, y: 2, w: 1, h: 4 },
    { x: 35, y: 2, w: 1, h: 4 }, { x: 35, y: 6, w: 4, h: 1 },
    { x: 9, y: 27, w: 1, h: 5 }, { x: 9, y: 27, w: 4, h: 1 },
    { x: 22, y: 27, w: 1, h: 5 }, { x: 22, y: 27, w: 4, h: 1 },
  ],

  windows: [
    { x: 3, y: 1, w: 5, h: 1 }, { x: 16, y: 1, w: 5, h: 1 }, { x: 29, y: 1, w: 5, h: 1 },
    { x: 42, y: 1, w: 4, h: 1 },
    { x: 1, y: 4, w: 1, h: 4 }, { x: 1, y: 23, w: 1, h: 4 },
    { x: 47, y: 4, w: 1, h: 4 }, { x: 47, y: 23, w: 1, h: 5 },
    { x: 3, y: 33, w: 5, h: 1 }, { x: 16, y: 33, w: 5, h: 1 },
    { x: 30, y: 33, w: 6, h: 1, glass: true }, { x: 42, y: 33, w: 4, h: 1 },
    { x: 28, y: 22, w: 1, h: 4, glass: true },
  ],

  openings: [
    { x: 6,  y: 13, h: 2, axis: 'h', t: 'door', note: '401' }, { x: 19, y: 13, h: 2, axis: 'h', t: 'door', note: '402' },
    { x: 32, y: 13, h: 2, axis: 'h', t: 'door', note: '403' }, { x: 43, y: 13, h: 2, axis: 'h', t: 'door', note: 'Housekeeping' },
    { x: 6,  y: 19, h: 2, axis: 'h', t: 'door', note: '404' }, { x: 19, y: 19, h: 2, axis: 'h', t: 'door', note: '405 — your briefcase' },
    { x: 32, y: 19, w: 3, h: 2, axis: 'h', t: 'open', note: 'Lift lobby' }, { x: 43, y: 19, h: 2, axis: 'h', t: 'door', note: '406' },
    { x: 39, y: 6,  w: 2, axis: 'v', t: 'door', note: 'Suite 403 service door' },
    { x: 13, y: 25, w: 2, axis: 'v', t: 'vent', note: 'Linen chute between 404 and 405' },
    { x: 1,  y: 16, h: 2, t: 'exit', note: 'Service stairs' },
    { x: 48, y: 16, h: 2, t: 'elevator' },
    { x: 33, y: 32, w: 2, t: 'stairs', note: 'Grand staircase down' },
  ],

  spawn:   { x: 45, y: 17, facing: 'w', note: 'Out of the guest lift' },
  exit:    { x: 1.5, y: 16.5 },
  sleeper: { x: 24.4, y: 16.6, name: 'Otakar, floor concierge', sense: 7, note: 'Chin on his chest behind the floor desk, ledger still open' },

  hideSpots: [
    { x: 41, y: 2, w: 6, h: 11, kind: 'housekeeping room' },
    { x: 28, y: 28, w: 5, h: 3, kind: 'behind the lobby palms' },
    { x: 9, y: 15, w: 3, h: 2, kind: 'behind a luggage trolley' },
    { x: 2, y: 27, w: 3, h: 4, kind: 'under a suite window' },
  ],

  patrols: [
    { name: 'Otakar (if woken)', loop: [[24, 17], [12, 17], [4, 17], [24, 17], [36, 17], [45, 17], [24, 17]] },
    { name: 'Night porter', loop: [[33, 30], [33, 22], [33, 17], [20, 17], [33, 17]] },
  ],

  props: [
    ...suite(2, 2, 401), ...suite(15, 2, 402, true), ...suite(28, 2, 403),
    ...ensuite(10, 2), ...ensuite(15, 2), ...ensuite(36, 2),
    ...suite(2, 21, 404), ...suite(15, 21, 405, true),
    ...ensuite(10, 28), ...ensuite(23, 28),

    // the briefcase you came for, on the 405 luggage rack
    p('suitcase', 17.4, 26.4, { w: 1.8, h: 1.3, label: 'THE briefcase' }),
    p('keys', 17.7, 26.6),

    /* ---------------- Suite 406 (small single) ---------------- */
    ...ceilingLights(41.5, 21.5, 5, 10, 1, 2),
    ...bedSet(42.6, 22.4, 3, 4.2),
    p('desk', 41.2, 28.4, { w: 2.6, h: 1.4 }),
    p('office-chair', 42.1, 30.1, { d: 'n' }),
    p('wardrobe', 45.4, 28.4, { w: 1.4, h: 2.6 }),
    p('plant', 41.4, 30.6),
    p('rug', 41.4, 27.4, { w: 4.6, h: .9, c: 'red' }),
    p('sign', 41.2, 20.2, { w: 2, h: .6, label: '406' }),
    ...curtainsH(42, 32.4, 4, { c: 'red' }),

    /* ---------------- Housekeeping ---------------- */
    p('lamp-ceiling', 43.4, 3, { w: 1.4, h: .6 }), p('lamp-ceiling', 43.4, 10, { w: 1.4, h: .6 }),
    p('shelf', 41.2, 2.15, { w: 4.6, h: 1.2 }),
    p('shelf', 46, 4.4, { w: 1.1, h: 4, d: 'v' }),
    p('cart', 41.4, 5.4, { w: 2.4, h: 1.8 }),
    p('cart', 41.4, 8, { w: 2.4, h: 1.8 }),
    p('washer', 44.4, 10.4, { w: 1.8, h: 1.8 }),
    p('bucket', 41.4, 11.4), p('broom', 42.8, 10.8), p('ladder', 45.6, 6.4, { w: 1.1, h: 3 }),
    p('box', 44.6, 4.6, { w: 1.2, h: 1.1 }),

    /* ---------------- Corridor ---------------- */
    ...ceilingLights(3, 16, 43, 2, 9, 1),
    p('rug', 2.4, 16.3, { w: 20, h: 1.6, c: 'red' }),
    p('rug', 26, 16.3, { w: 20, h: 1.6, c: 'red' }),
    p('counter', 22.4, 15.2, { w: 4.2, h: 1.4, label: 'FLOOR DESK' }),
    p('sleeper', 24.4, 16.6, { w: 1.7, h: 1.7, label: 'Otakar' }),
    p('office-chair', 24.5, 16.7, { d: 's' }),
    p('lamp-table', 22.8, 15.4), p('papers', 25.6, 15.5), p('phone', 23.9, 15.5),
    p('plant-big', 9.4, 15.3), p('plant-big', 28.4, 17.4), p('plant-big', 39.4, 15.3),
    p('cart', 12.4, 17.4, { w: 2.4, h: 1.5 }),
    p('vending', 35.4, 17.4, { w: 1.8, h: 1.5, label: 'ICE' }),
    p('sconce', 6.4, 14.2, { w: .8, h: .6 }), p('sconce', 16.4, 14.2, { w: .8, h: .6 }),
    p('sconce', 30.4, 14.2, { w: .8, h: .6 }), p('sconce', 41.4, 14.2, { w: .8, h: .6 }),
    p('painting', 13.4, 14.15, { w: 2.4, h: .8, c: 'gold' }),
    p('painting', 37.4, 14.15, { w: 2.4, h: .8, c: 'gold' }),
    p('mirror', 20.4, 19.15, { w: 2.4, h: .5 }),
    p('extinguisher', 2.2, 18.2), p('trash', 31.4, 15.4),
    p('sign', 2.2, 15.2, { w: 2.2, h: .6, label: 'STAIRS' }),
    p('clock', 45.4, 15.4),

    /* ---------------- Lift Lobby ---------------- */
    p('chandelier', 32.6, 24.4, { w: 2.6, h: 2.6 }),
    ...ceilingLights(29, 29, 9, 2, 3, 1),
    p('rug-round', 31.4, 26.4, { w: 4.4, h: 4.4, c: 'blue' }),
    p('table-round', 32.6, 27.6, { w: 2, h: 2 }),
    p('vase', 33.1, 28.1, { c: 'jade' }),
    p('armchair', 29, 26.4, { w: 2.2, h: 2.2, d: 'e' }),
    p('armchair', 36.2, 26.4, { w: 2.2, h: 2.2, d: 'w' }),
    p('bench', 29.4, 30.4, { w: 3.4, h: 1.3, d: 'h' }),
    p('plant-big', 29.4, 22.4), p('plant-big', 37, 22.4), p('plant-big', 37, 30.2),
    p('painting', 28.15, 24.4, { w: .7, h: 2.4, c: 'gold' }),
    p('mirror', 38.5, 24.4, { w: .45, h: 2.6 }),
    p('lamp-floor', 35.6, 30.4),
    ...curtainsH(30, 32.4, 6, { c: 'cream' }),
  ],
};
