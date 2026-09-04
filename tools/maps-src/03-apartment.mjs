import { p, rowOf, ceilingLights, chairsAlong, chairsAround, bedSet, curtainsH, curtainsV } from '../prop-helpers.mjs';

const BATH1 = { name: 'Guest Bath',   x: 2,  y: 2,  w: 6,  h: 6,  floor: ':' };
const TERR  = { name: 'Roof Terrace', x: 9,  y: 2,  w: 16, h: 6,  floor: 'o' };
const BATH2 = { name: 'En-suite',     x: 26, y: 2,  w: 8,  h: 6,  floor: ':' };
const KIT   = { name: 'Kitchen',      x: 2,  y: 9,  w: 11, h: 10, floor: ':' };
const HALL  = { name: 'Hall',         x: 14, y: 9,  w: 8,  h: 12, floor: ',' };
const MBED  = { name: 'Their Bedroom',x: 23, y: 9,  w: 11, h: 12, floor: ',' };
const STAIR = { name: 'Stairwell',    x: 2,  y: 22, w: 9,  h: 14, floor: '=' };
const LIV   = { name: 'Living Room',  x: 12, y: 22, w: 12, h: 14, floor: '~' };
const WGARD = { name: 'Winter Garden',x: 25, y: 22, w: 9,  h: 14, floor: 'o' };
const BATH3 = { name: 'Bathroom',     x: 2,  y: 37, w: 7,  h: 11, floor: ':' };
const DRESS = { name: 'Dressing Room',x: 10, y: 37, w: 6,  h: 11, floor: ',' };
const KBED  = { name: 'Your Room',    x: 17, y: 37, w: 17, h: 11, floor: '~' };
const UTIL  = { name: 'Utility',      x: 2,  y: 49, w: 6,  h: 6,  floor: ':' };
const BALC  = { name: 'Balcony',      x: 9,  y: 49, w: 16, h: 6,  floor: 'o' };
const STORE = { name: 'Store Room',   x: 26, y: 49, w: 8,  h: 6,  floor: '.' };

const dining = { x: 14.6, y: 31.4, w: 6.4, h: 2.8 };

