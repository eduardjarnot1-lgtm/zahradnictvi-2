import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { replay, expand, frameCount, quantise, createRecorder, recordFrame } from '../src/replay.js';
import { play } from './harness.mjs';

const golden = JSON.parse(fs.readFileSync(new URL('./fixtures/golden-l3.json', import.meta.url)));

test('the golden level 3 run still pays out exactly $330', () => {
  const result = replay(golden);
  assert.equal(result.status, 'won');
  assert.equal(result.haul, 330);
  assert.deepEqual(result.taken, ['L3-1', 'L3-3', 'L3-4']);
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
  const bytes = JSON.stringify(golden).length;
  assert.ok(bytes < 8000, `golden recording is ${bytes} bytes`);
  assert.ok(frameCount(golden) > 500, 'golden run should be a real playthrough');
});
