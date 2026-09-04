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
  objectivesFor, isBigScore, rarityOf
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
  let lastTick = -1;
  let flash = 0;
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
    $('endTitle').textContent = won ? 'LEVEL COMPLETE'
      : ctx.reason === 'time' ? "TIME'S UP" : 'HE WOKE UP!';
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
        : 'The noise reached 100 and he woke up.';
      $('endText').innerHTML =
        `${cause}<br>You lost <b style="color:#ffd34d">$${ctx.money.toLocaleString()}</b>.`;
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
        pops.push({
          x: event.x, y: event.y, value: event.value, life: 1,
          big: event.big, color: event.big ? '#ffe9a8' : rarityOf(event.itemType).tint
        });
        spawnSparks(event.x, event.y, event.big ? 14 : event.fragile ? 10 : 6,
          event.big ? '#ffd98a' : event.fragile ? '#bfe6ff' : '#ffd34d');
        audio.take(event.noise, event.fragile);
        if (event.big) { flash = 1; audio.jackpot(); buzz([18, 40, 24]); }
        else buzz(event.fragile ? [12, 30, 12] : 14);
        if (event.streak >= TUNING.combo.tiers[0].at) audio.streak(event.streak);
        const stageNow = sleepStage(sim.noise);
        if (stageNow > warnedAt && stageNow > 0 && sim.status === 'running') {
          warnedAt = stageNow;
          audio.warn();
        }
      } else if (event.type === 'creak') {
        pops.push({ x: event.x, y: event.y - 6, value: null, text: 'CREAK', life: 1 });
        audio.creak();
        buzz(18);
      } else if (event.type === 'bump') {
        pops.push({ x: event.x, y: event.y - 6, value: null, text: `+${event.noise}`, life: 1 });
        audio.bump(event.what === 'bed' ? 'soft' : 'hard', event.noise);
        buzz(10);
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
    bar: $('noisebar'), noise: $('noisetxt'), wrap: $('noisewrap'),
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
    setText('money', hudEls.money, `$${sim.money.toLocaleString()}`);
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
    setText('noiseText', hudEls.noise, `${rounded} / ${TUNING.noise.max}`);
    setStyle('barWidth', hudEls.bar, 'width', `${(sim.noise / TUNING.noise.max) * 100}%`);
    setStyle('barColor', hudEls.bar, 'background',
      sim.noise >= TUNING.noise.almostAt ? '#ff4d4d'
        : sim.noise >= TUNING.noise.stirringAt ? '#ffb020' : '#4cc172');

    const danger = sim.noise >= TUNING.noise.almostAt;
    if (hudLast.danger !== danger) {
      hudLast.danger = danger;
      hudEls.wrap.classList.toggle('danger', danger);
    }
    const calming = sim.stillFor > TUNING.recovery.delay && sim.noise > 0 && sim.status === 'running';
    if (hudLast.calming !== calming) {
      hudLast.calming = calming;
      hudEls.wrap.classList.toggle('calming', calming);
    }
    // He's stirring. The warning escalates rather than appearing all at once.
    const warnEl = hudEls.warn;
    const warning = sim.status !== 'running' ? null
      : sim.noise >= 95 ? { text: "HE'S WAKING UP!", cls: 'hard critical' }
        : sim.noise >= 90 ? { text: "HE'S ALMOST AWAKE", cls: 'hard' }
          : sim.noise >= 80 ? { text: "HE'S STIRRING…", cls: '' } : null;
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
        renderer.draw(sim, Math.min(1, accumulator / STEP_SECONDS), clock, pops, stats, sparks, flash);
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

  const resize = () => {
    renderer.resize(stage);
    const hudHeight = $('hud').getBoundingClientRect().height;
    $('banner').style.top = `${hudHeight + 8}px`;
  };
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
