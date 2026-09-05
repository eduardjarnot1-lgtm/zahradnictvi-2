// Draws a simulation snapshot. Knows nothing about rules — it reads state and
// paints it, interpolating between the last two fixed steps so 60Hz sim motion
// stays smooth on any refresh rate.
import { TUNING } from './tuning.js';
import { sleepStage, rarityOf, isBigScore, watcherConfig } from './rules.js';
import { playerOf } from './sim.js';
import {
  paintStaticRoom, drawSleeper, drawGuard, drawThief, drawGrabbedItem, roundRect,
  ITEM_ART, lampPositions
} from './art.js';

const { width: W, height: H, wallThickness: WT, hudStrip: HUD_H } = TUNING.world;
const TAU = Math.PI * 2;

export function createRenderer(canvas, options = {}) {
  const ctx = canvas.getContext('2d');
  const debug = !!options.debug;
  let scale = 1;
  let quality = TUNING.quality.high;

  // The room never moves, so it is painted once per level into an offscreen
  // canvas at device resolution and blitted 1:1 — detailed *and* cheap.
  let roomCache = null;
  let roomKey = '';

  function resize(stage) {
    const viewHeight = H + HUD_H;
    const fit = Math.min(innerWidth / W, innerHeight / viewHeight);
    const cssWidth = Math.round(W * fit);
    const cssHeight = Math.round(viewHeight * fit);
    stage.style.width = `${cssWidth}px`;
    stage.style.height = `${cssHeight}px`;
    // The HUD's CSS height is derived from the same world value the room is
    // offset by, so the strip and the room can never drift out of step.
    const hud = document.getElementById('hud');
    if (hud) hud.style.height = `${(HUD_H * cssWidth) / W}px`;

    // Sharper than the old flat cap of 2, but never more pixels than a
    // mid-range phone GPU is happy to push every frame.
    let dpr = Math.min(devicePixelRatio || 1, TUNING.render.maxPixelRatio, quality.pixelRatio);
    const budget = TUNING.render.maxCanvasPixels;
    if (cssWidth * cssHeight * dpr * dpr > budget) {
      dpr = Math.max(1, Math.sqrt(budget / (cssWidth * cssHeight)));
    }
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    scale = (cssWidth * dpr) / W;
    ctx.setTransform(scale, 0, 0, scale, 0, HUD_H * scale);
    roomKey = ''; // force a repaint of the cache at the new resolution
  }

  function ensureRoom(level) {
    const key = `${level.id}@${Math.round(scale * 1000)}`;
    if (roomKey === key && roomCache) return;
    roomCache = document.createElement('canvas');
    roomCache.width = Math.max(1, Math.ceil(W * scale));
    roomCache.height = Math.max(1, Math.ceil(H * scale));
    const cacheCtx = roomCache.getContext('2d');
    cacheCtx.setTransform(scale, 0, 0, scale, 0, 0);
    paintStaticRoom(cacheCtx, level);
    roomKey = key;
  }

  // The exit glow's geometry never changes, only its opacity, so the gradient
  // is built once instead of sixty times a second.
  let exitGlow = null;
  let exitGlowKey = '';
  function drawExit(sim, time) {
    const exit = sim.level.exit;
    const player = playerOf(sim);
    // Brighter and faster the closer you are: the way out should feel like it
    // is calling you once escaping is actually on the table.
    const near = Math.max(0, 1 - Math.hypot(player.x - (exit.x + exit.w / 2), player.y - exit.y) / 170);
    const pulse = 0.5 + 0.5 * Math.sin(time * (3 + near * 4));
    const alpha = (0.26 + 0.20 * pulse + near * 0.22).toFixed(2);
    const key = `${exit.y}:${alpha}`;
    if (exitGlowKey !== key) {
      exitGlow = ctx.createLinearGradient(0, exit.y - 34, 0, H);
      exitGlow.addColorStop(0, 'rgba(76,193,114,0)');
      exitGlow.addColorStop(1, `rgba(108,232,150,${alpha})`);
      exitGlowKey = key;
    }
    ctx.fillStyle = exitGlow;
    ctx.fillRect(exit.x, exit.y - 34, exit.w, exit.h + 34);

    ctx.fillStyle = '#2f8f4e';
    ctx.fillRect(exit.x, H - WT, exit.w, WT);
    ctx.fillStyle = '#48b96a';
    ctx.fillRect(exit.x, H - WT, exit.w, 4);

    ctx.fillStyle = '#eafff1';
    ctx.textAlign = 'center';
    ctx.font = 'bold 12px system-ui';
    ctx.fillText('EXIT', exit.x + exit.w / 2, H - 19);
    ctx.globalAlpha = 0.55 + 0.45 * pulse;
    ctx.beginPath();
    ctx.moveTo(exit.x + exit.w / 2 - 7, H - 44);
    ctx.lineTo(exit.x + exit.w / 2 + 7, H - 44);
    ctx.lineTo(exit.x + exit.w / 2, H - 34);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Items get their own contrast treatment so a richer room can never bury
  // them: a dark pool underneath, a bright disc behind, outlined labels.
  function drawItems(sim, time) {
    ctx.textAlign = 'center';
    for (const item of sim.items) {
      if (item.taken) continue;
      const bob = Math.sin(time * 2.2 + item.x * 0.07) * 1.6;
      const isTarget = sim.targetId === item.id;
      const y = item.y + bob;

      ctx.fillStyle = 'rgba(18,10,24,0.34)';
      ctx.beginPath();
      ctx.ellipse(item.x, item.y + 15, 13, 4.5, 0, 0, TAU);
      ctx.fill();

      const halo = ctx.createRadialGradient(item.x, y, 2, item.x, y, 21);
      halo.addColorStop(0, isTarget ? 'rgba(255,238,170,0.60)' : 'rgba(255,246,225,0.34)');
      halo.addColorStop(1, 'rgba(255,240,200,0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(item.x, y, 21, 0, TAU);
      ctx.fill();

      // A marked prize gets a slow halo of its own, even out of range.
      if (item.bonus) {
        const shine = 0.5 + 0.5 * Math.sin(time * 2.2 + item.x);
        ctx.strokeStyle = `rgba(255,196,77,${0.35 + 0.35 * shine})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(item.x, y, 24 + shine * 3, 0, TAU);
        ctx.stroke();
      }

      if (isTarget) {
        const ring = 0.5 + 0.5 * Math.sin(time * 5);
        ctx.strokeStyle = `rgba(255,222,120,${0.6 + 0.35 * ring})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(item.x, y, 18 + ring * 2.5, 0, TAU);
        ctx.stroke();
      }

      ctx.font = '23px system-ui';
      ctx.fillText(ITEM_ART[item.type] || '?', item.x, y + 8);

      ctx.font = 'bold 10px system-ui';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(20,10,26,0.85)';
      ctx.lineJoin = 'round';
      ctx.strokeText(`$${item.value}`, item.x, y - 15);
      // Price is tinted by rarity, so how tempting a thing is reads instantly.
      ctx.fillStyle = isTarget ? '#fff4cf' : rarityOf(item.type).tint;
      ctx.fillText(`$${item.value}`, item.x, y - 15);
      ctx.strokeText(`+${item.noise}`, item.x, y + 24);
      ctx.fillStyle = '#ffab7d';
      ctx.fillText(`+${item.noise}`, item.x, y + 24);

      // The prompt appears only for the thing a TAKE would actually consume.
      if (isTarget) {
        ctx.font = 'bold 9px system-ui';
        ctx.fillStyle = 'rgba(20,10,26,0.75)';
        roundRect(ctx, item.x - 19, y + 28, 38, 13, 6);
        ctx.fill();
        ctx.fillStyle = '#ffe9a8';
        ctx.fillText('STEAL', item.x, y + 37);
      }
    }
  }

  // Tiny burst when something is taken; a fragile item throws more, colder ones.
  function drawSparks(sparks) {
    for (const spark of sparks) {
      ctx.globalAlpha = Math.max(0, spark.life);
      ctx.fillStyle = spark.color;
      ctx.beginPath();
      ctx.arc(spark.x, spark.y, 1.6 + spark.life * 1.4, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawPops(pops) {
    ctx.textAlign = 'center';
    for (const pop of pops) {
      const rise = (1 - pop.life) * 26;
      ctx.globalAlpha = Math.max(0, Math.min(1, pop.life * 1.4));
      ctx.font = `bold ${pop.big ? 21 : 14}px system-ui`;
      ctx.lineWidth = pop.big ? 4 : 3;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(20,10,26,0.8)';
      const label = pop.text || `+$${pop.value}`;
      ctx.strokeText(label, pop.x, pop.y - 18 - rise);
      ctx.fillStyle = pop.color || (pop.text ? '#ff9c6e' : '#ffd34d');
      ctx.fillText(label, pop.x, pop.y - 18 - rise);
      ctx.globalAlpha = 1;
    }
  }

  function drawDanger(sim, time) {
    if (sim.noise <= TUNING.noise.almostAt) return;
    const span = TUNING.noise.max - TUNING.noise.almostAt;
    const a = ((sim.noise - TUNING.noise.almostAt) / span) * (0.22 + 0.13 * Math.sin(time * 6));
    const edge = ctx.createRadialGradient(W / 2, H / 2, H * 0.30, W / 2, H / 2, H * 0.62);
    edge.addColorStop(0, 'rgba(255,40,40,0)');
    edge.addColorStop(1, `rgba(255,45,45,${a.toFixed(3)})`);
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, W, H);
  }

  function drawDebug(sim, stats, playerPos) {
    ctx.save();
    ctx.strokeStyle = '#00e5ff88';
    ctx.lineWidth = 1;
    for (const c of sim.level.colliders) ctx.strokeRect(c.x, c.y, c.w, c.h);
    ctx.strokeStyle = '#ffd34d66';
    for (const item of sim.items) {
      if (item.taken) continue;
      ctx.beginPath();
      ctx.arc(item.x, item.y, TUNING.pickup.radius, 0, TAU);
      ctx.stroke();
    }
    const player = playerOf(sim);
    ctx.strokeStyle = '#ff4dff';
    ctx.strokeRect(player.x - player.w / 2, player.y - player.h / 2, player.w, player.h);

    ctx.fillStyle = '#000000bb';
    roundRect(ctx, WT + 4, WT + 4, 156, 86, 5);
    ctx.fill();
    ctx.fillStyle = '#7CFFB2';
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'left';
    const lines = [
      `fps ${stats.fps.toFixed(0)}  steps ${stats.steps}  dpr ${(scale / (canvas.clientWidth / W)).toFixed(2)}`,
      `frame ${sim.frame}  seed ${sim.seed}`,
      `pos ${player.x.toFixed(1)}, ${player.y.toFixed(1)}`,
      `draw ${playerPos.x.toFixed(1)}, ${playerPos.y.toFixed(1)}`,
      `speed ${player.speed.toFixed(0)}  face ${player.facing.toFixed(2)}`,
      `noise ${sim.noise}  $${sim.money}`,
      `target ${sim.targetId || '-'}  reach ${sim.reach ? sim.reach.t.toFixed(2) : '-'}`
    ];
    lines.forEach((line, i) => ctx.fillText(line, WT + 10, WT + 18 + i * 11));
    ctx.restore();
  }

  return {
    resize,
    get scale() { return scale; },
    invalidateRoom() { roomKey = ''; },
    setQuality(next) { if (next) { quality = next; roomKey = ''; } },

    draw(sim, alpha, time, pops, stats, sparks = [], flash = 0) {
      ensureRoom(sim.level);

      ctx.save();
      if (sim.shake !== 0) ctx.translate(sim.shakeX, sim.shakeY);

      ctx.drawImage(roomCache, 0, 0, W, H);
      drawExit(sim, time);
      // Who is in this room decides what gets drawn here — and nothing else in
      // the renderer has to care.
      const stage = sleepStage(sim.noise);
      const config = watcherConfig(sim.level.watcher.kind);
      const kind = sim.level.watcher.kind;
      if (config.sees > 0) {
        drawGuard(ctx, sim.level, stage, time, sim.wakeSeconds || 0, sim.startle || 0,
          sim.seen || 0, config.sees, kind);
      } else {
        drawSleeper(ctx, sim.level, stage, time, sim.wakeSeconds || 0, sim.startle || 0, kind);
      }
      drawItems(sim, time);

      // The thief is drawn between the last two simulation steps.
      const player = playerOf(sim);
      const px = player.prevX + (player.x - player.prevX) * alpha;
      const py = player.prevY + (player.y - player.prevY) * alpha;
      // Full range, not saturated at half speed: the animation has to keep
      // getting faster and longer-strided right up to a run.
      const walk = Math.min(1, player.speed / TUNING.player.speed);
      const reachProgress = sim.reach ? sim.reach.t / sim.reach.duration : 0;

      // How far past a walk he is, eased so the gait shifts rather than snaps.
      const runAt = TUNING.player.runAt;
      const run = walk <= runAt ? 0 : Math.min(1, (walk - runAt) / (1 - runAt)) ** 2;

      const hand = drawThief(ctx, px, py, {
        facing: player.facing,
        walkPhase: player.walkPhase,
        walk,
        run,
        clock: time,
        reach: reachProgress
      });

      if (sim.reach) {
        drawGrabbedItem(ctx, ITEM_ART[sim.reach.type] || '?', sim.reach, hand, reachProgress);
      }

      // Lamps breathe over the cached room. Flat circles, not gradients: this
      // runs every frame.
      for (let i = 0; i < lampPositions.length; i++) {
        const lamp = lampPositions[i];
        const flicker = 0.5 + 0.5 * Math.sin(time * (2.1 + i * 0.7) + i);
        ctx.globalAlpha = 0.05 + flicker * 0.05;
        ctx.fillStyle = '#ffe6a8';
        ctx.beginPath();
        ctx.arc(lamp.x, lamp.y, 22, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      drawSparks(sparks);
      drawPops(pops);
      drawDanger(sim, time);
      // A brief warm wash when something genuinely valuable comes off the shelf.
      if (flash > 0) {
        ctx.fillStyle = `rgba(255,214,120,${(flash * 0.20).toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
      }
      if (debug) drawDebug(sim, stats, { x: px, y: py });
      ctx.restore();
    }
  };
}
