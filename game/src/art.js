// All drawing of the world and its characters. Cartoon-flat with real depth:
// every solid is drawn as a lit top face over a darker side face, which is what
// makes a top-down room read as objects standing on a floor rather than as
// coloured rectangles.
//
// One rule holds throughout: anything that looks solid *is* solid. Props sit on
// top of real colliders (plants on a chest, a lamp on a nightstand), never loose
// on the floor where they would fake a wall the player collides with.
import { TUNING } from './tuning.js';
import {
  SLEEP_DEEP, SLEEP_LIGHT, SLEEP_DISTURBED, SLEEP_ALMOST, SLEEP_CRITICAL, SLEEP_AWAKE,
  furnitureStyle, hash, watcherConfig
} from './rules.js';

const { wallThickness: WT } = TUNING.world;
// The room's own size, set once per paint. Every use of these lives inside
// paintStaticRoom's call tree, which runs synchronously, so this is the same
// arrangement the theme already uses rather than a new kind of global.
let W = TUNING.world.width;
let H = TUNING.world.height;
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

// Who is asleep. Different people, not the same model in a different shirt:
// hair shape and colour, skin, and what they are sleeping under all change,
// so a hotel guest is recognisably not the man from the bedroom.
const SLEEPER_LOOKS = {
  sleeper:   { hair: '#3a2a20', style: 'short', skin: '#f2c9a0', skinShade: '#dcae86',
               duvet: '#8fcfc9', duvetTop: '#a9e0da', fold: 'rgba(46,112,110,0.35)',
               sheet: '#f3f7fb', pillow: '#fffdf7', shoulder: '#eef2f8' },
  // The hotel guest: longer auburn hair spread on the pillow, and the deep
  // red-gold bedding the corridor floor is decorated in.
  guest:     { hair: '#8c4a2f', style: 'long', skin: '#f7d6b4', skinShade: '#e2bb96',
               duvet: '#b8564f', duvetTop: '#d0736a', fold: 'rgba(96,32,28,0.35)',
               sheet: '#fbeee4', pillow: '#fff8ee', shoulder: '#f6e6da' },
  // The school caretaker: older, grey at the sides and thin on top, asleep in
  // the staff room under a worn olive blanket rather than a duvet.
  // Matched to the walking figure in figure.js: the man asleep on the couch
  // has to be recognisably the man who gets up off it.
  caretaker: { hair: '#b6bcc1', style: 'balding', skin: '#e9bd95', skinShade: '#c99b73',
               duvet: '#6f7c4e', duvetTop: '#899763', fold: 'rgba(40,52,26,0.35)',
               sheet: '#e6e2d2', pillow: '#f2ecdc', shoulder: '#dfe0cf',
               // Asleep at his desk he is in the same olive work coat he stands
               // up in. He was wearing the pale one the sleepers get under a
               // blanket, which meant the most visible moment in the level —
               // the man getting to his feet — was also the moment he changed
               // clothes. Matched to CARETAKER_LOOK.coat in figure.js.
               shirt: '#77854f' },

  // --- the seven of the floorplan levels ------------------------------------
  // Dad: dark, greying at the temples, under the flat's grey-blue bedding.
  dad:       { hair: '#4a3f38', style: 'short', skin: '#eec49c', skinShade: '#d6a97f',
               duvet: '#7d8aa6', duvetTop: '#98a5be', fold: 'rgba(38,48,68,0.35)',
               sheet: '#eef1f6', pillow: '#fbfaf6', shoulder: '#e8ecf3' },
  // Dr. Marek: dark hair, still in his scrubs, under a thin hospital blanket.
  doctor:    { hair: '#2f2a26', style: 'short', skin: '#e6b98f', skinShade: '#cca377',
               duvet: '#5f8f92', duvetTop: '#7aa9ac', fold: 'rgba(26,58,60,0.35)',
               sheet: '#e8f1f0', pillow: '#f4faf9', shoulder: '#cfe2e0' },
  // Grandpa: white, thin on top, a knitted blanket over his knees.
  grandpa:   { hair: '#dcd8d2', style: 'balding', skin: '#e2b58f', skinShade: '#c89a76',
               duvet: '#8a5a3c', duvetTop: '#a5714f', fold: 'rgba(58,34,20,0.4)',
               sheet: '#ead9c2', pillow: '#f3e6d2', shoulder: '#d9c4a8' },
  // Mr. Halas: thinning, still in his shirt and tie.
  worker:    { hair: '#3b342c', style: 'balding', skin: '#efc59c', skinShade: '#d6a87f',
               duvet: '#5b6478', duvetTop: '#737d93', fold: 'rgba(30,36,48,0.35)',
               sheet: '#eef0f4', pillow: '#f7f8fa', shoulder: '#dfe3ea',
               shirt: '#eef2f7', tie: '#8c3a44' },
  // Otakar: hotel burgundy and brass.
  porter:    { hair: '#241d18', style: 'short', skin: '#e9bd94', skinShade: '#cfa176',
               duvet: '#7a2f36', duvetTop: '#9a464d', fold: 'rgba(50,16,20,0.4)',
               sheet: '#f0e3d6', pillow: '#f8efe2', shoulder: '#e5d3c0',
               shirt: '#7a2f36', tie: '#c8a24a' }
};

export const sleeperLook = (kind) => SLEEPER_LOOKS[kind] || SLEEPER_LOOKS.sleeper;

// Each room theme repaints the shell only — walls, floor, light. Furniture and
// props stay the same code, so a new theme costs six colours, not a new module.
const THEMES = {
  bedroom:   { wall: '#7c3346', lip: '#9a4257', shade: '#5f2637', skirt: '#c96b6a',
               floor: '#bd7a3e', alt: '#b17138', seam: 'rgba(143,85,38,0.6)',
               grain: 'rgba(207,143,82,0.30)', light: '255,216,138', vignette: '60,20,40',
               night: '#1a1220', deep: 0.46 },
  apartment: { wall: '#4c5570', lip: '#616c8c', shade: '#3a4257', skirt: '#93a0c0',
               floor: '#b08a5e', alt: '#a58156', seam: 'rgba(126,95,60,0.6)',
               grain: 'rgba(198,162,120,0.28)', light: '255,226,170', vignette: '28,32,54',
               night: '#141a2a', deep: 0.48 },
  hotel:     { wall: '#3f6560', lip: '#527d77', shade: '#2f4c48', skirt: '#96c3bb',
               floor: '#a97f4d', alt: '#9e7645', seam: 'rgba(126,90,48,0.6)',
               grain: 'rgba(198,155,96,0.28)', light: '255,232,186', vignette: '18,44,44',
               night: '#0f1e20', deep: 0.50 },
  office:    { wall: '#3d4652', lip: '#515c6b', shade: '#2c343d', skirt: '#8d9aab',
               floor: '#8e8b84', alt: '#85827b', seam: 'rgba(96,94,88,0.6)',
               grain: 'rgba(170,167,158,0.26)', light: '208,232,255', vignette: '20,26,34',
               night: '#101620', deep: 0.56 },
  luxury:    { wall: '#4a2f63', lip: '#603d80', shade: '#38234a', skirt: '#c9a86a',
               floor: '#9d6b3f', alt: '#926239', seam: 'rgba(116,74,38,0.6)',
               grain: 'rgba(190,140,88,0.28)', light: '255,214,150', vignette: '38,20,54',
               night: '#18102a', deep: 0.50 },
  penthouse: { wall: '#2c2f3d', lip: '#3d4152', shade: '#1f222d', skirt: '#d3b166',
               floor: '#7d6242', alt: '#74593b', seam: 'rgba(92,70,44,0.6)',
               grain: 'rgba(170,140,100,0.26)', light: '255,236,190', vignette: '14,16,24',
               night: '#0c0e18', deep: 0.58 },
  house:     { wall: '#54484f', lip: '#6b5c65', shade: '#3f363c', skirt: '#c4a68f',
               floor: '#a97c50', alt: '#9e7348', seam: 'rgba(126,88,52,0.6)',
               grain: 'rgba(200,156,110,0.28)', light: '255,228,172', vignette: '30,24,30',
               night: '#1a1418', deep: 0.46 },
  mansion:   { wall: '#3a2e46', lip: '#4d3d5c', shade: '#2a2033', skirt: '#cfae74',
               floor: '#8a6a4c', alt: '#806244', seam: 'rgba(104,78,54,0.6)',
               grain: 'rgba(186,152,112,0.26)', light: '255,232,180', vignette: '24,16,32',
               night: '#140e1c', deep: 0.54 },
  // Pale stone and cool grey, after the museum reference.
  gallery:   { wall: '#5a5f6b', lip: '#767c8a', shade: '#454a55', skirt: '#d7d2c8',
               floor: '#9a988f', alt: '#918f86', seam: 'rgba(110,108,100,0.55)',
               grain: 'rgba(190,187,176,0.24)', light: '232,240,255', vignette: '26,28,36',
               night: '#101420', deep: 0.56 },
  // Warm cream floors and white walls, after the apartment reference.
  suite:     { wall: '#6e6455', lip: '#8a7e6c', shade: '#544c40', skirt: '#f0e7d6',
               floor: '#c3a985', alt: '#b99f7c', seam: 'rgba(150,124,90,0.5)',
               grain: 'rgba(216,194,160,0.26)', light: '255,238,204', vignette: '38,32,26',
               night: '#1e1810', deep: 0.42 },
  // Marble and cool stone, after the great-hall reference.
  museum:    { wall: '#4a4f5e', lip: '#616779', shade: '#383c48', skirt: '#cdd3dc',
               floor: '#a6a8ac', alt: '#9d9fa4', seam: 'rgba(120,122,128,0.5)',
               grain: 'rgba(200,203,210,0.22)', light: '226,238,255', vignette: '20,22,30',
               night: '#0e1220', deep: 0.58 },
  // Deep carpet and warm lamps, after the hotel-corridor reference.
  hotelfloor:{ wall: '#4c3a3f', lip: '#63494f', shade: '#3a2c30', skirt: '#c9a98f',
               floor: '#8f5c52', alt: '#86554c', seam: 'rgba(102,62,54,0.55)',
               grain: 'rgba(180,120,104,0.24)', light: '255,222,178', vignette: '30,18,20',
               night: '#1a1012', deep: 0.50 },
  // Varnished boards and green board-paint, after the classroom reference.
  school:    { wall: '#3f5a4a', lip: '#527461', shade: '#2f4437', skirt: '#a9c4ae',
               floor: '#b07a3c', alt: '#a67236', seam: 'rgba(132,88,42,0.6)',
               grain: 'rgba(206,152,88,0.30)', light: '236,246,214', vignette: '20,32,26',
               night: '#0b1a24', deep: 0.52 },
  // Grey contract carpet and a dark ceiling, after the open-plan reference.
  officefloor:{ wall: '#333a44', lip: '#464e5b', shade: '#242a32', skirt: '#7f8b9c',
               floor: '#7f8a7c', alt: '#778274', seam: 'rgba(92,100,90,0.55)',
               grain: 'rgba(160,170,158,0.24)', light: '214,236,255', vignette: '16,20,26',
               night: '#0e1218', deep: 0.56 },
  // Pale green tile and hard strip lighting: a hospital floor at night.
  hospital:  { wall: '#33565a', lip: '#457076', shade: '#254045', skirt: '#bcd8d4',
               floor: '#b6c4bd', alt: '#adbcb5', seam: 'rgba(126,140,132,0.5)',
               grain: 'rgba(206,218,210,0.22)', light: '224,244,255', vignette: '16,28,30',
               night: '#0c1a1e', deep: 0.46 },
  // Dark green boards and firelight, after the cottage reference.
  cottage:   { wall: '#3d4a35', lip: '#516046', shade: '#2c3627', skirt: '#c4b58c',
               floor: '#b5763a', alt: '#a96d34', seam: 'rgba(134,84,38,0.6)',
               grain: 'rgba(212,148,86,0.30)', light: '255,208,132', vignette: '26,24,14',
               night: '#1c1408', deep: 0.48 },
  // Shop lino and cold strip light, with the shutters down.
  shop:      { wall: '#4a3f2e', lip: '#61533d', shade: '#362d21', skirt: '#d8c79c',
               floor: '#a5a08f', alt: '#9c9787', seam: 'rgba(116,112,100,0.5)',
               grain: 'rgba(198,192,176,0.22)', light: '236,244,220', vignette: '24,20,14',
               night: '#100c06', deep: 0.54 },
  // Poured concrete and steel: no daylight ever gets in here.
  vault:     { wall: '#2b2f36', lip: '#3d434d', shade: '#1e2127', skirt: '#8d97a6',
               floor: '#6f747c', alt: '#686d75', seam: 'rgba(84,88,96,0.55)',
               grain: 'rgba(140,146,156,0.20)', light: '198,222,255', vignette: '10,12,16',
               night: '#06080c', deep: 0.66 }
};

let T = THEMES.bedroom;   // set once per room paint; drawing is synchronous

const SHADOW = 'rgba(92,40,28,0.30)';

// How each item type looks and reads. The simulation never sees any of this.
export const ITEM_ART = {
  phone: '📱', watch: '⌚', cash: '💵', jewel: '💎', laptop: '💻', tv: '📺',
  coin: '🪙', wallet: '👛', headphones: '🎧', ring: '💍', camera: '📷',
  tablet: '🖥️', console: '🎮', speaker: '🔊', necklace: '📿', vase: '🏺',
  painting: '🖼️', mirror: '🪞', diamond: '💠', goldbar: '💰'
};

export const ITEM_NAMES = {
  phone: 'Phone', watch: 'Watch', cash: 'Cash', jewel: 'Jewels', laptop: 'Laptop',
  tv: 'TV', coin: 'Coins', wallet: 'Wallet', headphones: 'Headphones', ring: 'Ring',
  camera: 'Camera', tablet: 'Monitor', console: 'Console', speaker: 'Speaker',
  necklace: 'Necklace', vase: 'Vase', painting: 'Painting', mirror: 'Mirror',
  diamond: 'Diamond', goldbar: 'Gold'
};

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

// -------------------------------------------------------------- the finish
//
// This was written for the school, where it was switched on by a flag and off
// in the other ten buildings. None of it turned out to be about the school:
// a wall that catches the light along its top edge, a floor with grout in it,
// and furniture that casts a shadow where it meets the ground are what every
// room in this game wanted. So there is no flag any more — this is simply how
// the game paints, and the eleven locations differ by their palette and their
// contents rather than by how much care the painter took.
//
// It is all baked into the room cache — painted once when a level loads and
// blitted every frame after that — so none of it costs a millisecond while the
// game is running, which is what makes it affordable to do properly.
//
// Three ideas, in the order they matter:
//
//   GROUNDING   A rectangle with a hard offset copy of itself behind it reads
//               as a sticker. A soft shadow that is darkest where the object
//               meets the floor and gone a few units out reads as an object
//               standing on the floor. Nothing else on this list changes the
//               picture as much.
//   MATERIAL    A flat fill is a colour, not a surface. Tile wants grout and a
//               sheen, wood wants grain and butt joints, steel wants a brushed
//               gradient down the door. Cheap, and the difference between a
//               floorplan and a building.
//   LIGHT       A room lit evenly end to end is a diagram. Pools under the
//               fittings, spill from the windows, and everything else a shade
//               down — in each location's own colour of darkness.

// A soft contact shadow under something standing on the floor.
//
// Two passes: a wide, faint one for the ambient occlusion the object casts into
// the floor around it, and a tight dark one right at its foot for the contact
// itself. The offset is down and very slightly right, which is where every
// other shadow in this game falls, so the whole room agrees about where the
// light is.
function groundShadow(ctx, c, spread = 7, strength = 0.34, allRound = false) {
  const g = ctx.createLinearGradient(0, c.y + c.h - 2, 0, c.y + c.h + spread);
  g.addColorStop(0, `rgba(16,22,20,${strength})`);
  g.addColorStop(0.45, `rgba(16,22,20,${strength * 0.45})`);
  g.addColorStop(1, 'rgba(16,22,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(c.x - spread * 0.35, c.y + c.h - 2, c.w + spread * 0.9, spread + 2);
  // ...and a whisper down each side, so a bank of lockers is not a shape that
  // only exists below the waist.
  const side = ctx.createLinearGradient(c.x + c.w, 0, c.x + c.w + spread * 0.6, 0);
  side.addColorStop(0, `rgba(16,22,20,${strength * 0.55})`);
  side.addColorStop(1, 'rgba(16,22,20,0)');
  ctx.fillStyle = side;
  ctx.fillRect(c.x + c.w, c.y + 2, spread * 0.6, c.h);
  // A piece standing as an island is walked all the way round, so it casts all
  // the way round. One bolted to a wall has nothing on the far side to cast on.
  if (allRound) {
    const up = ctx.createLinearGradient(0, c.y, 0, c.y - spread * 0.7);
    up.addColorStop(0, `rgba(16,22,20,${strength * 0.6})`);
    up.addColorStop(1, 'rgba(16,22,20,0)');
    ctx.fillStyle = up;
    ctx.fillRect(c.x - spread * 0.3, c.y - spread * 0.7, c.w + spread * 0.6, spread * 0.7);
    const left = ctx.createLinearGradient(c.x, 0, c.x - spread * 0.6, 0);
    left.addColorStop(0, `rgba(16,22,20,${strength * 0.45})`);
    left.addColorStop(1, 'rgba(16,22,20,0)');
    ctx.fillStyle = left;
    ctx.fillRect(c.x - spread * 0.6, c.y + 2, spread * 0.6, c.h);
  }
}

// The dark that gathers where a wall meets the floor. Same idea as above and a
// different shape: a wall is long and the room only sees one face of it, so
// this is a band down that face rather than a halo round a box.
function wallFoot(ctx, c) {
  const deep = 9;
  const g = ctx.createLinearGradient(0, c.y + c.h, 0, c.y + c.h + deep);
  g.addColorStop(0, 'rgba(12,20,16,0.34)');
  g.addColorStop(1, 'rgba(12,20,16,0)');
  ctx.fillStyle = g;
  ctx.fillRect(c.x - 2, c.y + c.h, c.w + 4, deep);
  const up = ctx.createLinearGradient(0, c.y, 0, c.y - deep * 0.6);
  up.addColorStop(0, 'rgba(12,20,16,0.20)');
  up.addColorStop(1, 'rgba(12,20,16,0)');
  ctx.fillStyle = up;
  ctx.fillRect(c.x - 2, c.y - deep * 0.6, c.w + 4, deep * 0.6);
}

// Tone jitter that is the same every time. Two objects a tile apart get
// different shades and the same object gets the same shade on every repaint,
// which is the whole requirement for a surface that reads as made of pieces.
function shade(x, y, amount) {
  return (hash(x, y) - 0.5) * amount;
}

// Lighten or darken a hex colour by a fraction. Enough colour maths for a
// brushed gradient and a grout line; anything more belongs in a palette.
function tint(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + (k > 0 ? (255 - c) * k : c * k))));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// --- floors ------------------------------------------------------------------
//
// One surface per material rather than one grid with the pitch changed. The
// corridor floor is the single biggest area in the game and the tile grid it
// had was a colour with lines ruled over it; this is tile.
//
// All of it is baked into the room cache, but "baked" is not "free": the
// biggest school is 1220 by 960, which is three thousand tiles, and the first
// draft set `fillStyle` once per tile and tripled the time a level takes to
// load. Setting a fill colour is the expensive call here, not filling — so
// every painter below sorts its pieces into a handful of shade buckets, builds
// one path per bucket, and pays for the colour once instead of once per tile.
// Same picture, a quarter of the cost.
const SHADES = 7;

// The bucket a piece falls in, and the colour that bucket paints. Quantising
// the jitter is what makes the batching possible at all, and at seven steps
// the banding is well under what a tile's own grout hides.
function shadeBucket(x, y) {
  return Math.min(SHADES - 1, Math.floor(hash(x, y) * SHADES));
}

function shadeTable(base, amount) {
  const out = [];
  for (let i = 0; i < SHADES; i++) {
    out.push(tint(base, ((i + 0.5) / SHADES - 0.5) * amount));
  }
  return out;
}

