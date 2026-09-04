// All drawing of the world and its characters. Cartoon-flat with real depth:
// every solid is drawn as a lit top face over a darker side face, which is what
// makes a top-down room read as objects standing on a floor rather than as
// coloured rectangles.
//
// One rule holds throughout: anything that looks solid *is* solid. Props sit on
// top of real colliders (plants on a chest, a lamp on a nightstand), never loose
// on the floor where they would fake a wall the player collides with.
import { TUNING } from './tuning.js';
import { SLEEP_ASLEEP, SLEEP_STIRRING, SLEEP_ALMOST, SLEEP_AWAKE } from './rules.js';

const { width: W, height: H, wallThickness: WT } = TUNING.world;
const TAU = Math.PI * 2;

export const PALETTE = {
  // Warm room, one cool accent. The bedding is the only cold colour in the
  // space, which is what makes it the thing your eye lands on first.
  wall: '#7c3346',
  wallLip: '#9a4257',
  wallShade: '#5f2637',
  skirting: '#c96b6a',
  floor: '#bd7a3e',
  floorAlt: '#b17138',
  seam: '#8f5526',
  grain: '#cf8f52',
  rug: '#3c5f36',
  rugStripe: '#e8dcc0',
  sun: '#ffd88a',

  metal: '#d7dee6',
  leaf: '#4f8f43',
  leafDark: '#3a6d31',
  pot: '#c8703f',
  potDark: '#a4552c',
  lampGlow: '#ffdf9c',
  lampShade: '#f3d79a',
  paper: '#f4ece0',

  woods: [
    { base: '#c07a3c', top: '#d89a55', dark: '#8f5326' },
    { base: '#a9663a', top: '#c48450', dark: '#7c4526' },
    { base: '#b98a4e', top: '#d3a768', dark: '#8a6134' }
  ],
  fabrics: [
    { base: '#c8543f', top: '#e07354', cushion: '#ee9070' },
    { base: '#3f7f88', top: '#549ea8', cushion: '#6fbac3' },
    { base: '#7a5a94', top: '#9576ad', cushion: '#ac91c1' }
  ],

  bedFrame: '#a9663a',
  bedFrameDark: '#7c4526',
  mattress: '#fbf5ea',
  duvet: '#8fcfc9',
  duvetTop: '#a9e0da',
  duvetFold: 'rgba(46,112,110,0.35)',
  pillow: '#fffdf7',
  skin: '#f2c9a0',
  skinShade: '#dcae86',
  hair: '#3a2a20',

  thief: '#2c3150',
  thiefTop: '#3d4470',
  thiefBelt: '#1d2138'
};

const SHADOW = 'rgba(92,40,28,0.30)';

export function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
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

// ---------------------------------------------------------------- solids
// The thickness trick: a dark base fills the whole collider, the lit top face
// covers all but the bottom lip. The silhouette still equals the collider
// exactly, so nothing about the drawing lies about where you can walk.
function drawSolid(ctx, c, tone, radius = 7, depth = 6) {
  ctx.fillStyle = SHADOW;
  roundRect(ctx, c.x + 3, c.y + 7, c.w, c.h, radius);
  ctx.fill();

  const lip = Math.min(depth, c.h * 0.28);
  fillRound(ctx, c.x, c.y, c.w, c.h, radius, tone.dark);
  fillRound(ctx, c.x, c.y, c.w, c.h - lip, radius, tone.base);
  fillRound(ctx, c.x + 3, c.y + 3, c.w - 6, c.h - lip - 6, Math.max(2, radius - 3), tone.top);
  return { lip, topH: c.h - lip };
}

// ---------------------------------------------------------------- props
// Small things that live on top of furniture, exactly as in a real bedroom.
function drawPlant(ctx, x, y, size = 1) {
  ctx.fillStyle = PALETTE.potDark;
  roundRect(ctx, x - 6 * size, y - 2 * size, 12 * size, 9 * size, 2 * size);
  ctx.fill();
  fillRound(ctx, x - 6 * size, y - 3 * size, 12 * size, 5 * size, 2 * size, PALETTE.pot);
  for (let i = 0; i < 6; i++) {
    const angle = -Math.PI / 2 + (i - 2.5) * 0.42;
    const len = (9 + (i % 2) * 4) * size;
    ctx.strokeStyle = i % 2 ? PALETTE.leafDark : PALETTE.leaf;
    ctx.lineWidth = 3.4 * size;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y - 2 * size);
    ctx.lineTo(x + Math.cos(angle) * len, y - 3 * size + Math.sin(angle) * len);
    ctx.stroke();
  }
}

