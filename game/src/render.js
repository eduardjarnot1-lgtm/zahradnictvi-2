// Draws a simulation snapshot. Knows nothing about rules — it reads state and
// paints it, interpolating between the last two fixed steps so 60Hz sim motion
// stays smooth on any refresh rate.
import { TUNING } from './tuning.js';
import { sleepStage, rarityOf, isBigScore, watcherConfig } from './rules.js';
import { playerOf } from './sim.js';
import {
  paintStaticRoom, drawSleeper, drawGuard, drawSlumped, drawThief, drawGrabbedItem,
  roundRect, ITEM_ART, lampPositions
} from './art.js';

// W and H are the *window*, not the world: how much of a level fits on screen
// at once. A level that is exactly this size never scrolls, which is every
// level built before maps could be larger than the screen.
const { width: W, height: H, wallThickness: WT, hudStrip: HUD_H } = TUNING.world;
const TAU = Math.PI * 2;

export function createRenderer(canvas, options = {}) {
  const ctx = canvas.getContext('2d');
  const debug = !!options.debug;
  let scale = 1;
  let quality = TUNING.quality.high;

  // The room never moves, so it is painted once per level into an offscreen
  // canvas at device resolution and blitted — detailed *and* cheap.
  let roomCache = null;
  let roomKey = '';
  let cacheScale = 1;

  // Where the window sits on the map, in world units: the top-left corner of
  // what you can see. On a level the size of the window this is pinned at 0,0
  // and every one of those levels draws exactly as it did before.
  const camera = { x: 0, y: 0 };

  // Where the camera wants to be: the player in the middle, then held inside
  // the map so no frame ever shows anything outside it. A map narrower than
  // the window is centred rather than shoved against an edge.
  function cameraTarget(level, x, y) {
    const spanX = level.width - W;
    const spanY = level.height - H;
    return {
      x: spanX <= 0 ? spanX / 2 : Math.max(0, Math.min(spanX, x - W / 2)),
      y: spanY <= 0 ? spanY / 2 : Math.max(0, Math.min(spanY, y - H / 2))
    };
  }

  // Snapped, not eased — for the first frame of a level, where easing in from
  // wherever the last level left the camera would read as a lurch.
  function centreOn(level, x, y) {
    const target = cameraTarget(level, x, y);
    camera.x = target.x;
    camera.y = target.y;
  }

  function followCamera(level, x, y, dt) {
    const target = cameraTarget(level, x, y);
    // Exponential ease, framerate-independent: identical feel at 60 and 120Hz.
    const k = 1 - Math.exp(-TUNING.camera.follow * Math.max(0, Math.min(0.1, dt)));
    camera.x += (target.x - camera.x) * k;
    camera.y += (target.y - camera.y) * k;
  }

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
    // A whole floorplan at full device resolution can be several times the
    // canvas budget, so the cache is capped and blitted up by the small
    // remainder. On a window-sized room the cap never binds and it stays 1:1.
    const budget = TUNING.render.maxCanvasPixels;
    cacheScale = Math.min(scale, Math.sqrt(budget / (level.width * level.height)));
    roomCache = document.createElement('canvas');
    roomCache.width = Math.max(1, Math.ceil(level.width * cacheScale));
    roomCache.height = Math.max(1, Math.ceil(level.height * cacheScale));
    const cacheCtx = roomCache.getContext('2d');
    cacheCtx.setTransform(cacheScale, 0, 0, cacheScale, 0, 0);
    paintStaticRoom(cacheCtx, level);
    roomKey = key;
  }

  // Only the visible slice of the cache is blitted, so the cost of drawing the
  // room is the size of the screen rather than the size of the map.
  function blitRoom(level) {
    const sx = Math.max(0, camera.x * cacheScale);
    const sy = Math.max(0, camera.y * cacheScale);
    const sw = Math.min(roomCache.width - sx, W * cacheScale);
    const sh = Math.min(roomCache.height - sy, H * cacheScale);
    if (sw <= 0 || sh <= 0) return;
    // sx/sy are already clamped into the cache, so dividing back out gives the
    // world position of the slice — right even when the map is smaller than
    // the window and the camera sits at a negative offset.
    ctx.drawImage(roomCache, sx, sy, sw, sh,
      sx / cacheScale, sy / cacheScale, sw / cacheScale, sh / cacheScale);
  }

  // The exit glow's geometry never changes, only its opacity, so the gradient
  // is built once instead of sixty times a second.
  let exitGlow = null;
  let exitGlowKey = '';
  function drawExit(sim, time) {
    const exit = sim.level.exit;
    const level = sim.level;
    const player = playerOf(sim);
    const cx = exit.x + exit.w / 2;
    const cy = exit.y + exit.h / 2;
    // Brighter and faster the closer you are: the way out should feel like it
    // is calling you once escaping is actually on the table.
    const near = Math.max(0, 1 - Math.hypot(player.x - cx, player.y - cy) / 170);
    const pulse = 0.5 + 0.5 * Math.sin(time * (3 + near * 4));
    const alpha = (0.26 + 0.20 * pulse + near * 0.22).toFixed(2);

    // The glow spills inward from whichever wall the way out is cut into, so a
    // corridor exit on the left reads exactly like a doorway in the bottom.
    const side = exit.side || 'bottom';
    const spill = 34;
    const box = side === 'bottom'
      ? { x: exit.x, y: exit.y - spill, w: exit.w, h: exit.h + spill }
      : side === 'left'
        ? { x: exit.x, y: exit.y, w: exit.w + spill, h: exit.h }
        : { x: exit.x - spill, y: exit.y, w: exit.w + spill, h: exit.h };
    const key = `${side}:${exit.x}:${exit.y}:${alpha}`;
    if (exitGlowKey !== key) {
      // The gradient runs from the room toward the wall, whichever way that is.
      const from = side === 'bottom' ? [box.x, box.y] : side === 'left' ? [box.x + box.w, box.y] : [box.x, box.y];
      const to = side === 'bottom' ? [box.x, box.y + box.h] : side === 'left' ? [box.x, box.y] : [box.x + box.w, box.y];
      exitGlow = ctx.createLinearGradient(from[0], from[1], to[0], to[1]);
      exitGlow.addColorStop(0, 'rgba(76,193,114,0)');
      exitGlow.addColorStop(1, `rgba(108,232,150,${alpha})`);
      exitGlowKey = key;
    }
    ctx.fillStyle = exitGlow;
    ctx.fillRect(box.x, box.y, box.w, box.h);

    // The lit threshold in the wall band itself.
    const band = side === 'bottom'
      ? { x: exit.x, y: level.height - WT, w: exit.w, h: WT }
      : side === 'left'
        ? { x: 0, y: exit.y, w: WT, h: exit.h }
        : { x: level.width - WT, y: exit.y, w: WT, h: exit.h };
    ctx.fillStyle = '#2f8f4e';
    ctx.fillRect(band.x, band.y, band.w, band.h);
    ctx.fillStyle = '#48b96a';
    if (side === 'bottom') ctx.fillRect(band.x, band.y, band.w, 4);
    else ctx.fillRect(side === 'left' ? band.x : band.x + band.w - 4, band.y, 4, band.h);

    ctx.fillStyle = '#eafff1';
    ctx.textAlign = 'center';
    ctx.font = 'bold 12px system-ui';
    // Label and arrow sit just inside the room, pointing the way out.
    const labelX = side === 'bottom' ? cx : side === 'left' ? WT + 22 : level.width - WT - 22;
    const labelY = side === 'bottom' ? level.height - 19 : cy + 4;
    ctx.fillText('EXIT', labelX, labelY);

    ctx.globalAlpha = 0.55 + 0.45 * pulse;
    ctx.beginPath();
    if (side === 'bottom') {
      ctx.moveTo(cx - 7, level.height - 44);
      ctx.lineTo(cx + 7, level.height - 44);
      ctx.lineTo(cx, level.height - 34);
    } else if (side === 'left') {
      ctx.moveTo(WT + 44, cy - 7);
      ctx.lineTo(WT + 44, cy + 7);
      ctx.lineTo(WT + 34, cy);
    } else {
      ctx.moveTo(level.width - WT - 44, cy - 7);
      ctx.lineTo(level.width - WT - 44, cy + 7);
      ctx.lineTo(level.width - WT - 34, cy);
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Items get their own contrast treatment so a richer room can never bury
  // them: a dark pool underneath, a bright disc behind, outlined labels.
  function drawItems(sim, time) {
    ctx.textAlign = 'center';
    // On a floorplan most of the loot is off screen every frame, and each one
    // costs a gradient, two outlined labels and a ring. Skip what the camera
    // cannot see — with a generous margin so nothing pops in at the edge.
    const left = camera.x - 40;
    const right = camera.x + W + 40;
    const top = camera.y - 40;
    const bottom = camera.y + H + 40;
    for (const item of sim.items) {
      if (item.taken) continue;
      if (item.x < left || item.x > right || item.y < top || item.y > bottom) continue;
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
    // A screen effect, not a world one: it hugs the view wherever the view is.
    const mx = camera.x + W / 2;
    const my = camera.y + H / 2;
    const edge = ctx.createRadialGradient(mx, my, H * 0.30, mx, my, H * 0.62);
    edge.addColorStop(0, 'rgba(255,40,40,0)');
    edge.addColorStop(1, `rgba(255,45,45,${a.toFixed(3)})`);
    ctx.fillStyle = edge;
    ctx.fillRect(camera.x, camera.y, W, H);
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
    roundRect(ctx, camera.x + WT + 4, camera.y + WT + 4, 168, 97, 5);
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
      `target ${sim.targetId || '-'}  reach ${sim.reach ? sim.reach.t.toFixed(2) : '-'}`,
      `map ${sim.level.width}x${sim.level.height}  cam ${camera.x.toFixed(0)},${camera.y.toFixed(0)}`
    ];
    lines.forEach((line, i) =>
      ctx.fillText(line, camera.x + WT + 10, camera.y + WT + 18 + i * 11));
    ctx.restore();
  }

  return {
    resize,
    get scale() { return scale; },
    invalidateRoom() { roomKey = ''; },
    setQuality(next) { if (next) { quality = next; roomKey = ''; } },

    // Called when a level starts, so the view opens already framed on the
    // player instead of sliding in from wherever the last level ended.
    snapCamera(level, x, y) { centreOn(level, x, y); },
    get camera() { return camera; },

    draw(sim, alpha, time, pops, stats, sparks = [], flash = 0, dt = 1 / 60) {
      ensureRoom(sim.level);

      // The thief is drawn between the last two simulation steps, and the
      // camera follows that same interpolated position — following the stepped
      // one would reintroduce the judder the interpolation exists to remove.
      const player = playerOf(sim);
      const px = player.prevX + (player.x - player.prevX) * alpha;
      const py = player.prevY + (player.y - player.prevY) * alpha;
      followCamera(sim.level, px, py, dt);

      ctx.save();
      // One transform for the whole world: the camera, with the impact shake
      // riding on top of it so a bang cannot knock the view off the player.
      ctx.translate(-Math.round(camera.x * scale) / scale, -Math.round(camera.y * scale) / scale);
      if (sim.shake !== 0) ctx.translate(sim.shakeX, sim.shakeY);

      blitRoom(sim.level);
      drawExit(sim, time);
      // Who is in this room decides what gets drawn here — and nothing else in
      // the renderer has to care.
      const stage = sleepStage(sim.noise);
      const config = watcherConfig(sim.level.watcher.kind);
      const kind = sim.level.watcher.kind;
      const pose = config.pose || 'bed';
      // How this person is asleep decides what gets drawn — and nothing else in
      // the renderer has to know there is more than one kind of them.
      if (pose === 'guard') {
        drawGuard(ctx, sim.level, stage, time, sim.wakeSeconds || 0, sim.startle || 0,
          sim.seen || 0, config.sees, kind);
      } else if (pose === 'desk') {
        drawSlumped(ctx, sim.level, stage, time, sim.wakeSeconds || 0, sim.startle || 0, kind);
      } else {
        drawSleeper(ctx, sim.level, stage, time, sim.wakeSeconds || 0, sim.startle || 0,
          kind, pose);
      }
      drawItems(sim, time);

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
        ctx.fillRect(camera.x, camera.y, W, H);
      }
      if (debug) drawDebug(sim, stats, { x: px, y: py });
      ctx.restore();
    }
  };
}
