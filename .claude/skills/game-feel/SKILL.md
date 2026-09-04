---
name: game-feel
description: Make a game feel good to play — input responsiveness (coyote time, input buffering, dead zones), juice (screen shake, hit stop, squash and stretch, particles, easing), readable feedback, and a fixed-timestep game loop that doesn't stutter. Use this whenever a game is described as floaty, stiff, unresponsive, mushy, unsatisfying, laggy or "technically works but feels wrong"; when tuning jumps, movement, hits or camera; when adding polish, effects or transitions; or when writing a game's update/render loop.
---

# Game feel

Game feel is the difference between a game that works and a game people want to keep
touching. It is almost entirely made of things that are invisible in a feature list:
a few frames of delay here, a slight overshoot there, forgiveness the player never
notices but always benefits from.

The organizing idea: **the player's intent is sacred; the simulation is negotiable.**
When the player clearly meant to jump, they jump — even if the strict physics say they
had already left the ledge. Every technique below is a way of honoring intent.

## Input comes first

No amount of particles rescues bad input handling. Get these right before anything else.

**Coyote time.** Accept a jump for ~100ms *after* walking off a ledge. Players press jump
slightly late constantly, perceive the ledge as still under them, and blame the game when
it doesn't fire. Nobody has ever noticed coyote time being present; everybody notices it
missing.

**Input buffering.** Remember an action pressed up to ~150ms *before* it becomes legal,
and fire it the moment it does. A jump pressed just before landing should fire on landing.
Without buffering, the better the player's rhythm, the more inputs the game eats.

```js
// Both techniques are the same shape: a small timer, checked instead of a boolean.
if (grounded) coyote = 0.1; else coyote = Math.max(0, coyote - dt);
if (jumpPressed) buffer = 0.15; else buffer = Math.max(0, buffer - dt);

if (buffer > 0 && coyote > 0) { jump(); buffer = 0; coyote = 0; }
```

**Never poll input in the render loop only.** Read events as they arrive and consume them
in the fixed update, or a fast tap between frames disappears entirely.

**Act on keydown, not keyup**, for anything the player expects to be instant. And support
holding: a variable jump (cut upward velocity when the key releases early) gives fine
control at zero cost in complexity.

**Dead zones on analog input** — ignore stick magnitude below ~0.2, then rescale the
remainder so the response starts from zero rather than jumping to 0.2. Without the
rescale, small movements are impossible.

## The loop: fixed simulation, interpolated rendering

Variable-timestep physics makes behavior depend on frame rate — jumps are higher on a
144Hz monitor, collisions tunnel on a slow frame. Simulate at a fixed step, render as
often as the display allows, and interpolate between the last two states so motion stays
smooth.

```js
const STEP = 1 / 60;
let acc = 0, prev = performance.now(), state = init(), prevState = state;

function frame(now) {
  // Clamp: after a tab switch the delta can be seconds, and the loop would
  // "spiral" trying to catch up. Dropping time is always better than freezing.
  acc += Math.min((now - prev) / 1000, 0.25);
  prev = now;
  while (acc >= STEP) { prevState = state; state = update(state, STEP); acc -= STEP; }
  render(prevState, state, acc / STEP);   // alpha in [0,1)
  requestAnimationFrame(frame);
}
```

Once the game has audio, prefer the audio clock (`ctx.currentTime`) as the master time
source — see the `game-audio` skill. Two clocks always drift apart.

## Juice, in order of value per line of code

Add these roughly in this order; the first three do most of the work.

**1. Hit stop (frame freeze).** On an impact, stop simulating for 50–120ms while still
rendering. It reads as *weight* — the single most effective trick in the list, and about
five lines. Scale duration with the significance of the hit, and never apply it to
routine events or the game feels laggy.

**2. Screen shake.** Decaying random offset applied to the camera. Two rules: decay it
(`amp *= 0.9` per frame, or lerp to zero) so it never feels like a rumble, and cap it —
big shake is exciting once and nauseating twice. Offer a reduce/disable option; shake
triggers motion sickness in some players and is a genuine accessibility issue.

```js
function shake(cam, amp) { cam.shake = Math.min(cam.shake + amp, MAX_SHAKE); }
// per frame:
cam.x = cam.tx + (Math.random() * 2 - 1) * cam.shake;
cam.y = cam.ty + (Math.random() * 2 - 1) * cam.shake;
cam.shake *= 0.86;
```

