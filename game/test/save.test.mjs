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

test('a v0 save from the first beta migrates without losing what it earned', () => {
  const migrated = migrate({ unlocked: 6, bank: 1240 });
  assert.equal(migrated.v, SAVE_VERSION);
  // The money is kept; the level it had reached is not, because the campaign it
  // reached into was rebuilt (see the v4 migration).
  assert.equal(migrated.unlocked, 1);
  assert.equal(migrated.bank, 1240);
  assert.deepEqual(migrated.best, {});
  assert.deepEqual(migrated.stars, {});
  assert.deepEqual(migrated.collection, []);
  assert.deepEqual(migrated.upgrades, { shoes: 0, feet: 0, bag: 0 });
  assert.equal(migrated.settings.sound, true);
});

test('a v2 save carries its mute preference into the new settings', () => {
  assert.equal(migrate({ v: 2, unlocked: 3, bank: 10, muted: true, best: { 1: 50 } }).settings.sound, false);
  assert.equal(migrate({ v: 2, unlocked: 3, bank: 10, muted: false, best: {} }).settings.sound, true);
  // Level records do not survive the rebuild, so the mute preference is the
  // thing being tested here — not the scores beside it.
  assert.deepEqual(migrate({ v: 2, unlocked: 3, bank: 10, muted: false, best: { 2: 90 } }).best, {});
});

test('garbage and hostile saves fall back to defaults instead of throwing', () => {
  for (const bad of [null, undefined, 42, 'nope', [], { v: 99 }, { unlocked: 'lots' }]) {
    assert.deepEqual(migrate(bad), defaultSave());
  }
});

test('out-of-range fields are clamped, not trusted', () => {
  const migrated = migrate({
    v: 3, unlocked: -5, bank: -100, best: null, stars: 'lots',
    collection: 'phone', upgrades: { shoes: 99, feet: -1, bag: 'x' },
    settings: { sound: 'yes', quality: 'ultra' }
  });
  assert.equal(migrated.unlocked, 1);
  assert.equal(migrated.bank, 0);
  assert.deepEqual(migrated.best, {});
  assert.deepEqual(migrated.stars, {});
  assert.deepEqual(migrated.collection, []);
  assert.deepEqual(migrated.upgrades, { shoes: 3, feet: 0, bag: 0 });
  assert.equal(migrated.settings.sound, true);
  assert.equal(migrated.settings.quality, 'high');
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


test('a win records stars, the haul and the collection', () => {
  const store = createSaveStore(fakeStorage());
  store.recordWin(4, 300, { stars: 2, types: ['phone', 'laptop', 'phone'] });
  assert.equal(store.data.stars[4], 2);
  assert.deepEqual(store.data.collection.sort(), ['laptop', 'phone']);
  assert.equal(store.totalStars(), 2);

  store.recordWin(4, 100, { stars: 1, types: ['diamond'] });   // a worse replay
  assert.equal(store.data.stars[4], 2, 'stars must never go down');
  assert.equal(store.data.best[4], 300);
  assert.deepEqual(store.data.collection.sort(), ['diamond', 'laptop', 'phone']);
  assert.equal(store.data.bank, 400, 'money still accrues on a worse run');
});

test('an upgrade cannot be bought without the money', () => {
  const store = createSaveStore(fakeStorage());
  assert.equal(store.buyUpgrade('shoes', 400), false);
  assert.equal(store.data.upgrades.shoes, 0);

  store.recordWin(1, 1000);
  assert.equal(store.buyUpgrade('shoes', 400), true);
  assert.equal(store.data.upgrades.shoes, 1);
  assert.equal(store.data.bank, 600);
  assert.equal(store.buyUpgrade('nonsense', 1), false, 'unknown upgrades are refused');
});

test('settings persist individually', () => {
  const storage = fakeStorage();
  const store = createSaveStore(storage);
  store.setSetting('music', false);
  store.setSetting('quality', 'low');
  assert.equal(JSON.parse(storage.raw).settings.music, false);
  assert.equal(JSON.parse(storage.raw).settings.quality, 'low');
  assert.equal(JSON.parse(storage.raw).settings.sound, true, 'other settings untouched');
});

test('a v3 save keeps its money, collection and upgrades through the rebuild', () => {
  const migrated = migrate({
    v: 3, unlocked: 7, bank: 500, best: { 1: 100 }, stars: { 1: 3 },
    collection: ['phone'], upgrades: { shoes: 1, feet: 0, bag: 2 },
    settings: { sound: false, music: true, vibration: true, quality: 'medium' }
  });
  assert.equal(migrated.v, SAVE_VERSION);
  assert.equal(migrated.bank, 500);
  assert.deepEqual(migrated.collection, ['phone']);
  assert.deepEqual(migrated.upgrades, { shoes: 1, feet: 0, bag: 2 });
  assert.equal(migrated.settings.quality, 'medium');
  // Progress through the old numbering is cleared: those levels are gone.
  assert.equal(migrated.unlocked, 1);
  assert.deepEqual(migrated.stars, {});
  assert.deepEqual(migrated.records, {});
});

test('personal bests track separately and only ever improve', () => {
  const store = createSaveStore(fakeStorage());
  store.recordWin(3, 400, { stars: 2, seconds: 18.4, noise: 70 });
  assert.deepEqual(store.data.records[3], { money: 400, time: 18.4, noise: 70 });

  // A faster, quieter, poorer run improves two of the three.
  store.recordWin(3, 120, { stars: 1, seconds: 11.2, noise: 22 });
  assert.deepEqual(store.data.records[3], { money: 400, time: 11.2, noise: 22 });

  // A slower, louder, richer run improves only the money.
  store.recordWin(3, 900, { stars: 3, seconds: 25, noise: 95 });
  assert.deepEqual(store.data.records[3], { money: 900, time: 11.2, noise: 22 });
});

// The development switch: every level playable from the menu without the save
// pretending the player earned them.
test('unlock-all is a setting, not a rewrite of progress', () => {
  const store = createSaveStore(fakeStorage(JSON.stringify({ v: 5, unlocked: 3, bank: 120, stars: { 1: 3 } })));
  assert.equal(store.data.settings.unlockAll, true, 'defaults on while the game is in development');
  // The thing it must never do is inflate what the player actually reached.
  assert.equal(store.data.unlocked, 3);
  assert.equal(store.data.stars[1], 3);
  store.setSetting('unlockAll', false);
  assert.equal(store.data.settings.unlockAll, false);
  assert.equal(store.data.unlocked, 3, 'turning it off leaves progress where it was');
});

// The restructure into eleven locations renumbered every level.
test('the location rebuild clears level records but keeps what was earned', () => {
  const store = createSaveStore(fakeStorage(JSON.stringify({
    v: 4, unlocked: 30, bank: 4200, best: { 12: 500 }, stars: { 12: 3 },
    records: { 12: { money: 500 } }, collection: ['phone', 'diamond'],
    upgrades: { shoes: 2, feet: 1, bag: 3 }
  })));
  assert.equal(store.data.v, SAVE_VERSION);
  // Bought and collected things survive; progress through levels that no longer
  // exist does not.
  assert.equal(store.data.bank, 4200);
  assert.deepEqual(store.data.upgrades, { shoes: 2, feet: 1, bag: 3 });
  assert.deepEqual([...store.data.collection].sort(), ['diamond', 'phone']);
  assert.equal(store.data.unlocked, 1);
  assert.deepEqual(store.data.best, {});
  assert.deepEqual(store.data.stars, {});
  assert.deepEqual(store.data.records, {});
});
