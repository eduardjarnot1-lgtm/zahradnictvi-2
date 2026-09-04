import { p, rowOf, ceilingLights, chairsAlong, workstation } from '../prop-helpers.mjs';

const OPEN  = { name: 'Open Office',     x: 2,  y: 2,  w: 24, h: 13, floor: ',' };
const BOSS  = { name: "Boss's Office",   x: 27, y: 2,  w: 7,  h: 6,  floor: ',' };
const MEET  = { name: 'Meeting Room',    x: 27, y: 8,  w: 7,  h: 7,  floor: ',' };
const VCOR  = { name: 'Landing',         x: 35, y: 2,  w: 2,  h: 13, floor: '.' };
const KIT   = { name: 'Kitchenette',     x: 38, y: 2,  w: 5,  h: 6,  floor: ':' };
const STOR  = { name: 'Copy & Storage',  x: 38, y: 9,  w: 5,  h: 6,  floor: '.' };
const COR   = { name: 'Corridor',        x: 2,  y: 16, w: 41, h: 3,  floor: '.' };
const CONF  = { name: 'Conference Room', x: 2,  y: 20, w: 16, h: 11, floor: ',' };
const WC    = { name: 'Washroom',        x: 19, y: 20, w: 6,  h: 11, floor: ':' };
const LOUN  = { name: 'Lounge',          x: 26, y: 20, w: 17, h: 11, floor: ',' };

const podA = { x: 7.4, y: 4.2 }, podB = { x: 16.4, y: 4.2 };
const confTable = { x: 5.4, y: 23.2, w: 7.4, h: 3.4 };
const meetTable = { x: 29, y: 9.4, w: 3, h: 4.4 };