**3. Squash and stretch.** Scale non-uniformly with velocity — stretch along the direction
of travel, squash on landing, then spring back. It costs two multiplications and makes a
rectangle feel alive. Preserve area (`scaleX * scaleY ≈ 1`) or it reads as a bug.

**4. Anticipation and follow-through.** A tiny crouch before a jump, a small overshoot on
arrival. Motion that starts and stops instantly reads as mechanical; a few frames on
either side reads as intentional.

**5. Particles.** Even four squares that fly outward and fade communicate "something
happened here" better than a color change. Pool them — allocating per emit causes GC
stutter, which is the exact thing you were trying to hide.

**6. Trails and afterimages** for fast movement, so the eye can track it across frames.

## Easing: what to use where

Linear motion looks wrong for almost everything, because nothing in the physical world
moves that way.

| Feel wanted | Curve |
|---|---|
| UI appearing, camera settling | ease-out (fast start, gentle stop) |
| UI leaving | ease-in |
| A→B movement | ease-in-out |
| Snappy, alive, "poppy" | back / overshoot (goes slightly past, returns) |
| Bouncy, playful | elastic — sparingly, it dates fast |
| Following a target | exponential smoothing (below) |

Frame-rate-independent smoothing, which is what you want for cameras and any "chase"
behavior. The naive `x += (target - x) * 0.1` is frame-rate dependent and subtly wrong:

```js
const smooth = (cur, target, halfLife, dt) =>
  target + (cur - target) * Math.pow(0.5, dt / halfLife);
```

## Camera

The camera is a gameplay system, not a viewport. What earns its keep:

- **Lag behind the target** (smoothing above, half-life ~0.1–0.2s). Instant camera feels
  glued and makes fast motion unreadable.
- **Look ahead** in the direction of movement or facing, so the player sees where they
  are going rather than where they were.
- **A dead zone** — don't move at all until the target leaves a central box. Constant
  micro-motion is exhausting.
- **Clamp to level bounds** so the void never shows.
- **Zoom out slightly** with speed or tension.

## Feedback must be redundant

Anything important should be communicated at least two ways — position *and* color,
sound *and* animation, HUD *and* world-space cue. This is partly accessibility (color
blindness, deafness, muted tabs) and partly that redundant signals are simply read faster.

Feedback also has to be **immediate**. A response more than ~100ms after the input feels
disconnected even when the player can't say why. If a real consequence takes longer,
acknowledge the input instantly with something small — a flash, a click — and let the
consequence arrive after.

**Telegraph before you punish.** Any threat should have a visible and audible wind-up
long enough to react to. Damage from an unannounced source reads as unfair, and unfair
is the one feeling players don't forgive.

## Difficulty forgiveness that players never see

These are standard in commercial games and invisible when done right: a slightly smaller
hurtbox than the sprite; a brief grace period after taking damage; guaranteeing the first
hit of an encounter can't kill; nudging near-misses into hits on the player's side and
out on the enemy's; and coyote/buffer timing everywhere, not just on jumps.

The principle: bias every ambiguous case in the player's favor. They will describe the
game as "tight" rather than "easy", because the cases you helped with are the ones they
already believed they had won.

## Respect settings

- `prefers-reduced-motion` should cut screen shake, big transitions and parallax. Honor
  it and also expose your own toggle — the OS setting is coarse.
- Pause on blur. A game that keeps running while the player is in another tab is a game
  they come back to having lost.
- Never trap the pointer or fullscreen without an explicit action.

## Diagnosing "it feels bad"

Players report a single feeling; the cause is usually specific. Work through these:

| Complaint | Usual cause |
|---|---|
| "Floaty" | Gravity too low, or too little acceleration/friction — motion has no weight |
| "Stiff", "robotic" | No easing, no anticipation, no squash/stretch |
| "Unresponsive" | No buffering; acting on keyup; input read only in render |
| "Unfair" | No telegraph, no coyote time, hurtbox matches the sprite exactly |
| "Mushy", "imprecise" | Too much smoothing on input, or velocity-based instead of position-based control |
| "Nothing happens when I hit things" | No hit stop, no shake, no particles, no sound |
| "Laggy" | GC stutter from per-frame allocation, or hit stop applied too liberally |
| "Slippery" | Friction too low, or no separate deceleration when input releases |

When several apply, fix input first, then the loop, then juice. Polish layered on
unresponsive input just makes the unresponsiveness prettier.
