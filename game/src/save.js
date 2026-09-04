// Versioned save with an explicit migration chain. Adding a field later means
// appending one migration, not breaking every existing player's progress.
export const SAVE_KEY = 'dwh_save';
export const SAVE_VERSION = 3;

export function defaultSettings() {
  return { sound: true, music: true, vibration: true, quality: 'high' };
}

export function defaultSave() {
  return {
    v: SAVE_VERSION,
    unlocked: 1,
    bank: 0,
    best: {},
    stars: {},
    collection: [],
    upgrades: { shoes: 0, feet: 0, bag: 0 },
    settings: defaultSettings()
  };
}

// Each migration takes the previous shape and returns the next one.
const MIGRATIONS = {
  // v0 is the original unversioned {unlocked, bank}.
  0: (save) => ({ v: 1, unlocked: save.unlocked, bank: save.bank, muted: false }),
  1: (save) => ({ ...save, v: 2, best: {} }),
  // v3 adds progression. A v2 player's mute preference becomes their sound setting.
  2: (save) => ({
    ...save,
    v: 3,
    stars: {},
    collection: [],
    upgrades: { shoes: 0, feet: 0, bag: 0 },
    // Only a real `true` means muted; a corrupt value must not silence the game.
    settings: { ...defaultSettings(), sound: save.muted !== true }
  })
};

const QUALITIES = ['low', 'medium', 'high'];

export function migrate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultSave();

  let save = { ...raw };
  let version = typeof save.v === 'number' ? save.v : 0;

  // An unversioned save is only trustworthy if it looks like the v0 shape.
  if (version === 0 && typeof save.unlocked !== 'number') return defaultSave();

  while (version < SAVE_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) return defaultSave();
    save = step(save);
    version = save.v;
  }

  const base = defaultSave();
  const settings = save.settings && typeof save.settings === 'object' ? save.settings : {};
  return {
    v: SAVE_VERSION,
    unlocked: clampInt(save.unlocked, 1, 999, base.unlocked),
    bank: clampInt(save.bank, 0, Number.MAX_SAFE_INTEGER, base.bank),
    best: plainObject(save.best),
    stars: plainObject(save.stars),
    collection: Array.isArray(save.collection)
      ? [...new Set(save.collection.filter((t) => typeof t === 'string'))]
      : [],
    upgrades: {
      shoes: clampInt(save.upgrades && save.upgrades.shoes, 0, 3, 0),
      feet: clampInt(save.upgrades && save.upgrades.feet, 0, 3, 0),
      bag: clampInt(save.upgrades && save.upgrades.bag, 0, 3, 0)
    },
    settings: {
      sound: typeof settings.sound === 'boolean' ? settings.sound : true,
      music: typeof settings.music === 'boolean' ? settings.music : true,
      vibration: typeof settings.vibration === 'boolean' ? settings.vibration : true,
      quality: QUALITIES.includes(settings.quality) ? settings.quality : 'high'
    }
  };
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

function clampInt(value, min, max, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

// storage is injected so this module is testable without a browser.
export function createSaveStore(storage) {
  let cache = defaultSave();

  const read = () => {
    try {
      const raw = storage && storage.getItem(SAVE_KEY);
      cache = migrate(raw ? JSON.parse(raw) : null);
    } catch (e) {
      cache = defaultSave();
    }
    return cache;
  };

  const write = () => {
    try {
      if (storage) storage.setItem(SAVE_KEY, JSON.stringify(cache));
    } catch (e) { /* private mode, quota — progress just won't persist */ }
    return cache;
  };

  read();

  return {
    get data() { return cache; },
    update(patch) {
      cache = { ...cache, ...patch };
      return write();
    },
    setSetting(key, value) {
      cache = { ...cache, settings: { ...cache.settings, [key]: value } };
      return write();
    },

    // One place where a finished level is written down.
    recordWin(levelId, money, extra = {}) {
      // Guard the store against a caller bug: a bad id must not poison progress.
      if (!Number.isInteger(levelId) || levelId < 1) return cache;
      const earned = Number.isFinite(money) && money > 0 ? Math.floor(money) : 0;
      const stars = clampInt(extra.stars, 0, 3, 0);
      const types = Array.isArray(extra.types) ? extra.types.filter((t) => typeof t === 'string') : [];
      cache = {
        ...cache,
        bank: cache.bank + earned,
        unlocked: Math.max(cache.unlocked, levelId + 1),
        best: { ...cache.best, [levelId]: Math.max(cache.best[levelId] || 0, earned) },
        stars: { ...cache.stars, [levelId]: Math.max(cache.stars[levelId] || 0, stars) },
        collection: [...new Set([...cache.collection, ...types])]
      };
      return write();
    },

    // Returns false when the player cannot afford it, so the caller never has
    // to trust its own arithmetic about the bank.
    buyUpgrade(key, cost) {
      const owned = cache.upgrades[key];
      if (owned === undefined || !Number.isFinite(cost) || cost > cache.bank) return false;
      cache = {
        ...cache,
        bank: cache.bank - cost,
        upgrades: { ...cache.upgrades, [key]: owned + 1 }
      };
      write();
      return true;
    },

    totalStars() {
      return Object.values(cache.stars).reduce((sum, n) => sum + n, 0);
    },

    reset() {
      cache = defaultSave();
      return write();
    },
    reload: read
  };
}
