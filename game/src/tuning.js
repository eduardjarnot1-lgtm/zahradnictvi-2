// Every balance number in the game lives here. Nothing else defines a constant.
// Changing balance is a data edit; a debug tuning panel only has to walk this object.
// ---------------------------------------------------------------- the systems
// What follows is the machinery every location's person is built out of. It was
// written for the school, one man asleep at his desk, and it is written down
// here rather than inside `locations` because it turned out not to be about the
// school at all: a person who hears something, guesses where it came from, gets
// up, and is better at all three the louder it was is what *every* threat in
// this game should have been doing.
//
// Each location takes these as its starting point and says how its own person
// differs — an old man in a cottage is the same machine as a vault guard with a
// much slower spring in it.
// How close you are to Mr. Vrána decides how much a given noise costs.
// Standing over him, a dropped phone is deafening; three classrooms
// away, the same phone barely registers.
//
// The curve is smooth between the two distances, so there is no line to
// step across and be surprised by — you can feel it tighten as you walk
// towards him. Both ends are deliberately far from 1.0: if the far end
// were 0.9 the whole mechanic would be a rounding error.
const HEARING = {
  near: 90,          // world units — about four tiles, i.e. the same room
  // Far enough that the whole of even the biggest school map sits inside
  // the falloff. There is no "outside his hearing" any more: the curve
  // runs continuously from his elbow to the far corner, and the quietest
  // corner of the building is still only a shade under full price.
  far: 560,
  nearScale: 3.0,    // three times as loud, standing over him
  farScale: 0.85     // ...and barely muffled at the other end of the school
};

// What changes once he is on his feet. A man awake is listening, and he
// carries that with him — a second, smaller curve centred on wherever he
// happens to be standing, multiplied on top of the first. It is what
// stops the answer to "he woke up" being "carry on somewhere else".
const ATTENTION = {
  radius: 220,       // how far his attention reaches while he is up
  boost: 1.7         // at his feet; easing back to 1 at the edge of it
};

// The school is the one place noise comes back down fast enough to be a
// tactic rather than a consolation. Standing still is how you send him
// back to the staff room, so it has to actually work inside the clock —
// but the delay is longer than elsewhere, so it is never a reflex.
const RECOVERY = { delay: 0.9, rate: 7 };

// Looking inside the furniture.
//
// The decision this exists to create: a cabinet might hold a diamond or
// it might hold nothing, and finding out costs you noise, a second and a
// half of the clock, and standing still while the meter is read off how
// close you are to Mr. Vrána. The whole mechanic falls apart in one
// direction if searching is free and in the other if it is deafening, so
// the numbers here are small and the multiplier does the work.
const SEARCH = {
  reach: 34,          // how close a piece has to be to offer itself
  duration: 1.25,     // seconds spent with your hands in the drawer
  moveScale: 0.12,    // you can shuffle, not walk, while you are at it
  // Opening the thing, before you have any idea what is inside. Hard,
  // hollow furniture carries; a desk drawer barely does.
  noise: {
    table: 3, nightstand: 3, chest: 4, tvBench: 4,
    sofa: 2, wardrobe: 5, bookshelf: 5, plinth: 6
  }
};

// What the meter means here.
//
// Everywhere else in the game the meter is called NOISE and a hundred is
// the end of the level: he woke up, you lost. In the school it is how
// alert one man is, and filling it ends nothing. It makes him quick and
// it makes him right — and being walked into, or running out of clock, is
// what actually loses you the level.
//
// That is not a softer game, it is a different one: instead of watching a
// bar and stopping before it fills, you are being hunted by someone who
// gets better at it the more you give him, and worse at it if you go
// quiet and let him lose the thread.
//
// Everything here is continuous in the meter — no bands, nothing steps.
// `alertnessOf` smoothsteps 0..100 onto 0..1, so the middle of the meter
// is where his behaviour changes fastest:
//
//   meter   10    30    50    70    85    95
//   alert  0.03  0.22  0.50  0.78  0.94  0.99
const ALERTNESS = {
  // Measured from well below the line he gets up at, so that by the time
  // he is on his feet there is still most of the curve left to climb.
  // Spanning the whole meter looked right and was not: he only ever wakes
  // above wakeAt, so every waking moment sat at the top of the curve and
  // he was always at his sharpest.
  from: 55, to: 100,
  // How far out his guess at where you are can be. Barely disturbed he is
  // off by most of a classroom and will search the wrong corner of the
  // wrong room; at the top of the meter he walks more or less to you.
  blur: 230,
  sharp: 16,
  // How fast he walks, as a multiplier on his own speed.
  speedLow: 0.70,
  speedHigh: 1.28,
  // How long he takes to get out of the chair.
  riseLow: 2.1, riseHigh: 0.8,
  // How long he casts about once he gets there. Quiet is a long vague
  // sweep of the wrong area; loud is a short sharp look at the right one.
  sweepLow: 4.2, sweepHigh: 1.8,
  // A fresh noise while he is already up pulls his estimate this far
  // towards the new guess. This is what makes a thief who keeps making
  // noise get found: each fix is closer than the last, so they close in
  // rather than averaging out.
  narrow: 0.62,
  // ...but only for a noise worth turning towards, and only for an actual
  // *event*: this is how far the meter has to jump in a single step, which
  // lifting something, walking into something or opening something does
  // and which walking across a room does not.
  refixAt: 0.55,
  refix: 5
};

