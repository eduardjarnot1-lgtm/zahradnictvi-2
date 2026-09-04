// Draws a simulation snapshot. Knows nothing about rules — it reads state and
// paints it, interpolating between the last two fixed steps so 60Hz sim motion
// stays smooth on any refresh rate.
import { TUNING } from './tuning.js';
import { sleepStage, SLEEP_ASLEEP, SLEEP_STIRRING, SLEEP_ALMOST, SLEEP_AWAKE } from './rules.js';
import { playerOf } from './sim.js';

const { width: W, height: H, wallThickness: WT, hudStrip: HUD_H } = TUNING.world;

// Art lives here, not in the item table: the simulation never knows what an
// item looks like.
const ITEM_ART = {
  phone: '📱', watch: '⌚', cash: '💵', jewel: '💎', laptop: '💻', tv: '📺'
};

const COLLIDER_FILL = {
  furniture: { shadow: '#00000033', base: '#8d6a4b', top: '#a37e5c' }
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function createRenderer(canvas, options = {}) {
  const ctx = canvas.getContext('2d');
  const debug = !!options.debug;
  let scale = 1;

  function resize(stage) {
    const viewHeight = H + HUD_H;
    const s = Math.min(innerWidth / W, innerHeight / viewHeight);
    const cssWidth = Math.round(W * s);
    const cssHeight = Math.round(viewHeight * s);
    stage.style.width = `${cssWidth}px`;
    stage.style.height = `${cssHeight}px`;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    scale = (cssWidth * dpr) / W;
    ctx.setTransform(scale, 0, 0, scale, 0, HUD_H * scale);
  }

  function drawRoom(sim) {
    ctx.fillStyle = '#3b2f2a';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#6b5340';
    ctx.fillRect(WT, WT, W - WT * 2, H - WT * 2);
    ctx.strokeStyle = '#00000018';
    ctx.lineWidth = 2;
    for (let y = WT + 40; y < H - WT; y += 40) {
      ctx.beginPath();
      ctx.moveTo(WT, y);
      ctx.lineTo(W - WT, y);
      ctx.stroke();
    }
    // Tagged: furniture is whatever says it is furniture.
    for (const c of sim.level.colliders) {
      const paint = COLLIDER_FILL[c.type];
      if (!paint) continue;
      ctx.fillStyle = paint.shadow;
      roundRect(ctx, c.x + 3, c.y + 5, c.w, c.h, 6);
      ctx.fill();
      ctx.fillStyle = paint.base;
      roundRect(ctx, c.x, c.y, c.w, c.h, 6);
      ctx.fill();
      ctx.fillStyle = paint.top;
      roundRect(ctx, c.x + 4, c.y + 4, c.w - 8, c.h - 8, 4);
      ctx.fill();
    }
  }

  function drawBed(sim, time) {
    const bed = sim.level.bed;
    const stage = sleepStage(sim.noise);
    ctx.fillStyle = '#00000038';
    roundRect(ctx, bed.x + 3, bed.y + 6, bed.w, bed.h, 8);
    ctx.fill();
    ctx.fillStyle = '#efe6da';
    roundRect(ctx, bed.x, bed.y, bed.w, bed.h, 8);
    ctx.fill();
    ctx.fillStyle = '#5a7fd6';
    roundRect(ctx, bed.x, bed.y + bed.h * 0.42, bed.w, bed.h * 0.58, 8);
    ctx.fill();

    const hx = sim.level.sleeper.x;
    const hy = sim.level.sleeper.y;
    ctx.fillStyle = '#fff';
    roundRect(ctx, hx - 26, hy - 15, 52, 30, 8);
    ctx.fill();
    ctx.fillStyle = '#f0c49b';
    ctx.beginPath();
    ctx.arc(hx, hy, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3b2b22';
    ctx.beginPath();
    ctx.arc(hx, hy - 7, 14, Math.PI, Math.PI * 2);
    ctx.fill();

    const ey = hy + 1;
    ctx.strokeStyle = '#3b2b22';
    ctx.lineWidth = 1.7;
    ctx.lineCap = 'round';
    ctx.fillStyle = '#3b2b22';
    if (stage === SLEEP_ASLEEP) {
      ctx.beginPath();
      ctx.moveTo(hx - 9, ey - 1);
      ctx.quadraticCurveTo(hx - 6, ey + 3, hx - 3, ey - 1);
      ctx.moveTo(hx + 3, ey - 1);
      ctx.quadraticCurveTo(hx + 6, ey + 3, hx + 9, ey - 1);
      ctx.stroke();
    } else if (stage === SLEEP_STIRRING) {
      ctx.beginPath();
      ctx.moveTo(hx - 9, ey);
      ctx.lineTo(hx - 4, ey);
      ctx.moveTo(hx + 4, ey);
      ctx.lineTo(hx + 9, ey);
      ctx.stroke();
    } else {
      const r = stage === SLEEP_ALMOST ? 2.2 : 3.2;
      ctx.beginPath();
      ctx.arc(hx - 6, ey, r, 0, Math.PI * 2);
      ctx.arc(hx + 6, ey, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    if (stage === SLEEP_AWAKE) {
      ctx.arc(hx, ey + 9, 3.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.moveTo(hx - 3.5, ey + 9);
      ctx.lineTo(hx + 3.5, ey + 9);
      ctx.stroke();
    }

    if (stage === SLEEP_ASLEEP) {
      const f = (time * 0.9) % 1;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffffcc';
      ctx.globalAlpha = 1 - f;
      ctx.font = 'bold 13px system-ui';
      ctx.fillText('z', hx + 20, hy - 12 - f * 16);
      ctx.font = 'bold 17px system-ui';
      ctx.fillText('Z', hx + 28, hy - 24 - f * 20);
      ctx.globalAlpha = 1;
    } else {
      ctx.textAlign = 'center';
      ctx.font = 'bold 20px system-ui';
      ctx.fillStyle = stage === SLEEP_AWAKE ? '#ff5252' : stage === SLEEP_ALMOST ? '#ffb020' : '#ffe08a';
      ctx.fillText(stage === SLEEP_AWAKE ? '!!' : stage === SLEEP_ALMOST ? '!' : '?', hx, sim.level.bed.y - 4);
    }
  }

  function drawExit(sim, time) {
    const exit = sim.level.exit;
    const pulse = 0.5 + 0.5 * Math.sin(time * 4);
    ctx.fillStyle = `rgba(76,193,114,${0.25 + 0.2 * pulse})`;
    ctx.fillRect(exit.x, exit.y - 26, exit.w, exit.h + 26);
    ctx.fillStyle = '#2f8f4e';
    ctx.fillRect(exit.x, H - WT, exit.w, WT);
    ctx.fillStyle = '#dcffe6';
    ctx.textAlign = 'center';
    ctx.font = 'bold 12px system-ui';
    ctx.fillText('EXIT', exit.x + exit.w / 2, H - 20);
    ctx.beginPath();
    ctx.moveTo(exit.x + exit.w / 2 - 7, H - 44);
    ctx.lineTo(exit.x + exit.w / 2 + 7, H - 44);
    ctx.lineTo(exit.x + exit.w / 2, H - 34);
    ctx.closePath();
    ctx.fill();
  }

  function drawItems(sim, time, pops) {
    ctx.textAlign = 'center';
    for (const item of sim.items) {
      if (item.taken) continue;
      const bob = Math.sin(time * 2.6 + item.x) * 1.5;
      const isTarget = sim.targetId === item.id;

      if (isTarget) {
        // What TAKE would consume, and how far the reach is.
        const ring = 0.5 + 0.5 * Math.sin(time * 6);
        ctx.strokeStyle = `rgba(255,224,122,${0.55 + 0.35 * ring})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(item.x, item.y + 2, 19 + ring * 2, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = '#00000030';
      ctx.beginPath();
      ctx.ellipse(item.x, item.y + 15, 12, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '23px system-ui';
      ctx.fillText(ITEM_ART[item.type] || '?', item.x, item.y + 8 + bob);
      ctx.font = 'bold 10px system-ui';
      ctx.fillStyle = isTarget ? '#fff3c4' : '#ffe07a';
      ctx.fillText(`$${item.value}`, item.x, item.y - 15 + bob);
      ctx.fillStyle = '#ff9c6e';
      ctx.fillText(`+${item.noise}`, item.x, item.y + 24 + bob);
    }

    for (const pop of pops) {
      ctx.globalAlpha = Math.max(0, pop.life);
      ctx.fillStyle = '#ffd34d';
      ctx.font = 'bold 14px system-ui';
      ctx.fillText(`+$${pop.value}`, pop.x, pop.y - 20 * (1 - pop.life));
      ctx.globalAlpha = 1;
    }
  }

  function drawPlayer(sim, alpha) {
    const player = playerOf(sim);
    const x = player.prevX + (player.x - player.prevX) * alpha;
    const y = player.prevY + (player.y - player.prevY) * alpha;
    ctx.fillStyle = '#00000038';
    ctx.beginPath();
    ctx.ellipse(x, y + 13, 11, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2b2f45';
    roundRect(ctx, x - 10, y - 6, 20, 20, 6);
    ctx.fill();
    ctx.fillStyle = '#f0c49b';
    ctx.beginPath();
    ctx.arc(x, y - 11, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a1d2b';
    ctx.beginPath();
    ctx.arc(x, y - 13, 8, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x - 3, y - 12, 1.6, 0, Math.PI * 2);
    ctx.arc(x + 3, y - 12, 1.6, 0, Math.PI * 2);
    ctx.fill();
    return { x, y };
  }

  function drawDanger(sim, time) {
    if (sim.noise <= TUNING.noise.almostAt) return;
    const span = TUNING.noise.max - TUNING.noise.almostAt;
    const a = ((sim.noise - TUNING.noise.almostAt) / span) * (0.25 + 0.15 * Math.sin(time * 8));
    ctx.fillStyle = `rgba(255,40,40,${a.toFixed(3)})`;
    ctx.fillRect(0, 0, W, WT + 6);
    ctx.fillRect(0, H - WT - 6, W, WT + 6);
    ctx.fillRect(0, 0, WT + 6, H);
    ctx.fillRect(W - WT - 6, 0, WT + 6, H);
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
      ctx.arc(item.x, item.y, TUNING.pickup.radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    const player = playerOf(sim);
    ctx.strokeStyle = '#ff4dff';
    ctx.strokeRect(player.x - player.w / 2, player.y - player.h / 2, player.w, player.h);

    ctx.fillStyle = '#000000aa';
    ctx.fillRect(WT + 4, WT + 4, 150, 74);
    ctx.fillStyle = '#7CFFB2';
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'left';
    const lines = [
      `fps ${stats.fps.toFixed(0)}  steps ${stats.steps}`,
      `frame ${sim.frame}  seed ${sim.seed}`,
      `pos ${player.x.toFixed(1)}, ${player.y.toFixed(1)}`,
      `draw ${playerPos.x.toFixed(1)}, ${playerPos.y.toFixed(1)}`,
      `noise ${sim.noise}  $${sim.money}`,
      `target ${sim.targetId || '-'}`
    ];
    lines.forEach((line, i) => ctx.fillText(line, WT + 10, WT + 18 + i * 11));
    ctx.restore();
  }

  return {
    resize,
    get scale() { return scale; },
    draw(sim, alpha, time, pops, stats) {
      ctx.save();
      if (sim.shake > 0.2) ctx.translate(sim.shakeX, sim.shakeY);
      drawRoom(sim);
      drawExit(sim, time);
      drawBed(sim, time);
      drawItems(sim, time, pops);
      const playerPos = drawPlayer(sim, alpha);
      drawDanger(sim, time);
      if (debug) drawDebug(sim, stats, playerPos);
      ctx.restore();
    }
  };
}
