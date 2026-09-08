// Wiring only: the loop, the screens, and the bridges between the pure
// simulation and the browser. No game rules live here.
import { TUNING } from './tuning.js';
import { LEVELS } from './levels.js';
import { validateAll } from './validate.js';
import { createSim, stepSim, STEP_SECONDS, playerOf } from './sim.js';
import { createRecorder, recordFrame, frameCount } from './replay.js';
import { createSaveStore } from './save.js';
import { createMachine } from './fsm.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createRenderer } from './render.js';
import {
  sleepStage, starsFor, starThresholds, levelTotals, upgradeCost, SLEEP_LABELS,
  objectivesFor, isBigScore, rarityOf, watcherConfig
} from './rules.js';
import { ITEM_ART, ITEM_NAMES } from './art.js';
import { createEffects } from './effects.js';

const $ = (id) => document.getElementById(id);
const WAKE_BEAT = 0.9;         // seconds of wake-up animation before the fail screen
// What the one interaction button says, per action the simulation is offering.
const ACTION_LABEL = { search: 'SEARCH', hide: 'HIDE', leave: 'LEAVE' };

export function boot() {
  const params = new URLSearchParams(location.search);
  const debug = params.has('debug');

  const stage = $('stage');
  const canvas = $('cv');
  const takeButton = $('take');
  const searchButton = $('search');

  const saveStore = createSaveStore(window.localStorage);
  const audio = createAudio(saveStore);
  const renderer = createRenderer(canvas, { debug });
  // What the room does back. Presentation only, and only where a location
  // asks for it — everywhere but the school this stays empty all game.
  const fx = createEffects();

  audio.setMuted(!saveStore.data.settings.sound);

  if (debug) {
    const report = validateAll(LEVELS);
    if (!report.ok) {
      const detail = report.results.filter((r) => !r.ok)
        .map((r) => `L${r.id}: ${r.errors.join('; ')}`).join('\n');
      showCrash(new Error(`Level validation failed:\n${detail}`));
    }
    console.info('[dwh] level report', report.results.map((r) => ({ id: r.id, ...r.stats })));
  }

  let sim = null;
  let currentLevelId = null;   // owned by the game, not by a screen payload
  let recording = null;
  let pops = [];
  let sparks = [];
  let accumulator = 0;
  let lastTime = 0;
  let clock = 0;
  let warnedAt = 0;
  let endHold = 0;            // wake-up beat before the fail screen
  let pendingEnd = null;
  let lastStepPhase = 0;
  let lastTick = -1;
  let flash = 0;
  // The money on the HUD, chasing the money in the bank. A counter that jumps
  // says a number changed; one that runs up says you earned something.
  let shownMoney = 0;
  let hudClock = 0;
  let lastHeartbeat = 0;
  const stats = { fps: 0, steps: 0 };

  const setting = (key) => saveStore.data.settings[key];
  const buzz = (pattern) => {
    if (setting('vibration') && navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (e) { /* unsupported */ }
    }
  };

  const input = createInput({
    stage,
    joystick: $('joy'),
    knob: $('knob'),
    takeButton,
    searchButton,
    onBlur: () => { if (machine.is('playing')) machine.set('paused'); }
  });

  // ---------------------------------------------------------------- screens
  const screens = {
    menu: $('scMenu'), levels: $('scLevels'), end: $('scEnd'), pause: $('scPause'),
    shop: $('scShop'), collection: $('scCollection'), settings: $('scSettings')
  };
  const showOnly = (el) => {
    for (const key of Object.keys(screens)) screens[key].classList.toggle('on', screens[key] === el);
  };
  const fromMenu = ['menu', 'playing'];

  const machine = createMachine({
    initial: 'menu',
    onChange(name) { document.body.dataset.screen = name; },
    states: {
      menu: {
        to: ['levels', 'playing', 'shop', 'collection', 'settings'],
        enter() { showOnly(screens.menu); paintMenu(); }
      },
      levels: { to: fromMenu, enter() { buildGrid(); showOnly(screens.levels); } },
      shop: { to: fromMenu, enter() { buildShop(); showOnly(screens.shop); } },
      collection: { to: fromMenu, enter() { buildCollection(); showOnly(screens.collection); } },
      settings: { to: fromMenu, enter() { paintSettings(); showOnly(screens.settings); } },
      playing: {
        to: ['paused', 'won', 'lost', 'menu'],
        enter() { showOnly(null); },
        exit() { input.clearAll(); }
      },
      paused: { to: ['playing', 'menu'], enter() { showOnly(screens.pause); } },
      won: { to: ['playing', 'menu', 'levels'], enter: (ctx) => showEnd(true, ctx) },
      lost: { to: ['playing', 'menu'], enter: (ctx) => showEnd(false, ctx) }
    }
  });

  function paintMenu() {
    $('bank').textContent = `$${saveStore.data.bank.toLocaleString()}`;
    $('menuStars').textContent = `${saveStore.totalStars()} / ${LEVELS.length * 3} stars`;
  }

  const starRow = (n) => '★★★'.slice(0, n) + (n < 3 ? `<s>${'★'.repeat(3 - n)}</s>` : '');

  function showEnd(won, ctx) {
    showOnly(screens.end);
    const level = LEVELS.find((l) => l.id === currentLevelId);
    const gradeEl = $('grade');
    gradeEl.textContent = won && ctx.grade ? ctx.grade.label : '';
    gradeEl.className = won && ctx.grade ? ctx.grade.grade : '';

    // What the level asked for, and which of it you managed.
    const objectives = $('objectives');
    objectives.innerHTML = won || !level ? '' : '';
    if (level) {
      objectives.innerHTML = objectivesFor(level).map((objective) => {
        const done = won && ctx.stars >= objective.stars;
        return `<div class="obj${done ? ' done' : ''}">` +
          `<b>${'★'.repeat(objective.stars)}</b>${objective.text}` +
          `<span style="margin-left:auto">${done ? '✓' : ''}</span></div>`;
      }).join('');
    }

    const record = (saveStore.data.records || {})[currentLevelId];
    $('records').innerHTML = record
      ? `<div>BEST LOOT<b>$${(record.money || 0).toLocaleString()}</b></div>` +
        `<div>BEST TIME<b>${record.time !== undefined ? record.time.toFixed(1) + 's' : '—'}</b></div>` +
        `<div>QUIETEST<b>${record.noise !== undefined ? record.noise : '—'}</b></div>`
      : '';
    const watcher = level ? watcherConfig(level.watcher.kind) : watcherConfig('sleeper');
    $('endTitle').textContent = won ? 'LEVEL COMPLETE'
      : ctx.reason === 'time' ? "TIME'S UP"
        : ctx.reason === 'caught' ? (watcher.caught || watcher.lost)
          : watcher.lost;
    $('stars').innerHTML = won ? starRow(ctx.stars) : '';
    $('endTally').innerHTML = won
      ? `<div>HAUL<b>$${ctx.money.toLocaleString()}</b></div>` +
        `<div>ITEMS<b>${ctx.taken.length}/${level ? level.items.length : '?'}</b></div>` +
        `<div>NOISE<b>${Math.round(ctx.noise)}</b></div>` +
        `<div>LEFT<b>${(ctx.timeLeft || 0).toFixed(1)}s</b></div>`
      : '';
    if (won) {
      const marks = starThresholds(level);
      $('endText').innerHTML = ctx.stars < 3
        ? `Steal $${(ctx.stars < 2 ? marks.two : marks.three).toLocaleString()} in one run for ${ctx.stars < 2 ? 2 : 3} stars.`
        : 'A clean sweep. Nothing left worth taking.';
    } else {
      const cause = ctx.reason === 'time'
        ? 'You were still in the room when the clock ran out.'
        : ctx.reason === 'seen'
          ? 'You moved through his line of sight once too often.'
          : ctx.reason === 'caught'
            ? (watcher.caughtWhy || 'He walked straight into you.')
            : watcher.lostWhy;
      $('endText').innerHTML =
        `${cause}<br>You lost <b style="color:#ffd34d">$${ctx.money.toLocaleString()}</b>.`;
    }
    $('bNext').style.display = won && currentLevelId < LEVELS.length ? '' : 'none';
  }

  function buildGrid() {
    const grid = $('grid');
    grid.innerHTML = '';
    let location = null;
    for (const level of LEVELS) {
      if (level.location !== location) {
        location = level.location;
        const heading = document.createElement('div');
        heading.className = 'chapter';
        heading.style.gridColumn = '1 / -1';
        // The chapter, and how far through it you are.
        heading.textContent = `${location} · 5 levels`;
        grid.appendChild(heading);
      }
      // The unlock-all switch opens the grid without rewriting progress, so
      // turning it off puts the player back exactly where they had got to.
      const unlocked = setting('unlockAll') || level.id <= saveStore.data.unlocked;
      const stars = saveStore.data.stars[level.id] || 0;
      const button = document.createElement('button');
      button.className = `lv${unlocked ? '' : ' locked'}`;
      button.innerHTML = unlocked
        ? `<b>${level.id}</b><i>${stars ? starRow(stars) : '<s>★★★</s>'}</i>`
        : '<b>🔒</b>';
      button.disabled = !unlocked;
      if (unlocked) button.addEventListener('click', () => startLevel(level.id));
      grid.appendChild(button);
    }
  }

  function buildShop() {
    $('shopBank').textContent = `$${saveStore.data.bank.toLocaleString()}`;
    const list = $('shopList');
    list.innerHTML = '';
    for (const [key, upgrade] of Object.entries(TUNING.upgrades)) {
      const owned = saveStore.data.upgrades[key];
      const cost = upgradeCost(key, owned);
      const card = document.createElement('div');
      card.className = 'card';
      const pips = upgrade.costs
        .map((_, i) => `<div class="pip${i < owned ? ' on' : ''}"></div>`).join('');
      card.innerHTML =
        `<div class="ico">${upgrade.icon}</div>` +
        `<div class="body"><h3>${upgrade.name}</h3><p>${upgrade.blurb}</p><div class="pips">${pips}</div></div>`;
      const buy = document.createElement('button');
      if (cost === null) {
        buy.className = 'buy max';
        buy.textContent = 'MAX';
        buy.disabled = true;
      } else {
        buy.className = 'buy';
        buy.textContent = `$${cost.toLocaleString()}`;
        buy.disabled = cost > saveStore.data.bank;
        buy.addEventListener('click', () => {
          if (saveStore.buyUpgrade(key, cost)) {
            audio.purchase();
            buzz(20);
            buildShop();
          }
        });
      }
      card.appendChild(buy);
      list.appendChild(card);
    }
  }

  function buildCollection() {
    const types = Object.keys(TUNING.items);
    const owned = new Set(saveStore.data.collection);
    $('collCount').textContent = `${owned.size} of ${types.length} found`;
    const grid = $('collgrid');
    grid.innerHTML = '';
    for (const type of types) {
      const cell = document.createElement('div');
      const got = owned.has(type);
      cell.className = `coll${got ? ' got' : ''}`;
      cell.innerHTML =
        `<div class="em">${ITEM_ART[type]}</div><span>${got ? ITEM_NAMES[type] : '???'}</span>`;
      grid.appendChild(cell);
    }
  }

  function paintSettings() {
    const paint = (id, on) => {
      const el = $(id);
      el.classList.toggle('on', on);
      el.textContent = on ? 'ON' : 'OFF';
    };
    paint('tSound', setting('sound'));
    paint('tMusic', setting('music'));
    paint('tVibe', setting('vibration'));
    paint('tUnlock', setting('unlockAll'));
    for (const button of $('segQuality').children) {
      button.classList.toggle('on', button.dataset.q === setting('quality'));
    }
  }

  // ---------------------------------------------------------------- level
  function startLevel(id) {
    const level = LEVELS.find((l) => l.id === id);
    if (!level) throw new Error(`no level ${id}`);
    const seed = (Date.now() ^ (id * 2654435761)) >>> 0;
    currentLevelId = id;
    sim = createSim({ level, seed, upgrades: saveStore.data.upgrades });
    recording = createRecorder(id, seed);
    pops = [];
    sparks = [];
    accumulator = 0;
    warnedAt = 0;
    endHold = 0;
    pendingEnd = null;
    lastStepPhase = 0;
    fx.clear();
    shownMoney = 0;
    audio.unlock();
    if (setting('music')) audio.startMusic();
    hideCrash();
    renderer.invalidateRoom();
    // Open the level already framed on the thief rather than easing the view in
    // from wherever the previous level left it.
    renderer.snapCamera(level, level.spawn.x, level.spawn.y);
    machine.set('playing');
    if (debug) window.__dwh = { sim, recording, TUNING, saveStore };
  }

  function spawnSparks(x, y, count, color) {
    const budget = TUNING.quality[setting('quality')].particles;
    for (let i = 0; i < Math.min(count, budget); i++) {
      const angle = (i / Math.max(1, Math.min(count, budget))) * Math.PI * 2;
      sparks.push({
        x, y, life: 1, color,
        vx: Math.cos(angle) * (24 + (i % 3) * 12),
        vy: Math.sin(angle) * (24 + (i % 3) * 12) - 20
      });
    }
  }

  function handleEvents() {
    // Whether this location's room answers back. One flag, read once: the
    // school does, and the other ten play exactly as they did.
    const reacts = !!sim.rules.reacts;
    const player = playerOf(sim);
    for (const event of sim.events) {
      if (event.type === 'took') {
        pops.push({
          x: event.x, y: event.y, value: event.value, life: 1,
          big: event.big, color: event.big ? '#ffe9a8' : rarityOf(event.itemType).tint
        });
        spawnSparks(event.x, event.y, event.big ? 14 : event.fragile ? 10 : 6,
          event.big ? '#ffd98a' : event.fragile ? '#bfe6ff' : '#ffd34d');
        // Lifting something off a shelf is the loudest ordinary thing in the
        // game, and until now the only sign of that was a bar at the top of
        // the screen moving.
        if (reacts) fx.ring(event.x, event.y, event.noise);
        audio.take(event.noise, event.fragile);
        if (event.big) { flash = 1; audio.jackpot(); buzz([18, 40, 24]); }
        else buzz(event.fragile ? [12, 30, 12] : 14);
        if (event.streak >= TUNING.combo.tiers[0].at) audio.streak(event.streak);
        const stageNow = sleepStage(sim.noise);
        if (stageNow > warnedAt && stageNow > 0 && sim.status === 'running') {
          warnedAt = stageNow;
          audio.warn();
        }
      } else if (event.type === 'searching') {
        // The drawer coming open, before anyone knows what is in it — and now
        // the drawer actually comes open: a panel slides out of the face he is
        // standing at, stays out while his hands are in it, and shuts itself.
        if (reacts) {
          fx.open(event.where, event.style, event.from, event.duration);
          fx.ring(event.x, event.y, event.noise);
        }
        audio.bump('soft', event.noise, 0.5);
        buzz(8);
      } else if (event.type === 'found') {
        if (event.empty) {
          // An empty cupboard is information, not a failure. It gets a word
          // and the drawer shutting on it — no sound, no shake, no punishment
          // for looking.
          pops.push({ x: event.x, y: event.y - 8, value: null, text: 'EMPTY', life: 1 });
          if (reacts) fx.shut(event.where);
        } else {
          pops.push({
            x: event.x, y: event.y - 8, value: event.value, life: 1,
            big: event.big, color: event.big ? '#ffe9a8' : rarityOf(event.itemType).tint
          });
          spawnSparks(event.x, event.y, event.big ? 14 : 8,
            event.big ? '#ffd98a' : '#9fe0ff');
          // What was in there, coming out of it and into his hand, and the
          // noise it made on the way.
          if (reacts) {
            fx.shut(event.where);
            fx.fly(event.x, event.y, event.itemType);
            fx.ring(event.x, event.y, event.noise);
          }
          audio.take(event.noise, false);
          if (event.big) { flash = 1; audio.jackpot(); buzz([18, 40, 24]); }
          else buzz(14);
          const stageNow = sleepStage(sim.noise);
          if (stageNow > warnedAt && stageNow > 0 && sim.status === 'running') {
            warnedAt = stageNow;
            audio.warn();
          }
        }
      } else if (event.type === 'creak') {
        // What it was, in the player's own words. A CRINKLE and a THUMP cost
        // different amounts and the player has to be able to tell which they
        // just paid without reading the meter.
        pops.push({ x: event.x, y: event.y - 6, value: null,
          text: event.say || 'CREAK', life: 1 });
        // The paper shifts under the foot that stood on it, and the sound goes
        // out from there rather than from the middle of the thief.
        if (reacts) {
          // ...carrying its own kind, or the litter painter falls through to
          // the floorboards it started as and a sheet of paper is answered by a
          // patch of planking.
          fx.knock({ ...event.where, kind: event.kind }, 0, 1,
            0.25 + event.noise * 0.06, fx.paintLitter, null);
          fx.ring(event.x, event.y + 8, event.noise);
        }
        audio.creak(event.noise);
        buzz(Math.min(30, 8 + event.noise * 2.5));
      } else if (event.type === 'bump') {
        pops.push({
          x: event.x, y: event.y - 6, value: null, text: `+${event.noise}`,
          // Where the room answers a knock with the piece moving, a ring going
          // out and a flash of contact, the number over the top does not also
          // need to be the biggest thing on the screen.
          life: 1, big: event.force > 0.6 && !reacts, color: '#ff9c6e'
        });
        // The thing you walked into, rocking on its feet. Only furniture: a
        // wall does not move, and a bed is drawn by the sleeper's own code.
        if (reacts) {
          if (event.piece && event.piece.type === 'furniture') {
            fx.knock(event.piece, event.nx, event.ny, event.force, fx.paintFurniture,
              { x: event.x, y: event.y });
          }
          fx.ring(event.x, event.y, event.noise + event.force * 6);
        }
        audio.bump(event.what === 'bed' ? 'soft' : 'hard', event.noise, event.force);
        // A harder knock is felt as well as heard.
        buzz(event.force > 0.6 ? [18, 30, 22] : Math.round(8 + event.force * 14));
        if (event.force > 0.5) spawnSparks(event.x, event.y, 5, '#e8d5b8');
      } else if (event.type === 'watcher') {
        // The two moments worth a word over his head, and no others: the one
        // where he decides something is worth getting up for, and the one
        // where he picks you out of the room. Anything more and the school is
        // a running commentary.
        if (reacts && event.state === 'rising') fx.mark(event.x, event.y - 26, '?');
        if (reacts && event.state === 'following') {
          fx.mark(event.x, event.y - 30, '!', '#ff8a7a');
          fx.ring(event.x, event.y, 14, '255,120,100');
        }
      } else if (event.type === 'hiding') {
        // Getting in behind the lockers, and coming back out. A short breath of
        // dust at his feet either way, so the animation has a beat under it.
        if (reacts) fx.ring(event.x, event.y, 3, '190,214,228');
      } else if (event.type === 'won') {
        const level = LEVELS.find((l) => l.id === currentLevelId);
        const stars = starsFor(level, event.haul);
        saveStore.recordWin(currentLevelId, event.money, {
          stars,
          types: event.taken,
          seconds: sim.timeLimit - event.timeLeft,
          noise: event.noise
        });
        audio.win();
        buzz([16, 40, 16]);
        machine.set('won', {
          money: event.money, noise: event.noise, stars,
          taken: event.taken, timeLeft: event.timeLeft, grade: event.grade
        });
        if (debug) console.info('[dwh] replay', frameCount(recording), 'frames', JSON.stringify(recording));
      } else if (event.type === 'lost') {
        const end = { money: event.money, noise: event.noise, reason: event.reason };
        if (event.reason === 'time') {
          // Nothing to animate: the clock simply ran out.
          audio.lose();
          buzz([40, 60]);
          machine.set('lost', end);
        } else {
          // Let him sit up before the fail screen lands.
          audio.wake();
          buzz([30, 60, 90]);
          endHold = WAKE_BEAT;
          pendingEnd = end;
        }
      }
    }
  }

  // ---------------------------------------------------------------- HUD
  // The HUD is repainted every frame, so element lookups are cached and writes
  // are skipped when the value has not changed: a redundant textContent or
  // style write still costs a style recalculation.
  const hudEls = {
    money: $('money'), time: $('time'), level: $('lvl'),
    bar: $('noisebar'), noise: $('noisetxt'), wrap: $('noisewrap'), danger: $('danger'),
    warn: $('warn'), streak: $('streak')
  };
  const hudLast = {};
  const setText = (key, el, value) => {
    if (hudLast[key] === value) return;
    hudLast[key] = value;
    el.textContent = value;
  };
  const setStyle = (key, el, prop, value) => {
    if (hudLast[key] === value) return;
    hudLast[key] = value;
    el.style[prop] = value;
  };

  const comboBonusOf = (streak) => {
    let bonus = 0;
    for (const tier of TUNING.combo.tiers) if (streak >= tier.at) bonus = tier.bonus;
    return bonus;
  };

  function paintHud() {
    if (!sim) return;
    // The counter runs up to the money rather than jumping to it: a number that
    // jumps says something changed, one that runs up says you earned it. Eased
    // per second of real time, and it snaps the last dollar so it can never sit
    // one short of the bank.
    if (sim.rules.reacts) {
      const step = Math.max(0, Math.min(0.1, clock - hudClock));
      const gap = sim.money - shownMoney;
      shownMoney = Math.abs(gap) < 1 ? sim.money
        : shownMoney + gap * (1 - Math.exp(-8 * step));
    } else shownMoney = sim.money;
    hudClock = clock;
    setText('money', hudEls.money, `$${Math.round(shownMoney).toLocaleString()}`);
    setText('level', hudEls.level, `LV ${sim.level.id}`);

    const seconds = Math.max(0, sim.timeLeft);
    setText('time', hudEls.time, seconds.toFixed(1));
    const urgent = seconds <= TUNING.time.warnAt && sim.status === 'running';
    if (hudLast.urgent !== urgent) {
      hudLast.urgent = urgent;
      hudEls.time.classList.toggle('warn', urgent);
    }
    // One tick per second in the last few seconds.
    const whole = Math.ceil(seconds);
    if (urgent && whole !== lastTick) { lastTick = whole; audio.tick(); }
    if (!urgent) lastTick = -1;

    const rounded = Math.round(sim.noise);
    // The meter is the same meter; what it is called depends on who is in the
    // room. A sleeper raises NOISE; a guard raises ALERT.
    const meter = watcherConfig(sim.level.watcher.kind).meter;
    // Where a location makes noise depend on where you are standing, say so on
    // the meter. A hidden multiplier is not a mechanic, it is a trap: the whole
    // point is that the player can tell how much a mistake is about to cost.
    // Banded against the curve as it actually runs — 0.85 at the far end of the
    // building up to about five standing over a caretaker who is awake. The old
    // thresholds were set for a much flatter curve and now read LOUD almost
    // everywhere, which tells the player nothing.
    const loudness = sim.proximity >= 3.6 ? '  ‼‼ HE IS RIGHT THERE'
      : sim.proximity >= 2.4 ? '  ‼ LOUD HERE'
        : sim.proximity >= 1.5 ? '  ▲'
          : sim.proximity <= 1.05 ? '  ▼ MUFFLED' : '';
    // In a building where the meter is how alert one man is rather than a fuse,
    // the number is not a countdown to anything and saying "/ 100" invites the
    // player to treat it as one. What matters is how sharp he is, so that is
    // what it says.
    const hunted = !!sim.rules.alertness;
    const sharpness = !hunted ? ''
      : rounded >= 90 ? '  HE HAS YOUR NUMBER'
        : rounded >= 75 ? '  HE IS CLOSING IN'
          : rounded >= 62 ? '  HE IS LISTENING'
            : rounded >= 45 ? '  HE IS STIRRING' : '  ASLEEP';
    setText('noiseText', hudEls.noise, hunted
      ? `${meter} ${rounded}${sharpness}${loudness}`
      : `${meter} ${rounded} / ${TUNING.noise.max}${loudness}`);
    setStyle('barWidth', hudEls.bar, 'width', `${(sim.noise / TUNING.noise.max) * 100}%`);
    setStyle('barColor', hudEls.bar, 'background',
      sim.noise >= TUNING.noise.almostAt ? '#ff4d4d'
        : sim.noise >= TUNING.noise.stirringAt ? '#ffb020' : '#4cc172');

    const danger = sim.noise >= TUNING.noise.almostAt;
    if (hudLast.danger !== danger) {
      hudLast.danger = danger;
      hudEls.wrap.classList.toggle('danger', danger);
    }
    // The room closing in. Quantised to a hundredth, so this is a handful of
    // style writes a second rather than one every frame — and the browser
    // composites the layer itself instead of the game repainting the view.
    const closeIn = danger && sim.status === 'running'
      ? Math.round(((sim.noise - TUNING.noise.almostAt) / (TUNING.noise.max - TUNING.noise.almostAt))
        * (0.22 + 0.13 * Math.sin(clock * 6)) * 100) / 100
      : 0;
    if (hudLast.closeIn !== closeIn) {
      hudLast.closeIn = closeIn;
      hudEls.danger.style.opacity = closeIn;
    }
    const calming = sim.stillFor > TUNING.recovery.delay && sim.noise > 0 && sim.status === 'running';
    if (hudLast.calming !== calming) {
      hudLast.calming = calming;
      hudEls.wrap.classList.toggle('calming', calming);
    }
    // He's stirring. The warning escalates rather than appearing all at once.
    const warnEl = hudEls.warn;
    const config = watcherConfig(sim.level.watcher.kind);
    const warnings = config.warnings;
    // Once someone is on his feet, what he is doing matters more than the
    // number that got him there — the player's next decision depends on
    // whether he is coming, looking, or already on his way back.
    const up = sim.investigator && sim.investigator.state !== 'asleep' && config.onFoot;
    const onFootText = up ? config.onFoot[sim.investigator.state] || null : null;
    const warning = sim.status !== 'running' ? null
      : onFootText
        ? {
          text: onFootText,
          cls: sim.investigator.state === 'following' ? 'hard critical'
            : sim.investigator.state === 'returning' || sim.investigator.state === 'settling'
              ? '' : 'hard'
        }
        : sim.noise >= 95 ? { text: warnings[2], cls: 'hard critical' }
          : sim.noise >= 90 ? { text: warnings[1], cls: 'hard' }
            : sim.noise >= 80 ? { text: warnings[0], cls: '' } : null;
    if (hudLast.warnText !== (warning ? warning.text : '')) {
      hudLast.warnText = warning ? warning.text : '';
      warnEl.hidden = !warning;
      if (warning) {
        warnEl.textContent = warning.text;
        warnEl.className = warning.cls;
        buzz(sim.noise >= 95 ? [20, 40, 20] : 12);
      }
    }
    // A heartbeat once he is on the edge.
    if (sim.noise >= 95 && sim.status === 'running') {
      if (clock - lastHeartbeat > 0.62) { lastHeartbeat = clock; audio.heartbeat(); }
    }

    const streakEl = hudEls.streak;
    const showStreak = sim.streak >= TUNING.combo.tiers[0].at && sim.status === 'running';
    const streakText = showStreak
      ? `STEAL STREAK x${sim.streak}  +${Math.round(comboBonusOf(sim.streak) * 100)}%` : '';
    if (hudLast.streakText !== streakText) {
      hudLast.streakText = streakText;
      streakEl.hidden = !showStreak;
      streakEl.textContent = streakText;
    }

    const targeted = !!sim.targetId;
    if (hudLast.targeted !== targeted) {
      hudLast.targeted = targeted;
      takeButton.classList.toggle('on', targeted);
    }

    // One button, for whatever is to hand, and nothing when nothing is.
    //
    // It began as SEARCH and is now the game's only interaction button: walk up
    // to a cupboard and it says SEARCH, step into the gap behind the lockers
    // and it says HIDE, and once you are in there it says LEAVE. Which of those
    // is on offer is the simulation's decision — `sim.action` — so the HUD only
    // renders it, and a location with none of those mechanics shows no button.
    const busy = !!sim.searching;
    const label = ACTION_LABEL[sim.action] || 'SEARCH';
    const here = busy || !!sim.action;
    if (hudLast.searchHere !== here) {
      hudLast.searchHere = here;
      searchButton.classList.toggle('here', here);
      searchButton.classList.toggle('on', here);
    }
    if (hudLast.searchBusy !== busy || hudLast.actionLabel !== label) {
      hudLast.searchBusy = busy;
      hudLast.actionLabel = label;
      searchButton.classList.toggle('busy', busy);
      searchButton.textContent = busy ? '' : label;
      // Getting out is the urgent one, and should not look like opening a
      // drawer.
      searchButton.classList.toggle('leave', sim.action === 'leave');
    }
    if (busy) {
      const share = Math.round((sim.searching.t / sim.searching.duration) * 20) / 20;
      if (hudLast.searchShare !== share) {
        hudLast.searchShare = share;
        searchButton.style.setProperty('--p', share);
      }
    }
  }

  // ---------------------------------------------------------------- loop
  let consecutiveErrors = 0;

  function frame(now) {
    try {
      const elapsed = Math.min((now - lastTime) / 1000, TUNING.sim.maxFrameSeconds);
      lastTime = now;
      clock += elapsed;
      stats.fps = stats.fps * 0.9 + (1 / Math.max(elapsed, 0.0001)) * 0.1;

      let steps = 0;
      const stepping = sim && (machine.is('playing') || endHold > 0);
      if (stepping) {
        accumulator += elapsed;
        while (accumulator >= STEP_SECONDS && steps < TUNING.sim.maxStepsPerFrame) {
          const currentInput = endHold > 0 ? { x: 0, y: 0, take: false } : input.read();
          if (endHold <= 0) recordFrame(recording, currentInput);
          stepSim(sim, currentInput);
          handleEvents();
          footstepAudio();
          accumulator -= STEP_SECONDS;
          steps++;
          if (!machine.is('playing') && endHold <= 0) { accumulator = 0; break; }
        }
        if (accumulator > STEP_SECONDS * TUNING.sim.maxStepsPerFrame) accumulator = 0;
      }
      stats.steps = steps;

      if (endHold > 0) {
        endHold -= elapsed;
        if (endHold <= 0 && pendingEnd) {
          machine.set('lost', pendingEnd);
          pendingEnd = null;
        }
      }

      fx.update(elapsed);

      // Nothing to update most frames; skip the array churn entirely then.
      if (pops.length) {
        for (const pop of pops) pop.life -= elapsed * 1.2;
        if (pops.some((p) => p.life <= 0)) pops = pops.filter((p) => p.life > 0);
      }
      if (sparks.length) {
        for (const spark of sparks) {
          spark.life -= elapsed * 1.9;
          spark.x += spark.vx * elapsed;
          spark.y += spark.vy * elapsed;
          spark.vy += 150 * elapsed;
        }
        if (sparks.some((s) => s.life <= 0)) sparks = sparks.filter((s) => s.life > 0);
      }

      if (sim) {
        if (flash > 0) flash = Math.max(0, flash - elapsed * 2.4);
        renderer.draw(sim, Math.min(1, accumulator / STEP_SECONDS), clock, pops, stats,
          sparks, flash, elapsed, fx);
        paintHud();
      }
      consecutiveErrors = 0;
    } catch (error) {
      consecutiveErrors++;
      console.error('[dwh] frame error', error);
      if (consecutiveErrors === 1) showCrash(error);
      if (consecutiveErrors > 5) {
        if (machine.is('playing')) machine.set('paused');
        consecutiveErrors = 0;
      }
    } finally {
      requestAnimationFrame(frame);
    }
  }

  // What he is standing on, from the floor treatments the map declared. A short
  // linear scan of a few dozen rectangles, a couple of times a second, at a
  // footfall — cheaper than any of the ways of caching it would be to write.
  function surfaceUnder(level, x, y) {
    let tag = null;
    for (const d of level.decor) {
      if (d.kind !== 'floor') continue;
      // Later patches are painted over earlier ones, so the last match is the
      // one actually underfoot.
      if (x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h) tag = d.tag;
    }
    return tag;
  }

  // A soft footfall each time the walk cycle passes a half stride.
  function footstepAudio() {
    const player = playerOf(sim);
    if (!player.moving) { lastStepPhase = player.walkPhase; return; }
    const half = Math.PI;
    if (Math.floor(player.walkPhase / half) !== Math.floor(lastStepPhase / half)) {
      // Footsteps land on the walk cycle, which is driven by distance, so they
      // stay in step at any speed — and get louder the faster you move.
      const share = Math.min(1, player.speed / TUNING.player.speed);
      audio.step(Math.floor(player.walkPhase / half) % 2 === 0, share);
      // ...and leave a mark on the floor. Faint, brief, and only once he is
      // properly walking: a scuff under every careful step would be a man
      // leaving a trail of breadcrumbs through the building he is robbing.
      if (sim.rules.reacts && share > 0.32 && !sim.hidden) {
        fx.scuff(player.x, player.y, share, surfaceUnder(sim.level, player.x, player.y));
      }
    }
    lastStepPhase = player.walkPhase;
  }

  function showCrash(error) {
    $('crashText').textContent = `${error && error.message}\n\n${(error && error.stack) || ''}`;
    $('crash').classList.add('on');
  }
  function hideCrash() { $('crash').classList.remove('on'); }

  // ---------------------------------------------------------------- buttons
  const on = (id, handler) => $(id).addEventListener('click', handler);
  const openFromMenu = (state) => () => { audio.unlock(); audio.ui(); machine.set(state); };

  on('bPlay', () => { audio.unlock(); startLevel(Math.min(saveStore.data.unlocked, LEVELS.length)); });
  on('bLevels', openFromMenu('levels'));
  on('bShop', openFromMenu('shop'));
  on('bCollection', openFromMenu('collection'));
  on('bSettings', openFromMenu('settings'));
  on('bBack', () => machine.set('menu'));
  on('bShopBack', () => machine.set('menu'));
  on('bCollBack', () => machine.set('menu'));
  on('bSetBack', () => machine.set('menu'));
  on('bReset', () => { saveStore.reset(); applySettings(); paintSettings(); });
  on('bNext', () => startLevel(Math.min(currentLevelId + 1, LEVELS.length)));
  on('bRetry', () => startLevel(currentLevelId));
  on('bMenu', () => machine.set('menu'));
  on('bResume', () => machine.set('playing'));
  on('bPRetry', () => startLevel(currentLevelId));
  on('bPMenu', () => machine.set('menu'));
  on('bCrashReload', () => { hideCrash(); if (currentLevelId) startLevel(currentLevelId); });
  on('btnpause', () => {
    if (machine.is('playing')) machine.set('paused');
    else if (machine.is('paused')) machine.set('playing');
  });

  function applySettings() {
    audio.setMuted(!setting('sound'));
    if (setting('music') && setting('sound')) audio.startMusic(); else audio.stopMusic();
    renderer.setQuality(TUNING.quality[setting('quality')]);
    paintMute();
  }
  function paintMute() { $('btnmute').textContent = setting('sound') ? '🔊' : '🔇'; }

  const toggleSetting = (key) => () => {
    audio.unlock();
    saveStore.setSetting(key, !setting(key));
    applySettings();
    paintSettings();
  };
  on('tSound', toggleSetting('sound'));
  on('tMusic', toggleSetting('music'));
  on('tVibe', () => { saveStore.setSetting('vibration', !setting('vibration')); buzz(20); paintSettings(); });
  on('tUnlock', () => {
    saveStore.setSetting('unlockAll', !setting('unlockAll'));
    audio.ui();
    paintSettings();
  });
  for (const button of $('segQuality').children) {
    button.addEventListener('click', () => {
      saveStore.setSetting('quality', button.dataset.q);
      applySettings();
      paintSettings();
      resize();
    });
  }
  on('btnmute', () => {
    audio.unlock();
    saveStore.setSetting('sound', !setting('sound'));
    applySettings();
  });

  takeButton.addEventListener('pointerdown', (e) => { e.preventDefault(); input.pressTake(true); });
  const releaseTake = () => input.pressTake(false);
  takeButton.addEventListener('pointerup', releaseTake);
  takeButton.addEventListener('pointercancel', releaseTake);
  takeButton.addEventListener('pointerleave', releaseTake);

  searchButton.addEventListener('pointerdown', (e) => { e.preventDefault(); input.pressSearch(true); });
  const releaseSearch = () => input.pressSearch(false);
  searchButton.addEventListener('pointerup', releaseSearch);
  searchButton.addEventListener('pointercancel', releaseSearch);
  searchButton.addEventListener('pointerleave', releaseSearch);

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && machine.is('playing')) machine.set('paused');
    if (e.key.toLowerCase() === 'm') {
      saveStore.setSetting('sound', !setting('sound'));
      applySettings();
    }
    if (debug && /^[0-9]$/.test(e.key)) startLevel(e.key === '0' ? 10 : Number(e.key));
  });

  const resize = () => {
    renderer.resize(stage);
    // Derived from the same world constant the HUD strip is sized from, rather
    // than measured: a measurement taken before layout settles sticks, and the
    // banner ends up drawn over the HUD.
    const fit = stage.clientWidth / TUNING.world.width;
    $('banner').style.top = `${TUNING.world.hudStrip * fit + 8}px`;
  };
  addEventListener('resize', resize);
  addEventListener('orientationchange', () => setTimeout(resize, 200));

  renderer.setQuality(TUNING.quality[setting('quality')]);
  resize();
  paintMute();

  // Something must be on screen behind the menu.
  sim = createSim({ level: LEVELS[0], seed: 1 });
  renderer.snapCamera(LEVELS[0], LEVELS[0].spawn.x, LEVELS[0].spawn.y);
  requestAnimationFrame((t) => { lastTime = t; frame(t); });

  // Debug-only, and a getter rather than the object: `sim` is replaced on every
  // level start, so a captured reference would go stale. A browser check
  // asserts none of this exists in the release build.
  if (debug) {
    window.__dwhBoot = { machine, saveStore, startLevel, LEVELS, TUNING, SLEEP_LABELS, levelTotals };
    Object.defineProperty(window.__dwhBoot, 'sim', { get: () => sim });
    // The camera is presentation, so it lives in the renderer — exposed here so
    // a test can assert it stays inside the map.
    Object.defineProperty(window.__dwhBoot, 'camera', { get: () => renderer.camera });
  }
}