// How the school's two people walk.
//
// The bands are §4's: idle, tiptoe, walk, power walk, run, blended rather
// than switched so nothing ever snaps. Everything is in world units, and
// `step` is the load-bearing one: it is how much ground one step covers,
// which fixes the cadence (speed divided by step) *and* the drawn foot
// travel at the same time. Those two agreeing is what stops the feet
// sliding, so `step` is the number to change when a gait looks wrong and
// the rest will follow it.
//
// The steps are short for the height of these characters, because the
// characters are cartoons: their legs are under a third of the body where
// a person's are about half, so the same ground has to be covered in more,
// quicker steps. Hiding that with long strides only makes a figure doing
// the splits.
const THIEF_GAIT = {
  legLen: 13,       // hip to ankle, fully extended
  seg: 6.6,         // thigh and shin: a shade over half, so never quite straight
  bands: [
    // Tiptoe. Knees bent the whole way, weight low, torso pitched forward
    // over short careful steps, arms held in front.
    { at: 0.00, step: 7.0,  duty: 0.70, lift: 1.3, absorb: 0.30, flight: 0,
      crouch: 3.1, lean: 1.6, armSwing: 0.28, armBend: 0.62, sway: 0.55,
      headSteady: 0.8 },
    // Walk. Near upright, heel strike to toe-off, arms hanging and
    // swinging from the shoulder.
    { at: 0.32, step: 12.5, duty: 0.62, lift: 2.4, absorb: 0.70, flight: 0,
      crouch: 0.3, lean: 0.4, armSwing: 1.00, armBend: 0.20, sway: 1.00,
      headSteady: 0.5 },
    // Power walk: longer, quicker, leaning in, arms working.
    { at: 0.68, step: 17.0, duty: 0.50, lift: 3.4, absorb: 1.00, flight: 0,
      crouch: 0.0, lean: 1.5, armSwing: 1.40, armBend: 0.44, sway: 1.05,
      headSteady: 0.45 },
    // Run. The duty factor drops under a half, which is what makes it a
    // run rather than a fast walk: there is a moment with neither foot
    // down, and the body is a projectile through it.
    { at: 0.93, step: 24.0, duty: 0.30, lift: 6.2, absorb: 1.50, flight: 1.3,
      crouch: 0.0, lean: 3.6, armSwing: 1.90, armBend: 0.98, sway: 0.75,
      headSteady: 0.35 }
  ]
};

// Mr. Vrána walks the same way and is not the same walker. He is older and
// heavier: shorter steps, less lift, more roll from side to side, and no
// run in him at all. His share is measured against the *player's* top
// speed rather than his own, which is the whole trick — at his 78 against
// the thief's 132 he sits at 0.59, a purposeful walk, where measuring him
// against himself put him at 1.0 and made him sprint every time he moved.
const WALKER_GAIT = {
  legLen: 13.6, seg: 6.95,
  bands: [
    { at: 0.00, step: 7.5,  duty: 0.74, lift: 1.1, absorb: 0.30, flight: 0,
      crouch: 1.0, lean: 0.5, armSwing: 0.45, armBend: 0.30, sway: 1.10,
      headSteady: 0.55 },
    { at: 0.30, step: 12.0, duty: 0.66, lift: 1.9, absorb: 0.65, flight: 0,
      crouch: 0.2, lean: 0.5, armSwing: 0.90, armBend: 0.26, sway: 1.35,
      headSteady: 0.5 },
    { at: 0.62, step: 15.0, duty: 0.58, lift: 2.6, absorb: 0.90, flight: 0,
      crouch: 0.0, lean: 1.1, armSwing: 1.20, armBend: 0.40, sway: 1.45,
      headSteady: 0.45 },
    // Following. Urgent for a man of his age, which is a brisk stride and
    // not a sprint: the duty factor stays over a half, so both his feet
    // never leave the floor at once. He hurries; he does not fly.
    { at: 0.88, step: 17.5, duty: 0.53, lift: 3.2, absorb: 1.10, flight: 0,
      crouch: 0.0, lean: 1.7, armSwing: 1.45, armBend: 0.55, sway: 1.35,
      headSteady: 0.4 }
  ],
  // What being on his feet does to his apparent pace, over and above how
  // fast he is actually moving. Following is the only urgent one.
  urgency: { investigating: 0, searching: 0, returning: -0.04, following: 0.14 }
};

// Mr. Vrána, once he is awake.
const INVESTIGATE = {
  // Where he gets up, and where he gives up. Both lower than they were,
  // because filling the meter no longer ends the level: the stretch from
  // here to a hundred used to be twenty points of imminent death and is
  // now the part of the game where he is actually hunting you. It has to
  // be wide enough to have a shape in it.
  wakeAt: 62,
  calmAt: 40,
  // Getting off a couch is four beats, not a fade: he stirs, sits up,
  // gets to his feet, then has a look round before he sets off. Long
  // enough to read as a person waking up, and it is time the player can
  // use — which is the point of showing it rather than cutting to him
  // already walking.
  rising: 1.35,      // seconds spent getting off the couch
  settling: 0.9,     // ...and lying back down again
  speed: 78,         // world units a second: a walk, not a chase
  accel: 430,        // he is a heavy man getting going
  decel: 620,
  arriveAt: 16,      // how near the target counts as having reached it
  searchFor: 3.2,    // seconds spent looking around before giving up
  catchAt: 22,       // this close to you and the level is over
  // He gets one look at where the sound came from. If you are still
  // there when he arrives, that is on you.
  forget: true,

  // --- and if you let him get close enough to actually see you --------
  // Up to here he has been walking towards a memory. Inside this range
  // he stops guessing and comes after you: his target becomes wherever
  // you are, updated as you move.
  //
  // The two distances are deliberately far apart. One number would make
  // him flicker between chasing and not chasing every time you stepped
  // over the line, so losing him takes real ground and real seconds
  // rather than a step backwards.
  followAt: 58,      // he picks you out at under three tiles
  // Far enough that a step backwards will not do it, close enough that
  // it is reachable on a floorplan. You gain about fifty units a second
  // on him in the open, so this is a second and a half of clear running
  // and then two more of keeping it — but it is measured through rooms
  // and doorways, where every corner hands some of it back. Set against
  // rooms two to three hundred units across: at 250 the only escape was
  // a straight corridor longer than any of these maps has, and being
  // followed became permanent, which is the one thing it must not be.
  unfollowAt: 150,
  unfollowFor: 2.0,  // held for this long, not merely touched once
  // Re-reading where you are every frame would be wasteful, and would
  // also make him uncannily precise. He looks again when you have moved
  // this far, or this often, whichever comes first.
  repathEvery: 0.3,
  repathAfter: 28
};

