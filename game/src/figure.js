// The people you can see walking about.
//
// Everything here is one function drawing one human from any angle, at any
// speed, out of flat shapes. There are no sprite sheets and no eight baked
// directions: the pose is computed from a heading and a walk phase, which is
// what lets a diagonal look like a diagonal rather than like a left-facing
// character shoved sideways.
//
// The two rules the whole file exists to keep:
//
//   1. Nothing about the pose is invented. Stride length, cadence, lean and
//      arm swing all come from the speed the character is actually travelling
//      at, which the simulation measures from ground covered. The feet cannot
//      disagree with the floor because they are driven by it.
//
//   2. Arms oppose legs. Left arm forward with right leg forward. This is the
//      single difference between "a person walking" and "a toy marching", and
//      it is one sign in the code.
import { TUNING } from './tuning.js';

const TAU = Math.PI * 2;

// --- proportions -------------------------------------------------------------
// Read off the reference: a big head on a chunky body, about three and a bit
// heads tall. Origin is the point the character stands on, so y grows downward
// into the floor and every measurement below is an offset from the feet.
const GROUND = 16;       // where the soles rest
const ANKLE_Y = 11;
const HIP_Y = -2;
const HEM_Y = 3;        // the bottom of the sweater, which the legs come out of
const SHOULDER_Y = -14;
const HEAD_Y = -21.5;
const HEAD_R = 7.4;

const HIP_W = 3.2;      // half the distance between the hips
const FOOT_W = 3.8;
const SHOULDER_W = 8.4;
const HEM_W = 7.4;

// How much of a step you see when the character walks towards or away from the
// camera rather than across it. The view is from above and in front, so travel
// along the screen's y axis is heavily foreshortened — this is the number that
// keeps a step looking like a step from every angle.
const FORESHORTEN = 0.42;

// --- the two people ----------------------------------------------------------
// Flat cartoon shading: a base tone, a lit tone for the top of each mass, and a
// dark tone for the underside. Three fills rather than a gradient, because
// gradients are rasterised per pixel per frame and these are not.
export const THIEF_LOOK = {
  skin: '#f0c9a4', skinDark: '#d6a97f',
  coat: '#2f3856', coatLit: '#3f4a70', coatDark: '#1f2740',
  trouser: '#252c47', trouserLit: '#333c5e',
  shoe: '#8b98b8', shoeLit: '#a7b3ce', sole: '#e8edf5',
  hair: '#5b4130', hat: '#1e2440', hatLit: '#2b3355',
  rim: '#1a2038',            // the dark edge that keeps limbs off the body
  crown: 'beanie',
  brow: '#3a2c22',
  mouth: '#8a5f4d',
  build: 1
};

// Mr. Vrána: older, heavier, grey round the sides, in the school's olive
// work sweater and boots. Different at a glance from the thief's silhouette
// even before you can see either face.
export const CARETAKER_LOOK = {
  skin: '#e9bd95', skinDark: '#c99b73',
  coat: '#77854f', coatLit: '#8f9d63', coatDark: '#5b6739',
  trouser: '#616c40', trouserLit: '#77834f',
  shoe: '#4a3b2b', shoeLit: '#5f4d39', sole: '#7d6d58',
  hair: '#b6bcc1', hat: null,
  rim: '#4a5432',
  crown: 'balding',
  brow: '#9aa1a6',
  moustache: '#a3abb1',
  mouth: '#9a6a56',
  build: 1.12
};

// --- small drawing helpers ---------------------------------------------------
// A two-segment limb with a knee or elbow, drawn over a slightly fatter dark
// copy of itself. That rim is the whole reason an arm reads as being in front
// of a body the same colour as it — at this size, value contrast is the only
// separation there is room for.
function limb(ctx, ax, ay, bx, by, cx, cy, wide, narrow, colour, rim) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Both segments in one path, and one path per pass. A stroke is the most
  // expensive thing this file can ask for, so a limb costs two of them rather
  // than four — the thigh-to-shin taper it gives up was never visible at the
  // size these are actually drawn.
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.lineTo(cx, cy);
  if (rim) {
    ctx.strokeStyle = rim;
    ctx.lineWidth = wide + 1.7;
    ctx.stroke();
  }
  ctx.strokeStyle = colour;
  ctx.lineWidth = (wide + narrow) / 2;
  ctx.stroke();
}

