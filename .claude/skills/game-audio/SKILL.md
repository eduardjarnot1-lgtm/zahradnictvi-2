---
name: game-audio
description: Design and implement game sound with the Web Audio API — synthesized sound effects with no asset files, adaptive/layered music, spatial panning, ducking, and a scheduler that stays in time. Use this whenever a browser game or interactive page needs sound: footsteps, impacts, UI clicks, alarms, snoring, ambience, a rhythm the player must follow, "the game feels silent", audio that stutters or drifts out of time, or sounds that won't play until the user clicks. Also use when deciding whether to synthesize a sound or ship an audio file.
---

# Game audio with the Web Audio API

Sound is half of a game's feel and the half people forget. A stealth game where the
floorboard creak arrives 80ms late is not tense, it is broken. This skill covers making
sound that is *in time*, *informative*, and *shippable without a single .mp3*.

## The three rules that prevent most bugs

**1. One AudioContext, created on a user gesture.** Browsers refuse to start audio
without one. Create the context lazily on the first pointer/key event and resume it —
never at page load, or the first sound of the game silently never plays.

```js
let ctx = null;
export function unlockAudio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
```

**2. Schedule ahead with `ctx.currentTime`, never with `setTimeout`.** `setTimeout` is
subject to the main thread and drifts audibly within seconds. Every start/stop takes an
absolute time argument. This is the single biggest difference between "sounds like a
game" and "sounds like a web page".

**3. Everything goes through a gain node you own.** Never connect a source straight to
`ctx.destination`. You want a master bus so you can duck, mute, and fade — and per-
category buses (sfx / music / ui) so a volume slider is one line instead of a refactor.

```js
const master = ctx.createGain();       master.connect(ctx.destination);
const sfxBus = ctx.createGain();       sfxBus.connect(master);
const musicBus = ctx.createGain();     musicBus.connect(master);
```

## Synthesize first, sample second

For most small games you should ship zero audio files. Synthesized sound is a few
hundred bytes of code, loads instantly, and — crucially — is *parametric*: the same
function makes a small creak and a huge creak by changing one number, which is exactly
what a game needs. Reach for a sample only when the sound is irreducibly complex
(a voice, a specific song, real foley).

The building blocks, and what each is good for:

| Node | Use it for |
|---|---|
| `OscillatorNode` (sine/triangle) | tones, UI blips, snoring, alarms, melody |
| `OscillatorNode` (saw/square) | harsh, retro, engines, buzzers |
| noise buffer + `BiquadFilterNode` | footsteps, wind, creaks, impacts, breath |
| `BiquadFilterNode` sweep | "whoosh", muffling behind a door, underwater |
| `DynamicsCompressorNode` on master | stops layered sounds from clipping |
| `ConvolverNode` | room reverb — a synthesized impulse is fine |
| `StereoPannerNode` | left/right position of a sound source |

### The envelope is the sound

An oscillator with no envelope is a test tone; the same oscillator with a 5ms attack and
a 200ms exponential decay is a *pluck*. Amplitude shape carries more identity than
waveform choice. Use `exponentialRampToValueAtTime` for decays (it matches how we hear
loudness) but never ramp exponentially to 0 — it throws. Ramp to `0.0001` and stop.

```js
function env(param, t, { attack = 0.005, decay = 0.2, peak = 1 }) {
  param.setValueAtTime(0.0001, t);
  param.exponentialRampToValueAtTime(peak, t + attack);
  param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}
```

`references/recipes.md` has ready-made, tuned functions for: footstep, creak, impact,
UI click/confirm/deny, snore cycle, heartbeat, alarm rise, whoosh, and a noise-buffer
helper. Read it when you need an actual sound rather than the theory.

## Never play the same sound twice the same way

Repetition is what makes game audio cheap-sounding. Every time you fire a recurring
sound, randomize pitch by roughly ±5% and gain by ±15%, and where you have variants
pick one at random without immediately repeating the last. Two lines of code, enormous
difference.

```js
const vary = (v, amount) => v * (1 + (Math.random() * 2 - 1) * amount);
```

## Make sound carry information

In a game, audio is a *readout of state*, not decoration. Before writing a sound, ask
what the player learns from it. A stealth game's noise level, for instance, is better
communicated by a rising filter cutoff and a faster heartbeat than by any HUD bar —
players feel it before they read it. Map a continuous game variable to a continuous
audio parameter and the game teaches itself.

Concretely, useful mappings:
- danger/tension → low-pass cutoff opening, heartbeat rate, music layer count
- proximity → gain + pan + high-frequency rolloff (distant things are dull, not just quiet)
- speed/charge → pitch
- health → filter muffling and a slight detune

## Adaptive music without a music library

Write the track as **layers that share a tempo and key**, all started together and all
looping, with only their gains changing. Fading a layer in over ~1s is seamless; starting
a new loop mid-game never is. Three layers (bed / rhythm / melody) is enough for a small
game.

For anything that must land on a beat — a rhythm mechanic, a stinger, the snore cycle
the player times their moves to — use a **lookahead scheduler**: a `setInterval` every
~25ms that schedules all events falling in the next ~100ms using absolute
`ctx.currentTime` values. The interval is allowed to be sloppy; the scheduled times are
not. `references/scheduler.md` has the full pattern with a working implementation.

## Ducking and priority

When many sounds fire at once the mix turns to mush and the important one is lost. Two
cheap fixes, both worth doing:

- **Duck** the music bus by ~6dB (gain × 0.5) over 50ms whenever a critical sfx plays,
  and release over ~400ms.
- **Cap voices per category** — if six footsteps want to play in one frame, play two.
  Track active sources per category and drop the excess; nobody notices the missing ones.

Put a `DynamicsCompressorNode` on the master bus as a safety net. It is not a substitute
for gain staging, but it stops the worst clipping.

## Respect the player

- Give a **mute control that works from the first frame**, and persist it in
  `localStorage`. Some people play with sound off permanently; a game that resets their
  choice every load is annoying enough to close.
- Ship **separate music/sfx volume** if the game has both.
- Suspend the context on `document.visibilitychange` when hidden, resume on return.
  Audio playing from a background tab is the fastest way to get a tab closed.
- Never rely on sound *alone* to convey a fail state — pair it with a visual cue.
  Some players are deaf, and many play muted.

## Debugging checklist

When sound misbehaves, walk this in order — it is almost always one of these:

1. **Nothing plays at all** → context is `suspended`; no user gesture yet.
2. **First sound is missing, rest are fine** → context created too late, or the
   oscillator was started before being connected.
3. **Drift / stutter over time** → `setTimeout` used for timing instead of scheduling.
4. **Crackle on every note** → gain jumps discontinuously; ramp it (even 5ms is enough).
5. **Sound stops after a while** → oscillators never `stop()`ed, node count exploded.
   One-shot sources are single-use: create, start, stop, discard.
6. **`exponentialRampToValueAtTime` throws** → target or current value is 0.
7. **Fine on desktop, silent on iOS** → context must be unlocked inside the gesture
   handler itself, not in a promise chain after it.

## Testing audio without listening to it

You cannot ear-check every build, and CI has no speakers. What you *can* assert:
node graph shape, that scheduled times are monotonically increasing and within
tolerance of the intended grid, that voice caps hold, and that `unlockAudio` is
idempotent. Use an `OfflineAudioContext` to render a sound and assert on the resulting
buffer — peak amplitude below clipping, non-silence, expected duration. That catches
the regressions that matter.