// Everything above is one machine. This is how a location bends it.
//
// `person` merges over the base a level deep, so a location writes down only
// what makes its own threat that threat and inherits the rest — and a change to
// how investigation works lands in all eleven places at once instead of ten of
// them and a bug.
const SHARED = {
  proximity: HEARING,
  awake: ATTENTION,
  recovery: RECOVERY,
  search: SEARCH,
  alertness: ALERTNESS,
  gait: THIEF_GAIT,
  watcherGait: WALKER_GAIT,
  figures: true,
  investigate: INVESTIGATE
};

const LAYERED = ['proximity', 'awake', 'recovery', 'search', 'alertness', 'investigate'];

function person(over = {}) {
  const out = { ...SHARED, ...over };
  for (const key of LAYERED) {
    if (over[key]) out[key] = { ...SHARED[key], ...over[key] };
  }
  return out;
}

// Bend a gait rather than retyping one. Every band moves together, because a
// walk is one motion at five speeds and not five motions: shorten a man's step
// and his cadence, his arm swing and his foot travel all have to follow it or
// he slides. `step` is the number that matters; the rest are for character.
//
// The one hard edge: a band with air under it (`flight`) needs its duty factor
// under a half or there is no moment with both feet off the ground for the body
// to be a projectile through, and `pelvisRise` would be dividing by nothing.
const round2 = (n) => Math.round(n * 100) / 100;

function walkLike(base, over = {}) {
  const { step = 1, duty = 0, lift = 1, swing = 1, sway = 1, lean = 1,
    legLen, seg, urgency } = over;
  return {
    legLen: legLen === undefined ? base.legLen : legLen,
    seg: seg === undefined ? base.seg : seg,
    urgency: urgency || base.urgency,
    bands: base.bands.map((b) => ({
      ...b,
      step: round2(b.step * step),
      duty: Math.max(0.24, Math.min(b.flight > 0 ? 0.46 : 0.82, b.duty + duty)),
      lift: round2(b.lift * lift),
      armSwing: round2(b.armSwing * swing),
      sway: round2(b.sway * sway),
      lean: round2(b.lean * lean)
    }))
  };
}

// A guard is not a man being woken up. He is on his feet already, he is fit,
// and he can run — so his gait comes off the thief's band table rather than the
// sleeper's, which is the one that has air in its top band.
const GUARD_GAIT = walkLike(THIEF_GAIT, {
  step: 1.04, lift: 0.94, swing: 0.92, sway: 0.9, legLen: 13.4, seg: 6.85,
  urgency: { investigating: 0.04, searching: 0, patrolling: -0.06, watching: 0,
    returning: -0.02, following: 0.20 }
});

// Walking a beat. A guard who never moves is a piece of furniture with a
// radius; one who roams the whole building is a coin toss you cannot see
// coming. So he works his own end of the map: a short loop of stands around his
// post, with a pause at each, which makes *where his post is* the thing the
// player has to plan around — which is what a guard should be.
//
// `from` is which level of the location he starts doing it on. The first level
// of a location is where you learn the building and the person in it, and a
// moving threat on a map you have never seen is not a lesson, it is a coin
// toss — so the round is part of how a location gets harder, like its size and
// its furniture, rather than something it has from the first step.
const beat = (from, radius, points, pause, speed) =>
  ({ from, radius, points, pause, speed });

// Raising the alarm. Not a second fail state — the game already has two and
// does not need a third. It is a floor under the meter: for as long as it is
// up, going quiet does not bring him down, because he is not listening for you
// any more, he knows. Standing still stops working and the room has to be left.
//
// And it winds back down. A floor that stays put is a level that ends when the
// clock does, whatever the player then does — the one shape a stealth game
// cannot have, because it takes the decisions away. `fade` is how many points a
// second the alarm sheds, so this is a hard several seconds and then a way back
// in, and a guard who sees you twice starts the several seconds again.
const alarmAt = (floor, fade) => ({ floor, fade });