function drawLamp(ctx, x, y) {
  const glow = ctx.createRadialGradient(x, y, 2, x, y, 26);
  glow.addColorStop(0, 'rgba(255,222,150,0.55)');
  glow.addColorStop(1, 'rgba(255,222,150,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, 26, 0, TAU);
  ctx.fill();
  fillRound(ctx, x - 2, y - 2, 4, 10, 2, PALETTE.potDark);
  ctx.fillStyle = PALETTE.lampShade;
  ctx.beginPath();
  ctx.arc(x, y - 3, 7.5, 0, TAU);
  ctx.fill();
  ctx.fillStyle = PALETTE.lampGlow;
  ctx.beginPath();
  ctx.arc(x, y - 3, 4.5, 0, TAU);
  ctx.fill();
}

function drawBooks(ctx, x, y) {
  const colors = ['#c25b4e', '#4f7fa8', '#d8a15c', '#6d9464', '#8a6bb0'];
  for (let i = 0; i < 3; i++) {
    const w = 20 - i * 3;
    fillRound(ctx, x - w / 2, y - i * 4, w, 4, 1.2, colors[(i + Math.round(x)) % colors.length]);
  }
}

function drawMug(ctx, x, y) {
  fillRound(ctx, x - 5, y - 5, 10, 10, 3, '#eef3ef');
  fillRound(ctx, x - 3, y - 3, 6, 6, 2, '#c8d4d0');
  ctx.strokeStyle = '#eef3ef';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x + 7, y, 3, -1.1, 1.1);
  ctx.stroke();
}

function drawPapers(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.12);
  fillRound(ctx, -9, -6, 18, 13, 1.5, PALETTE.paper);
  ctx.strokeStyle = '#c9bfae';
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(-6, -2 + i * 3);
    ctx.lineTo(6, -2 + i * 3);
    ctx.stroke();
  }
  ctx.restore();
}

const PROPS = [drawPlant, drawLamp, drawBooks, drawMug, drawPapers];

// Put one or two props on a surface, chosen by position so they never flicker.
function dressSurface(ctx, c, topH) {
  if (c.w < 40 || topH < 20) return;
  const roll = hash(c.x * 3 + 11, c.y * 5 + 2);
  const count = roll > 0.72 ? 2 : roll > 0.22 ? 1 : 0;
  for (let i = 0; i < count; i++) {
    const pick = PROPS[Math.floor(hash(c.x + i * 31, c.y + i * 17) * PROPS.length) % PROPS.length];
    const px = c.x + c.w * (count === 1 ? 0.68 : 0.28 + i * 0.44);
    const py = c.y + topH * 0.52;
    pick(ctx, px, py);
  }
}

// ---------------------------------------------------------------- furniture
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

function drawTable(ctx, c) {
  const tone = woodTone(c);
  const { topH } = drawSolid(ctx, c, tone, 7, 7);
  ctx.strokeStyle = 'rgba(120,70,32,0.30)';                 // planks in the top
  ctx.lineWidth = 1;
  for (let i = 1; i < 3; i++) {
    const y = c.y + 5 + ((topH - 10) / 3) * i;
    ctx.beginPath();
    ctx.moveTo(c.x + 8, y);
    ctx.lineTo(c.x + c.w - 8, y);
    ctx.stroke();
  }
  dressSurface(ctx, c, topH);
}

