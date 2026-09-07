import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { replay, expand, frameCount, quantise, createRecorder, recordFrame } from '../src/replay.js';
import { play } from './harness.mjs';

const golden = JSON.parse(fs.readFileSync(new URL('./fixtures/golden-l3.json', import.meta.url)));

// A fixed recording of a real playthrough, replayed frame for frame. If any
// change to the simulation moves a single number, this is the test that says
// so — and it is re-cut whenever the level it plays is deliberately rebuilt,
// which is the only time it may legitimately change.
test('the golden level 3 run still pays out exactly $115', () => {
  const result = replay(golden);
  assert.equal(result.status, 'won');
  assert.equal(result.haul, 115);
  assert.deepEqual(result.taken, ['L3-0', 'L3-1', 'L3-2']);
});

test('replaying is byte-for-byte reproducible', () => {
  assert.deepEqual(replay(golden), replay(golden));
});

test('a recording replays to the same result as the live run', () => {
  const { run, result } = play(5, { take: ['L5-1', 'L5-3'], seed: 42 });
  assert.deepEqual(replay(run.recording), result);
});

test('run-length encoding round-trips', () => {
  const recording = createRecorder(1, 1);
  const inputs = [
    { x: 1, y: 0, take: false }, { x: 1, y: 0, take: false }, { x: 1, y: 0, take: false },
    { x: 0, y: -1, take: false }, { x: 0, y: -1, take: true }
  ].map(quantise);
  inputs.forEach((i) => recordFrame(recording, i));
  assert.equal(frameCount(recording), 5);
  assert.equal(recording.frames.length, 3, 'held directions should collapse');
  assert.deepEqual(expand(recording), inputs);
});

test('a recording is small', () => {
  // Twelve kilobytes for a full playthrough of a building with grounds round
  // it. The limit was eight when a level was one screen and a run was thirty
  // seconds of walking; what has to stay true is that a recording is a handful
  // of kilobytes rather than a frame-by-frame dump.
  const bytes = JSON.stringify(golden).length;
  assert.ok(bytes < 12000, `golden recording is ${bytes} bytes`);
  assert.ok(frameCount(golden) > 500, 'golden run should be a real playthrough');
});