// The eleven people, in the order the campaign meets them.
//
// The shape of the difference is deliberate: the residential locations are
// slower, vaguer and far more forgiving than the guarded ones, so the campaign
// teaches the mechanic on a man who gives you three chances and then hands you
// to someone who gives you none. Read down the `speed` and `blur` columns and
// that is the whole curve of the game.
const PEOPLE = {
  // Dad, in the next room. He half hears things, takes an age to work out
  // whether he heard anything at all, and goes back to sleep readily.
  Apartment: person({
    recovery: { delay: 1.0, rate: 8 },
    alertness: {
      blur: 270, sharp: 26, speedLow: 0.62, speedHigh: 1.05,
      riseLow: 2.8, riseHigh: 1.4, sweepLow: 3.6, sweepHigh: 2.0, narrow: 0.50
    },
    investigate: {
      wakeAt: 66, calmAt: 44, rising: 1.9, settling: 1.1,
      speed: 68, accel: 380, decel: 560, searchFor: 3.0,
      followAt: 52, unfollowAt: 140
    },
    watcherGait: walkLike(WALKER_GAIT, { step: 0.96, lift: 0.95 })
  }),

  // Grandpa, asleep in the armchair. The slowest man in the game by some way,
  // and the one who most reliably gives up: this is the location where you can
  // make a mistake and still walk out of it.
  House: person({
    recovery: { delay: 1.1, rate: 9 },
    alertness: {
      blur: 300, sharp: 34, speedLow: 0.58, speedHigh: 0.95,
      riseLow: 3.2, riseHigh: 1.8, sweepLow: 3.4, sweepHigh: 2.2, narrow: 0.45
    },
    investigate: {
      wakeAt: 68, calmAt: 46, rising: 2.2, settling: 1.3,
      speed: 60, accel: 320, decel: 500, searchFor: 2.8,
      followAt: 48, unfollowAt: 130
    },
    watcherGait: walkLike(WALKER_GAIT, {
      step: 0.86, duty: 0.04, lift: 0.78, swing: 0.80, sway: 1.12,
      legLen: 13.2, seg: 6.70
    })
  }),

  // Otakar the night porter. Asleep at the desk, but it is his job to be there
  // — he walks the floor between naps and he knows the building.
  Hotel: person({
    recovery: { delay: 0.85, rate: 6 },
    alertness: {
      blur: 215, sharp: 18, speedLow: 0.74, speedHigh: 1.22,
      riseLow: 1.8, riseHigh: 0.8, sweepLow: 4.0, sweepHigh: 2.0
    },
    investigate: {
      // He is a porter, not a guard: he comes to look, and he only actually
      // takes off after you if you are close enough that there is nothing else
      // he could be looking at.
      wakeAt: 60, calmAt: 40, rising: 1.2, settling: 0.9, speed: 80,
      catchAt: 20, followAt: 42, unfollowAt: 104, unfollowFor: 1.5
    },
    // No round. He is a night porter asleep at a desk, not a guard on a beat —
    // and the floor he sleeps on is one corridor with the way out at the end of
    // it, so a man walking up and down it is not an obstacle to time, it is a
    // toll gate. Walking the building is what the museum's and the estate's
    // guards are for; Otakar's danger is that his desk is on the only route.
    watcherGait: walkLike(WALKER_GAIT, { step: 1.04, lift: 1.05, swing: 1.05 })
  }),

  // Mr. Halas, face down on the quarterly report. Wakes badly, and the open
  // plan means he can see most of his own floor the moment he lifts his head.
  Office: person({
    recovery: { delay: 0.95, rate: 7 },
    alertness: {
      blur: 250, sharp: 22, speedLow: 0.68, speedHigh: 1.10,
      riseLow: 2.4, riseHigh: 1.1, sweepLow: 3.4, sweepHigh: 1.9, narrow: 0.55
    },
    investigate: {
      wakeAt: 64, calmAt: 42, rising: 1.7, settling: 1.0, speed: 74,
      searchFor: 2.8
    },
    watcherGait: walkLike(WALKER_GAIT, { step: 0.98, sway: 0.92 })
  }),

  // Mr. Vrána. The one the whole system was written for, and still the middle
  // of the range: slower than the guards, sharper than the sleepers.
  School: person(),

  // Dr. Marek, out on the staff couch at the end of a double shift. Deeply
  // asleep and then instantly, professionally awake — the fastest riser in the
  // game who is not paid to be.
  Hospital: person({
    recovery: { delay: 0.9, rate: 6.5 },
    alertness: {
      blur: 225, sharp: 18, speedLow: 0.76, speedHigh: 1.24,
      riseLow: 1.4, riseHigh: 0.6, sweepLow: 3.8, sweepHigh: 1.9
    },
    investigate: {
      wakeAt: 62, calmAt: 41, rising: 1.0, settling: 0.8, speed: 90,
      accel: 470, followAt: 58
    },
    watcherGait: walkLike(WALKER_GAIT, { step: 1.08, duty: -0.02, swing: 1.10 })
  }),

  // Bruno. The first professional the campaign puts in front of you: he walks
  // the galleries, he searches where a thief would actually be, and once he has
  // seen you the room never really goes quiet again.
  Museum: person({
    recovery: { delay: 1.2, rate: 4.5 },
    alertness: {
      from: 45, blur: 175, sharp: 13, speedLow: 0.78, speedHigh: 1.05,
      riseLow: 1.2, riseHigh: 0.5, sweepLow: 5.0, sweepHigh: 2.6,
      narrow: 0.68, refix: 4
    },
    investigate: {
      wakeAt: 56, calmAt: 34, rising: 0.9, settling: 0.7, speed: 96,
      accel: 520, decel: 700, searchFor: 4.0, catchAt: 24,
      followAt: 58, unfollowAt: 108, unfollowFor: 1.5
    },
    patrol: beat(2, 160, 4, 3.4, 0.56),
    alarm: alarmAt(72, 5.0),
    watcherGait: GUARD_GAIT
  }),

  // House security on a private estate. Faster than Bruno, keeps hold of you
  // longer, and the grounds give him room to use both.
  Mansion: person({
    recovery: { delay: 1.25, rate: 4 },
    alertness: {
      from: 42, blur: 165, sharp: 12, speedLow: 0.82, speedHigh: 1.06,
      riseLow: 1.0, riseHigh: 0.45, sweepLow: 5.2, sweepHigh: 2.6,
      narrow: 0.70, refix: 4
    },
    investigate: {
      wakeAt: 54, calmAt: 33, rising: 0.8, settling: 0.7, speed: 102,
      accel: 540, decel: 720, searchFor: 4.2, catchAt: 24,
      followAt: 60, unfollowAt: 112, unfollowFor: 1.6
    },
    patrol: beat(2, 180, 4, 3.0, 0.60),
    alarm: alarmAt(76, 4.5),
    watcherGait: GUARD_GAIT
  }),

  // The owner, asleep in the only bed on an open floor. Ordinary as sleepers
  // go; the location does the work, because there is nowhere on that floor he
  // cannot see once he is standing.
  Penthouse: person({
    recovery: { delay: 0.95, rate: 6 },
    alertness: {
      blur: 205, sharp: 17, speedLow: 0.72, speedHigh: 1.18,
      riseLow: 2.0, riseHigh: 0.9, sweepLow: 3.8, sweepHigh: 2.0
    },
    investigate: { wakeAt: 63, calmAt: 41, rising: 1.5, speed: 82 },
    watcherGait: walkLike(WALKER_GAIT, { step: 1.02 })
  }),

  // The night manager, dozing behind the counter with the shutters down.
  Shop: person({
    recovery: { delay: 1.0, rate: 7.5 },
    alertness: {
      blur: 255, sharp: 22, speedLow: 0.66, speedHigh: 1.08,
      riseLow: 2.5, riseHigh: 1.2, sweepLow: 3.4, sweepHigh: 1.9
    },
    investigate: { wakeAt: 65, calmAt: 43, rising: 1.8, speed: 72 },
    watcherGait: walkLike(WALKER_GAIT, { step: 0.94, sway: 1.05 })
  }),

  // The last man in the game, and the only one who is properly awake before
  // you have done anything at all. He hears everything, he places it almost
  // exactly, and he is faster than you are tired.
  Vault: person({
    recovery: { delay: 1.4, rate: 3.5 },
    alertness: {
      from: 38, blur: 145, sharp: 10, speedLow: 0.86, speedHigh: 1.02,
      riseLow: 0.9, riseHigh: 0.4, sweepLow: 5.6, sweepHigh: 2.8,
      narrow: 0.74, refix: 3.5
    },
    investigate: {
      wakeAt: 50, calmAt: 30, rising: 0.7, settling: 0.6, speed: 110,
      accel: 580, decel: 760, searchFor: 4.6, catchAt: 25,
      followAt: 62, unfollowAt: 118, unfollowFor: 1.8
    },
    // No round. The vault is one ring of corridor with no side rooms to step
    // into, so a guard walking it is not something a thief can time — it is a
    // gauntlet with a man in it. He is posted at the door instead, which is
    // what the architecture is for: the danger here is his eyes, his speed and
    // the fact that there is exactly one way past him.
    alarm: alarmAt(82, 4.0),
    watcherGait: GUARD_GAIT
  })
};

