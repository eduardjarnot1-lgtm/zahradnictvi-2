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
import { hash } from './rules.js';

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
      // ...and *where* along that face. A bank of lockers is eleven tiles long
      // and the door that opens has to be the one he is standing at, not the
      // one in the middle of the run.
      at: from ? { x: from.x, y: from.y } : null,
      t: 0, life: Math.max(0.5, duration) + 0.34, hold: Math.max(0.5, duration)
    });
  }

  // Shut whatever is open on this piece — what a search ending looks like when
  // it ends in a hand coming out rather than in the clock.
  //
  // `linger` is the beat before it swings shut, and it is what tells the two
  // outcomes apart without a word being written on the screen. Finding
  // something shuts the drawer briskly, because he has what he came for.
  // Finding nothing gets a moment of looking at an empty drawer first.
  function shut(box, linger = 0) {
    for (const o of opens) {
      if (o.box.x !== box.x || o.box.y !== box.y || o.t >= o.hold) continue;
      o.hold = o.t + linger;
      o.life = o.hold + 0.34;
      // The last shove through the contents, so the pause is not a freeze: he
      // is still moving things about while he decides there is nothing there.
      o.rummageTo = o.hold;
    }
  }

  // What came out, on its way to a pocket.
  //
  // Two beats, not one. It sits in the open drawer for a fifth of a second
  // first, growing, with a glint off it — that pause is the moment the player
  // reads as *finding* something, and without it the sequence goes from a
  // rummage straight to a number going up with nothing in between.
  function fly(x, y, type) {
    flies.push({ x, y, art: ITEM_ART[type] || '?', t: 0, life: 0.62, wait: 0.20 });
  }

  // How much a hand is reaching for something right now, for whoever is drawing
  // the thief: he sees what he has found before he picks it up.
  function grabbing() {
    let most = 0;
    for (const f of flies) {
      const t = clamp01((f.t - f.wait * 0.4) / 0.34);
      most = Math.max(most, Math.sin(t * Math.PI));
    }
    return most;
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

  // How far open, 0 shut to 1 wide.
  //
  // Not a straight ramp. A door that is pulled open overshoots a little and
  // settles back — that is what a hand on a handle does to a hinge — and one
  // that is pushed shut arrives with a small bounce rather than stopping dead.
  // Those two beats are most of the difference between an animation and a
  // number being drawn.
  function openShare(o) {
    if (o.t < 0.20) {
      const t = o.t / 0.20;
      // Ease out with a touch of overshoot: open, a little past the mark, and
      // back. The two constants differ by exactly one, which is what makes this
      // land on nought at the start and one at the end rather than jumping.
      return 1 + 1.9 * (t - 1) ** 3 + 0.9 * (t - 1) ** 2;
    }
    if (o.t < o.hold) return 1;
    const t = clamp01((o.t - o.hold) / (o.life - o.hold));
    // Shutting: fast for most of it, then a small rebound off the frame.
    const k = 1 - ease(t);
    return t > 0.82 ? k - Math.sin((t - 0.82) / 0.18 * Math.PI) * 0.10 : k;
  }

  // How much his hands are moving about in there. Zero before it is open and
  // zero once it is shutting, so the contents are only disturbed while he is
  // actually rummaging.
  function stirOf(o) {
    if (o.t < 0.18 || o.t > o.hold) return 0;
    const edge = Math.min(1, (o.t - 0.18) / 0.12, (o.hold - o.t) / 0.15);
    return Math.sin(o.t * 12.5) * edge;
  }

  // What is in there.
  //
  // Drawn in the face's own frame — x back into the piece, y along its front —
  // so the same four kinds of clutter serve a locker seen from below and a desk
  // seen from the side without any of them knowing which way round they are.
  //
  // None of it is the loot. A locker full of school books that turns out to
  // hold a phone is a search worth doing; one that shows you the phone through
  // the open door before the search finishes is a search with no question in
  // it, so what you can see in here is always junk.
  function drawContents(ctx, style, deep, span, seed, stir) {
    const jig = stir * 0.6;
    if (style === 'wardrobe') {
      // Coats on a rail, swinging a little as he pushes through them.
      const coats = ['#4f6f9e', '#8a5a44', '#5c7a52', '#7a5470'];
      const n = Math.max(2, Math.min(4, Math.round(span / 7)));
      for (let i = 0; i < n; i++) {
        const y = -span / 2 + span * ((i + 0.5) / n);
        ctx.fillStyle = coats[Math.floor(hash(seed + i * 13, seed) * 4) % 4];
        roundRect(ctx, -deep + 1.2, y - 1.6 + jig * (0.6 + i * 0.3), deep - 2.4, 3.2, 1.2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(190,200,210,0.45)';        // the rail they hang off
      ctx.fillRect(-deep + 1, -span / 2 + 0.6, 0.9, span - 1.2);
      return;
    }
    if (style === 'chest') {
      // A locker: books stacked on the shelf, a bag shoved in below, a coat
      // hook. Small, and all of it in silhouette — you are looking into a dark
      // metal box from directly above.
      const books = ['#c25b4e', '#4f7fa8', '#d8a15c'];
      for (let i = 0; i < 3; i++) {
        const y = -span * 0.34 + i * 2.6;
        ctx.fillStyle = books[Math.floor(hash(seed + i * 7, seed + 3) * 3) % 3];
        ctx.fillRect(-deep + 1.4 + jig * 0.5, y, deep * 0.55, 2);
      }
      ctx.fillStyle = '#3f5a8a';                        // the bag
      roundRect(ctx, -deep + 1.2, span * 0.10 + jig, deep - 2.6, span * 0.30, 1.6);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(-deep + 2, span * 0.14 + jig, deep - 4, 1);
      return;
    }
    if (style === 'bookshelf') {
      // A shelf has no door and no drawer, so what says "somebody is going
      // through this" is the hole. Drawn dark and drawn over the shelf's own
      // books — everything here is painted on top of a room that is already
      // there, so a gap has to be added rather than taken away.
      ctx.fillStyle = 'rgba(8,10,14,0.72)';
      roundRect(ctx, -deep + 0.6, -span * 0.16 + jig * 0.5, deep * 0.72, span * 0.30, 1);
      ctx.fill();
      // ...and the books either side of it, leaning into the space.
      ctx.fillStyle = 'rgba(20,14,10,0.35)';
      ctx.fillRect(-deep + 0.6, -span * 0.20, deep * 0.72, 1);
      ctx.fillRect(-deep + 0.6, span * 0.14 + jig * 0.5, deep * 0.72, 1);
      return;
    }
    // A desk drawer: paper, a couple of pens, and whatever else lives in there.
    ctx.fillStyle = 'rgba(240,236,226,0.9)';
    roundRect(ctx, -deep + 1.4, -span * 0.30 + jig * 0.4, deep * 0.7, span * 0.42, 0.8);
    ctx.fill();
    ctx.fillStyle = 'rgba(120,126,138,0.45)';
    ctx.fillRect(-deep + 2.2, -span * 0.22, deep * 0.5, 0.7);
    const inks = ['#d8b24a', '#4f7fbf', '#c4574f'];
    for (let i = 0; i < 2; i++) {
      ctx.fillStyle = inks[Math.floor(hash(seed + i * 17, seed + 9) * 3) % 3];
      ctx.fillRect(-deep + 1.6, span * 0.18 + i * 2 + jig * 0.8, deep * 0.66, 1);
    }
  }

  // Everything an opening piece needs, in the face's own frame: the mouth of
  // it, its contents, and whatever is between them and the room.
  function inFace(ctx, box, out, run, at) {
    const along = out.x !== 0;
    const span = Math.min(along ? box.h : box.w, 30) * 0.84;
    const deep = Math.min(along ? box.w : box.h, 18) * 0.60;
    // How far along the face to put it. The middle of it, unless whoever opened
    // it is standing somewhere else along a long piece — a bank of lockers is
    // nine tiles wide and the door that swings has to be the one in front of
    // him. Held far enough in that the whole mouth stays inside the piece's own
    // footprint, so the end of a run opens its end locker rather than a hole in
    // the wall beside it.
    let slide = 0;
    if (at) {
      const span2 = along ? box.h : box.w;
      const mid = (along ? box.y : box.x) + span2 / 2;
      const reach = Math.max(0, span2 / 2 - span / 2);
      slide = Math.max(-reach, Math.min(reach, (along ? at.y : at.x) - mid));
    }
    ctx.save();
    ctx.translate(box.x + box.w / 2 + out.x * box.w * 0.5 + (along ? 0 : slide),
      box.y + box.h / 2 + out.y * box.h * 0.5 + (along ? slide : 0));
    ctx.rotate(along ? (out.x > 0 ? 0 : Math.PI) : (out.y > 0 ? Math.PI / 2 : -Math.PI / 2));
    run(span, deep);
    ctx.restore();
  }

  // A drawer, pulled out of the front face with its contents riding in it.
  function drawDrawer(ctx, o, share, stir, tone) {
    inFace(ctx, o.box, o.out, (span, deep) => {
      const out = 2 + share * 8;
      // The hole it came out of, cut back *into* the desk.
      //
      // This is the part that has to carry the read, because the drawer itself
      // slides towards the person who opened it and he is standing in front of
      // it — a drawer drawn only outside the front face is a drawer behind the
      // thief. The recess is inside the piece's own footprint, so it is visible
      // over his shoulder for the whole search.
      ctx.fillStyle = 'rgba(6,8,12,0.68)';
      roundRect(ctx, -deep * 0.95, -span / 2, deep * 0.95, span, 1.5);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,240,214,0.10)';
      ctx.fillRect(-deep * 0.95, -span / 2, 1, span);
      ctx.save();
      ctx.translate(out, 0);
      // The shadow it casts back over the gap.
      ctx.fillStyle = 'rgba(10,7,14,0.5)';
      roundRect(ctx, -out - 1, -span / 2 - 0.6, out + 2, span + 1.2, 1.5);
      ctx.fill();
      // The drawer box. Outlined, because it is drawn over a desk of very
      // nearly its own colour and without the line it reads as a stain on the
      // desk rather than as a box that has come out of it.
      ctx.fillStyle = tone;
      roundRect(ctx, -deep, -span / 2, deep, span, 1.8);
      ctx.fill();
      ctx.strokeStyle = 'rgba(24,14,6,0.75)';
      ctx.lineWidth = 1;
      roundRect(ctx, -deep, -span / 2, deep, span, 1.8);
      ctx.stroke();
      ctx.fillStyle = 'rgba(20,12,6,0.55)';
      roundRect(ctx, -deep + 1.2, -span / 2 + 1.2, deep - 2.4, span - 2.4, 1.2);
      ctx.fill();
      drawContents(ctx, o.style, deep - 1, span - 2, o.box.x + o.box.y, stir);
      // The face of it, and the handle across that.
      ctx.fillStyle = tone;
      roundRect(ctx, -1.6, -span / 2, 2.4, span, 1);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(-1.2, -span / 2 + 0.8, 1, span - 1.6);
      ctx.fillStyle = '#cbd8d4';
      ctx.fillRect(-0.4, -3, 1.4, 6);
      ctx.restore();
    }, o.at);
  }

  // A locker or cupboard door, seen from above.
  //
  // A door standing open is edge-on from up here, which is the trap: drawn
  // honestly it is a two-pixel line sticking out of a cabinet and reads as a
  // scratch on the screen. What says "open" from directly overhead is the dark
  // inside of the thing — so the cavity and what is in it do the work, and the
  // door is a solid panel swung out beside them.
  function drawDoor(ctx, o, share, stir, face, lit, twin) {
    inFace(ctx, o.box, o.out, (span, deep) => {
      // The inside, cut back into the piece.
      ctx.fillStyle = 'rgba(6,12,16,0.80)';
      roundRect(ctx, -deep, -span / 2, deep, span, 1.5);
      ctx.fill();
      // What is in there, clipped to the mouth so nothing spills onto the floor
      // as the door swings.
      ctx.save();
      ctx.beginPath();
      ctx.rect(-deep, -span / 2, deep, span);
      ctx.clip();
      drawContents(ctx, o.style, deep, span, o.box.x + o.box.y, stir);
      ctx.restore();
      // A shelf across it, so it is a locker rather than a hole in the world.
      ctx.fillStyle = 'rgba(150,175,185,0.22)';
      ctx.fillRect(-deep + 1, -span * 0.06, deep - 2, 0.8);

      // The door — or both of them, for a cupboard that opens down the middle.
      const leaf = (hinge, sign) => {
        ctx.save();
        ctx.translate(0, hinge);
        ctx.rotate(-sign * share * 1.15);
        ctx.fillStyle = 'rgba(10,7,14,0.35)';
        roundRect(ctx, 0.6, sign * 1.4, 3.6, sign * (twin ? span / 2 : span), 1.4);
        ctx.fill();
        ctx.fillStyle = face;
        roundRect(ctx, 0, 0, 3.6, sign * (twin ? span / 2 : span), 1.4);
        ctx.fill();
        ctx.fillStyle = lit;
        ctx.fillRect(0.7, sign * 1.4, 1.1, sign * ((twin ? span / 2 : span) - 2.8));
        ctx.restore();
      };
      leaf(-span / 2, 1);
      if (twin) leaf(span / 2, -1);
    }, o.at);
  }

  // A shelf: no door to open, so the hand goes in and the books come out. The
  // gap left behind is drawn by `drawContents`; this is what was taken out of
  // it, tipped forward and put back.
  function drawSpines(ctx, o, share, stir) {
    inFace(ctx, o.box, o.out, (span, deep) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(-deep, -span / 2 - 1, deep + 8, span + 2);
      ctx.clip();
      drawContents(ctx, 'bookshelf', deep, span, o.box.x + o.box.y, stir);
      ctx.restore();
      const tints = ['#c25b4e', '#4f7fa8', '#d8a15c'];
      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.translate(share * (3 + i * 1.4), -span * 0.16 + i * 3.4);
        ctx.rotate(share * (0.22 + i * 0.14) + stir * 0.08);
        ctx.fillStyle = 'rgba(10,7,14,0.30)';
        roundRect(ctx, -deep * 0.5 + 0.8, -1.1, deep * 0.6, 2.6, 0.8);
        ctx.fill();
        ctx.fillStyle = tints[i];
        roundRect(ctx, -deep * 0.5, -1.4, deep * 0.6, 2.6, 0.8);
        ctx.fill();
        ctx.restore();
      }
    }, o.at);
  }

  function drawOpen(ctx, o) {
    const share = openShare(o);
    if (share <= 0.005) return;
    const stir = stirOf(o);
    if (o.style === 'chest') drawDoor(ctx, o, share, stir, '#47646c', '#7ba3ad', false);
    else if (o.style === 'wardrobe') drawDoor(ctx, o, share, stir, '#a9663a', '#c48450', true);
    else if (o.style === 'bookshelf') drawSpines(ctx, o, share, stir);
    else drawDrawer(ctx, o, share, stir, '#c08450');
  }

  function drawFly(ctx, f, toX, toY) {
    // The discovery: still in the drawer, coming up out of it, catching the
    // light. Then the trip to his hand.
    const held = f.t < f.wait;
    const rise = clamp01(f.t / f.wait);
    const t = held ? 0 : ease(clamp01((f.t - f.wait) / (f.life - f.wait)));
    const from = { x: f.x, y: f.y - 4 - rise * 7 };
    const x = from.x + (toX - from.x) * t;
    const y = from.y + (toY - from.y) * t - Math.sin(t * Math.PI) * 9;
    ctx.save();
    ctx.globalAlpha = held ? rise : 1 - t * 0.85;
    ctx.translate(x, y);
    const size = held ? 0.5 + ease(rise) * 0.5 : 1 - t * 0.5;
    ctx.scale(size, size);
    if (held) {
      // A four-point glint over it, opening as it comes up. Two strokes, and
      // it is the whole of what says "worth something" — no particles.
      const arm = 5 + ease(rise) * 7;
      ctx.globalAlpha = Math.sin(rise * Math.PI) * 0.75;
      ctx.strokeStyle = '#fff3c8';
      ctx.lineWidth = 1.4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-arm, 0); ctx.lineTo(arm, 0);
      ctx.moveTo(0, -arm); ctx.lineTo(0, arm);
      ctx.stroke();
      ctx.globalAlpha = rise;
    }
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
    grabbing,
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
