import { p, rowOf, ceilingLights, chairsAlong, curtainsH, curtainsV } from '../prop-helpers.mjs';

const CLA = { name: 'Classroom 1A',  x: 2,  y: 2,  w: 15, h: 12, floor: '~' };
const CLB = { name: 'Classroom 1B',  x: 19, y: 2,  w: 13, h: 12, floor: '~' };
const LIB = { name: 'Library',       x: 34, y: 2,  w: 13, h: 12, floor: ',' };
const COR = { name: 'Main Corridor', x: 2,  y: 16, w: 45, h: 4,  floor: ':' };
const GYM = { name: 'Gymnasium',     x: 2,  y: 22, w: 20, h: 12, floor: '~' };
const STF = { name: 'Staff Room',    x: 24, y: 22, w: 10, h: 12, floor: ',' };
const JAN = { name: 'Caretaker',     x: 36, y: 22, w: 5,  h: 6,  floor: '.' };
const WC  = { name: 'Toilets',       x: 43, y: 22, w: 4,  h: 12, floor: ':' };
const CHG = { name: 'Changing Room', x: 36, y: 29, w: 5,  h: 5,  floor: ':' };

/** a row of pupil desks: n pairs, each pair a desk + two chairs */
const deskRow = (x, y, n) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const dx = x + i * 3.4;
    out.push(p('desk', dx, y, { w: 2.6, h: 1.2 }));
    out.push(p('chair', dx + .2, y + 1.4, { d: 'n' }));
    out.push(p('chair', dx + 1.4, y + 1.4, { d: 'n' }));
    if (i % 2 === 0) out.push(p('book', dx + .5, y + .2));
  }
  return out;
};

