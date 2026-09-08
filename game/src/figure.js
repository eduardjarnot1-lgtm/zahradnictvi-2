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
import { legCycle, footStep, pelvisRise, kneeOf, armSwing as armSwingOf, shoeRoll }
  from './gait.js';

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

// --- the school's finish -----------------------------------------------------
//
// The same two people with one field added, and every extra pass in this file
// is gated on it. `lit` is the colour of the light in the room they are
// standing in — the school's cool strip lighting — and what it buys is the
// three things a flat cartoon figure is missing at this size:
//
//   a rim along the top of the head and shoulders, which is what separates a
//   dark figure from a dark bank of lockers behind him;
//   a gradient down the sweater instead of a fill with a lit blob on it, so
//   the body has a round side and a shadow side;
//   a soft contact shadow rather than a grey disc.
//
// One gradient and three arcs per figure per frame, with two figures on the
// screen. That is affordable in a way that lighting the room live is not, and
// it is where the money shows.
// The thief's own school look now comes from whichever skin is being worn — see
// SCHOOL_SKINS at the foot of this file. Mr. Vrána has one and only one.
export const SCHOOL_CARETAKER_LOOK = { ...CARETAKER_LOOK, lit: '226,240,214' };

// --- small drawing helpers ---------------------------------------------------
// A two-segment limb with a knee or elbow, drawn over a slightly fatter dark
// copy of itself. That rim is the whole reason an arm reads as being in front
// of a body the same colour as it — at this size, value contrast is the only
// separation there is room for.
function limb(ctx, ax, ay, bx, by, cx, cy, wide, narrow, colour, rim, edge = 1.7) {
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
    ctx.lineWidth = wide + edge;
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
  // The blended band for the speed he is actually travelling at: step length,
  // how much of the cycle each foot is down for, how high it lifts, how far he
  // leans. Every pose below is read out of this rather than guessed at.
  const g = pose.gait;
  const creep = g.creep;
  const run = g.run;
  const cycling = g.moving;
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
  // Each leg's own place in its own cycle, half a turn apart. Everything below
  // is a function of these two numbers and the band; nothing is a function of
  // time, which is why the feet cannot drift out of step with the floor.
  const uA = legCycle(walkPhase);
  const uB = legCycle(walkPhase, 0.5);
  // The rummage bobs: he leans in, roots about, leans in again.
  const dig = rummage > 0 ? 0.5 - 0.5 * Math.cos(rummage * Math.PI * 4) : 0;
  // Crouching shortens the legs, which lowers the body and folds the knees in
  // one move — the whole tiptoe posture out of a single number.
  const crouch = g.crouch * cycling + rummage * (3.4 + dig * 1.2);
  const step = {
    step: g.step, duty: g.duty, lift: g.lift * cycling, absorb: g.absorb,
    flight: g.flight, legLen: g.legLen - crouch
  };
  const footA = footStep(uA, step);
  const footB = footStep(uB, step);

  // How far the hips sit above the ankles, worked out from whichever planted
  // leg allows least. Eased back to a full stand as the legs stop cycling.
  const rise = step.legLen + (pelvisRise(uA, step) - step.legLen) * cycling;
  const bobbed = g.legLen - rise;      // how far down from a full stand he is

  // Weight. Peaks over whichever foot is carrying him, which is what makes the
  // hips roll and the shoulders answer. Zero through the swing, so it crosses
  // over during double support rather than snapping.
  const carry = (u) => (u < g.duty ? Math.sin((u / g.duty) * Math.PI) : 0);
  const weight = (carry(uA) - carry(uB)) * cycling;
  // The legs' split, which the hips turn with and the shoulders turn against.
  const reach = g.step * g.duty || 1;
  const split = (footA.along - footB.along) / (reach * 2);

  const breathe = Math.sin(clock * 1.9) * (1 - cycling) * 0.55;
  // Leaning in. Partly the gait — you lean into a run — and partly what the
  // body is doing right now: `drive` is positive while getting up to speed and
  // negative while shedding it, so he tips forward off the mark and settles
  // back as he stops instead of arriving upright at both ends.
  const drive = pose.drive || 0;
  const lean = (g.lean + drive * 2.6) * cycling + rummage * 2.4;

  const hipSway = weight * g.sway * 1.25;
  const twist = -split * (2.0 + run * 1.3) * cycling;

  // The hips: the one thing the legs are hung from, and the one thing the legs
  // decide the height of.
  const centreX = x + acrossX * hipSway;
  const centreY = y + ANKLE_Y - rise - HIP_Y + breathe + acrossY * hipSway;
  // The chest rides over the hips and leans; the shoulders lead the turn.
  const chestX = centreX + faceX * lean;
  const chestY = centreY + faceY * lean * FORESHORTEN;

  const along = (amount) => ({ x: faceX * amount, y: faceY * amount * FORESHORTEN });

  // --- shadow ----------------------------------------------------------------
  // Tied to the body's height, so it tightens as he rises over the planted leg
  // and spreads as he sinks onto both feet. Cheap, and it is most of what sells
  // the feet being on the floor rather than above it.
  const low = 1 - Math.min(1, bobbed / 3);
  const shadowW = (10.4 + low * 1.4) * build;
  const shadowH = 3.7 + low * 0.6;
  if (look.lit) {
    // A shadow with an edge is a disc lying on the floor beside him. This one
    // is darkest under the feet and gone by its rim, which is what a soft
    // ceiling light actually casts and what makes him stand *on* the floor.
    ctx.save();
    ctx.translate(x, y + 18);
    ctx.scale(1, shadowH / shadowW);
    const g2 = ctx.createRadialGradient(0, 0, shadowW * 0.15, 0, 0, shadowW);
    g2.addColorStop(0, 'rgba(14,18,16,0.52)');
    g2.addColorStop(0.5, 'rgba(14,18,16,0.26)');
    g2.addColorStop(1, 'rgba(14,18,16,0)');
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.arc(0, 0, shadowW, 0, TAU);
    ctx.fill();
    ctx.restore();
  } else {
    ctx.fillStyle = 'rgba(16,8,22,0.28)';
    ctx.beginPath();
    ctx.ellipse(x, y + 18, shadowW, shadowH, 0, 0, TAU);
    ctx.fill();
  }

  // --- legs ------------------------------------------------------------------
  const drawLeg = (side, foot, far) => {
    const hipX = centreX + acrossX * HIP_W * side * build;
    const hipY = centreY + HIP_Y + acrossY * HIP_W * side * build;
    const travel = along(foot.along);
    // A narrow walking base: the feet land close to the line the body travels
    // along, not out on the hips. Straight from the reference — a wide stance
    // reads as a toddler.
    const ankleX = x + acrossX * FOOT_W * side * build + travel.x;
    const ankleY = y + ANKLE_Y + acrossY * FOOT_W * side * build + travel.y - foot.lift;
    // The knee is wherever a leg of this length has to put it. Straight when he
    // is reaching out at contact, folded when the foot is up under him — both
    // for free, and both the opposite of what the hand-fitted curve used to do.
    const knee = kneeOf(hipX, hipY, ankleX, ankleY, g.seg * build,
      faceX, faceY * FORESHORTEN);

    if (far) ctx.globalAlpha = 1 - sideOn * 0.28;
    limb(ctx, hipX, hipY, knee.x, knee.y, ankleX, ankleY,
      5.6 * build, 4.8 * build, look.trouser, look.rim);
    drawShoe(ctx, ankleX, ankleY, foot, g, look, build, faceX, faceY, cycling, creep);
    ctx.globalAlpha = 1;
  };

  // The far leg is the one on the far side of the body from the camera, which
  // depends on which way he has turned and whether he is coming or going.
  const farLeg = away ? turn : -turn;
  drawLeg(farLeg, farLeg === -1 ? footA : footB, true);
  drawLeg(-farLeg, -farLeg === -1 ? footA : footB, false);

  // --- the far arm, behind the body ------------------------------------------
  const ARM_LEN = 11.4;
  const armOf = (side, far) => {
    // Arms oppose legs. One sign, and it is the whole difference between a
    // person walking and a toy marching.
    // Opposed to its own leg, trailing it slightly, and not the mirror of the
    // other arm. See `armSwing`.
    const swing = armSwingOf(side, side === -1 ? uA : uB, step);
    const grab = pose.reach > 0 && !far ? Math.sin(Math.min(1, pose.reach) * Math.PI) : 0;
    const bend = Math.min(0.95, g.armBend + rummage * 0.5);
    const shoulderX = chestX + acrossX * SHOULDER_W * side * build * 0.92
      + faceX * twist * side * 0.42;
    const shoulderY = chestY + SHOULDER_Y + 3 + acrossY * SHOULDER_W * side * build * 0.92
      + faceY * twist * side * 0.42 * FORESHORTEN;
    // Where the hand wants to be: swung along the travel line, and drawn up
    // towards the chest the more the elbow is bent. Bending an arm shortens it,
    // which is exactly what the inverse kinematics below needs to see.
    // The far arm swings less on screen than the near one. That is honest
    // perspective — it is further away — and it also keeps its hand from
    // wandering out past a torso that is hiding the arm it belongs to, which
    // reads as a detached blob rather than as a hand.
    const armAlong = swing * (6.4 * g.armSwing) * cycling * (far ? 0.66 : 1)
      + grab * 12 + rummage * (7.5 + dig * 3.5);
    const drop = ARM_LEN * build * (1 - 0.40 * bend) - grab * 2 - rummage * 3.4;
    const outward = acrossX * side * 0.9;
    const outwardY = acrossY * side * 0.9;
    const travel = along(armAlong);
    const wristX = shoulderX + travel.x + outward;
    const wristY = shoulderY + travel.y + outwardY + drop;
    // The elbow points back and out, which is where a bent elbow goes.
    const elbow = kneeOf(shoulderX, shoulderY, wristX, wristY, ARM_LEN * build * 0.52,
      -faceX * 0.75 + acrossX * side * 0.6, (-faceY * 0.75) * FORESHORTEN + acrossY * side * 0.6);

    if (far) ctx.globalAlpha = 1 - sideOn * 0.30;
    // A heavier edge than the legs get. An arm crosses a torso painted the same
    // colour as itself, and at this size the dark rim is the only thing telling
    // the eye where one ends and the other starts — the legs never need it,
    // because they are out in clear air below the hem.
    limb(ctx, shoulderX, shoulderY, elbow.x, elbow.y, wristX, wristY,
      5.0 * build, 4.2 * build, far ? look.coatDark : look.coat, look.rim,
      far ? 1.7 : 2.7);
    // Cuff, then the hand: the sleeve has to end somewhere or the arm reads as
    // a bare tube the same colour as the sweater.
    blob(ctx, wristX, wristY, 2.2 * build, 2.0 * build, 0, look.coatDark);
    const outX = wristX - elbow.x;
    const outY = wristY - elbow.y;
    const len = Math.hypot(outX, outY) || 1;
    const hand = far ? 1.85 : 2.2;
    blob(ctx, wristX + (outX / len) * 2.0, wristY + (outY / len) * 2.0,
      hand * build, (hand - 0.1) * build, 0, far ? look.skinDark : look.skin);
    ctx.globalAlpha = 1;
    return { x: wristX, y: wristY };
  };

  // What trails behind him, before anything of the body is drawn — a cloak is
  // behind its wearer, and so is the fog a ghost drags about.
  const gear = {
    faceX, faceY, build, run, clock,
    // How far through the stride his shoulders are, which the cape swings with.
    swing: Math.sin(walkPhase * TAU) * cycling,
    // ...and whether the cane's opposite foot is on the floor.
    plant: Math.max(0, Math.sin(walkPhase * TAU + Math.PI))
  };
  if (look.aura) drawAura(ctx, chestX, chestY + 2, look, gear);
  if (look.cape) {
    // Set back from the chest, so the mantle reads as hanging off his shoulders
    // rather than being worn under them.
    const bx = -faceX;
    const by = -faceY * FORESHORTEN;
    const bl = Math.hypot(bx, by) || 1;
    drawCape(ctx, chestX + (bx / bl) * 2.6, chestY - 3 + (by / bl) * 2.6, look, gear);
  }

  const farArm = away ? turn : -turn;
  armOf(farArm, true);

  // --- torso -----------------------------------------------------------------
  // Drawn at the chest rather than at the hips, so the lean is a body pitching
  // forward over its legs instead of a whole character sliding along the floor.
  drawTorso(ctx, chestX, chestY, {
    acrossX, acrossY, faceX, faceY, sideOn, twist, build, look
  });

  const hand = armOf(-farArm, false);
  if (look.cane) drawCane(ctx, hand, look, gear);

  // --- head ------------------------------------------------------------------
  // A head does not ride the hips. It is the steadiest thing on a walking
  // person — the neck spends the whole cycle giving back most of what the legs
  // put in — so it keeps `headSteady` of the bob out of the head, and the
  // little that gets through is what reads as a walk rather than a glide.
  const headX = chestX + acrossX * twist * 0.22 + faceX * (creep * cycling * 1.7);
  const headY = chestY + HEAD_Y + bobbed * g.headSteady * cycling
    + creep * cycling * 0.9;
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
//
// The roll is most of what makes a foot look like it is on the floor rather
// than near it. Off the reference: the heel lands first with the toe up, the
// foot flattens as the weight arrives, the heel lifts again for the push, and
// the toe stays pointed through the first half of the swing before coming up
// to meet the ground for the next landing.
function drawShoe(ctx, ax, ay, foot, g, look, build, faceX, faceY, cycling, creep) {
  // Its heading, foreshortened the same way every other length is, so a shoe
  // seen from behind is a short stub and one seen side-on is a full profile.
  const heading = Math.atan2(faceY * FORESHORTEN, faceX);
  const roll = shoeRoll(foot, g, creep, cycling);
  ctx.save();
  ctx.translate(ax, ay + 3.4);
  ctx.rotate(heading + roll * (faceX >= 0 ? 1 : -1));
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

  if (look.lit) {
    // Lit at the shoulders, base through the chest, dark into the hem: the
    // sweater as a rounded mass with a top and an underside rather than a
    // colour with a lighter patch on it.
    const g = ctx.createLinearGradient(0, top - 2, 0, bottom + 1);
    g.addColorStop(0, look.coatLit);
    g.addColorStop(0.34, look.coat);
    g.addColorStop(1, look.coatDark);
    ctx.fillStyle = g;
    path();
    ctx.fill();
    // ...and the rim: a hairline of the room's own light along the top of the
    // shoulders. This is the pass that lifts a dark figure off a dark bank of
    // lockers, and it is one stroke.
    ctx.strokeStyle = `rgba(${look.lit},0.30)`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx - shoulder * 0.86 + lead, top + 1.4 + leadY);
    ctx.quadraticCurveTo(cx + lead, top - 2.4 + leadY, cx + shoulder * 0.86 + lead, top + 1.4 + leadY);
    ctx.stroke();
  } else {
    ctx.fillStyle = look.coat;
    path();
    ctx.fill();

    // Light from above, inset so it stays inside the sweater without a clip.
    ctx.fillStyle = look.coatLit;
    ctx.beginPath();
    ctx.ellipse(cx + lead - shoulder * 0.16, top + 3.2, shoulder * 0.80, 4.4, 0, 0, TAU);
    ctx.fill();
  }

  // A shadow along the hem, where the sweater falls away from the hips.
  ctx.fillStyle = look.coatDark;
  ctx.beginPath();
  ctx.ellipse(cx, bottom - 1.4, hem * 0.94, 2.2, 0, 0, TAU);
  ctx.fill();

  // What is on the front of it. Three skins have something and two do not, and
  // each is two or three fills — at this size a shirt front is a shape, not a
  // garment, and the shape is what has to be different.
  if (look.front === 'stripes') {
    // A pirate's jersey, under an open coat.
    ctx.fillStyle = look.frontTone;
    ctx.beginPath();
    ctx.ellipse(cx + lead * 0.6, top + 6.4, shoulder * 0.40, 5.2, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = look.frontDark;
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(cx + lead * 0.6 - shoulder * 0.36, top + 4.2 + i * 2.0,
        shoulder * 0.72, 0.9);
    }
  } else if (look.front === 'shirt') {
    // A dress shirt and a tie, under a tailcoat.
    ctx.fillStyle = look.frontTone;
    ctx.beginPath();
    ctx.moveTo(cx + lead - shoulder * 0.30, top + 1.6);
    ctx.lineTo(cx + lead + shoulder * 0.30, top + 1.6);
    ctx.lineTo(cx + lead * 0.5 + shoulder * 0.20, bottom - 2.6);
    ctx.lineTo(cx + lead * 0.5 - shoulder * 0.20, bottom - 2.6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = look.frontDark;
    ctx.fillRect(cx + lead * 0.7 - 0.9, top + 2.6, 1.8, 7.4);
  } else if (look.front === 'trim') {
    // Circuitry down a tactical suit: two lit runs and a node between them.
    ctx.strokeStyle = look.frontTone;
    ctx.lineWidth = 1.1;
    ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + lead + side * shoulder * 0.52, top + 2.2);
      ctx.quadraticCurveTo(cx + lead + side * shoulder * 0.30, top + 7.0,
        cx + side * hem * 0.44, bottom - 2.0);
      ctx.stroke();
    }
    ctx.fillStyle = look.frontTone;
    ctx.beginPath();
    ctx.arc(cx + lead * 0.7, top + 6.2, 1.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.arc(cx + lead * 0.7, top + 6.2, 0.6, 0, TAU);
    ctx.fill();
  }
  // A neckerchief, a cravat, a scarf: whatever a skin has round its throat.
  if (look.sash && look.crown !== 'hood') {
    ctx.fillStyle = look.sash;
    ctx.beginPath();
    ctx.ellipse(cx + lead * 0.8, top + 1.4, shoulder * 0.34, 2.0, 0, 0, TAU);
    ctx.fill();
  }
  // ...and the gold down the front edges of a coat.
  if (look.gold) {
    // Braid, not a rod. At full weight the near edge reads as something he is
    // carrying, which on a screen that also has a man with a cane on it is the
    // wrong thing to suggest.
    ctx.strokeStyle = look.goldTrim || look.gold;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(cx + lead - shoulder * 0.86, top + 3.0);
    ctx.lineTo(cx - hem * 0.80, bottom - 1.6);
    ctx.moveTo(cx + lead + shoulder * 0.86, top + 3.0);
    ctx.lineTo(cx + hem * 0.80, bottom - 1.6);
    ctx.stroke();
  }
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
  const bare = look.crown === 'balding';
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

  // ...and a face that is not one colour. The light comes from above and a
  // little to the left everywhere else in this room, so the jaw and the right
  // of the face fall away. Clipped to the face so it cannot spill onto the
  // hair, which is the whole reason this is a clip and not an inset ellipse.
  if (look.lit) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x + shift * 0.22, y, r * 0.95, r, 0, 0, TAU);
    ctx.clip();
    ctx.fillStyle = look.skinDark;
    ctx.globalAlpha = 0.34;
    ctx.beginPath();
    ctx.ellipse(x + shift * 0.22 + r * 0.74, y + r * 0.42, r * 0.78, r * 0.92, -0.4, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.30;
    ctx.beginPath();
    ctx.ellipse(x + shift * 0.22, y + r * 1.02, r * 1.1, r * 0.42, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  if (away) {
    // Walking away: no face at all. The back of a head is a hair mass, plus an
    // ear catching the light on whichever side he is angled towards.
    ctx.fillStyle = look.hair;
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.10, r * 1.02, r * 0.96, 0, 0, TAU);
    ctx.fill();
    if (bare) {
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
    drawCrown(ctx, x, y, r, turn, sideOn, look, true);
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
  // The mask. Every thief in the game wears one — it is the one thing all five
  // skins share, and the thing that says which of the two people on the screen
  // is the one you are steering. Drawn before the eyes so they sit on it, and
  // clipped to the face so it cannot ride up over a hood or a hat brim.
  if (look.mask) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x + shift * 0.22, y, r * 0.95, r, 0, 0, TAU);
    ctx.clip();
    ctx.fillStyle = look.mask;
    ctx.beginPath();
    ctx.ellipse(x + shift, eyeY - r * 0.06, r * 1.10, r * 0.40, 0, 0, TAU);
    ctx.fill();
    // A lit top edge, so the band has a thickness rather than being a hole.
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.ellipse(x + shift, eyeY - r * 0.30, r * 1.02, r * 0.13, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
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

  // Goggles, for the one skin that plans rather than sneaks. Two lenses on a
  // strap, drawn over the eyes because that is where a lens is.
  if (look.goggles) {
    const lens = (dx) => {
      ctx.fillStyle = 'rgba(12,18,26,0.85)';
      ctx.beginPath();
      ctx.ellipse(x + shift + dx, eyeY - r * 0.04, 2.5 * build, 2.2 * build, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = look.goggles;
      ctx.beginPath();
      ctx.ellipse(x + shift + dx, eyeY - r * 0.04, 1.9 * build, 1.6 * build, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.ellipse(x + shift + dx - 0.6, eyeY - r * 0.22, 0.8 * build, 0.5 * build, -0.4, 0, TAU);
      ctx.fill();
    };
    lens(spread * 0.92);
    if (sideOn < 0.74) lens(-spread * 0.92);
    // The strap round the back of the head.
    ctx.strokeStyle = 'rgba(16,22,30,0.9)';
    ctx.lineWidth = 1.5 * build;
    ctx.beginPath();
    ctx.ellipse(x + shift * 0.4, eyeY - r * 0.04, r * 1.0, r * 0.44, 0, 0, TAU);
    ctx.stroke();
  }

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

  drawCrown(ctx, x, y, r, turn, sideOn, look, false);

  // The room's light, catching the top of the skull. Last, so it lies over the
  // hat as well as the hair, and thin — a rim is an edge, and an edge that has
  // width is a halo. Along with the shoulder rim below it, this is what stops a
  // dark figure sinking into a dark bank of lockers.
  if (look.lit) {
    ctx.strokeStyle = `rgba(${look.lit},0.26)`;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    // Where the top of the head is, which is higher when something is on it.
    // Read off the crown rather than off one hat, so a skin that adds a sixth
    // gets a rim in the right place instead of one round its ears.
    const lift = CROWN_LIFT[look.crown] === undefined ? 0.06 : CROWN_LIFT[look.crown];
    ctx.ellipse(x, y - r * lift, r * 1.00, r * 0.94,
      0, Math.PI * 1.12, Math.PI * 1.88);
    ctx.stroke();
  }
}

// How far above the head's middle each crown puts the top of the silhouette,
// which is where the room's light catches it.
const CROWN_LIFT = {
  beanie: 0.30, hood: 0.26, tricorn: 0.46, tophat: 0.52, mop: 0.34, balding: 0.06
};

// What a look wears on its head. One switch, so the face-on and the walking-away
// drawings can never disagree about which hat a skin has on.
function drawCrown(ctx, x, y, r, turn, sideOn, look, deep) {
  switch (look.crown) {
    case 'beanie': return drawBeanie(ctx, x, y, r, turn, sideOn, look, deep);
    case 'hood': return drawHood(ctx, x, y, r, turn, sideOn, look, deep);
    case 'tricorn': return drawTricorn(ctx, x, y, r, turn, sideOn, look, deep);
    case 'tophat': return drawTopHat(ctx, x, y, r, turn, sideOn, look, deep);
    case 'mop': return drawMop(ctx, x, y, r, turn, sideOn, look, deep);
    default: return drawCrownLight(ctx, x, y, r, turn, look);
  }
}

// --- what hangs off a skin ---------------------------------------------------

// A cloak, cape or coat-tail, trailing behind whoever is wearing it.
//
// Drawn behind the body and driven by the walk rather than by a clock: it
// streams out along the *back* of the direction he is travelling, further the
// faster he goes, and it swings with the same phase his shoulders do. A cape on
// a timer is a flag; a cape on the gait is a cape.
function drawCape(ctx, cx, cy, look, { faceX, faceY, build, run, swing }) {
  // Trailing straight at or away from the camera, a cape is edge-on and there is
  // nothing to see — which from directly above is most of the time. So it is
  // drawn as a mantle first and a tail second: wide enough over the shoulders to
  // hold a silhouette from any heading, flaring to a point behind. The travel
  // along the screen's y axis is only half foreshortened for the same reason —
  // a cloak is not a foot, and it does not have to touch the floor honestly.
  // Unit vectors, and that matters more than it looks: foreshortening the y
  // travel shortens the *vector*, so an un-normalised `back` — and the `side`
  // taken square off it — collapsed the whole cape to two thirds of its width
  // whenever he faced up or down the screen, which from directly above is half
  // the time. It vanished behind his own shoulders and looked like a bug in the
  // skin rather than in the arithmetic.
  const bl = Math.hypot(faceX, faceY * (FORESHORTEN + 0.34)) || 1;
  const back = { x: -faceX / bl, y: -faceY * (FORESHORTEN + 0.34) / bl };
  const len = (11.5 + run * 7.5) * build;
  const side = { x: -back.y, y: back.x };
  const sway = swing * (2.4 + run * 2.2) * build;
  const tip = { x: cx + back.x * len + side.x * sway, y: cy + back.y * len + side.y * sway };
  const wide = (9.2 + run * 1.6) * build;
  ctx.fillStyle = look.cape;
  ctx.beginPath();
  ctx.moveTo(cx - side.x * wide, cy - side.y * wide);
  ctx.quadraticCurveTo(
    cx + back.x * len * 0.55 - side.x * (wide * 0.5 - sway * 0.6),
    cy + back.y * len * 0.55 - side.y * (wide * 0.5 - sway * 0.6),
    tip.x, tip.y);
  ctx.quadraticCurveTo(
    cx + back.x * len * 0.55 + side.x * (wide * 0.9 + sway * 0.6),
    cy + back.y * len * 0.55 + side.y * (wide * 0.9 + sway * 0.6),
    cx + side.x * wide, cy + side.y * wide);
  ctx.closePath();
  ctx.fill();
  // A fold down the middle, and a lit edge along the trailing side.
  if (look.capeLit) {
    ctx.strokeStyle = look.capeLit;
    ctx.lineWidth = 0.9 * build;
    ctx.beginPath();
    ctx.moveTo(cx - side.x * wide * 0.5, cy - side.y * wide * 0.5);
    ctx.quadraticCurveTo(cx + back.x * len * 0.6, cy + back.y * len * 0.6, tip.x, tip.y);
    ctx.stroke();
  }
}

// The wisps a ghost trails. Three arcs off the shoulders, on the walk phase, so
// they gather when he stops and stream when he runs.
function drawAura(ctx, cx, cy, look, { faceX, faceY, build, run, swing, clock }) {
  const back = { x: -faceX, y: -faceY * FORESHORTEN };
  ctx.save();
  ctx.strokeStyle = look.aura;
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const t = i / 3;
    const puff = 0.5 + 0.5 * Math.sin(clock * 2.4 + i * 2.1);
    const len = (9 + run * 10 + puff * 5) * build;
    const off = (i - 1) * 3.4 * build + swing * 1.6 * build;
    ctx.globalAlpha = 0.26 + puff * 0.24;
    ctx.lineWidth = (3.4 - t * 1.3) * build;
    ctx.beginPath();
    ctx.moveTo(cx - back.y * off, cy + back.x * off);
    ctx.quadraticCurveTo(
      cx + back.x * len * 0.5 - back.y * (off + puff * 3),
      cy + back.y * len * 0.5 + back.x * (off + puff * 3),
      cx + back.x * len - back.y * off * 0.4,
      cy + back.y * len + back.x * off * 0.4);
    ctx.stroke();
  }
  ctx.restore();
}

// A walking cane, held in the trailing hand and planted every other step. Its
// tip goes down when the opposite foot does, which is what a cane is for.
function drawCane(ctx, hand, look, { faceX, faceY, build, plant }) {
  if (!hand) return;
  const ahead = { x: faceX, y: faceY * FORESHORTEN };
  const len = 13 * build;
  const lean = 0.30 + plant * 0.34;
  const tipX = hand.x + ahead.x * len * lean;
  const tipY = hand.y + ahead.y * len * lean + len * (0.62 + plant * 0.24);
  ctx.strokeStyle = look.cane;
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.9 * build;
  ctx.beginPath();
  ctx.moveTo(hand.x, hand.y);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  // The knob, catching the light.
  ctx.fillStyle = look.caneKnob || '#c9a86a';
  ctx.beginPath();
  ctx.arc(hand.x, hand.y - 0.6 * build, 1.7 * build, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.40)';
  ctx.beginPath();
  ctx.arc(hand.x - 0.5 * build, hand.y - 1.1 * build, 0.6 * build, 0, TAU);
  ctx.fill();
}

// --- headwear ----------------------------------------------------------------
//
// One painter per crown, all to the same contract: draw over a head of radius
// `r` centred at x,y, seen from above and slightly in front, with `turn` saying
// which way the face points and `deep` meaning he is walking away from the
// camera and the hat should sit further down the skull.
//
// They are separate functions rather than one parameterised hat because the
// only thing a top hat and a tricorn have in common is that they are on a head.
// The silhouette is what tells five skins apart at this size — the trim and the
// badges are for when the camera is close.

// A hood, up. Shadow's is black and Ghost's is bone, and both are the same
// shape: a mass behind the head wider than the skull, an opening the face sits
// in, and a shaded fold where the cowl gathers at the neck.
function drawHood(ctx, x, y, r, turn, sideOn, look, deep = false) {
  if (deep) {
    // From behind there is no opening: a hood is the back of a head.
    ctx.fillStyle = look.hat;
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.10, r * 1.26, r * 1.20, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = look.hatDark || look.hat;
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.62, r * 1.06, r * 0.66, 0, 0, TAU);
    ctx.fill();
  } else {
    // Face on it is a ring, and it has to actually be a ring: the crown is
    // painted after the face, so a filled ellipse here is a bag over his head.
    // Two subpaths and the even-odd rule cut the opening out of the cowl in one
    // fill, which is cheaper than clipping and does not soften the edge.
    const ox = x + turn * sideOn * 1.1;
    const oy = y + r * 0.10;
    ctx.fillStyle = look.hat;
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.06, r * 1.30, r * 1.24, 0, 0, TAU);
    ctx.ellipse(ox, oy, r * 0.86, r * 0.90, 0, 0, TAU);
    ctx.fill('evenodd');
    // The fold where the cowl gathers at the neck, under the chin.
    ctx.fillStyle = look.hatDark || look.hat;
    ctx.beginPath();
    ctx.ellipse(x, y + r * 1.06, r * 1.12, r * 0.44, 0, 0, TAU);
    ctx.fill();
    // ...and the shadow the opening casts onto the face inside it.
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(ox, oy, r * 0.86, r * 0.90, 0, 0, TAU);
    ctx.clip();
    ctx.fillStyle = 'rgba(10,14,20,0.30)';
    ctx.beginPath();
    ctx.ellipse(ox, oy - r * 0.62, r * 0.92, r * 0.46, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  // A lit edge along the top of the cowl, so a black hood on a dark corridor
  // still has an outline and a bone one does not glare.
  ctx.strokeStyle = look.hatLit;
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  ctx.ellipse(x, y + (deep ? r * 0.10 : r * 0.06), r * 1.24, r * 1.18,
    0, Math.PI * 1.04, Math.PI * 1.96);
  ctx.stroke();
}

// A pirate's tricorn: wide, three-cornered, with a gold edge, a skull badge on
// the front, and the tail of a red bandana coming out from under the back of it.
function drawTricorn(ctx, x, y, r, turn, sideOn, look, deep = false) {
  const brim = y - r * (deep ? 0.06 : 0.30);
  // The bandana under it, trailing off the back.
  if (look.sash) {
    ctx.fillStyle = look.sash;
    ctx.beginPath();
    ctx.moveTo(x - turn * r * 0.5, brim + r * 0.30);
    ctx.quadraticCurveTo(x - turn * r * 1.7, brim + r * 0.20,
      x - turn * r * 2.0, brim + r * 0.86);
    ctx.quadraticCurveTo(x - turn * r * 1.3, brim + r * 0.52,
      x - turn * r * 0.4, brim + r * 0.70);
    ctx.closePath();
    ctx.fill();
  }
  // The brim: a wide three-pointed sweep.
  ctx.fillStyle = look.hat;
  ctx.beginPath();
  ctx.moveTo(x - r * 1.55, brim + r * 0.34);
  ctx.quadraticCurveTo(x - r * 0.90, brim - r * 0.72, x, brim - r * 0.80);
  ctx.quadraticCurveTo(x + r * 0.90, brim - r * 0.72, x + r * 1.55, brim + r * 0.34);
  ctx.quadraticCurveTo(x, brim + r * 0.86, x - r * 1.55, brim + r * 0.34);
  ctx.closePath();
  ctx.fill();
  // The crown of it, sitting proud.
  ctx.fillStyle = look.hatLit;
  ctx.beginPath();
  ctx.ellipse(x, brim - r * 0.06, r * 0.86, r * 0.44, 0, 0, TAU);
  ctx.fill();
  // Gold along the brim's edge.
  ctx.strokeStyle = look.gold || '#d8a33c';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(x - r * 1.50, brim + r * 0.32);
  ctx.quadraticCurveTo(x - r * 0.88, brim - r * 0.66, x, brim - r * 0.74);
  ctx.quadraticCurveTo(x + r * 0.88, brim - r * 0.66, x + r * 1.50, brim + r * 0.32);
  ctx.stroke();
  // ...and the skull on the front, which is the whole badge at this size: two
  // eyes and a jaw in bone white.
  if (!deep) {
    const bx = x + turn * sideOn * 1.2;
    const by = brim + r * 0.06;
    ctx.fillStyle = '#f2efe6';
    ctx.beginPath();
    ctx.ellipse(bx, by, r * 0.26, r * 0.24, 0, 0, TAU);
    ctx.fill();
    ctx.fillRect(bx - r * 0.16, by + r * 0.16, r * 0.32, r * 0.12);
    ctx.fillStyle = look.hat;
    ctx.beginPath();
    ctx.arc(bx - r * 0.10, by - r * 0.02, r * 0.07, 0, TAU);
    ctx.arc(bx + r * 0.10, by - r * 0.02, r * 0.07, 0, TAU);
    ctx.fill();
  }
}

// A gentleman's top hat, from above: a brim, a crown, and a band round it.
function drawTopHat(ctx, x, y, r, turn, sideOn, look, deep = false) {
  // High enough that the brim clears the brows: a hat over the eyes reads as
  // a blindfold, which is the trap the beanie already fell into once.
  const brim = y - r * (deep ? 0.24 : 0.62);
  ctx.fillStyle = look.hatDark || look.hat;
  ctx.beginPath();
  ctx.ellipse(x, brim + r * 0.20, r * 1.26, r * 0.52, 0, 0, TAU);
  ctx.fill();
  // The crown, offset the way he leans, which is what gives it height.
  ctx.fillStyle = look.hat;
  ctx.beginPath();
  ctx.ellipse(x + turn * sideOn * 0.9, brim - r * 0.16, r * 0.82, r * 0.62, 0, 0, TAU);
  ctx.fill();
  // The band.
  ctx.strokeStyle = look.band || '#5a4632';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.ellipse(x + turn * sideOn * 0.7, brim + r * 0.06, r * 0.82, r * 0.54,
    0, Math.PI * 0.06, Math.PI * 0.94);
  ctx.stroke();
  // A sheen off the top of the crown: silk, not felt.
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath();
  ctx.ellipse(x + turn * sideOn * 0.9 - 1.4, brim - r * 0.34, r * 0.36, r * 0.16, -0.3, 0, TAU);
  ctx.fill();
}

// A mop of hair, for the one skin that wears no hat. Spikes rather than a
// smooth cap: the silhouette has to say "no hat" from across the corridor.
function drawMop(ctx, x, y, r, turn, sideOn, look, deep = false) {
  ctx.fillStyle = look.hair;
  ctx.beginPath();
  ctx.ellipse(x, y - r * (deep ? 0.10 : 0.28), r * 1.06, r * 0.80, 0, 0, TAU);
  ctx.fill();
  // Five spikes off the top, leaning the way he is going.
  for (let i = 0; i < 5; i++) {
    const t = (i - 2) / 2;
    const px = x + t * r * 0.80 + turn * sideOn * 1.2;
    const py = y - r * (deep ? 0.50 : 0.70);
    ctx.beginPath();
    ctx.moveTo(px - r * 0.26, py + r * 0.34);
    ctx.quadraticCurveTo(px + turn * r * 0.22, py - r * 0.62,
      px + turn * r * 0.50, py - r * 0.16);
    ctx.quadraticCurveTo(px + r * 0.18, py + r * 0.14, px + r * 0.26, py + r * 0.34);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = look.hairLit || 'rgba(255,255,255,0.13)';
  ctx.beginPath();
  ctx.ellipse(x - turn * 1.4, y - r * (deep ? 0.24 : 0.44), r * 0.42, r * 0.20, -0.3, 0, TAU);
  ctx.fill();
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

// --- the five thief skins ----------------------------------------------------
//
// A skin is a look, and a look is data. That is the whole of the integration:
// `drawFigure` reads clothes, hats and gear off the object it is handed and
// knows nothing else about who is wearing them, so every one of these gets the
// idle, the five walking states, the turn, the search, the grab and the climb
// into a locker for free — and gets them *right*, because the pose comes off
// the speed the simulation measured and none of it comes off the skin.
//
// They are cosmetic in the strict sense: nothing here is read by the
// simulation, which never sees this file. There is no field one of them could
// set that would make it quieter, faster or harder to spot.
//
// Same body, different person. The build is 1 for all five and the proportions
// are the thief's — what tells them apart at the distance the game is actually
// played at is the silhouette: what is on the head, and what trails behind.
const THIEF_BODY = {
  skin: '#f0c9a4', skinDark: '#d6a97f',
  mask: '#14161d',
  brow: '#3a2c22',
  mouth: '#8a5f4d',
  build: 1,
  lit: '226,240,214'
};

export const SCHOOL_SKINS = [
  {
    // Silent. Fast. Invisible. Black on black, hood up, and nothing on him
    // that catches a light — the one that reads as a thief before anything else.
    id: 'shadow',
    name: 'Shadow',
    blurb: 'Silent. Fast. Invisible.',
    ...THIEF_BODY,
    coat: '#252a33', coatLit: '#333945', coatDark: '#171b22',
    trouser: '#1e2229', trouserLit: '#2b3038',
    shoe: '#33383f', shoeLit: '#454b54', sole: '#7b828c',
    hair: '#2a2118',
    crown: 'hood', hat: '#282e37', hatLit: '#3d4552', hatDark: '#1a1e25',
    rim: '#14171d'
  },
  {
    // Treasure hunter of the night. Tricorn, skull, red bandana trailing, a
    // striped jersey under a gold-edged coat, and the coat itself streaming out
    // behind him when he runs.
    id: 'pirate',
    name: 'Pirate',
    blurb: 'Treasure hunter of the night.',
    ...THIEF_BODY,
    coat: '#2f2a22', coatLit: '#413a2f', coatDark: '#1e1a15',
    trouser: '#26231d', trouserLit: '#343029',
    shoe: '#5c3f26', shoeLit: '#74522f', sole: '#8a6a44',
    hair: '#3a2a1c',
    crown: 'tricorn', hat: '#1c1913', hatLit: '#2e281f',
    gold: '#d8a33c', goldTrim: 'rgba(216,163,60,0.55)',
    sash: '#b5342c',
    front: 'stripes', frontTone: '#e6ddcb', frontDark: '#3a3630',
    cape: '#241f19', capeLit: 'rgba(216,163,60,0.55)',
    rim: '#171410'
  },
  {
    // Hacker. Planner. No alarms for him. No hat at all, which is the point:
    // spiked hair and a lit strip down a tactical suit, and the only skin whose
    // eyes you cannot see.
    id: 'tech',
    name: 'Tech',
    blurb: 'Hacker. Planner. No alarms for him.',
    ...THIEF_BODY,
    mask: null,
    coat: '#1d222b', coatLit: '#2c3340', coatDark: '#12161d',
    trouser: '#181c24', trouserLit: '#252b35',
    shoe: '#e4e9f0', shoeLit: '#f4f7fb', sole: '#9fb6c6',
    hair: '#7c4a28', hairLit: 'rgba(214,150,90,0.55)',
    crown: 'mop',
    goggles: '#4fd0f5',
    front: 'trim', frontTone: '#38c6f0',
    rim: '#101419'
  },
  {
    // Classy. Calm. Always one step ahead. Top hat, tailcoat over a dress shirt,
    // and a cane that plants itself on the off beat of his own walk.
    id: 'gentleman',
    name: 'Gentleman',
    blurb: 'Classy. Calm. Always one step ahead.',
    ...THIEF_BODY,
    coat: '#201e25', coatLit: '#2e2b34', coatDark: '#141319',
    trouser: '#1c1b21', trouserLit: '#28262e',
    shoe: '#4d3520', shoeLit: '#654529', sole: '#8a6a44',
    hair: '#2a2018',
    crown: 'tophat', hat: '#16151a', hatLit: '#242229', hatDark: '#0e0d11',
    band: '#5a4632',
    front: 'shirt', frontTone: '#e8e4dc', frontDark: '#7a5a3a',
    cape: '#191820', capeLit: 'rgba(200,190,180,0.22)',
    cane: '#2a2118', caneKnob: '#c9a86a',
    rim: '#111016'
  },
  {
    // A shadow that leaves no trace. Bone-white hood and cloak over the same
    // black clothes, and a cold light coming off him that gathers when he stops
    // and streams when he runs.
    id: 'ghost',
    name: 'Ghost',
    blurb: 'A shadow that leaves no trace.',
    ...THIEF_BODY,
    coat: '#222731', coatLit: '#30363f', coatDark: '#161a21',
    trouser: '#1b1f26', trouserLit: '#272c34',
    shoe: '#cfd6df', shoeLit: '#e6ebf2', sole: '#98a3b0',
    hair: '#2a2118',
    crown: 'hood', hat: '#e6e2d8', hatLit: '#f6f4ee', hatDark: '#bdb9ae',
    cape: '#ded9ce', capeLit: 'rgba(255,255,255,0.55)',
    aura: '#8fd4ff',
    rim: '#171b22'
  }
];

// The one the game starts with, and the one anything that asks for a skin by a
// name nobody has heard of falls back to.
export const DEFAULT_SKIN = SCHOOL_SKINS[0].id;

export function skinById(id) {
  return SCHOOL_SKINS.find((s) => s.id === id) || SCHOOL_SKINS[0];
}
