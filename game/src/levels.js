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
  },
  D: {
    bed: [24, 20, 110, 80],
    furniture: [
      [170, 34, 100, 52], [300, 140, 70, 120], [40, 180, 110, 44],
      [150, 300, 120, 44], [40, 420, 90, 50], [250, 430, 120, 46]
    ]
  },
  E: {
    bed: [140, 18, 120, 90],
    furniture: [
      [30, 150, 90, 46], [290, 150, 80, 46], [36, 270, 70, 110],
      [160, 300, 110, 42], [250, 420, 120, 44], [40, 430, 90, 44]
    ]
  },
  // --- multi-area layouts, for the sophisticated end of the campaign -------
  // Two rooms and two ways between them: the short hop on the right, or the
  // long way round on the left past less furniture.
  G: {
    bed: [148, 24, 110, 82],
    partitions: [
      [14, 258, 52, 14], [116, 258, 146, 14], [312, 258, 74, 14]
    ],
    furniture: [
      [30, 130, 84, 46], [292, 132, 80, 48],
      [36, 300, 120, 42], [246, 300, 120, 44],
      [36, 420, 62, 120], [150, 430, 150, 42], [316, 430, 60, 60]
    ]
  },
  // A bedroom and a study upstairs of a shared lounge, joined by one doorway:
  // the valuable things are furthest from the way out.
  H: {
    bed: [26, 30, 104, 78],
    partitions: [
      [190, 14, 14, 168],
      [14, 316, 116, 14], [196, 316, 190, 14]
    ],
    furniture: [
      [30, 150, 96, 44],
      [216, 40, 90, 50], [306, 56, 70, 88], [212, 186, 84, 44],
      [40, 360, 130, 44], [250, 356, 120, 44],
      [36, 456, 90, 46], [230, 470, 140, 44]
    ]
  },
  // A central corridor with a room off each side, opening into a hall. The bed
  // sits at the head of the corridor, so both side rooms cost a walk past him.
  I: {
    bed: [150, 22, 100, 74],
    partitions: [
      [122, 14, 14, 70], [122, 140, 14, 128],
      [264, 14, 14, 110], [264, 180, 14, 88]
    ],
    furniture: [
      [140, 150, 70, 42],
      [30, 40, 78, 46], [28, 170, 80, 44],
      [286, 40, 88, 48], [290, 200, 80, 50],
      [40, 320, 120, 44], [246, 316, 124, 44],
      [36, 430, 64, 120], [140, 450, 160, 42], [320, 440, 58, 58]
    ]
  },
  F: {
    bed: [230, 20, 140, 96],
    furniture: [
      [30, 40, 120, 60], [170, 160, 90, 44], [300, 200, 70, 120],
      [40, 200, 90, 50], [120, 320, 150, 44], [40, 420, 100, 50],
      [250, 440, 120, 46]
    ]
  }
};

// One rug per layout, positioned to offer a genuine alternative route rather
// than sitting decoratively out of the way.
const RUGS = {
  A: { x: 96, y: 372, w: 190, h: 118 },
  B: { x: 60, y: 92, w: 120, h: 96 },
  C: { x: 96, y: 356, w: 190, h: 64 },
  D: { x: 150, y: 120, w: 150, h: 130 },
  E: { x: 130, y: 180, w: 140, h: 100 },
  F: { x: 120, y: 200, w: 150, h: 100 },
  G: { x: 150, y: 300, w: 160, h: 100 },
  H: { x: 210, y: 100, w: 150, h: 90 },
  I: { x: 140, y: 300, w: 150, h: 110 }
};

