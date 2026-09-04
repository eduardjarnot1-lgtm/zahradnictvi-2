// Versioned save with an explicit migration chain. Adding a field later means
// appending one migration, not breaking every existing player's progress.
export const SAVE_KEY = 'dwh_save';
export const SAVE_VERSION = 2;

export function defaultSave() {
  return { v: SAVE_VERSION, unlocked: 1, bank: 0, muted: false, best: {} };
}

// Each migration takes the previous shape and returns the next one.
const MIGRATIONS = {
  // v0 is the original unversioned {unlocked, bank}.
  0: (save) => ({ v: 1, unlocked: save.unlocked, bank: save.bank, muted: false }),
  1: (save) => ({ ...save, v: 2, best: {} })
};

export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return defaultSave();

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
  return {
    v: SAVE_VERSION,
    unlocked: clampInt(save.unlocked, 1, 999, base.unlocked),
    bank: clampInt(save.bank, 0, Number.MAX_SAFE_INTEGER, base.bank),
    muted: typeof save.muted === 'boolean' ? save.muted : base.muted,
    best: save.best && typeof save.best === 'object' ? save.best : {}
  };
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
    recordWin(levelId, money) {
      // Guard the store against a caller bug: a bad id must not poison progress.
      if (!Number.isInteger(levelId) || levelId < 1) return cache;
      const earned = Number.isFinite(money) && money > 0 ? Math.floor(money) : 0;
      const best = { ...cache.best, [levelId]: Math.max(cache.best[levelId] || 0, earned) };
      cache = {
        ...cache,
        bank: cache.bank + earned,
        unlocked: Math.max(cache.unlocked, levelId + 1),
        best
      };
      return write();
    },
    reset() {
      cache = defaultSave();
      return write();
    },
    reload: read
  };
}
