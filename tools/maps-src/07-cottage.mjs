import { p, rowOf, ceilingLights, bedSet, curtainsH, curtainsV } from '../prop-helpers.mjs';

const PARL = { name: 'Parlour',      x: 2,  y: 2,  w: 14, h: 15, floor: '~' };
const KIT  = { name: 'Kitchen',      x: 2,  y: 18, w: 14, h: 16, floor: '~' };
const HALL = { name: 'Hall',         x: 17, y: 2,  w: 7,  h: 32, floor: '~' };
const BED  = { name: 'Their Bedroom',x: 25, y: 2,  w: 16, h: 14, floor: '~' };
const PANT = { name: 'Pantry',       x: 25, y: 18, w: 7,  h: 7,  floor: '.' };
const BATH = { name: 'Bathroom',     x: 33, y: 18, w: 8,  h: 7,  floor: ':' };
const CONS = { name: 'Conservatory', x: 25, y: 27, w: 16, h: 7,  floor: 'o' };

export default {
  id: 'cottage',
  name: "Grandpa's Cottage",
  subtitle: 'Every single board creaks',
  objective: 'The biscuit tin is on the pantry shelf. Grandpa is asleep in the armchair by the fire — three metres from the hall you have to cross. There is no quiet floor in this house; there are only slower ways to walk.',
  difficulty: 5,
  w: 43, h: 36,

  rooms: [PARL, KIT, HALL, BED, PANT, BATH, CONS],

  walls: [
    { x: 2, y: 8, w: 2, h: 1 },      // chimney breast beside the fireplace
    { x: 2, y: 12, w: 2, h: 1 },
    { x: 38, y: 18, w: 1, h: 3 },    // bathroom screen wall
  ],

  windows: [
    { x: 1, y: 4, w: 1, h: 4 }, { x: 1, y: 13, w: 1, h: 3 },
    { x: 1, y: 20, w: 1, h: 4 }, { x: 1, y: 28, w: 1, h: 4 },
    { x: 41, y: 4, w: 1, h: 4 }, { x: 41, y: 10, w: 1, h: 4 },
    { x: 41, y: 20, w: 1, h: 3 },
    { x: 41, y: 28, w: 1, h: 5, glass: true },
    { x: 4, y: 1, w: 4, h: 1 }, { x: 11, y: 1, w: 4, h: 1 },
    { x: 27, y: 1, w: 4, h: 1 }, { x: 35, y: 1, w: 4, h: 1 },
    { x: 4, y: 34, w: 4, h: 1 }, { x: 11, y: 34, w: 4, h: 1 },
    { x: 27, y: 34, w: 5, h: 1, glass: true }, { x: 34, y: 34, w: 5, h: 1, glass: true },
    { x: 24, y: 28, w: 1, h: 4, glass: true },
  ],

  openings: [
    { x: 16, y: 6,  t: 'door', note: 'Parlour — the door HE is behind' },
    { x: 16, y: 24, t: 'door', note: 'Kitchen' },
    { x: 24, y: 6,  t: 'door', note: 'Their bedroom' },
    { x: 24, y: 20, t: 'door', note: 'Pantry' },
    { x: 24, y: 30, w: 2, t: 'open', note: 'Conservatory arch' },
    { x: 32, y: 21, t: 'door' },
    { x: 19, y: 1,  w: 2, t: 'locked', note: 'Front door, bolted for the night' },
    { x: 19, y: 34, w: 2, t: 'exit',   note: 'Back door to the garden' },
    { x: 16, y: 31, t: 'vent', note: 'Cat flap in the kitchen door' },
    { x: 16, y: 13, t: 'vent', note: 'Coal hatch' },
  ],

  spawn:   { x: 19.4, y: 3, facing: 's', note: 'You came down the attic ladder' },
  exit:    { x: 19.5, y: 34.4 },
  sleeper: { x: 4.6, y: 9.4, name: 'Grandpa', sense: 9, note: 'Armchair by the fire, newspaper over his face, one eye never quite shut' },

  hideSpots: [
    { x: 25, y: 18, w: 7, h: 7, kind: 'pantry' },
    { x: 12, y: 2, w: 4, h: 4, kind: 'behind the piano' },
    { x: 25, y: 31, w: 5, h: 3, kind: 'among the ferns' },
    { x: 33, y: 2, w: 4, h: 3, kind: 'inside the wardrobe' },
    { x: 2, y: 30, w: 4, h: 4, kind: 'under the kitchen table' },
  ],

  patrols: [
    { name: 'Grandpa (if woken)', loop: [[5, 10], [14, 9], [20, 12], [20, 24], [8, 24], [20, 24], [20, 6], [5, 10]] },
    { name: 'The dog', loop: [[30, 31], [20, 30], [20, 20], [8, 26], [20, 30], [30, 31]] },
  ],

  props: [
    /* ---------------- Parlour (HIM) ---------------- */
    p('chandelier', 8.4, 8.4, { w: 2.4, h: 2.4 }),
    p('fireplace', 2.15, 9.4, { w: 1.3, h: 2.6 }),
    p('rug', 4.4, 6.4, { w: 8, h: 6.4, c: 'red' }),
    p('armchair', 4.2, 8.4, { w: 2.6, h: 2.6, d: 'w' }),
    p('sleeper', 4.6, 9.4, { w: 1.8, h: 1.8, label: 'Grandpa' }),
    p('armchair', 4.2, 5.2, { w: 2.4, h: 2.4, d: 'w' }),
    p('sofa', 7.4, 12.4, { w: 4.6, h: 2, d: 'n' }),
    p('coffee-table', 7.8, 9.4, { w: 2.6, h: 1.6 }),
    p('mug', 8.4, 9.8), p('papers', 9.4, 9.6),
    p('lamp-floor', 3, 12.6), p('lamp-table', 7.4, 7.4),
    p('table', 6.6, 6.9, { w: 1.6, h: 1.2 }),
    p('grandfather-clock', 14.5, 2.3, { w: 1.3, h: 2.6 }),
    p('piano', 11.4, 4.4, { w: 3.6, h: 2.4 }),
    p('stool', 12.8, 7.1, { w: 1.1, h: 1.1 }),
    p('bookcase', 14.6, 8.4, { w: 1.2, h: 4, d: 'v' }),
    p('cabinet', 11.4, 14.4, { w: 2.4, h: 1.3 }),
    p('vase', 12.2, 14.6, { c: 'clay' }),
    p('painting', 8.4, 2.06, { w: 2.4, h: .85, c: 'gold' }),
    p('painting', 12.4, 2.06, { w: 1.8, h: .85, c: 'plain' }),
    p('candle', 4.2, 8.3), p('candle', 4.2, 12.3),
    p('plant-big', 14.4, 15.2), p('cat', 6.4, 11.4),
    p('clock', 14.6, 6.4),
    ...curtainsV(2.05, 4, 4, { c: 'red' }), ...curtainsV(2.05, 13, 3, { c: 'red' }),
    ...curtainsH(4, 2.05, 4, { c: 'red' }), ...curtainsH(11, 2.05, 4, { c: 'red' }),

    /* ---------------- Kitchen ---------------- */
    p('lamp-ceiling', 8, 19.6, { w: 1.8, h: .8 }), p('lamp-ceiling', 8, 30, { w: 1.8, h: .8 }),
    p('stove-wood', 2.2, 18.3, { w: 2.6, h: 2 }),
    p('counter', 5.4, 18.15, { w: 6.4, h: 1.5 }),
    p('sink', 6, 18.3, { w: 1.8, h: 1.2 }),
    p('kettle', 8.4, 18.5), p('jars', 9.6, 18.5, { w: 2, h: .8 }),
    p('dresser', 12.4, 18.15, { w: 3.2, h: 1.4 }),
    p('jars', 12.6, 18.3, { w: 2.6, h: .9 }),
    p('shelf', 14.5, 20.4, { w: 1.2, h: 3.4, d: 'v' }),
    p('table', 5.4, 23.4, { w: 5, h: 3 }),
    p('chair', 6, 22.2, { d: 's' }), p('chair', 8.4, 22.2, { d: 's' }),
    p('chair', 6, 26.6, { d: 'n' }), p('chair', 8.4, 26.6, { d: 'n' }),
    p('chair', 4.2, 24.4, { d: 'e' }), p('chair', 10.6, 24.4, { d: 'w' }),
    p('vase', 7.4, 24.4, { c: 'jade' }),
    p('rug', 4.4, 22.4, { w: 7, h: 5, c: 'warm' }),
    p('cabinet', 2.15, 22.4, { w: 1.3, h: 2.6 }),
    p('fridge', 12.4, 21.4, { w: 1.6, h: 2.2 }),
    p('stairs', 12.4, 25.4, { w: 2.6, h: 4.4, d: 'v' }),
    p('bench', 2.4, 28.4, { w: 1.2, h: 3.4, d: 'v' }),
    p('bucket', 2.4, 32.4), p('broom', 3.8, 31.6),
    p('mug', 4.4, 32.6), p('trash', 10.4, 32.4),
    p('cat', 9.4, 29.4), p('plant', 14.4, 32.4),
    p('doormat', 11.4, 32.6, { w: 1.8, h: 1 }),
    ...curtainsV(2.05, 20, 4, { c: 'green' }), ...curtainsV(2.05, 28, 4, { c: 'green' }),
    ...curtainsH(4, 33.4, 4, { c: 'green' }), ...curtainsH(11, 33.4, 4, { c: 'green' }),

    /* ---------------- Hall ---------------- */
    p('chandelier', 20, 8.4, { w: 1.8, h: 1.8 }),
    p('lamp-ceiling', 20, 20, { w: 1.6, h: .7 }), p('lamp-ceiling', 20, 29, { w: 1.6, h: .7 }),
    p('rug', 18.6, 3.4, { w: 3.8, h: 12, c: 'red' }),
    p('rug', 18.6, 20.4, { w: 3.8, h: 12, c: 'red' }),
    p('cabinet', 17.15, 3.4, { w: 1.1, h: 2.6 }),
    p('vase', 17.3, 3.8, { c: 'clay' }),
    p('mirror', 23.55, 4.4, { w: .45, h: 2.4 }),
    p('coat-rack', 17.4, 15.4), p('coat-rack', 22.4, 32.2),
    p('grandfather-clock', 22.6, 17.4, { w: 1.3, h: 2.6 }),
    p('painting', 17.15, 9.4, { w: .65, h: 2, c: 'gold' }),
    p('painting', 23.4, 22.4, { w: .6, h: 1.8, c: 'plain' }),
    p('sconce', 17.2, 12.4, { w: .7, h: .55 }), p('sconce', 23.3, 26.4, { w: .7, h: .55 }),
    p('table', 21.6, 12.4, { w: 1.8, h: 1.2 }),
    p('lamp-table', 22.1, 12.6),
    p('plant-big', 17.4, 27.4), p('plant', 22.6, 8.4),
    p('doormat', 18.9, 32.6, { w: 2.4, h: 1.1 }),
    p('doormat', 18.9, 2.1, { w: 2.4, h: 1 }),
    p('bench', 17.4, 19.4, { w: 1.2, h: 3, d: 'v' }),
    p('umbrella', 22.4, 2.4),

    /* ---------------- Their Bedroom ---------------- */
    p('lamp-ceiling', 32, 3.4, { w: 1.8, h: .8 }),
    ...bedSet(30.4, 3.4, 4.4, 5.4),
    p('wardrobe', 25.15, 3.4, { w: 1.5, h: 4.4 }),
    p('wardrobe', 39.4, 3.4, { w: 1.5, h: 4 }),
    p('dresser', 27.4, 14.4, { w: 3.2, h: 1.4 }),
    p('mirror', 28.4, 13.3, { w: 2.2, h: .5 }),
    p('sewing', 34.4, 11.4, { w: 2, h: 1.3 }),
    p('stool', 35, 13.2, { w: 1.1, h: 1.1 }),
    p('armchair', 38.4, 10.4, { w: 2.2, h: 2.2, d: 'w' }),
    p('lamp-floor', 38.6, 8.6),
    p('rug', 28.4, 10.4, { w: 5.4, h: 3.4, c: 'blue' }),
    p('grandfather-clock', 25.2, 8.6, { w: 1.2, h: 2.4 }),
    p('plant', 39.6, 14.4), p('candle', 27.4, 9.4),
    p('painting', 27.4, 2.06, { w: 2, h: .85, c: 'plain' }),
    ...curtainsV(39.9, 4, 4, { c: 'cream' }), ...curtainsV(39.9, 10, 4, { c: 'cream' }),
    ...curtainsH(27, 2.05, 4, { c: 'cream' }), ...curtainsH(35, 2.05, 4, { c: 'cream' }),

    /* ---------------- Pantry ---------------- */
    p('lamp-ceiling', 28, 18.4, { w: 1.4, h: .6 }),
    p('shelf', 25.15, 18.15, { w: 6.4, h: 1.2 }),
    p('jars', 25.4, 18.3, { w: 3.4, h: .9 }),
    p('shelf', 25.15, 20.4, { w: 1.2, h: 4, d: 'v' }),
    p('shelf', 30.6, 20.4, { w: 1.2, h: 4, d: 'v' }),
    p('shelf', 26.6, 22.4, { w: 3.8, h: 1.1 }),
    p('box', 27.2, 22.5, { w: 1.4, h: .9, label: 'BISCUIT TIN' }),
    p('keys', 27.6, 22.6),
    p('crate', 26.4, 24.2, { w: 1.6, h: 1.4 }),
    p('jars', 28.6, 24.4, { w: 2, h: .8 }),

    /* ---------------- Bathroom ---------------- */
    p('lamp-ceiling', 36, 18.4, { w: 1.4, h: .6 }),
    p('bathtub', 33.2, 18.3, { w: 4.4, h: 2.2, d: 'h' }),
    p('toilet', 39.4, 18.4, { w: 1.3, h: 1.8 }),
    p('basin', 33.2, 22.4, { w: 1.8, h: 1.2 }),
    p('mirror', 33.2, 21.4, { w: 1.8, h: .45 }),
    p('radiator', 36.4, 24.4, { w: 2.4, h: .5 }),
    p('mat', 35.4, 22.4, { w: 2, h: 1.2 }),
    p('bucket', 39.6, 23.4), p('candle', 38.4, 22.4),

    /* ---------------- Conservatory ---------------- */
    p('lamp-ceiling', 32, 27.6, { w: 1.8, h: .8 }),
    p('plant-big', 25.4, 27.4), p('plant-big', 28.4, 27.4),
    p('plant-big', 39.2, 27.4), p('plant-big', 39.2, 32.2),
    p('plant-big', 25.4, 32.2), p('plant', 31.4, 27.6), p('plant', 35.4, 32.6),
    p('tree', 37.2, 29.4, { w: 2.2, h: 2.2 }),
    p('table-round', 30.4, 29.9, { w: 2.8, h: 2.8 }),
    p('chair', 30, 28.8, { d: 's' }), p('chair', 32.6, 31, { d: 'w' }),
    p('chair', 29.2, 31, { d: 'e' }),
    p('bench', 33.4, 27.4, { w: 3.4, h: 1.2, d: 'h' }),
    p('rug', 27.4, 30.4, { w: 1.8, h: 2.6, c: 'green' }),
    p('bucket', 34.4, 29.4), p('cat', 33.4, 31.4),
    p('lamp-floor', 28.4, 30.4),
    p('mug', 31.4, 30.9),
  ],
};
