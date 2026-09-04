// Every balance number in the game lives here. Nothing else defines a constant.
// Changing balance is a data edit; a debug tuning panel only has to walk this object.
export const TUNING = {
  world: {
    width: 400,          // room coordinate space
    height: 620,
    wallThickness: 14,
    hudStrip: 54,        // reserved band above the room, in world units
    exitWidth: 80
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
    turnRate: 14         // how fast the character turns to face its heading
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
      chest: 4, tvBench: 4, wardrobe: 5, bookshelf: 6
    },
    bumpCooldown: 1.0,    // one bump per collision, not one per frame
    bumpThreshold: 0.62   // how squarely you must hit it to count at all
  },

  // Standing perfectly still lets the room settle. Slow enough that it is a
  // real decision against the clock, never a reset button.
  recovery: {
    delay: 0.6,           // how long you must be still before it starts
    rate: 2               // noise per second once it does
  },

  // Escape with a big enough share of the room's total value.
  stars: {
    two: 0.5,
    three: 0.8
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
