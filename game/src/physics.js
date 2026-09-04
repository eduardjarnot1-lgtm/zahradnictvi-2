// One mover for every moving thing. Sub-stepped so nothing can tunnel through a
// wall: a dash, a knockback or a thrown object all resolve through solveMove.
import { TUNING } from './tuning.js';

export function overlaps(box, c) {
  return (
    box.x - box.w / 2 < c.x + c.w &&
    box.x + box.w / 2 > c.x &&
    box.y - box.h / 2 < c.y + c.h &&
    box.y + box.h / 2 > c.y
  );
}

export function blocked(x, y, w, h, colliders) {
  const box = { x, y, w, h };
  for (let i = 0; i < colliders.length; i++) {
    if (overlaps(box, colliders[i])) return true;
  }
  return false;
}

// Advance a box by (dx, dy), stopping against colliders. Returns the resolved
// position and which axes were blocked. Axis-separated inside each sub-step, so
// sliding along a wall still works.
export function solveMove(box, dx, dy, colliders, maxSubStep = TUNING.player.maxSubStep) {
  const distance = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(distance / maxSubStep));
  const stepX = dx / steps;
  const stepY = dy / steps;

  let { x, y } = box;
  let hitX = false;
  let hitY = false;

  for (let i = 0; i < steps; i++) {
    if (stepX !== 0) {
      const nx = x + stepX;
      if (blocked(nx, y, box.w, box.h, colliders)) hitX = true;
      else x = nx;
    }
    if (stepY !== 0) {
      const ny = y + stepY;
      if (blocked(x, ny, box.w, box.h, colliders)) hitY = true;
      else y = ny;
    }
  }
  return { x, y, hitX, hitY };
}

export function clampToWorld(x, y, w, h) {
  const { width, height } = TUNING.world;
  return {
    x: Math.max(w / 2, Math.min(width - w / 2, x)),
    y: Math.max(h / 2, Math.min(height - h / 2 + 10, y))
  };
}
