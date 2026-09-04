// All drawing of the world and its characters. Cartoon-flat with soft depth:
// every solid gets a drop shadow, a body and a lighter top face, so the room
// reads as objects sitting on a floor rather than coloured rectangles.
import { TUNING } from './tuning.js';
import { SLEEP_ASLEEP, SLEEP_STIRRING, SLEEP_ALMOST, SLEEP_AWAKE } from './rules.js';

const { width: W, height: H, wallThickness: WT } = TUNING.world;

export const PALETTE = {
  wall: '#3a3050',
  wallLip: '#4d3f68',
  skirting: '#6a5688',
  floor: '#a87540',
  floorAlt: '#9e6c39',
  seam: '#7d5228',
  grain: '#b8814a',
  rug: '#2f7f76',
  rugRing: '#3fa093',
  rugTrim: '#efe4cd',
  wood: '#96613a',
  woodTop: '#ad7649',
  woodDark: '#6e4325',
  fabric: '#c05f3e',
  fabricTop: '#d97a53',
  cushion: '#e08a63',
  cabinet: '#7f5533',
  // Per-piece tones, picked deterministically from position so a room has
  // variety without any of it being random frame to frame.
  woods: [
    { base: '#8c5a34', top: '#a87046', dark: '#66401f' },
    { base: '#7d6a4a', top: '#98835f', dark: '#5b4c34' },
    { base: '#9a5f47', top: '#b5775c', dark: '#6f4130' }
  ],
  fabrics: [
    { base: '#b85a3c', top: '#d1734f', cushion: '#df8b64' },
    { base: '#3f6f7e', top: '#548b9c', cushion: '#69a3b3' },
    { base: '#6b5a86', top: '#85729f', cushion: '#9d8ab5' }
  ],
  metal: '#c9d3de',
  bedFrame: '#77462c',
  mattress: '#f7f0e3',
  duvet: '#4459c4',
  duvetTop: '#5a72e0',
  pillow: '#fdfaf3',
  skin: '#f2c9a0',
  skinShade: '#dcae86',
  hair: '#3a2a20',
  thief: '#2c3150',
  thiefTop: '#3d4470',
  thiefBelt: '#1d2138',
  moon: '#bcd9ff'
};

const TAU = Math.PI * 2;

export function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

const fillRound = (ctx, x, y, w, h, r, color) => {
  ctx.fillStyle = color;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
};

