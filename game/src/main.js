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
import { sleepStage } from './rules.js';

const $ = (id) => document.getElementById(id);

export function boot() {
  const params = new URLSearchParams(location.search);
  const debug = params.has('debug');

  const stage = $('stage');
  const canvas = $('cv');
  const takeButton = $('take');

  const saveStore = createSaveStore(window.localStorage);
  const audio = createAudio(saveStore);
  const renderer = createRenderer(canvas, { debug });

  // Levels are checked at boot in debug builds; CI checks them on every commit.
  if (debug) {
    const report = validateAll(LEVELS);
    if (!report.ok) {
      const detail = report.results
        .filter((r) => !r.ok)
        .map((r) => `L${r.id}: ${r.errors.join('; ')}`)
        .join('\n');
      showCrash(new Error(`Level validation failed:\n${detail}`));
    }
    console.info('[dwh] level report', report.results.map((r) => ({ id: r.id, ...r.stats })));
  }

  let sim = null;
  let currentLevelId = null;   // owned by the game, not by a screen payload:
                               // pausing must not lose track of the level
  let recording = null;
  let pops = [];
  let accumulator = 0;
  let lastTime = 0;
  let clock = 0;
  let warnedAt = 0;
  const stats = { fps: 0, steps: 0 };

  const input = createInput({
    stage,
    joystick: $('joy'),
    knob: $('knob'),
    takeButton,
    onBlur: () => { if (machine.is('playing')) machine.set('paused'); }
  });

  // ---------------------------------------------------------------- screens
  const screens = { menu: $('scMenu'), levels: $('scLevels'), end: $('scEnd'), pause: $('scPause') };
  const showOnly = (el) => {
    for (const key of Object.keys(screens)) screens[key].classList.toggle('on', screens[key] === el);
  };

  const machine = createMachine({
    initial: 'menu',
    onChange(name) { document.body.dataset.screen = name; },
    states: {
      menu: {
        to: ['levels', 'playing'],
        enter() {
          showOnly(screens.menu);
          $('bank').textContent = `Total stolen: $${saveStore.data.bank}`;
        }
      },
      levels: { to: ['menu', 'playing'], enter() { buildGrid(); showOnly(screens.levels); } },
      playing: {
        to: ['paused', 'won', 'lost', 'menu'],
        enter() { showOnly(null); },
        exit() { input.clearAll(); }
      },
      paused: {
        to: ['playing', 'menu'],
        enter() { showOnly(screens.pause); }
      },
      won: { to: ['playing', 'menu', 'levels'], enter: (ctx) => showEnd(true, ctx) },
      lost: { to: ['playing', 'menu'], enter: (ctx) => showEnd(false, ctx) }
    }
  });

  function showEnd(won, ctx) {
    showOnly(screens.end);
    $('endTitle').textContent = won ? 'LEVEL COMPLETE' : 'HE WOKE UP!';
    if (won) {
      const best = saveStore.data.best[currentLevelId] || 0;
      $('endText').innerHTML =
        `You escaped with <b style="color:#ffd34d">$${ctx.money}</b><br>` +
        `Noise left behind: ${ctx.noise} / ${TUNING.noise.max}<br>` +
        `Best on this level: $${best}<br><br>Total stolen: $${saveStore.data.bank}`;
    } else {
      $('endText').innerHTML =
        `One item too many.<br>You lost <b style="color:#ffd34d">$${ctx.money}</b>.`;
    }
    $('bNext').style.display = won && currentLevelId < LEVELS.length ? '' : 'none';
  }

  function buildGrid() {
    const grid = $('grid');
    grid.innerHTML = '';
    for (const level of LEVELS) {
      const unlocked = level.id <= saveStore.data.unlocked;
      const best = saveStore.data.best[level.id];
      const button = document.createElement('button');
      button.className = `lv${unlocked ? '' : ' locked'}`;
      button.innerHTML = unlocked
        ? `<b>${level.id}</b>${best ? `<i>$${best}</i>` : ''}`
        : '<b>🔒</b>';
      button.disabled = !unlocked;
      if (unlocked) button.addEventListener('click', () => startLevel(level.id));
      grid.appendChild(button);
    }
  }

  // ---------------------------------------------------------------- level
  function startLevel(id) {
    const level = LEVELS.find((l) => l.id === id);
    if (!level) throw new Error(`no level ${id}`);
    const seed = (Date.now() ^ (id * 2654435761)) >>> 0; // seeds the run, not the rules
    currentLevelId = id;
    sim = createSim({ level, seed });
    recording = createRecorder(id, seed);
    pops = [];
    accumulator = 0;
    warnedAt = 0;
    audio.unlock();
    hideCrash();
    machine.set('playing');
    if (debug) window.__dwh = { sim, recording, TUNING };
  }

  function handleEvents() {
    for (const event of sim.events) {
      if (event.type === 'took') {
        pops.push({ x: event.x, y: event.y, value: event.value, life: 1 });
        audio.take(event.noise);
        const stageNow = sleepStage(sim.noise);
        if (stageNow > warnedAt && stageNow > 0 && sim.status === 'running') {
          warnedAt = stageNow;
          audio.warn();
        }
      } else if (event.type === 'won') {
        saveStore.recordWin(currentLevelId, event.money);
        audio.win();
        machine.set('won', { money: event.money, noise: event.noise });
        if (debug) console.info('[dwh] replay', frameCount(recording), 'frames', JSON.stringify(recording));
      } else if (event.type === 'lost') {
        audio.lose();
        machine.set('lost', { money: event.money, noise: event.noise });
      }
    }
  }

  // ---------------------------------------------------------------- HUD
  function paintHud() {
    if (!sim) return;
    const percent = (sim.noise / TUNING.noise.max) * 100;
    $('money').textContent = `$${sim.money}`;
    $('noisebar').style.width = `${percent}%`;
    $('noisebar').style.background =
      sim.noise >= TUNING.noise.almostAt ? '#ff4d4d'
        : sim.noise >= TUNING.noise.stirringAt ? '#ffb020' : '#4cc172';
    $('noisetxt').textContent = `${sim.noise} / ${TUNING.noise.max}`;
    $('lvl').textContent = `LV ${sim.level.id}`;
    takeButton.classList.toggle('on', !!sim.targetId);
  }

  // ---------------------------------------------------------------- loop
  // Fixed timestep with an accumulator; rendering interpolates between steps so
  // a long frame costs no simulated distance.
  let consecutiveErrors = 0;

  function frame(now) {
    try {
      const elapsed = Math.min((now - lastTime) / 1000, TUNING.sim.maxFrameSeconds);
      lastTime = now;
      clock += elapsed;
      stats.fps = stats.fps * 0.9 + (1 / Math.max(elapsed, 0.0001)) * 0.1;

      let steps = 0;
      if (machine.is('playing') && sim) {
        accumulator += elapsed;
        while (accumulator >= STEP_SECONDS && steps < TUNING.sim.maxStepsPerFrame) {
          const currentInput = input.read();
          recordFrame(recording, currentInput);
          stepSim(sim, currentInput);
          handleEvents();
          accumulator -= STEP_SECONDS;
          steps++;
          if (!machine.is('playing')) { accumulator = 0; break; }
        }
        // Too far behind to catch up (tab was backgrounded): drop the debt.
        if (accumulator > STEP_SECONDS * TUNING.sim.maxStepsPerFrame) accumulator = 0;
      }
      stats.steps = steps;

      for (const pop of pops) pop.life -= elapsed * 1.2;
      pops = pops.filter((p) => p.life > 0);

      if (sim) {
        renderer.draw(sim, Math.min(1, accumulator / STEP_SECONDS), clock, pops, stats);
        paintHud();
      }
      consecutiveErrors = 0;
    } catch (error) {
      // A throw in update or draw must not kill the loop silently.
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

  function showCrash(error) {
    $('crashText').textContent = `${error && error.message}\n\n${(error && error.stack) || ''}`;
    $('crash').classList.add('on');
  }
  function hideCrash() { $('crash').classList.remove('on'); }

  // ---------------------------------------------------------------- buttons
  const on = (id, handler) => $(id).addEventListener('click', handler);
  on('bPlay', () => { audio.unlock(); startLevel(Math.min(saveStore.data.unlocked, LEVELS.length)); });
  on('bLevels', () => { audio.unlock(); audio.ui(); machine.set('levels'); });
  on('bBack', () => machine.set('menu'));
  on('bReset', () => { saveStore.reset(); buildGrid(); audio.setMuted(false); paintMute(); });
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

  function paintMute() {
    const icon = audio.muted ? '🔇' : '🔊';
    $('btnmute').textContent = icon;
    $('bMuteMenu').textContent = `SOUND ${audio.muted ? 'OFF' : 'ON'}`;
  }
  const toggleMute = () => { audio.unlock(); audio.toggleMute(); paintMute(); };
  on('btnmute', toggleMute);
  on('bMuteMenu', toggleMute);
  paintMute();

  // The TAKE button drives the same input the keyboard does.
  takeButton.addEventListener('pointerdown', (e) => { e.preventDefault(); input.pressTake(true); });
  const releaseTake = () => input.pressTake(false);
  takeButton.addEventListener('pointerup', releaseTake);
  takeButton.addEventListener('pointercancel', releaseTake);
  takeButton.addEventListener('pointerleave', releaseTake);

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && machine.is('playing')) machine.set('paused');
    if (e.key.toLowerCase() === 'm') { audio.toggleMute(); paintMute(); }
    if (debug) {
      // Level jump keys: 1-9 and 0 for ten.
      if (/^[0-9]$/.test(e.key)) startLevel(e.key === '0' ? 10 : Number(e.key));
    }
  });

  const resize = () => renderer.resize(stage);
  addEventListener('resize', resize);
  addEventListener('orientationchange', () => setTimeout(resize, 200));
  resize();

  // Something must be on screen behind the menu.
  sim = createSim({ level: LEVELS[0], seed: 1 });
  requestAnimationFrame((t) => { lastTime = t; frame(t); });

  if (debug) window.__dwhBoot = { machine, saveStore, startLevel, LEVELS, TUNING };
}
