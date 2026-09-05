// Level data in a tagged schema. Nothing is identified by array index any more:
// every collider says what it is, so adding a second bed, a door or a rug can
// never silently shift what the renderer thinks it is looking at.
import { TUNING } from './tuning.js';

const { width: W, height: H, wallThickness: WT, exitWidth: EXIT_W } = TUNING.world;

const collider = (type, x, y, w, h) => ({ type, x, y, w, h });

// The way out. A number is a doorway in the bottom wall (every level built so
// far); {side:'left', at} puts it in a side wall instead, which is where the
// corridor floorplans put theirs.
function resolveExit(spec) {
  if (typeof spec === 'number') {
    return { side: 'bottom', x: spec, y: H - WT - 10, w: EXIT_W, h: WT + 18 };
  }
  const at = spec.at;
  if (spec.side === 'left') return { side: 'left', x: 0, y: at, w: WT + 18, h: EXIT_W };
  return { side: 'right', x: W - WT - 18, y: at, w: WT + 18, h: EXIT_W };
}

// The four room edges, with a gap left for the way out.
function boundary(exit) {
  const walls = [];
  if (exit.side === 'bottom') {
    walls.push(collider('wall', 0, 0, W, WT), collider('wall', 0, 0, WT, H),
      collider('wall', W - WT, 0, WT, H),
      collider('wall', 0, H - WT, exit.x, WT),
      collider('wall', exit.x + EXIT_W, H - WT, W - exit.x - EXIT_W, WT));
  } else {
    const gapX = exit.side === 'left' ? 0 : W - WT;
    const other = exit.side === 'left' ? W - WT : 0;
    walls.push(collider('wall', 0, 0, W, WT), collider('wall', 0, H - WT, W, WT),
      collider('wall', other, 0, WT, H),
      collider('wall', gapX, 0, WT, exit.y),
      collider('wall', gapX, exit.y + EXIT_W, WT, H - exit.y - EXIT_W));
  }
  return walls;
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
    doors: [[66, 258, 50, 14], [262, 258, 50, 14]],
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
    doors: [[130, 316, 66, 14]],
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
    doors: [[122, 84, 14, 56], [264, 124, 14, 56]],
    furniture: [
      [140, 150, 70, 42],
      [30, 40, 78, 46], [28, 170, 80, 44],
      [286, 40, 88, 48], [290, 200, 80, 50],
      [40, 320, 120, 44], [246, 316, 124, 44],
      [36, 430, 64, 120], [140, 450, 160, 42], [320, 440, 58, 58]
    ]
  },
  // A private gallery: a symmetric grid of display plinths in the hall, a
  // bedroom nook off to one side, and a lobby below the dividing wall. Taken
  // from the museum reference — the value is out in the open on the plinths,
  // which means crossing the hall rather than hugging the edges.
  J: {
    bed: [28, 26, 100, 76],
    partitions: [
      [132, 14, 14, 150],
      [14, 270, 156, 14], [230, 270, 156, 14]
    ],
    doors: [[170, 270, 60, 14], [132, 164, 14, 106]],
    furniture: [
      [30, 140, 92, 44],
      [176, 60, 40, 40], [252, 60, 40, 40], [328, 60, 40, 40],
      [176, 150, 40, 40], [252, 150, 40, 40], [328, 150, 40, 40],
      [30, 320, 44, 120], [110, 330, 150, 40], [300, 330, 72, 44],
      [40, 470, 120, 42], [250, 470, 130, 42]
    ]
  },
  // Two rooms off a shared hall, each with its own door — the floorplan
  // reference's arrangement of rooms hanging off a circulation spine.
  K: {
    bed: [30, 30, 110, 80],
    partitions: [
      [186, 14, 14, 240],
      [14, 254, 60, 14], [128, 254, 58, 14],
      [200, 254, 60, 14], [314, 254, 72, 14]
    ],
    doors: [[74, 254, 54, 14], [260, 254, 54, 14]],
    furniture: [
      [30, 150, 90, 44],
      [216, 40, 90, 48], [306, 150, 70, 88], [204, 170, 64, 44],
      [36, 320, 120, 42], [250, 316, 120, 44],
      [36, 430, 64, 120], [150, 450, 150, 42], [316, 440, 60, 60]
    ]
  },
  // A long apartment: a closed service spine of storage down one side, an open
  // living run down the other, and the bedroom tucked behind a return wall at
  // the far end — the apartment reference's shape.
  L: {
    bed: [268, 26, 104, 78],
    partitions: [
      [120, 14, 14, 66], [120, 134, 14, 90], [14, 224, 120, 14],
      [240, 14, 14, 140]
    ],
    doors: [[120, 80, 14, 54], [240, 154, 14, 100]],
    furniture: [
      [30, 40, 56, 46], [30, 140, 56, 50],
      [268, 120, 90, 44],
      [150, 180, 80, 44],
      [40, 260, 120, 42], [250, 260, 120, 44],
      [36, 380, 64, 120], [150, 400, 150, 42], [300, 400, 76, 60],
      [40, 520, 90, 44]
    ]
  },
  // A museum after the great-hall reference: display cases and plinths in an
  // open hall upstairs, ticket hall and security wing below. The guard sits in
  // the security wing, which is the half of the building you would rather not
  // cross — and the way out is on the other side.
  M: {
    bed: [250, 470, 110, 70],
    partitions: [
      [14, 270, 96, 14], [176, 270, 40, 14], [282, 270, 104, 14]
    ],
    doors: [[110, 270, 66, 14], [216, 270, 66, 14]],
    furniture: [
      [30, 34, 70, 44], [160, 30, 80, 40], [300, 34, 70, 44],
      [30, 150, 44, 44], [110, 120, 44, 44], [190, 120, 44, 44],
      [270, 120, 44, 44], [340, 150, 44, 44],
      [30, 320, 130, 40], [30, 430, 120, 40],
      [230, 320, 130, 42], [300, 560, 70, 40]
    ]
  },
  // A hotel floor after the corridor reference: suites hanging off a spine,
  // and the way out at the end of the corridor rather than through a wall.
  N: {
    bed: [150, 36, 68, 74],
    partitions: [
      [130, 14, 14, 236], [256, 14, 14, 236],
      [14, 236, 40, 14], [100, 236, 30, 14],
      [144, 236, 30, 14], [216, 236, 40, 14],
      [270, 236, 30, 14], [346, 236, 40, 14],
      [130, 344, 14, 262], [256, 344, 14, 262],
      [14, 330, 40, 14], [100, 330, 30, 14],
      [270, 330, 30, 14], [346, 330, 40, 14]
    ],
    doors: [
      [54, 236, 46, 14], [174, 236, 42, 14], [300, 236, 46, 14],
      [54, 330, 46, 14], [300, 330, 46, 14]
    ],
    // Each suite is only ~116 wide, so its furniture sits against one wall and
    // leaves a channel to walk down. At 84 wide it left 16px and sealed the
    // room — the validator caught every one of them.
    furniture: [
      [30, 40, 64, 70], [30, 150, 64, 50],
      [150, 150, 68, 50],
      [286, 40, 64, 70], [286, 150, 64, 50],
      [30, 380, 64, 70], [30, 500, 64, 50],
      [286, 380, 64, 70], [286, 500, 64, 50],
      [156, 400, 64, 60]
    ]
  },
  // A school after hours, from the classroom-floor reference: two classrooms and
  // a library along the top, a locker-lined corridor across the middle, and the
  // gym and staff room below. The caretaker is asleep in the staff room, which
  // is the far corner from the way out — so the deepest loot costs the longest
  // walk back.
  O: {
    bed: [246, 486, 120, 74],
    partitions: [
      [134, 14, 14, 214], [268, 14, 14, 214],
      [14, 228, 50, 14], [120, 228, 60, 14], [236, 228, 66, 14], [358, 228, 28, 14],
      [14, 326, 60, 14], [130, 326, 86, 14], [272, 326, 114, 14],
      [196, 340, 14, 266]
    ],
    doors: [
      [64, 228, 56, 14], [180, 228, 56, 14], [302, 228, 56, 14],
      [74, 326, 56, 14], [216, 326, 56, 14]
    ],
    furniture: [
      // Classroom 1A and 1B: rows of desks with an aisle either side.
      [44, 50, 60, 32], [44, 108, 60, 32], [44, 166, 60, 32],
      [178, 50, 60, 32], [178, 108, 60, 32], [178, 166, 60, 32],
      // The library: a run of shelving along the top wall and one stack on the
      // right, leaving a clear column up from the doorway.
      [292, 34, 84, 32], [330, 110, 46, 90],
      // Corridor lockers, on the top edge and clear of every doorway mouth:
      // the corridor is meant to be the safe road.
      [126, 246, 48, 26], [242, 246, 54, 26],
      // The gym: benches and vaulting boxes down one side, set back far enough
      // from the door that you can turn once you are through it.
      [46, 384, 104, 30], [46, 460, 104, 30], [46, 536, 104, 30],
      // The staff room, around the sleeping caretaker: everything hugs the right
      // wall so the walk down to him stays open.
      [300, 352, 76, 40], [318, 420, 50, 56], [246, 420, 56, 44]
    ]
  },
  // An office floor at night, from the open-plan reference: desk banks and a
  // meeting room upstairs, a corridor, and a conference room and lounge below.
  // Security sits in the lounge, so the whole bottom half is watched and the
  // corridor is the seam you have to keep crossing.
  P: {
    bed: [268, 380, 100, 64],
    partitions: [
      [250, 14, 14, 232],
      [14, 246, 56, 14], [126, 246, 70, 14], [248, 246, 66, 14], [370, 246, 16, 14],
      [14, 344, 50, 14], [120, 344, 80, 14], [200, 344, 50, 14], [306, 344, 80, 14],
      [210, 358, 14, 248]
    ],
    doors: [
      [70, 246, 56, 14], [196, 246, 52, 14], [314, 246, 56, 14],
      [64, 344, 56, 14], [250, 344, 56, 14]
    ],
    furniture: [
      // Two banks of desks in the open plan — dense, and every one of them hard.
      [40, 40, 90, 36], [150, 40, 90, 36],
      [40, 110, 90, 36], [150, 110, 90, 36],
      [40, 180, 90, 36], [150, 180, 90, 36],
      // The meeting room off the side.
      [296, 60, 80, 88], [296, 170, 80, 40],
      // Corridor units, tucked into the wall between the doorways.
      [132, 264, 58, 24], [252, 264, 58, 24],
      // The conference room: one long table you have to walk around.
      [46, 400, 150, 58], [40, 520, 120, 30],
      // The lounge, in front of the security desk.
      [250, 480, 110, 44], [250, 560, 110, 40]
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
  I: { x: 140, y: 300, w: 150, h: 110 },
  J: { x: 150, y: 360, w: 160, h: 90 },
  K: { x: 150, y: 340, w: 160, h: 90 },
  L: { x: 150, y: 260, w: 130, h: 110 },
  M: { x: 120, y: 340, w: 150, h: 90 },
  N: { x: 20, y: 256, w: 360, h: 68 },
  O: { x: 150, y: 280, w: 200, h: 42 },
  P: { x: 130, y: 296, w: 210, h: 44 }
};

function makeLevel(id, layoutKey, spawn, exitSpec, items, options = {}) {
  const layout = LAYOUTS[layoutKey];
  const bed = collider('bed', ...layout.bed);
  const exit = resolveExit(exitSpec);
  const colliders = [
    ...boundary(exit),
    // Interior walls. These are what turn one rectangle into connected areas,
    // and they are structural rather than furniture: like the outer walls they
    // are part of the building, so brushing one costs no noise.
    ...(layout.partitions || []).map((w) => collider('partition', ...w)),
    bed,
    // Furniture carries the theme, so the same shape can be a nightstand in a
    // bedroom and a display plinth in a gallery.
    ...layout.furniture.map((f) => ({ ...collider('furniture', ...f), theme: options.theme || 'bedroom' }))
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
    // The openings in those interior walls, declared rather than inferred:
    // the renderer frames them and the validator checks they are wide enough
    // to actually walk through.
    doors: (layout.doors || []).map(([x, y, w, h]) => ({ x, y, w, h })),
    // Creaky boards: plain trigger rectangles on the floor.
    creaks: (options.creaks || []).map(([x, y, w, h], i) => ({ id: `L${id}-c${i}`, x, y, w, h })),
    // Rugs. These are gameplay, not decoration: footsteps are silent on them,
    // which is what makes a longer route worth considering. The renderer draws
    // them from this same data, so what looks soft is soft.
    rugs: RUGS[layoutKey] ? [RUGS[layoutKey]] : [],
    spawn: { x: spawn[0], y: spawn[1] },
    exit,
    bed,
    // Where his head sits on the pillow — the renderer draws the face here.
    sleeper: { x: bed.x + bed.w / 2, y: bed.y + bed.h * 0.26 },
    // Who is in the room. Defaults to the sleeper on the bed, so every level
    // built before this existed keeps working untouched.
    watcher: {
      kind: options.watcher || 'sleeper',
      x: bed.x + bed.w / 2,
      y: bed.y + bed.h * (options.watcher === 'guard' || options.watcher === 'security' ? 0.5 : 0.26)
    },
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
    [140, 545, 'coin'], [350, 430, 'camera']
  ], { theme: 'house', name: 'Large House', extraTime: 9, creaks: [[130, 320, 66, 44]] }),
  makeLevel(28, 'H', [200, 548], 160, [
    [160, 60, 'diamond'], [70, 250, 'necklace'], [160, 240, 'vase'],
    [350, 250, 'painting'], [250, 130, 'mirror'], [200, 400, 'console'],
    [140, 545, 'wallet'], [350, 430, 'speaker']
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
  ], { theme: 'mansion', name: 'Mansion', extraTime: 11, creaks: [[136, 200, 60, 50], [190, 290, 80, 40]] }),

  // ---- Private gallery: the value is out on the plinths, in the open ------
  makeLevel(33, 'J', [200, 548], 160, [
    [196, 45, 'vase'], [272, 45, 'painting'], [348, 45, 'mirror'],
    [196, 205, 'ring'], [272, 205, 'necklace'], [348, 205, 'camera'],
    [70, 200, 'wallet'], [200, 420, 'coin']
  ], { theme: 'gallery', name: 'Private Gallery', extraTime: 14,
       creaks: [[170, 284, 60, 44]] }),
  makeLevel(34, 'J', [200, 548], 160, [
    [196, 45, 'painting'], [272, 45, 'vase'], [348, 45, 'painting'],
    [196, 205, 'necklace'], [272, 205, 'mirror'], [348, 205, 'jewel'],
    [70, 200, 'watch'], [200, 420, 'wallet'], [286, 520, 'coin']
  ], { theme: 'gallery', name: 'Private Gallery', extraTime: 13,
       creaks: [[170, 284, 60, 44]] }),
  makeLevel(35, 'J', [200, 548], 160, [
    [196, 45, 'diamond'], [272, 45, 'painting', 'bonus'], [348, 45, 'vase'],
    [196, 205, 'painting'], [272, 205, 'necklace'], [348, 205, 'mirror'],
    [70, 200, 'ring'], [200, 420, 'camera']
  ], { theme: 'gallery', name: 'Private Gallery', extraTime: 12,
       creaks: [[170, 284, 60, 44], [90, 400, 70, 44]] }),
  makeLevel(36, 'J', [200, 548], 160, [
    [196, 45, 'goldbar'], [272, 45, 'diamond', 'bonus'], [348, 45, 'painting'],
    [196, 205, 'diamond'], [272, 205, 'painting'], [348, 205, 'necklace'],
    [70, 200, 'jewel'], [200, 420, 'mirror'], [286, 520, 'ring']
  ], { theme: 'gallery', name: 'Private Gallery', extraTime: 12,
       creaks: [[170, 284, 60, 44], [90, 400, 70, 44]] }),

  // ---- Grand suite: rooms off a hall, then the long apartment -------------
  makeLevel(37, 'K', [200, 548], 160, [
    [160, 60, 'necklace'], [90, 210, 'camera'], [290, 110, 'laptop'],
    [340, 60, 'ring'], [250, 235, 'console'], [200, 380, 'tablet'],
    [110, 560, 'coin'], [110, 400, 'speaker']
  ], { theme: 'suite', name: 'Grand Suite', extraTime: 10,
       creaks: [[74, 268, 54, 44]] }),
  makeLevel(38, 'K', [200, 548], 160, [
    [160, 60, 'diamond'], [90, 210, 'necklace'], [290, 110, 'painting'],
    [340, 60, 'jewel'], [250, 235, 'mirror'], [200, 380, 'console'],
    [110, 560, 'wallet'], [110, 400, 'vase'], [340, 380, 'camera']
  ], { theme: 'suite', name: 'Grand Suite', extraTime: 10,
       creaks: [[74, 268, 54, 44], [260, 268, 54, 44]] }),
  makeLevel(39, 'L', [200, 548], 160, [
    [66, 100, 'necklace'], [66, 200, 'jewel'], [320, 200, 'painting'],
    [190, 120, 'camera'], [200, 330, 'console'], [330, 330, 'mirror'],
    [110, 470, 'tablet'], [286, 560, 'coin']
  ], { theme: 'suite', name: 'Grand Suite', extraTime: 11,
       creaks: [[150, 240, 70, 44]] }),
  makeLevel(40, 'L', [200, 548], 160, [
    [66, 100, 'goldbar'], [66, 200, 'diamond'], [320, 200, 'painting', 'bonus'],
    [190, 120, 'necklace'], [200, 330, 'diamond'], [330, 330, 'goldbar'],
    [110, 470, 'mirror'], [286, 560, 'vase'], [330, 470, 'ring']
  ], { theme: 'suite', name: 'Grand Suite', extraTime: 12,
       creaks: [[150, 240, 70, 44], [90, 470, 60, 44]] }),

  // ---- Museum: he is not asleep, and he can see -------------------------
  makeLevel(41, 'M', [100, 548], 60, [
    [65, 100, 'vase'], [140, 90, 'painting'], [232, 90, 'mirror'],
    [318, 100, 'vase'], [200, 190, 'necklace'], [110, 200, 'ring'],
    [180, 400, 'wallet'], [70, 380, 'camera']
  ], { theme: 'museum', name: 'Museum', watcher: 'guard', extraTime: 13,
       creaks: [[110, 284, 66, 44]] }),
  makeLevel(42, 'M', [100, 548], 60, [
    [65, 100, 'painting'], [140, 90, 'diamond'], [232, 90, 'painting'],
    [318, 100, 'vase'], [200, 190, 'goldbar'], [110, 200, 'necklace'],
    [180, 400, 'camera'], [70, 380, 'jewel'], [190, 560, 'coin']
  ], { theme: 'museum', name: 'Museum', watcher: 'guard', extraTime: 13,
       creaks: [[110, 284, 66, 44], [216, 284, 66, 44]] }),
  makeLevel(43, 'M', [100, 548], 60, [
    [65, 100, 'goldbar'], [140, 90, 'painting', 'bonus'], [232, 90, 'diamond'],
    [318, 100, 'painting'], [200, 190, 'diamond'], [110, 200, 'goldbar'],
    [180, 400, 'necklace'], [70, 380, 'mirror']
  ], { theme: 'museum', name: 'Museum', watcher: 'guard', extraTime: 14,
       creaks: [[110, 284, 66, 44], [216, 284, 66, 44]] }),
  makeLevel(44, 'M', [100, 548], 60, [
    [65, 100, 'goldbar'], [140, 90, 'goldbar'], [232, 90, 'diamond', 'bonus'],
    [318, 100, 'painting'], [200, 190, 'goldbar'], [110, 200, 'diamond'],
    [180, 400, 'painting'], [70, 380, 'necklace'], [190, 560, 'ring']
  ], { theme: 'museum', name: 'Museum', watcher: 'security', extraTime: 14,
       creaks: [[110, 284, 66, 44], [216, 284, 66, 44]] }),

  // ---- Hotel floor: a light sleeper, and a long corridor to cross --------
  makeLevel(45, 'N', [200, 290], { side: 'left', at: 258 }, [
    [72, 130, 'wallet'], [200, 120, 'watch'], [330, 130, 'camera'],
    [72, 470, 'ring'], [330, 470, 'tablet'], [200, 520, 'headphones'],
    [235, 190, 'coin'], [340, 300, 'cash']
  ], { theme: 'hotelfloor', name: 'Hotel Floor', watcher: 'guest', extraTime: 12 }),
  makeLevel(46, 'N', [200, 290], { side: 'left', at: 258 }, [
    [72, 130, 'necklace'], [200, 120, 'jewel'], [330, 130, 'console'],
    [72, 470, 'camera'], [330, 470, 'mirror'], [200, 520, 'ring'],
    [235, 190, 'wallet'], [340, 300, 'speaker'], [60, 300, 'coin']
  ], { theme: 'hotelfloor', name: 'Hotel Floor', watcher: 'guest', extraTime: 12 }),
  makeLevel(47, 'N', [200, 290], { side: 'left', at: 258 }, [
    [72, 130, 'diamond'], [200, 120, 'necklace'], [330, 130, 'painting'],
    [72, 470, 'mirror'], [330, 470, 'jewel'], [200, 520, 'console'],
    [235, 190, 'ring'], [340, 300, 'camera']
  ], { theme: 'hotelfloor', name: 'Hotel Floor', watcher: 'guest', extraTime: 13 }),
  makeLevel(48, 'N', [200, 290], { side: 'left', at: 258 }, [
    [72, 130, 'goldbar'], [200, 120, 'diamond', 'bonus'], [330, 130, 'painting'],
    [72, 470, 'diamond'], [330, 470, 'goldbar'], [200, 520, 'necklace'],
    [235, 190, 'jewel'], [340, 300, 'mirror'], [60, 300, 'wallet']
  ], { theme: 'hotelfloor', name: 'Hotel Floor', watcher: 'guest', extraTime: 13 }),

  // ---- School after hours: the caretaker is asleep in the staff room -----
  makeLevel(49, 'O', [340, 284], { side: 'left', at: 250 }, [
    [24, 90, 'tablet'], [116, 150, 'wallet'], [158, 90, 'laptop'],
    [252, 150, 'phone'], [300, 90, 'camera'], [300, 160, 'console'],
    [170, 284, 'coin'], [170, 400, 'speaker'], [24, 400, 'headphones']
  ], { theme: 'school', name: 'School', watcher: 'caretaker', extraTime: 14,
       creaks: [[150, 246, 66, 44]] }),
  makeLevel(50, 'O', [340, 284], { side: 'left', at: 250 }, [
    [24, 90, 'laptop'], [116, 150, 'tablet'], [158, 90, 'console'],
    [252, 150, 'ring'], [300, 90, 'necklace'], [300, 160, 'camera'],
    [170, 284, 'wallet'], [170, 400, 'tv'], [24, 400, 'speaker'],
    [300, 592, 'coin']
  ], { theme: 'school', name: 'School', watcher: 'caretaker', extraTime: 15,
       creaks: [[150, 246, 66, 44], [230, 560, 60, 44]] }),
  makeLevel(51, 'O', [340, 284], { side: 'left', at: 250 }, [
    [24, 90, 'console'], [116, 150, 'laptop'], [158, 90, 'tv'],
    [252, 150, 'necklace'], [300, 90, 'painting'], [300, 160, 'jewel'],
    [170, 284, 'tablet'], [170, 400, 'mirror'], [24, 400, 'camera'],
    [300, 592, 'wallet']
  ], { theme: 'school', name: 'School', watcher: 'caretaker', extraTime: 15,
       creaks: [[150, 246, 66, 44], [230, 560, 60, 44]] }),
  makeLevel(52, 'O', [340, 284], { side: 'left', at: 250 }, [
    [24, 90, 'tv'], [116, 150, 'console'], [158, 90, 'painting', 'bonus'],
    [252, 150, 'diamond'], [300, 90, 'goldbar'], [300, 160, 'necklace'],
    [170, 284, 'laptop'], [170, 400, 'jewel'], [24, 400, 'mirror'],
    [300, 592, 'ring']
  ], { theme: 'school', name: 'School', watcher: 'caretaker', extraTime: 16,
       creaks: [[150, 246, 66, 44], [230, 560, 60, 44]] }),

  // ---- Office floor at night: security is awake, and the lounge is his -----
  makeLevel(53, 'P', [340, 302], { side: 'left', at: 268 }, [
    [24, 80, 'laptop'], [140, 80, 'tablet'], [24, 150, 'console'],
    [140, 150, 'laptop'], [24, 220, 'speaker'], [140, 220, 'camera'],
    [276, 30, 'tv'], [276, 220, 'phone'], [180, 302, 'wallet']
  ], { theme: 'officefloor', name: 'Office Floor', watcher: 'security', extraTime: 14,
       creaks: [[150, 264, 66, 44]] }),
  makeLevel(54, 'P', [340, 302], { side: 'left', at: 268 }, [
    [24, 80, 'tablet'], [140, 80, 'console'], [24, 150, 'laptop'],
    [140, 150, 'speaker'], [24, 220, 'camera'], [140, 220, 'tv'],
    [276, 30, 'painting'], [276, 220, 'necklace'], [180, 302, 'coin'],
    [180, 380, 'mirror']
  ], { theme: 'officefloor', name: 'Office Floor', watcher: 'security', extraTime: 14,
       creaks: [[150, 264, 66, 44], [170, 380, 60, 44]] }),
  makeLevel(55, 'P', [340, 302], { side: 'left', at: 268 }, [
    [24, 80, 'console'], [140, 80, 'tv'], [24, 150, 'speaker'],
    [140, 150, 'painting'], [24, 220, 'tv'], [140, 220, 'necklace'],
    [276, 30, 'diamond'], [276, 220, 'painting'], [180, 302, 'tablet'],
    [180, 380, 'jewel']
  ], { theme: 'officefloor', name: 'Office Floor', watcher: 'security', extraTime: 15,
       creaks: [[150, 264, 66, 44], [170, 380, 60, 44]] }),
  makeLevel(56, 'P', [340, 302], { side: 'left', at: 268 }, [
    [24, 80, 'tv'], [140, 80, 'painting'], [24, 150, 'diamond'],
    [140, 150, 'goldbar'], [24, 220, 'painting'], [140, 220, 'diamond'],
    [276, 30, 'goldbar', 'bonus'], [276, 220, 'diamond'], [180, 302, 'necklace'],
    [180, 380, 'mirror']
  ], { theme: 'officefloor', name: 'Office Floor', watcher: 'security', extraTime: 15,
       creaks: [[150, 264, 66, 44], [170, 380, 60, 44]] })
];

export const collidersOfType = (level, type) =>
  level.colliders.filter((c) => c.type === type);