export default {
  id: 'office',
  name: 'Fourth Floor, After Hours',
  subtitle: 'Open plan, one corner office, one sleeping boss',
  objective: 'Your keys are still on the meeting-room table. Mr. Halas fell asleep at his desk with the door open — get them and reach the fire stairs. The corridor lino squeaks; the carpet does not.',
  difficulty: 1,
  w: 44, h: 33,

  rooms: [OPEN, BOSS, MEET, VCOR, KIT, STOR, COR, CONF, WC, LOUN],

  walls: [
    { x: 21, y: 20, w: 1, h: 4 },       // washroom stall divider
  ],

  windows: [
    { x: 5, y: 1, w: 4, h: 1 }, { x: 12, y: 1, w: 4, h: 1 }, { x: 19, y: 1, w: 4, h: 1 },
    { x: 39, y: 1, w: 3, h: 1 },
    { x: 1, y: 4, w: 1, h: 4 }, { x: 1, y: 10, w: 1, h: 4 },
    { x: 1, y: 22, w: 1, h: 3 }, { x: 1, y: 27, w: 1, h: 3 },
    { x: 43, y: 3, w: 1, h: 4 }, { x: 43, y: 10, w: 1, h: 4 }, { x: 43, y: 22, w: 1, h: 5 },
    { x: 5, y: 31, w: 4, h: 1 }, { x: 12, y: 31, w: 4, h: 1 },
    { x: 29, y: 31, w: 4, h: 1 }, { x: 36, y: 31, w: 4, h: 1 },
    { x: 26, y: 8, w: 1, h: 4, glass: true },   // glass wall onto the meeting room
    { x: 27, y: 15, w: 4, h: 1, glass: true },
  ],

  openings: [
    { x: 11, y: 15, w: 2, t: 'open',  note: 'Open plan onto the corridor' },
    { x: 35, y: 15, t: 'door' },
    { x: 26, y: 4, t: 'door',         note: "Boss's door — he never closes it" },
    { x: 34, y: 4, t: 'door' },
    { x: 34, y: 11, t: 'door' },
    { x: 37, y: 4, t: 'door' },
    { x: 37, y: 11, t: 'door' },
    { x: 8,  y: 19, w: 2, t: 'open' },
    { x: 21, y: 19, t: 'door' },
    { x: 32, y: 19, w: 2, t: 'open' },
    { x: 25, y: 25, t: 'vent',        note: 'Duct behind the cistern' },
    { x: 1,  y: 17, t: 'exit',        note: 'Fire stairs' },
    { x: 43, y: 17, t: 'elevator',    note: 'You came up in this' },
  ],

  spawn:   { x: 41.4, y: 17, facing: 'w' },
  exit:    { x: 1.5, y: 17.5 },
  sleeper: { x: 30.2, y: 3.4, name: 'Mr. Halas', sense: 6, note: 'Face down on the quarterly report' },

  hideSpots: [
    { x: 2, y: 8, w: 3, h: 4, kind: 'behind the copier' },
    { x: 38, y: 9, w: 5, h: 6, kind: 'storage room' },
    { x: 19, y: 20, w: 2, h: 4, kind: 'toilet stall' },
    { x: 26, y: 27, w: 4, h: 3, kind: 'behind the sofa' },
  ],

  patrols: [
    { name: 'Cleaner', loop: [[3, 17], [20, 17], [40, 17], [20, 17]] },
  ],

  props: [
    /* ---------------- Open Office ---------------- */
    ...ceilingLights(3, 3, 22, 11, 4, 3),
    p('desk-l', 2.4, 2.4, { w: 5.4, h: 3.4 }),
    p('monitor', 3.1, 2.7, { d: 's' }), p('papers', 5.6, 3.4), p('lamp-table', 6.6, 2.7),
    p('office-chair', 4.4, 5.1, { d: 'n' }),
    p('filing', 8.4, 2.3, { w: 1.6, h: 1.2 }), p('filing', 10.2, 2.3, { w: 1.6, h: 1.2 }),

    ...workstation(podA.x, podA.y, 'n'), ...workstation(podA.x + 3, podA.y, 'n'),
    ...workstation(podA.x, podA.y + 2.4, 's'), ...workstation(podA.x + 3, podA.y + 2.4, 's'),
    ...workstation(podB.x, podB.y, 'n'), ...workstation(podB.x + 3, podB.y, 'n'),
    ...workstation(podB.x, podB.y + 2.4, 's'), ...workstation(podB.x + 3, podB.y + 2.4, 's'),
    ...workstation(9.4, 11.2, 'n'), ...workstation(16.4, 11.2, 'n'),
    p('laptop', 12.6, 11.4), p('mug', 9.2, 11.5), p('mug', 18.4, 11.5),

    p('copier', 2.4, 8.4, { w: 2.2, h: 2 }),
    p('printer', 2.4, 11, { w: 2, h: 1.6 }),
    p('trash', 2.6, 13.2), p('trash', 21.6, 13.2),
    p('water-cooler', 24.2, 2.4),
    p('bookcase', 22.6, 4.4, { w: 1.3, h: 4, d: 'v' }),
    p('whiteboard', 14.4, 2.06, { w: 4, h: 0.7 }),
    p('plant-big', 23.4, 12.4), p('plant-big', 2.4, 6.4), p('plant', 21.8, 9.4),
    p('coat-rack', 24.2, 13.2),
    p('blinds', 5, 2.06, { w: 4, h: 0.55 }), p('blinds', 12, 2.06, { w: 4, h: 0.55 }), p('blinds', 19, 2.06, { w: 4, h: 0.55 }),
    p('curtain', 2.05, 4, { w: 0.7, h: 1.9, d: 'v', c: 'green' }), p('curtain', 2.05, 12.1, { w: 0.7, h: 1.9, d: 'v', c: 'green' }),

    /* ---------------- Boss's Office (HIM) ---------------- */
    ...ceilingLights(27.5, 2.5, 6, 5, 2, 1),
    p('rug', 27.4, 5.4, { w: 5.2, h: 2.2, c: 'blue' }),
    p('desk-l', 28.4, 2.4, { w: 5, h: 3 }),
    p('monitor', 29, 2.7, { d: 's' }), p('papers', 31.4, 3.3), p('lamp-table', 32.6, 2.6),
    p('office-chair', 30.2, 3.3, { d: 's' }),
    p('sleeper', 30.2, 3.4, { w: 1.5, h: 1.5, label: 'Mr. Halas' }),
    p('bookcase', 27.15, 2.4, { w: 1.1, h: 3.2, d: 'v' }),
    p('armchair', 30.6, 5.8, { w: 2.2, h: 2, d: 'n' }),
    p('plant-big', 32.8, 6.2),
    p('clock', 27.2, 7.2), p('mug', 32.2, 3.5),

    /* ---------------- Meeting Room ---------------- */
    ...ceilingLights(27.5, 9, 6, 5, 2, 1),
    p('conference-table', meetTable.x, meetTable.y, { w: meetTable.w, h: meetTable.h }),
    ...chairsAlong(meetTable, 3),
    p('keys', 30.2, 11.2, { label: 'YOUR KEYS' }),
    p('papers', 29.4, 10.1), p('mug', 31.3, 12.6),
    p('tv-wall', 27.15, 9.4, { w: 0.7, h: 2.4 }),
    p('whiteboard', 28.6, 14.3, { w: 3.4, h: 0.7 }),
    p('plant', 32.6, 13.6), p('trash', 27.4, 13.8),

    /* ---------------- Landing / stair lobby ---------------- */
    ...ceilingLights(35, 3, 2, 11, 1, 3),
    p('plant-big', 35.2, 2.4), p('plant', 35.4, 13.4),
    p('extinguisher', 36.2, 6.3), p('board', 35.2, 8.2, { w: 1.6, h: 0.9 }),
    p('doormat', 35.2, 15.1, { w: 1.6, h: 0.8 }),

    /* ---------------- Kitchenette ---------------- */
    ...ceilingLights(38, 2.5, 5, 5, 2, 1),
    p('counter', 38.2, 2.15, { w: 4.6, h: 1.3 }),
    p('sink', 38.4, 2.3, { w: 1.4, h: 1 }),
    p('kettle', 40.2, 2.4), p('mug', 41.4, 2.5), p('mug', 42.1, 2.5),
    p('fridge', 42, 4.2, { w: 1.2, h: 1.8 }),
    p('table-round', 38.6, 4.6, { w: 2.6, h: 2.6 }),
    p('stool', 38.2, 5.6, { w: 0.9, h: 0.9 }), p('stool', 41.4, 5.6, { w: 0.9, h: 0.9 }),
    p('stool', 39.8, 4.05, { w: 0.9, h: 0.9 }),
    p('trash', 38.2, 7), p('plant', 41.8, 7),
    p('blinds', 39, 2.06, { w: 3, h: 0.5 }),

    /* ---------------- Copy & Storage ---------------- */
    p('lamp-ceiling', 40, 9.6, { w: 1.5, h: 0.7 }), p('lamp-ceiling', 40, 13, { w: 1.5, h: 0.7 }),
    p('shelf', 38.2, 9.15, { w: 4.6, h: 1.2 }),
    p('shelf', 42, 11, { w: 1.1, h: 3.4, d: 'v' }),
    p('copier', 38.4, 11.4, { w: 2.2, h: 2 }),
    p('box', 38.3, 13.8, { w: 1.2, h: 1.1 }), p('box', 39.7, 13.9, { w: 1, h: 1 }),
    p('crate', 41, 13.6, { w: 1.4, h: 1.4 }),

    /* ---------------- Corridor ---------------- */
    ...ceilingLights(3, 16.5, 39, 2, 8, 1),
    p('rug', 3, 17.2, { w: 12, h: 1.4, c: 'grey' }),
    p('rug', 24, 17.2, { w: 12, h: 1.4, c: 'grey' }),
    p('bench', 3.4, 16.2, { w: 3.4, h: 1.1, d: 'h' }),
    p('plant-big', 17.4, 16.3), p('plant-big', 27.4, 16.3), p('plant', 38.4, 17.6),
    p('board', 14.4, 16.15, { w: 2.4, h: 0.8 }),
    p('vending', 30.2, 16.2, { w: 1.6, h: 1.3 }),
    p('water-cooler', 22.2, 16.3),
    p('extinguisher', 2.2, 18.2), p('trash', 20.4, 18.2),
    p('sign', 2.2, 18.3, { w: 2, h: 0.6, label: 'EXIT' }),

    /* ---------------- Conference Room ---------------- */
    ...ceilingLights(3, 21, 14, 9, 3, 2),
    p('rug', 4.2, 22.2, { w: 10, h: 5.6, c: 'blue' }),
    p('conference-table', confTable.x, confTable.y, { w: confTable.w, h: confTable.h }),
    ...chairsAlong(confTable, 4),
    p('papers', 7, 24.2), p('papers', 10.4, 24.6), p('mug', 8.8, 23.6),
    p('projector', 9, 21.4),
    p('tv-wall', 2.1, 23.4, { w: 0.75, h: 3 }),
    p('whiteboard', 12.6, 30.35, { w: 4, h: 0.7 }),
    p('cabinet', 14.6, 21.4, { w: 2.4, h: 1.2 }),
    p('plant-big', 15.6, 28.4), p('plant-big', 2.6, 28.4), p('plant', 15.8, 23.6),
    p('curtain', 2.05, 22, { w: 0.7, h: 1.4, d: 'v', c: 'green' }),
    p('curtain', 2.05, 28.6, { w: 0.7, h: 1.4, d: 'v', c: 'green' }),
    p('curtain', 5, 30.4, { w: 1.5, h: 0.6, c: 'green' }), p('curtain', 13.5, 30.4, { w: 1.5, h: 0.6, c: 'green' }),

    /* ---------------- Washroom ---------------- */
    p('lamp-ceiling', 21.2, 20.4, { w: 1.4, h: 0.6 }), p('lamp-ceiling', 21.2, 27.4, { w: 1.4, h: 0.6 }),
    p('toilet', 19.5, 20.4, { w: 1.3, h: 1.8 }),
    p('toilet', 22.4, 20.4, { w: 1.3, h: 1.8 }),
    p('basin', 19.4, 26.2, { w: 1.6, h: 1.1 }), p('basin', 21.4, 26.2, { w: 1.6, h: 1.1 }),
    p('mirror', 19.4, 25.15, { w: 3.6, h: 0.5 }),
    p('trash', 23.4, 26.4), p('radiator', 19.2, 30.4, { w: 2.4, h: 0.5 }),
    p('plant', 23.4, 29.4),

    /* ---------------- Lounge ---------------- */
    ...ceilingLights(27, 21, 15, 9, 3, 2),
    p('rug', 28.4, 23, { w: 7, h: 5, c: 'warm' }),
    p('sofa', 28.6, 22.4, { w: 4.6, h: 2, d: 's' }),
    p('armchair', 28.2, 25.6, { w: 2.2, h: 2.2, d: 'e' }),
    p('armchair', 33.2, 25.6, { w: 2.2, h: 2.2, d: 'w' }),
    p('coffee-table', 30.8, 25.8, { w: 2.4, h: 1.8 }),
    p('mug', 31.4, 26.2), p('book', 32.2, 26.4),
    p('lamp-floor', 27.4, 22.4, { w: 1.1, h: 1.1 }),
    p('bookcase', 36.4, 20.15, { w: 4, h: 1.2 }),
    p('tv-wall', 30.6, 30.35, { w: 3, h: 0.7 }),
    p('counter', 38.4, 22.2, { w: 4.2, h: 1.4 }),
    p('kettle', 39, 22.4), p('mug', 40.2, 22.5), p('sink', 41, 22.3, { w: 1.3, h: 1 }),
    p('table-round', 38.8, 25.4, { w: 2.8, h: 2.8 }),
    p('chair', 38.2, 26.6, { d: 'e' }), p('chair', 41.6, 26.6, { d: 'w' }),
    p('plant-big', 41.4, 29.4), p('plant-big', 26.4, 29.4),
    p('curtain', 29, 30.4, { w: 1.5, h: 0.6, c: 'cream' }), p('curtain', 36, 30.4, { w: 1.5, h: 0.6, c: 'cream' }),
    p('curtain', 42.2, 22, { w: 0.7, h: 1.6, d: 'v', c: 'cream' }),
    p('trash', 34.4, 29.4),
  ],
};