// Deterministic per-position jitter, so decoration is varied but never random.
// Integer mixing rather than a sin() trick — coordinates in this room sit in a
// narrow range, and sin() clusters badly over it.
function hash(x, y) {
  let h = Math.imul((Math.round(x) | 0) + 0x9e3779b9, 374761393);
  h = Math.imul(h ^ ((Math.round(y) | 0) + 0x85ebca6b), 668265263);
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- furniture
// The level data says "furniture"; the shape says what kind. Level files never
// had to change to get a room full of different objects.
const STYLE_GROUPS = {
  tall: ['wardrobe', 'bookshelf'],
  wide: ['sofa', 'tvBench'],
  mid: ['table', 'chest'],
  small: ['nightstand', 'table']
};

export function furnitureStyle(c) {
  const ratio = c.w / c.h;
  const group = c.h >= 100 ? 'tall' : ratio >= 2.3 ? 'wide' : ratio >= 1.35 ? 'mid' : 'small';
  const options = STYLE_GROUPS[group];
  return options[Math.floor(hash(c.x + 7, c.y + 13) * options.length) % options.length];
}

const woodTone = (c) => PALETTE.woods[Math.floor(hash(c.y, c.x + 3) * PALETTE.woods.length) % PALETTE.woods.length];
const fabricTone = (c) => PALETTE.fabrics[Math.floor(hash(c.x + 5, c.y) * PALETTE.fabrics.length) % PALETTE.fabrics.length];

function drawShadow(ctx, c) {
  ctx.fillStyle = 'rgba(28,16,10,0.28)';
  roundRect(ctx, c.x + 3, c.y + 6, c.w, c.h, 7);
  ctx.fill();
}

function drawTable(ctx, c) {
  const tone = woodTone(c);
  drawShadow(ctx, c);
  for (const lx of [c.x + 4, c.x + c.w - 12]) {
    fillRound(ctx, lx, c.y + c.h - 8, 8, 10, 3, tone.dark);
  }
  fillRound(ctx, c.x, c.y, c.w, c.h, 7, tone.base);
  fillRound(ctx, c.x + 3, c.y + 3, c.w - 6, c.h - 8, 5, tone.top);
  ctx.strokeStyle = 'rgba(110,67,37,0.35)';              // planks in the top
  ctx.lineWidth = 1;
  for (let i = 1; i < 3; i++) {
    const y = c.y + 4 + ((c.h - 10) / 3) * i;
    ctx.beginPath();
    ctx.moveTo(c.x + 7, y);
    ctx.lineTo(c.x + c.w - 7, y);
    ctx.stroke();
  }
  // Something on the table, chosen by position so it never flickers.
  const roll = hash(c.x, c.y);
  if (roll > 0.55) {
    const mx = c.x + c.w * 0.72;
    const my = c.y + c.h * 0.42;
    fillRound(ctx, mx - 6, my - 6, 12, 12, 3, '#e8ede9');
    fillRound(ctx, mx - 4, my - 4, 8, 8, 2, '#c4d0cc');
  } else if (roll > 0.25) {
    fillRound(ctx, c.x + c.w * 0.6, c.y + c.h * 0.3, 22, 6, 2, '#7f9ad1');
    fillRound(ctx, c.x + c.w * 0.6 + 2, c.y + c.h * 0.3 - 4, 20, 6, 2, '#d2654f');
  }
}

function drawSofa(ctx, c) {
  const tone = fabricTone(c);
  drawShadow(ctx, c);
  fillRound(ctx, c.x, c.y, c.w, c.h, 9, tone.base);
  fillRound(ctx, c.x + 3, c.y + 3, c.w - 6, c.h * 0.42, 6, tone.top); // back
  const seatY = c.y + c.h * 0.46;
  const seatH = c.h * 0.46;
  const cushions = Math.max(2, Math.round(c.w / 46));
  const pad = 5;
  const cw = (c.w - pad * (cushions + 1)) / cushions;
  for (let i = 0; i < cushions; i++) {
    fillRound(ctx, c.x + pad + i * (cw + pad), seatY, cw, seatH, 5, tone.cushion);
  }
  fillRound(ctx, c.x, c.y + c.h * 0.3, 7, c.h * 0.66, 4, tone.top);   // arms
  fillRound(ctx, c.x + c.w - 7, c.y + c.h * 0.3, 7, c.h * 0.66, 4, tone.top);
}

// A low bench with a small television on it.
function drawTvBench(ctx, c) {
  const tone = woodTone(c);
  drawShadow(ctx, c);
  fillRound(ctx, c.x, c.y + c.h * 0.34, c.w, c.h * 0.66, 5, tone.base);
  fillRound(ctx, c.x + 3, c.y + c.h * 0.38, c.w - 6, c.h * 0.3, 3, tone.top);
  ctx.strokeStyle = 'rgba(40,24,12,0.4)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(c.x + c.w / 2, c.y + c.h * 0.4);
  ctx.lineTo(c.x + c.w / 2, c.y + c.h * 0.94);
  ctx.stroke();
  const tw = Math.min(c.w * 0.52, 60);
  const tx = c.x + (c.w - tw) / 2;
  fillRound(ctx, tx, c.y - 4, tw, c.h * 0.44, 3, '#23262f');
  fillRound(ctx, tx + 3, c.y - 1, tw - 6, c.h * 0.44 - 6, 2, '#4c6a7d');
  fillRound(ctx, tx + 5, c.y + 1, (tw - 6) * 0.4, c.h * 0.16, 2, '#6f93a6');
}

// A chest of drawers: reads clearly as storage at a glance.
function drawChest(ctx, c) {
  const tone = woodTone(c);
  drawShadow(ctx, c);
  fillRound(ctx, c.x, c.y, c.w, c.h, 6, tone.dark);
  fillRound(ctx, c.x + 2, c.y + 2, c.w - 4, c.h - 4, 4, tone.base);
  const rows = c.h > 60 ? 3 : 2;
  const gap = 3;
  const dh = (c.h - 8 - gap * (rows - 1)) / rows;
  for (let i = 0; i < rows; i++) {
    const dy = c.y + 4 + i * (dh + gap);
    fillRound(ctx, c.x + 5, dy, c.w - 10, dh, 3, tone.top);
    ctx.fillStyle = PALETTE.metal;
    ctx.beginPath();
    ctx.arc(c.x + c.w / 2, dy + dh / 2, 2.2, 0, TAU);
    ctx.fill();
  }
}

// A tall bookshelf, for variety against the wardrobe.
function drawBookshelf(ctx, c) {
  const tone = woodTone(c);
  drawShadow(ctx, c);
  fillRound(ctx, c.x, c.y, c.w, c.h, 5, tone.dark);
  const shelves = 4;
  const sh = (c.h - 8) / shelves;
  const bookColors = ['#c25b4e', '#4f7fa8', '#d8a15c', '#6d9464', '#c9a24a', '#8a6bb0'];
  for (let i = 0; i < shelves; i++) {
    const sy = c.y + 4 + i * sh;
    ctx.fillStyle = '#2b1c11';
    ctx.fillRect(c.x + 3, sy, c.w - 6, sh - 3);
    let bx = c.x + 5;
    let n = 0;
    while (bx < c.x + c.w - 8) {
      const bw = 3 + Math.floor(hash(c.x + i * 3, c.y + n) * 4);
      const bh = sh - 6 - Math.floor(hash(c.y + n, c.x + i) * 3);
      ctx.fillStyle = bookColors[(i * 3 + n) % bookColors.length];
      ctx.fillRect(bx, sy + (sh - 4 - bh), bw, bh);
      bx += bw + 1.4;
      n++;
    }
    ctx.fillStyle = tone.top;
    ctx.fillRect(c.x + 2, sy + sh - 4, c.w - 4, 3);
  }
}

function drawWardrobe(ctx, c) {
  const tone = woodTone(c);
  drawShadow(ctx, c);
  fillRound(ctx, c.x, c.y, c.w, c.h, 6, tone.dark);
  fillRound(ctx, c.x + 2, c.y + 6, c.w - 4, c.h - 8, 4, tone.base);
  fillRound(ctx, c.x, c.y, c.w, 8, 3, tone.top);                               // cornice
  ctx.strokeStyle = 'rgba(46,26,14,0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(c.x + c.w / 2, c.y + 10);
  ctx.lineTo(c.x + c.w / 2, c.y + c.h - 5);
  ctx.stroke();
  ctx.fillStyle = PALETTE.metal;
  for (const hx of [c.x + c.w / 2 - 5, c.x + c.w / 2 + 5]) {
    ctx.beginPath();
    ctx.arc(hx, c.y + c.h * 0.46, 2.2, 0, TAU);
    ctx.fill();
  }
}

function drawNightstand(ctx, c) {
  const tone = woodTone(c);
  drawShadow(ctx, c);
  fillRound(ctx, c.x, c.y, c.w, c.h, 6, tone.base);
  fillRound(ctx, c.x + 3, c.y + 3, c.w - 6, c.h - 6, 4, tone.top);
  ctx.strokeStyle = 'rgba(110,67,37,0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(c.x + 6, c.y + c.h * 0.55);
  ctx.lineTo(c.x + c.w - 6, c.y + c.h * 0.55);
  ctx.stroke();
  ctx.fillStyle = PALETTE.metal;
  ctx.beginPath();
  ctx.arc(c.x + c.w / 2, c.y + c.h * 0.3, 2.4, 0, TAU);
  ctx.fill();
  if (hash(c.y, c.x) > 0.5) {                                  // a little lamp
    fillRound(ctx, c.x + c.w / 2 - 2, c.y - 10, 4, 12, 2, tone.dark);
    fillRound(ctx, c.x + c.w / 2 - 9, c.y - 18, 18, 10, 4, '#f0d99b');
  }
}

const FURNITURE_PAINTERS = {
  table: drawTable,
  sofa: drawSofa,
  wardrobe: drawWardrobe,
  nightstand: drawNightstand,
  tvBench: drawTvBench,
  chest: drawChest,
  bookshelf: drawBookshelf
};

export function drawFurniture(ctx, c) {
  FURNITURE_PAINTERS[furnitureStyle(c)](ctx, c);
}

// ---------------------------------------------------------------- room
const WINDOWS = { A: 'left', B: 'right', C: 'left' };

function drawFloor(ctx) {
  ctx.fillStyle = PALETTE.floor;
  ctx.fillRect(WT, WT, W - WT * 2, H - WT * 2);

  const plank = 34;
  for (let y = WT, row = 0; y < H - WT; y += plank, row++) {
    if (row % 2 === 1) {
      ctx.fillStyle = PALETTE.floorAlt;
      ctx.fillRect(WT, y, W - WT * 2, Math.min(plank, H - WT - y));
    }
    ctx.strokeStyle = 'rgba(125,82,40,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(WT, y + 0.5);
    ctx.lineTo(W - WT, y + 0.5);
    ctx.stroke();

    // staggered board ends
    const offset = (row % 3) * 90;
    ctx.beginPath();
    for (let x = WT + 60 + offset; x < W - WT; x += 150) {
      ctx.moveTo(x + 0.5, y);
      ctx.lineTo(x + 0.5, Math.min(y + plank, H - WT));
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(184,129,74,0.35)';               // grain
    ctx.beginPath();
    ctx.moveTo(WT, y + plank * 0.55);
    ctx.lineTo(W - WT, y + plank * 0.55);
    ctx.stroke();
  }
}

function drawWalls(ctx) {
  ctx.fillStyle = PALETTE.wall;
  ctx.fillRect(0, 0, W, WT);
  ctx.fillRect(0, 0, WT, H);
  ctx.fillRect(W - WT, 0, WT, H);
  ctx.fillRect(0, H - WT, W, WT);

  ctx.fillStyle = PALETTE.wallLip;                            // lit top edge
  ctx.fillRect(0, 0, W, 4);
  ctx.fillStyle = PALETTE.skirting;                           // skirting board
  ctx.fillRect(WT, WT, W - WT * 2, 3);
  ctx.fillRect(WT, H - WT - 3, W - WT * 2, 3);
  ctx.fillRect(WT, WT, 3, H - WT * 2);
  ctx.fillRect(W - WT - 3, WT, 3, H - WT * 2);
}

function drawWindow(ctx, side) {
  const top = side === 'left' ? 200 : 190;
  const height = 96;
  const x = side === 'left' ? 0 : W - WT;

  ctx.fillStyle = '#1b2b47';
  ctx.fillRect(x, top, WT, height);
  ctx.fillStyle = PALETTE.moon;
  ctx.fillRect(x + 2, top + 4, WT - 4, height - 8);
  ctx.strokeStyle = '#4a5f83';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, top + height / 2);
  ctx.lineTo(x + WT, top + height / 2);
  ctx.stroke();

  // Moonlight pooling on the floor — the room's one cool colour note.
  const dir = side === 'left' ? 1 : -1;
  const originX = side === 'left' ? WT : W - WT;
  const gradient = ctx.createLinearGradient(originX, 0, originX + dir * 150, 0);
  gradient.addColorStop(0, 'rgba(188,217,255,0.20)');
  gradient.addColorStop(1, 'rgba(188,217,255,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(originX, top);
  ctx.lineTo(originX + dir * 150, top - 40);
  ctx.lineTo(originX + dir * 150, top + height + 40);
  ctx.lineTo(originX, top + height);
  ctx.closePath();
  ctx.fill();
}

function drawRug(ctx, layout) {
  const rugs = {
    A: { x: 96, y: 372, w: 190, h: 118 },
    B: { x: 60, y: 92, w: 120, h: 96 },
    C: { x: 96, y: 356, w: 190, h: 64 }
  };
  const r = rugs[layout];
  if (!r) return;
  // Deliberately faint, and fringed at the ends so it reads as a textile lying
  // on the floor. A rug that looks solid would read as something you collide
  // with, which would be a lie the player pays for.
  ctx.globalAlpha = 0.22;
  fillRound(ctx, r.x, r.y, r.w, r.h, 6, PALETTE.rug);
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = PALETTE.rugTrim;
  ctx.lineWidth = 1.5;
  roundRect(ctx, r.x + 9, r.y + 9, r.w - 18, r.h - 18, 4);
  ctx.stroke();
  ctx.globalAlpha = 0.2;                                   // fringe
  ctx.beginPath();
  for (let fx = r.x + 4; fx < r.x + r.w - 2; fx += 7) {
    ctx.moveTo(fx, r.y - 3);
    ctx.lineTo(fx, r.y);
    ctx.moveTo(fx, r.y + r.h);
    ctx.lineTo(fx, r.y + r.h + 3);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawBedBase(ctx, level) {
  const bed = level.bed;
  drawShadow(ctx, bed);
  fillRound(ctx, bed.x, bed.y, bed.w, bed.h, 8, PALETTE.bedFrame);      // frame
  fillRound(ctx, bed.x + 4, bed.y - 5, bed.w - 8, 14, 5, PALETTE.woodTop); // headboard
  fillRound(ctx, bed.x + 5, bed.y + 8, bed.w - 10, bed.h - 14, 6, PALETTE.mattress);
}

// Everything that never moves, drawn once per level into an offscreen canvas.
export function paintStaticRoom(ctx, level) {
  drawFloor(ctx);
  drawRug(ctx, level.layout);
  drawWindow(ctx, WINDOWS[level.layout] || 'left');
  drawWalls(ctx);
  for (const c of level.colliders) {
    if (c.type === 'furniture') drawFurniture(ctx, c);
  }
  drawBedBase(ctx, level);

  // Soft corner vignette for depth.
  const vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, H * 0.72);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(24,12,30,0.30)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);
}

// ---------------------------------------------------------------- sleeper
export function drawSleeper(ctx, level, stage, clock) {
  const bed = level.bed;
  const hx = level.sleeper.x;
  const hy = level.sleeper.y;

  // Breathing: slow while asleep, shallower and faster as he stirs.
  const rate = [0.62, 0.9, 1.35, 2.0][stage];
  const depth = [1, 0.8, 0.55, 0.35][stage];
  const breath = Math.sin(clock * rate * TAU) * depth;
  // A small shift every few seconds, so he is never perfectly still.
  const settle = Math.sin(clock * 0.21) * 0.7 + Math.sin(clock * 0.13 + 1.7) * 0.5;

  const duvetY = bed.y + bed.h * 0.40 - breath * 1.4;
  const duvetH = bed.y + bed.h - 6 - duvetY;
  fillRound(ctx, bed.x + 5, duvetY, bed.w - 10, duvetH, 7, PALETTE.duvet);
  fillRound(ctx, bed.x + 5, duvetY, bed.w - 10, 9 + breath * 1.2, 5, PALETTE.duvetTop);

  ctx.strokeStyle = 'rgba(30,40,110,0.35)';                 // duvet folds
  ctx.lineWidth = 1.5;
  for (let i = 1; i <= 2; i++) {
    const y = duvetY + (duvetH / 3) * i + breath * 0.5;
    ctx.beginPath();
    ctx.moveTo(bed.x + 12, y);
    ctx.bezierCurveTo(bed.x + bed.w * 0.4, y + 3, bed.x + bed.w * 0.6, y - 3, bed.x + bed.w - 12, y);
    ctx.stroke();
  }

  fillRound(ctx, hx - 27, hy - 16, 54, 31, 9, PALETTE.pillow);
  ctx.fillStyle = 'rgba(214,204,186,0.6)';
  roundRect(ctx, hx - 22, hy + 6, 44, 6, 3);
  ctx.fill();

  const headX = hx + settle * 0.9;
  const headY = hy + breath * 0.5;
  ctx.fillStyle = PALETTE.skinShade;
  ctx.beginPath();
  ctx.arc(headX, headY + 1.5, 15, 0, TAU);
  ctx.fill();
  ctx.fillStyle = PALETTE.skin;
  ctx.beginPath();
  ctx.arc(headX, headY, 15, 0, TAU);
  ctx.fill();
  ctx.fillStyle = PALETTE.hair;
  ctx.beginPath();
  ctx.arc(headX, headY - 7, 14, Math.PI, TAU);
  ctx.fill();

  const ey = headY + 1;
  ctx.strokeStyle = PALETTE.hair;
  ctx.lineWidth = 1.7;
  ctx.lineCap = 'round';
  ctx.fillStyle = PALETTE.hair;
  if (stage === SLEEP_ASLEEP) {
    ctx.beginPath();
    ctx.moveTo(headX - 9, ey - 1);
    ctx.quadraticCurveTo(headX - 6, ey + 3, headX - 3, ey - 1);
    ctx.moveTo(headX + 3, ey - 1);
    ctx.quadraticCurveTo(headX + 6, ey + 3, headX + 9, ey - 1);
    ctx.stroke();
  } else if (stage === SLEEP_STIRRING) {
    ctx.beginPath();
    ctx.moveTo(headX - 9, ey);
    ctx.lineTo(headX - 4, ey);
    ctx.moveTo(headX + 4, ey);
    ctx.lineTo(headX + 9, ey);
    ctx.stroke();
  } else {
    const r = stage === SLEEP_ALMOST ? 2.2 : 3.2;
    ctx.beginPath();
    ctx.arc(headX - 6, ey, r, 0, TAU);
    ctx.arc(headX + 6, ey, r, 0, TAU);
    ctx.fill();
  }
  ctx.beginPath();
  if (stage === SLEEP_AWAKE) {
    ctx.arc(headX, ey + 9, 3.5, 0, TAU);
    ctx.fill();
  } else {
    ctx.moveTo(headX - 3.5, ey + 9);
    ctx.lineTo(headX + 3.5, ey + 9);
    ctx.stroke();
  }

  if (stage === SLEEP_ASLEEP) {
    // The beds sit close to the top wall, so the drifting Z's are clamped to
    // stay inside the room instead of sliding up under the HUD.
    const f = (clock * 0.42) % 1;
    const floor = (value) => Math.max(11, value);
    ctx.textAlign = 'left';
    ctx.globalAlpha = Math.max(0, 1 - f);
    ctx.fillStyle = '#ffffffdd';
    ctx.font = 'bold 13px system-ui';
    ctx.fillText('z', hx + 22, floor(hy - 14 - f * 14));
    ctx.font = 'bold 18px system-ui';
    ctx.fillText('Z', hx + 31, floor(hy - 26 - f * 20));
    ctx.globalAlpha = 1;
  } else {
    ctx.textAlign = 'center';
    ctx.font = 'bold 20px system-ui';
    ctx.fillStyle = stage === SLEEP_AWAKE ? '#ff5252' : stage === SLEEP_ALMOST ? '#ffb020' : '#ffe08a';
    ctx.fillText(stage === SLEEP_AWAKE ? '!!' : stage === SLEEP_ALMOST ? '!' : '?', hx, bed.y - 10);
  }
}

// ---------------------------------------------------------------- the thief
// walk: 0..1 blend between idle and walking. reach: 0..1 grab progress.
export function drawThief(ctx, x, y, { facing, walkPhase, walk, clock, reach }) {
  const faceX = Math.cos(facing);
  const faceY = Math.sin(facing);
  // Sideways axis, so the two feet always sit beside each other whichever way
  // he walks, and the stride runs along the direction of travel.
  const sideX = -faceY;
  const sideY = faceX;

  const swing = Math.sin(walkPhase) * walk;
  const breathe = Math.sin(clock * 1.9) * (1 - walk) * 0.6;
  const bob = -Math.abs(Math.sin(walkPhase)) * 1.5 * walk + breathe;
  const bodyY = y + bob;

  ctx.fillStyle = 'rgba(20,10,26,0.30)';
  ctx.beginPath();
  ctx.ellipse(x, y + 20, 10.5, 4, 0, 0, TAU);
  ctx.fill();

  // Both feet stay below the torso whichever way he faces: the stride runs
  // along the heading, but its vertical share is small and the lifted foot
  // squashes rather than rising out of sight. Short legs keep them attached.
  const stride = 5.4;
  const drawLeg = (side, phase) => {
    const lift = Math.max(0, phase) * walk;
    const fx = x + sideX * 4.6 * side + faceX * phase * stride;
    const fy = y + 13 + sideY * 4.6 * side + faceY * phase * 1.7 - lift * 1.2;
    fillRound(ctx, fx - 2.6, bodyY + 4, 5.2, fy - bodyY - 3, 2.4, PALETTE.thief); // leg
    fillRound(ctx, fx - 3.7, fy - 4, 7.4, 8.6 - lift * 1.8, 3, PALETTE.thiefBelt); // shoe
    fillRound(ctx, fx - 2.7, fy - 3.2, 5.4, 3, 1.8, '#3f4568');
  };
  drawLeg(-1, swing);
  drawLeg(1, -swing);

  fillRound(ctx, x - 8.5, bodyY - 9, 17, 17, 7, PALETTE.thief);
  fillRound(ctx, x - 8.5, bodyY - 9, 17, 8, 6, PALETTE.thiefTop);
  ctx.fillStyle = PALETTE.thiefBelt;
  ctx.fillRect(x - 8.5, bodyY + 3.5, 17, 3.2);
  ctx.fillStyle = '#d8b24a';
  ctx.fillRect(x - 2, bodyY + 3.5, 4, 3.2);

  // Arms sit outside the torso and are drawn over it, so the swing reads.
  const drawArm = (side, extend) => {
    const shoulderX = x + sideX * 8.8 * side;
    const shoulderY = bodyY - 4 + sideY * 8.8 * side;
    const reachOut = -swing * side * 3.8 + extend;
    const handX = shoulderX + faceX * reachOut + sideX * side * 1.6;
    const handY = shoulderY + faceY * reachOut * 0.66 + sideY * side * 1.6 + 4;
    ctx.strokeStyle = PALETTE.thiefTop;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(shoulderX, shoulderY);
    ctx.lineTo(handX, handY);
    ctx.stroke();
    ctx.fillStyle = PALETTE.skin;
    ctx.beginPath();
    ctx.arc(handX, handY, 2.7, 0, TAU);
    ctx.fill();
    return { x: handX, y: handY };
  };

  // Reach: out fast, back slower, so the grab has a snap to it.
  const extend = reach > 0 ? Math.sin(Math.min(1, reach) * Math.PI) * 11 : 0;
  drawArm(-1, extend * 0.3);
  const hand = drawArm(1, extend);

  const headY = bodyY - 16;
  ctx.fillStyle = PALETTE.skin;
  ctx.beginPath();
  ctx.arc(x, headY, 8, 0, TAU);
  ctx.fill();
  ctx.fillStyle = PALETTE.thiefBelt;                       // beanie
  ctx.beginPath();
  ctx.arc(x, headY - 1, 8, Math.PI, TAU);
  ctx.fill();
  ctx.fillRect(x - 8, headY - 2, 16, 3.6);
  ctx.fillStyle = '#fff';                                  // eyes track the heading
  const gaze = faceX * 1.6;
  const gazeY = faceY * 0.9;
  ctx.beginPath();
  ctx.arc(x - 3 + gaze, headY + 2 + gazeY, 1.8, 0, TAU);
  ctx.arc(x + 3 + gaze, headY + 2 + gazeY, 1.8, 0, TAU);
  ctx.fill();

  return hand;
}

// The stolen item flying into the thief's hand.
export function drawGrabbedItem(ctx, art, from, hand, progress) {
  const ease = progress * progress * (3 - 2 * progress);
  const x = from.x + (hand.x - from.x) * ease;
  const y = from.y + (hand.y - from.y) * ease;
  const scale = 1 - ease * 0.65;
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - ease * 0.9);
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.textAlign = 'center';
  ctx.font = '23px system-ui';
  ctx.fillText(art, 0, 8);
  ctx.restore();
}