function blob(ctx, x, y, rx, ry, rot, colour) {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
  ctx.fill();
}

/**
 * One person, drawn from any heading at any speed.
 *
 * pose:
 *   facing     heading in radians
 *   walkPhase  walk-cycle phase, advanced by ground covered
 *   walk       0..1 share of top speed
 *   creep      0..1 how much of a tiptoe this is
 *   run        0..1 how much of a run this is
 *   moving     0..1 whether the legs are cycling at all
 *   stride     step length relative to a normal walk
 *   clock      seconds, for breathing
 *   reach      0..1 grab progress
 *   stand      0..1 upright, for getting off a couch
 */
export function drawFigure(ctx, x, y, pose, look) {
  const { facing, walkPhase, clock } = pose;
  const creep = pose.creep || 0;
  const run = pose.run || 0;
  const cycling = pose.moving === undefined ? 0 : pose.moving;
  const strideScale = pose.stride === undefined ? 1 : pose.stride;
  const reach = pose.reach || 0;
  const stand = pose.stand === undefined ? 1 : pose.stand;
  // A turn of the head on its own, without the body following. This is what
  // "having a look round" is: you do not rotate on the spot to do it.
  const glance = pose.glance || 0;
  // Hands in a drawer: he folds down over whatever he is opening. Separate
  // from `reach`, which is the quick snatch of something off a shelf — this is
  // a man crouched and rummaging, and it should look like work.
  const rummage = pose.search || 0;
  const build = look.build || 1;

  // Travel frame: "along" is where he is going, "across" is his own left-right.
  const faceX = Math.cos(facing);
  const faceY = Math.sin(facing);
  const acrossX = -faceY;
  const acrossY = faceX;
  // How side-on he is, and which way the profile points. These two decide the
  // whole silhouette: a body square to the camera is coming towards you, a
  // narrow one is crossing the screen.
  const sideOn = Math.abs(faceX);
  const turn = faceX >= 0 ? 1 : -1;
  // Facing away: the back of the head, no face, and the far limbs swap over.
  const away = faceY < -0.3;
  const faceShow = Math.max(0, Math.min(1, (faceY + 0.35) / 0.35));

  // Still getting off the couch — everything folds down towards the seat.
  const upright = stand * stand * (3 - 2 * stand);
  if (upright < 0.999) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(0.78 + 0.22 * upright, 0.30 + 0.70 * upright);
    ctx.translate(-x, -y + (1 - upright) * 11);
  }

  // --- the cycle -------------------------------------------------------------
  const swing = Math.sin(walkPhase) * cycling;
  // Two dips per cycle: the body is lowest as a foot lands and rises over the
  // planted leg. Running exaggerates it; creeping flattens it, because keeping
  // your head level is most of what being quiet looks like.
  const bob = -Math.abs(Math.sin(walkPhase)) * (1.4 + run * 2.2) * cycling * (1 - creep * 0.65);
  const breathe = Math.sin(clock * 1.9) * (1 - cycling) * 0.55;
  // Hips shift towards the leg carrying the weight; shoulders counter-rotate
  // against them. Small numbers, but this is what stops the torso being a board.
  const hipSway = -swing * (1.1 + run * 0.7);
  const twist = swing * (1.4 + run * 1.1) * (1 - creep * 0.4);
  // Leaning into the run, crouching into the creep.
  const lean = run * 2.2;
  // The rummage bobs: he leans in, roots about, leans in again.
  const dig = rummage > 0 ? 0.5 - 0.5 * Math.cos(rummage * Math.PI * 4) : 0;
  const crouch = creep * cycling * 2.6 + rummage * (3.4 + dig * 1.6);

  const centreX = x + acrossX * hipSway * 0.5 + faceX * (lean + rummage * 2.2);
  const centreY = y + bob + breathe + crouch + acrossY * hipSway * 0.5
    + faceY * (lean + rummage * 2.2) * FORESHORTEN;

  const stride = 5.9 * strideScale * build;
  const along = (amount) => ({ x: faceX * amount, y: faceY * amount * FORESHORTEN });

  // --- shadow ----------------------------------------------------------------
  ctx.fillStyle = 'rgba(16,8,22,0.28)';
  ctx.beginPath();
  ctx.ellipse(x, y + 18, 11 * build, 4, 0, 0, TAU);
  ctx.fill();

  // --- legs ------------------------------------------------------------------
  // side is the character's own left/right; phase is where that leg is in the
  // cycle. The lifted foot is the one swinging forward.
  const drawLeg = (side, phase, far) => {
    const lift = Math.max(0, phase) ** 1.25 * cycling * (2.4 + run * 2.6);
    const step = along(phase * stride);
    const hipX = centreX + acrossX * HIP_W * side * build;
    const hipY = centreY + HIP_Y + acrossY * HIP_W * side * build;
    const ankleX = x + acrossX * FOOT_W * side * build + step.x;
    const ankleY = y + ANKLE_Y + acrossY * FOOT_W * side * build + step.y - lift;
    // The knee leads the ankle through the swing, which is what a bent leg
    // looks like from the side, and is bent further the lower the crouch.
    const bend = (Math.max(0, phase) * 2.6 + creep * 2.2 + run * 1.4) * cycling
      + rummage * 2.4;
    const kneeX = (hipX + ankleX) / 2 + faceX * bend;
    const kneeY = (hipY + ankleY) / 2 + faceY * bend * FORESHORTEN - 0.4;

    if (far) ctx.globalAlpha = 1 - sideOn * 0.28;
    limb(ctx, hipX, hipY, kneeX, kneeY, ankleX, ankleY,
      5.6 * build, 4.8 * build, look.trouser, look.rim);
    drawShoe(ctx, ankleX, ankleY, phase, look, build, faceX, faceY, cycling, creep);
    ctx.globalAlpha = 1;
  };

  // The far leg is the one on the far side of the body from the camera, which
  // depends on which way he has turned and whether he is coming or going.
  const farLeg = away ? turn : -turn;
  drawLeg(farLeg, farLeg === -1 ? swing : -swing, true);
  drawLeg(-farLeg, -farLeg === -1 ? swing : -swing, false);

  // --- the far arm, behind the body ------------------------------------------
  const armOf = (side, far) => {
    // Arms oppose legs: the arm on a side swings against that side's leg.
    const legPhase = side === -1 ? swing : -swing;
    const phase = -legPhase;
    const reachOut = reach > 0 && !far ? Math.sin(Math.min(1, reach) * Math.PI) * 12
      : rummage > 0 ? 7.5 + dig * 3.5 : 0;
    // Held in and barely swinging while creeping; pumped and bent while running.
    const amplitude = (3.9 + run * 3.0) * (1 - creep * 0.62);
    const swingAt = phase * amplitude + reachOut;
    const shoulderX = centreX + acrossX * SHOULDER_W * side * build * 0.92
      + faceX * twist * side * 0.35;
    const shoulderY = centreY + SHOULDER_Y + 3 + acrossY * SHOULDER_W * side * build * 0.92
      + faceY * twist * side * 0.35 * FORESHORTEN;
    // A running arm is bent at the elbow and rides high; a creeping one is
    // tucked; a walking one hangs and swings from the shoulder.
    const raise = run * 4.4 + creep * 2.2 - rummage * 3.2;
    const step = along(swingAt);
    const wristX = shoulderX + step.x + acrossX * side * 0.6;
    const wristY = shoulderY + step.y + acrossY * side * 0.6 + 11 - raise;
    const elbowStep = along(swingAt * 0.45);
    const elbowX = shoulderX + elbowStep.x + acrossX * side * 1.1;
    const elbowY = shoulderY + elbowStep.y + acrossY * side * 1.1 + 5.8 - raise * 0.35;

    if (far) ctx.globalAlpha = 1 - sideOn * 0.30;
    limb(ctx, shoulderX, shoulderY, elbowX, elbowY, wristX, wristY,
      5.0 * build, 4.2 * build, far ? look.coatDark : look.coat, look.rim);
    // Cuff, then the hand: the sleeve has to end somewhere or the arm reads as
    // a bare tube the same colour as the sweater.
    blob(ctx, wristX, wristY, 2.2 * build, 2.0 * build, 0, look.coatDark);
    const reachOutX = wristX - elbowX;
    const reachOutY = wristY - elbowY;
    const len = Math.hypot(reachOutX, reachOutY) || 1;
    blob(ctx, wristX + (reachOutX / len) * 1.9, wristY + (reachOutY / len) * 1.9,
      1.9 * build, 1.8 * build, 0, far ? look.skinDark : look.skin);
    ctx.globalAlpha = 1;
    return { x: wristX, y: wristY };
  };

  const farArm = away ? turn : -turn;
  armOf(farArm, true);

  // --- torso -----------------------------------------------------------------
  drawTorso(ctx, centreX, centreY, {
    acrossX, acrossY, faceX, faceY, sideOn, twist, build, look
  });

  const hand = armOf(-farArm, false);

  // --- head ------------------------------------------------------------------
  // The head lags the body a touch and bobs at half the leg rate, which is the
  // difference between a head riding on shoulders and a head bolted to them.
  const headX = centreX + acrossX * twist * 0.22 + faceX * (creep * cycling * 1.6);
  const headY = centreY + HEAD_Y + Math.sin(walkPhase * 2) * 0.5 * cycling
    + creep * cycling * 0.8;
  const look2 = facing + glance;
  const gX = Math.cos(look2);
  const gY = Math.sin(look2);
  drawHead(ctx, headX, headY + rummage * 1.8, {
    sideOn: Math.abs(gX),
    turn: gX >= 0 ? 1 : -1,
    away: gY < -0.3,
    faceShow: Math.max(0, Math.min(1, (gY + 0.35) / 0.35)),
    build
  }, look);

  if (upright < 0.999) ctx.restore();
  return hand;
}

