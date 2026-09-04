# Lookahead scheduling

## Why `setTimeout` is not good enough

`setTimeout(fn, 500)` means "no sooner than 500ms, and only once the main thread is
free". A garbage collection pause, a long frame, or a background tab throttle all push
it late — and the error accumulates. Over a minute of a rhythm loop the drift is
obvious. The Web Audio clock (`ctx.currentTime`) runs on the audio thread and is
sample-accurate; anything you schedule against it lands exactly where you asked.

The pattern that reconciles the two: use a sloppy timer to *look ahead*, and schedule
precisely into the near future. The timer only has to be roughly right, because it is
never the thing making the sound happen.

## The scheduler

```js
const LOOKAHEAD_MS = 25;    // how often we wake up
const SCHEDULE_AHEAD = 0.1; // how far into the future we schedule (seconds)

export function createScheduler(ctx) {
  let timer = null, nextTime = 0, running = false;
  const queue = [];  // events already scheduled, for the visual layer to read

  // `tick` returns the interval until the next event, in seconds.
  function start(tick) {
    if (running) return;
    running = true;
    nextTime = ctx.currentTime + 0.05;  // small offset: never schedule in the past
    timer = setInterval(() => {
      while (nextTime < ctx.currentTime + SCHEDULE_AHEAD) {
        const interval = tick(nextTime);
        queue.push({ time: nextTime });
        nextTime += interval;
      }
      // drop events the audio clock has passed
      while (queue.length && queue[0].time < ctx.currentTime - 1) queue.shift();
    }, LOOKAHEAD_MS);
  }

  function stop() { clearInterval(timer); timer = null; running = false; queue.length = 0; }

  return { start, stop, queue, get running() { return running; } };
}
```

Usage — a snore cycle the player times their moves to:

```js
const sched = createScheduler(ctx);
sched.start((t) => {
  const cycle = snore(ctx, sfxBus, t, { depth: level.snoreDepth });
  return cycle + level.gapSeconds;   // when the next one starts
});
```

## Keeping the visuals in sync

This is the part people get wrong. Audio is scheduled ~100ms in the future; your
renderer draws *now*. If you trigger the animation at schedule time it plays early.

Keep the scheduled times in a queue (above) and let the render loop compare against
`ctx.currentTime`, not against wall-clock time:

```js
function render() {
  const now = ctx.currentTime;
  // how far into the current snore are we? drives the safe/unsafe window on screen
  const ev = sched.queue.find(e => e.time <= now && now < e.time + cycleLen);
  const phase = ev ? (now - ev.time) / cycleLen : 0;
  drawSleeper(phase);
  requestAnimationFrame(render);
}
```

`performance.now()` and `ctx.currentTime` are different clocks and *will* diverge.
Once a game has audio, the audio clock is the game clock. Drive gameplay timing from it
and everything stays locked together.

## Input timing

To judge whether a player acted "on the beat", timestamp the input against the audio
clock at the moment of the event, not in the next frame — a frame is up to 16ms of
error, which is most of a tight timing window.

```js
window.addEventListener('keydown', (e) => {
  const at = ctx.currentTime;              // capture immediately
  const err = at - nearestBeatTime(at);    // signed: negative = early
  judge(Math.abs(err));                    // e.g. <0.05 perfect, <0.12 good
});
```

Be generous, and be *asymmetrically* generous: players perceive late hits as worse than
early ones, so a window that extends slightly further before the beat than after it
feels fairer than a symmetric one.

## Pausing

Pausing needs care because the audio clock keeps running while suspended. On pause,
record `ctx.currentTime`, stop the scheduler, and `ctx.suspend()`. On resume, `resume()`
and re-anchor `nextTime` to the new `ctx.currentTime` rather than the stored value —
otherwise the scheduler tries to catch up and fires a burst of events at once.
