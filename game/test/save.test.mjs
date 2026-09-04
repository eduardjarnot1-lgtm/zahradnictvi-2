import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, defaultSave, createSaveStore, SAVE_VERSION, SAVE_KEY } from '../src/save.js';

const fakeStorage = (seed) => {
  const map = new Map(seed ? [[SAVE_KEY, seed]] : []);
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    get raw() { return map.get(SAVE_KEY); }
  };
};

test('a v0 save from the first beta migrates without losing progress', () => {
  const migrated = migrate({ unlocked: 6, bank: 1240 });
  assert.equal(migrated.v, SAVE_VERSION);
  assert.equal(migrated.unlocked, 6);
  assert.equal(migrated.bank, 1240);
  assert.deepEqual(migrated.best, {});
  assert.equal(migrated.muted, false);
});

test('garbage and hostile saves fall back to defaults instead of throwing', () => {
  for (const bad of [null, undefined, 42, 'nope', [], { v: 99 }, { unlocked: 'lots' }]) {
    assert.deepEqual(migrate(bad), defaultSave());
  }
});

test('out-of-range fields are clamped, not trusted', () => {
  const migrated = migrate({ v: 2, unlocked: -5, bank: -100, muted: 'yes', best: null });
  assert.equal(migrated.unlocked, 1);
  assert.equal(migrated.bank, 0);
  assert.equal(migrated.muted, false);
  assert.deepEqual(migrated.best, {});
});

test('a corrupt JSON blob does not wipe the player out with an exception', () => {
  const store = createSaveStore(fakeStorage('{not json'));
  assert.deepEqual(store.data, defaultSave());
});

test('winning banks money, unlocks the next level and records a best', () => {
  const store = createSaveStore(fakeStorage());
  store.recordWin(1, 120);
  assert.equal(store.data.bank, 120);
  assert.equal(store.data.unlocked, 2);
  assert.equal(store.data.best[1], 120);

  store.recordWin(1, 80); // a worse replay must not lower the best or the unlock
  assert.equal(store.data.best[1], 120);
  assert.equal(store.data.unlocked, 2);
  assert.equal(store.data.bank, 200);
});

test('reset clears progress and persists', () => {
  const storage = fakeStorage();
  const store = createSaveStore(storage);
  store.recordWin(3, 500);
  store.reset();
  assert.deepEqual(store.data, defaultSave());
  assert.deepEqual(JSON.parse(storage.raw), defaultSave());
});

test('storage that throws (private mode) never breaks the game', () => {
  const hostile = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); }
  };
  const store = createSaveStore(hostile);
  assert.deepEqual(store.data, defaultSave());
  assert.doesNotThrow(() => store.recordWin(1, 50));
});