function drawSofa(ctx, c) {
  const tone = fabricTone(c);
  ctx.fillStyle = SHADOW;
  roundRect(ctx, c.x + 3, c.y + 7, c.w, c.h, 9);
  ctx.fill();
  fillRound(ctx, c.x, c.y, c.w, c.h, 9, tone.base);
  fillRound(ctx, c.x + 3, c.y + 3, c.w - 6, c.h * 0.40, 6, tone.top);      // back
  const seatY = c.y + c.h * 0.44;
  const seatH = c.h * 0.44;
  const cushions = Math.max(2, Math.round(c.w / 46));
  const pad = 5;
  const cw = (c.w - pad * (cushions + 1)) / cushions;
  for (let i = 0; i < cushions; i++) {
    const cx = c.x + pad + i * (cw + pad);
    fillRound(ctx, cx, seatY + 2, cw, seatH, 5, tone.base);
    fillRound(ctx, cx, seatY, cw, seatH - 2, 5, tone.cushion);
  }
  fillRound(ctx, c.x, c.y + c.h * 0.28, 8, c.h * 0.68, 4, tone.top);        // arms
  fillRound(ctx, c.x + c.w - 8, c.y + c.h * 0.28, 8, c.h * 0.68, 4, tone.top);
  if (hash(c.x, c.y + 9) > 0.4) {                                           // throw cushion
    ctx.save();
    ctx.translate(c.x + c.w * 0.22, c.y + c.h * 0.62);
    ctx.rotate(0.5);
    fillRound(ctx, -8, -8, 16, 16, 4, PALETTE.paper);
    fillRound(ctx, -6, -6, 12, 12, 3, '#e8d9bd');
    ctx.restore();
  }
}

function drawTvBench(ctx, c) {
  const tone = woodTone(c);
  const { topH } = drawSolid(ctx, c, tone, 5, 7);
  ctx.strokeStyle = 'rgba(60,32,14,0.35)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(c.x + c.w / 2, c.y + 5);
  ctx.lineTo(c.x + c.w / 2, c.y + topH - 3);
  ctx.stroke();
  const tw = Math.min(c.w * 0.5, 58);
  const tx = c.x + (c.w - tw) / 2;
  fillRound(ctx, tx, c.y - 6, tw, topH * 0.7, 3, '#22252e');
  fillRound(ctx, tx + 3, c.y - 3, tw - 6, topH * 0.7 - 7, 2, '#4f6f83');
  fillRound(ctx, tx + 5, c.y - 1, (tw - 10) * 0.42, topH * 0.22, 2, '#7ba0b4');
  if (c.w > 96) drawPlant(ctx, c.x + c.w - 14, c.y + topH * 0.45, 0.7);
}

function drawChest(ctx, c) {
  const tone = woodTone(c);
  const { topH } = drawSolid(ctx, c, tone, 6, 6);
  const rows = topH > 46 ? 3 : 2;
  const gap = 3;
  const dh = (topH - 8 - gap * (rows - 1)) / rows;
  for (let i = 0; i < rows; i++) {
    const dy = c.y + 4 + i * (dh + gap);
    fillRound(ctx, c.x + 5, dy, c.w - 10, dh, 3, tone.top);
    fillRound(ctx, c.x + 5, dy, c.w - 10, dh * 0.55, 3, tone.base);
    ctx.fillStyle = PALETTE.metal;
    roundRect(ctx, c.x + c.w / 2 - 5, dy + dh * 0.55, 10, 2.6, 1.3);
    ctx.fill();
  }
  dressSurface(ctx, c, topH * 0.5);
}

function drawBookshelf(ctx, c) {
  const tone = woodTone(c);
  drawSolid(ctx, c, tone, 5, 5);
  const shelves = 4;
  const sh = (c.h - 10) / shelves;
  const bookColors = ['#c25b4e', '#4f7fa8', '#d8a15c', '#6d9464', '#c9a24a', '#8a6bb0'];
  for (let i = 0; i < shelves; i++) {
    const sy = c.y + 5 + i * sh;
    ctx.fillStyle = '#2f1d12';
    ctx.fillRect(c.x + 4, sy, c.w - 8, sh - 3);
    let bx = c.x + 6;
    let n = 0;
    while (bx < c.x + c.w - 9) {
      const bw = 3 + Math.floor(hash(c.x + i * 3, c.y + n) * 4);
      const bh = sh - 6 - Math.floor(hash(c.y + n, c.x + i) * 3);
      ctx.fillStyle = bookColors[(i * 3 + n) % bookColors.length];
      ctx.fillRect(bx, sy + (sh - 4 - bh), bw, bh);
      bx += bw + 1.4;
      n++;
    }
    ctx.fillStyle = tone.top;
    ctx.fillRect(c.x + 3, sy + sh - 4, c.w - 6, 3);
  }
}