// Fill every rect in each bucket with that bucket's colour: one fillStyle and
// one fill per bucket rather than per piece.
function paintBuckets(ctx, rects, colours) {
  for (let i = 0; i < colours.length; i++) {
    const list = rects[i];
    if (!list.length) continue;
    ctx.fillStyle = colours[i];
    ctx.beginPath();
    for (let j = 0; j < list.length; j += 4) {
      ctx.rect(list[j], list[j + 1], list[j + 2], list[j + 3]);
    }
    ctx.fill();
  }
}

const emptyBuckets = () => Array.from({ length: SHADES }, () => []);

function tileFloor(ctx, d, base) {
  const pitch = 20;
  ctx.fillStyle = base;
  ctx.fillRect(d.x, d.y, d.w, d.h);
  const x0 = Math.floor(d.x / pitch) * pitch;
  const y0 = Math.floor(d.y / pitch) * pitch;
  ctx.save();
  ctx.beginPath();
  ctx.rect(d.x, d.y, d.w, d.h);
  ctx.clip();
  // Each tile its own shade. A real floor is a batch of tiles that never quite
  // matched, and this is the whole of why it reads as laid rather than printed.
  const rects = emptyBuckets();
  for (let y = y0; y < d.y + d.h; y += pitch) {
    for (let x = x0; x < d.x + d.w; x += pitch) {
      rects[shadeBucket(x, y)].push(x, y, pitch - 1, pitch - 1);
    }
  }
  paintBuckets(ctx, rects, shadeTable(base, 0.085));
  // A lit top-left edge on each one, which is what gives a tile an edge rather
  // than a gap beside it. One colour, so one path for the lot.
  ctx.fillStyle = 'rgba(255,255,255,0.055)';
  ctx.beginPath();
  for (let y = y0; y < d.y + d.h; y += pitch) {
    for (let x = x0; x < d.x + d.w; x += pitch) {
      ctx.rect(x, y, pitch - 1, 1);
      ctx.rect(x, y, 1, pitch - 1);
    }
  }
  ctx.fill();
  // Grout: the gaps left between the tiles, darkened in one pass.
  ctx.fillStyle = 'rgba(38,42,38,0.22)';
  ctx.beginPath();
  for (let y = y0; y < d.y + d.h; y += pitch) ctx.rect(d.x, y + pitch - 1, d.w, 1);
  for (let x = x0; x < d.x + d.w; x += pitch) ctx.rect(x + pitch - 1, d.y, 1, d.h);
  ctx.fill();
  ctx.restore();
}

