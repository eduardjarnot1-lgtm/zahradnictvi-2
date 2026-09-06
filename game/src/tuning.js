// Every balance number in the game lives here. Nothing else defines a constant.
// Changing balance is a data edit; a debug tuning panel only has to walk this object.
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
      lost: 'HE WOKE UP!', lostWhy: 'The noise reached 100 and he woke up.'
    },
    // A guard is not asleep. He is bored, and he can see: crossing his line of
    // sight while moving raises the meter even in complete silence. Standing
    // still inside it does not — freezing works.
    security: {
      meter: 'ALERT', person: 'The guard', sees: 158, seeRate: 22,
      warnings: ['SECURITY LOOKS UP', 'SECURITY IS SUSPICIOUS', 'SECURITY IS RISING!'],
      lost: 'SPOTTED!', lostWhy: 'Security reached full alert and saw you.'
    },
    // The school caretaker, asleep in the staff room. Noise only, like the
    // bedroom sleeper — an older man dozing in a chair is not watching for you.
    caretaker: {
      meter: 'NOISE', person: 'Mr. Vrána', sees: 0, seeRate: 0, pose: 'couch',
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
      lost: 'SPOTTED!', lostWhy: 'Bruno reached full alert and saw you.'
    },
    // Mr. Halas fell asleep on the quarterly report. Noise only — but he is
    // face down at his desk, which is a lighter sleep than a bed.
    worker: {
      meter: 'NOISE', person: 'Mr. Halas', sees: 0, seeRate: 0, pose: 'desk',
      warnings: ['MR. HALAS SHIFTS…', 'MR. HALAS IS ALMOST AWAKE', 'MR. HALAS IS WAKING!'],
      lost: 'HE WOKE UP!', lostWhy: 'The noise reached 100 and Mr. Halas woke up.'
    },
    // Otakar, asleep at the floor desk with the whole corridor to watch.
    porter: {
      meter: 'NOISE', person: 'Otakar', sees: 0, seeRate: 0, pose: 'desk',
      warnings: ['OTAKAR STIRS…', 'OTAKAR IS ALMOST AWAKE', 'OTAKAR IS WAKING!'],
      lost: 'HE WOKE UP!', lostWhy: 'The noise reached 100 and Otakar woke up.'
    },
    dad: {
      meter: 'NOISE', person: 'Dad', sees: 0, seeRate: 0, pose: 'bed',
      warnings: ['DAD ROLLS OVER…', 'DAD IS ALMOST AWAKE', 'DAD IS WAKING UP!'],
      lost: 'DAD WOKE UP!', lostWhy: 'The noise reached 100 and Dad woke up.'
    },
    // Dr. Marek, out on the staff couch after a long shift.
    doctor: {
      meter: 'NOISE', person: 'Dr. Marek', sees: 0, seeRate: 0, pose: 'couch',
      warnings: ['DR. MAREK STIRS…', 'DR. MAREK IS ALMOST AWAKE', 'DR. MAREK IS WAKING!'],
      lost: 'HE WOKE UP!', lostWhy: 'The noise reached 100 and Dr. Marek woke up.'
    },
    // Grandpa, asleep in the armchair by the fire.
    grandpa: {
      meter: 'NOISE', person: 'Grandpa', sees: 0, seeRate: 0, pose: 'chair',
      warnings: ['GRANDPA STIRS…', 'GRANDPA IS ALMOST AWAKE', 'GRANDPA IS WAKING!'],
      lost: 'GRANDPA WOKE UP!', lostWhy: 'The noise reached 100 and Grandpa woke up.'
    },
    // The penthouse's owner, asleep in the only bed on the floor.
    owner: {
      meter: 'NOISE', person: 'The owner', sees: 0, seeRate: 0, pose: 'bed',
      warnings: ['THE OWNER STIRS…', 'THE OWNER IS ALMOST AWAKE', 'THE OWNER IS WAKING!'],
      lost: 'HE WOKE UP!', lostWhy: 'The noise reached 100 and the owner woke up.'
    },
    // The night manager, dozing behind the counter.
    shopkeeper: {
      meter: 'NOISE', person: 'The manager', sees: 0, seeRate: 0, pose: 'desk',
      warnings: ['THE MANAGER STIRS…', 'THE MANAGER IS ALMOST AWAKE',
        'THE MANAGER IS WAKING!'],
      lost: 'HE WOKE UP!', lostWhy: 'The noise reached 100 and the manager woke up.'
    },
    // The vault's guard is the most awake person in the game: the widest field
    // of view, and the quickest to place a sound.
    vaultguard: {
      meter: 'ALERT', person: 'The guard', sees: 150, seeRate: 24, pose: 'guard',
      warnings: ['THE GUARD LOOKS UP', 'THE GUARD IS ON HIS FEET', 'HE HAS SEEN SOMETHING!'],
      lost: 'SPOTTED!', lostWhy: 'The vault guard reached full alert and saw you.'
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

  // Mechanics that belong to one location and nowhere else.
  //
  // Everything above this point is the game. Everything in here is a named
  // location asking for something the game does not otherwise do — so a level
  // that is not listed keeps exactly the behaviour it had before this block
  // existed, and there is one place to look to find out which levels are
  // special and how.
  locations: {
    School: {
      // How close you are to Mr. Vrána decides how much a given noise costs.
      // Standing over him, a dropped phone is deafening; three classrooms
      // away, the same phone barely registers.
      //
      // The curve is smooth between the two distances, so there is no line to
      // step across and be surprised by — you can feel it tighten as you walk
      // towards him. Both ends are deliberately far from 1.0: if the far end
      // were 0.9 the whole mechanic would be a rounding error.
      proximity: {
        near: 90,          // world units — about four tiles, i.e. the same room
        // Far enough that the whole of even the biggest school map sits inside
        // the falloff. There is no "outside his hearing" any more: the curve
        // runs continuously from his elbow to the far corner, and the quietest
        // corner of the building is still only a shade under full price.
        far: 560,
        nearScale: 3.0,    // three times as loud, standing over him
        farScale: 0.85     // ...and barely muffled at the other end of the school
      },
      // What changes once he is on his feet. A man awake is listening, and he
      // carries that with him — a second, smaller curve centred on wherever he
      // happens to be standing, multiplied on top of the first. It is what
      // stops the answer to "he woke up" being "carry on somewhere else".
      awake: {
        radius: 220,       // how far his attention reaches while he is up
        boost: 1.7         // at his feet; easing back to 1 at the edge of it
      },
      // The school is the one place noise comes back down fast enough to be a
      // tactic rather than a consolation. Standing still is how you send him
      // back to the staff room, so it has to actually work inside the clock —
      // but the delay is longer than elsewhere, so it is never a reflex.
      recovery: { delay: 0.9, rate: 7 },
      // Looking inside the furniture.
      //
      // The decision this exists to create: a cabinet might hold a diamond or
      // it might hold nothing, and finding out costs you noise, a second and a
      // half of the clock, and standing still while the meter is read off how
      // close you are to Mr. Vrána. The whole mechanic falls apart in one
      // direction if searching is free and in the other if it is deafening, so
      // the numbers here are small and the multiplier does the work.
      search: {
        reach: 34,          // how close a piece has to be to offer itself
        duration: 1.25,     // seconds spent with your hands in the drawer
        moveScale: 0.12,    // you can shuffle, not walk, while you are at it
        // Opening the thing, before you have any idea what is inside. Hard,
        // hollow furniture carries; a desk drawer barely does.
        noise: {
          table: 3, nightstand: 3, chest: 4, tvBench: 4,
          sofa: 2, wardrobe: 5, bookshelf: 5, plinth: 6
        }
      },
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
      gait: {
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
      },
      // Mr. Vrána walks the same way and is not the same walker. He is older and
      // heavier: shorter steps, less lift, more roll from side to side, and no
      // run in him at all. His share is measured against the *player's* top
      // speed rather than his own, which is the whole trick — at his 78 against
      // the thief's 132 he sits at 0.59, a purposeful walk, where measuring him
      // against himself put him at 1.0 and made him sprint every time he moved.
      caretakerGait: {
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
      },
      // The school's two characters are drawn by src/figure.js rather than by
      // the older art.js walker. One flag, so making it the whole game's look
      // is a one-line change rather than a rewrite.
      figures: true,
      // Mr. Vrána, once he is awake.
      investigate: {
        wakeAt: 80,        // he gets up when the meter passes this
        calmAt: 50,        // ...and gives up when it falls back under this
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
      }
    }
  },

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
