// What the room does back.
//
// Every important thing the player does already changes a number: the meter
// moves, the money goes up, a cupboard is marked searched. This file is the
// other half of that — the part where the *room* answers, so that the player
// learns what happened by watching the school rather than by watching the HUD.
//
// Six kinds of answer, and they are deliberately few:
//
//   ring    a sound spreading out from where it was made, sized by what it cost
//   knock   the thing you walked into, rocking on its feet
//   open    the drawer, door or locker you are actually searching
//   fly     what came out of it, on its way to your hand
//   mark    a '!' over a man who has just seen you
//   scuff   a footfall, on the floor, where the foot went down
//
// All of it is presentation. Nothing here is read by the simulation, nothing
// here can change an outcome, and a recorded run replays identically whether or
// not any of it was drawn — which is the only reason it can be this free with
// the frame.
//
// The cost model is the reason for the shapes chosen. The room is painted once
// into a cache and blitted; anything that moves has to be drawn live on top of
// it, and *erasing* the cached copy underneath is not something a blitted cache
// can do cheaply. So everything here is additive: a ring is drawn where there
// was floor, a drawer is drawn sliding out of a face that is still where it
// was, and a knock redraws its own piece a pixel or two off true — at that
// amplitude the sliver of the cached original showing along one edge reads as
// the shadow of something that just moved, which is what it is.
import { drawFurniture, drawCreakZone, roundRect, ITEM_ART } from './art.js';

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (t) => t * t * (3 - 2 * t);

// How loud a thing was, as 0..1. The meter's own numbers: 2 is a sheet of
// paper underfoot, 8 is a bag, 16 is a jewel off a shelf, 30 is a television.
const loudness = (noise) => clamp01((noise - 1) / 22);

// Where the front of a piece is, from where the person interacting with it was
// standing. A bank of lockers has four faces and only one of them is the one
// you are at; without this a drawer opens into the wall half the time.
export function facing(box, from) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = from ? from.x - cx : 0;
  const dy = from ? from.y - cy : 1;
  // Which face he is actually outside of: the separation on each axis measured
  // from the box's edge rather than from its middle, so standing under a long
  // bank of lockers opens the long side and standing off its end opens the end.
  // Measuring from the middle gets the second of those wrong every time, which
  // is a drawer sliding out through six feet of cabinet.
  return Math.abs(dx) - box.w / 2 > Math.abs(dy) - box.h / 2
    ? { x: Math.sign(dx) || 1, y: 0 }
    : { x: 0, y: Math.sign(dy) || 1 };
}

