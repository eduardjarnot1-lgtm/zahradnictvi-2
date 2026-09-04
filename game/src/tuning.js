// Every balance number in the game lives here. Nothing else defines a constant.
// Changing balance is a data edit; a debug tuning panel only has to walk this object.
export const TUNING = {
  world: {
    width: 400,          // room coordinate space
    height: 620,
    wallThickness: 14,
    hudStrip: 40,        // reserved band above the room, in world units
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
    stirringAt: 51,      // sleeper visual stages
    almostAt: 81
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

  // Item value / noise table. Art for each type lives in render.js, not here:
  // the simulation must never know what an item looks like.
  items: {
    phone:  { value: 30,  noise: 8  },
    watch:  { value: 45,  noise: 10 },
    cash:   { value: 60,  noise: 12 },
    jewel:  { value: 90,  noise: 16 },
    laptop: { value: 120, noise: 22 },
    tv:     { value: 180, noise: 30 }
  }
};
