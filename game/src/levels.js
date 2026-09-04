// Level data in a tagged schema. Nothing is identified by array index any more:
// every collider says what it is, so adding a second bed, a door or a rug can
// never silently shift what the renderer thinks it is looking at.
import { TUNING } from './tuning.js';

const { width: W, height: H, wallThickness: WT, exitWidth: EXIT_W } = TUNING.world;

const collider = (type, x, y, w, h) => ({ type, x, y, w, h });

// The four room edges, with a gap left for the doorway.
function boundary(exitX) {
  return [
    collider('wall', 0, 0, W, WT),
    collider('wall', 0, 0, WT, H),
    collider('wall', W - WT, 0, WT, H),
    collider('wall', 0, H - WT, exitX, WT),
    collider('wall', exitX + EXIT_W, H - WT, W - exitX - EXIT_W, WT)
  ];
}

// Three room templates. Levels vary items, not architecture.
const LAYOUTS = {
  A: {
    bed: [145, 20, 110, 86],
    furniture: [
      [30, 180, 80, 46], [298, 190, 74, 50], [152, 306, 96, 44],
      [34, 424, 64, 62], [286, 404, 86, 46]
    ]
  },
  B: {
    bed: [24, 20, 104, 84],
    furniture: [
      [210, 54, 64, 52], [300, 158, 72, 46], [36, 224, 116, 42],
      [186, 300, 44, 116], [276, 430, 96, 44], [36, 452, 80, 42]
    ]
  },
  C: {
    bed: [262, 20, 110, 86],
    furniture: [
      [30, 44, 92, 54], [154, 152, 110, 42], [36, 262, 60, 124],
      [248, 306, 124, 42], [120, 436, 142, 42]
    ]
  }
};

function makeLevel(id, layoutKey, spawn, exitX, items) {
  const layout = LAYOUTS[layoutKey];
  const bed = collider('bed', ...layout.bed);
  const colliders = [
    ...boundary(exitX),
    bed,
    ...layout.furniture.map((f) => collider('furniture', ...f))
  ];

  return {
    id,
    layout: layoutKey,
    spawn: { x: spawn[0], y: spawn[1] },
    exit: { x: exitX, y: H - WT - 10, w: EXIT_W, h: WT + 18 },
    bed,
    // Where his head sits on the pillow — the renderer draws the face here.
    sleeper: { x: bed.x + bed.w / 2, y: bed.y + bed.h * 0.26 },
    colliders,
    items: items.map((it, i) => ({ id: `L${id}-${i}`, type: it[2], x: it[0], y: it[1] }))
  };
}

export const LEVELS = [
  makeLevel(1, 'A', [200, 540], 160, [
    [80, 130, 'phone'], [320, 130, 'phone'], [200, 250, 'watch'],
    [70, 330, 'phone'], [300, 330, 'watch']
  ]),
  makeLevel(2, 'A', [200, 540], 160, [
    [70, 140, 'watch'], [330, 140, 'phone'], [200, 250, 'cash'],
    [70, 352, 'phone'], [330, 340, 'watch'], [200, 470, 'cash']
  ]),
  makeLevel(3, 'B', [200, 548], 160, [
    [170, 140, 'cash'], [330, 96, 'jewel'], [60, 160, 'jewel'],
    [250, 238, 'laptop'], [120, 352, 'laptop'], [330, 352, 'jewel']
  ]),
  makeLevel(4, 'B', [200, 548], 160, [
    [172, 140, 'laptop'], [330, 96, 'cash'], [60, 162, 'watch'],
    [252, 236, 'jewel'], [112, 352, 'jewel'], [330, 352, 'laptop'],
    [66, 388, 'jewel']
  ]),
  makeLevel(5, 'C', [200, 548], 160, [
    [196, 70, 'cash'], [70, 150, 'laptop'], [330, 150, 'watch'],
    [160, 238, 'jewel'], [180, 352, 'cash'], [330, 400, 'jewel'],
    [60, 470, 'laptop']
  ]),
  makeLevel(6, 'A', [200, 540], 160, [
    [70, 120, 'jewel'], [330, 120, 'cash'], [200, 150, 'watch'],
    [200, 250, 'laptop'], [70, 352, 'cash'], [330, 340, 'jewel'],
    [200, 470, 'tv'], [340, 490, 'phone']
  ]),
  makeLevel(7, 'B', [200, 548], 160, [
    [172, 140, 'tv'], [330, 96, 'jewel'], [60, 162, 'cash'],
    [252, 236, 'laptop'], [112, 352, 'watch'], [330, 352, 'jewel'],
    [66, 392, 'cash'], [196, 496, 'laptop']
  ]),
  makeLevel(8, 'C', [200, 548], 160, [
    [196, 70, 'jewel'], [70, 150, 'tv'], [330, 150, 'cash'],
    [160, 238, 'laptop'], [186, 352, 'jewel'], [330, 400, 'laptop'],
    [60, 470, 'jewel'], [330, 520, 'jewel']
  ]),
  makeLevel(9, 'A', [200, 540], 160, [
    [70, 120, 'tv'], [330, 120, 'jewel'], [200, 150, 'cash'],
    [200, 250, 'laptop'], [70, 352, 'jewel'], [330, 340, 'laptop'],
    [200, 470, 'tv'], [340, 496, 'cash']
  ]),
  makeLevel(10, 'C', [200, 548], 160, [
    [196, 70, 'tv'], [70, 150, 'jewel'], [330, 150, 'laptop'],
    [160, 238, 'tv'], [186, 352, 'laptop'], [330, 400, 'jewel'],
    [60, 470, 'tv'], [330, 520, 'cash']
  ])
];

export const collidersOfType = (level, type) =>
  level.colliders.filter((c) => c.type === type);
