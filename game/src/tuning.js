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
    speed: 132,          // world units per second
    boxWidth: 22,
    boxHeight: 24,
    maxSubStep: 4        // swept move: never advance more than this per sub-step
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
    mode: 'action'
  },

  feedback: {
    shakePerNoise: 0.35, // screen shake scales with how loud the item was
    shakeMax: 10,
    shakeDecay: 22
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
