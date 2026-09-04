// One normalised input for the whole game, from keyboard or touch. Pointers are
// tracked by id, so a thumb on the stick and a thumb on TAKE coexist.
import { quantise } from './replay.js';
import { shapeStick } from './rules.js';

const KEY_MAP = {
  arrowleft: 'left', a: 'left',
  arrowright: 'right', d: 'right',
  arrowup: 'up', w: 'up',
  arrowdown: 'down', s: 'down',
  ' ': 'take', e: 'take', enter: 'take'
};

export function createInput({ stage, joystick, knob, takeButton, onBlur }) {
  const held = { left: false, right: false, up: false, down: false, take: false };
  // A tap can begin and end between two frames. Buffer the press so a quick TAKE
  // is never silently dropped; the buffered frame is what gets recorded too.
  let takeBuffered = false;
  const pointers = new Map(); // id -> { role: 'stick' | 'take', ... }
  let stickId = null;
  const RADIUS = 46;
  let stick = { x: 0, y: 0 };

  function clearAll() {
    for (const key of Object.keys(held)) held[key] = false;
    takeBuffered = false;
    pointers.clear();
    stickId = null;
    stick = { x: 0, y: 0 };
    joystick.style.display = 'none';
  }

  // --- keyboard -------------------------------------------------------------
  const onKeyDown = (e) => {
    const action = KEY_MAP[e.key.toLowerCase()];
    if (!action) return;
    if (action === 'take' && !held.take) takeBuffered = true;
    held[action] = true;
    if (e.key === ' ' || e.key.startsWith('Arrow')) e.preventDefault();
  };
  const onKeyUp = (e) => {
    const action = KEY_MAP[e.key.toLowerCase()];
    if (action) held[action] = false;
  };
  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', onKeyUp);

  // --- pointers -------------------------------------------------------------
  function placeJoystick(clientX, clientY) {
    const rect = stage.getBoundingClientRect();
    joystick.style.display = 'block';
    joystick.style.left = `${clientX - rect.left - 55}px`;
    joystick.style.top = `${clientY - rect.top - 55}px`;
    knob.style.left = '31px';
    knob.style.top = '31px';
  }

  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('#hud') || e.target.closest('.screen')) return;

    if (e.target.closest('#take')) {
      pointers.set(e.pointerId, { role: 'take' });
      if (!held.take) takeBuffered = true;
      held.take = true;
      takeButton.classList.add('down');
      return;
    }
    if (stickId !== null) return; // the stick already has a finger; ignore extras
    stickId = e.pointerId;
    pointers.set(e.pointerId, { role: 'stick', originX: e.clientX, originY: e.clientY });
    stick = { x: 0, y: 0 };
    placeJoystick(e.clientX, e.clientY);
  });

  addEventListener('pointermove', (e) => {
    const pointer = pointers.get(e.pointerId);
    if (!pointer || pointer.role !== 'stick') return;
    let dx = e.clientX - pointer.originX;
    let dy = e.clientY - pointer.originY;
    const length = Math.hypot(dx, dy);
    if (length > RADIUS) {
      dx = (dx / length) * RADIUS;
      dy = (dy / length) * RADIUS;
    }
    stick = { x: dx / RADIUS, y: dy / RADIUS };
    knob.style.left = `${31 + dx}px`;
    knob.style.top = `${31 + dy}px`;
  });

  function releasePointer(e) {
    const pointer = pointers.get(e.pointerId);
    if (!pointer) return;
    pointers.delete(e.pointerId);
    if (pointer.role === 'stick') {
      stickId = null;
      stick = { x: 0, y: 0 };
      joystick.style.display = 'none';
    } else {
      // only drop TAKE when no other finger is still holding it
      held.take = [...pointers.values()].some((p) => p.role === 'take');
      if (!held.take) takeButton.classList.remove('down');
    }
  }
  addEventListener('pointerup', releasePointer);
  addEventListener('pointercancel', releasePointer);

  // --- never get stuck ------------------------------------------------------
  // Alt-tab while holding a direction and the keyup never arrives.
  const bail = () => { clearAll(); if (onBlur) onBlur(); };
  addEventListener('blur', bail);
  document.addEventListener('visibilitychange', () => { if (document.hidden) bail(); });

  return {
    // Quantised here, once, so what is played is exactly what gets recorded.
    read() {
      let x = stick.x;
      let y = stick.y;
      if (held.left) x -= 1;
      if (held.right) x += 1;
      if (held.up) y -= 1;
      if (held.down) y += 1;
      // Dead zone and range restretch live in rules.js so they can be tested
      // without a browser.
      const shaped = shapeStick(x, y);
      x = shaped.x;
      y = shaped.y;
      const take = held.take || takeBuffered;
      takeBuffered = false;
      return quantise({ x, y, take });
    },
    clearAll,
    pressTake(down) {           // for the on-screen button used by pointer role
      if (down && !held.take) takeBuffered = true;
      held.take = !!down;
    },
    get pointerCount() { return pointers.size; }
  };
}