// What the banner says while a location's person is on their feet, in place of
// the meter warnings: once someone is up and walking, what they are *doing*
// matters more to the player than what the number is. Keyed by state rather
// than by position in a list, because there are seven states and an index is
// the sort of thing that quietly stops matching the state machine.
function afoot(who, { patrols = false } = {}) {
  const said = {
    rising: `${who} IS GETTING UP`,
    investigating: `${who} IS COMING TO LOOK`,
    searching: `${who} IS LOOKING AROUND`,
    following: `${who} HAS SEEN YOU — RUN`,
    returning: `${who} IS GOING BACK`,
    settling: `${who} IS GOING BACK`
  };
  if (patrols) {
    said.patrolling = `${who} IS ON HIS ROUNDS`;
    said.watching = `${who} HAS STOPPED TO LISTEN`;
  }
  return said;
}

export const TUNING = {
  world: {
    // The camera window, in world units. Every level used to be exactly this
    // size and wholly on screen; a level may now be larger, in which case this
    // is how much of it you can see at once. The zoom never changes, so a
    // player, a door and a wardrobe are the same size in a 400-wide bedroom
    // and in a 784-wide hotel floor.
    width: 400,
    height: 620,
    wallThickness: 14,
    hudStrip: 54,        // reserved band above the room, in world units
    exitWidth: 80,
    // Hand-drawn maps are authored on a tile grid. One tile is a shade under a
    // player-width, so a corridor two tiles across is comfortably walkable and
    // the floorplan proportions survive the conversion exactly.
    // A tile is a little under a player-width, so a two-tile doorway is
    // comfortably walkable and a five-tile bed is the size of the beds the
    // hand-placed levels already use. Scale stays identical across map sizes.
    tile: 20
  },

  // How the view follows you once a level is bigger than the window.
  camera: {
    // Exponential ease. Framerate-independent, so it feels the same at 60 and
    // 120Hz: high enough to keep up with a run, low enough not to snap.
    follow: 7.5,
    // Shake is applied to the camera, so it must not fight the follow.
    maxShake: 3.4
  },

  sim: {
    hz: 60,              // fixed simulation rate; dt is always 1/hz
    maxFrameSeconds: 0.25, // longest catch-up a single rAF frame may request
    maxStepsPerFrame: 5    // spiral-of-death guard
  },

  player: {
    speed: 132,          // world units per second (top speed is unchanged)
    accel: 950,          // ~0.14s from standing to full speed: smooth, still snappy
    decel: 1250,         // stopping is a little crisper than starting
    boxWidth: 22,
    boxHeight: 24,
    maxSubStep: 4,       // swept move: never advance more than this per sub-step
    strideRate: 0.062,   // walk-cycle phase per unit travelled — ties feet to speed
    turnRate: 14,        // how fast the character turns to face its heading

    // How the walk cycle changes shape with speed. The phase has always
    // advanced with distance travelled rather than with time, so the feet could
    // never skate — but the number of steps per unit was fixed, which meant a
    // creep and a sprint were the same stride played at two rates.
    //
    // Cadence is speed divided by stride length, so a shorter stride means more
    // steps over the same ground: tiptoeing raises the per-unit rate, running
    // lowers it. That is the whole trick, and it is why the animation cannot
    // drift out of sync with the movement — both are driven by the distance
    // actually covered.
    gait: {
      creepAt: 0.30,      // at or below this share of top speed he is tiptoeing
      walkAt: 0.46,       // ...and at or above it he is walking properly
      strideCreep: 0.088, // short careful steps: more of them per unit
      strideWalk: 0.062,  // unchanged, so a normal walk looks exactly as it did
      strideRun: 0.047    // long strides: fewer, bigger ones
    },
    // A thumb resting on the stick should not creep. Past the dead zone the
    // remaining range is stretched back out, so a gentle push is still a slow
    // walk rather than a jump to a quarter speed.
    deadZone: 0.08,
    runAt: 0.72          // where the walk starts turning into a run
  },

  noise: {
    max: 100,            // he wakes at this exact value
    // Where each visual sleep band begins: light, disturbed, almost awake,
    // and about-to-wake. Below the first he is in deep sleep.
    bands: [41, 61, 81, 96],
    stirringAt: 41,      // the HUD meter turns amber here
    almostAt: 81         // ...and red here
  },

  pickup: {
    radius: 26,          // circular, so range is the same in every direction
    // 'action' = you must press TAKE while in range (deliberate).
    // 'auto'   = the original beta behaviour, taken on touch.
    mode: 'action',
    reachSeconds: 0.42,  // the reach-and-grab animation
    reachSlow: 0.4       // movement scale while reaching — a hesitation, not a stop
  },

  feedback: {
    // A damped thud rather than random jitter: it reads as the room reacting,
    // not as the camera malfunctioning.
    shakePerNoise: 0.16,
    shakeMax: 3.4,
    shakeDecay: 9,
    shakeHz: 13
  },

  render: {
    maxPixelRatio: 3,        // sharper on modern phones than the old cap of 2
    maxCanvasPixels: 3.2e6   // ...but never more pixels than a mid-range GPU likes
  },

  // Item value / noise table. Art for each type lives in art.js, not here: the
  // simulation must never know what an item looks like.
  //
  // The six original types keep their exact numbers — the first ten levels are
  // balanced around them and must not shift. Everything below `coin` is new.
  items: {
    phone:  { value: 30,  noise: 8  },
    watch:  { value: 45,  noise: 10 },
    cash:   { value: 60,  noise: 12 },
    jewel:  { value: 90,  noise: 16 },
    laptop: { value: 120, noise: 22 },
    tv:     { value: 180, noise: 30 },

    coin:       { value: 10,  noise: 3  },
    wallet:     { value: 25,  noise: 6  },
    headphones: { value: 50,  noise: 11 },
    ring:       { value: 65,  noise: 13 },
    camera:     { value: 75,  noise: 14 },
    tablet:     { value: 85,  noise: 15 },
    console:    { value: 100, noise: 18 },
    speaker:    { value: 110, noise: 20 },
    necklace:   { value: 130, noise: 21 },
    // Fragile things are worth more than their noise suggests, because the
    // noise is front-loaded: they clink the moment you lift them.
    vase:       { value: 80,  noise: 17, fragile: true },
    painting:   { value: 160, noise: 25, fragile: true },
    mirror:     { value: 95,  noise: 19, fragile: true },
    diamond:    { value: 220, noise: 32 },
    goldbar:    { value: 300, noise: 38 }
  },

  // What a thing is worth tells you how loud and how slow it is. The bands are
  // read off the value, so a new item type cannot forget to declare its risk.
  rarity: {
    bands: [
      { name: 'Common',    upTo: 24,   tint: '#b9c3cf', pickup: 0.30 },
      { name: 'Uncommon',  upTo: 59,   tint: '#79c47a', pickup: 0.38 },
      { name: 'Rare',      upTo: 149,  tint: '#5aa9e6', pickup: 0.50 },
      { name: 'Very Rare', upTo: 9999, tint: '#e0a13a', pickup: 0.68 }
    ],
    bigScoreAt: 150      // at or above this, a steal is an event
  },

  // Stealing quickly, without dawdling, pays a little extra.
  combo: {
    window: 4.5,         // seconds between steals before the streak lapses
    tiers: [
      { at: 3, bonus: 0.05 },
      { at: 5, bonus: 0.10 },
      { at: 8, bonus: 0.15 }
    ]
  },

  // How you left, not just that you left.
  escape: {
    perfectNoise: 30,    // quiet...
    perfectTimeShare: 0.35, // ...and with a third of the clock still unspent
    perfectBonus: 25,
    closeCallNoise: 85,  // loud...
    closeCallTime: 2.5   // ...and on the buzzer
  },

  // Stars come from objectives, measured against what the room can actually
  // give up without waking him — never against its raw total, which is
  // frequently impossible.
  stars: {
    two: 0.5,
    three: 0.85,
    budget: 92           // the noise a perfect run is assumed to spend
  },

  // Two resources now: the meter and the clock.
  time: {
    base: 30,             // seconds on level 1
    perLevel: 0.56,       // ...shrinking by roughly half a second a level
    floor: 15,            // never tighter than this
    warnAt: 6             // the clock starts insisting here
  },

  // Simple environmental hazards. Trigger zones and bumps, nothing more.
  hazards: {
    creakNoise: 5,        // stepping onto a creaky board
    creakCooldown: 1.4,   // seconds before the same board can creak again

    // Walking into furniture. Soft things barely register; hard, hollow things
    // carry across a room. Scaled back from the first pass, where collisions
    // were contributing a third of the meter and the game quietly stopped
    // being about whether to steal one more thing.
    bump: {
      bed: 2, sofa: 2, nightstand: 3, table: 4,
      chest: 4, tvBench: 4, wardrobe: 5, bookshelf: 6,
      plinth: 6            // stone, and it rings
    },
    bumpCooldown: 1.0,    // one bump per collision, not one per frame
    bumpThreshold: 0.34,  // how squarely you must hit it to count at all
    // How hard you hit it matters as much as what you hit: a brush at the
    // threshold costs a fraction, a full-speed run into a bookshelf costs
    // double. This is what makes moving fast a real decision.
    bumpSoftest: 0.35,
    bumpHardest: 2.1,
    recoil: 4,            // world units bounced back on a hard collision

    // Footsteps. Bare boards carry; a rug swallows them. Small on purpose —
    // it is a reason to prefer one route over another, not a second clock.
    walkNoise: 0.55,      // per second at full speed on hard floor
    softFloorScale: 0     // ...and on a rug
  },

  // Who you are trying not to disturb. Every kind feeds the same 0-100 meter,
  // so nothing about the existing game changes — but what fills that meter,
  // and what it is called on screen, depends on who is in the room.
  watchers: {
    sleeper: {
      meter: 'NOISE', person: 'He', sees: 0, seeRate: 0,
      warnings: ["HE'S STIRRING…", "HE'S ALMOST AWAKE", "HE'S WAKING UP!"],
      lost: 'HE WOKE UP!', lostWhy: 'The noise reached 100 and he woke up.',
      // Every one of them can now get up and come looking, so every one of
      // them can walk into you.
      caught: 'CAUGHT!',
      caughtWhy: 'He walked in on you while he was up looking for the noise.',
      onFoot: afoot('HE')
    },
    // A guard is not asleep. He is bored, and he can see: crossing his line of
    // sight while moving raises the meter even in complete silence. Standing
    // still inside it does not — freezing works.
    security: {
      meter: 'ALERT', person: 'The guard', sees: 158, seeRate: 22,
      warnings: ['SECURITY LOOKS UP', 'SECURITY IS SUSPICIOUS', 'SECURITY IS RISING!'],
      lost: 'SPOTTED!', lostWhy: 'Security reached full alert and saw you.',
      // Every one of them can now get up and come looking, so every one of
      // them can walk into you.
      caught: 'CAUGHT!',
      caughtWhy: 'Security walked into you while sweeping the floor.',
      onFoot: afoot('SECURITY', { patrols: true })
    },
    // The school caretaker, asleep in the staff room. Noise only, like the
    // bedroom sleeper — an older man dozing in a chair is not watching for you.
    caretaker: {
      meter: 'NOISE', person: 'Mr. Vrána', sees: 0, seeRate: 0,
        // At his desk, not on a couch and certainly not in a bed: he is the
        // caretaker, he was doing the rota, and he nodded off over it.
        pose: 'desk',
      warnings: ['MR. VRÁNA STIRS…', 'MR. VRÁNA IS ALMOST AWAKE',
        'MR. VRÁNA IS WAKING!'],
      lost: 'HE WOKE UP!', lostWhy: 'The noise reached 100 and the caretaker woke up.',
      // He is the only one who gets up and comes looking, so he is the only one
      // who can walk into you.
      caught: 'CAUGHT!',
      caughtWhy: 'Mr. Vrána walked in on you while he was investigating the noise.',
      // Shown while he is on his feet, in place of the noise-threshold
      // warnings: what he is doing matters more than the number by then.
      // Keyed by what he is doing rather than by position in a list: there are
      // more states than there were, and an index is the sort of thing that
      // quietly stops matching the state machine.
      onFoot: {
        rising: 'MR. VRÁNA IS GETTING UP',
        investigating: 'HE IS COMING TO LOOK',
        searching: 'HE IS LOOKING AROUND',
        following: 'HE HAS SEEN YOU — RUN',
        returning: 'HE IS GOING BACK',
        settling: 'HE IS GOING BACK'
      }
    },

    // --- the seven named people of the floorplan levels ---------------------
    // Bruno is a guard first and asleep second: doze off in front of him and he
    // stays put, but cross the hall while he is stirring and he sees you.
    nightguard: {
      meter: 'ALERT', person: 'Bruno', sees: 150, seeRate: 20, pose: 'guard',
      warnings: ['BRUNO LOOKS UP', 'BRUNO IS SUSPICIOUS', 'BRUNO IS GETTING UP!'],
      lost: 'SPOTTED!', lostWhy: 'Bruno reached full alert and saw you.',
      // Every one of them can now get up and come looking, so every one of
      // them can walk into you.
      caught: 'CAUGHT!',
      caughtWhy: 'Bruno walked into you while he was searching the galleries.',
      onFoot: afoot('BRUNO', { patrols: true })
    },
    // Mr. Halas fell asleep on the quarterly report. Noise only — but he is
    // face down at his desk, which is a lighter sleep than a bed.
    worker: {
      meter: 'NOISE', person: 'Mr. Halas', sees: 0, seeRate: 0, pose: 'desk',
      warnings: ['MR. HALAS SHIFTS…', 'MR. HALAS IS ALMOST AWAKE', 'MR. HALAS IS WAKING!'],
      lost: 'HE WOKE UP!', lostWhy: 'The noise reached 100 and Mr. Halas woke up.',
      // Every one of them can now get up and come looking, so every one of
      // them can walk into you.
      caught: 'CAUGHT!',
      caughtWhy: 'Mr. Halas walked in on you while he was up.',
      onFoot: afoot('MR. HALAS')
    },
    // Otakar, asleep at the floor desk with the whole corridor to watch.
    porter: {
      meter: 'NOISE', person: 'Otakar', sees: 0, seeRate: 0, pose: 'desk',
      warnings: ['OTAKAR STIRS…', 'OTAKAR IS ALMOST AWAKE', 'OTAKAR IS WAKING!'],
      lost: 'HE WOKE UP!', lostWhy: 'The noise reached 100 and Otakar woke up.',
      // Every one of them can now get up and come looking, so every one of
      // them can walk into you.
      caught: 'CAUGHT!',
      caughtWhy: 'Otakar walked into you on his round of the floor.',
      onFoot: afoot('OTAKAR', { patrols: true })
    },
    dad: {
      meter: 'NOISE', person: 'Dad', sees: 0, seeRate: 0, pose: 'bed',
      warnings: ['DAD ROLLS OVER…', 'DAD IS ALMOST AWAKE', 'DAD IS WAKING UP!'],
      lost: 'DAD WOKE UP!', lostWhy: 'The noise reached 100 and Dad woke up.',
      // Every one of them can now get up and come looking, so every one of
      // them can walk into you.
      caught: 'CAUGHT!',
      caughtWhy: 'Dad walked in on you while he was up looking for the noise.',
      onFoot: afoot('DAD')
    },
    // Dr. Marek, out on the staff couch after a long shift.
    doctor: {
      meter: 'NOISE', person: 'Dr. Marek', sees: 0, seeRate: 0, pose: 'couch',
      warnings: ['DR. MAREK STIRS…', 'DR. MAREK IS ALMOST AWAKE', 'DR. MAREK IS WAKING!'],
      lost: 'HE WOKE UP!', lostWhy: 'The noise reached 100 and Dr. Marek woke up.',
      // Every one of them can now get up and come looking, so every one of
      // them can walk into you.
      caught: 'CAUGHT!',
      caughtWhy: 'Dr. Marek walked in on you while he was up.',
      onFoot: afoot('DR. MAREK')
    },
    // Grandpa, asleep in the armchair by the fire.
    grandpa: {
      meter: 'NOISE', person: 'Grandpa', sees: 0, seeRate: 0, pose: 'chair',
      warnings: ['GRANDPA STIRS…', 'GRANDPA IS ALMOST AWAKE', 'GRANDPA IS WAKING!'],
      lost: 'GRANDPA WOKE UP!', lostWhy: 'The noise reached 100 and Grandpa woke up.',
      // Every one of them can now get up and come looking, so every one of
      // them can walk into you.
      caught: 'CAUGHT!',
      caughtWhy: 'Grandpa walked in on you while he was up.',
      onFoot: afoot('GRANDPA')
    },
    // The penthouse's owner, asleep in the only bed on the floor.
    owner: {
      meter: 'NOISE', person: 'The owner', sees: 0, seeRate: 0, pose: 'bed',
      warnings: ['THE OWNER STIRS…', 'THE OWNER IS ALMOST AWAKE', 'THE OWNER IS WAKING!'],
      lost: 'HE WOKE UP!', lostWhy: 'The noise reached 100 and the owner woke up.',
      // Every one of them can now get up and come looking, so every one of
      // them can walk into you.
      caught: 'CAUGHT!',
      caughtWhy: 'The owner walked in on you while he was up.',
      onFoot: afoot('THE OWNER')
    },
    // The night manager, dozing behind the counter.
    shopkeeper: {
      meter: 'NOISE', person: 'The manager', sees: 0, seeRate: 0, pose: 'desk',
      warnings: ['THE MANAGER STIRS…', 'THE MANAGER IS ALMOST AWAKE',
        'THE MANAGER IS WAKING!'],
      lost: 'HE WOKE UP!', lostWhy: 'The noise reached 100 and the manager woke up.',
      // Every one of them can now get up and come looking, so every one of
      // them can walk into you.
      caught: 'CAUGHT!',
      caughtWhy: 'The manager walked into you behind the shelves.',
      onFoot: afoot('THE MANAGER')
    },
    // The vault's guard is the most awake person in the game: the widest field
    // of view, and the quickest to place a sound.
    vaultguard: {
      meter: 'ALERT', person: 'The guard', sees: 150, seeRate: 24, pose: 'guard',
      warnings: ['THE GUARD LOOKS UP', 'THE GUARD IS ON HIS FEET', 'HE HAS SEEN SOMETHING!'],
      lost: 'SPOTTED!', lostWhy: 'The vault guard reached full alert and saw you.',
      // Every one of them can now get up and come looking, so every one of
      // them can walk into you.
      caught: 'CAUGHT!',
      caughtWhy: 'The guard walked into you on his round of the vault.',
      onFoot: afoot('THE GUARD', { patrols: true })
    }
  },

  // A hard bang makes him flinch visibly, on top of what it does to the meter.
  startle: {
    fromImpact: 1,       // scale of the flinch, 0..1, from collision strength
    decay: 1.1           // per second
  },

  // Standing perfectly still lets the room settle. Slow enough that it is a
  // real decision against the clock, never a reset button.
  recovery: {
    delay: 0.6,           // how long you must be still before it starts
    rate: 2               // noise per second once it does
  },

  // Mechanics that belong to a location and to its person.
  //
  // One entry per location, each one a set of differences from the shared
  // machinery defined above the export — so this is the table to read to find
  // out how a hotel porter differs from a vault guard, and it is short because
  // almost everything they have in common has already been said once.
  locations: PEOPLE,

  // Three upgrades, deliberately few. None of them touches the risk/reward
  // decision: nothing here makes a stolen item quieter.
  upgrades: {
    shoes: {
      name: 'Soft Shoes',
      blurb: 'Creaky boards bother you less.',
      icon: '👟',
      costs: [400, 1200, 3000],
      // multiplier applied to hazard noise
      effect: [1, 0.65, 0.35, 0]
    },
    feet: {
      name: 'Quick Feet',
      blurb: 'Move a little faster.',
      icon: '⚡',
      costs: [500, 1500, 3500],
      effect: [1, 1.07, 1.14, 1.22]
    },
    bag: {
      name: 'Velvet Bag',
      blurb: 'Fences pay you more for the same haul.',
      icon: '🎒',
      costs: [600, 1800, 4200],
      effect: [1, 1.12, 1.25, 1.4]
    }
  },

  // Graphics quality caps the render resolution and the particle budget.
  quality: {
    low:    { pixelRatio: 1,   particles: 0 },
    medium: { pixelRatio: 2,   particles: 8 },
    high:   { pixelRatio: 3,   particles: 16 }
  }
};