export default {
  id: 'school',
  name: 'Komenský Primary, 21:40',
  subtitle: 'Everyone went home. Almost everyone.',
  objective: 'Your phone is in the confiscation cabinet in the staff room, and Mr. Vrána fell asleep in the armchair right next to it. Classroom floors are old parquet — take the corridor tiles or the gym.',
  difficulty: 2,
  w: 49, h: 36,

  rooms: [CLA, CLB, LIB, COR, GYM, STF, JAN, WC, CHG],

  walls: [
    { x: 45, y: 22, w: 1, h: 4 },     // toilet stall divider
    { x: 43, y: 26, w: 3, h: 1 },
    { x: 40, y: 2, w: 1, h: 5 },      // library reading nook
  ],

  windows: [
    { x: 3, y: 1, w: 5, h: 1 }, { x: 10, y: 1, w: 5, h: 1 },
    { x: 20, y: 1, w: 5, h: 1 }, { x: 26, y: 1, w: 5, h: 1 },
    { x: 35, y: 1, w: 5, h: 1 }, { x: 42, y: 1, w: 4, h: 1 },
    { x: 1, y: 4, w: 1, h: 4 }, { x: 1, y: 10, w: 1, h: 3 },
    { x: 1, y: 24, w: 1, h: 4 }, { x: 1, y: 30, w: 1, h: 3 },
    { x: 47, y: 4, w: 1, h: 4 }, { x: 47, y: 24, w: 1, h: 4 },
    { x: 4, y: 35, w: 6, h: 1 }, { x: 13, y: 35, w: 6, h: 1 },
    { x: 25, y: 35, w: 5, h: 1 }, { x: 31, y: 35, w: 2, h: 1 },
    { x: 18, y: 21, w: 3, h: 1, glass: true },
    { x: 24, y: 16, w: 1, h: 3, glass: true },
  ],

  openings: [
    { x: 8,  y: 14, h: 2, axis: 'h', t: 'door', note: 'Classroom 1A' },
    { x: 25, y: 14, h: 2, axis: 'h', t: 'door', note: 'Classroom 1B' },
    { x: 39, y: 14, h: 2, axis: 'h', t: 'door', note: 'Library' },
    { x: 11, y: 20, w: 2, h: 2, axis: 'h', t: 'open', note: 'Gym doors' },
    { x: 28, y: 20, h: 2, axis: 'h', t: 'door', note: 'Staff room — HE is in the armchair' },
    { x: 38, y: 20, h: 2, axis: 'h', t: 'door', note: 'Caretaker' },
    { x: 44, y: 20, h: 2, axis: 'h', t: 'door' },
    { x: 38, y: 28, t: 'door' },
    { x: 41, y: 24, w: 2, axis: 'v', t: 'door' },
    { x: 22, y: 26, w: 2, axis: 'v', t: 'vent', note: 'Old heating duct, gym -> staff room' },
    { x: 1,  y: 17, h: 2, t: 'exit', note: 'Bike-shed door, left unlocked' },
    { x: 48, y: 17, h: 2, t: 'locked', note: 'Main entrance — chained' },
  ],

  spawn:   { x: 4, y: 24.5, facing: 'e', note: 'In through the gym fire door' },
  exit:    { x: 1.5, y: 17.5 },
  sleeper: { x: 26.4, y: 24.6, name: 'Mr. Vrána, caretaker', sense: 6, note: 'Armchair, crossword on his knee, radio murmuring' },

  hideSpots: [
    { x: 2, y: 22, w: 4, h: 4, kind: 'behind the vaulting horse' },
    { x: 34, y: 2, w: 5, h: 5, kind: 'library stacks' },
    { x: 43, y: 22, w: 2, h: 4, kind: 'toilet cubicle' },
    { x: 2, y: 11, w: 3, h: 3, kind: 'under the teacher’s desk' },
    { x: 36, y: 29, w: 5, h: 5, kind: 'changing room' },
  ],

  patrols: [
    { name: 'Mr. Vrána (if woken)', loop: [[27, 25], [28, 20], [20, 18], [8, 18], [20, 18], [39, 18], [28, 20]] },
  ],

  props: [
    /* ---------------- Classroom 1A ---------------- */
    ...ceilingLights(3, 3, 13, 10, 3, 2),
    p('chalkboard', 5.4, 2.06, { w: 6, h: .8 }),
    p('desk', 12.4, 2.4, { w: 3.2, h: 1.6 }),
    p('office-chair', 13.5, 4.2, { d: 'n' }),
    p('papers', 13, 2.6), p('globe', 15.4, 2.5), p('mug', 14.6, 2.7),
    ...deskRow(3, 6, 4), ...deskRow(3, 9, 4), ...deskRow(3, 12, 4),
    p('bookcase', 2.15, 2.4, { w: 1.1, h: 3, d: 'v' }),
    p('cabinet', 15.6, 5.4, { w: 1.2, h: 2.6 }),
    p('board', 2.4, 4.4, { w: 2, h: .9 }),
    p('plant', 15.6, 12.6), p('trash', 15.6, 9.4),
    p('coat-rack', 2.4, 13.4),
    ...curtainsH(3, 2.05, 5, { c: 'cream' }), ...curtainsH(10, 2.05, 5, { c: 'cream' }),

    /* ---------------- Classroom 1B ---------------- */
    ...ceilingLights(20, 3, 11, 10, 3, 2),
    p('chalkboard', 21.4, 2.06, { w: 5.4, h: .8 }),
    p('desk', 28.4, 2.4, { w: 3, h: 1.6 }),
    p('office-chair', 29.4, 4.2, { d: 'n' }),
    p('papers', 29, 2.6), p('laptop', 30.4, 2.6),
    ...deskRow(20, 6, 3), ...deskRow(20, 9, 3), ...deskRow(20, 12, 3),
    p('bookcase', 30.6, 6.4, { w: 1.2, h: 3.4, d: 'v' }),
    p('whiteboard', 19.15, 6.4, { w: .7, h: 3 }),
    p('plant', 30.6, 12.6), p('trash', 19.4, 13.4),
    p('sink', 19.2, 2.4, { w: 1.4, h: 1 }),
    ...curtainsH(20, 2.05, 5, { c: 'cream' }), ...curtainsH(26, 2.05, 5, { c: 'cream' }),

    /* ---------------- Library ---------------- */
    ...ceilingLights(35, 3, 11, 10, 3, 2),
    p('bookcase', 34.2, 2.15, { w: 5.4, h: 1.2 }),
    p('bookcase', 34.2, 5.4, { w: 5.4, h: 1.2 }),
    p('bookcase', 34.2, 8.4, { w: 5.4, h: 1.2 }),
    p('bookcase', 34.15, 11.2, { w: 5.4, h: 1.2 }),
    p('bookcase', 46, 3.4, { w: 1.1, h: 4, d: 'v' }),
    p('table-round', 41.6, 8.4, { w: 3, h: 3 }),
    p('chair', 41.2, 7.4, { d: 's' }), p('chair', 44.8, 9.4, { d: 'w' }),
    p('chair', 42.8, 11.6, { d: 'n' }), p('chair', 40.2, 9.4, { d: 'e' }),
    p('table', 41.6, 2.4, { w: 3.4, h: 1.6 }),
    p('office-chair', 42.9, 4.2, { d: 'n' }),
    p('lamp-table', 44.4, 2.6), p('book', 42, 2.7), p('book', 43, 2.8),
    p('armchair', 41.4, 5.4, { w: 2, h: 2, d: 'e' }),
    p('lamp-floor', 44.6, 5.6),
    p('rug', 40.6, 12.4, { w: 5, h: 1.4, c: 'red' }),
    p('plant-big', 45.4, 12), p('trash', 40.4, 13.4),

    /* ---------------- Corridor ---------------- */
    ...ceilingLights(3, 17, 43, 2, 9, 1),
    p('lockers', 3, 16.15, { w: 6, h: 1.2 }), p('lockers', 10, 16.15, { w: 6, h: 1.2 }),
    p('lockers', 18, 16.15, { w: 5, h: 1.2 }), p('lockers', 30, 16.15, { w: 6, h: 1.2 }),
    p('lockers', 41, 16.15, { w: 5, h: 1.2 }),
    p('lockers', 3, 19.65, { w: 6, h: 1.2 }), p('lockers', 14, 19.65, { w: 5, h: 1.2 }),
    p('lockers', 31, 19.65, { w: 4, h: 1.2 }),
    p('bench', 20.4, 19.4, { w: 3.4, h: 1.1, d: 'h' }),
    p('board', 26.4, 19.4, { w: 3, h: 1 }),
    p('plant-big', 17.4, 18), p('plant', 37.4, 19.4),
    p('extinguisher', 2.2, 18.2), p('trash', 24.4, 19.4), p('trash', 39.4, 17.4),
    p('vending', 45.2, 18.2, { w: 1.6, h: 1.5 }),
    p('clock', 28.4, 16.4), p('doormat', 2.1, 17, { w: 1.4, h: 2 }),
    p('sign', 2.2, 19.3, { w: 2.2, h: .6, label: 'EXIT' }),

    /* ---------------- Gymnasium ---------------- */
    ...ceilingLights(3, 23, 18, 10, 4, 3),
    p('mat', 3.4, 23.4, { w: 4, h: 2.4 }), p('mat', 3.4, 26.4, { w: 4, h: 2.4 }),
    p('mat', 16.4, 29.4, { w: 4.4, h: 2.6 }),
    p('bench', 2.15, 30.4, { w: 1.1, h: 3.2, d: 'v' }),
    p('bench', 5.4, 32.4, { w: 4.4, h: 1.2, d: 'h' }),
    p('bench', 11.4, 32.4, { w: 4.4, h: 1.2, d: 'h' }),
    p('hoop', 11.4, 22.2, { w: 2.4, h: 1.2 }), p('hoop', 11.4, 32.6, { w: 2.4, h: 1.2 }),
    p('ball', 9.4, 26.4), p('ball', 14.6, 28.2), p('ball', 8.2, 30.4),
    p('crate', 19.4, 22.4, { w: 2, h: 2 }),
    p('ladder', 20.6, 25.4, { w: 1.1, h: 5 }),
    p('box', 19.4, 31.4, { w: 1.4, h: 1.3 }),
    ...curtainsH(4, 34.4, 6, { c: 'green' }), ...curtainsH(13, 34.4, 6, { c: 'green' }),

    /* ---------------- Staff Room (HIM) ---------------- */
    ...ceilingLights(25, 23, 8, 10, 2, 2),
    p('rug', 24.6, 23.6, { w: 5.4, h: 3.6, c: 'warm' }),
    p('armchair', 25.4, 23.8, { w: 2.4, h: 2.4, d: 's' }),
    p('sleeper', 26.4, 24.6, { w: 1.7, h: 1.7, label: 'Mr. Vrána' }),
    p('armchair', 28.4, 23.8, { w: 2.2, h: 2.2, d: 's' }),
    p('coffee-table', 25.8, 26.6, { w: 2.6, h: 1.4 }),
    p('mug', 26.6, 26.9), p('papers', 27.6, 26.8),
    p('cabinet', 30.6, 22.15, { w: 2.4, h: 1.3, label: 'CONFISCATED' }),
    p('phone', 31.4, 22.4, { w: .8, h: .7 }),
    p('counter', 24.2, 22.15, { w: 4.4, h: 1.3 }),
    p('sink', 24.4, 22.3, { w: 1.3, h: 1 }), p('kettle', 26.4, 22.4), p('microwave', 27.2, 22.3, { w: 1.2, h: .9 }),
    p('fridge', 32.4, 23.4, { w: 1.3, h: 1.9 }),
    p('table', 29.4, 28.6, { w: 3.4, h: 2 }),
    p('chair', 29.8, 27.5, { d: 's' }), p('chair', 31.6, 27.5, { d: 's' }),
    p('chair', 29.8, 30.7, { d: 'n' }), p('chair', 31.6, 30.7, { d: 'n' }),
    p('lockers', 24.15, 29.4, { w: 1.2, h: 3.4, d: 'v' }),
    p('lamp-floor', 28.6, 26.4),
    p('plant-big', 32.2, 31.4), p('trash', 25.4, 32.4),
    p('clock', 28.4, 22.4),
    ...curtainsH(25, 34.4, 5, { c: 'red' }),

    /* ---------------- Caretaker's cupboard ---------------- */
    p('lamp-ceiling', 37.8, 22.4, { w: 1.4, h: .6 }),
    p('shelf', 36.15, 22.15, { w: 4.4, h: 1.2 }),
    p('shelf', 40, 24.4, { w: 1.1, h: 3, d: 'v' }),
    p('bucket', 36.4, 25.4), p('broom', 37.6, 24.6), p('ladder', 36.3, 26.6, { w: 3, h: 1.1 }),
    p('box', 38.6, 26.4, { w: 1.2, h: 1.1 }),
    p('sewing', 38.4, 24.4, { w: 1.4, h: 1 }),

    /* ---------------- Changing Room ---------------- */
    p('lamp-ceiling', 37.8, 29.4, { w: 1.4, h: .6 }),
    p('lockers', 36.15, 29.15, { w: 4.4, h: 1.2 }),
    p('bench', 36.4, 31.4, { w: 4, h: 1.2, d: 'h' }),
    p('bench', 36.4, 33, { w: 4, h: 1.2, d: 'h' }),
    p('trash', 40, 33.4),

    /* ---------------- Toilets ---------------- */
    p('lamp-ceiling', 44.4, 22.4, { w: 1.4, h: .6 }), p('lamp-ceiling', 44.4, 30.4, { w: 1.4, h: .6 }),
    p('toilet', 43.4, 22.4, { w: 1.2, h: 1.7 }),
    p('toilet', 46.2, 22.4, { w: 1.2, h: 1.7 }),
    p('basin', 43.3, 28.4, { w: 1.5, h: 1.1 }), p('basin', 45.3, 28.4, { w: 1.5, h: 1.1 }),
    p('mirror', 43.4, 27.4, { w: 3.4, h: .45 }),
    p('radiator', 43.3, 33.4, { w: 2.4, h: .5 }),
    p('trash', 46.2, 31.4),
  ],
};