function drawWardrobe(ctx, c) {
  const tone = woodTone(c);
  drawSolid(ctx, c, tone, 6, 5);
  fillRound(ctx, c.x + 3, c.y + 9, c.w - 6, c.h - 16, 4, tone.base);
  ctx.strokeStyle = 'rgba(50,26,12,0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(c.x + c.w / 2, c.y + 12);
  ctx.lineTo(c.x + c.w / 2, c.y + c.h - 10);
  ctx.stroke();
  ctx.fillStyle = PALETTE.metal;
  for (const hx of [c.x + c.w / 2 - 5, c.x + c.w / 2 + 5]) {
    ctx.beginPath();
    ctx.arc(hx, c.y + c.h * 0.5, 2.2, 0, TAU);
    ctx.fill();
  }
  if (c.w >= 44) drawPlant(ctx, c.x + c.w / 2, c.y + 6, 0.7);
}

function drawNightstand(ctx, c) {
  const tone = woodTone(c);
  const { topH } = drawSolid(ctx, c, tone, 6, 5);
  ctx.strokeStyle = 'rgba(110,67,37,0.45)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(c.x + 6, c.y + topH * 0.62);
  ctx.lineTo(c.x + c.w - 6, c.y + topH * 0.62);
  ctx.stroke();
  const roll = hash(c.y + 3, c.x);
  if (roll > 0.6) drawLamp(ctx, c.x + c.w / 2, c.y + topH * 0.3);
  else if (roll > 0.3) drawPlant(ctx, c.x + c.w / 2, c.y + topH * 0.32, 0.85);
  else drawBooks(ctx, c.x + c.w / 2, c.y + topH * 0.34);
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

  const plank = 32;
  for (let y = WT, row = 0; y < H - WT; y += plank, row++) {
    const height = Math.min(plank, H - WT - y);
    if (row % 2 === 1) {
      ctx.fillStyle = PALETTE.floorAlt;
      ctx.fillRect(WT, y, W - WT * 2, height);
    }
    ctx.strokeStyle = 'rgba(143,85,38,0.6)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(WT, y + 0.5);
    ctx.lineTo(W - WT, y + 0.5);
    ctx.stroke();

    const offset = (row % 3) * 90;                 // staggered board ends
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = WT + 60 + offset; x < W - WT; x += 150) {
      ctx.moveTo(x + 0.5, y);
      ctx.lineTo(x + 0.5, y + height);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(207,143,82,0.30)';     // grain
    ctx.beginPath();
    ctx.moveTo(WT, y + plank * 0.45);
    ctx.lineTo(W - WT, y + plank * 0.45);
    ctx.moveTo(WT, y + plank * 0.78);
    ctx.lineTo(W - WT, y + plank * 0.78);
    ctx.stroke();
  }
}

function drawWalls(ctx) {
  ctx.fillStyle = PALETTE.wall;
  ctx.fillRect(0, 0, W, WT);
  ctx.fillRect(0, 0, WT, H);
  ctx.fillRect(W - WT, 0, WT, H);
  ctx.fillRect(0, H - WT, W, WT);

  ctx.fillStyle = PALETTE.wallLip;
  ctx.fillRect(0, 0, W, 4);
  ctx.fillStyle = PALETTE.wallShade;                // shaded inner edge
  ctx.fillRect(WT - 3, WT, 3, H - WT * 2);
  ctx.fillRect(W - WT, WT, 3, H - WT * 2);

  ctx.fillStyle = PALETTE.skirting;                 // warm skirting board
  ctx.fillRect(WT, WT, W - WT * 2, 3);
  ctx.fillRect(WT, H - WT - 3, W - WT * 2, 3);
  ctx.fillRect(WT, WT, 3, H - WT * 2);
  ctx.fillRect(W - WT - 3, WT, 3, H - WT * 2);
}