function makeLevel(id, layoutKey, spawn, exitX, items, options = {}) {
  const layout = LAYOUTS[layoutKey];
  const bed = collider('bed', ...layout.bed);
  const colliders = [
    ...boundary(exitX),
    // Interior walls. These are what turn one rectangle into connected areas,
    // and they are structural rather than furniture: like the outer walls they
    // are part of the building, so brushing one costs no noise.
    ...(layout.partitions || []).map((w) => collider('partition', ...w)),
    bed,
    ...layout.furniture.map((f) => collider('furniture', ...f))
  ];

  return {
    id,
    layout: layoutKey,
    // Theme drives palette and furniture flavour only — never the rules.
    theme: options.theme || 'bedroom',
    name: options.name || 'Bedroom',
    // Bigger, partitioned rooms take longer to cross, so they carry their own
    // allowance on top of the campaign's shrinking clock. Without it the
    // sophisticated levels would land on the time floor and be unwinnable.
    extraTime: options.extraTime || 0,
    // Creaky boards: plain trigger rectangles on the floor.
    creaks: (options.creaks || []).map(([x, y, w, h], i) => ({ id: `L${id}-c${i}`, x, y, w, h })),
    // Rugs. These are gameplay, not decoration: footsteps are silent on them,
    // which is what makes a longer route worth considering. The renderer draws
    // them from this same data, so what looks soft is soft.
    rugs: RUGS[layoutKey] ? [RUGS[layoutKey]] : [],
    spawn: { x: spawn[0], y: spawn[1] },
    exit: { x: exitX, y: H - WT - 10, w: EXIT_W, h: WT + 18 },
    bed,
    // Where his head sits on the pillow — the renderer draws the face here.
    sleeper: { x: bed.x + bed.w / 2, y: bed.y + bed.h * 0.26 },
    colliders,
    items: items.map((it, i) => ({
      id: `L${id}-${i}`,
      type: it[2],
      x: it[0],
      y: it[1],
      // A marked prize: the same item, drawn so you cannot miss it.
      bonus: it[3] === 'bonus'
    }))
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
  ]),

  // ---- Apartment: smaller pickings, tighter room ------------------------
  makeLevel(11, 'D', [200, 548], 160, [
    [150, 130, 'coin'], [250, 130, 'wallet'], [60, 260, 'phone'],
    [200, 240, 'headphones'], [330, 300, 'watch'], [100, 360, 'wallet'],
    [230, 370, 'coin']
  ], { theme: 'apartment', name: 'Apartment' }),
  makeLevel(12, 'D', [200, 548], 160, [
    [150, 130, 'wallet'], [250, 130, 'headphones'], [60, 260, 'ring'],
    [200, 240, 'camera'], [330, 300, 'phone'], [100, 360, 'necklace'],
    [230, 370, 'tablet'], [170, 470, 'console']
  ], { theme: 'apartment', name: 'Apartment' }),

  // ---- Hotel room: creaky old floorboards -------------------------------
  makeLevel(13, 'E', [200, 548], 160, [
    [70, 120, 'wallet'], [200, 140, 'camera'], [330, 110, 'ring'],
    [140, 220, 'headphones'], [250, 240, 'watch'], [330, 260, 'phone'],
    [120, 370, 'tablet'], [280, 350, 'wallet']
  ], { theme: 'hotel', name: 'Hotel Room', creaks: [[150, 190, 90, 40]] }),
  makeLevel(14, 'E', [200, 548], 160, [
    [70, 120, 'ring'], [200, 140, 'tablet'], [330, 110, 'camera'],
    [140, 220, 'necklace'], [250, 240, 'headphones'], [330, 260, 'watch'],
    [120, 370, 'console'], [280, 350, 'ring'], [170, 470, 'wallet']
  ], { theme: 'hotel', name: 'Hotel Room', creaks: [[150, 190, 90, 40], [60, 350, 60, 50]] }),
  makeLevel(15, 'E', [200, 548], 160, [
    [70, 120, 'vase'], [200, 140, 'console'], [330, 110, 'necklace', 'bonus'],
    [140, 220, 'tablet'], [250, 240, 'camera'], [330, 260, 'ring'],
    [120, 370, 'speaker'], [280, 350, 'headphones'], [330, 515, 'coin']
  ], { theme: 'hotel', name: 'Hotel Room', creaks: [[150, 190, 90, 40], [230, 470, 80, 44]] }),

  // ---- Office: electronics, hard floors ---------------------------------
  makeLevel(16, 'D', [200, 548], 160, [
    [150, 130, 'tablet'], [250, 130, 'laptop'], [60, 260, 'console'],
    [200, 240, 'speaker'], [330, 300, 'camera'], [100, 360, 'tablet'],
    [230, 370, 'headphones'], [330, 515, 'phone']
  ], { theme: 'office', name: 'Office', creaks: [[170, 210, 90, 44]] }),
  makeLevel(17, 'D', [200, 548], 160, [
    [150, 130, 'laptop'], [250, 130, 'console'], [60, 260, 'speaker'],
    [200, 240, 'tv'], [330, 300, 'tablet'], [100, 360, 'laptop'],
    [230, 370, 'camera'], [330, 515, 'wallet'], [60, 520, 'coin']
  ], { theme: 'office', name: 'Office', creaks: [[170, 210, 90, 44], [60, 440, 70, 44]] }),
  makeLevel(18, 'D', [200, 548], 160, [
    [150, 130, 'tv', 'bonus'], [250, 130, 'speaker'], [60, 260, 'laptop'],
    [200, 240, 'console'], [330, 300, 'mirror'], [100, 360, 'tv'],
    [230, 370, 'tablet'], [330, 515, 'camera']
  ], { theme: 'office', name: 'Office', creaks: [[170, 210, 90, 44], [230, 300, 90, 44]] }),

  // ---- Luxury bedroom: fragile, expensive things ------------------------
  makeLevel(19, 'F', [200, 548], 160, [
    [180, 90, 'vase'], [120, 130, 'necklace'], [60, 300, 'painting'],
    [250, 290, 'ring'], [330, 350, 'jewel'], [60, 370, 'mirror'],
    [180, 400, 'necklace'], [150, 500, 'watch']
  ], { theme: 'luxury', name: 'Luxury Bedroom', creaks: [[140, 240, 100, 44]] }),
  makeLevel(20, 'F', [200, 548], 160, [
    [180, 90, 'painting'], [120, 130, 'jewel'], [60, 300, 'vase'],
    [250, 290, 'necklace'], [330, 350, 'mirror'], [60, 370, 'diamond'],
    [180, 400, 'ring'], [150, 500, 'necklace'], [330, 520, 'coin']
  ], { theme: 'luxury', name: 'Luxury Bedroom', creaks: [[140, 240, 100, 44]] }),
  makeLevel(21, 'F', [200, 548], 160, [
    [180, 90, 'diamond', 'bonus'], [120, 130, 'painting'], [60, 300, 'necklace'],
    [250, 290, 'vase'], [330, 350, 'jewel'], [60, 370, 'mirror'],
    [180, 400, 'painting'], [150, 500, 'ring']
  ], { theme: 'luxury', name: 'Luxury Bedroom', creaks: [[140, 240, 100, 44], [230, 380, 90, 44]] }),

  // ---- Penthouse: the biggest hauls, the worst decisions ----------------
  makeLevel(22, 'F', [200, 548], 160, [
    [180, 90, 'goldbar'], [120, 130, 'diamond'], [250, 290, 'necklace'],
    [60, 370, 'jewel'], [180, 400, 'ring'], [150, 500, 'vase']
  ], { theme: 'penthouse', name: "Penthouse", creaks: [[140, 240, 100, 44]] }),
  makeLevel(23, 'C', [200, 548], 160, [
    [196, 70, 'goldbar', 'bonus'], [70, 150, 'diamond'], [330, 150, 'painting'],
    [160, 238, 'necklace'], [186, 352, 'diamond'], [330, 400, 'goldbar'],
    [60, 470, 'painting'], [330, 520, 'jewel']
  ], { theme: 'penthouse', name: 'Penthouse', creaks: [[100, 210, 110, 44]] }),
  makeLevel(24, 'F', [200, 548], 160, [
    [180, 90, 'goldbar'], [120, 130, 'goldbar'], [60, 300, 'diamond'],
    [250, 290, 'painting'], [330, 350, 'goldbar'], [60, 370, 'diamond'],
    [180, 400, 'necklace'], [150, 500, 'painting'], [330, 520, 'vase']
  ], { theme: 'penthouse', name: 'Penthouse', creaks: [[140, 240, 100, 44], [230, 460, 90, 44]] }),

  // ---- Large house: two rooms, two doorways, two routes ------------------
  makeLevel(25, 'G', [200, 548], 160, [
    [200, 150, 'camera'], [70, 60, 'wallet'], [330, 60, 'ring'],
    [200, 220, 'tablet'], [90, 350, 'laptop'], [200, 360, 'console'],
    [330, 380, 'headphones'], [120, 560, 'coin']
  ], { theme: 'house', name: 'Large House', extraTime: 8, creaks: [[66, 262, 50, 44]] }),
  makeLevel(26, 'G', [200, 548], 160, [
    [200, 150, 'necklace'], [70, 60, 'ring'], [330, 60, 'camera'],
    [200, 220, 'speaker'], [90, 350, 'console'], [200, 360, 'mirror'],
    [330, 380, 'tablet'], [120, 560, 'wallet'], [286, 520, 'coin']
  ], { theme: 'house', name: 'Large House', extraTime: 8, creaks: [[66, 262, 50, 44], [262, 262, 50, 44]] }),

  // ---- The study is furthest from the door, and worth the most -----------
  makeLevel(27, 'H', [200, 548], 160, [
    [160, 60, 'jewel'], [70, 250, 'cash'], [160, 240, 'laptop'],
    [350, 250, 'painting'], [250, 130, 'console'], [200, 400, 'watch'],
    [200, 540, 'coin'], [350, 430, 'camera']
  ], { theme: 'house', name: 'Large House', extraTime: 9, creaks: [[130, 320, 66, 44]] }),
  makeLevel(28, 'H', [200, 548], 160, [
    [160, 60, 'diamond'], [70, 250, 'necklace'], [160, 240, 'vase'],
    [350, 250, 'painting'], [250, 130, 'mirror'], [200, 400, 'console'],
    [200, 540, 'wallet'], [350, 430, 'speaker']
  ], { theme: 'house', name: 'Large House', extraTime: 9, creaks: [[130, 320, 66, 44], [40, 400, 60, 44]] }),

  // ---- Mansion: side rooms cost a walk past the bed ----------------------
  makeLevel(29, 'I', [200, 548], 160, [
    [200, 110, 'painting'], [66, 110, 'jewel'], [66, 250, 'necklace'],
    [330, 130, 'diamond'], [330, 280, 'mirror'], [200, 250, 'ring'],
    [200, 390, 'camera'], [60, 560, 'coin']
  ], { theme: 'mansion', name: 'Mansion', extraTime: 11, creaks: [[136, 200, 60, 50]] }),
  makeLevel(30, 'I', [200, 548], 160, [
    [200, 110, 'goldbar'], [66, 110, 'painting'], [66, 250, 'diamond'],
    [330, 130, 'goldbar'], [330, 280, 'necklace'], [200, 250, 'vase'],
    [200, 390, 'mirror'], [60, 560, 'wallet']
  ], { theme: 'mansion', name: 'Mansion', extraTime: 11, creaks: [[136, 200, 60, 50], [190, 290, 80, 40]] }),
  makeLevel(31, 'I', [200, 548], 160, [
    [200, 110, 'goldbar', 'bonus'], [66, 110, 'diamond'], [66, 250, 'painting'],
    [330, 130, 'diamond'], [330, 280, 'goldbar'], [200, 250, 'necklace'],
    [200, 390, 'jewel'], [60, 560, 'ring'], [286, 520, 'coin']
  ], { theme: 'mansion', name: 'Mansion', extraTime: 11, creaks: [[136, 200, 60, 50], [190, 290, 80, 40]] }),
  makeLevel(32, 'I', [200, 548], 160, [
    [200, 110, 'goldbar', 'bonus'], [66, 110, 'goldbar'], [66, 250, 'diamond'],
    [330, 130, 'goldbar'], [330, 280, 'diamond'], [200, 250, 'painting'],
    [200, 390, 'necklace'], [60, 560, 'vase'], [286, 520, 'ring']
  ], { theme: 'mansion', name: 'Mansion', extraTime: 11, creaks: [[136, 200, 60, 50], [190, 290, 80, 40]] })
];

export const collidersOfType = (level, type) =>
  level.colliders.filter((c) => c.type === type);