export function createEffects() {
  const rings = [];
  const knocks = [];
  const opens = [];
  const flies = [];
  const marks = [];
  const scuffs = [];
  const all = [rings, knocks, opens, flies, marks, scuffs];

  // A sound, spreading. Two rings for anything worth turning round for, one for
  // a footfall on a sheet of paper.
  function ring(x, y, noise, tint) {
    const strength = loudness(noise);
    rings.push({
      x, y, t: 0, life: 0.42 + strength * 0.34, strength,
      tint: tint || (strength > 0.5 ? '255,168,110' : '206,232,244'),
      twin: strength > 0.42
    });
  }

  // Something solid, reacting to being hit. `paint` is how to draw it — the
  // furniture painter for a cabinet, the litter painter for what is on the
  // floor — so the same wobble serves both without either knowing about it.
  function knock(box, nx, ny, force, paint, at) {
    if (!box || !paint) return;
    const heft = clamp01(force);
    knocks.push({
      box, paint, t: 0,
      life: 0.26 + heft * 0.22,
      amp: 0.9 + heft * 2.4,
      // Heavy things rock slowly; a bin rattles. Read off the box, so a bank of
      // lockers and a stray backpack do not shudder at the same rate.
      rate: 58 - Math.min(26, Math.sqrt(box.w * box.h) * 0.34),
      nx: nx || 0,
      ny: ny || 0,
      // Where it was actually struck: the point on the box nearest whoever hit
      // it. The shake alone does not read in a still frame — the piece is
      // redrawn over its own cached copy, so a three-pixel offset looks like a
      // piece three pixels longer rather than one that moved — and the flash of
      // contact is what makes the hit legible the instant it happens.
      hit: at ? {
        x: Math.max(box.x, Math.min(box.x + box.w, at.x)),
        y: Math.max(box.y, Math.min(box.y + box.h, at.y))
      } : null,
      heft
    });
  }

  // The drawer, door or locker actually opening while he has his hands in it.
  // Opens over a beat, stays open while he searches, and shuts itself.
  function open(box, style, from, duration) {
    if (!box) return;
    opens.push({
      box, style: style || 'table', out: facing(box, from),
      t: 0, life: Math.max(0.5, duration) + 0.34, hold: Math.max(0.5, duration)
    });
  }

  // Shut whatever is open on this piece early — what a search ending looks like
  // when it ends in a hand coming out rather than in the clock.
  function shut(box) {
    for (const o of opens) {
      if (o.box.x === box.x && o.box.y === box.y && o.t < o.hold) o.t = o.hold;
    }
  }

  // What came out, on its way to a pocket.
  function fly(x, y, type) {
    flies.push({ x, y, art: ITEM_ART[type] || '?', t: 0, life: 0.46 });
  }

  // A word over somebody's head. Rare on purpose: this is for the moment he
  // picks you out, not for a running commentary.
  function mark(x, y, text, tint) {
    marks.push({ x, y, text, tint: tint || '#ffcf6a', t: 0, life: 0.85 });
  }

  // What a footfall leaves on each kind of floor. Grass takes a green scuff,
  // gravel and paving take dust, and a polished corridor takes a pale skid —
  // which is most of what says the outside of the school is outside.
  const SURFACE = {
    grass: '#b6d99a',
    gravel: '#ded4c2',
    paving: '#e2e0d8',
    tarmac: '#d8d6d0',
    concrete: '#ded9d0'
  };

  // A foot going down. The smallest thing here and the one that runs most
  // often, so it is one ellipse and no state.
  function scuff(x, y, share, surface) {
    scuffs.push({
      x, y, t: 0, life: 0.30, share: clamp01(share),
      tint: SURFACE[surface] || '#f6efe2'
    });
  }

  function clear() {
    for (const list of all) list.length = 0;
  }

  function update(dt) {
    for (const list of all) {
      let write = 0;
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        item.t += dt;
        if (item.t < item.life) list[write++] = item;
      }
      list.length = write;
    }
  }

  // --- drawing ---------------------------------------------------------------
  // Split in two: what belongs to the floor and the furniture goes down before
  // the people, and what belongs over the whole scene goes on after. Nothing
  // here reads the clock — every effect carries its own age — so the same frame
  // drawn twice looks the same twice.

  function drawScuff(ctx, s) {
    const k = 1 - s.t / s.life;
    ctx.globalAlpha = k * k * (0.06 + s.share * 0.10);
    ctx.fillStyle = s.tint;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y + 15, 5 + s.share * 3, 2.2, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawRing(ctx, r) {
    const draw = (delay) => {
      const t = (r.t - delay) / (r.life - delay);
      if (t < 0 || t > 1) return;
      const radius = 5 + ease(t) * (16 + r.strength * 44);
      ctx.globalAlpha = (1 - t) ** 1.5 * (0.20 + r.strength * 0.42);
      ctx.strokeStyle = `rgb(${r.tint})`;
      ctx.lineWidth = 0.8 + r.strength * 2.2 * (1 - t);
      ctx.beginPath();
      // Flattened, because the room is seen from above and in front: a circle
      // on the floor is an ellipse on the screen, and the rest of the art has
      // been foreshortening that way since the first floorplan.
      ctx.ellipse(r.x, r.y + 6, radius, radius * 0.62, 0, 0, TAU);
      ctx.stroke();
    };
    draw(0);
    if (r.twin) draw(0.13);
    ctx.globalAlpha = 1;
  }

  function drawKnock(ctx, k) {
    const share = 1 - k.t / k.life;
    const wob = Math.sin(k.t * k.rate) * k.amp * share * share;
    ctx.save();
    // Away from whatever hit it, along the axis it was hit on.
    ctx.translate(-k.nx * wob, -k.ny * wob);
    k.paint(ctx, k.box);
    ctx.restore();
  }

  // The contact itself: a short bright scrape along the struck edge, gone in a
  // fifth of a second, and a couple of flecks knocked off it.
  //
  // Drawn over the people rather than under them, which is the opposite of
  // everything else here and is not a mistake: the thief is standing *on* the
  // point he hit — that is what hitting it means — so under the figure it is a
  // flash nobody ever sees.
  function drawContact(ctx, k) {
    if (!k.hit) return;
    const flash = clamp01(1 - k.t / 0.2);
    if (flash <= 0) return;
    const along = k.nx !== 0;
    const len = (5 + k.heft * 9) * flash;
    ctx.save();
    ctx.globalAlpha = flash * (0.35 + k.heft * 0.45);
    ctx.strokeStyle = '#fff2dc';
    ctx.lineWidth = 1 + k.heft * 1.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (along) {
      ctx.moveTo(k.hit.x, k.hit.y - len);
      ctx.lineTo(k.hit.x, k.hit.y + len);
    } else {
      ctx.moveTo(k.hit.x - len, k.hit.y);
      ctx.lineTo(k.hit.x + len, k.hit.y);
    }
    ctx.stroke();
    // Flecks, thrown back the way the thief came.
    ctx.fillStyle = '#e8d5b8';
    for (let i = 0; i < 3; i++) {
      const spread = (i - 1) * 0.5;
      const d = (3 + i * 2) + (1 - flash) * (10 + k.heft * 14);
      ctx.globalAlpha = flash * 0.5;
      ctx.beginPath();
      ctx.arc(k.hit.x + (k.nx * Math.cos(spread) - k.ny * Math.sin(spread)) * d,
        k.hit.y + (k.ny * Math.cos(spread) + k.nx * Math.sin(spread)) * d,
        1.1, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  // How far open, 0 shut to 1 wide. Quick to open, held while the hands are in
  // there, and shut a little more slowly than it opened.
  function openShare(o) {
    if (o.t < 0.18) return ease(o.t / 0.18);
    if (o.t < o.hold) return 1;
    return 1 - ease(clamp01((o.t - o.hold) / (o.life - o.hold)));
  }

  // A drawer, sliding out of the front face. The dark gap behind it is what
  // makes it read as a drawer rather than as a plank appearing on the floor.
  function drawDrawer(ctx, box, out, share, tone) {
    const along = out.x !== 0;
    const span = along ? box.h : box.w;
    const w = Math.min(span - 6, 30);
    const reach = 3 + share * 7;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const px = cx + out.x * (box.w / 2 + reach * 0.5);
    const py = cy + out.y * (box.h / 2 + reach * 0.5);
    const dw = along ? reach : w;
    const dh = along ? w : reach;
    ctx.fillStyle = 'rgba(10,7,14,0.55)';
    roundRect(ctx, px - dw / 2 - out.x, py - dh / 2 - out.y, dw + 2, dh + 2, 2);
    ctx.fill();
    ctx.fillStyle = tone;
    roundRect(ctx, px - dw / 2, py - dh / 2, dw, dh, 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.20)';
    roundRect(ctx, px - dw / 2 + 1, py - dh / 2 + 1, Math.max(1, dw - 2),
      Math.max(1, dh * 0.4), 1);
    ctx.fill();
    // The handle, on the leading edge.
    ctx.fillStyle = '#cbd8d4';
    if (along) ctx.fillRect(px + out.x * (dw / 2 - 1.6) - 0.8, py - 3, 1.6, 6);
    else ctx.fillRect(px - 3, py + out.y * (dh / 2 - 1.6) - 0.8, 6, 1.6);
  }

  // A locker or cupboard door, seen from above.
  //
  // A door standing open is edge-on from up here, which is the trap: drawn
  // honestly it is a two-pixel line sticking out of a cabinet and reads as a
  // scratch on the screen. What says "open" from directly overhead is the dark
  // inside of the thing — so the cavity does the work, and the door is a solid
  // panel swung out beside it, thick enough to be a door rather than a mark.
  function drawDoor(ctx, box, out, share, face, lit) {
    const along = out.x !== 0;
    const span = Math.min(along ? box.h : box.w, 26) * 0.82;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    // The middle of the face he is standing at.
    const fx = cx + out.x * box.w * 0.5;
    const fy = cy + out.y * box.h * 0.5;
    const deep = Math.min(along ? box.w : box.h, 16) * 0.55;
    ctx.save();
    ctx.translate(fx, fy);
    // Work in the face's own frame: x out of the cabinet, y along its front.
    ctx.rotate(along ? (out.x > 0 ? 0 : Math.PI) : (out.y > 0 ? Math.PI / 2 : -Math.PI / 2));

    // The inside, cut back into the piece.
    ctx.fillStyle = 'rgba(6,12,16,0.78)';
    roundRect(ctx, -deep, -span / 2, deep, span, 1.5);
    ctx.fill();
    // A shelf in there, so it is a locker rather than a hole.
    ctx.fillStyle = 'rgba(120,150,160,0.30)';
    ctx.fillRect(-deep + 1, -span * 0.12, deep - 2, 1);

    // The door, hinged at one edge of the opening and swung out over the floor.
    ctx.translate(0, -span / 2);
    ctx.rotate(-share * 1.15);
    ctx.fillStyle = 'rgba(10,7,14,0.35)';
    roundRect(ctx, 0.6, 1.4, 3.6, span, 1.4);
    ctx.fill();
    ctx.fillStyle = face;
    roundRect(ctx, 0, 0, 3.6, span, 1.4);
    ctx.fill();
    ctx.fillStyle = lit;
    ctx.fillRect(0.7, 1.4, 1.1, span - 2.8);
    ctx.restore();
  }

  // Books, tipped out of a shelf and put back.
  function drawSpines(ctx, box, out, share) {
    const tints = ['#c25b4e', '#4f7fa8', '#d8a15c'];
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    for (let i = 0; i < 3; i++) {
      const t = (i - 1) * 7;
      const px = cx + (out.x ? out.x * (box.w / 2 + share * 4) : t);
      const py = cy + (out.y ? out.y * (box.h / 2 + share * 4) : t);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(share * (0.4 + i * 0.16) * (out.x || out.y));
      ctx.fillStyle = tints[i];
      roundRect(ctx, -2, -4, 4, 9, 1);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawOpen(ctx, o) {
    const share = openShare(o);
    if (share <= 0.01) return;
    if (o.style === 'chest') drawDoor(ctx, o.box, o.out, share, '#47646c', '#7ba3ad');
    else if (o.style === 'wardrobe') drawDoor(ctx, o.box, o.out, share, '#a9663a', '#c48450');
    else if (o.style === 'bookshelf') drawSpines(ctx, o.box, o.out, share);
    else drawDrawer(ctx, o.box, o.out, share, '#c08450');
  }

  function drawFly(ctx, f, toX, toY) {
    const t = ease(clamp01(f.t / f.life));
    const x = f.x + (toX - f.x) * t;
    const y = f.y - 10 + (toY - (f.y - 10)) * t - Math.sin(t * Math.PI) * 9;
    ctx.save();
    ctx.globalAlpha = 1 - t * 0.85;
    ctx.translate(x, y);
    ctx.scale(1 - t * 0.5, 1 - t * 0.5);
    ctx.textAlign = 'center';
    ctx.font = '19px system-ui';
    ctx.fillText(f.art, 0, 6);
    ctx.restore();
  }

  function drawMark(ctx, m) {
    const t = clamp01(m.t / m.life);
    const pop = m.t < 0.14 ? ease(m.t / 0.14) : 1;
    ctx.save();
    ctx.globalAlpha = t > 0.7 ? (1 - t) / 0.3 : 1;
    ctx.translate(m.x, m.y - ease(t) * 5);
    ctx.scale(pop * (1.25 - pop * 0.25), pop * (1.25 - pop * 0.25));
    ctx.textAlign = 'center';
    ctx.font = 'bold 15px system-ui';
    ctx.lineWidth = 3.5;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(18,10,24,0.85)';
    ctx.strokeText(m.text, 0, 0);
    ctx.fillStyle = m.tint;
    ctx.fillText(m.text, 0, 0);
    ctx.restore();
  }

  return {
    ring,
    knock,
    open,
    shut,
    fly,
    mark,
    scuff,
    clear,
    update,
    // Furniture and the floor, before the people are drawn over them.
    under(ctx) {
      for (const s of scuffs) drawScuff(ctx, s);
      for (const k of knocks) drawKnock(ctx, k);
      for (const o of opens) drawOpen(ctx, o);
      for (const r of rings) drawRing(ctx, r);
    },
    // ...and what belongs over the top of everything.
    over(ctx, toX, toY) {
      for (const k of knocks) drawContact(ctx, k);
      for (const f of flies) drawFly(ctx, f, toX, toY);
      for (const m of marks) drawMark(ctx, m);
    },
    // Convenience for the callers that want the shared painters without
    // importing the whole of art.js themselves.
    paintFurniture: drawFurniture,
    paintLitter: drawCreakZone
  };
}