// A big warm shaft of light across the floor: the single strongest cue that
// this is a real room with a window in it.
function drawSunbeam(ctx, side) {
  const top = 176;
  const height = 118;
  const x = side === 'left' ? 0 : W - WT;

  ctx.fillStyle = '#3d2a3a';
  ctx.fillRect(x, top, WT, height);
  ctx.fillStyle = '#fff3d0';
  ctx.fillRect(x + 2, top + 4, WT - 4, height - 8);
  ctx.strokeStyle = '#c98a54';                       // window bars
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 1; i < 3; i++) {
    const y = top + (height / 3) * i;
    ctx.moveTo(x, y);
    ctx.lineTo(x + WT, y);
  }
  ctx.stroke();

  const dir = side === 'left' ? 1 : -1;
  const originX = side === 'left' ? WT : W - WT;
  const reach = 235;
  const beam = ctx.createLinearGradient(originX, 0, originX + dir * reach, 0);
  beam.addColorStop(0, 'rgba(255,216,138,0.34)');
  beam.addColorStop(0.55, 'rgba(255,216,138,0.15)');
  beam.addColorStop(1, 'rgba(255,216,138,0)');
  ctx.fillStyle = beam;
  ctx.beginPath();
  ctx.moveTo(originX, top + 4);
  ctx.lineTo(originX + dir * reach, top - 96);
  ctx.lineTo(originX + dir * reach, top + height + 120);
  ctx.lineTo(originX, top + height - 4);
  ctx.closePath();
  ctx.fill();

  const pool = ctx.createRadialGradient(originX + dir * 34, top + height / 2, 6,
                                        originX + dir * 34, top + height / 2, 118);
  pool.addColorStop(0, 'rgba(255,228,160,0.30)');
  pool.addColorStop(1, 'rgba(255,228,160,0)');
  ctx.fillStyle = pool;
  ctx.fillRect(WT, WT, W - WT * 2, H - WT * 2);

  // Plants on the sill itself — centred on the wall band, so they read as
  // standing on the window ledge rather than on the floor, where they would
  // imply a collider that does not exist.
  const sillX = side === 'left' ? WT / 2 : W - WT / 2;
  drawPlant(ctx, sillX, top + 12, 0.62);
  drawPlant(ctx, sillX, top + height - 6, 0.52);
}

function drawRug(ctx, layout) {
  const rugs = {
    A: { x: 96, y: 372, w: 190, h: 118 },
    B: { x: 60, y: 92, w: 120, h: 96 },
    C: { x: 96, y: 356, w: 190, h: 64 }
  };
  const r = rugs[layout];
  if (!r) return;
  // Faint and fringed, so it reads as a textile lying on the floor. A rug that
  // looked solid would read as something you collide with — a lie the player
  // would pay for.
  // Weak fill, stronger pattern: that reads as a woven textile, where an even
  // slab of colour reads as another piece of furniture.
  ctx.globalAlpha = 0.16;
  fillRound(ctx, r.x, r.y, r.w, r.h, 5, PALETTE.rug);
  ctx.globalAlpha = 0.30;
  ctx.fillStyle = PALETTE.rugStripe;
  for (let i = 1; i <= 3; i++) {
    ctx.fillRect(r.x + 6, r.y + (r.h / 4) * i - 2, r.w - 12, 2.4);
  }
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = PALETTE.rugStripe;
  ctx.lineWidth = 2;
  roundRect(ctx, r.x + 5, r.y + 5, r.w - 10, r.h - 10, 4);
  ctx.stroke();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = PALETTE.rugStripe;
  ctx.lineWidth = 1.4;
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
  ctx.fillStyle = SHADOW;
  roundRect(ctx, bed.x + 3, bed.y + 8, bed.w, bed.h, 8);
  ctx.fill();
  fillRound(ctx, bed.x, bed.y, bed.w, bed.h, 8, PALETTE.bedFrameDark);
  fillRound(ctx, bed.x, bed.y, bed.w, bed.h - 7, 8, PALETTE.bedFrame);
  fillRound(ctx, bed.x + 4, bed.y - 5, bed.w - 8, 15, 5, PALETTE.bedFrame);   // headboard
  fillRound(ctx, bed.x + 7, bed.y - 3, bed.w - 14, 8, 4, PALETTE.woods[2].top);
  fillRound(ctx, bed.x + 5, bed.y + 9, bed.w - 10, bed.h - 20, 6, PALETTE.mattress);
}

// Everything that never moves, drawn once per level into an offscreen canvas.
export function paintStaticRoom(ctx, level) {
  drawFloor(ctx);
  drawRug(ctx, level.layout);
  drawWalls(ctx);
  // After the walls: the window is cut into one, and its light falls on top
  // of the floor that is already down.
  drawSunbeam(ctx, WINDOWS[level.layout] || 'left');
  for (const c of level.colliders) {
    if (c.type === 'furniture') drawFurniture(ctx, c);
  }
  drawBedBase(ctx, level);

  const vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.30, W / 2, H / 2, H * 0.74);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(60,20,40,0.30)');
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

  ctx.strokeStyle = PALETTE.duvetFold;                      // duvet folds
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
    const floor = (value) => Math.max(WT + 6, value);   // stay off the wall band
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
