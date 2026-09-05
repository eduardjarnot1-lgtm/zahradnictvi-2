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
    // A hotel guest sleeps lighter and the clock is tighter, but the rules are
    // the same: noise only.
    guest: {
      meter: 'NOISE', person: 'She', sees: 0, seeRate: 0,
      warnings: ['SHE ROLLS OVER…', 'SHE IS ALMOST AWAKE', 'SHE IS WAKING UP!'],
      lost: 'SHE WOKE UP!', lostWhy: 'The noise reached 100 and she woke up.'
    },
    // A guard is not asleep. He is bored, and he can see: crossing his line of
    // sight while moving raises the meter even in complete silence. Standing
    // still inside it does not — freezing works.
    guard: {
      meter: 'ALERT', person: 'The guard', sees: 132, seeRate: 18,
      warnings: ['THE GUARD LOOKS UP', 'THE GUARD IS SUSPICIOUS', 'THE GUARD IS RISING!'],
      lost: 'SPOTTED!', lostWhy: 'The guard reached full alert and saw you.'
    },
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
      lost: 'HE WOKE UP!', lostWhy: 'The noise reached 100 and the caretaker woke up.'
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