export default {
  id: 'apartment',
  name: 'The Flat, 02:14',
  subtitle: 'Two floors up, one sleeping father',
  objective: 'Cross the whole flat from your room to the kitchen, take the cake out of the fridge, and be out of the front door before Dad turns over. The living-room parquet is the loudest floor in the building.',
  difficulty: 3,
  w: 36, h: 57,

  rooms: [BATH1, TERR, BATH2, KIT, HALL, MBED, STAIR, LIV, WGARD, BATH3, DRESS, KBED, UTIL, BALC, STORE],

  walls: [
    { x: 5, y: 2, w: 1, h: 3 },        // shower screen, guest bath
    { x: 30, y: 5, w: 4, h: 1 },       // en-suite half wall
  ],

  windows: [
    { x: 2, y: 1, w: 3, h: 1 }, { x: 30, y: 1, w: 3, h: 1 },
    { x: 10, y: 1, w: 6, h: 1, glass: true }, { x: 18, y: 1, w: 6, h: 1, glass: true },
    { x: 1, y: 10, w: 1, h: 4 }, { x: 1, y: 15, w: 1, h: 3 },
    { x: 1, y: 24, w: 1, h: 4 }, { x: 1, y: 31, w: 1, h: 3 },
    { x: 1, y: 39, w: 1, h: 4 }, { x: 1, y: 44, w: 1, h: 3 },
    { x: 1, y: 50, w: 1, h: 3 },
    { x: 34, y: 3, w: 1, h: 4 },
    { x: 34, y: 11, w: 1, h: 4 }, { x: 34, y: 16, w: 1, h: 4 },
    { x: 34, y: 23, w: 1, h: 5, glass: true }, { x: 34, y: 30, w: 1, h: 5, glass: true },
    { x: 34, y: 39, w: 1, h: 4 }, { x: 34, y: 44, w: 1, h: 3 },
    { x: 34, y: 50, w: 1, h: 3 },
    { x: 9, y: 56, w: 6, h: 1, glass: true }, { x: 18, y: 56, w: 6, h: 1, glass: true },
    { x: 24, y: 26, w: 1, h: 3, glass: true },
    { x: 8, y: 2, w: 1, h: 3, glass: true },
    { x: 25, y: 3, w: 1, h: 4, glass: true },
  ],

  openings: [
    { x: 4,  y: 8,  t: 'door',  note: 'Guest bath' },
    { x: 17, y: 8,  w: 2, t: 'open', note: 'Terrace doors — glazed, quiet' },
    { x: 29, y: 8,  t: 'door' },
    { x: 13, y: 13, t: 'open',  note: 'Kitchen arch' },
    { x: 22, y: 14, t: 'door',  note: 'THEIR door. It clicks.' },
    { x: 16, y: 21, w: 3, t: 'open' },
    { x: 11, y: 26, t: 'door' },
    { x: 24, y: 30, h: 2, t: 'open', note: 'Sliding glazed doors' },
    { x: 13, y: 36, t: 'door' },
    { x: 19, y: 36, t: 'door',  note: 'Your door — hinge oiled last week' },
    { x: 5,  y: 36, t: 'door' },
    { x: 9,  y: 41, t: 'door' },
    { x: 4,  y: 48, t: 'door' },
    { x: 12, y: 48, t: 'door' },
    { x: 20, y: 48, w: 2, t: 'open', note: 'Balcony doors' },
    { x: 29, y: 48, t: 'door' },
    { x: 16, y: 41, t: 'vent', note: 'Old laundry chute' },
    { x: 1,  y: 28, h: 2, t: 'exit', note: 'Front door to the stairwell' },
  ],

  spawn:   { x: 25.5, y: 41.5, facing: 'w', note: 'Out of your own bed' },
  exit:    { x: 1.5, y: 28.5 },
  sleeper: { x: 28, y: 11.4, name: 'Dad', sense: 8, note: 'On his back, arm over his eyes, snoring in bursts' },

  hideSpots: [
    { x: 14, y: 9, w: 3, h: 3, kind: 'behind the coat rack' },
    { x: 12, y: 41, w: 3, h: 4, kind: 'in the wardrobe' },
    { x: 25, y: 33, w: 4, h: 3, kind: 'behind the big fern' },
    { x: 2, y: 49, w: 6, h: 6, kind: 'utility room' },
    { x: 12, y: 22, w: 4, h: 3, kind: 'behind the sofa' },
  ],

  patrols: [
    { name: 'Dad (if woken)', loop: [[28, 12], [22, 14], [17, 20], [17, 30], [13, 13], [17, 20], [28, 12]] },
    { name: 'The cat', loop: [[29, 33], [20, 30], [17, 24], [13, 13], [20, 30], [29, 33]] },
  ],

  props: [
    /* ---------------- Guest Bath ---------------- */
    p('lamp-ceiling', 4.2, 2.4, { w: 1.4, h: 0.6 }),
    p('shower', 2.2, 2.2, { w: 2.6, h: 2.6 }),
    p('toilet', 6.4, 2.4, { w: 1.3, h: 1.8 }),
    p('basin', 2.3, 6.4, { w: 1.8, h: 1.2 }),
    p('mirror', 2.4, 5.3, { w: 1.7, h: 0.45 }),
    p('radiator', 6.5, 5.4, { w: 0.5, h: 2, d: 'v' }),
    p('trash', 5.2, 6.6), p('mat', 4.4, 6.4, { w: 1.6, h: 1 }),

    /* ---------------- Roof Terrace ---------------- */
    p('table-round', 14.4, 3.6, { w: 3, h: 3 }),
    ...chairsAround(15.9, 5.1, {}),
    p('bench', 20.4, 3.2, { w: 3.6, h: 1.4, d: 'h' }),
    p('plant-big', 9.4, 2.4), p('plant-big', 9.4, 6), p('plant-big', 23.2, 6),
    p('plant', 22.4, 2.6), p('tree', 11.4, 6, { w: 2, h: 2 }),
    p('lamp-floor', 19.4, 6.2), p('rug', 12.4, 6.2, { w: 3, h: 1.4, c: 'green' }),

    /* ---------------- En-suite ---------------- */
    p('lamp-ceiling', 29.4, 2.4, { w: 1.4, h: 0.6 }),
    p('bathtub', 26.3, 2.3, { w: 3.4, h: 2, d: 'h' }),
    p('shower', 31.4, 2.3, { w: 2.4, h: 2.6 }),
    p('toilet', 26.4, 5.2, { w: 1.3, h: 1.8 }),
    p('basin', 28.4, 6.3, { w: 1.7, h: 1.2 }), p('basin', 30.4, 6.3, { w: 1.7, h: 1.2 }),
    p('mirror', 28.5, 5.25, { w: 3.6, h: 0.45 }),
    p('mat', 28.6, 4.4, { w: 2, h: 1 }), p('plant', 32.6, 6.4),

    /* ---------------- Kitchen ---------------- */
    ...ceilingLights(2.5, 9.5, 10, 9, 2, 2),
    p('counter', 2.15, 9.15, { w: 10.4, h: 1.5 }),
    p('sink', 3.2, 9.3, { w: 1.8, h: 1.2 }),
    p('stove', 6.2, 9.3, { w: 2, h: 1.2 }),
    p('microwave', 8.8, 9.3, { w: 1.5, h: 1 }),
    p('kettle', 10.8, 9.4), p('mug', 11.8, 9.5),
    p('fridge', 11.2, 11.2, { w: 1.6, h: 2.4, label: 'the cake is in here' }),
    p('dishwasher', 2.15, 11.4, { w: 1.4, h: 1.8 }),
    p('counter', 2.15, 13.6, { w: 1.5, h: 3 }),
    p('island', 4.4, 12.6, { w: 5.4, h: 2 }),
    p('stool', 5, 14.7, { w: 1, h: 1 }), p('stool', 6.6, 14.7, { w: 1, h: 1 }), p('stool', 8.2, 14.7, { w: 1, h: 1 }),
    p('papers', 5.4, 12.9), p('mug', 8.4, 12.9),
    p('table', 4.4, 15.9, { w: 4, h: 2 }),
    p('chair', 4.8, 17.95, { d: 'n' }), p('chair', 6.8, 17.95, { d: 'n' }),
    p('chair', 3.3, 16.4, { d: 'e' }), p('chair', 8.5, 16.4, { d: 'w' }),
    p('plant', 11.4, 17.4), p('trash', 10, 17.6),
    p('rug', 2.4, 17.4, { w: 1.6, h: 1.2, c: 'warm' }),
    ...curtainsV(2.05, 10, 4, { c: 'cream' }),

    /* ---------------- Hall ---------------- */
    p('chandelier', 17.2, 14.4, { w: 1.8, h: 1.8 }),
    p('rug', 16.4, 10.4, { w: 3.4, h: 9, c: 'red' }),
    p('cabinet', 14.15, 10.4, { w: 1.1, h: 2.6 }),
    p('mirror', 21.55, 12.4, { w: 0.45, h: 2.4 }),
    p('coat-rack', 14.4, 19.4), p('plant-big', 20.4, 19),
    p('painting', 14.15, 15.4, { w: 0.6, h: 2, c: 'gold' }),
    p('doormat', 16.4, 20.1, { w: 2.4, h: 0.9 }),
    p('shelf', 20.6, 9.2, { w: 1.2, h: 1.1 }),
    p('keys', 20.8, 9.35),

    /* ---------------- Their Bedroom (HIM) ---------------- */
    p('lamp-ceiling', 27.8, 9.6, { w: 1.6, h: 0.7 }),
    ...bedSet(26.6, 10.2, 4.4, 5.4),
    p('sleeper', 28, 11.4, { w: 1.7, h: 1.7, label: 'Dad' }),
    p('wardrobe', 32.3, 9.4, { w: 1.5, h: 4.4 }),
    p('dresser', 23.15, 9.6, { w: 1.3, h: 3 }),
    p('armchair', 23.4, 17.4, { w: 2.2, h: 2.2, d: 'e' }),
    p('lamp-floor', 23.6, 15.9),
    p('tv-wall', 27.6, 20.35, { w: 3, h: 0.7 }),
    p('desk', 29.6, 17.4, { w: 2.6, h: 1.4 }),
    p('office-chair', 30.5, 19.1, { d: 'n' }),
    p('papers', 30.9, 17.6), p('clock', 26, 9.4),
    p('plant', 32.6, 19.4),
    p('rug', 26.4, 17.2, { w: 3, h: 2, c: 'blue' }),
    ...curtainsV(32.4, 11, 4, { c: 'blue' }), ...curtainsV(32.4, 16, 4, { c: 'blue' }),

    /* ---------------- Stairwell ---------------- */
    p('lamp-ceiling', 6, 23.4, { w: 1.6, h: 0.7 }), p('lamp-ceiling', 6, 33.4, { w: 1.6, h: 0.7 }),
    p('stairs', 5.4, 24.4, { w: 4.4, h: 8, d: 'v' }),
    p('radiator', 2.15, 30.4, { w: 0.5, h: 2.6, d: 'v' }),
    p('plant-big', 9.2, 33.4), p('doormat', 9.4, 27.4, { w: 1.4, h: 2 }),
    p('board', 2.2, 23.4, { w: 1.6, h: 0.9 }),
    p('trash', 9.4, 23.4), p('broom', 2.4, 34.2),
    p('sign', 2.2, 28.2, { w: 2, h: 0.6, label: 'OUT' }),

    /* ---------------- Living Room ---------------- */
    p('chandelier', 17.2, 26.2, { w: 2.2, h: 2.2 }),
    ...ceilingLights(13, 33, 10, 2, 2, 1),
    p('rug', 13.4, 23.6, { w: 8.4, h: 5.4, c: 'warm' }),
    p('sofa', 13.4, 22.3, { w: 5, h: 2, d: 's' }),
    p('sofa', 13.4, 26.9, { w: 5, h: 2, d: 'n' }),
    p('armchair', 20.6, 24.4, { w: 2.2, h: 2.4, d: 'w' }),
    p('coffee-table', 15.4, 25.1, { w: 3, h: 1.6 }),
    p('mug', 16.2, 25.5), p('book', 17.4, 25.6),
    p('tv-wall', 12.1, 24.6, { w: 0.75, h: 3 }),
    p('bookcase', 12.15, 29.4, { w: 1.2, h: 4, d: 'v' }),
    p('lamp-floor', 20.8, 22.4), p('lamp-floor', 12.4, 34.4),
    p('plant-big', 22.2, 34.2), p('plant-big', 22.2, 22.4),
    p('dining-table', dining.x, dining.y, { w: dining.w, h: dining.h }),
    ...chairsAlong(dining, 3),
    p('vase', 17.4, 32.4, { c: 'jade' }),
    p('clock', 15.4, 21.2),
    p('cat', 19.4, 29.4),

    /* ---------------- Winter Garden ---------------- */
    p('lamp-ceiling', 29, 23.4, { w: 1.6, h: 0.7 }),
    p('plant-big', 25.4, 22.4), p('plant-big', 32.2, 22.4),
    p('plant-big', 25.4, 34), p('plant-big', 32.2, 34),
    p('tree', 25.6, 27.4, { w: 2.4, h: 2.4 }),
    p('armchair', 28.4, 25.4, { w: 2.2, h: 2.2, d: 's' }),
    p('armchair', 31, 25.4, { w: 2.2, h: 2.2, d: 's' }),
    p('coffee-table', 29.2, 28.4, { w: 2.6, h: 1.6 }),
    p('rug-round', 28.4, 30.4, { w: 3.4, h: 3.4, c: 'blue' }),
    p('bench', 29.4, 33.4, { w: 3.4, h: 1.2, d: 'h' }),
    p('mug', 30.2, 28.7),

    /* ---------------- Bathroom (yours) ---------------- */
    p('lamp-ceiling', 5, 37.6, { w: 1.4, h: 0.6 }), p('lamp-ceiling', 5, 45.4, { w: 1.4, h: 0.6 }),
    p('bathtub', 2.2, 37.3, { w: 4.4, h: 2.2, d: 'h' }),
    p('toilet', 7.4, 37.6, { w: 1.3, h: 1.8 }),
    p('basin', 2.2, 41.4, { w: 1.9, h: 1.3 }), p('basin', 2.2, 43.4, { w: 1.9, h: 1.3 }),
    p('mirror', 2.1, 41.3, { w: 0.4, h: 3.5 }),
    p('washer', 7, 41.4, { w: 1.8, h: 1.8 }),
    p('shower', 6.4, 44.4, { w: 2.4, h: 2.6 }),
    p('mat', 3.4, 45.6, { w: 2, h: 1.2 }),
    p('radiator', 4.4, 47.4, { w: 2.4, h: 0.5 }),
    p('trash', 5.4, 40.4), p('bucket', 2.4, 46.4),

    /* ---------------- Dressing Room ---------------- */
    p('lamp-ceiling', 12.4, 38.4, { w: 1.4, h: 0.6 }),
    p('wardrobe', 10.15, 37.4, { w: 1.4, h: 4 }),
    p('wardrobe', 14.4, 37.4, { w: 1.4, h: 4 }),
    p('shelf', 13.4, 42.4, { w: 1.1, h: 3.4, d: 'v' }),
    p('mirror', 10.1, 43.4, { w: 0.4, h: 2.6 }),
    p('stool', 11.4, 45.4, { w: 1.1, h: 1.1 }),
    p('suitcase', 14.4, 46.2, { w: 1.4, h: 1 }),
    p('box', 10.4, 46.4, { w: 1.2, h: 1.1 }),
    p('rug', 11.2, 42.4, { w: 1.6, h: 2.4, c: 'red' }),

    /* ---------------- Your Room ---------------- */
    p('lamp-ceiling', 24.8, 38, { w: 1.6, h: 0.7 }),
    ...bedSet(24.4, 39.4, 3.4, 4.6),
    p('player', 25.6, 41, { w: 1.2, h: 1.2 }),
    p('desk', 29.6, 37.3, { w: 3.2, h: 1.6 }),
    p('laptop', 30.6, 37.5), p('lamp-table', 32.2, 37.5),
    p('office-chair', 30.8, 39.2, { d: 'n' }),
    p('bookcase', 32.4, 40.4, { w: 1.3, h: 3.6, d: 'v' }),
    p('wardrobe', 17.15, 37.4, { w: 1.4, h: 4 }),
    p('box', 17.4, 42.4, { w: 1.6, h: 1.4 }),
    p('teddy', 18.1, 42.7), p('blocks', 19.4, 46.2), p('ball', 21.4, 45.6),
    p('rug-round', 19.4, 42.4, { w: 3.4, h: 3.4, c: 'blue' }),
    p('nightlight', 23.9, 43.9),
    p('plant', 32.6, 46.4), p('trash', 29.4, 46.6),
    ...curtainsV(32.5, 39, 4, { c: 'green' }),

    /* ---------------- Utility ---------------- */
    p('lamp-ceiling', 4.2, 49.4, { w: 1.4, h: 0.6 }),
    p('washer', 2.2, 49.3, { w: 1.8, h: 1.8 }),
    p('shelf', 4.4, 49.15, { w: 3.4, h: 1.1 }),
    p('bucket', 2.4, 53.4), p('broom', 3.6, 52.4), p('ladder', 6.4, 51.4, { w: 1.2, h: 3.2 }),
    p('box', 4.4, 53.4, { w: 1.2, h: 1.1 }),

    /* ---------------- Balcony ---------------- */
    p('bench', 10.4, 49.4, { w: 4, h: 1.4, d: 'h' }),
    p('table-round', 15.4, 51.4, { w: 2.6, h: 2.6 }),
    p('chair', 15, 50.3, { d: 's' }), p('chair', 17.2, 52.5, { d: 'w' }),
    p('plant-big', 9.4, 53), p('plant-big', 23.2, 53), p('plant-big', 23.2, 49.4),
    p('plant', 19.4, 49.6), p('tree', 21.4, 51.4, { w: 2, h: 2 }),
    p('lamp-floor', 12.4, 53.4),

    /* ---------------- Store Room ---------------- */
    p('lamp-ceiling', 29.4, 49.4, { w: 1.4, h: 0.6 }),
    p('shelf', 26.2, 49.15, { w: 4.6, h: 1.2 }),
    p('shelf', 32.4, 50.4, { w: 1.2, h: 3.4, d: 'v' }),
    p('crate', 26.4, 51.4, { w: 1.8, h: 1.8 }),
    p('box', 28.6, 52.4, { w: 1.4, h: 1.3 }),
    p('cart', 30.2, 51.6, { w: 2, h: 1.5 }),
    p('suitcase', 26.6, 53.6, { w: 1.4, h: 1 }),
  ],
};
