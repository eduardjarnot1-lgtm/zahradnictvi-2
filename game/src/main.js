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
  sleepStage, starsFor, starThresholds, levelTotals, upgradeCost, SLEEP_LABELS
} from './rules.js';
import { ITEM_ART, ITEM_NAMES } from './art.js';

const $ = (id) => document.getElementById(id);
const WAKE_BEAT = 0.9;         // seconds of wake-up animation before the fail screen

export function boot() {
  const params = new URLSearchParams(location.search);
  const debug = params.has('debug');

  const stage = $('stage');
  const canvas = $('cv');
  const takeButton = $('take');

  const saveStore = createSaveStore(window.localStorage);
  const audio = createAudio(saveStore);
  const renderer = createRenderer(canvas, { debug });

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
    $('endTitle').textContent = won ? 'LEVEL COMPLETE' : 'HE WOKE UP!';
    $('stars').innerHTML = won ? starRow(ctx.stars) : '';
    $('endTally').innerHTML = won
      ? `<div>HAUL<b>$${ctx.money.toLocaleString()}</b></div>` +
        `<div>ITEMS<b>${ctx.taken.length}</b></div>` +
        `<div>NOISE<b>${ctx.noise}/${TUNING.noise.max}</b></div>`
      : '';
    if (won) {
      const level = LEVELS.find((l) => l.id === currentLevelId);
      const marks = starThresholds(level);
      $('endText').innerHTML = ctx.stars < 3
        ? `Steal $${(ctx.stars < 2 ? marks.two : marks.three).toLocaleString()} in one run for ${ctx.stars < 2 ? 2 : 3} stars.`
        : 'A clean sweep. Nothing left worth taking.';
    } else {
      $('endText').innerHTML =
        `One item too many.<br>You lost <b style="color:#ffd34d">$${ctx.money.toLocaleString()}</b>.`;
    }
    $('bNext').style.display = won && currentLevelId < LEVELS.length ? '' : 'none';
  }

  function buildGrid() {
    const grid = $('grid');
    grid.innerHTML = '';
    let theme = null;
    for (const level of LEVELS) {
      if (level.theme !== theme) {
        theme = level.theme;
        const heading = document.createElement('div');
        heading.className = 'chapter';
        heading.style.gridColumn = '1 / -1';
        heading.textContent = level.name;
        grid.appendChild(heading);
      }
      const unlocked = level.id <= saveStore.data.unlocked;
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
    audio.unlock();
    if (setting('music')) audio.startMusic();
    hideCrash();
    renderer.invalidateRoom();
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
    for (const event of sim.events) {
      if (event.type === 'took') {
        pops.push({ x: event.x, y: event.y, value: event.value, life: 1 });
        spawnSparks(event.x, event.y, event.fragile ? 10 : 6,
          event.fragile ? '#bfe6ff' : '#ffd34d');
        audio.take(event.noise, event.fragile);
        buzz(event.fragile ? [12, 30, 12] : 14);
        const stageNow = sleepStage(sim.noise);
        if (stageNow > warnedAt && stageNow > 0 && sim.status === 'running') {
          warnedAt = stageNow;
          audio.warn();
        }
      } else if (event.type === 'creak') {
        pops.push({ x: event.x, y: event.y - 6, value: null, text: 'CREAK', life: 1 });
        audio.creak();
        buzz(18);
      } else if (event.type === 'won') {
        const level = LEVELS.find((l) => l.id === currentLevelId);
        const stars = starsFor(level, event.haul);
        saveStore.recordWin(currentLevelId, event.money, { stars, types: event.taken });
        audio.win();
        buzz([16, 40, 16]);
        machine.set('won', { money: event.money, noise: event.noise, stars, taken: event.taken });
        if (debug) console.info('[dwh] replay', frameCount(recording), 'frames', JSON.stringify(recording));
      } else if (event.type === 'lost') {
        // Let him sit up before the fail screen lands.
        audio.wake();
        buzz([30, 60, 90]);
        endHold = WAKE_BEAT;
        pendingEnd = { money: event.money, noise: event.noise };
      }
    }
  }

  // ---------------------------------------------------------------- HUD
  function paintHud() {
    if (!sim) return;
    const percent = (sim.noise / TUNING.noise.max) * 100;
    $('money').textContent = `$${sim.money.toLocaleString()}`;
    const bar = $('noisebar');
    bar.style.width = `${percent}%`;
    bar.style.background =
      sim.noise >= TUNING.noise.almostAt ? '#ff4d4d'
        : sim.noise >= TUNING.noise.stirringAt ? '#ffb020' : '#4cc172';
    $('noisetxt').textContent = `${sim.noise} / ${TUNING.noise.max}`;
    $('lvl').textContent = `LV ${sim.level.id}`;
    $('noisewrap').classList.toggle('danger', sim.noise >= TUNING.noise.almostAt);
    takeButton.classList.toggle('on', !!sim.targetId);
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

      for (const pop of pops) pop.life -= elapsed * 1.2;
      pops = pops.filter((p) => p.life > 0);
      for (const spark of sparks) {
        spark.life -= elapsed * 1.9;
        spark.x += spark.vx * elapsed;
        spark.y += spark.vy * elapsed;
        spark.vy += 150 * elapsed;
      }
      sparks = sparks.filter((s) => s.life > 0);

      if (sim) {
        renderer.draw(sim, Math.min(1, accumulator / STEP_SECONDS), clock, pops, stats, sparks);
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

  // A soft footfall each time the walk cycle passes a half stride.
  function footstepAudio() {
    const player = playerOf(sim);
    if (!player.moving) { lastStepPhase = player.walkPhase; return; }
    const half = Math.PI;
    if (Math.floor(player.walkPhase / half) !== Math.floor(lastStepPhase / half)) {
      audio.step(Math.floor(player.walkPhase / half) % 2 === 0);
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

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && machine.is('playing')) machine.set('paused');
    if (e.key.toLowerCase() === 'm') {
      saveStore.setSetting('sound', !setting('sound'));
      applySettings();
    }
    if (debug && /^[0-9]$/.test(e.key)) startLevel(e.key === '0' ? 10 : Number(e.key));
  });

  const resize = () => renderer.resize(stage);
  addEventListener('resize', resize);
  addEventListener('orientationchange', () => setTimeout(resize, 200));

  renderer.setQuality(TUNING.quality[setting('quality')]);
  resize();
  paintMute();

  // Something must be on screen behind the menu.
  sim = createSim({ level: LEVELS[0], seed: 1 });
  requestAnimationFrame((t) => { lastTime = t; frame(t); });

  if (debug) window.__dwhBoot = { machine, saveStore, startLevel, LEVELS, TUNING, SLEEP_LABELS, levelTotals };
}