function boardFloor(ctx, d, base) {
  const deep = 15;
  ctx.fillStyle = base;
  ctx.fillRect(d.x, d.y, d.w, d.h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(d.x, d.y, d.w, d.h);
  ctx.clip();
  const y0 = Math.floor(d.y / deep) * deep;
  const rects = emptyBuckets();
  const joints = [];
  const light = [];
  const dark = [];
  for (let y = y0, row = 0; y < d.y + d.h; y += deep, row++) {
    // Butt joints staggered by row, so the boards read as laid in courses
    // rather than as a sheet with lines on it.
    const stagger = (row % 3) * 46 + (row % 2) * 23;
    for (let x = Math.floor((d.x - stagger) / 138) * 138 + stagger;
      x < d.x + d.w; x += 138) {
      rects[shadeBucket(x, y)].push(x, y, 138, deep - 1);
      joints.push(x, y, 1, deep - 1);
      // Grain: two streaks along the board, offset by where the board is.
      light.push(x + 4, y + 3 + (hash(x, y) > 0.5 ? 1 : 0), 130, 1);
      dark.push(x + 10, y + deep - 5, 118, 1);
    }
    joints.push(d.x, y + deep - 1, d.w, 1);           // the seam between courses
  }
  paintBuckets(ctx, rects, shadeTable(base, 0.085));
  const run = (list, colour) => {
    ctx.fillStyle = colour;
    ctx.beginPath();
    for (let i = 0; i < list.length; i += 4) ctx.rect(list[i], list[i + 1], list[i + 2], list[i + 3]);
    ctx.fill();
  };
  run(light, 'rgba(255,222,170,0.10)');
  run(dark, 'rgba(70,42,16,0.13)');
  run(joints, 'rgba(52,30,11,0.35)');
  ctx.restore();
}

function grassFloor(ctx, d, base) {
  ctx.fillStyle = base;
  ctx.fillRect(d.x, d.y, d.w, d.h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(d.x, d.y, d.w, d.h);
  ctx.clip();
  // Mown stripes. A school field is cut in passes and it is the single thing
  // that stops a green rectangle reading as a green rectangle.
  const band = 46;
  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  ctx.beginPath();
  for (let y = Math.floor(d.y / (band * 2)) * band * 2; y < d.y + d.h; y += band * 2) {
    ctx.rect(d.x, y, d.w, band);
  }
  ctx.fill();
  // ...and clumps, so the stripes are not the only thing happening. Two tones,
  // so two paths.
  const pale = [];
  const deep = [];
  for (let y = d.y; y < d.y + d.h; y += 17) {
    for (let x = d.x + ((y / 17) % 2 ? 8 : 0); x < d.x + d.w; x += 21) {
      const r = hash(x, y);
      (r > 0.62 ? pale : deep).push(x + r * 6, y + r * 5, 6 + r * 5, 2);
    }
  }
  for (const [list, colour] of [[pale, 'rgba(96,140,74,0.30)'], [deep, 'rgba(44,68,34,0.22)']]) {
    ctx.fillStyle = colour;
    ctx.beginPath();
    for (let i = 0; i < list.length; i += 4) ctx.rect(list[i], list[i + 1], list[i + 2], list[i + 3]);
    ctx.fill();
  }
  ctx.restore();
}

function parquetFloor(ctx, d, base) {
  const blk = 22;
  ctx.fillStyle = base;
  ctx.fillRect(d.x, d.y, d.w, d.h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(d.x, d.y, d.w, d.h);
  ctx.clip();
  const x0 = Math.floor(d.x / blk) * blk;
  const y0 = Math.floor(d.y / blk) * blk;
  const rects = emptyBuckets();
  const fingers = [];
  for (let y = y0; y < d.y + d.h; y += blk) {
    for (let x = x0; x < d.x + d.w; x += blk) {
      // Alternating block direction: the fingers of a parquet floor, and the
      // reason a gym floor reads as sprung wood rather than as orange lino.
      const across = ((x / blk) + (y / blk)) % 2 === 0;
      rects[shadeBucket(x, y)].push(x, y, blk - 1, blk - 1);
      for (let i = 1; i < 4; i++) {
        if (across) fingers.push(x, y + i * (blk / 4), blk - 1, 1);
        else fingers.push(x + i * (blk / 4), y, 1, blk - 1);
      }
    }
  }
  paintBuckets(ctx, rects, shadeTable(base, 0.12));
  ctx.fillStyle = 'rgba(110,72,30,0.22)';
  ctx.beginPath();
  for (let i = 0; i < fingers.length; i += 4) {
    ctx.rect(fingers[i], fingers[i + 1], fingers[i + 2], fingers[i + 3]);
  }
  ctx.fill();
  ctx.fillStyle = 'rgba(96,62,26,0.26)';
  ctx.beginPath();
  for (let y = y0; y < d.y + d.h; y += blk) ctx.rect(d.x, y + blk - 1, d.w, 1);
  for (let x = x0; x < d.x + d.w; x += blk) ctx.rect(x + blk - 1, d.y, 1, d.h);
  ctx.fill();
  ctx.restore();
}

// Carpet, concrete, gravel: no courses, just a surface that is not one colour.
function mottleFloor(ctx, d, base, fleck, warm) {
  ctx.fillStyle = base;
  ctx.fillRect(d.x, d.y, d.w, d.h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(d.x, d.y, d.w, d.h);
  ctx.clip();
  const a = [];
  const b = [];
  for (let y = d.y; y < d.y + d.h; y += 9) {
    for (let x = d.x + ((y / 9) % 2 ? 5 : 0); x < d.x + d.w; x += 11) {
      const r = hash(x, y);
      (r > 0.5 ? b : a).push(x + r * 4, y + r * 3, 2 + r * 3, 2);
    }
  }
  for (const [list, colour] of [[a, fleck], [b, warm]]) {
    ctx.fillStyle = colour;
    ctx.beginPath();
    for (let i = 0; i < list.length; i += 4) ctx.rect(list[i], list[i + 1], list[i + 2], list[i + 3]);
    ctx.fill();
  }
  ctx.restore();
}

// The shadow a thing standing on the floor casts, for every painter in the file.
//
// This replaces a hard offset copy of the object drawn three units right and
// seven down — which is what every piece of furniture in the game had, and what
// made rooms read as stickers on a floor rather than objects in one. The soft
// version was written for the school; there was never anything about it that
// was the school's.
//
// `spread` scales with the piece: a wardrobe throws further than a pot plant.
function drop(ctx, box, spread) {
  groundShadow(ctx, box, spread === undefined
    ? Math.max(5, Math.min(11, Math.max(box.w, box.h) * 0.18)) : spread, 0.32);
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

// Lamps are painted into the cached room, but their glow flickers every frame,
// so their positions are collected as the room is painted.
export const lampPositions = [];

function drawLamp(ctx, x, y) {
  lampPositions.push({ x, y });
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
  drop(ctx, c);
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

// A museum plinth: a pale stone block with an artefact standing on it.
function drawPlinth(ctx, c) {
  drop(ctx, c);
  fillRound(ctx, c.x, c.y, c.w, c.h, 4, '#8e8a86');
  fillRound(ctx, c.x, c.y, c.w, c.h - 7, 4, '#c8c3bb');
  fillRound(ctx, c.x + 4, c.y + 3, c.w - 8, c.h - 15, 3, '#ddd8cf');
  // The piece on show, chosen by position so it never flickers.
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h * 0.42;
  const roll = hash(c.x + 2, c.y + 9);
  if (roll > 0.66) {                                   // an urn
    ctx.fillStyle = '#b8763f';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 6, 8, 0, 0, TAU);
    ctx.fill();
    ctx.fillRect(cx - 2, cy - 11, 4, 5);
    ctx.fillStyle = '#d69457';
    ctx.beginPath();
    ctx.ellipse(cx - 1.5, cy - 1, 2.6, 4, 0, 0, TAU);
    ctx.fill();
  } else if (roll > 0.33) {                            // a bust
    ctx.fillStyle = '#cfd4d8';
    ctx.beginPath();
    ctx.arc(cx, cy - 3, 5, 0, TAU);
    ctx.fill();
    fillRound(ctx, cx - 6, cy + 1, 12, 7, 2.5, '#b9bfc4');
  } else {                                             // a jade piece
    ctx.fillStyle = '#4f8f6b';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 7, 6.5, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#6fb389';
    ctx.beginPath();
    ctx.ellipse(cx - 2, cy - 2, 3, 2.4, -0.4, 0, TAU);
    ctx.fill();
  }
  // A brass rail on the front edge, as in a real gallery.
  ctx.strokeStyle = '#a68a4d';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(c.x + 5, c.y + c.h - 3);
  ctx.lineTo(c.x + c.w - 5, c.y + c.h - 3);
  ctx.stroke();
}

// --- the school's own furniture ----------------------------------------------
// A sports hall does not contain sofas and a corridor is not lined with chests
// of drawers. The shared painters are right for the eleven locations that are
// somebody's home or a hotel; a school needs benches and lockers, and drawing
// its 'S' as a three-cushion settee was the single thing most stopping the
// building from reading as a school.

// A gym bench, or the one bolted to a corridor wall: a plank, two ends, no
// upholstery. Runs along its longer side whichever way the map drew it.
// A school desk, in wood.
//
// Same construction as before — a top, a seam where two are pushed together,
// paper on it, chairs tucked under the near edge — with the two things a slab
// of orange was missing: grain running along the top, and an edge. A desk top
// is a board with a lipped edge and a shadowed underside, and drawing those is
// most of what tells the eye it is a piece of furniture at a height rather than
// a rectangle painted on the floor.
function drawDesk(ctx, c) {
  groundShadow(ctx, c, 9, 0.34);
  const base = '#b9803f';
  // The carcass, dark, so the lit top can sit proud of it.
  fillRound(ctx, c.x, c.y, c.w, c.h, 4, '#7d5227');
  // The top, lit from the top-left the way everything else in the room is.
  const top = ctx.createLinearGradient(c.x, c.y, c.x + c.w * 0.35, c.y + c.h);
  top.addColorStop(0, tint(base, 0.20));
  top.addColorStop(0.45, base);
  top.addColorStop(1, tint(base, -0.12));
  ctx.fillStyle = top;
  roundRect(ctx, c.x + 0.8, c.y + 0.8, c.w - 1.6, c.h - 3.4, 3.4);
  ctx.fill();
  // Grain, along the length, deterministic from where the desk stands.
  ctx.save();
  ctx.beginPath();
  ctx.rect(c.x + 1, c.y + 1, c.w - 2, c.h - 4);
  ctx.clip();
  const along = c.w >= c.h;
  const runs = Math.max(2, Math.round((along ? c.h : c.w) / 5));
  for (let i = 0; i < runs; i++) {
    const t = (i + 0.5) / runs;
    const r = hash(Math.round(c.x + i * 13), Math.round(c.y + i * 7));
    ctx.fillStyle = r > 0.5 ? 'rgba(255,226,178,0.13)' : 'rgba(96,58,22,0.15)';
    if (along) ctx.fillRect(c.x + 2 + r * 6, c.y + t * c.h, c.w - 4 - r * 10, 1);
    else ctx.fillRect(c.x + t * c.w, c.y + 2 + r * 6, 1, c.h - 4 - r * 10);
  }
  ctx.restore();
  // The lipped front edge, and the shadow under it.
  ctx.fillStyle = 'rgba(70,42,16,0.42)';
  ctx.fillRect(c.x + 1, c.y + c.h - 4.2, c.w - 2, 1.4);
  ctx.fillStyle = tint(base, 0.10);
  roundRect(ctx, c.x + 0.8, c.y + c.h - 3.4, c.w - 1.6, 2.6, 1.2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,236,200,0.22)';
  ctx.fillRect(c.x + 1.6, c.y + 0.8, c.w - 3.2, 0.9);

  // The seam between two desks pushed together, which is how a classroom is
  // actually laid out and what stops a pair reading as one slab.
  if (c.w >= c.h) {
    ctx.fillStyle = 'rgba(88,54,20,0.55)';
    ctx.fillRect(c.x + c.w / 2 - 0.6, c.y + 2, 1.2, c.h - 6);
    ctx.fillStyle = 'rgba(255,236,200,0.16)';
    ctx.fillRect(c.x + c.w / 2 + 0.6, c.y + 2, 0.6, c.h - 6);
  }

  // What is on the desk. Deterministic from where the desk stands, so the same
  // one carries the same clutter every time the level is drawn — and varied,
  // because a classroom where every desk has the same sheet of paper squared up
  // on it is a classroom nobody has ever sat in.
  //
  // A worksheet lying at a slight angle, an exercise book, and a pencil beside
  // one of them. Section 1's school supplies, and they are on the desk tops
  // because from directly above that is the only surface there is.
  const r = hash(c.x + 11, c.y + 5);
  const lean = (hash(c.x + 3, c.y + 7) - 0.5) * 0.5;
  if (r > 0.18) {
    const px = c.x + 4 + hash(c.x, c.y + 1) * 3;
    const py = c.y + c.h * 0.28 + hash(c.x + 5, c.y) * 3;
    ctx.save();
    ctx.translate(px + 4.5, py + 3.5);
    ctx.rotate(lean);
    ctx.fillStyle = 'rgba(60,38,14,0.30)';
    roundRect(ctx, -3.7, -2.5, 9, 7, 1);
    ctx.fill();
    fillRound(ctx, -4.5, -3.5, 9, 7, 1, PALETTE.paper);
    ctx.fillStyle = 'rgba(90,80,70,0.40)';
    ctx.fillRect(-3, -1.5, 6, 1);
    ctx.fillRect(-3, 0.5, 4, 1);
    ctx.restore();
  }
  if (r > 0.55 && c.w > 26) {
    // An exercise book, shut, with its cover and a sliver of pages showing.
    const spines = ['#c2543f', '#3f7f88', '#6f5a94', '#3f7f4e'];
    const bx = c.x + c.w - 15;
    const by = c.y + c.h * 0.32;
    ctx.save();
    ctx.translate(bx + 4.5, by + 3);
    ctx.rotate(-lean * 0.7);
    ctx.fillStyle = 'rgba(60,38,14,0.30)';
    roundRect(ctx, -3.7, -2, 9, 6, 1);
    ctx.fill();
    fillRound(ctx, -4.5, -3, 9, 6, 1, spines[Math.floor(r * 4) % 4]);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(-4.5, -3, 9, 1.2);
    ctx.fillStyle = '#efe7d6';                       // the page edges
    ctx.fillRect(4, -2.4, 1.1, 4.8);
    ctx.restore();
  }
  if (r > 0.42) {
    // A pencil. Two fills and it is the single cheapest thing on this list that
    // says school rather than office.
    const qx = c.x + c.w * 0.52 + hash(c.x + 9, c.y + 2) * 4;
    const qy = c.y + c.h * 0.62;
    ctx.save();
    ctx.translate(qx, qy);
    ctx.rotate(lean * 1.6 + 0.4);
    ctx.fillStyle = '#e0a83c';
    ctx.fillRect(-4.5, -0.55, 9, 1.1);
    ctx.fillStyle = '#4a3a2a';
    ctx.fillRect(4.1, -0.55, 1.4, 1.1);
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.fillRect(-4.5, -0.55, 9, 0.4);
    ctx.restore();
  }

  // Chairs, tucked under the near edge. Drawn rather than placed: a chair is
  // not something you collide with in a game where you walk over the floor of
  // a classroom, and putting one in the tile grid would cost a tile each and
  // wall the room in. Two to a desk, which is what a paired desk means.
  const seats = c.w >= 34 ? 2 : 1;
  for (let i = 0; i < seats; i++) {
    const cx = c.x + c.w * ((i + 0.5) / seats);
    ctx.fillStyle = 'rgba(16,22,20,0.24)';
    roundRect(ctx, cx - 7, c.y + c.h + 2, 14, 8, 3);
    ctx.fill();
    fillRound(ctx, cx - 7, c.y + c.h - 1, 14, 9, 3, '#8a5a30');
    const seat = ctx.createLinearGradient(0, c.y + c.h - 1, 0, c.y + c.h + 8);
    seat.addColorStop(0, '#b07c46');
    seat.addColorStop(1, '#8a5a30');
    ctx.fillStyle = seat;
    roundRect(ctx, cx - 6, c.y + c.h, 12, 5, 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,236,200,0.20)';
    ctx.fillRect(cx - 5, c.y + c.h + 0.4, 10, 0.8);
  }
}

// A corridor bench, in the same wood. Slatted, on steel legs, with the gap
// between the slats actually reading as a gap.
function drawBench(ctx, c) {
  const along = c.w >= c.h;
  groundShadow(ctx, c, 8, 0.32);
  const base = '#a97644';
  fillRound(ctx, c.x, c.y, c.w, c.h, 3, '#6d4a2a');
  const slats = 3;
  for (let i = 0; i < slats; i++) {
    const t = i / slats;
    const g = ctx.createLinearGradient(
      along ? 0 : c.x + c.w * t, along ? c.y + c.h * t : 0,
      along ? 0 : c.x + c.w * (t + 1 / slats), along ? c.y + c.h * (t + 1 / slats) : 0);
    g.addColorStop(0, tint(base, 0.22));
    g.addColorStop(1, tint(base, -0.10));
    ctx.fillStyle = g;
    if (along) {
      ctx.fillRect(c.x + 1.5, c.y + 1.5 + t * (c.h - 3), c.w - 3, (c.h - 3) / slats - 1.1);
    } else {
      ctx.fillRect(c.x + 1.5 + t * (c.w - 3), c.y + 1.5, (c.w - 3) / slats - 1.1, c.h - 3);
    }
  }
  // Steel legs at the ends, and the shadow they cast under the seat.
  ctx.fillStyle = '#4a5259';
  if (along) {
    ctx.fillRect(c.x + 3, c.y + c.h - 2, 5, 4);
    ctx.fillRect(c.x + c.w - 8, c.y + c.h - 2, 5, 4);
  } else {
    ctx.fillRect(c.x + c.w - 2, c.y + 3, 4, 5);
    ctx.fillRect(c.x + c.w - 2, c.y + c.h - 8, 4, 5);
  }
}

// One row of locker doors along one face of a bank.
//
// Split out because a bank has either one row or two. Bolted to a wall it shows
// the room a single face; standing as an island down the middle of a corridor
// it is two banks back to back and shows a face each way, and drawing the
// second as though it were the first gives it a blank steel panel facing an
// aisle people walk down.
//
// `a0/a1` are the run along the bank, `d0/d1` the strip of depth this row gets,
// and `flip` says which side of that strip the doors open towards — which is
// where the handles go and which way the seam highlights fall.
function lockerDoors(ctx, c, along, a0, a1, d0, d1, flip, seed0) {
  const deep = d1 - d0;
  if (deep < 2.5) return;
  const span = a1 - a0;
  const doors = Math.max(1, Math.round(span / 20));
  const pitch = span / doors;
  // A shallow row — the two faces of an island splitting one tile between them
  // — has no room for louvres, and three hairlines crammed into four units
  // read as noise rather than as vents.
  const vents = deep > 7 ? 3 : deep > 4.5 ? 2 : 0;
  for (let i = 0; i < doors; i++) {
    const a = a0 + i * pitch;
    const len = pitch;
    if (len <= 3) continue;
    const seed = Math.round(seed0 + i * 37);
    const face = tint('#577983', shade(seed, i * 11, 0.10));
    // Brushed across the door, lightest a third of the way in, which is where
    // a steel pressing catches a strip light.
    const g = along
      ? ctx.createLinearGradient(0, d0, 0, d1)
      : ctx.createLinearGradient(d0, 0, d1, 0);
    g.addColorStop(0, tint(face, flip ? -0.24 : 0.22));
    g.addColorStop(0.34, face);
    g.addColorStop(1, tint(face, flip ? 0.22 : -0.24));
    ctx.fillStyle = g;
    if (along) roundRect(ctx, a + 1.2, d0, len - 2.4, deep, 1.4);
    else roundRect(ctx, d0, a + 1.2, deep, len - 2.4, 1.4);
    ctx.fill();
    // Louvres, pressed into the door nearest its hinge.
    for (let v = 0; v < vents; v++) {
      const t = d0 + (flip ? deep - 1.8 - v * 1.9 : 1.8 + v * 1.9);
      ctx.fillStyle = 'rgba(16,26,30,0.40)';
      ctx.fillStyle = 'rgba(16,26,30,0.40)';
      if (along) ctx.fillRect(a + 3.4, t, Math.max(1, len - 6.8), 0.9);
      else ctx.fillRect(t, a + 3.4, 0.9, Math.max(1, len - 6.8));
      ctx.fillStyle = 'rgba(226,240,244,0.12)';
      if (along) ctx.fillRect(a + 3.4, t + 0.9, Math.max(1, len - 6.8), 0.4);
      else ctx.fillRect(t + 0.9, a + 3.4, 0.4, Math.max(1, len - 6.8));
    }
    // The handle: a recessed latch plate with a lever across it, on the edge
    // the door swings from.
    const hd = d0 + deep * 0.52;
    const ha = a + len - 5.2;
    ctx.fillStyle = 'rgba(10,16,20,0.55)';
    if (along) roundRect(ctx, ha - 0.6, hd - 2.6, 3.4, Math.min(5.2, deep * 0.8), 1);
    else roundRect(ctx, hd - 2.6, ha - 0.6, Math.min(5.2, deep * 0.8), 3.4, 1);
    ctx.fill();
    ctx.fillStyle = '#c9d8dc';
    if (along) ctx.fillRect(ha + 0.3, hd - 1.6, 1.5, Math.min(3.2, deep * 0.5));
    else ctx.fillRect(hd - 1.6, ha + 0.3, Math.min(3.2, deep * 0.5), 1.5);
    // A number plate on some of them: what says school rather than changing room.
    if (hash(seed, 3) > 0.45 && len > 13 && deep > 6) {
      ctx.fillStyle = 'rgba(232,240,238,0.30)';
      const nd = flip ? d0 + 1 : d1 - 2.6;
      if (along) ctx.fillRect(a + 3.6, nd, 4.2, 1.6);
      else ctx.fillRect(nd, a + 3.6, 1.6, 4.2);
    }
    // The gap to the next door: dark, with the lit edge of the next pressing
    // beside it.
    if (i < doors - 1) {
      ctx.fillStyle = 'rgba(14,22,26,0.48)';
      if (along) ctx.fillRect(a + len - 1.2, d0, 1.2, deep);
      else ctx.fillRect(d0, a + len - 1.2, deep, 1.2);
      ctx.fillStyle = 'rgba(210,230,236,0.20)';
      if (along) ctx.fillRect(a + len, d0, 0.7, deep);
      else ctx.fillRect(d0, a + len, deep, 0.7);
    }
  }
}

// A bank of school lockers, in steel.
//
// What makes it metal is that no face is one colour: the carcass runs from a
// lit top edge down to a dark foot, each door carries a brushed gradient across
// it, and the seam between two doors is a dark line with a lit one beside it,
// because that is what a folded steel edge does to a corridor light. Every door
// gets its own shade off `hash`, so a nine-tile bank is nine lockers sprayed in
// the same batch rather than one long box.
//
// `c.back` says which face is against the building, and the two layouts follow
// from it. Against a wall: a top rail on the closed side, one row of doors, a
// plinth at the foot. An island in a corridor: a row of doors each way with the
// crest of the unit running down the middle between them.
function drawLockers(ctx, c) {
  const along = c.w >= c.h;
  const island = !c.back;
  // An island is walked round, so it is grounded all the way round; a bank
  // bolted to a wall only casts where it meets open floor.
  groundShadow(ctx, c, along ? 8 : 6, 0.38, island);

  // The carcass, running from the lit edge to the dark foot.
  const lo = along ? c.y : c.x;
  const hi = along ? c.y + c.h : c.x + c.w;
  const body = along
    ? ctx.createLinearGradient(0, lo, 0, hi)
    : ctx.createLinearGradient(lo, 0, hi, 0);
  if (island) {
    // Two units back to back: dark at both open faces, lit along the crest.
    body.addColorStop(0, '#33484f');
    body.addColorStop(0.5, '#6f929b');
    body.addColorStop(1, '#33484f');
  } else if (c.back === 'n' || c.back === 'w') {
    body.addColorStop(0, '#6f929b');
    body.addColorStop(0.22, '#4d6f78');
    body.addColorStop(1, '#33484f');
  } else {
    body.addColorStop(0, '#33484f');
    body.addColorStop(0.78, '#4d6f78');
    body.addColorStop(1, '#6f929b');
  }
  ctx.fillStyle = body;
  roundRect(ctx, c.x, c.y, c.w, c.h, 2.5);
  ctx.fill();

  const a0 = along ? c.x : c.y;
  const a1 = along ? c.x + c.w : c.y + c.h;
  const depth = hi - lo;
  const seed0 = Math.round(c.x + c.y);
  const rail = (d0, d1, dark) => {
    const g = along
      ? ctx.createLinearGradient(0, d0, 0, d1)
      : ctx.createLinearGradient(d0, 0, d1, 0);
    g.addColorStop(0, dark ? '#2a3d43' : '#66888f');
    g.addColorStop(1, dark ? '#1f2f34' : '#46666f');
    ctx.fillStyle = g;
    if (along) ctx.fillRect(c.x, d0, c.w, d1 - d0);
    else ctx.fillRect(d0, c.y, d1 - d0, c.h);
  };

  if (island) {
    // Toe strip, doors, crest, doors, toe strip.
    const toe = 1.6;
    const half = depth / 2;
    lockerDoors(ctx, c, along, a0, a1, lo + toe, lo + half - 1.1, false, seed0);
    lockerDoors(ctx, c, along, a0, a1, lo + half + 1.1, hi - toe, true, seed0 + 500);
    // The crest: the top of the unit, catching the light along its whole run.
    ctx.fillStyle = '#86a9b2';
    if (along) ctx.fillRect(c.x, lo + half - 1.1, c.w, 2.2);
    else ctx.fillRect(lo + half - 1.1, c.y, 2.2, c.h);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    if (along) ctx.fillRect(c.x, lo + half - 1.1, c.w, 0.8);
    else ctx.fillRect(lo + half - 1.1, c.y, 0.8, c.h);
  } else {
    const backTop = c.back === 'n' || c.back === 'w';
    const railD0 = backTop ? lo + 0.6 : hi - 4.2;
    rail(railD0, railD0 + 3.6, false);
    const plinthD0 = backTop ? hi - 4.2 : lo;
    rail(plinthD0, plinthD0 + 4.2, true);
    lockerDoors(ctx, c, along,
      a0, a1,
      backTop ? lo + 4.2 : lo + 4.2,
      backTop ? hi - 4.2 : hi - 4.2,
      !backTop, seed0);
    ctx.fillStyle = 'rgba(180,206,214,0.16)';
    if (along) ctx.fillRect(c.x, plinthD0, c.w, 0.8);
    else ctx.fillRect(plinthD0, c.y, 0.8, c.h);
  }
}

// A bank of lockers, installed against a wall rather than parked in front of
// one.
//
// The difference is mostly in what happens at the edges. A slab with a drop
// shadow all round it floats; a cabinet has a plinth it stands on, a top rail
// that catches the corridor light, a shadow only where its front face meets the
// floor, and a hairline of daylight down each door seam. None of that is
// expensive and all of it is the difference between furniture and a rectangle.
// A school desk. The shared table painter scatters whatever a table in a house
// might have on it — a pot plant, a mug, a vase — and a classroom full of pot
// plants growing out of the desks is the sort of thing you only notice once you
// look at the whole map at once. What sits on a school desk is paper.
// --- outdoors ----------------------------------------------------------------
// A tree from above is a ring of canopy over a dark trunk shadow. Three fills
// and a scatter of leaf clumps: no strokes, because the grounds of a level five
// can hold thirty of these and a stroke is the expensive part.
function drawTree(ctx, c) {
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;
  const r = Math.min(c.w, c.h) * 0.52;
  ctx.fillStyle = 'rgba(30,44,26,0.34)';
  ctx.beginPath();
  ctx.arc(cx + 4, cy + 7, r, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#3f6236';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#4e7a41';
  for (let i = 0; i < 5; i++) {
    const a = i * 1.257 + (c.x % 7) * 0.2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r * 0.42, cy + Math.sin(a) * r * 0.42, r * 0.40, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = '#5f9150';
  ctx.beginPath();
  ctx.arc(cx - r * 0.20, cy - r * 0.24, r * 0.36, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#2b3f24';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.16, 0, TAU);
  ctx.fill();
}

// A hedge or a bank of shrubs: a soft-cornered slab with clumps along its top,
// so a run of them reads as planting rather than as a green wall.
function drawHedge(ctx, c) {
  ctx.fillStyle = 'rgba(30,44,26,0.30)';
  roundRect(ctx, c.x + 3, c.y + 6, c.w, c.h, 7);
  ctx.fill();
  fillRound(ctx, c.x, c.y, c.w, c.h, 7, '#3a5c32');
  fillRound(ctx, c.x + 2, c.y + 2, c.w - 4, c.h * 0.42, 5, '#4a7340');
  ctx.fillStyle = '#57874a';
  const step = 11;
  for (let x = c.x + 6; x < c.x + c.w - 3; x += step) {
    ctx.beginPath();
    ctx.arc(x, c.y + c.h * 0.30, 4.2, 0, TAU);
    ctx.fill();
  }
}

const SCHOOL_PAINTERS = { sofa: drawBench, chest: drawLockers, table: drawDesk };

// An outbuilding: brick, a shallow pitched roof, a door on the long side. Small
// enough to be a store and solid enough to hide behind, which is what the ones
// at the edge of a playground are for.
function drawShed(ctx, c) {
  drop(ctx, c);
  fillRound(ctx, c.x, c.y, c.w, c.h, 3, '#7a5140');           // brick
  ctx.fillStyle = 'rgba(40,24,18,0.22)';                      // courses
  for (let y = c.y + 4; y < c.y + c.h - 2; y += 4) {
    ctx.fillRect(c.x + 2, y, c.w - 4, 1);
  }
  const along = c.w >= c.h;
  // The roof, overhanging the front. One slab lighter than the walls, with a
  // ridge down the middle: from above that is the whole of a pitched roof.
  fillRound(ctx, c.x + 1, c.y + 1, c.w - 2, c.h - 2, 2.5, '#8d6250');
  ctx.fillStyle = 'rgba(255,235,215,0.16)';
  if (along) ctx.fillRect(c.x + 2, c.y + 2, c.w - 4, Math.max(1, c.h * 0.34));
  else ctx.fillRect(c.x + 2, c.y + 2, Math.max(1, c.w * 0.34), c.h - 4);
  ctx.fillStyle = 'rgba(40,24,18,0.40)';
  if (along) ctx.fillRect(c.x + 2, c.y + c.h / 2 - 0.5, c.w - 4, 1.2);
  else ctx.fillRect(c.x + c.w / 2 - 0.5, c.y + 2, 1.2, c.h - 4);
  // The door, on the side facing into the yard.
  ctx.fillStyle = '#4a3a2c';
  if (along) fillRound(ctx, c.x + c.w * 0.5 - 4, c.y + c.h - 4, 8, 4, 1, '#4a3a2c');
  else fillRound(ctx, c.x + c.w - 4, c.y + c.h * 0.5 - 4, 4, 8, 1, '#4a3a2c');
}

const OUTDOOR_PAINTERS = {
  shed: drawShed, tree: drawTree, hedge: drawHedge };

const FURNITURE_PAINTERS = {
  table: drawTable,
  sofa: drawSofa,
  wardrobe: drawWardrobe,
  nightstand: drawNightstand,
  tvBench: drawTvBench,
  chest: drawChest,
  bookshelf: drawBookshelf,
  plinth: drawPlinth
};

export function drawFurniture(ctx, c) {
  const style = furnitureStyle(c);
  // Outdoors first: a tree is a tree whatever building it is standing beside.
  const paint = OUTDOOR_PAINTERS[style]
    || (c.theme === 'school' && SCHOOL_PAINTERS[style]) || FURNITURE_PAINTERS[style];
  paint(ctx, c);
}

// ---------------------------------------------------------------- room
const WINDOWS = { A: 'left', B: 'right', C: 'left' };

function drawFloor(ctx) {
  ctx.fillStyle = T.floor;
  ctx.fillRect(WT, WT, W - WT * 2, H - WT * 2);

  const plank = 32;
  for (let y = WT, row = 0; y < H - WT; y += plank, row++) {
    const height = Math.min(plank, H - WT - y);
    if (row % 2 === 1) {
      ctx.fillStyle = T.alt;
      ctx.fillRect(WT, y, W - WT * 2, height);
    }
    ctx.strokeStyle = T.seam;
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

    ctx.strokeStyle = T.grain;                     // grain
    ctx.beginPath();
    ctx.moveTo(WT, y + plank * 0.45);
    ctx.lineTo(W - WT, y + plank * 0.45);
    ctx.moveTo(WT, y + plank * 0.78);
    ctx.lineTo(W - WT, y + plank * 0.78);
    ctx.stroke();
  }
}

function drawWalls(ctx) {
  ctx.fillStyle = T.wall;
  ctx.fillRect(0, 0, W, WT);
  ctx.fillRect(0, 0, WT, H);
  ctx.fillRect(W - WT, 0, WT, H);
  ctx.fillRect(0, H - WT, W, WT);

  ctx.fillStyle = T.lip;
  ctx.fillRect(0, 0, W, 4);
  ctx.fillStyle = T.shade;                          // shaded inner edge
  ctx.fillRect(WT - 3, WT, 3, H - WT * 2);
  ctx.fillRect(W - WT, WT, 3, H - WT * 2);

  ctx.fillStyle = T.skirt;                          // skirting board
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
  beam.addColorStop(0, `rgba(${T.light},0.34)`);
  beam.addColorStop(0.55, `rgba(${T.light},0.15)`);
  beam.addColorStop(1, `rgba(${T.light},0)`);
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
  pool.addColorStop(0, `rgba(${T.light},0.28)`);
  pool.addColorStop(1, `rgba(${T.light},0)`);
  ctx.fillStyle = pool;
  ctx.fillRect(WT, WT, W - WT * 2, H - WT * 2);

  // Plants on the sill itself — centred on the wall band, so they read as
  // standing on the window ledge rather than on the floor, where they would
  // imply a collider that does not exist.
  const sillX = side === 'left' ? WT / 2 : W - WT / 2;
  drawPlant(ctx, sillX, top + 12, 0.62);
  drawPlant(ctx, sillX, top + height - 6, 0.52);
}

function drawRug(ctx, r) {
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

  // A warm pool under the bed: it is the most important object in the room and
  // should read that way without darkening anything else.
  const pool = ctx.createRadialGradient(
    bed.x + bed.w / 2, bed.y + bed.h / 2, 10,
    bed.x + bed.w / 2, bed.y + bed.h / 2, bed.w * 0.95
  );
  pool.addColorStop(0, 'rgba(255,236,196,0.22)');
  pool.addColorStop(1, 'rgba(255,236,196,0)');
  ctx.fillStyle = pool;
  ctx.fillRect(bed.x - bed.w, bed.y - bed.h, bed.w * 3, bed.h * 3);

  drop(ctx, bed);

  // Frame: a dark base with a lit rail, and posts at the corners.
  fillRound(ctx, bed.x, bed.y, bed.w, bed.h, 9, PALETTE.bedFrameDark);
  fillRound(ctx, bed.x, bed.y, bed.w, bed.h - 8, 9, PALETTE.bedFrame);
  for (const px of [bed.x + 3, bed.x + bed.w - 11]) {
    fillRound(ctx, px, bed.y + bed.h - 13, 8, 11, 3, PALETTE.woods[2].dark);
    fillRound(ctx, px, bed.y + bed.h - 13, 8, 6, 3, PALETTE.woods[2].top);
  }

  // Headboard with slats.
  fillRound(ctx, bed.x + 2, bed.y - 7, bed.w - 4, 17, 6, PALETTE.bedFrameDark);
  fillRound(ctx, bed.x + 4, bed.y - 6, bed.w - 8, 13, 5, PALETTE.bedFrame);
  ctx.strokeStyle = 'rgba(60,32,14,0.35)';
  ctx.lineWidth = 1.4;
  for (let i = 1; i < 4; i++) {
    const sx = bed.x + (bed.w / 4) * i;
    ctx.beginPath();
    ctx.moveTo(sx, bed.y - 4);
    ctx.lineTo(sx, bed.y + 5);
    ctx.stroke();
  }

  // Mattress with a fitted-sheet edge.
  fillRound(ctx, bed.x + 5, bed.y + 9, bed.w - 10, bed.h - 22, 7, '#e6ddcd');
  fillRound(ctx, bed.x + 7, bed.y + 10, bed.w - 14, bed.h - 25, 6, PALETTE.mattress);
  // Mattress buttons, so it reads as something soft rather than a slab.
  ctx.fillStyle = 'rgba(198,186,166,0.55)';
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      ctx.beginPath();
      ctx.arc(bed.x + bed.w * (0.28 + i * 0.22), bed.y + 22 + j * 22, 1.4, 0, TAU);
      ctx.fill();
    }
  }
}

// Old boards that announce you. Drawn as a worn patch with nail heads — the
// player should be able to see the hazard before stepping on it.
// What is lying on the floor there. Small, low-contrast and deterministic from
// its own position, so the same sheet of paper is the same sheet every time and
// none of it competes with the loot for attention — it has to be noticeable
// enough to route around and quiet enough not to look like something to take.
const UNDERFOOT_PAINTERS = {
  paper: (ctx, z) => {
    const n = 2 + Math.floor(hash(z.x, z.y) * 2);
    for (let i = 0; i < n; i++) {
      const h = hash(z.x + i * 13, z.y - i * 7);
      const w = 7 + h * 4;
      ctx.save();
      ctx.translate(z.x + z.w / 2 + (h - 0.5) * 9, z.y + z.h / 2 + (hash(z.y, z.x + i) - 0.5) * 9);
      ctx.rotate((h - 0.5) * 1.5);
      ctx.fillStyle = 'rgba(16,14,20,0.22)';
      ctx.fillRect(-w / 2 + 1, -w / 2 + 1.5, w, w * 0.78);
      ctx.fillStyle = 'rgba(238,236,228,0.88)';
      ctx.fillRect(-w / 2, -w / 2, w, w * 0.78);
      ctx.fillStyle = 'rgba(120,126,138,0.5)';
      for (let r = 0; r < 2; r++) ctx.fillRect(-w / 2 + 1.5, -w / 2 + 2 + r * 2.4, w - 3, 0.8);
      ctx.restore();
    }
  },
  plastic: (ctx, z) => {
    // A crisp packet: crumpled, so a few facets rather than a rectangle.
    const cx = z.x + z.w / 2;
    const cy = z.y + z.h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((hash(z.x, z.y) - 0.5) * 2);
    ctx.fillStyle = 'rgba(16,14,20,0.22)';
    ctx.beginPath();
    ctx.moveTo(-5, 2); ctx.lineTo(0, -3); ctx.lineTo(6, 1); ctx.lineTo(2, 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(196,84,72,0.82)';
    ctx.beginPath();
    ctx.moveTo(-6, 1); ctx.lineTo(-1, -4); ctx.lineTo(5, 0); ctx.lineTo(1, 5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,236,200,0.45)';
    ctx.beginPath();
    ctx.moveTo(-3, 0); ctx.lineTo(-1, -3); ctx.lineTo(2, -1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  },
  clutter: (ctx, z) => {
    // Pencils and a rubber. Nothing you would notice from across the room and
    // everything you would notice from on top of.
    const cx = z.x + z.w / 2;
    const cy = z.y + z.h / 2;
    const inks = ['#d8b24a', '#4f7fbf', '#c4574f'];
    for (let i = 0; i < 3; i++) {
      const h = hash(z.x + i * 31, z.y + i * 17);
      ctx.save();
      ctx.translate(cx + (h - 0.5) * 10, cy + (hash(z.y + i, z.x) - 0.5) * 8);
      ctx.rotate(h * Math.PI);
      ctx.fillStyle = 'rgba(16,14,20,0.20)';
      ctx.fillRect(-4.5, -0.6, 9, 2.2);
      ctx.fillStyle = inks[i % inks.length];
      ctx.fillRect(-5, -1, 10, 2);
      ctx.fillStyle = '#e8d8b8';
      ctx.fillRect(4, -1, 1.6, 2);
      ctx.restore();
    }
  },
  bag: (ctx, z) => {
    // A backpack, dumped. Big enough to read as an obstacle from a distance,
    // which is the point — it is the expensive one.
    const cx = z.x + z.w / 2;
    const cy = z.y + z.h / 2;
    const tone = ['#3f5a8a', '#6b4a7a', '#3f6a58'][Math.floor(hash(z.x, z.y) * 3) % 3];
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((hash(z.y, z.x) - 0.5) * 1.1);
    ctx.fillStyle = SHADOW;
    roundRect(ctx, -7, -4, 15, 12, 4);
    ctx.fill();
    fillRound(ctx, -8, -6, 15, 12, 4, tone);
    fillRound(ctx, -6, -4, 11, 5, 3, 'rgba(255,255,255,0.14)');
    ctx.strokeStyle = 'rgba(12,14,22,0.5)';                    // straps
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-4, -6); ctx.quadraticCurveTo(-6, 0, -3, 6);
    ctx.moveTo(2, -6); ctx.quadraticCurveTo(4, 0, 1, 6);
    ctx.stroke();
    ctx.fillStyle = 'rgba(232,214,168,0.75)';                  // a buckle
    ctx.fillRect(-2, 1, 4, 2);
    ctx.restore();
  }
};

export function drawCreakZone(ctx, zone) {
  const paint = UNDERFOOT_PAINTERS[zone.kind];
  if (paint) {
    paint(ctx, zone);
    return;
  }
  ctx.save();
  ctx.globalAlpha = 0.5;
  fillRound(ctx, zone.x, zone.y, zone.w, zone.h, 3, 'rgba(60,34,16,0.42)');
  ctx.globalAlpha = 0.75;
  ctx.strokeStyle = 'rgba(40,22,10,0.6)';
  ctx.lineWidth = 1.4;
  const boards = Math.max(2, Math.round(zone.h / 14));
  for (let i = 1; i < boards; i++) {
    const y = zone.y + (zone.h / boards) * i;
    ctx.beginPath();
    ctx.moveTo(zone.x + 2, y);
    ctx.lineTo(zone.x + zone.w - 2, y);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(228,206,168,0.55)';                  // nail heads
  for (let i = 0; i < boards; i++) {
    const y = zone.y + (zone.h / boards) * (i + 0.5);
    for (const x of [zone.x + 5, zone.x + zone.w - 5]) {
      ctx.beginPath();
      ctx.arc(x, y, 1.3, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

// An interior wall: same material as the room's shell, with a lit top edge and
// a soft shadow so it reads as standing up out of the floor.
function drawPartition(ctx, c) {
  wallFoot(ctx, c);
  const g = c.w > c.h
    ? ctx.createLinearGradient(0, c.y, 0, c.y + c.h)
    : ctx.createLinearGradient(c.x, 0, c.x + c.w, 0);
  g.addColorStop(0, T.lip);
  g.addColorStop(0.34, T.wall);
  g.addColorStop(1, T.shade);
  ctx.fillStyle = g;
  roundRect(ctx, c.x, c.y, c.w, c.h, 3);
  ctx.fill();
  ctx.fillStyle = T.skirt;                                 // skirting, both faces
  if (c.w > c.h) {
    ctx.fillRect(c.x, c.y + c.h - 2.5, c.w, 2.5);
    ctx.fillRect(c.x, c.y, c.w, 2);
  } else {
    ctx.fillRect(c.x, c.y, 2, c.h);
    ctx.fillRect(c.x + c.w - 2, c.y, 2, c.h);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  if (c.w > c.h) ctx.fillRect(c.x, c.y + c.h - 2.5, c.w, 0.8);
  else ctx.fillRect(c.x + c.w - 2, c.y, 0.8, c.h);
}

// A doorway: a threshold board across the opening and a jamb at each side. In
// the reference floorplans this is what makes a gap read as a way through
// rather than as a hole where a wall should be.
// Everything that never moves, drawn once per level into an offscreen canvas.
// A wall slab on a hand-drawn map. The building's shape comes from the grid
// rather than from a fixed rectangle round the edge, so each run of wall is
// drawn as its own block: a dark base, a lit top edge, and skirting down the
// faces that look into a room.
// The same wall with height in it.
//
// A wall seen from above is a band, and a band of one colour is a line on a
// plan. What makes it a wall is that the top of it catches the light, the face
// below it falls away, there is a skirting board where it meets the floor, and
// the floor darkens for a few units out from that. All four are here.
function drawWallSlab(ctx, c) {
  wallFoot(ctx, c);
  const g = ctx.createLinearGradient(0, c.y, 0, c.y + c.h);
  g.addColorStop(0, T.lip);
  g.addColorStop(0.30, T.wall);
  g.addColorStop(1, T.shade);
  ctx.fillStyle = g;
  roundRect(ctx, c.x, c.y, c.w, c.h, 2);
  ctx.fill();
  // The rendered coat: fine vertical breaks so a long run is not one flat
  // sweep of paint.
  ctx.fillStyle = 'rgba(255,255,255,0.030)';
  for (let x = Math.floor(c.x / 26) * 26; x < c.x + c.w; x += 26) {
    if (x >= c.x) ctx.fillRect(x, c.y + 1, 1, c.h - 2);
  }
  // The lit cap along the top edge...
  ctx.fillStyle = tint(T.lip, 0.16);
  ctx.fillRect(c.x, c.y, c.w, 1.6);
  // ...and the skirting, with its own highlight, at the bottom.
  ctx.fillStyle = T.skirt;
  ctx.fillRect(c.x, c.y + c.h - 3, c.w, 3);
  ctx.fillStyle = 'rgba(255,255,255,0.20)';
  ctx.fillRect(c.x, c.y + c.h - 3, c.w, 0.9);
}

// A fence: posts and two rails, drawn along whichever way the run goes. It
// stops you like a wall and it has to read as something you can see over, or
// the grounds stop being grounds and become another room.
function drawFence(ctx, c) {
  const along = c.w >= c.h;
  const len = along ? c.w : c.h;
  ctx.fillStyle = 'rgba(24,20,16,0.30)';
  if (along) ctx.fillRect(c.x, c.y + c.h - 3, c.w, 4);
  else ctx.fillRect(c.x + c.w - 3, c.y, 4, c.h);
  // Two rails.
  ctx.fillStyle = '#6d5b45';
  for (const t of [0.28, 0.66]) {
    if (along) ctx.fillRect(c.x, Math.round(c.y + c.h * t), c.w, 3);
    else ctx.fillRect(Math.round(c.x + c.w * t), c.y, 3, c.h);
  }
  // ...and a post every tile and a bit.
  ctx.fillStyle = '#5a4a37';
  for (let d = 4; d < len - 2; d += 24) {
    if (along) ctx.fillRect(Math.round(c.x + d), c.y + 1, 4, c.h - 2);
    else ctx.fillRect(c.x + 1, Math.round(c.y + d), c.w - 2, 4);
  }
  ctx.fillStyle = 'rgba(255,236,200,0.16)';
  for (let d = 4; d < len - 2; d += 24) {
    if (along) ctx.fillRect(Math.round(c.x + d), c.y + 1, 4, 2);
    else ctx.fillRect(c.x + 1, Math.round(c.y + d), 2, 4);
  }
}

// A school window: a frame with a sill, glass with a sky in it, and a transom.
//
// The flat pale-blue rectangle it replaces was the one place in the building
// that gave nothing back. Glass at night is the darkest thing on the wall with
// the brightest edge — a cold sky through it, a highlight running diagonally
// across the pane, and a painted timber frame round the lot. The moonlight it
// spills on the floor is unchanged; that part always worked.
function drawWindowPane(ctx, c) {
  const vertical = c.h > c.w;
  // The frame, and the sill under it on the inward face.
  fillRound(ctx, c.x, c.y, c.w, c.h, 2, T.shade);
  ctx.fillStyle = T.skirt;
  if (vertical) ctx.fillRect(c.x + c.w - 2.4, c.y, 2.4, c.h);
  else ctx.fillRect(c.x, c.y + c.h - 2.4, c.w, 2.4);

  // The glass. Dark at the top where it looks at the sky, lighter towards the
  // sill where the room's own light comes back off it.
  const g = vertical
    ? ctx.createLinearGradient(c.x, 0, c.x + c.w, 0)
    : ctx.createLinearGradient(0, c.y, 0, c.y + c.h);
  g.addColorStop(0, '#2c4560');
  g.addColorStop(0.55, '#41637f');
  g.addColorStop(1, '#7f9db4');
  ctx.fillStyle = g;
  roundRect(ctx, c.x + 2, c.y + 2, c.w - 4, c.h - 4.4, 1.2);
  ctx.fill();

  // The streak of sky across it. Clipped to the pane, at a slant, which is
  // what says glass rather than slate.
  ctx.save();
  ctx.beginPath();
  ctx.rect(c.x + 2, c.y + 2, c.w - 4, c.h - 4.4);
  ctx.clip();
  ctx.fillStyle = 'rgba(206,230,255,0.20)';
  const len = vertical ? c.h : c.w;
  for (let d = -len; d < len * 2; d += 26) {
    ctx.save();
    ctx.translate(c.x + (vertical ? 0 : d), c.y + (vertical ? d : 0));
    ctx.rotate(-0.5);
    ctx.fillRect(0, 0, vertical ? c.w * 2 : 5, vertical ? 5 : c.h * 2);
    ctx.restore();
  }
  ctx.restore();

  // Glazing bars, and the transom across the middle of the run.
  ctx.strokeStyle = 'rgba(232,240,248,0.42)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  const bars = Math.max(1, Math.round((vertical ? c.h : c.w) / 34));
  for (let i = 1; i < bars; i++) {
    if (vertical) {
      const y = c.y + (c.h / bars) * i;
      ctx.moveTo(c.x + 1, y);
      ctx.lineTo(c.x + c.w - 1, y);
    } else {
      const x = c.x + (c.w / bars) * i;
      ctx.moveTo(x, c.y + 1);
      ctx.lineTo(x, c.y + c.h - 1);
    }
  }
  ctx.stroke();
  // A catch on the middle bar: the one piece of ironmongery you can see from
  // here, and the reason it reads as a window that opens.
  ctx.fillStyle = '#b9c6cf';
  if (vertical) ctx.fillRect(c.x + c.w * 0.5 - 0.9, c.y + c.h * 0.5 - 2.4, 1.8, 4.8);
  else ctx.fillRect(c.x + c.w * 0.5 - 2.4, c.y + c.h * 0.5 - 0.9, 4.8, 1.8);

  // A soft pool of moonlight spilling inward.
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;
  const reach = Math.max(c.w, c.h) * 1.5 + 40;
  const pool = ctx.createRadialGradient(cx, cy, 4, cx, cy, reach);
  pool.addColorStop(0, `rgba(${T.light},0.20)`);
  pool.addColorStop(1, `rgba(${T.light},0)`);
  ctx.fillStyle = pool;
  ctx.beginPath();
  ctx.arc(cx, cy, reach, 0, TAU);
  ctx.fill();
}

// A doorway with a door in it. Same threshold and jambs as before, plus the
// two things section 12 asks for by name: a leaf you can see is a door, and a
// handle on it.
function drawDoorway(ctx, door) {
  const horizontal = door.w > door.h;
  ctx.save();
  ctx.globalAlpha = 0.85;
  fillRound(ctx, door.x, door.y, door.w, door.h, 2, T.shade);
  ctx.globalAlpha = 1;
  // Threshold board.
  fillRound(ctx, door.x + 1, door.y + 1, door.w - 2, door.h - 2, 1.5, '#8a6a44');
  ctx.strokeStyle = 'rgba(255,232,190,0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (horizontal) {
    ctx.moveTo(door.x + 3, door.y + door.h / 2);
    ctx.lineTo(door.x + door.w - 3, door.y + door.h / 2);
  } else {
    ctx.moveTo(door.x + door.w / 2, door.y + 3);
    ctx.lineTo(door.x + door.w / 2, door.y + door.h - 3);
  }
  ctx.stroke();

  // The leaf, standing open against the jamb it is hinged on — which is how
  // every internal door in a school actually is at night, and how the player
  // gets to walk through the opening the map says is open.
  const leaf = 4.2;
  const g = horizontal
    ? ctx.createLinearGradient(0, door.y, 0, door.y + leaf)
    : ctx.createLinearGradient(door.x, 0, door.x + leaf, 0);
  g.addColorStop(0, '#9d7a4e');
  g.addColorStop(1, '#6d5133');
  ctx.fillStyle = g;
  if (horizontal) ctx.fillRect(door.x + 1, door.y - leaf + 1, door.w * 0.46, leaf);
  else ctx.fillRect(door.x - leaf + 1, door.y + 1, leaf, door.h * 0.46);
  // ...and the handle on the swinging edge.
  ctx.fillStyle = '#cfd8dc';
  if (horizontal) ctx.fillRect(door.x + door.w * 0.42, door.y - leaf + 1.4, 3.4, 1.5);
  else ctx.fillRect(door.x - leaf + 1.4, door.y + door.h * 0.42, 1.5, 3.4);

  // Jambs at the open ends, so the wall reads as stopping rather than fading.
  ctx.fillStyle = T.lip;
  if (horizontal) {
    ctx.fillRect(door.x - 2, door.y, 3, door.h);
    ctx.fillRect(door.x + door.w - 1, door.y, 3, door.h);
  } else {
    ctx.fillRect(door.x, door.y - 2, door.w, 3);
    ctx.fillRect(door.x, door.y + door.h - 1, door.w, 3);
  }
  ctx.restore();
}

// A window: a lit pane in the wall, and the light it throws on the floor. On a
// floorplan these are what tell you which side of the building you are on.
// --------------------------------------------------------------- room dressing
// What a building has on its walls and floors, as opposed to what it is built
// from. None of this collides with anything and none of it is in the tile grid:
// it is a list the map carries, because only the map knows a room is a
// classroom rather than a store cupboard.
//
// All of it is painted into the room cache, which is built once per level and
// blitted a slice at a time — so the entire dressing costs nothing per frame,
// however much of it there is. That is the whole reason it can be this dense.

// Floor treatments, by what the room is for. A school is not one surface: a
// gym is sprung boards, a corridor is tile, a store room is bare concrete, and
// telling them apart at a glance is most of what makes a floorplan readable.
const FLOORS = {
  // Outdoors. Grass gets flecks rather than seams so it reads as ground rather
  // than as a floor somebody laid; paving and gravel keep their courses, which
  // is what makes a path read as a path.
  grass:    { base: '#4f7a3f', line: 'rgba(38,62,30,0.30)', pitch: 0 },
  paving:   { base: '#8d8b84', line: 'rgba(58,57,52,0.36)', pitch: 34, dir: 'grid' },
  gravel:   { base: '#8a8175', line: 'rgba(56,52,46,0.26)', pitch: 0 },
  tarmac:   { base: '#4f4e52', line: 'rgba(230,226,180,0.30)', pitch: 46, dir: 'h' },
  boards:   { base: '#a9773f', line: 'rgba(120,78,36,0.42)', pitch: 26, dir: 'h' },
  carpet:   { base: '#7e7b63', line: 'rgba(56,54,42,0.30)', pitch: 0 },
  tiles:    { base: '#8d8f86', line: 'rgba(58,60,54,0.34)', pitch: 30, dir: 'grid' },
  parquet:  { base: '#c08f4c', line: 'rgba(126,86,38,0.34)', pitch: 22, dir: 'grid' },
  concrete: { base: '#6f6a60', line: 'rgba(44,42,38,0.30)', pitch: 60, dir: 'grid' }
};

function drawFloorPatch(ctx, d) {
  const f = FLOORS[d.tag] || FLOORS.tiles;
  // The school lays its floors rather than ruling lines over a colour. Same
  // rectangles, same tags, same palette: what changes is that tile has grout
  // and a batch tone, boards have butt joints and grain, and the field is mown.
  if (d.tag === 'tiles' || d.tag === 'paving') return tileFloor(ctx, d, f.base);
  if (d.tag === 'boards') return boardFloor(ctx, d, f.base);
  if (d.tag === 'parquet') return parquetFloor(ctx, d, f.base);
  if (d.tag === 'grass') return grassFloor(ctx, d, f.base);
  if (d.tag === 'carpet') return mottleFloor(ctx, d, f.base, 'rgba(52,50,38,0.30)', 'rgba(150,146,120,0.16)');
  if (d.tag === 'concrete' || d.tag === 'gravel' || d.tag === 'tarmac') {
    return mottleFloor(ctx, d, f.base, 'rgba(34,32,28,0.26)', 'rgba(190,186,176,0.12)');
  }
  ctx.fillStyle = f.base;
  ctx.fillRect(d.x, d.y, d.w, d.h);
  if (f.pitch) {
    ctx.strokeStyle = f.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = d.y + f.pitch; y < d.y + d.h; y += f.pitch) {
      ctx.moveTo(d.x, Math.round(y) + 0.5);
      ctx.lineTo(d.x + d.w, Math.round(y) + 0.5);
    }
    if (f.dir === 'grid') {
      for (let x = d.x + f.pitch; x < d.x + d.w; x += f.pitch) {
        ctx.moveTo(Math.round(x) + 0.5, d.y);
        ctx.lineTo(Math.round(x) + 0.5, d.y + d.h);
      }
    }
    ctx.stroke();
  } else {
    // Carpet: a scatter of flecks rather than a seam, so it reads as soft.
    ctx.fillStyle = f.line;
    for (let y = d.y + 6; y < d.y + d.h; y += 11) {
      for (let x = d.x + ((y / 11) % 2 ? 9 : 3); x < d.x + d.w; x += 14) {
        ctx.fillRect(x, y, 2, 2);
      }
    }
  }
}

// The lines painted on a sports hall floor. A hall is mostly empty by design,
// and this is what stops that reading as unfinished.
function drawCourt(ctx, d) {
  ctx.save();
  ctx.strokeStyle = 'rgba(232,228,210,0.34)';
  ctx.lineWidth = 2.4;
  ctx.strokeRect(d.x + 4, d.y + 4, d.w - 8, d.h - 8);
  ctx.beginPath();
  ctx.moveTo(d.x + 4, d.y + d.h / 2);
  ctx.lineTo(d.x + d.w - 4, d.y + d.h / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(d.x + d.w / 2, d.y + d.h / 2, Math.min(d.w, d.h) * 0.18, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

// The blackboard, with the things that make it a blackboard someone teaches at.
//
// The slate, the ghost of yesterday's lesson and the tray were already here.
// What section 1 asks for is the small stuff on top: chalk in the tray, a
// duster beside it, and a wiped arc where an arm has been across the slate.
function drawBoard(ctx, d) {
  fillRound(ctx, d.x, d.y + 3, d.w, d.h + 7, 2, '#2b3a33');
  const slate = ctx.createLinearGradient(0, d.y + 5, 0, d.y + d.h + 7);
  slate.addColorStop(0, '#3a4f45');
  slate.addColorStop(1, '#2c3d35');
  ctx.fillStyle = slate;
  roundRect(ctx, d.x + 2, d.y + 5, d.w - 4, d.h + 2, 1);
  ctx.fill();
  // Yesterday's lesson, most of the way rubbed out.
  ctx.strokeStyle = 'rgba(226,232,214,0.22)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const y = d.y + 9 + i * 4;
    ctx.moveTo(d.x + 8 + (i % 2) * 6, y);
    ctx.lineTo(d.x + d.w * (0.45 + 0.16 * i), y);
  }
  ctx.stroke();
  // ...and the smear where a duster went over it.
  ctx.fillStyle = 'rgba(232,238,222,0.07)';
  ctx.beginPath();
  ctx.ellipse(d.x + d.w * 0.68, d.y + d.h * 0.6 + 6, d.w * 0.22, d.h * 0.5 + 3, -0.2, 0, TAU);
  ctx.fill();
  // The tray, and what is lying in it.
  const trayY = d.y + d.h + 8;
  fillRound(ctx, d.x + 1, trayY, d.w - 2, 3, 1, '#8a6a44');
  ctx.fillStyle = 'rgba(255,236,200,0.28)';
  ctx.fillRect(d.x + 1, trayY, d.w - 2, 0.8);
  const seed = Math.round(d.x + d.y);
  // Two or three sticks of chalk, and a duster at one end.
  for (let i = 0; i < 3; i++) {
    const t = 0.18 + i * 0.2 + hash(seed + i, i) * 0.06;
    if (t * d.w > d.w - 14) break;
    ctx.fillStyle = i === 1 ? '#f2e6c8' : '#f6f2e6';
    ctx.fillRect(d.x + t * d.w, trayY + 0.6, 5.5, 1.6);
  }
  ctx.fillStyle = '#5d6b73';
  fillRound(ctx, d.x + d.w - 12, trayY + 0.3, 8, 2.4, 0.8, '#5d6b73');
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(d.x + d.w - 12, trayY + 0.3, 8, 0.8);
}

// The noticeboard, with the sheets actually pinned to it.
//
// Cork, a frame, overlapping sheets at slight angles and a pin in each: a grid
// of neat rectangles reads as a colour swatch, and what says noticeboard is
// that nobody ever puts anything on one straight.
function drawNotice(ctx, d) {
  fillRound(ctx, d.x, d.y + 4, d.w, d.h + 6, 2, '#6b4a2e');
  const cork = ctx.createLinearGradient(0, d.y + 6, 0, d.y + d.h + 8);
  cork.addColorStop(0, '#cbac80');
  cork.addColorStop(1, '#b09269');
  ctx.fillStyle = cork;
  roundRect(ctx, d.x + 2, d.y + 6, d.w - 4, d.h + 2, 1);
  ctx.fill();
  // The grain of the cork.
  ctx.fillStyle = 'rgba(96,68,38,0.16)';
  for (let x = d.x + 4; x < d.x + d.w - 4; x += 5) {
    for (let y = d.y + 7; y < d.y + d.h + 7; y += 4) {
      if (hash(Math.round(x), Math.round(y)) > 0.55) ctx.fillRect(x, y, 1.4, 1.4);
    }
  }
  const tints = ['#f4ece0', '#f0d9a8', '#cfe0ef', '#efc9c0'];
  const pins = ['#c2543f', '#3f7f88', '#d8a33c', '#6f5a94'];
  for (let i = 0; i * 13 < d.w - 10; i++) {
    const seed = Math.round(d.x + i * 17);
    const lean = (hash(seed, i) - 0.5) * 0.22;
    const x = d.x + 5 + i * 13;
    const y = d.y + 8 + (i % 2) * 3;
    ctx.save();
    ctx.translate(x + 4.5, y + 4);
    ctx.rotate(lean);
    ctx.fillStyle = 'rgba(70,48,24,0.30)';
    roundRect(ctx, -4, -3.4, 9, 8, 0.6);
    ctx.fill();
    ctx.fillStyle = tints[i % tints.length];
    roundRect(ctx, -4.5, -4, 9, 8, 0.6);
    ctx.fill();
    // A line or two of whatever it says.
    ctx.fillStyle = 'rgba(90,80,70,0.30)';
    ctx.fillRect(-3, -1.6, 6, 0.8);
    ctx.fillRect(-3, 0.4, 4, 0.8);
    // ...and the pin holding it up.
    ctx.fillStyle = pins[i % pins.length];
    ctx.beginPath();
    ctx.arc(0, -3.2, 1.1, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.arc(-0.35, -3.6, 0.4, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

function drawPoster(ctx, d) {
  const tall = d.h >= d.w;
  const w = tall ? Math.min(13, d.w) : d.w;
  const h = tall ? d.h : Math.min(13, d.h);
  fillRound(ctx, d.x, d.y + 2, w, h, 2, '#e8dcc4');
  ctx.fillStyle = 'rgba(70,90,120,0.55)';
  ctx.fillRect(d.x + 2, d.y + 4, w - 4, h * 0.42);
  ctx.fillStyle = 'rgba(60,50,44,0.35)';
  for (let i = 0; i < 3; i++) ctx.fillRect(d.x + 3, d.y + 6 + h * 0.5 + i * 4, w - 6 - i * 3, 1.6);
}

function drawSign(ctx, d) {
  if (!d.tag) return;
  const w = Math.max(26, d.tag.length * 5.2 + 10);
  const x = d.x + d.w / 2 - w / 2;
  fillRound(ctx, x, d.y + 4, w, 12, 3, 'rgba(22,28,24,0.72)');
  ctx.fillStyle = 'rgba(226,236,220,0.86)';
  ctx.font = 'bold 8px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(d.tag.toUpperCase(), d.x + d.w / 2, d.y + 10.5);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function drawClock(ctx, d) {
  const cx = d.x + d.w / 2;
  const cy = d.y + 10;
  ctx.fillStyle = '#26302a';
  ctx.beginPath(); ctx.arc(cx, cy, 8, 0, TAU); ctx.fill();
  ctx.fillStyle = '#e6ecdd';
  ctx.beginPath(); ctx.arc(cx, cy, 6.4, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#26302a';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(cx, cy); ctx.lineTo(cx + 3.4, cy - 1.4);
  ctx.moveTo(cx, cy); ctx.lineTo(cx - 0.6, cy - 4.2);
  ctx.stroke();
}

function drawBin(ctx, d) {
  const cx = d.x + d.w / 2;
  ctx.fillStyle = SHADOW;
  ctx.beginPath(); ctx.ellipse(cx + 1, d.y + 15, 6, 2.6, 0, 0, TAU); ctx.fill();
  fillRound(ctx, cx - 5.5, d.y + 3, 11, 12, 2, '#5c6a5e');
  fillRound(ctx, cx - 6.5, d.y + 2, 13, 3, 1.4, '#78876f');
}

function drawPotPlant(ctx, d) {
  const cx = d.x + d.w / 2;
  ctx.fillStyle = SHADOW;
  ctx.beginPath(); ctx.ellipse(cx + 1, d.y + 16, 7, 3, 0, 0, TAU); ctx.fill();
  fillRound(ctx, cx - 5, d.y + 9, 10, 8, 2, PALETTE.pot);
  fillRound(ctx, cx - 5, d.y + 9, 10, 2.6, 1.2, PALETTE.potDark);
  for (const [dx, dy, r] of [[-4, 2, 4.4], [4, 1, 4.0], [0, -2, 5.0]]) {
    ctx.fillStyle = dy < 0 ? PALETTE.leaf : PALETTE.leafDark;
    ctx.beginPath();
    ctx.ellipse(cx + dx, d.y + 6 + dy, r, r * 0.72, dx * 0.12, 0, TAU);
    ctx.fill();
  }
}

function drawKettle(ctx, d) {
  const cx = d.x + d.w / 2;
  fillRound(ctx, cx - 5, d.y + 5, 9, 9, 2, '#c9ced6');
  fillRound(ctx, cx - 4, d.y + 6, 7, 3, 1.2, '#e4e9ef');
  ctx.fillStyle = '#8d95a0';
  ctx.fillRect(cx + 3.5, d.y + 7, 3, 1.6);
  fillRound(ctx, cx + 5, d.y + 10, 5, 5, 1.4, '#e8ddc8');
}

function drawTools(ctx, d) {
  // A board of tools on a store-room wall, which is what says "caretaker".
  fillRound(ctx, d.x, d.y + 3, d.w, d.h + 4, 2, '#5b4a34');
  const marks = ['#c9ced6', '#9aa2ad', '#c08a4a', '#7d8b96'];
  for (let i = 0; i * 9 < d.w - 6; i++) {
    ctx.fillStyle = marks[i % marks.length];
    ctx.fillRect(d.x + 4 + i * 9, d.y + 5, 3, d.h);
    ctx.fillRect(d.x + 3 + i * 9, d.y + 5, 5, 2.4);
  }
}

function drawHoop(ctx, d) {
  const cx = d.x + d.w / 2;
  fillRound(ctx, cx - 11, d.y + 4, 22, 9, 2, '#e6e2d2');
  ctx.strokeStyle = '#c25a3a';
  ctx.lineWidth = 2;
  ctx.strokeRect(cx - 5, d.y + 6, 10, 5);
  ctx.beginPath();
  ctx.arc(cx, d.y + 14, 5.5, 0, Math.PI);
  ctx.stroke();
}

function drawDeskLamp(ctx, d) {
  const cx = d.x + d.w / 2;
  ctx.fillStyle = 'rgba(255,222,150,0.16)';
  ctx.beginPath(); ctx.arc(cx, d.y + 10, 20, 0, TAU); ctx.fill();
  fillRound(ctx, cx - 4, d.y + 6, 8, 5, 2, PALETTE.lampShade);
  ctx.fillStyle = '#6a6156';
  ctx.fillRect(cx - 0.8, d.y + 10, 1.6, 5);
  fillRound(ctx, cx - 3.5, d.y + 14, 7, 2.4, 1, '#6a6156');
}

// A pool of warm light on the floor. Flat circles rather than a gradient: this
// goes into the cache once, but gradients are rasterised per pixel and a big
// one over a school corridor is not cheap even once.
function drawLightPool(ctx, d) {
  const cx = d.x + d.w / 2;
  const cy = d.y + d.h / 2;
  for (const [r, a] of [[46, 0.05], [32, 0.06], [19, 0.07]]) {
    ctx.fillStyle = `rgba(255,226,158,${a})`;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
  }
  lampPositions.push({ x: cx, y: cy });
}

// Split by whether a thing is on the floor, on a wall, or standing in the room:
// a blackboard has to go on before the furniture that stands in front of it,
// and a bin has to go on after.
// A bike rack: a run of hoops with a couple of bikes in them. Small, cheap, and
// the single quickest way to say "this is the outside of a school".
function drawBike(ctx, d) {
  const y = d.y + d.h * 0.5;
  ctx.strokeStyle = '#9aa3ad';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  for (let x = d.x + 6; x < d.x + d.w - 3; x += 13) {
    ctx.moveTo(x, y + 8);
    ctx.lineTo(x, y - 6);
    ctx.lineTo(x + 7, y - 6);
    ctx.lineTo(x + 7, y + 8);
  }
  ctx.stroke();
  ctx.fillStyle = '#c05a45';
  ctx.beginPath();
  ctx.arc(d.x + 12, y + 2, 3.4, 0, TAU);
  ctx.arc(d.x + 25, y + 2, 3.4, 0, TAU);
  ctx.fill();
}

// A parked car, from above: a rounded body, a windscreen band and two lamps.
function drawCar(ctx, d) {
  ctx.fillStyle = 'rgba(20,18,24,0.34)';
  roundRect(ctx, d.x + 3, d.y + 7, d.w, d.h, 8);
  ctx.fill();
  fillRound(ctx, d.x, d.y, d.w, d.h, 8, '#54607a');
  fillRound(ctx, d.x + 4, d.y + d.h * 0.22, d.w - 8, d.h * 0.30, 4, '#8fa2c4');
  fillRound(ctx, d.x + 4, d.y + d.h * 0.62, d.w - 8, d.h * 0.20, 4, '#6d7c9a');
  ctx.fillStyle = '#ffe9b0';
  ctx.fillRect(d.x + 4, d.y + 2, 5, 3);
  ctx.fillRect(d.x + d.w - 9, d.y + 2, 5, 3);
}

const DECOR_FLOOR = {
  floor: drawFloorPatch, court: drawCourt };
const DECOR_WALL = {
  board: drawBoard, notice: drawNotice, poster: drawPoster,
  sign: drawSign, clock: drawClock, tools: drawTools, hoop: drawHoop
};
// A ceiling light. Painted into the room once rather than animated every frame:
// there are a dozen of these in a corridor and none of them flicker, so they
// belong in the static cache with the floor and cost nothing to have.
function drawCeilingLight(ctx, d) {
  const cx = d.x + d.w / 2;
  const cy = d.y + d.h / 2;
  const r = Math.max(d.w, d.h) * 1.15;
  const pool = ctx.createRadialGradient(cx, cy, 2, cx, cy, r);
  pool.addColorStop(0, 'rgba(255,244,214,0.20)');
  pool.addColorStop(0.55, 'rgba(255,240,205,0.09)');
  pool.addColorStop(1, 'rgba(255,238,200,0)');
  ctx.fillStyle = pool;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();
  // The fitting itself: a strip light seen from directly underneath. Faint on
  // purpose — it is above everything in the room, so drawn solid it reads as a
  // white bar lying across the desks rather than as a light over them.
  const along = d.w >= d.h;
  const w = along ? Math.max(13, d.w * 0.62) : 3.4;
  const h = along ? 3.4 : Math.max(13, d.h * 0.62);
  fillRound(ctx, cx - w / 2, cy - h / 2, w, h, 1.6, 'rgba(245,242,228,0.26)');
  fillRound(ctx, cx - w / 2 + 0.8, cy - h / 2 + 0.8, w - 1.6, h - 1.6, 1.2,
    'rgba(255,252,238,0.38)');
}

// A radiator, under a window where a radiator goes.
function drawRadiator(ctx, d) {
  const along = d.w >= d.h;
  drop(ctx, d);
  fillRound(ctx, d.x, d.y, d.w, d.h, 2, '#cdd3d8');
  ctx.fillStyle = 'rgba(120,132,142,0.55)';
  const n = Math.max(3, Math.round((along ? d.w : d.h) / 5));
  for (let i = 1; i < n; i++) {
    if (along) ctx.fillRect(d.x + (d.w / n) * i, d.y + 1.5, 1.2, d.h - 3);
    else ctx.fillRect(d.x + 1.5, d.y + (d.h / n) * i, d.w - 3, 1.2);
  }
  fillRound(ctx, d.x + 1, d.y + 1, along ? d.w - 2 : 1.6, along ? 1.6 : d.h - 2, 0.8,
    'rgba(255,255,255,0.5)');
}

// A fire extinguisher on the wall, which every corridor in every school has.
function drawExtinguisher(ctx, d) {
  const cx = d.x + d.w / 2;
  const cy = d.y + d.h / 2;
  ctx.fillStyle = SHADOW;
  roundRect(ctx, cx - 3, cy - 4, 7, 11, 2);
  ctx.fill();
  fillRound(ctx, cx - 4, cy - 6, 8, 12, 3, '#c0392b');
  fillRound(ctx, cx - 4, cy - 6, 8, 4, 3, '#d9503f');
  ctx.fillStyle = '#2f3138';
  ctx.fillRect(cx - 1.6, cy - 8.5, 3.2, 3);
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.fillRect(cx - 2.4, cy - 1, 4.8, 1.4);
}

// A coat rack: pegs and whatever is still on them.
function drawCoats(ctx, d) {
  const along = d.w >= d.h;
  ctx.fillStyle = 'rgba(70,52,36,0.85)';
  if (along) ctx.fillRect(d.x, d.y + d.h / 2 - 1, d.w, 2.4);
  else ctx.fillRect(d.x + d.w / 2 - 1, d.y, 2.4, d.h);
  const n = Math.max(2, Math.round((along ? d.w : d.h) / 7));
  const coats = ['#4f6f9e', '#8a5a44', '#5c7a52', '#7a5470'];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const px = along ? d.x + d.w * t : d.x + d.w / 2;
    const py = along ? d.y + d.h / 2 : d.y + d.h * t;
    ctx.fillStyle = 'rgba(50,38,26,0.9)';
    ctx.fillRect(px - 0.8, py - 1, 1.6, 3.4);
    if (hash(d.x + i * 17, d.y) > 0.45) {
      ctx.fillStyle = coats[i % coats.length];
      roundRect(ctx, px - 3.4, py + 1, 6.8, 8, 2.5);
      ctx.fill();
    }
  }
}

const DECOR_PROPS = {
  // Last of all, so the light falls over the room rather than under it.
  ceiling: drawCeilingLight,
  radiator: drawRadiator, extinguisher: drawExtinguisher, coats: drawCoats,
  bin: drawBin, plant: drawPotPlant, kettle: drawKettle,
  desklamp: drawDeskLamp, lamp: drawLightPool,
  bike: drawBike, car: drawCar
};

function paintDecor(ctx, level, table) {
  if (!level.decor) return;
  for (const d of level.decor) {
    const paint = table[d.kind];
    if (paint) paint(ctx, d);
  }
}

// The school after hours, baked in.
//
// Darkness with holes in it, not light added on top. The first draft added
// pools in `lighter` and every place two fittings overlapped went white — an
// additive light is unbounded, and a corridor has a light every few tiles. So
// this builds the *dark* as its own layer, punches the lit patches out of it
// with `destination-out`, and lays the result over the room once. Nothing can
// blow out, because nothing is ever added: the brightest the floor can get is
// the colour it already was.
//
// What that buys is the thing the brief actually asks for — somewhere dark. A
// room with no fitting in it gets no hole punched in the layer and stays down,
// so the far end of a corridor and the middle of the field are genuinely
// gloomier than the stretch you are standing in. That is a fact about the
// building rather than a filter over the picture.
//
// The wash is deliberately gentle. Everything a player has to see — the loot,
// the cabinet they are about to open, the man asleep in the chair — is drawn
// live on top of this cache and is not dimmed by it at all; what dims is the
// architecture behind them, which is the contrast that makes them readable. A
// heavier wash looks better in a screenshot and plays worse.
function paintNight(ctx, level) {
  // Built at half size and blown back up. Every edge in this layer is a soft
  // gradient, so half the pixels are indistinguishable from all of them — and
  // on the biggest maps this is the single most expensive thing in the bake,
  // so a quarter of the fill area is the difference between a level that loads
  // and a level that hitches.
  const SCALE = 0.5;
  const mask = document.createElement('canvas');
  mask.width = Math.ceil(W * SCALE);
  mask.height = Math.ceil(H * SCALE);
  const m = mask.getContext('2d');
  if (!m) return;
  m.scale(SCALE, SCALE);
  // Each building has its own colour of dark and its own amount of it. A hotel
  // suite at night is warm and only dim; a vault is nearly black and the same
  // colour as its own concrete. Same pass, eleven different nights.
  m.fillStyle = T.night;
  m.fillRect(0, 0, W, H);

  // Punch a hole. `reach` is where the light has died away entirely; the middle
  // is cleared completely, so the floor directly under a fitting is exactly the
  // colour it was painted.
  m.globalCompositeOperation = 'destination-out';
  // ...and keep a running total of how much floor the building's own lights
  // actually reach, which is what decides how dark the rest of it may go.
  let cover = 0;
  const lit = (cx, cy, reach, core = 0.30, stretch = 1) => {
    const g = m.createRadialGradient(cx, cy, reach * core, cx, cy, reach);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    m.fillStyle = g;
    m.beginPath();
    m.arc(cx, cy, reach, 0, TAU);
    m.fill();
    cover += Math.PI * reach * reach * stretch * 0.55;
  };

  for (const d of level.decor || []) {
    const cx = d.x + d.w / 2;
    const cy = d.y + d.h / 2;
    if (d.kind === 'ceiling') {
      // A strip light throws further along itself than across it, so a fitting
      // in a corridor lights the corridor rather than a circle of it.
      m.save();
      m.translate(cx, cy);
      m.scale(1.7, 1);
      lit(0, 0, Math.max(d.w, d.h) * 1.15, 0.30, 1.7);
      m.restore();
    } else if (d.kind === 'lamp') {
      lit(cx, cy, 66);
    } else if (d.kind === 'desklamp') {
      lit(cx, cy, 52);
    } else if (d.kind === 'floor' && (d.tag === 'boards' || d.tag === 'parquet')) {
      // A room the map has bothered to floor is a room in use, and a room with
      // its lights off is a black rectangle you cannot plan a route through.
      // Lift it most of the way — not all — so it reads as unlit but legible,
      // and the lit corridor is still visibly the brighter place.
      m.globalCompositeOperation = 'destination-out';
      m.fillStyle = 'rgba(0,0,0,0.30)';
      m.fillRect(d.x, d.y, d.w, d.h);
      cover += d.w * d.h * 0.30;
    }
  }

  // The moon through the glass, falling *into* the building.
  for (const c of level.colliders) {
    if (!(c.type === 'wall' && c.window)) continue;
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    const vertical = c.h > c.w;
    m.save();
    m.translate(cx + (vertical ? (cx < W / 2 ? 20 : -20) : 0),
      cy + (vertical ? 0 : (cy < H / 2 ? 20 : -20)));
    m.scale(vertical ? 1 : 1.5, vertical ? 1.5 : 1);
    lit(0, 0, Math.max(40, (vertical ? c.h : c.w) * 0.6), 0.12, 1.5);
    m.restore();
  }

  // ...and the sign over the way out, which is the one light in a building that
  // is never switched off and the one the player most wants to find.
  if (level.exit) {
    lit(level.exit.x + level.exit.w / 2, level.exit.y + level.exit.h / 2, 58);
  }

  // How dark this building is allowed to get depends on how much of it is lit.
  //
  // The school has a fitting every few metres and its own night reaches nearly
  // every tile, so it can carry a deep one and the dark stretches between the
  // pools read as atmosphere. A vault has four lights in a hall, a shop has
  // one. Washed to the same depth those stop being atmospheric and become a
  // room the player cannot plan a route through — which is a worse game, not a
  // moodier one. So the depth the theme asks for is what a building the map
  // actually lights gets, and one it barely lights is let off in proportion.
  // Never blacker than the theme wants, never so black there is nothing to see.
  const reached = Math.min(1, cover / (W * H));
  ctx.save();
  ctx.globalAlpha = Math.min(T.deep, 0.30 + reached * 0.34);
  ctx.drawImage(mask, 0, 0, W, H);
  ctx.restore();
}

export function paintStaticRoom(ctx, level) {
  T = THEMES[level.theme] || THEMES.bedroom;
  W = level.width;
  H = level.height;
  lampPositions.length = 0;
  drawFloor(ctx);
  // Floor treatments first: they are the floor, so everything below is drawn
  // on top of them exactly as it was drawn on top of the plain one.
  paintDecor(ctx, level, DECOR_FLOOR);
  for (const rug of level.rugs) drawRug(ctx, rug);
  for (const zone of level.creaks) drawCreakZone(ctx, zone);

  if (level.tiles) {
    // A hand-drawn map: the building is whatever the grid says it is.
    for (const c of level.colliders) {
      if (c.type === 'wall' && !c.window && !c.fence) drawWallSlab(ctx, c);
    }
    for (const c of level.colliders) {
      if (c.fence) drawFence(ctx, c);
    }
    for (const c of level.colliders) {
      if (c.type === 'partition') drawPartition(ctx, c);
    }
    // Windows after the walls, so their light falls over the room.
    for (const c of level.colliders) {
      if (c.type === 'wall' && c.window) drawWindowPane(ctx, c);
    }
  } else {
    drawWalls(ctx);
    // After the walls: the window is cut into one, and its light falls on top
    // of the floor that is already down.
    drawSunbeam(ctx, WINDOWS[level.layout] || 'left');
    // Interior walls first, so furniture standing against them overlaps.
    for (const c of level.colliders) {
      if (c.type === 'partition') drawPartition(ctx, c);
    }
  }
  for (const door of level.doors) drawDoorway(ctx, door);
  // Somewhere to stand out of sight. Painted into the floor rather than over
  // the room, so it reads as part of the building — a shadowed recess in the
  // corner behind the lockers rather than a decal dropped on top of it.
  for (const spot of level.hides || []) drawHideSpot(ctx, spot);
  // Boards, notices, posters, signs: on the wall, and therefore behind whatever
  // is standing in front of the wall.
  paintDecor(ctx, level, DECOR_WALL);
  for (const c of level.colliders) {
    if (c.type === 'furniture') drawFurniture(ctx, c);
  }
  // ...and the things standing on the floor go on last, in front of it all.
  paintDecor(ctx, level, DECOR_PROPS);
  // Whatever this level's person is asleep on — a bed, a couch, an armchair —
  // or nothing, when they are at a desk that is drawn live each frame.
  drawWatcherFurniture(ctx, level, watcherConfig(level.watcher.kind).pose || 'bed');

  // The lights, and everything they do not reach.
  paintNight(ctx, level);

  // The vignette is sized to the map, so a wide floorplan is not darkened at
  // its ends the way a tall one is at its corners.
  const span = Math.max(W, H);
  const vignette = ctx.createRadialGradient(W / 2, H / 2, span * 0.34, W / 2, H / 2, span * 0.80);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, `rgba(${T.vignette},0.32)`);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);
}

// The floor of a hiding place: a darker patch with a soft edge, and a hairline
// round it so its extent is legible rather than guessed at. The label that says
// what it is belongs to the beta and is drawn live — see `drawHideLabel`.
function drawHideSpot(ctx, spot) {
  const { x, y, w, h } = spot;
  // Light, not dark. A deep pool of shadow on a pale corridor floor reads as a
  // hole or a scorch mark rather than as a corner you can stand in; what says
  // "recess" is a shallow gradient and a clean edge.
  const pool = ctx.createRadialGradient(x + w / 2, y + h / 2, 2,
    x + w / 2, y + h / 2, Math.max(w, h) * 0.75);
  pool.addColorStop(0, 'rgba(12,20,34,0.20)');
  pool.addColorStop(1, 'rgba(12,20,34,0)');
  ctx.fillStyle = pool;
  ctx.fillRect(x - w * 0.3, y - h * 0.3, w * 1.6, h * 1.6);
  ctx.fillStyle = 'rgba(14,22,36,0.16)';
  roundRect(ctx, x + 1, y + 1, w - 2, h - 2, 4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(140,205,235,0.30)';
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 4]);
  roundRect(ctx, x + 1, y + 1, w - 2, h - 2, 4);
  ctx.stroke();
  ctx.setLineDash([]);
}

// The beta's own label, over a hiding place. Drawn live rather than baked in
// because it brightens when you are standing in one, and because a temporary
// testing indicator should be one call to delete rather than a repaint of every
// level's floor: turn TUNING.beta.hideLabels off and nothing here runs.
export function drawHideLabel(ctx, spot, { active = false, time = 0 } = {}) {
  const cx = spot.x + spot.w / 2;
  // Clear of the thief's head. The player stands in the middle of the spot and
  // is drawn after this, so a label tucked just above the floor patch is a
  // label you can only read when you are not using it.
  const top = spot.y - 22;
  const label = 'HIDE';
  ctx.font = 'bold 9px system-ui';
  const pad = 6;
  const width = ctx.measureText(label).width + pad * 2;
  const pulse = active ? 0.72 + 0.28 * Math.sin(time * 5) : 0.62;
  ctx.globalAlpha = pulse;
  ctx.fillStyle = active ? 'rgba(28,58,72,0.92)' : 'rgba(18,24,34,0.82)';
  roundRect(ctx, cx - width / 2, top - 12, width, 13, 6);
  ctx.fill();
  ctx.strokeStyle = active ? 'rgba(150,232,255,0.95)' : 'rgba(140,205,235,0.55)';
  ctx.lineWidth = 1;
  roundRect(ctx, cx - width / 2, top - 12, width, 13, 6);
  ctx.stroke();
  ctx.fillStyle = active ? '#e6fbff' : '#bcd8e6';
  ctx.textAlign = 'center';
  ctx.fillText(label, cx, top - 2.5);
  ctx.globalAlpha = 1;
}

// A couch, drawn from the watcher's own collider: what Dr. Marek and Mr. Vrána
// are asleep on. Same construction as the room's sofas, at whatever size the
// map drew it.
function drawCouchBase(ctx, level) {
  const c = level.bed;
  drop(ctx, c);
  fillRound(ctx, c.x, c.y, c.w, c.h, 9, '#6a5a52');
  fillRound(ctx, c.x + 3, c.y + 3, c.w - 6, c.h * 0.34, 6, '#836f64');
  fillRound(ctx, c.x, c.y + c.h * 0.24, 9, c.h * 0.72, 4, '#836f64');
  fillRound(ctx, c.x + c.w - 9, c.y + c.h * 0.24, 9, c.h * 0.72, 4, '#836f64');
}

// An armchair pulled up to the fire, for Grandpa.
function drawChairBase(ctx, level) {
  const c = level.bed;
  drop(ctx, c);
  fillRound(ctx, c.x, c.y, c.w, c.h, 10, '#6d4630');
  fillRound(ctx, c.x + 3, c.y + 3, c.w - 6, c.h * 0.40, 8, '#8a5c3f');
  fillRound(ctx, c.x, c.y + c.h * 0.22, 11, c.h * 0.74, 6, '#8a5c3f');
  fillRound(ctx, c.x + c.w - 11, c.y + c.h * 0.22, 11, c.h * 0.74, 6, '#8a5c3f');
  // A worn seat cushion.
  fillRound(ctx, c.x + 12, c.y + c.h * 0.42, c.w - 24, c.h * 0.46, 6, '#a97148');
}

export function drawWatcherFurniture(ctx, level, pose) {
  // A school's caretaker fell asleep at his desk, and the desk is part of the
  // building: it goes into the room cache so it survives him standing up.
  if (pose === 'desk' && level.theme === 'school') {
    drawDeskset(ctx, level, level.watcher.kind);
    level.deskPainted = true;
    return;
  }
  if (pose === 'couch') drawCouchBase(ctx, level);
  else if (pose === 'chair') drawChairBase(ctx, level);
  else if (pose === 'bed') drawBedBase(ctx, level);
  // 'desk' and 'guard' draw their own furniture every frame — their screens
  // flicker and their papers shift, so they cannot live in the static cache.
}

// ---------------------------------------------------------------- sleeper
export function drawSleeper(ctx, level, stage, clock, wake = 0, startle = 0, kind = 'sleeper',
                            pose = 'bed') {
  const look = sleeperLook(kind);
  const inBed = pose === 'bed';
  const bed = level.bed;
  const hx = level.sleeper.x;
  const hy = level.sleeper.y;

  // Breathing: slow and deep at first, shallower and faster as he surfaces.
  const rate = [0.55, 0.8, 1.15, 1.6, 2.3, 2.6][stage];
  const depth = [1.15, 0.95, 0.7, 0.5, 0.35, 0.3][stage];
  const breath = Math.sin(clock * rate * TAU) * depth;

  // Never perfectly still: a slow settle drift, plus the occasional turn that
  // gets more frequent the closer he is to waking.
  const fidgetRate = [0.09, 0.16, 0.3, 0.55, 0.9, 0][stage];
  const fidget = Math.max(0, Math.sin(clock * fidgetRate * TAU) - 0.86) * 7;
  const settle = Math.sin(clock * 0.21) * 0.7 + Math.sin(clock * 0.13 + 1.7) * 0.5;
  // A bang makes him jolt: a fast shudder that settles, on top of everything
  // the meter is already doing.
  const jolt = startle > 0 ? Math.sin(clock * 26) * startle * 4.5 : 0;
  const joltLift = startle * 2.2;

  // Waking is a sit-up: the duvet slips down and the head lifts off the pillow.
  const rise = stage === SLEEP_AWAKE ? Math.min(1, wake / 0.45) : 0;
  const ease = rise * rise * (3 - 2 * rise);

  const duvetY = bed.y + bed.h * 0.40 - breath * 1.4 + ease * 16 - joltLift;
  const duvetH = Math.max(6, bed.y + bed.h - 6 - duvetY);
  fillRound(ctx, bed.x + 5, duvetY, bed.w - 10, duvetH, 7, look.duvet);
  // A turned-down sheet along the top edge of the covers.
  fillRound(ctx, bed.x + 5, duvetY, bed.w - 10, Math.min(duvetH, 10 + breath * 1.2), 5, look.sheet);
  fillRound(ctx, bed.x + 6, duvetY + 2, bed.w - 12, Math.min(duvetH - 3, 6 + breath), 4, look.duvetTop);
  // Faint quilting, so the duvet has a fabric rather than a flat fill.
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = '#f6fbff';
  ctx.lineWidth = 1;
  for (let qx = bed.x + 16; qx < bed.x + bed.w - 8; qx += 18) {
    ctx.beginPath();
    ctx.moveTo(qx, duvetY + 12);
    ctx.lineTo(qx - 10, duvetY + duvetH);
    ctx.stroke();
  }
  ctx.restore();

  // An arm lying on top of the covers, rising and falling with him.
  if (stage !== SLEEP_AWAKE) {
    ctx.strokeStyle = look.shoulder;
    ctx.lineCap = 'round';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(hx + 13, duvetY + 4);
    ctx.quadraticCurveTo(hx + 24, duvetY + 12 + breath, hx + 19, duvetY + 22 + breath * 1.4);
    ctx.stroke();
    ctx.fillStyle = look.skin;
    ctx.beginPath();
    ctx.arc(hx + 19, duvetY + 23 + breath * 1.4, 3.4, 0, TAU);
    ctx.fill();
  }

  ctx.strokeStyle = look.fold;                              // duvet folds
  ctx.lineWidth = 1.5;
  for (let i = 1; i <= 2; i++) {
    const y = duvetY + (duvetH / 3) * i + breath * 0.5;
    ctx.beginPath();
    ctx.moveTo(bed.x + 12, y);
    ctx.bezierCurveTo(bed.x + bed.w * 0.4, y + 3, bed.x + bed.w * 0.6, y - 3, bed.x + bed.w - 12, y);
    ctx.stroke();
  }

  if (inBed) {
    // Two pillows, with the near one creased under his head.
    fillRound(ctx, hx - 29, hy - 18, 58, 33, 10, '#ece3d3');
    fillRound(ctx, hx - 27, hy - 17, 54, 30, 9, look.pillow);
    ctx.strokeStyle = 'rgba(206,194,174,0.75)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(hx, hy - 15);
    ctx.lineTo(hx, hy + 11);
    ctx.stroke();
    ctx.fillStyle = 'rgba(206,194,174,0.55)';
    roundRect(ctx, hx - 22, hy + 7, 44, 5, 2.5);
    ctx.fill();
  } else {
    // Not in bed: one cushion shoved under the head, and that is all.
    fillRound(ctx, hx - 20, hy - 13, 40, 26, 9, '#00000022');
    fillRound(ctx, hx - 19, hy - 13, 38, 24, 8, look.pillow);
  }

  // Shoulders, just above the duvet line, so he is lying *in* the bed rather
  // than floating on top of it.
  fillRound(ctx, hx - 17, hy + 6, 34, 14, 7, look.duvetTop);
  fillRound(ctx, hx - 15, hy + 7, 30, 10, 5, look.shoulder);

  // Torso appears as they sit up.
  if (ease > 0.05) {
    fillRound(ctx, hx - 16, hy + 2, 32, 28 * ease, 8, look.shoulder);
  }

  const headX = hx + settle * 0.9 + fidget * (stage >= SLEEP_DISTURBED ? 1 : 0.4) + jolt;
  const headY = hy + breath * 0.5 - ease * 9 - joltLift * 0.6;
  // Long hair lies on the pillow around the head, so it has to go down first.
  if (look.style === 'long') {
    ctx.fillStyle = look.hair;
    ctx.beginPath();
    ctx.ellipse(headX, headY + 1, 21, 18, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    ctx.beginPath();
    ctx.ellipse(headX - 13, headY + 8, 8, 5.5, -0.5, 0, TAU);
    ctx.ellipse(headX + 13, headY + 8, 8, 5.5, 0.5, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = look.skinShade;
  ctx.beginPath();
  ctx.arc(headX, headY + 1.5, 15, 0, TAU);
  ctx.fill();
  ctx.fillStyle = look.skin;
  ctx.beginPath();
  ctx.arc(headX, headY, 15, 0, TAU);
  ctx.fill();
  ctx.fillStyle = look.hair;
  if (look.style === 'balding') {
    // Thin on top: hair only around the sides, and a bare crown.
    ctx.beginPath();
    ctx.arc(headX, headY - 3, 14.5, Math.PI * 0.94, Math.PI * 1.32);
    ctx.arc(headX, headY - 3, 9, Math.PI * 1.32, Math.PI * 0.94, true);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(headX, headY - 3, 14.5, Math.PI * 1.68, Math.PI * 2.06);
    ctx.arc(headX, headY - 3, 9, Math.PI * 2.06, Math.PI * 1.68, true);
    ctx.fill();
  } else {
    ctx.beginPath();                                     // hair, with a fringe
    ctx.arc(headX, headY - 6, 14.5, Math.PI, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(headX - 5, headY - 4, 7, 4.5, -0.35, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.beginPath();
  ctx.ellipse(headX + 4, headY - 9, 5, 2.6, 0.3, 0, TAU);
  ctx.fill();

  const ey = headY + 1;
  const ink = look.style === 'balding' ? '#4a4038' : look.hair;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.7;
  ctx.lineCap = 'round';
  ctx.fillStyle = ink;

  const closedEyes = () => {
    ctx.beginPath();
    ctx.moveTo(headX - 9, ey - 1);
    ctx.quadraticCurveTo(headX - 6, ey + 3, headX - 3, ey - 1);
    ctx.moveTo(headX + 3, ey - 1);
    ctx.quadraticCurveTo(headX + 6, ey + 3, headX + 9, ey - 1);
    ctx.stroke();
  };
  const openEyes = (r) => {
    ctx.beginPath();
    ctx.arc(headX - 6, ey, r, 0, TAU);
    ctx.arc(headX + 6, ey, r, 0, TAU);
    ctx.fill();
  };

  if (stage === SLEEP_DEEP || stage === SLEEP_LIGHT) closedEyes();
  else if (stage === SLEEP_DISTURBED) {                     // squinting
    ctx.beginPath();
    ctx.moveTo(headX - 9, ey);
    ctx.lineTo(headX - 4, ey);
    ctx.moveTo(headX + 4, ey);
    ctx.lineTo(headX + 9, ey);
    ctx.stroke();
  } else if (stage === SLEEP_ALMOST) openEyes(2);
  else if (stage === SLEEP_CRITICAL) openEyes(3);
  else {                                                    // wide awake
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(headX - 6, ey, 4.4, 0, TAU);
    ctx.arc(headX + 6, ey, 4.4, 0, TAU);
    ctx.fill();
    ctx.fillStyle = ink;
    openEyes(2.2);
  }

  if (look.style === 'balding') {                           // a grey moustache
    ctx.fillStyle = look.hair;
    ctx.beginPath();
    ctx.ellipse(headX, ey + 6, 6, 2.2, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
  }

  ctx.beginPath();                                          // mouth
  if (stage === SLEEP_AWAKE) {
    ctx.ellipse(headX, ey + 9, 3.4, 4.4 * Math.max(0.4, ease), 0, 0, TAU);
    ctx.fill();
  } else if (stage === SLEEP_CRITICAL) {
    ctx.arc(headX, ey + 8, 3.4, 0.15, Math.PI - 0.15);
    ctx.stroke();
  } else {
    ctx.moveTo(headX - 3.5, ey + 9);
    ctx.lineTo(headX + 3.5, ey + 9);
    ctx.stroke();
  }

  // The state read-out above the bed: sleepy Z's, then escalating alarm.
  const floor = (value) => Math.max(WT + 6, value);         // stay off the wall band
  if (stage === SLEEP_DEEP || stage === SLEEP_LIGHT) {
    const f = (clock * (stage === SLEEP_DEEP ? 0.42 : 0.6)) % 1;
    ctx.textAlign = 'left';
    ctx.globalAlpha = Math.max(0, 1 - f);
    ctx.fillStyle = '#ffffffdd';
    ctx.font = 'bold 13px system-ui';
    ctx.fillText('z', hx + 22, floor(hy - 14 - f * 14));
    if (stage === SLEEP_DEEP) {
      ctx.font = 'bold 18px system-ui';
      ctx.fillText('Z', hx + 31, floor(hy - 26 - f * 20));
    }
    ctx.globalAlpha = 1;
  } else {
    const marks = ['', '', '?', '!', '!!', '!!!'][stage];
    const colors = ['', '', '#ffe08a', '#ffc24d', '#ff8c42', '#ff5252'];
    const pulse = stage >= SLEEP_CRITICAL ? 0.6 + 0.4 * Math.sin(clock * 9) : 1;
    ctx.textAlign = 'center';
    ctx.globalAlpha = pulse;
    ctx.font = `bold ${16 + stage * 2}px system-ui`;
    ctx.fillStyle = colors[stage];
    ctx.fillText(marks, hx, floor(bed.y - 10));
    ctx.globalAlpha = 1;
  }

  if (startle > 0.25 && stage !== SLEEP_AWAKE) {
    ctx.textAlign = 'center';
    ctx.globalAlpha = Math.min(1, startle);
    ctx.font = 'bold 17px system-ui';
    ctx.fillStyle = '#ffd0d0';
    ctx.fillText('!', hx + 26, floor(bed.y + 2));
    ctx.globalAlpha = 1;
  }
}

// Asleep at a desk: Mr. Halas face down on the quarterly report, Otakar at the
// hotel's floor desk. Nothing about them is a bed, so this is its own drawing —
// the desk, the papers, and a man folded over both.
// The workstation somebody fell asleep at: the desk, the paperwork, the lamp,
// and — for a caretaker who was doing the rota when he nodded off — a monitor
// and a mug. Split out from the sleeper so a location can paint it once into
// the room and keep it there after he leaves.
export function drawDeskset(ctx, level, kind = 'worker') {
  const desk = level.bed;
  drop(ctx, desk);
  fillRound(ctx, desk.x, desk.y, desk.w, desk.h, 6, PALETTE.woods[1].dark);
  fillRound(ctx, desk.x, desk.y, desk.w, desk.h - 7, 6, PALETTE.woods[1].base);
  fillRound(ctx, desk.x + 4, desk.y + 3, desk.w - 8, desk.h - 15, 4, PALETTE.woods[1].top);

  drawPapers(ctx, desk.x + desk.w - 18, desk.y + desk.h * 0.34);
  drawLamp(ctx, desk.x + 14, desk.y + desk.h * 0.30);

  if (kind !== 'caretaker' || desk.w < 90) return;
  // A monitor at the far end, its back to the room, and the mug that went cold
  // hours ago. Small things, but they are what say "somebody works here" rather
  // than "a table with a man on it".
  const mx = desk.x + desk.w * 0.63;
  const my = desk.y + desk.h * 0.28;
  fillRound(ctx, mx - 13, my - 9, 26, 15, 2, '#2b3038');
  fillRound(ctx, mx - 11, my - 7, 22, 11, 1.5, '#3d4654');
  fillRound(ctx, mx - 11, my - 7, 22, 4, 1.5, '#4d5a6c');
  fillRound(ctx, mx - 4, my + 6, 8, 3, 1, '#2b3038');
  // A keyboard, pushed aside to make room for his head.
  fillRound(ctx, desk.x + desk.w * 0.32, desk.y + desk.h * 0.60, 30, 9, 2, '#cfd4dc');
  ctx.fillStyle = 'rgba(70,78,90,0.45)';
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 7; c++) {
      ctx.fillRect(desk.x + desk.w * 0.32 + 3 + c * 3.6, desk.y + desk.h * 0.60 + 2 + r * 3, 2.4, 2);
    }
  }
  // The mug.
  fillRound(ctx, desk.x + desk.w - 34, desk.y + desk.h * 0.62, 9, 9, 3, '#d8dde4');
  fillRound(ctx, desk.x + desk.w - 32, desk.y + desk.h * 0.64, 5, 5, 2, '#6b4a30');
}

// Where the caretaker's monitor is, if this level has one.
//
// His desk is painted into the room cache and stays there after he gets up,
// which is right for the desk and wrong for the screen on it: a monitor that is
// still on is the one thing in a dark school that should not be a photograph.
// So the room paints the dark screen and the renderer paints the glow over it,
// live, from the same two numbers.
export function deskScreen(level, kind) {
  const desk = level.bed;
  if (kind !== 'caretaker' || !desk || desk.w < 90) return null;
  return {
    x: desk.x + desk.w * 0.63 - 11,
    y: desk.y + desk.h * 0.28 - 7,
    w: 22, h: 11
  };
}

// Getting up out of a chair, drawn seated.
//
// The beats, and where each one lives: he twitches (0.00), his head comes off
// the desk (0.12), he looks left and right without moving (0.34), his back
// straightens and his hands come down onto the desk (0.52), then he pushes the
// chair away and takes his weight on them (0.74). Only after all of that does
// the standing figure take over, which is what stops a wake-up reading as a cut
// from one pose to another.
//
// `up` is 0..1 across that seated stretch. Everything below is a curve on it
// rather than a switch, so the timing can be re-tuned without any of these
// numbers having to agree with each other.
const wakeBeat = (t, from, to) => Math.max(0, Math.min(1, (t - from) / (to - from)));
const wakeEase = (t) => t * t * (3 - 2 * t);

export function drawSlumped(ctx, level, stage, clock, wake = 0, startle = 0,
                            kind = 'worker', up = 0) {
  const look = sleeperLook(kind);
  const desk = level.bed;
  const cx = desk.x + desk.w / 2;
  const cy = desk.y + desk.h * 0.5;

  // Breathing, slower and deeper than in a bed because he did not mean to
  // fall asleep here.
  const rate = [0.5, 0.75, 1.1, 1.55, 2.2, 2.6][stage];
  const depth = [1.1, 0.9, 0.68, 0.48, 0.34, 0.3][stage];
  const breath = Math.sin(clock * rate * TAU) * depth;
  const fidgetRate = [0.08, 0.15, 0.3, 0.55, 0.9, 0][stage];
  const fidget = Math.max(0, Math.sin(clock * fidgetRate * TAU) - 0.86) * 6;
  const jolt = startle > 0 ? Math.sin(clock * 25) * startle * 4 : 0;
  // Waking is sitting up off the desk. Driven by the state machine's own
  // progress through getting up when there is one, so the drawing and the
  // simulation cannot run to different clocks; `wake` is the fallback for the
  // sleepers with no rising state at all.
  const b = (from, to) => (up > 0 ? wakeEase(wakeBeat(up, from, to)) : 0);
  const lifting = b(0.12, 0.46);        // head off the desk
  const casting = b(0.34, 0.70);        // looking about, without turning
  const straight = b(0.52, 0.88);       // back straightening
  const pushing = b(0.74, 1.00);        // hands down, chair going back
  const rise = up > 0 ? Math.max(lifting, straight)
    : (stage === SLEEP_AWAKE ? Math.min(1, wake / 0.45) : 0);
  const ease = rise * rise * (3 - 2 * rise);
  // Where he is looking while he casts about. A head turn, not a body turn: a
  // man looking round a room does not rotate on the spot to do it.
  const gaze = casting > 0 ? Math.sin(up * 11) * casting * (1 - pushing) * 3.4 : 0;

  // The desk and everything on it. Painted into the room rather than here in
  // the schools, so that it is still standing there once he has got up and
  // walked off — the place he sleeps is a landmark the player navigates by, and
  // having it wink out of existence the moment he leaves it was daft.
  if (!level.deskPainted) drawDeskset(ctx, level, kind);

  // The chair, behind him — and going backwards as he pushes off it. A man
  // standing up out of a chair moves the chair; leaving it welded to the floor
  // is most of why the old version read as a figure inflating rather than as
  // somebody getting up.
  const chairY = cy + desk.h * 0.36 + pushing * 9;
  fillRound(ctx, cx - 14, chairY, 28, 15, 5, '#3a3f52');
  fillRound(ctx, cx - 12, chairY + 2, 24, 10, 4, '#4a5064');

  // Shoulders folded over the desk, in his shirt. As his back straightens the
  // torso narrows and lifts: folded over a desk you see the whole of a man's
  // back, sitting up you see the top of his shoulders, and the width is what
  // says which of those you are looking at.
  const bodyY = cy + 10 - ease * 10 - pushing * 5;
  const bodyX = cx + fidget * 0.6 + jolt;
  const halfW = 19 - straight * 3.5;
  const deep = 20 - straight * 4;
  fillRound(ctx, bodyX - halfW, bodyY - 4 + breath * 0.4, halfW * 2, deep, 8,
    look.shirt || look.shoulder);
  fillRound(ctx, bodyX - halfW, bodyY - 4 + breath * 0.4, halfW * 2, 8, 6, '#ffffff22');
  if (look.tie) {                                   // a tie he never loosened
    ctx.fillStyle = look.tie;
    ctx.fillRect(bodyX - 2.5, bodyY + 2, 5, 13);
  }
  // The arms. Out across the desk with his head on one of them, then drawn in
  // as he sits up, and finally planted either side of him on the desk to take
  // his weight — which is how a heavy man in his sixties actually stands up,
  // and the beat the old version skipped entirely.
  ctx.strokeStyle = look.shirt || look.shoulder;
  ctx.lineCap = 'round';
  ctx.lineWidth = 8;
  const handOut = 26 - straight * 6 + pushing * 4;
  const handUp = -15 + straight * 13 + pushing * 8;
  const elbow = -10 + straight * 10 + pushing * 6;
  ctx.beginPath();
  ctx.moveTo(bodyX - 16, bodyY + 2);
  ctx.quadraticCurveTo(bodyX - handOut, bodyY + elbow,
    bodyX - 12 - pushing * 5, bodyY + handUp + breath * 0.5);
  ctx.moveTo(bodyX + 16, bodyY + 2);
  ctx.quadraticCurveTo(bodyX + handOut, bodyY + elbow,
    bodyX + 13 + pushing * 5, bodyY + handUp + breath * 0.5);
  ctx.stroke();
  if (pushing > 0.05) {
    // Hands, flat on the desk. Small, and the whole reason the push reads.
    ctx.fillStyle = look.skin;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(bodyX + side * (12 + pushing * 5), bodyY + handUp + 2,
        4.2, 3.2, 0, 0, TAU);
      ctx.fill();
    }
  }

  // The head: face down on his own forearm, then lifted, then turning as he
  // looks about. The turn is the head only — `gaze` slides the face across it
  // rather than rotating the body, which is what looking round a room is.
  const headX = bodyX + gaze;
  const headY = bodyY - 12 + breath * 0.6 - ease * 12 - pushing * 3;
  ctx.fillStyle = look.skinShade;
  ctx.beginPath();
  ctx.arc(headX, headY + 1.5, 13, 0, TAU);
  ctx.fill();
  ctx.fillStyle = look.skin;
  ctx.beginPath();
  ctx.arc(headX, headY, 13, 0, TAU);
  ctx.fill();

  // Hair. Face down, so mostly the back of his head — until he sits up.
  ctx.fillStyle = look.hair;
  if (ease < 0.4) {
    ctx.beginPath();
    ctx.arc(headX, headY, 13, 0, TAU);
    ctx.fill();
    if (look.style === 'balding') {                 // a thinning crown
      ctx.fillStyle = look.skin;
      ctx.beginPath();
      ctx.ellipse(headX, headY - 1, 6, 5, 0, 0, TAU);
      ctx.fill();
    }
  } else {
    ctx.beginPath();
    ctx.arc(headX, headY - 5, 12.5, Math.PI, TAU);
    ctx.fill();
    // Sitting up: eyes, and they are open.
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(headX - 5, headY + 2, 3.8, 0, TAU);
    ctx.arc(headX + 5, headY + 2, 3.8, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#33291f';
    ctx.beginPath();
    ctx.arc(headX - 5, headY + 2, 2, 0, TAU);
    ctx.arc(headX + 5, headY + 2, 2, 0, TAU);
    ctx.fill();
  }

  // The read-out above the desk: sleepy Z's, then escalating alarm.
  const floor = (v) => Math.max(WT + 6, v);
  if (stage <= SLEEP_LIGHT) {
    const f = (clock * (stage === SLEEP_DEEP ? 0.42 : 0.6)) % 1;
    ctx.textAlign = 'left';
    ctx.globalAlpha = Math.max(0, 1 - f);
    ctx.fillStyle = '#ffffffdd';
    ctx.font = 'bold 13px system-ui';
    ctx.fillText('z', cx + 20, floor(desk.y - 8 - f * 14));
    if (stage === SLEEP_DEEP) {
      ctx.font = 'bold 18px system-ui';
      ctx.fillText('Z', cx + 29, floor(desk.y - 20 - f * 20));
    }
    ctx.globalAlpha = 1;
  } else {
    const marks = ['', '', '?', '!', '!!', '!!!'][stage];
    const colors = ['', '', '#ffe08a', '#ffc24d', '#ff8c42', '#ff5252'];
    const pulse = stage >= SLEEP_CRITICAL ? 0.6 + 0.4 * Math.sin(clock * 9) : 1;
    ctx.textAlign = 'center';
    ctx.globalAlpha = pulse;
    ctx.font = `bold ${16 + stage * 2}px system-ui`;
    ctx.fillStyle = colors[stage];
    ctx.fillText(marks, cx, floor(desk.y - 10));
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------- the guard
// Not asleep — bored, and looking. A desk, a chair, and a man who gets
// progressively less willing to ignore you.
// Two of them: the museum's day guard in navy at a monitor desk, and the
// night-shift security officer in black with a torch on the desk beside him.
const GUARD_LOOKS = {
  guard:    { coat: '#2f3a52', yoke: '#3e4a66', cap: '#232c40', peak: '#1b2233',
              belt: '#1f2738', flash: '#c8a24a', chair: '#3a3f52', chairTop: '#4a5064',
              torch: false },
  security: { coat: '#22242c', yoke: '#31343f', cap: '#15171c', peak: '#0f1115',
              belt: '#0e0f13', flash: '#7f8b9c', chair: '#2b2d36', chairTop: '#3a3d48',
              torch: true }
};

let glowKey = '';
let glowCache = null;

export function drawGuard(ctx, level, stage, clock, wake = 0, startle = 0, seen = 0, sees = 0,
                          kind = 'guard') {
  const look = GUARD_LOOKS[kind] || GUARD_LOOKS.guard;
  const desk = level.bed;
  const cx = level.watcher.x;
  const cy = level.watcher.y;

  // What he can see. Drawn under everything, and only bright enough to read
  // when he is actually registering you.
  if (sees > 0) {
    // The filled glow is a gradient disc three hundred pixels across, and at
    // rest its alpha is 0.017 — invisible, and the most expensive thing on the
    // frame. Paint it only once he is actually registering you; the ring below
    // is what tells you where his range ends the rest of the time.
    if (seen > 0.02) {
      // Rebuilt only when the look changes, not once a frame.
      const heat = 0.05 + Math.round(seen * 20) / 20 * 0.16;
      const key = `${cx}|${cy}|${sees}|${heat}`;
      if (key !== glowKey) {
        glowKey = key;
        glowCache = ctx.createRadialGradient(cx, cy, sees * 0.35, cx, cy, sees);
        glowCache.addColorStop(0, `rgba(255,120,90,${(heat * 0.35).toFixed(3)})`);
        glowCache.addColorStop(1, 'rgba(255,120,90,0)');
      }
      ctx.fillStyle = glowCache;
      ctx.beginPath();
      ctx.arc(cx, cy, sees, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = `rgba(255,150,110,${(0.10 + seen * 0.35).toFixed(3)})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 7]);
    ctx.beginPath();
    ctx.arc(cx, cy, sees, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Desk.
  drop(ctx, desk);
  fillRound(ctx, desk.x, desk.y, desk.w, desk.h, 7, PALETTE.woods[0].dark);
  fillRound(ctx, desk.x, desk.y, desk.w, desk.h - 8, 7, PALETTE.woods[0].base);
  fillRound(ctx, desk.x + 4, desk.y + 4, desk.w - 8, desk.h - 18, 5, PALETTE.woods[0].top);

  // A bank of monitors, still on.
  const flicker = 0.75 + 0.25 * Math.sin(clock * 7.3);
  for (let i = 0; i < 2; i++) {
    const mx = desk.x + desk.w * (0.24 + i * 0.42);
    fillRound(ctx, mx - 15, desk.y + 6, 30, 20, 3, '#20242e');
    ctx.globalAlpha = flicker;
    fillRound(ctx, mx - 12, desk.y + 9, 24, 14, 2, i ? '#3e6f86' : '#4a7f6a');
    ctx.globalAlpha = 1;
  }

  // The man himself, seated at the near edge.
  const rise = stage >= 5 ? Math.min(1, wake / 0.5) : 0;
  const ease = rise * rise * (3 - 2 * rise);
  const fidget = [0.1, 0.2, 0.45, 0.8, 1.3, 0][stage] || 0;
  const sway = Math.sin(clock * fidget * TAU) * (stage >= 2 ? 2.6 : 1.1);
  const jolt = startle > 0 ? Math.sin(clock * 24) * startle * 3.5 : 0;
  // He looks around as he gets suspicious, and stands at the end.
  const lookX = stage >= 2 ? Math.sin(clock * (0.8 + stage * 0.4)) * (2 + stage) : 0;
  const bodyX = cx + sway * 0.4 + jolt;
  const bodyY = cy + 16 - ease * 13;

  ctx.fillStyle = 'rgba(20,10,26,0.28)';
  ctx.beginPath();
  ctx.ellipse(bodyX, bodyY + 17, 13, 4.5, 0, 0, TAU);
  ctx.fill();

  // Chair back, behind him until he stands.
  if (ease < 0.5) {
    fillRound(ctx, bodyX - 13, bodyY + 2, 26, 16, 5, look.chair);
    fillRound(ctx, bodyX - 11, bodyY + 4, 22, 11, 4, look.chairTop);
  }

  // Uniform: darker and squarer than the thief, with a shoulder flash.
  fillRound(ctx, bodyX - 11, bodyY - 10, 22, 22, 7, look.coat);
  fillRound(ctx, bodyX - 11, bodyY - 10, 22, 9, 6, look.yoke);
  ctx.fillStyle = look.flash;
  ctx.fillRect(bodyX - 11, bodyY - 6, 5, 3);
  ctx.fillRect(bodyX + 6, bodyY - 6, 5, 3);
  ctx.fillStyle = look.belt;
  ctx.fillRect(bodyX - 11, bodyY + 4, 22, 3.4);

  // Head, with a peaked cap.
  const headY = bodyY - 19;
  const gaze = lookX * 0.4;
  ctx.fillStyle = PALETTE.skin;
  ctx.beginPath();
  ctx.arc(bodyX + gaze * 0.3, headY, 9, 0, TAU);
  ctx.fill();
  ctx.fillStyle = look.cap;
  ctx.beginPath();
  ctx.arc(bodyX + gaze * 0.3, headY - 1, 9, Math.PI, TAU);
  ctx.fill();
  fillRound(ctx, bodyX + gaze * 0.3 - 10, headY - 3, 20, 4, 2, look.peak);   // peak

  if (look.torch) {                                   // a torch on the desk
    const tx = desk.x + desk.w - 22;
    const ty = desk.y + desk.h * 0.5;
    fillRound(ctx, tx, ty - 3, 16, 6, 3, '#4a4d57');
    fillRound(ctx, tx + 13, ty - 4, 5, 8, 2, '#d9c98a');
    if (stage >= 2) {
      ctx.save();
      ctx.globalAlpha = 0.10 + stage * 0.04;
      ctx.fillStyle = '#ffe6a8';
      ctx.beginPath();
      ctx.moveTo(tx + 17, ty);
      ctx.lineTo(tx + 52, ty - 16);
      ctx.lineTo(tx + 52, ty + 16);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  ctx.strokeStyle = '#33291f';
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.fillStyle = '#33291f';
  if (stage <= 1) {                                   // dozing off
    ctx.beginPath();
    ctx.moveTo(bodyX - 8, headY + 2);
    ctx.quadraticCurveTo(bodyX - 5, headY + 5, bodyX - 2, headY + 2);
    ctx.moveTo(bodyX + 2, headY + 2);
    ctx.quadraticCurveTo(bodyX + 5, headY + 5, bodyX + 8, headY + 2);
    ctx.stroke();
  } else {                                            // eyes open, and moving
    const r = stage >= 4 ? 2.8 : 2.1;
    ctx.beginPath();
    ctx.arc(bodyX - 4 + gaze, headY + 2, r, 0, TAU);
    ctx.arc(bodyX + 4 + gaze, headY + 2, r, 0, TAU);
    ctx.fill();
  }

  const floor = (value) => Math.max(WT + 6, value);
  if (stage <= 1) {
    const f = (clock * 0.5) % 1;
    ctx.textAlign = 'left';
    ctx.globalAlpha = Math.max(0, 1 - f);
    ctx.fillStyle = '#ffffffcc';
    ctx.font = 'bold 12px system-ui';
    ctx.fillText('z', bodyX + 14, floor(headY - 12 - f * 12));
    ctx.globalAlpha = 1;
  } else {
    const marks = ['', '', '?', '!', '!!', '!!!'][stage];
    const colors = ['', '', '#ffe08a', '#ffc24d', '#ff8c42', '#ff5252'];
    const pulse = stage >= 4 ? 0.6 + 0.4 * Math.sin(clock * 9) : 1;
    ctx.textAlign = 'center';
    ctx.globalAlpha = pulse;
    ctx.font = `bold ${16 + stage * 2}px system-ui`;
    ctx.fillStyle = colors[stage];
    ctx.fillText(marks, cx, floor(desk.y - 10));
    ctx.globalAlpha = 1;
  }
}

// ------------------------------------------------------------- people walking
// One figure, drawn for anyone who walks: the thief, and Mr. Vrána once he is
// off the couch. Sharing the code is not tidiness — it is the guarantee that
// the caretaker moves like a person rather than like a prop, because there is
// only one idea of what walking looks like in the game and both of them use it.
//
// Everything about the pose is driven by how fast the figure is actually
// travelling, which the simulation measures from ground covered rather than
// from what the stick is doing. So the legs can never run while the body
// crawls: there is nothing for them to disagree about.
const THIEF_LOOK = {
  body: PALETTE.thief, top: PALETTE.thiefTop, belt: PALETTE.thiefBelt,
  skin: PALETTE.skin, skinShade: PALETTE.skinShade, hair: '#4a3a2c',
  shoe: '#3f4568', sole: '#6a7196',
  head: 'beanie', build: 1
};

// Mr. Vrána: heavier, in the school's olive work coat, grey and thin on top.
const CARETAKER_LOOK = {
  body: '#6f7c4e', top: '#899763', belt: '#4d5636',
  skin: '#e8bb92', skinShade: '#cfa079', hair: '#9aa0a6', shoe: '#4a4034', sole: '#7d7263',
  head: 'bare', build: 1.13
};

/**
 * @param facing    heading in radians
 * @param walkPhase walk-cycle phase, advanced by distance travelled
 * @param walk      0..1 share of top speed
 * @param creep     0..1 how much of a tiptoe this is
 * @param run       0..1 how much of a run this is
 * @param stand     0..1 upright, for getting off a couch
 * @param reach     0..1 grab progress
 */
export function drawWalker(ctx, x, y, opts, look = THIEF_LOOK) {
  const { facing, walkPhase, walk, clock, reach = 0 } = opts;
  const creep = opts.creep || 0;
  const run = opts.run || 0;
  // How much the legs are cycling, and how long each step is. Kept apart on
  // purpose: a slow creep is a short step taken often, not a faint suggestion
  // of a step. Using speed for both is what made a quarter-speed walk look
  // like a man standing still while sliding across the floor.
  const cycling = opts.moving === undefined ? Math.min(1, walk / 0.12) : opts.moving;
  const strideScale = opts.stride === undefined ? 1 : opts.stride;
  const stand = opts.stand === undefined ? 1 : opts.stand;
  const build = look.build || 1;

  const faceX = Math.cos(facing);
  const faceY = Math.sin(facing);
  // Sideways axis, so the two feet always sit beside each other whichever way
  // he walks, and the stride runs along the direction of travel.
  const sideX = -faceY;
  const sideY = faceX;
  // How side-on he is. A body seen from the side is narrower than one seen
  // face-on, and that — not a mirrored sprite — is what tells you he is
  // travelling left or right rather than towards you.
  const sideOn = Math.abs(faceX);
  const turn = faceX;   // -1 hard left, +1 hard right

  // Still getting up? Everything is drawn shorter and closer to the couch, so
  // he unfolds rather than popping into existence standing.
  const upright = stand * stand * (3 - 2 * stand);
  if (upright < 0.999) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(0.72 + 0.28 * upright, 0.34 + 0.66 * upright);
    ctx.translate(-x, -y + (1 - upright) * 9);
  }

  const swing = Math.sin(walkPhase) * cycling;
  const breathe = Math.sin(clock * 1.9) * (1 - cycling) * 0.6;
  // Creeping keeps the head low and level; running throws it about.
  const bob = -Math.abs(Math.sin(walkPhase)) * (1.5 + run * 1.9) * cycling * (1 - creep * 0.6)
    + breathe;
  // Weight shifts onto the planted foot: the torso leans a touch that way, and
  // leans into the run. A creep crouches instead.
  const weight = -swing * (1.3 + run * 0.9);
  const lean = run * 1.8;
  const crouch = creep * 2.4 * cycling;
  const bodyX = x + sideX * weight + faceX * lean;
  const bodyY = y + bob + faceY * lean * 0.5 + crouch;

  ctx.fillStyle = 'rgba(20,10,26,0.30)';
  ctx.beginPath();
  ctx.ellipse(x, y + 20, 10.5 * build, 4, 0, 0, TAU);
  ctx.fill();

  // Legs are two segments with a knee, so the stride reads as walking rather
  // than as feet sliding. Both stay below the torso whichever way he faces.
  // Step length, from the cadence rather than from taste: the two multiply to
  // speed, so this is the only value at which the feet are not skating.
  const stride = 5.4 * strideScale;
  const drawLeg = (side, phase) => {
    // Creeping picks the foot up higher and puts it down more deliberately.
    const lift = Math.max(0, phase) * (1 + run * 0.8 + creep * 0.5);
    const hipX = bodyX + sideX * 4.4 * build * side;
    const hipY = bodyY + 4 + sideY * 4.4 * build * side;
    const footX = x + sideX * 4.6 * build * side + faceX * phase * stride;
    const footY = y + 14 + sideY * 4.6 * build * side + faceY * phase * 1.7 - lift * 1.2;

    // The knee sits between hip and foot, pushed forward as the leg swings —
    // and bent further when creeping, which is what a crouch is.
    const kneeX = (hipX + footX) / 2 + faceX * (lift * 2.2 + creep * 1.6 * cycling);
    const kneeY = (hipY + footY) / 2 - 0.6 - lift * 1.1;

    ctx.strokeStyle = look.body;
    ctx.lineCap = 'round';
    ctx.lineWidth = 5.4 * build;
    ctx.beginPath();
    ctx.moveTo(hipX, hipY);
    ctx.lineTo(kneeX, kneeY);
    ctx.stroke();
    ctx.lineWidth = 4.6 * build;
    ctx.beginPath();
    ctx.moveTo(kneeX, kneeY);
    ctx.lineTo(footX, footY - 1);
    ctx.stroke();

    fillRound(ctx, footX - 3.7, footY - 4, 7.4, 8.6 - lift * 1.8, 3, look.belt);
    fillRound(ctx, footX - 2.7, footY - 3.2, 5.4, 3, 1.8, look.shoe);
    fillRound(ctx, footX - 3.5, footY + 3.2 - lift * 1.8, 7, 1.8, 0.9, look.sole);
  };
  drawLeg(-1, swing);
  drawLeg(1, -swing);

  // The torso narrows as he turns side-on, which is what actually reads as
  // "he is facing that way" — a body square to the camera while walking left
  // is the mismatch worth fixing.
  const halfW = 8.5 * build * (1 - sideOn * 0.26);
  // ...and leads with the near shoulder, so the chest is turned rather than
  // merely thinner. A narrow square torso reads as a distant one, not a turned
  // one; an offset one reads as a body angled across the screen.
  const shoulderLead = turn * sideOn * 1.7;
  fillRound(ctx, bodyX - halfW + shoulderLead, bodyY - 9, halfW * 2, 17, 7, look.body);
  fillRound(ctx, bodyX - halfW + shoulderLead, bodyY - 9, halfW * 2, 8, 6, look.top);
  // Cloth folds across the chest, leaning with the weight shift.
  ctx.strokeStyle = 'rgba(12,14,26,0.30)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bodyX - halfW * 0.6 + shoulderLead, bodyY - 2);
  ctx.quadraticCurveTo(bodyX + weight * 0.4 + shoulderLead, bodyY + 0.5,
    bodyX + halfW * 0.6 + shoulderLead, bodyY - 2);
  ctx.stroke();
  ctx.fillStyle = look.belt;
  ctx.fillRect(bodyX - halfW + shoulderLead, bodyY + 3.5, halfW * 2, 3.2);
  if (look.head === 'beanie') {
    fillRound(ctx, bodyX - 2.4 + shoulderLead, bodyY + 3.4, 4.8, 3.4, 1, '#d8b24a');  // buckle
    ctx.fillStyle = '#8d6f22';
    ctx.fillRect(bodyX - 0.6 + shoulderLead, bodyY + 4.2, 1.2, 1.8);
  }

  // Arms sit outside the torso and are drawn over it, with a slight elbow. The
  // far one is drawn first and darker, so side-on he has a near arm and a far
  // arm rather than two arms at the same depth.
  const drawArm = (side, extend, far) => {
    const shoulderX = bodyX + shoulderLead + sideX * (halfW + 0.3) * side;
    const shoulderY = bodyY - 4 + sideY * 8.8 * build * side;
    // Creeping holds the arms in close; running throws them.
    const swingScale = (3.8 + run * 3.2) * (1 - creep * 0.55);
    // Opposite arm, opposite leg. drawLeg(-1, …) sends the -1 leg forward on a
    // positive swing, so the -1 arm has to go back on one — the sign here was
    // inverted, which is the whole difference between a walk and a march.
    const reachOut = swing * side * swingScale + extend;
    const handX = shoulderX + faceX * reachOut + sideX * side * 1.6;
    const handY = shoulderY + faceY * reachOut * 0.66 + sideY * side * 1.6 + 4;
    const elbowX = (shoulderX + handX) / 2 + sideX * side * 1.1;
    const elbowY = (shoulderY + handY) / 2 + 0.8;

    ctx.save();
    if (far) ctx.globalAlpha = 1 - sideOn * 0.45;
    ctx.strokeStyle = look.top;
    ctx.lineWidth = 5 * build;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(shoulderX, shoulderY);
    ctx.quadraticCurveTo(elbowX, elbowY, handX, handY);
    ctx.stroke();
    ctx.fillStyle = look.skin;                             // a mitt, not a dot
    ctx.translate(handX, handY);
    ctx.rotate(Math.atan2(handY - shoulderY, handX - shoulderX));
    ctx.beginPath();
    ctx.ellipse(0, 0, 3.2, 2.5, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    return { x: handX, y: handY };
  };

  // Reach: out fast, back slower, so the grab has a snap to it.
  const extend = reach > 0 ? Math.sin(Math.min(1, reach) * Math.PI) * 11 : 0;
  // Which arm is behind him depends on which way he has turned.
  const farSide = turn >= 0 ? -1 : 1;
  drawArm(farSide, extend * 0.3, true);
  const hand = drawArm(-farSide, extend, false);

  drawHead(ctx, bodyX, bodyY - 16 + Math.sin(walkPhase * 2) * 0.4 * cycling,
    { faceX, faceY, sideOn, turn, creep, cycling }, look);

  if (upright < 0.999) ctx.restore();
  return hand;
}

// The head, and everything about it that says which way he is looking.
//
// A round head is the same shape from every angle, so left and right have to
// be told apart by what is on it: the face slides towards the direction of
// travel, the hair and ear stay behind, and a nose leads. Drawn as a profile
// when he is travelling sideways and face-on when he is coming towards you,
// so the direction of travel is legible without a HUD arrow.
function drawHead(ctx, x, headY, { faceX, faceY, sideOn, turn, creep, cycling }, look) {
  const beanie = look.head === 'beanie';
  const radius = 8;
  // Creeping pulls the chin down and the head forward.
  const y = headY + creep * cycling * 1.4;
  // Everything on the face rides this far towards where he is going.
  const shift = turn * sideOn * 2.2;

  ctx.fillStyle = look.skin;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.fill();

  if (faceY < -0.45) {
    // Walking away: the back of his head. It still has to read as a head —
    // a flat dark disc is a hole in the floor, so the hat keeps its brim, the
    // hair shows beneath it, and an ear catches the light on whichever side he
    // is angled towards.
    ctx.fillStyle = look.hair;
    ctx.beginPath();
    ctx.arc(x, y + 1, radius, 0, TAU);
    ctx.fill();
    if (sideOn > 0.28) {
      ctx.fillStyle = look.skin;
      ctx.beginPath();
      ctx.ellipse(x + turn * (radius - 1.2), y + 2, 1.5, 2.2 * sideOn, 0, 0, TAU);
      ctx.fill();
    }
    if (beanie) {
      ctx.fillStyle = look.belt;
      ctx.beginPath();
      ctx.arc(x, y - 0.5, radius, Math.PI, TAU);
      ctx.fill();
      ctx.fillRect(x - radius, y - 1.5, radius * 2, 3.4);
      // The turn-up, a shade lighter, so the hat is a hat from behind too.
      ctx.fillStyle = look.top;
      ctx.fillRect(x - radius, y + 0.6, radius * 2, 1.5);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.beginPath();
      ctx.ellipse(x - turn * 1.5, y - 4, 4.2, 1.9, 0, 0, TAU);
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.20)';
      ctx.beginPath();
      ctx.arc(x, y + 3, 5.2, 0, Math.PI);
      ctx.fill();
    }
    return;
  }

  // Hair round the back of the head — the trailing side — so it swings across
  // as he turns and the crown is always behind the face.
  ctx.fillStyle = look.hair;
  ctx.beginPath();
  ctx.arc(x - turn * sideOn * 2.4, y - 0.2, radius - 0.3, Math.PI * 0.86, TAU * 1.08);
  ctx.fill();

  // The ear, on the trailing side, and the nose leading. Between them they are
  // most of what makes a 16-pixel head point somewhere — but only just: a nose
  // that clears the head is a beak, so it barely breaks the outline.
  if (sideOn > 0.22) {
    ctx.fillStyle = look.skinShade || 'rgba(0,0,0,0.16)';
    ctx.beginPath();
    ctx.ellipse(x - turn * (radius - 2), y + 1.6, 1.3, 2 * sideOn, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = look.skin;
    ctx.beginPath();
    ctx.moveTo(x + turn * (radius - 3.2), y + 1.2);
    ctx.lineTo(x + turn * (radius - 0.4 + 0.9 * sideOn), y + 3);
    ctx.lineTo(x + turn * (radius - 3.2), y + 4.4);
    ctx.closePath();
    ctx.fill();
  }

  if (beanie) {
    ctx.fillStyle = look.belt;
    ctx.beginPath();
    ctx.arc(x, y - 1, radius, Math.PI, TAU);
    ctx.fill();
    ctx.fillRect(x - radius, y - 2, radius * 2, 3.6);
    ctx.fillStyle = 'rgba(255,255,255,0.13)';                // rim light
    ctx.beginPath();
    ctx.ellipse(x - 2.5 + shift, y - 5, 4.4, 2, -0.4, 0, TAU);
    ctx.fill();
  } else {
    // Thin on top, so the crown shows: a different silhouette from the beanie
    // at a glance, which is all a 16-pixel head has to manage.
    ctx.fillStyle = look.skin;
    ctx.beginPath();
    ctx.ellipse(x - turn * 0.8, y - 3.4, radius - 2.4, 3.4, 0, 0, TAU);
    ctx.fill();
  }

  // Eyes sit on the leading side of the face, and one of them goes behind the
  // nose once he is properly side-on.
  const gazeY = Math.max(0, faceY) * 1.2;
  const spread = 3 * (1 - sideOn * 0.5);
  const eye = (dx) => {
    ctx.beginPath();
    ctx.arc(x + shift + dx, y + 2 + gazeY, 1.8, 0, TAU);
    ctx.fill();
  };
  ctx.fillStyle = '#fff';
  eye(spread);
  if (sideOn < 0.72) eye(-spread);
  // Pupils, pushed to the leading edge: at this size two white dots read as
  // surprise rather than as looking anywhere.
  ctx.fillStyle = '#2a2233';
  ctx.beginPath();
  ctx.arc(x + shift + spread + turn * sideOn * 0.7, y + 2.2 + gazeY, 0.85, 0, TAU);
  if (sideOn < 0.72) ctx.arc(x + shift - spread + turn * sideOn * 0.7, y + 2.2 + gazeY, 0.85, 0, TAU);
  ctx.fill();
}

// ---------------------------------------------------------------- the thief
export function drawThief(ctx, x, y, opts) {
  return drawWalker(ctx, x, y, opts, THIEF_LOOK);
}

// Mr. Vrána on his feet — the same walk, a heavier man in it.
export function drawCaretakerWalking(ctx, x, y, opts) {
  return drawWalker(ctx, x, y, opts, CARETAKER_LOOK);
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