// A shoe, pointing where he is going, rolling heel-to-toe through the step.
function drawShoe(ctx, ax, ay, phase, look, build, faceX, faceY, cycling, creep) {
  // Its heading, foreshortened the same way every other length is, so a shoe
  // seen from behind is a short stub and one seen side-on is a full profile.
  const heading = Math.atan2(faceY * FORESHORTEN, faceX);
  // Heel strike at the front of the stride, toe-off at the back. Creeping keeps
  // the heel up the whole time — he is on the balls of his feet.
  const roll = (-phase * 0.30 + creep * cycling * 0.22) * cycling;
  ctx.save();
  ctx.translate(ax, ay + 3.4);
  ctx.rotate(heading + roll);
  const long = 4.3 * build;
  const tall = 2.5 * build;
  ctx.fillStyle = look.shoe;
  ctx.beginPath();
  ctx.ellipse(0.8, 0, long, tall, 0, 0, TAU);
  ctx.fill();
  // Toe cap, catching the light.
  ctx.fillStyle = look.shoeLit;
  ctx.beginPath();
  ctx.ellipse(long * 0.42, -0.5, long * 0.46, tall * 0.66, 0, 0, TAU);
  ctx.fill();
  // Sole, a pale strip along the ground edge.
  ctx.fillStyle = look.sole;
  ctx.beginPath();
  ctx.ellipse(0.8, tall * 0.58, long * 0.92, tall * 0.34, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// The sweater. Rounded, boxy, a lit band across the top and a dark hem, with
// the shoulders turned along the direction of travel.
function drawTorso(ctx, cx, cy, { acrossX, acrossY, faceX, faceY, sideOn, twist, build, look }) {
  // Narrower seen from the side than from the front — this, more than anything
  // on the face, is what says he is crossing the screen rather than facing you.
  const shoulder = SHOULDER_W * build * (1 - sideOn * 0.22);
  const hem = HEM_W * build * (1 - sideOn * 0.20);
  const top = cy + SHOULDER_Y;
  const bottom = cy + HEM_Y;
  // The shoulder line rotates against the hips.
  const lead = faceX * twist * 0.5;
  const leadY = faceY * twist * 0.5 * FORESHORTEN;

  const path = () => {
    ctx.beginPath();
    ctx.moveTo(cx - shoulder + lead, top + 4 + leadY);
    ctx.quadraticCurveTo(cx - shoulder + lead, top + leadY, cx - shoulder * 0.62 + lead, top - 0.6 + leadY);
    ctx.quadraticCurveTo(cx + lead, top - 2.6 + leadY, cx + shoulder * 0.62 + lead, top - 0.6 + leadY);
    ctx.quadraticCurveTo(cx + shoulder + lead, top + leadY, cx + shoulder + lead, top + 4 + leadY);
    ctx.lineTo(cx + hem, bottom - 2.4);
    ctx.quadraticCurveTo(cx + hem, bottom, cx + hem - 2, bottom);
    ctx.lineTo(cx - hem + 2, bottom);
    ctx.quadraticCurveTo(cx - hem, bottom, cx - hem, bottom - 2.4);
    ctx.closePath();
  };

  ctx.fillStyle = look.coat;
  path();
  ctx.fill();

  // Light from above, inset so it stays inside the sweater without a clip.
  ctx.fillStyle = look.coatLit;
  ctx.beginPath();
  ctx.ellipse(cx + lead - shoulder * 0.16, top + 3.2, shoulder * 0.80, 4.4, 0, 0, TAU);
  ctx.fill();

  // A shadow along the hem, where the sweater falls away from the hips.
  ctx.fillStyle = look.coatDark;
  ctx.beginPath();
  ctx.ellipse(cx, bottom - 1.4, hem * 0.94, 2.2, 0, 0, TAU);
  ctx.fill();
}

// The head, and everything on it that says which way he is looking.
//
// Laid out off the head radius rather than off absolute numbers, because every
// feature has to stay in the same place when the caretaker is drawn a tenth
// larger than the thief. Eyes sit a little below centre, brows above them, the
// hat brim clear of both — the first draft had the beanie resting on his
// eyebrows, which is the sort of thing you only see once you draw it.
function drawHead(ctx, x, y, view, look) {
  const { sideOn, turn, away, faceShow, build } = view;
  const r = HEAD_R * build;
  const beanie = look.crown === 'beanie';
  // Everything on the face rides towards where he is going.
  const shift = turn * sideOn * 2.2 * build;
  const browY = y - r * 0.20;
  const eyeY = y + r * 0.14;
  const mouthY = y + r * 0.54;

  // The shadow under the chin, so the head sits on the shoulders instead of
  // hovering over them. Short and tucked right under the jaw — any lower and
  // it stops reading as a neck and starts reading as a bib.
  ctx.fillStyle = look.coatDark;
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.92, 2.7 * build, 2.2 * build, 0, 0, TAU);
  ctx.fill();

  // Hair: wider than the head but shorter, and sitting low. That makes it a
  // band round the sides and the back rather than a cap behind the face, which
  // is the difference between a man going grey at the temples and a man in a
  // bonnet. The crown stays bare, which is the point for Mr. Vrána.
  ctx.fillStyle = look.hair;
  ctx.beginPath();
  ctx.ellipse(x - turn * sideOn * 0.9, y + r * 0.22, r * 1.11, r * 0.82, 0, 0, TAU);
  ctx.fill();

  // The face, sitting over it.
  ctx.fillStyle = look.skin;
  ctx.beginPath();
  ctx.ellipse(x + shift * 0.22, y, r * 0.95, r, 0, 0, TAU);
  ctx.fill();

  if (away) {
    // Walking away: no face at all. The back of a head is a hair mass, plus an
    // ear catching the light on whichever side he is angled towards.
    ctx.fillStyle = look.hair;
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.10, r * 1.02, r * 0.96, 0, 0, TAU);
    ctx.fill();
    if (!beanie) {
      // Bald from behind too — the crown shows through the grey.
      ctx.fillStyle = look.skin;
      ctx.beginPath();
      ctx.ellipse(x, y - r * 0.40, r * 0.72, r * 0.52, 0, 0, TAU);
      ctx.fill();
    }
    if (sideOn > 0.25) {
      ctx.fillStyle = look.skin;
      ctx.beginPath();
      ctx.ellipse(x + turn * r * 0.90, y + 1.2, 1.5 * build, 2.3 * sideOn * build, 0, 0, TAU);
      ctx.fill();
    }
    if (beanie) drawBeanie(ctx, x, y, r, turn, sideOn, look, true);
    else drawCrownLight(ctx, x, y, r, turn, look);
    return;
  }

  // Ear on the trailing side, nose leading. Between them they are most of what
  // makes a round head point somewhere at sixteen pixels across.
  if (sideOn > 0.20) {
    ctx.fillStyle = look.skinDark;
    ctx.beginPath();
    ctx.ellipse(x - turn * (r - 1.7), y + r * 0.22, 1.4 * build, 2.1 * sideOn * build, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = look.skin;
    ctx.beginPath();
    ctx.moveTo(x + turn * (r - 3.0), y + r * 0.10);
    ctx.lineTo(x + turn * (r - 0.3 + 1.0 * sideOn), y + r * 0.36);
    ctx.lineTo(x + turn * (r - 3.0), y + r * 0.58);
    ctx.closePath();
    ctx.fill();
  }

  // Features fade rather than pop as he turns away.
  ctx.save();
  ctx.globalAlpha = faceShow;
  const spread = 3.0 * build * (1 - sideOn * 0.44);
  const eye = (dx) => {
    ctx.fillStyle = '#fdfdff';
    ctx.beginPath();
    ctx.ellipse(x + shift + dx, eyeY, 1.9 * build, 2.2 * build, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#2b2333';
    ctx.beginPath();
    ctx.arc(x + shift + dx + turn * sideOn * 0.7, eyeY + 0.3, 1.05 * build, 0, TAU);
    ctx.fill();
  };
  eye(spread);
  if (sideOn < 0.74) eye(-spread);

  // Brows, angled in. A stealth game's characters should not look delighted.
  ctx.strokeStyle = look.brow;
  ctx.lineWidth = 1.5 * build;
  ctx.lineCap = 'round';
  const brow = (dx) => {
    const inner = dx > 0 ? -1 : 1;
    ctx.beginPath();
    ctx.moveTo(x + shift + dx + inner * 1.9 * build, browY + 0.5 * build);
    ctx.lineTo(x + shift + dx - inner * 1.9 * build, browY - 0.4 * build);
    ctx.stroke();
  };
  brow(spread);
  if (sideOn < 0.74) brow(-spread);

  if (look.moustache) {
    // A thick grey moustache is Mr. Vrána's face in one shape — recognisable
    // before anything else about him is legible.
    ctx.fillStyle = look.moustache;
    ctx.beginPath();
    ctx.ellipse(x + shift, mouthY, 3.4 * build * (1 - sideOn * 0.34), 1.6 * build, 0, 0, TAU);
    ctx.fill();
  } else {
    // A small flat mouth, not a smile: he is at work.
    ctx.strokeStyle = look.mouth;
    ctx.lineWidth = 1.3 * build;
    ctx.beginPath();
    ctx.moveTo(x + shift - 1.9 * build * (1 - sideOn * 0.4), mouthY);
    ctx.quadraticCurveTo(x + shift, mouthY + 0.9 * build,
      x + shift + 1.9 * build * (1 - sideOn * 0.4), mouthY);
    ctx.stroke();
  }
  ctx.restore();

  if (beanie) drawBeanie(ctx, x, y, r, turn, sideOn, look);
  else drawCrownLight(ctx, x, y, r, turn, look);
}

// The beanie. Its brim has to sit above the brows, which is higher than it
// looks like it should: a hat pulled down over the eyes reads as a blindfold.
function drawBeanie(ctx, x, y, r, turn, sideOn, look, deep = false) {
  const brim = y - r * (deep ? 0.10 : 0.44);
  ctx.fillStyle = look.hat;
  ctx.beginPath();
  ctx.ellipse(x, brim, r * 1.02, r * 0.86, 0, Math.PI, TAU);
  ctx.fill();
  ctx.fillRect(x - r * 1.02, brim - 1, r * 2.04, r * 0.30);
  // The turn-up, a shade lighter, so it is a hat and not a painted-on dome.
  ctx.fillStyle = look.hatLit;
  ctx.fillRect(x - r * 1.02, brim + r * 0.06, r * 2.04, r * 0.24);
  ctx.fillStyle = 'rgba(255,255,255,0.11)';
  ctx.beginPath();
  ctx.ellipse(x - turn * sideOn * 1.6 - 1.2, brim - r * 0.46, r * 0.46, r * 0.20, -0.25, 0, TAU);
  ctx.fill();
}

// A bald crown catching the light — Mr. Vrána's most recognisable feature from
// any angle, and the fastest way to tell the two of them apart at a distance.
function drawCrownLight(ctx, x, y, r, turn, look) {
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath();
  ctx.ellipse(x - turn * 1.5, y - r * 0.58, r * 0.38, r * 0.21, -0.3, 0, TAU);
  ctx.fill();
}

export const figureHeight = GROUND + Math.abs(HEAD_Y) + HEAD_R;
