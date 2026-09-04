import { p, rowOf, ceilingLights, curtainsV } from '../prop-helpers.mjs';

const GH = { name: 'Great Hall',    x: 3,  y: 2,  w: 38, h: 18, floor: '=' };
const TH = { name: 'Ticket Hall',   x: 2,  y: 21, w: 22, h: 11, floor: ':' };
const SW = { name: 'Security Wing', x: 25, y: 21, w: 16, h: 11, floor: '.' };
const GS = { name: 'Gift Shop',     x: 2,  y: 33, w: 14, h: 6,  floor: ',' };
const GR = { name: 'Guard Room',    x: 17, y: 33, w: 10, h: 6,  floor: ',' };
const LD = { name: 'Loading Dock',  x: 28, y: 33, w: 13, h: 6,  floor: '.' };

export default {
  id: 'museum',
  name: 'The Museum',
  subtitle: 'Night shift, closed wing',
  objective: 'Lift the golden amphora from the middle case and slip out through the loading dock. The night guard is asleep in the guard room — marble carries every footstep.',
  difficulty: 2,
  w: 43, h: 40,

  rooms: [GH, TH, SW, GS, GR, LD],

  // short partitions that turn the corners of the Great Hall into exhibit alcoves
  walls: [
    { x: 10, y: 2, w: 1, h: 3 }, { x: 33, y: 2, w: 1, h: 3 },
    { x: 10, y: 16, w: 1, h: 4 }, { x: 33, y: 16, w: 1, h: 4 },
  ],

  windows: [
    { x: 2, y: 6, w: 1, h: 4 }, { x: 2, y: 13, w: 1, h: 4 },
    { x: 41, y: 6, w: 1, h: 4 }, { x: 41, y: 13, w: 1, h: 4 },
    { x: 1, y: 22, w: 1, h: 3 },
    { x: 41, y: 23, w: 1, h: 4 },
    { x: 24, y: 21, w: 1, h: 3, glass: true },  // window into the security lane
    { x: 24, y: 29, w: 1, h: 3, glass: true },
  ],

  openings: [
    { x: 11, y: 20, w: 2, t: 'open',   note: 'Main arch into the Great Hall' },
    { x: 32, y: 20, t: 'door',         note: 'Staff door, sticks in the frame' },
    { x: 7,  y: 32, w: 2, t: 'open',   note: 'Gift shop' },
    { x: 20, y: 32, t: 'door',         note: 'Guard room — HE is behind this one' },
    { x: 33, y: 32, t: 'door' },
    { x: 24, y: 25, h: 2, t: 'open',   note: 'Turnstiles' },
    { x: 27, y: 36, t: 'vent',         note: 'Crawl duct, guard room <-> dock' },
    { x: 1,  y: 26, h: 2, t: 'locked', note: 'Front doors — chained at night' },
    { x: 34, y: 39, w: 2, t: 'exit',   note: 'Roll-up dock door' },
  ],

  spawn:   { x: 4, y: 37, facing: 'e', note: 'You come up through the gift-shop skylight' },
  exit:    { x: 34.5, y: 38.5 },
  sleeper: { x: 21.4, y: 35.2, name: 'Bruno, the night guard', sense: 7, note: 'Dozing in the armchair with the radio on' },

  hideSpots: [
    { x: 5, y: 16, w: 4, h: 3, kind: 'behind display case' },
    { x: 3, y: 22, w: 10, h: 2, kind: 'under the ticket counter' },
    { x: 29, y: 22, w: 3, h: 2, kind: 'inside a locker' },
    { x: 29, y: 34, w: 4, h: 3, kind: 'stack of crates' },
    { x: 33, y: 3, w: 4, h: 3, kind: 'alcove shadow' },
  ],

  patrols: [
    { name: 'Bruno (if woken)', loop: [[21, 36], [21, 31], [12, 25], [12, 10], [30, 10], [33, 25], [21, 31]] },
  ],

  props: [
    /* ---------------- Great Hall ---------------- */
    ...ceilingLights(4, 3, 36, 16, 4, 3),

    // paintings hung on the back wall
    p('painting', 8, 1.05, { w: 2.6, h: 0.9, c: 'gold' }),
    p('painting', 13, 1.05, { w: 1.6, h: 0.9, c: 'plain' }),
    p('painting', 19, 0.95, { w: 4.5, h: 1.1, c: 'gold', label: 'centrepiece' }),
    p('painting', 26, 1.05, { w: 1.6, h: 0.9, c: 'plain' }),
    p('painting', 31, 1.05, { w: 2.6, h: 0.9, c: 'gold' }),

    // alcove cases left & right of the back wall
    p('display-case', 4.4, 2.2, { w: 5, h: 3.2 }), p('amphora', 6.2, 2.9, { w: 1.6, h: 1.8, c: 'clay' }),
    p('display-case', 33.6, 2.2, { w: 5, h: 3.2 }), p('amphora', 35.4, 2.9, { w: 1.6, h: 1.8, c: 'silver' }),
    p('pedestal', 11.6, 3.3, { w: 1.5, h: 1.5 }), p('vase', 11.9, 2.6, { c: 'clay' }),
    p('pedestal', 29.9, 3.3, { w: 1.5, h: 1.5 }), p('vase', 30.2, 2.6, { c: 'clay' }),

    // velvet rope line across the front of the back-wall exhibits
    ...rowOf(9, 'rope', 8, 6.4, 3, 0, { w: 3, h: 0.5, d: 'h' }),

    // centre island of cases  (the amphora you are here for)
    p('display-case', 13.4, 9, { w: 4.6, h: 3.4 }), p('amphora', 15, 9.7, { w: 1.6, h: 1.9, c: 'clay' }),
    p('display-case', 19.2, 9, { w: 4.6, h: 3.4 }), p('amphora', 20.8, 9.6, { w: 1.7, h: 2.1, c: 'gold', label: 'THE amphora' }),
    p('display-case', 25, 9, { w: 4.6, h: 3.4 }), p('amphora', 26.6, 9.7, { w: 1.6, h: 1.9, c: 'silver' }),
    p('sign', 20.5, 12.7, { w: 2.6, h: 0.6 }),

    // benches down both sides
    p('bench', 5.2, 9.4, { w: 4.2, h: 1.4, d: 'h' }),
    p('bench', 33.6, 9.4, { w: 4.2, h: 1.4, d: 'h' }),
    p('bench', 5.2, 13.4, { w: 4.2, h: 1.4, d: 'h' }),
    p('bench', 33.6, 13.4, { w: 4.2, h: 1.4, d: 'h' }),

    // lower row of exhibits
    p('display-case', 4.4, 15.2, { w: 5, h: 3.2 }), p('amphora', 6.2, 15.9, { w: 1.6, h: 1.8, c: 'jade' }),
    p('pedestal', 11.5, 16.2, { w: 1.7, h: 1.7 }), p('vase', 11.8, 15.4, { c: 'clay' }),
    p('display-case', 33.6, 15.2, { w: 5, h: 3.2 }), p('amphora', 35.4, 15.9, { w: 1.6, h: 1.8, c: 'jade' }),
    p('pedestal', 29.8, 16.2, { w: 1.7, h: 1.7 }), p('vase', 30.1, 15.4, { c: 'silver' }),
    p('statue', 20.6, 15.6, { w: 1.8, h: 2.4 }),

    p('plant-big', 3.4, 6.4), p('plant-big', 39.2, 6.4),
    p('plant-big', 3.4, 12.4), p('plant-big', 39.2, 12.4),
    p('camera', 3.2, 2.2, { d: 'se' }), p('camera', 39.4, 2.2, { d: 'sw' }),
    ...curtainsV(3.05, 6, 4, { c: 'red' }), ...curtainsV(3.05, 13, 4, { c: 'red' }),
    ...curtainsV(40.2, 6, 4, { c: 'red' }), ...curtainsV(40.2, 13, 4, { c: 'red' }),

    /* ---------------- Ticket Hall ---------------- */
    ...ceilingLights(3, 22, 20, 9, 3, 2),
    p('counter', 3, 22.2, { w: 10, h: 1.8, label: 'TICKET' }),
    p('glass-screen', 3, 22.1, { w: 10, h: 0.35 }),
    p('office-chair', 6, 24.4, { d: 'n' }),
    p('office-chair', 9.5, 24.4, { d: 'n' }),
    p('computer', 4.2, 22.6), p('computer', 10.4, 22.6),
    p('papers', 7.6, 22.7),
    p('sign', 3.2, 21.15, { w: 3.4, h: 0.6, label: 'TICKET' }),

    p('board', 15.2, 21.2, { w: 3, h: 0.8 }),
    p('vending', 17.6, 22.2, { w: 1.8, h: 1.5 }),
    p('extinguisher', 22.4, 22.4),
    p('trash', 22.3, 24.2),

    // queue barrier snaking to the turnstiles
    ...rowOf(4, 'rope', 5, 27.4, 3, 0, { w: 3, h: 0.5, d: 'h' }),
    p('rope', 17.4, 27.6, { w: 0.5, h: 3, d: 'v' }),
    p('turnstile', 23.2, 25.1, { d: 'e' }),
    p('turnstile', 23.2, 26.1, { d: 'e' }),

    p('bench', 4, 29.6, { w: 4.2, h: 1.4, d: 'h' }),
    p('bench', 10, 29.6, { w: 4.2, h: 1.4, d: 'h' }),
    p('plant-big', 21.6, 30), p('plant-big', 21.6, 28),
    p('doormat', 2.1, 26, { w: 1.6, h: 2 }),
    ...curtainsV(2.05, 22, 3, { c: 'cream' }),

    /* ---------------- Security Wing ---------------- */
    ...ceilingLights(26, 22, 14, 9, 3, 2),
    p('scanner', 25.6, 24.6, { w: 2.6, h: 2.8 }),
    p('table', 28.6, 25, { w: 3.4, h: 1.6 }),
    p('tray', 29.2, 25.3), p('tray', 30.4, 25.3),
    p('lockers', 29, 21.2, { w: 5, h: 1.3 }),
    p('desk-l', 34.4, 21.4, { w: 5.4, h: 3.2 }),
    p('monitor', 35.2, 21.7, { d: 's' }), p('monitor', 36.6, 21.7, { d: 's' }),
    p('office-chair', 36, 24.2, { d: 'n' }),
    p('mug', 38.4, 22.2),
    p('cabinet', 39.2, 26, { w: 1.5, h: 3 }),
    p('coat-rack', 26.2, 22.2),
    p('bench', 27, 29.6, { w: 4.2, h: 1.4, d: 'h' }),
    p('plant', 39.4, 30), p('trash', 33, 30.2),
    p('camera', 25.4, 21.3, { d: 'se' }),
    ...curtainsV(40.2, 23, 4, { c: 'cream' }),

    /* ---------------- Gift Shop ---------------- */
    ...ceilingLights(3, 34, 12, 4, 3, 1),
    p('shelf', 2.4, 33.3, { w: 5, h: 1.1 }),
    p('shelf', 8.4, 33.3, { w: 5, h: 1.1 }),
    p('shelf', 2.4, 35.6, { w: 5, h: 1.1 }),
    p('shelf', 8.4, 35.6, { w: 3, h: 1.1 }),
    p('counter', 11.6, 37, { w: 3.6, h: 1.4 }),
    p('register', 12.6, 37.2),
    p('office-chair', 13.4, 36.2, { d: 's' }),
    p('plant', 2.4, 37.6), p('mirror', 15.05, 35, { w: 0.4, h: 2, d: 'v' }),
    p('rug', 4.5, 37.2, { w: 5, h: 1.6, c: 'red' }),

    /* ---------------- Guard Room (HIM) ---------------- */
    p('lamp-ceiling', 21, 33.6, { w: 1.5, h: 0.7 }),
    p('rug', 19.2, 34.6, { w: 5.4, h: 3.4, c: 'red' }),
    p('armchair', 20.4, 34.6, { w: 2.6, h: 2.6, d: 's' }),
    p('sleeper', 21.4, 35.2, { w: 1.6, h: 1.6, label: 'Bruno' }),
    p('coffee-table', 20.2, 37, { w: 3, h: 1.4 }),
    p('mug', 21.4, 37.3), p('papers', 22.4, 37.2),
    p('desk', 24.2, 33.25, { w: 2.4, h: 1.5 }),
    p('monitor', 24.5, 33.4, { d: 's' }), p('lamp-table', 25.7, 33.5),
    p('tv-wall', 17.2, 33.15, { w: 2.6, h: 0.7 }),
    p('lockers', 17.1, 36.4, { w: 1.3, h: 2.2, d: 'v' }),
    p('coat-rack', 25.6, 37.4),
    p('radiator', 19, 38.65, { w: 3, h: 0.5 }),
    p('lamp-floor', 24.4, 35.2),

    /* ---------------- Loading Dock ---------------- */
    ...ceilingLights(29, 34, 11, 4, 3, 1),
    p('crate', 28.4, 33.4, { w: 2.2, h: 2.2 }),
    p('crate', 30.9, 33.4, { w: 1.8, h: 1.8 }),
    p('crate', 28.6, 36, { w: 2, h: 2 }),
    p('box', 31, 35.6, { w: 1.3, h: 1.3 }),
    p('box', 32.4, 36.4, { w: 1.1, h: 1.1 }),
    p('shelf', 36, 33.3, { w: 4.6, h: 1.2 }),
    p('cart', 37.4, 35.4, { w: 2.2, h: 1.6 }),
    p('trash', 40, 37.4),
    p('extinguisher', 27.4, 34.4),
    p('sign', 33.6, 38.4, { w: 2.8, h: 0.6, label: 'EXIT' }),
  ],
};
