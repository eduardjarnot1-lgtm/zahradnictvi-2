# Synthesized sound recipes

Drop-in functions. Every one takes `ctx`, a destination node, an absolute start time `t`,
and options. They create their own nodes and clean up after themselves. Tuned by ear —
treat the numbers as a starting point and adjust to taste.

## Contents
- [Shared helpers](#shared-helpers)
- [Noise-based: footstep, creak, whoosh, impact](#noise-based)
- [Tonal: click, confirm, deny, alarm](#tonal)
- [Cyclic: snore, heartbeat](#cyclic)
- [Reverb without an impulse file](#reverb)

## Shared helpers

```js
const vary = (v, amount) => v * (1 + (Math.random() * 2 - 1) * amount);

// White noise buffer. Cache it — allocating one per sound is wasteful.
let noiseBuf = null;
function noise(ctx, seconds = 1) {
  if (noiseBuf && noiseBuf.duration >= seconds) return noiseBuf;
  const len = Math.ceil(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return (noiseBuf = buf);
}

// Amplitude envelope. Never ramp exponentially to exactly 0 — it throws.
function env(param, t, { attack = 0.005, decay = 0.2, peak = 1 }) {
  param.setValueAtTime(0.0001, t);
  param.exponentialRampToValueAtTime(peak, t + attack);
  param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}
```

## Noise-based

### Footstep
Soft thud + a little grit. `weight` 0..1 moves it from a tiptoe to a stomp.

```js
export function footstep(ctx, dest, t, { weight = 0.5, gain = 0.4 } = {}) {
  const src = ctx.createBufferSource(); src.buffer = noise(ctx);
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.setValueAtTime(vary(300 + weight * 900, 0.15), t);
  filt.Q.value = 1.2;
  const g = ctx.createGain();
  env(g.gain, t, { attack: 0.004, decay: 0.05 + weight * 0.08, peak: vary(gain * (0.4 + weight), 0.15) });
  src.connect(filt).connect(g).connect(dest);
  src.start(t); src.stop(t + 0.4);
}
```

### Creak
The signature stealth-game sound: filtered noise with a *wobbling* resonant peak.
`strain` raises the pitch and the anxiety.

```js
export function creak(ctx, dest, t, { dur = 0.5, strain = 0.5, gain = 0.3 } = {}) {
  const src = ctx.createBufferSource(); src.buffer = noise(ctx); src.loop = true;
  const filt = ctx.createBiquadFilter();
  filt.type = 'bandpass';
  filt.Q.value = 18;                                  // high Q = the "creak" resonance
  const base = vary(400 + strain * 700, 0.2);
  filt.frequency.setValueAtTime(base, t);
  filt.frequency.linearRampToValueAtTime(base * 1.5, t + dur);
  // slow wobble on the resonance sells "wood under weight"
  const lfo = ctx.createOscillator(); lfo.frequency.value = vary(7, 0.3);
  const lfoGain = ctx.createGain(); lfoGain.gain.value = base * 0.15;
  lfo.connect(lfoGain).connect(filt.frequency);
  const g = ctx.createGain();
  env(g.gain, t, { attack: 0.03, decay: dur, peak: vary(gain, 0.2) });
  src.connect(filt).connect(g).connect(dest);
  lfo.start(t); src.start(t);
  lfo.stop(t + dur + 0.1); src.stop(t + dur + 0.1);
}
```

### Whoosh
Filter sweep on noise. Good for dashes, doors, transitions.

```js
export function whoosh(ctx, dest, t, { dur = 0.35, gain = 0.25 } = {}) {
  const src = ctx.createBufferSource(); src.buffer = noise(ctx); src.loop = true;
  const filt = ctx.createBiquadFilter();
  filt.type = 'bandpass'; filt.Q.value = 2;
  filt.frequency.setValueAtTime(300, t);
  filt.frequency.exponentialRampToValueAtTime(4000, t + dur * 0.6);
  filt.frequency.exponentialRampToValueAtTime(400, t + dur);
  const g = ctx.createGain();
  env(g.gain, t, { attack: dur * 0.3, decay: dur * 0.7, peak: gain });
  src.connect(filt).connect(g).connect(dest);
  src.start(t); src.stop(t + dur + 0.05);
}
```

### Impact
Noise burst + a pitched-down sine "body". The sine is what makes it feel heavy.

```js
export function impact(ctx, dest, t, { size = 0.5, gain = 0.5 } = {}) {
  const src = ctx.createBufferSource(); src.buffer = noise(ctx);
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass'; filt.frequency.value = 800 + (1 - size) * 2000;
  const ng = ctx.createGain();
  env(ng.gain, t, { attack: 0.001, decay: 0.06 + size * 0.1, peak: gain * 0.6 });
  src.connect(filt).connect(ng).connect(dest);

  const osc = ctx.createOscillator(); osc.type = 'sine';
  osc.frequency.setValueAtTime(vary(140 - size * 80, 0.1), t);
  osc.frequency.exponentialRampToValueAtTime(vary(45 - size * 20, 0.1), t + 0.18);
  const og = ctx.createGain();
  env(og.gain, t, { attack: 0.002, decay: 0.2 + size * 0.3, peak: gain });
  osc.connect(og).connect(dest);

  src.start(t); src.stop(t + 0.5);
  osc.start(t); osc.stop(t + 0.6);
}
```

## Tonal

```js
// Generic pluck — the basis of most UI sound.
function tone(ctx, dest, t, { freq, type = 'sine', dur = 0.1, gain = 0.2, glide = null }) {
  const osc = ctx.createOscillator(); osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (glide) osc.frequency.exponentialRampToValueAtTime(glide, t + dur);
  const g = ctx.createGain();
  env(g.gain, t, { attack: 0.004, decay: dur, peak: gain });
  osc.connect(g).connect(dest);
  osc.start(t); osc.stop(t + dur + 0.05);
}

export const uiClick   = (ctx, d, t) => tone(ctx, d, t, { freq: 880, dur: 0.05, gain: 0.12, type: 'triangle' });
// Confirm rises, deny falls — that mapping is near-universal, don't invert it.
export const uiConfirm = (ctx, d, t) => { tone(ctx, d, t, { freq: 660, dur: 0.09, gain: 0.15 });
                                          tone(ctx, d, t + 0.07, { freq: 990, dur: 0.14, gain: 0.15 }); };
export const uiDeny    = (ctx, d, t) => tone(ctx, d, t, { freq: 220, glide: 110, dur: 0.22, gain: 0.18, type: 'square' });

// Alarm / caught sting. `urgency` 0..1 controls speed and dissonance.
export function alarm(ctx, dest, t, { urgency = 1, gain = 0.25 } = {}) {
  const step = 0.16 - urgency * 0.07;
  for (let i = 0; i < 4; i++) {
    tone(ctx, dest, t + i * step, { freq: i % 2 ? 440 : 622, dur: step * 0.9, gain, type: 'square' });
  }
}
```

## Cyclic

### Snore
Two phases: a long rasping inhale, a shorter softer exhale. Call it once per cycle from
the scheduler so the game can key events to `t`.

```js
export function snore(ctx, dest, t, { depth = 0.5, gain = 0.3 } = {}) {
  const inhale = vary(1.1 + depth * 0.6, 0.08);
  const gap = 0.25, exhale = inhale * 0.55;

  const mk = (start, dur, lo, hi, peak) => {
    const src = ctx.createBufferSource(); src.buffer = noise(ctx); src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass'; filt.Q.value = 6;
    filt.frequency.setValueAtTime(lo, start);
    filt.frequency.linearRampToValueAtTime(hi, start + dur);
    // the flutter is what makes it read as snoring rather than wind
    const lfo = ctx.createOscillator(); lfo.type = 'sawtooth';
    lfo.frequency.value = vary(24 + depth * 14, 0.1);
    const lg = ctx.createGain(); lg.gain.value = 0.5;
    const g = ctx.createGain(); g.gain.value = 0;
    lfo.connect(lg).connect(g.gain);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(peak, start + dur * 0.5);
    g.gain.linearRampToValueAtTime(0.0001, start + dur);
    src.connect(filt).connect(g).connect(dest);
    lfo.start(start); src.start(start);
    lfo.stop(start + dur + 0.05); src.stop(start + dur + 0.05);
  };

  mk(t, inhale, 180, 520, gain);                       // rasping in
  mk(t + inhale + gap, exhale, 380, 150, gain * 0.5);  // softer out
  return inhale + gap + exhale;                        // total cycle length
}
```

### Heartbeat
Tie `bpm` to danger and the player feels the threat before they see it.

```js
export function heartbeat(ctx, dest, t, { gain = 0.4 } = {}) {
  const thump = (start, g) => {
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(90, start);
    osc.frequency.exponentialRampToValueAtTime(38, start + 0.12);
    const gn = ctx.createGain();
    env(gn.gain, start, { attack: 0.006, decay: 0.14, peak: g });
    osc.connect(gn).connect(dest);
    osc.start(start); osc.stop(start + 0.25);
  };
  thump(t, gain);              // lub
  thump(t + 0.16, gain * 0.7); // dub
}
```

## Reverb

A convolver needs an impulse response, but you can synthesize a serviceable one:
noise with an exponential decay. Two seconds of decay reads as a large room.

```js
export function makeReverb(ctx, { seconds = 2, decay = 2.5 } = {}) {
  const len = ctx.sampleRate * seconds;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  const conv = ctx.createConvolver(); conv.buffer = buf;
  return conv;  // feed it via a send: source -> sendGain -> conv -> master
}
```

Use reverb as a *send*, not inline — keep the dry signal direct and mix in a filtered
copy. Inline reverb on everything smears the timing cues the player needs.
