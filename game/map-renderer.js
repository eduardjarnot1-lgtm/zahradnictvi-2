/* ------------------------------------------------------------------ *
 * "Don't Wake Him" — top-down map renderer.
 * Draws a compiled map (see tools/build-maps.mjs) onto a 2D canvas:
 * floors by material, walls with a raised edge, windows, doors with a
 * swing arc, and every prop — tables, chairs, beds, lamps, curtains...
 * ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  const C = {
    void: '#1b1f29', voidGrid: '#222736',
    wall: '#525a6b', wallTop: '#6d768a', wallLine: '#2c313d', wallShadow: 'rgba(0,0,0,.30)',
    hi: '#ffd23f', hiGlow: 'rgba(255,210,63,.35)',
    glass: 'rgba(150,205,235,.55)', glassLine: '#8fc7e6',
    floors: {
      concrete: ['#b8bcc4', '#b4b8c0'], carpet: ['#8e9c8b', '#8a9887'],
      wood: ['#c08a4e', '#bb8549'], tile: ['#d8d3c6', '#d4cfc1'],
      marble: ['#c6c9d1', '#c2c5ce'], grass: ['#7fae63', '#7baa5f'],
      gravel: ['#a8a399', '#a49f95'], deck: ['#c39a68', '#bf9663'],
      door: ['#b8bcc4', '#b4b8c0'], doorway: ['#b8bcc4', '#b4b8c0'],
      stairs: ['#b0b5be', '#acb1ba'], elevator: ['#9aa2ae', '#969ea9'],
      exit: ['#a8c9a0', '#a4c59c'], vent: ['#8e949e', '#8a9099'],
      locked: ['#b8bcc4', '#b4b8c0'],
    },
    wood: '#a9793f', woodDark: '#7d5628', woodLight: '#c99a5f',
    cloth: '#7f8ea3', clothDark: '#5f6d80', clothWarm: '#b8695c',
    metal: '#b9c0cb', metalDark: '#868f9d',
    white: '#f2f4f7', paper: '#fbfbf6', dark: '#39404d',
    green: '#4f8f52', greenDark: '#356136',
    gold: '#e0b445', silver: '#cfd4dc', clay: '#c8794a', jade: '#5f9c8b',
    glow: 'rgba(255,226,150,.45)',
  };

  /* --------------------------- tiny 2D helpers --------------------------- */
  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function box(ctx, x, y, w, h, fill, stroke, r = 2) {
    rr(ctx, x, y, w, h, r);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(1, w * 0.03); ctx.stroke(); }
  }
  function shadow(ctx, x, y, w, h, r = 3, a = 0.22) {
    ctx.fillStyle = `rgba(0,0,0,${a})`;
    rr(ctx, x + w * 0.05 + 1.5, y + h * 0.06 + 1.5, w, h, r);
    ctx.fill();
  }
  function circle(ctx, cx, cy, rad, fill, stroke) {
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(1, rad * 0.16); ctx.stroke(); }
  }
  function line(ctx, x1, y1, x2, y2, col, w = 1) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke();
  }
  function label(ctx, text, x, y, size, col = '#2a2f3a', align = 'center') {
    ctx.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.fillStyle = col; ctx.fillText(text, x, y);
  }

  /* ------------------------------ props ------------------------------ */
  /* Every prop gets (ctx, x, y, w, h, prop, T) in *pixels*. */
  const P = {};

  /* --- surfaces --- */
  P.table = (c, x, y, w, h) => { shadow(c, x, y, w, h); box(c, x, y, w, h, C.wood, C.woodDark, 3); box(c, x + w * .08, y + h * .1, w * .84, h * .8, C.woodLight, null, 2); };
  P.desk = P.table;
  P['coffee-table'] = (c, x, y, w, h) => { shadow(c, x, y, w, h); box(c, x, y, w, h, C.woodLight, C.woodDark, 4); box(c, x + w * .12, y + h * .15, w * .76, h * .7, 'rgba(255,255,255,.25)', null, 3); };
  P.nightstand = (c, x, y, w, h) => { shadow(c, x, y, w, h); box(c, x, y, w, h, C.wood, C.woodDark, 2); line(c, x + w * .15, y + h * .45, x + w * .85, y + h * .45, C.woodDark, 1); circle(c, x + w / 2, y + h * .72, w * .07, C.metal); };
  P['desk-l'] = (c, x, y, w, h) => {
    shadow(c, x, y, w, h * .55); shadow(c, x, y, w * .42, h);
    box(c, x, y, w, h * .55, C.wood, C.woodDark, 3);
    box(c, x, y, w * .42, h, C.wood, C.woodDark, 3);
    box(c, x + w * .04, y + h * .06, w * .92, h * .42, C.woodLight, null, 2);
  };
  P['dining-table'] = (c, x, y, w, h) => { shadow(c, x, y, w, h); box(c, x, y, w, h, C.woodLight, C.woodDark, 3); box(c, x + w * .06, y + h * .08, w * .88, h * .84, '#f6ede0', null, 2); };
  P['table-round'] = (c, x, y, w, h) => { const r = Math.min(w, h) / 2; shadow(c, x, y, w, h, r); circle(c, x + w / 2, y + h / 2, r, C.white, C.woodDark); circle(c, x + w / 2, y + h / 2, r * .72, '#e8e9ec'); };
  P['conference-table'] = (c, x, y, w, h) => { shadow(c, x, y, w, h, 6); box(c, x, y, w, h, C.white, '#9aa0ab', 6); box(c, x + w * .05, y + h * .12, w * .9, h * .76, '#e9ebef', null, 5); };
  P.counter = (c, x, y, w, h, pr) => {
    shadow(c, x, y, w, h); box(c, x, y, w, h, C.woodDark, '#4e3618', 2);
    box(c, x, y, w, h * .38, C.woodLight, null, 2);
    for (let i = 1; i < Math.round(w / (h * 1.6)); i++) line(c, x + i * (w / Math.round(w / (h * 1.6))), y + h * .4, x + i * (w / Math.round(w / (h * 1.6))), y + h, '#4e3618', 1);
    if (pr && pr.label) label(c, pr.label, x + w / 2, y + h * .19, Math.min(h * .34, 9), '#3a2a12');
  };
  P.island = P.counter;
  P.bar = P.counter;

  /* --- seating --- */
  const chairBody = (c, x, y, w, h, d, fill, back) => {
    const t = Math.max(2, Math.min(w, h) * .26);      // backrest thickness
    const g = Math.min(w, h) * .12;                    // gap so it reads apart from the table
    let sx = x + g, sy = y + g, sw = w - g * 2, sh = h - g * 2;
    shadow(c, sx, sy, sw, sh, 3, .2);
    box(c, sx, sy, sw, sh, fill, back, 3);             // seat
    box(c, sx + sw * .18, sy + sh * .18, sw * .64, sh * .64, 'rgba(255,255,255,.22)', null, 2);
    if (d === 's') box(c, x, y, w, t, back, 'rgba(0,0,0,.3)', 2);
    else if (d === 'n') box(c, x, y + h - t, w, t, back, 'rgba(0,0,0,.3)', 2);
    else if (d === 'e') box(c, x, y, t, h, back, 'rgba(0,0,0,.3)', 2);
    else box(c, x + w - t, y, t, h, back, 'rgba(0,0,0,.3)', 2);
  };
  P.chair = (c, x, y, w, h, pr) => chairBody(c, x, y, w, h, pr.d || 's', '#d8a869', '#7d5628');
  P.stool = (c, x, y, w, h) => { shadow(c, x, y, w, h, w / 2); circle(c, x + w / 2, y + h / 2, Math.min(w, h) / 2, C.woodLight, C.woodDark); };
  P['office-chair'] = (c, x, y, w, h, pr) => {
    const d = pr.d || 'n'; shadow(c, x, y, w, h, 3, .2);
    circle(c, x + w / 2, y + h / 2, Math.min(w, h) * .46, '#5c6472', '#3d4450');
    const t = Math.min(w, h) * .3;
    if (d === 'n') box(c, x + w * .1, y + h - t, w * .8, t, '#41485a', null, 2);
    else if (d === 's') box(c, x + w * .1, y, w * .8, t, '#41485a', null, 2);
    else if (d === 'e') box(c, x, y + h * .1, t, h * .8, '#41485a', null, 2);
    else box(c, x + w - t, y + h * .1, t, h * .8, '#41485a', null, 2);
  };
  P.armchair = (c, x, y, w, h, pr) => {
    const d = pr.d || 's'; shadow(c, x, y, w, h, 4);
    box(c, x, y, w, h, C.clothDark, 'rgba(0,0,0,.28)', 5);
    const t = Math.min(w, h) * .26;
    // seat cushion inset away from the back
    let sx = x + t * .6, sy = y + t * .6, sw = w - t * 1.2, sh = h - t * 1.2;
    if (d === 's') { sy = y + t; sh = h - t * 1.4; }
    if (d === 'n') { sh = h - t * 1.4; }
    box(c, sx, sy, sw, sh, C.cloth, 'rgba(0,0,0,.15)', 4);
  };
  P.sofa = (c, x, y, w, h, pr) => {
    const d = pr.d || 's'; shadow(c, x, y, w, h, 4);
    box(c, x, y, w, h, C.clothDark, null, 5);
    const t = Math.min(w, h) * .24;
    let sx = x + t * .5, sy = y + t * .5, sw = w - t, sh = h - t;
    if (d === 's') { sy = y + t; sh = h - t * 1.4; }
    if (d === 'n') { sh = h - t * 1.4; }
    if (d === 'e') { sx = x + t; sw = w - t * 1.4; }
    if (d === 'w') { sw = w - t * 1.4; }
    box(c, sx, sy, sw, sh, C.cloth, 'rgba(0,0,0,.15)', 4);
    const n = (d === 'e' || d === 'w') ? Math.round(sh / (t * 2)) : Math.round(sw / (t * 2));
    for (let i = 1; i < n; i++) {
      if (d === 'e' || d === 'w') line(c, sx, sy + (sh / n) * i, sx + sw, sy + (sh / n) * i, 'rgba(0,0,0,.18)', 1);
      else line(c, sx + (sw / n) * i, sy, sx + (sw / n) * i, sy + sh, 'rgba(0,0,0,.18)', 1);
    }
  };
  P.bench = (c, x, y, w, h, pr) => {
    shadow(c, x, y, w, h, 2); box(c, x, y, w, h, C.woodLight, C.woodDark, 2);
    const n = Math.max(2, Math.round(((pr.d === 'v') ? h : w) / 6));
    for (let i = 1; i < n; i++) {
      if (pr.d === 'v') line(c, x, y + (h / n) * i, x + w, y + (h / n) * i, C.woodDark, 1);
      else line(c, x + (w / n) * i, y, x + (w / n) * i, y + h, C.woodDark, 1);
    }
  };
  P.pew = P.bench;

  /* --- beds --- */
  P.bed = (c, x, y, w, h) => {
    shadow(c, x, y, w, h, 3);
    box(c, x, y, w, h, C.wood, C.woodDark, 3);
    box(c, x + w * .06, y + h * .05, w * .88, h * .9, '#eceff4', '#c9ced8', 3);       // duvet
    box(c, x + w * .1, y + h * .06, w * .8, h * .18, C.white, '#cbd1da', 3);          // pillow
    box(c, x + w * .06, y + h * .42, w * .88, h * .53, '#cfd8e6', 'rgba(0,0,0,.08)', 3);
    line(c, x + w * .06, y + h * .42, x + w * .94, y + h * .42, '#b9c2d1', 1.2);
  };
  P['bed-single'] = P.bed;
  P['bed-double'] = P.bed;
  P.bunk = (c, x, y, w, h) => { P.bed(c, x, y, w, h, {}); box(c, x, y, w, h, 'rgba(0,0,0,.10)', C.woodDark, 3); label(c, '2', x + w - 5, y + h - 6, 8, '#5a6270'); };
  P.crib = (c, x, y, w, h) => { shadow(c, x, y, w, h, 3); box(c, x, y, w, h, '#e7d7c3', C.woodDark, 4); for (let i = 1; i < 5; i++) line(c, x + (w / 5) * i, y + 2, x + (w / 5) * i, y + h - 2, C.woodDark, 1); };
  P['hospital-bed'] = (c, x, y, w, h) => {
    shadow(c, x, y, w, h, 3); box(c, x, y, w, h, C.metal, C.metalDark, 3);
    box(c, x + w * .08, y + h * .08, w * .84, h * .84, '#eaf1f6', '#c3ced8', 3);
    box(c, x + w * .12, y + h * .1, w * .76, h * .16, C.white, '#c3ced8', 2);
    box(c, x, y + h * .9, w, h * .1, C.metalDark, null, 2);
  };

  /* --- storage --- */
  const shelfLike = (fill) => (c, x, y, w, h, pr) => {
    shadow(c, x, y, w, h, 2); box(c, x, y, w, h, fill, C.woodDark, 2);
    const vert = (pr.d === 'v') || h > w;
    const n = Math.max(2, Math.round((vert ? h : w) / 9));
    for (let i = 1; i < n; i++) {
      if (vert) line(c, x, y + (h / n) * i, x + w, y + (h / n) * i, C.woodDark, 1);
      else line(c, x + (w / n) * i, y, x + (w / n) * i, y + h, C.woodDark, 1);
    }
    // books / goods
    const cols = ['#b8695c', '#5f8fb0', '#8fae6a', '#d0a44e', '#8a7fb0'];
    for (let i = 0; i < (vert ? h : w) / 5; i++) {
      c.fillStyle = cols[i % cols.length];
      if (vert) c.fillRect(x + w * .25, y + 3 + i * 5, w * .5, 3);
      else c.fillRect(x + 3 + i * 5, y + h * .25, 3, h * .5);
    }
  };
  P.shelf = shelfLike('#8d6a41');
  P.bookcase = shelfLike('#7d5a33');
  P.lockers = (c, x, y, w, h, pr) => {
    shadow(c, x, y, w, h, 2); box(c, x, y, w, h, '#6f8296', '#48586a', 2);
    const vert = (pr.d === 'v') || h > w;
    const n = Math.max(2, Math.round((vert ? h : w) / 8));
    for (let i = 1; i < n; i++) {
      if (vert) line(c, x, y + (h / n) * i, x + w, y + (h / n) * i, '#48586a', 1.2);
      else line(c, x + (w / n) * i, y, x + (w / n) * i, y + h, '#48586a', 1.2);
    }
  };
  P.cabinet = (c, x, y, w, h) => { shadow(c, x, y, w, h, 2); box(c, x, y, w, h, '#9d7c53', C.woodDark, 2); line(c, x + w / 2, y, x + w / 2, y + h, C.woodDark, 1); circle(c, x + w * .43, y + h / 2, 1.6, C.metal); circle(c, x + w * .57, y + h / 2, 1.6, C.metal); };
  P.wardrobe = (c, x, y, w, h) => { shadow(c, x, y, w, h, 2); box(c, x, y, w, h, '#8a6339', '#5b4021', 2); line(c, x + w / 2, y + 2, x + w / 2, y + h - 2, '#5b4021', 1.4); circle(c, x + w * .44, y + h / 2, 1.5, C.gold); circle(c, x + w * .56, y + h / 2, 1.5, C.gold); };
  P.dresser = (c, x, y, w, h) => { shadow(c, x, y, w, h, 2); box(c, x, y, w, h, '#9d7c53', C.woodDark, 2); for (let i = 1; i < 3; i++) line(c, x + 2, y + (h / 3) * i, x + w - 2, y + (h / 3) * i, C.woodDark, 1); };
  P.filing = P.cabinet;
  P.crate = (c, x, y, w, h) => { shadow(c, x, y, w, h, 2); box(c, x, y, w, h, '#b08a55', '#6d5228', 2); line(c, x, y, x + w, y + h, '#6d5228', 1.4); line(c, x + w, y, x, y + h, '#6d5228', 1.4); };
  P.box = (c, x, y, w, h) => { shadow(c, x, y, w, h, 2); box(c, x, y, w, h, '#c69b64', '#8a6a3a', 2); line(c, x + w / 2, y, x + w / 2, y + h, '#8a6a3a', 1.2); };
  P.safe = (c, x, y, w, h) => { shadow(c, x, y, w, h, 2); box(c, x, y, w, h, '#4d545f', '#2f343d', 2); circle(c, x + w / 2, y + h / 2, Math.min(w, h) * .22, C.metal, '#2f343d'); };
  P['display-case'] = (c, x, y, w, h) => {
    shadow(c, x, y, w, h, 3, .26);
    box(c, x, y, w, h, '#8b6a43', '#553c1d', 3);                       // plinth
    box(c, x + w * .08, y + h * .1, w * .84, h * .68, 'rgba(190,225,240,.55)', C.glassLine, 2); // vitrine
    box(c, x, y + h * .78, w, h * .22, '#7a5c37', '#553c1d', 2);
    line(c, x + w * .08, y + h * .34, x + w * .92, y + h * .3, 'rgba(255,255,255,.5)', 1.4);
  };
  P.pedestal = (c, x, y, w, h) => { shadow(c, x, y, w, h, 2); box(c, x, y, w, h, '#cfd3da', '#9aa0ab', 2); box(c, x + w * .12, y + h * .12, w * .76, h * .76, '#e2e5ea', null, 2); };
  P.vending = (c, x, y, w, h) => { shadow(c, x, y, w, h, 2); box(c, x, y, w, h, '#3f6d8f', '#28455c', 2); box(c, x + w * .1, y + h * .12, w * .55, h * .7, 'rgba(190,225,240,.6)', C.glassLine, 2); for (let i = 0; i < 3; i++) c.fillRect(x + w * .14, y + h * (.2 + i * .2), w * .45, 2); };

  /* --- appliances / fittings --- */
  P.fridge = (c, x, y, w, h) => { shadow(c, x, y, w, h, 2); box(c, x, y, w, h, '#dfe3e9', '#a8b0ba', 3); line(c, x + 2, y + h * .38, x + w - 2, y + h * .38, '#a8b0ba', 1.2); box(c, x + w * .78, y + h * .12, w * .08, h * .2, C.metalDark, null, 1); };
  P.stove = (c, x, y, w, h) => { shadow(c, x, y, w, h, 2); box(c, x, y, w, h, '#d5d9e0', '#a0a7b1', 2); const r = Math.min(w, h) * .17; circle(c, x + w * .3, y + h * .3, r, '#5b626c'); circle(c, x + w * .7, y + h * .3, r, '#5b626c'); circle(c, x + w * .3, y + h * .7, r, '#5b626c'); circle(c, x + w * .7, y + h * .7, r, '#5b626c'); };
  P.sink = (c, x, y, w, h) => { shadow(c, x, y, w, h, 2); box(c, x, y, w, h, '#dfe4ea', '#a8b0ba', 2); box(c, x + w * .14, y + h * .18, w * .72, h * .64, '#b9c3cd', '#8f99a4', 2); circle(c, x + w / 2, y + h * .5, Math.min(w, h) * .1, '#8f99a4'); };
  P.dishwasher = (c, x, y, w, h) => { shadow(c, x, y, w, h, 2); box(c, x, y, w, h, '#d5d9e0', '#a0a7b1', 2); line(c, x + 3, y + h * .25, x + w - 3, y + h * .25, '#a0a7b1', 1.2); };
  P.washer = (c, x, y, w, h) => { shadow(c, x, y, w, h, 2); box(c, x, y, w, h, '#e3e7ec', '#a8b0ba', 2); circle(c, x + w / 2, y + h * .55, Math.min(w, h) * .28, '#9fb4c4', '#7f8f9d'); };
  P.toilet = (c, x, y, w, h, pr) => {
    shadow(c, x, y, w, h, 3); const d = pr.d || 'n';
    box(c, x, y, w, h * .3, '#e9edf1', '#b6bec8', 2);
    circle(c, x + w / 2, y + h * .62, Math.min(w, h * .8) * .42, '#f2f5f8', '#b6bec8');
    circle(c, x + w / 2, y + h * .62, Math.min(w, h * .8) * .26, '#cfd8e0');
  };
  P.bathtub = (c, x, y, w, h) => { shadow(c, x, y, w, h, 4); box(c, x, y, w, h, '#eef2f6', '#adb7c2', 5); box(c, x + w * .08, y + h * .12, w * .84, h * .76, '#cfe0ea', '#adb7c2', 4); circle(c, x + w * .86, y + h / 2, Math.min(w, h) * .06, '#8f99a4'); };
  P.shower = (c, x, y, w, h) => { shadow(c, x, y, w, h, 2); box(c, x, y, w, h, 'rgba(190,225,240,.45)', C.glassLine, 2); line(c, x, y, x + w, y + h, 'rgba(255,255,255,.5)', 1.2); circle(c, x + w * .82, y + h * .18, Math.min(w, h) * .1, C.metal, C.metalDark); };
  P.basin = P.sink;
  P.radiator = (c, x, y, w, h, pr) => {
    box(c, x, y, w, h, '#e2e6eb', '#a8b0ba', 1);
    const vert = h > w, n = Math.max(3, Math.round((vert ? h : w) / 4));
    for (let i = 1; i < n; i++) {
      if (vert) line(c, x, y + (h / n) * i, x + w, y + (h / n) * i, '#a8b0ba', 1);
      else line(c, x + (w / n) * i, y, x + (w / n) * i, y + h, '#a8b0ba', 1);
    }
  };
  P.fireplace = (c, x, y, w, h) => {
    shadow(c, x, y, w, h, 2); box(c, x, y, w, h, '#8d8579', '#5d564c', 2);
    box(c, x + w * .16, y + h * .3, w * .68, h * .62, '#2b2724', '#1c1917', 2);
    c.fillStyle = 'rgba(255,150,60,.85)';
    c.beginPath(); c.moveTo(x + w / 2, y + h * .42); c.lineTo(x + w * .66, y + h * .85); c.lineTo(x + w * .34, y + h * .85); c.closePath(); c.fill();
  };

  /* --- electronics --- */
  P.tv = (c, x, y, w, h) => { shadow(c, x, y, w, h, 2); box(c, x, y, w, h, '#23272e', '#14171b', 2); box(c, x + w * .06, y + h * .12, w * .88, h * .7, '#3c4a5c', null, 1); };
  P['tv-wall'] = P.tv;
  P.monitor = (c, x, y, w, h, pr) => {
    const ww = w || 10, hh = h || 6; shadow(c, x, y, ww, hh, 1.5);
    box(c, x, y, ww, hh, '#2a2f38', '#171a20', 2);
    box(c, x + ww * .1, y + hh * .15, ww * .8, hh * .6, '#6d90b5', null, 1);
  };
  P.computer = (c, x, y, w, h) => { P.monitor(c, x, y, w, h, {}); };
  P.printer = (c, x, y, w, h) => { shadow(c, x, y, w, h, 2); box(c, x, y, w, h, '#d3d8de', '#9aa2ac', 2); box(c, x + w * .12, y + h * .1, w * .76, h * .3, '#8c96a2', null, 1); box(c, x + w * .16, y + h * .62, w * .68, h * .3, C.paper, '#b9c0c8', 1); };
  P.copier = (c, x, y, w, h) => { shadow(c, x, y, w, h, 2); box(c, x, y, w, h, '#b9c0c9', '#8a929c', 2); box(c, x + w * .1, y + h * .08, w * .8, h * .35, '#5f6873', null, 2); box(c, x + w * .14, y + h * .56, w * .72, h * .3, C.paper, '#9aa2ac', 1); };
  P.register = (c, x, y, w, h) => { const s = w || 9; shadow(c, x, y, s, s * .8, 1.5); box(c, x, y, s, s * .8, '#586070', '#383e4b', 2); box(c, x + s * .15, y + s * .1, s * .7, s * .3, '#8fb3cf', null, 1); };
  P['monitor-med'] = (c, x, y, w, h) => { shadow(c, x, y, w, h, 2); box(c, x, y, w, h, '#e7ebf0', '#a9b2bd', 2); box(c, x + w * .12, y + h * .12, w * .76, h * .5, '#20303c', null, 1); c.strokeStyle = '#5ddc9a'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x + w * .15, y + h * .4); c.lineTo(x + w * .35, y + h * .4); c.lineTo(x + w * .45, y + h * .2); c.lineTo(x + w * .55, y + h * .55); c.lineTo(x + w * .7, y + h * .4); c.lineTo(x + w * .85, y + h * .4); c.stroke(); };
  P.iv = (c, x, y, w, h) => { const cx = x + w / 2; line(c, cx, y + h * .2, cx, y + h, C.metalDark, 1.5); box(c, cx - w * .16, y, w * .32, h * .3, 'rgba(190,225,240,.8)', '#8fa8bb', 2); };
  P.piano = (c, x, y, w, h) => {
    shadow(c, x, y, w, h, 4); box(c, x, y, w, h, '#23262c', '#111318', 4);
    c.fillStyle = C.white; c.fillRect(x + w * .06, y + h * .74, w * .88, h * .2);
    for (let i = 1; i < 14; i++) line(c, x + w * .06 + (w * .88 / 14) * i, y + h * .74, x + w * .06 + (w * .88 / 14) * i, y + h * .94, '#2a2d33', 1);
  };
  P.whiteboard = (c, x, y, w, h) => { box(c, x, y, w, h, C.white, '#9aa2ac', 1); line(c, x + w * .1, y + h * .5, x + w * .55, y + h * .5, '#7f93b5', 1.2); };
  P.chalkboard = (c, x, y, w, h) => { box(c, x, y, w, h, '#33493c', '#7d5a33', 2); line(c, x + w * .1, y + h * .45, x + w * .6, y + h * .45, 'rgba(255,255,255,.5)', 1.2); };
  P.board = (c, x, y, w, h) => { shadow(c, x, y, w, h, 1.5); box(c, x, y, w, h, '#cdb894', '#8a7452', 2); for (let i = 0; i < 3; i++) c.fillRect(x + w * (.1 + i * .3), y + h * .25, w * .2, h * .5); c.fillStyle = C.paper; };

  /* --- light --- */
  P['lamp-ceiling'] = (c, x, y, w, h) => {
    c.save(); c.globalAlpha = .5;
    c.fillStyle = 'rgba(255,236,180,.30)'; rr(c, x - w * .22, y - h * .7, w * 1.44, h * 2.4, h); c.fill();
    c.restore();
    box(c, x, y, w, h, '#f9f4dc', 'rgba(160,152,120,.8)', 2);
    line(c, x + w * .12, y + h * .5, x + w * .88, y + h * .5, 'rgba(190,182,150,.7)', 1);
  };
  P.chandelier = (c, x, y, w, h) => {
    c.fillStyle = C.glow; circle(c, x + w / 2, y + h / 2, Math.max(w, h) * .9, C.glow);
    circle(c, x + w / 2, y + h / 2, Math.min(w, h) * .34, '#f4e6b0', '#b9a468');
    for (let i = 0; i < 6; i++) { const a = (Math.PI * 2 * i) / 6; circle(c, x + w / 2 + Math.cos(a) * w * .45, y + h / 2 + Math.sin(a) * h * .45, Math.min(w, h) * .13, '#fdf3cd', '#c8b477'); }
  };
  P['lamp-floor'] = (c, x, y, w, h) => {
    const r = (w || 12) * .5; c.fillStyle = C.glow; circle(c, x + r, y + r, r * 2.2, C.glow);
    circle(c, x + r, y + r, r * .95, '#f6efd2', '#bdb48c');
    circle(c, x + r, y + r, r * .35, '#8d8467');
  };
  P['lamp-table'] = (c, x, y, w, h) => { const r = (w || 9) * .45; c.fillStyle = C.glow; circle(c, x + r, y + r, r * 1.9, C.glow); circle(c, x + r, y + r, r, '#fdf1c7', '#c0b183'); };
  P.sconce = (c, x, y, w, h) => { c.fillStyle = C.glow; circle(c, x + w / 2, y + h / 2, w * 1.2, C.glow); box(c, x, y, w, h, '#f6e9bd', '#bda972', 2); };
  P.candle = (c, x, y, w, h) => { const r = (w || 6) * .4; c.fillStyle = 'rgba(255,200,110,.4)'; circle(c, x + r, y + r, r * 2.4, 'rgba(255,200,110,.35)'); circle(c, x + r, y + r, r * .7, '#fff3cf', '#d9c48a'); };
  P.nightlight = P.candle;

  /* --- textiles / decor --- */
  P.rug = (c, x, y, w, h, pr) => {
    const cols = { red: ['#a8534a', '#8d423b'], blue: ['#5b7794', '#48627c'], grey: ['#9aa0aa', '#868d97'], warm: ['#c39a6a', '#a87f52'], green: ['#6f9068', '#5b7855'] };
    const col = cols[pr.c || 'warm'];
    box(c, x, y, w, h, col[0], col[1], 3);
    box(c, x + w * .08, y + h * .1, w * .84, h * .8, 'rgba(255,255,255,.16)', col[1], 2);
  };
  P['rug-round'] = (c, x, y, w, h, pr) => { const r = Math.min(w, h) / 2; circle(c, x + w / 2, y + h / 2, r, pr.c === 'blue' ? '#5b7794' : '#c39a6a', 'rgba(0,0,0,.15)'); circle(c, x + w / 2, y + h / 2, r * .7, 'rgba(255,255,255,.18)'); };
  P.curtain = (c, x, y, w, h, pr) => {
    const vert = pr.d === 'v';
    const tone = { cream: ['#e6d9be', '#c9b78f'], red: ['#b0655a', '#8a4a41'],
                   blue: ['#7d95b4', '#5d7290'], green: ['#7d9c78', '#5e7a5a'] }[pr.c || 'cream'];
    c.save(); shadow(c, x, y, w, h, 2, .18);
    box(c, x, y, w, h, tone[0], tone[1], 2);
    const n = Math.max(4, Math.round((vert ? h : w) / 3.5));   // pleats
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (vert) {
        line(c, x, y + h * t, x + w, y + h * t, i % 2 ? 'rgba(0,0,0,.20)' : 'rgba(255,255,255,.28)', 1.2);
      } else {
        line(c, x + w * t, y, x + w * t, y + h, i % 2 ? 'rgba(0,0,0,.20)' : 'rgba(255,255,255,.28)', 1.2);
      }
    }
    // curtain rail along the window side
    if (vert) box(c, x + w * .78, y - h * .06, w * .22, h * 1.12, C.metalDark, null, 1);
    else box(c, x - w * .06, y + h * .78, w * 1.12, h * .22, C.metalDark, null, 1);
    c.restore();
  };
  P.blinds = (c, x, y, w, h, pr) => {
    box(c, x, y, w, h, '#e6e9ee', '#9aa2ac', 1);
    const vert = pr.d === 'v', n = Math.max(3, Math.round((vert ? h : w) / 3));
    for (let i = 1; i < n; i++) {
      if (vert) line(c, x, y + (h / n) * i, x + w, y + (h / n) * i, '#a9b1bb', 1);
      else line(c, x + (w / n) * i, y, x + (w / n) * i, y + h, '#a9b1bb', 1);
    }
  };
  P.screen = (c, x, y, w, h, pr) => { // hospital privacy curtain
    const vert = pr.d === 'v';
    box(c, x, y, w, h, 'rgba(140,190,175,.75)', '#5f8f83', 2);
    const n = Math.max(3, Math.round((vert ? h : w) / 4));
    for (let i = 1; i < n; i++) {
      if (vert) line(c, x, y + (h / n) * i, x + w, y + (h / n) * i, 'rgba(0,0,0,.18)', 1);
      else line(c, x + (w / n) * i, y, x + (w / n) * i, y + h, 'rgba(0,0,0,.18)', 1);
    }
  };
  P.painting = (c, x, y, w, h, pr) => {
    shadow(c, x, y, w, h, 1, .3);
    box(c, x, y, w, h, pr.c === 'gold' ? C.gold : '#6b5334', '#3f321d', 2);
    box(c, x + w * .1, y + h * .16, w * .8, h * .68, ['#6d8fa8', '#8aa07a', '#a8836a', '#7b7fa0'][Math.floor((x + y) % 4)], 'rgba(0,0,0,.2)', 1);
  };
  P.mirror = (c, x, y, w, h) => { box(c, x, y, w, h, 'rgba(200,225,240,.75)', C.gold, 2); line(c, x, y + h, x + w, y, 'rgba(255,255,255,.6)', 1.2); };
  P.clock = (c, x, y, w, h) => { const r = (w || 10) / 2; circle(c, x + r, y + r, r, C.white, '#6b5334'); line(c, x + r, y + r, x + r, y + r * .4, '#333', 1.2); line(c, x + r, y + r, x + r * 1.5, y + r, '#333', 1.2); };
  P.sign = (c, x, y, w, h, pr) => { box(c, x, y, w, h, '#3a4250', 'rgba(20,24,32,.6)', 2); if (pr.label) label(c, pr.label, x + w / 2, y + h / 2, Math.min(h * .8, 8), '#e8edf4'); };
  P.doormat = (c, x, y, w, h) => { box(c, x, y, w, h, '#6b6f78', '#4c5058', 1); for (let i = 1; i < 4; i++) line(c, x + (w / 4) * i, y, x + (w / 4) * i, y + h, '#565a63', 1); };

  /* --- greenery --- */
  P.plant = (c, x, y, w, h) => {
    const s = w || 12; shadow(c, x, y, s, s, s / 2, .18);
    circle(c, x + s / 2, y + s * .62, s * .3, '#a9673f', '#7d4a2a');
    circle(c, x + s / 2, y + s * .42, s * .42, C.green, C.greenDark);
    circle(c, x + s * .32, y + s * .3, s * .2, '#5fa563'); circle(c, x + s * .68, y + s * .34, s * .18, '#5fa563');
  };
  P['plant-big'] = (c, x, y, w, h) => {
    const s = (w || 12) * 1.35; shadow(c, x, y, s, s, s / 2, .2);
    circle(c, x + s / 2, y + s * .66, s * .3, '#a9673f', '#7d4a2a');
    for (let i = 0; i < 7; i++) { const a = (Math.PI * 2 * i) / 7; circle(c, x + s / 2 + Math.cos(a) * s * .26, y + s * .42 + Math.sin(a) * s * .26, s * .21, i % 2 ? '#4f8f52' : '#5fa563', C.greenDark); }
    circle(c, x + s / 2, y + s * .42, s * .2, '#6cb471');
  };
  P.tree = (c, x, y, w, h) => { const s = w || 20; circle(c, x + s / 2, y + s / 2, s * .5, '#3f7a45', '#2c5730'); circle(c, x + s * .36, y + s * .38, s * .22, '#549a58'); };
  P.vase = (c, x, y, w, h, pr) => {
    const s = w || 10, col = { clay: C.clay, gold: C.gold, silver: C.silver, jade: C.jade }[pr.c || 'clay'];
    shadow(c, x, y, s, s, s / 2, .25); circle(c, x + s / 2, y + s / 2, s * .42, col, 'rgba(0,0,0,.35)');
    circle(c, x + s / 2, y + s / 2, s * .2, 'rgba(0,0,0,.25)');
  };
  P.amphora = (c, x, y, w, h, pr) => {
    const col = { clay: C.clay, gold: C.gold, silver: C.silver, jade: C.jade }[pr.c || 'clay'];
    shadow(c, x, y, w, h, w / 2, .28);
    c.fillStyle = col; c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = 1.2;
    c.beginPath(); c.ellipse(x + w / 2, y + h * .58, w * .46, h * .38, 0, 0, Math.PI * 2); c.fill(); c.stroke();
    c.beginPath(); c.ellipse(x + w / 2, y + h * .16, w * .2, h * .13, 0, 0, Math.PI * 2); c.fill(); c.stroke();
    c.fillStyle = 'rgba(255,255,255,.28)';
    c.beginPath(); c.ellipse(x + w * .38, y + h * .5, w * .12, h * .14, 0, 0, Math.PI * 2); c.fill();
    if (pr.c === 'gold') { c.fillStyle = 'rgba(255,235,150,.55)'; circle(c, x + w / 2, y + h * .5, w * .95, 'rgba(255,225,120,.28)'); }
  };
  P.statue = (c, x, y, w, h) => {
    shadow(c, x, y, w, h, 3, .28);
    box(c, x, y + h * .72, w, h * .28, '#b9bec7', '#8e949e', 2);
    circle(c, x + w / 2, y + h * .5, w * .3, '#d5d9df', '#a2a8b2');
    circle(c, x + w / 2, y + h * .22, w * .2, '#e2e5ea', '#a2a8b2');
  };

  /* --- misc --- */
  P.rope = (c, x, y, w, h, pr) => {
    const vert = pr.d === 'v';
    if (vert) {
      circle(c, x + w / 2, y, w * .45, '#8a6a3a', '#5b4522'); circle(c, x + w / 2, y + h, w * .45, '#8a6a3a', '#5b4522');
      c.strokeStyle = '#a8443c'; c.lineWidth = Math.max(1.5, w * .3);
      c.beginPath(); c.moveTo(x + w / 2, y); c.quadraticCurveTo(x + w * 1.3, y + h / 2, x + w / 2, y + h); c.stroke();
    } else {
      circle(c, x, y + h / 2, h * .45, '#8a6a3a', '#5b4522'); circle(c, x + w, y + h / 2, h * .45, '#8a6a3a', '#5b4522');
      c.strokeStyle = '#a8443c'; c.lineWidth = Math.max(1.5, h * .3);
      c.beginPath(); c.moveTo(x, y + h / 2); c.quadraticCurveTo(x + w / 2, y + h * 1.3, x + w, y + h / 2); c.stroke();
    }
  };
  P.turnstile = (c, x, y, w, h) => {
    const s = w || 12; box(c, x, y, s * .55, s, C.metalDark, '#5c6470', 2);
    c.strokeStyle = C.metal; c.lineWidth = 2;
    for (const a of [0, 2.1, 4.2]) { c.beginPath(); c.moveTo(x + s * .28, y + s / 2); c.lineTo(x + s * .28 + Math.cos(a) * s * .7, y + s / 2 + Math.sin(a) * s * .7); c.stroke(); }
  };
  P.scanner = (c, x, y, w, h) => {
    shadow(c, x, y, w, h, 2); box(c, x, y, w, h, '#8e97a4', '#5f6872', 3);
    box(c, x + w * .12, y + h * .3, w * .76, h * .4, '#3b434e', null, 2);
    box(c, x + w * .2, y + h * .38, w * .25, h * .24, '#d9b45a', null, 1);
  };
  P.tray = (c, x, y, w, h) => { const s = w || 8; box(c, x, y, s, s * .72, '#7a8290', '#535a66', 2); };
  P.extinguisher = (c, x, y, w, h) => { const s = w || 8; shadow(c, x, y, s * .6, s, s / 3, .2); box(c, x, y, s * .6, s, '#c0392b', '#7d241a', 3); box(c, x + s * .18, y - s * .12, s * .24, s * .2, C.metalDark, null, 1); };
  P.trash = (c, x, y, w, h) => { const s = w || 10; shadow(c, x, y, s, s, s / 2, .18); circle(c, x + s / 2, y + s / 2, s * .42, '#68717e', '#454c57'); circle(c, x + s / 2, y + s / 2, s * .28, '#535b66'); };
  P['coat-rack'] = (c, x, y, w, h) => { const s = w || 10; circle(c, x + s / 2, y + s / 2, s * .18, C.woodDark); for (let i = 0; i < 4; i++) { const a = (Math.PI * 2 * i) / 4 + .4; line(c, x + s / 2, y + s / 2, x + s / 2 + Math.cos(a) * s * .45, y + s / 2 + Math.sin(a) * s * .45, C.woodDark, 1.6); } box(c, x + s * .1, y + s * .1, s * .3, s * .5, C.clothWarm, null, 2); };
  P.cart = (c, x, y, w, h) => { shadow(c, x, y, w, h, 2); box(c, x, y, w, h, C.metal, C.metalDark, 2); box(c, x + w * .1, y + h * .12, w * .8, h * .4, '#9aa3ae', null, 1); circle(c, x + w * .15, y + h * .9, w * .07, '#3d434d'); circle(c, x + w * .85, y + h * .9, w * .07, '#3d434d'); };
  P.mug = (c, x, y, w, h) => { const s = w || 6; circle(c, x + s / 2, y + s / 2, s * .42, C.white, '#a9b0ba'); circle(c, x + s / 2, y + s / 2, s * .24, '#6b4a2c'); };
  P.papers = (c, x, y, w, h) => { const s = w || 8; c.save(); c.translate(x, y); c.rotate(.18); box(c, 0, 0, s, s * .78, C.paper, '#c3c8d0', 1); c.restore(); box(c, x + 1, y + 1.5, s, s * .78, C.paper, '#c3c8d0', 1); line(c, x + 3, y + 4, x + s - 3, y + 4, '#b9bfc8', 1); line(c, x + 3, y + 7, x + s - 4, y + 7, '#b9bfc8', 1); };
  P.book = (c, x, y, w, h) => { const s = w || 8; box(c, x, y, s, s * .7, '#8a5a4a', '#5d3a2e', 1); line(c, x + s / 2, y, x + s / 2, y + s * .7, '#5d3a2e', 1); };
  P.camera = (c, x, y, w, h, pr) => {
    const s = w || 9; const dirs = { se: [1, 1], sw: [-1, 1], ne: [1, -1], nw: [-1, -1], s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] };
    const d = dirs[pr.d || 'se'];
    c.fillStyle = 'rgba(255,90,90,.13)';
    c.beginPath(); c.moveTo(x + s / 2, y + s / 2);
    c.arc(x + s / 2, y + s / 2, s * 4, Math.atan2(d[1], d[0]) - .5, Math.atan2(d[1], d[0]) + .5); c.closePath(); c.fill();
    box(c, x, y, s, s * .7, '#4a515d', '#2c313a', 2); circle(c, x + s * .5 + d[0] * s * .2, y + s * .35 + d[1] * s * .2, s * .16, '#c0392b');
  };
  P['glass-screen'] = (c, x, y, w, h) => { box(c, x, y, w, h, 'rgba(180,220,240,.5)', C.glassLine, 1); };
  P.stairs = (c, x, y, w, h, pr) => {
    const vert = (pr.d || 'v') === 'v'; box(c, x, y, w, h, '#b3b8c1', '#8a9099', 2);
    const n = Math.max(4, Math.round((vert ? h : w) / 6));
    for (let i = 1; i < n; i++) {
      if (vert) line(c, x, y + (h / n) * i, x + w, y + (h / n) * i, '#8a9099', 1.3);
      else line(c, x + (w / n) * i, y, x + (w / n) * i, y + h, '#8a9099', 1.3);
    }
  };
  P.mat = (c, x, y, w, h) => { box(c, x, y, w, h, '#4f7f9a', '#3a6076', 3); box(c, x + w * .08, y + h * .1, w * .84, h * .8, 'rgba(255,255,255,.14)', null, 2); };
  P.hoop = (c, x, y, w, h) => { const s = w || 14; circle(c, x + s / 2, y + s / 2, s * .4, 'rgba(0,0,0,0)', '#d1663a'); box(c, x + s * .2, y, s * .6, s * .12, C.white, '#9aa2ac', 1); };
  P.sleeper = (c, x, y, w, h, pr, T) => {
    shadow(c, x, y, w, h, w / 2, .25);
    circle(c, x + w / 2, y + h / 2, w * .5, '#e8c9a8', '#b08e6c');       // head/blanket blob
    circle(c, x + w * .35, y + h * .45, w * .07, '#3a3a3a'); circle(c, x + w * .65, y + h * .45, w * .07, '#3a3a3a');
    c.strokeStyle = '#3a3a3a'; c.lineWidth = 1.3;
    c.beginPath(); c.arc(x + w / 2, y + h * .62, w * .16, .2, Math.PI - .2); c.stroke();
    label(c, 'z', x + w * 1.0, y - h * .12, w * .5, '#2b3040');
    label(c, 'Z', x + w * 1.25, y - h * .5, w * .7, '#2b3040');
  };
  P.player = (c, x, y, w, h) => { shadow(c, x, y, w, h, w / 2, .25); circle(c, x + w / 2, y + h / 2, w * .45, '#3f7ad1', '#25508f'); circle(c, x + w / 2, y + h * .34, w * .22, '#e8c9a8', '#b08e6c'); };


  /* --- desk & kitchen small stuff --- */
  P.laptop = (c, x, y, w, h) => { const s = w || 12; shadow(c, x, y, s, s * .75, 1.5); box(c, x, y, s, s * .42, '#2b313b', '#191d24', 2); box(c, x + s * .07, y + s * .05, s * .86, s * .32, '#6d90b5', null, 1); box(c, x, y + s * .44, s, s * .34, '#9aa3af', '#6d747f', 2); };
  P.keys = (c, x, y, w, h, pr) => {
    const s = w || 10; c.save();
    circle(c, x + s * .3, y + s * .3, s * .22, 'rgba(0,0,0,0)', C.gold); c.lineWidth = 2;
    line(c, x + s * .45, y + s * .42, x + s * .82, y + s * .78, C.gold, 2.4);
    line(c, x + s * .7, y + s * .66, x + s * .82, y + s * .55, C.gold, 2.2);
    line(c, x + s * .82, y + s * .78, x + s * .95, y + s * .66, C.gold, 2.2);
    c.restore();
    if (pr && pr.label) { c.fillStyle = 'rgba(255,210,63,.28)'; circle(c, x + s * .5, y + s * .5, s * 1.5, 'rgba(255,210,63,.22)'); }
  };
  P['water-cooler'] = (c, x, y, w, h) => { const s = w || 12; shadow(c, x, y, s * .8, s, 2); box(c, x, y, s * .8, s, '#dfe6ec', '#a5b0ba', 2); box(c, x + s * .08, y - s * .28, s * .64, s * .34, 'rgba(150,205,235,.8)', '#7fa8c4', 3); };
  P.kettle = (c, x, y, w, h) => { const s = w || 9; shadow(c, x, y, s, s, s / 2, .18); circle(c, x + s / 2, y + s / 2, s * .4, '#2f353f', '#1b1f26'); line(c, x + s * .78, y + s * .5, x + s * .98, y + s * .34, '#1b1f26', 2); };
  P.projector = (c, x, y, w, h) => { const s = w || 14; c.fillStyle = 'rgba(255,255,255,.10)'; box(c, x, y, s, s * .5, '#c7ccd4', '#8f97a1', 2); circle(c, x + s * .82, y + s * .25, s * .12, '#dfe6ec', '#8f97a1'); };
  P.microwave = (c, x, y, w, h) => { shadow(c, x, y, w, h, 2); box(c, x, y, w, h, '#c9ced6', '#93999f', 2); box(c, x + w * .08, y + h * .15, w * .6, h * .7, '#3d4650', null, 1); };
  P.suitcase = (c, x, y, w, h) => { shadow(c, x, y, w, h, 2); box(c, x, y, w, h, '#6b5334', '#43331e', 3); line(c, x, y + h * .5, x + w, y + h * .5, '#43331e', 1.2); };
  P.ball = (c, x, y, w, h) => { const s = w || 10; circle(c, x + s / 2, y + s / 2, s * .45, '#d1663a', '#8e4324'); line(c, x, y + s / 2, x + s, y + s / 2, '#8e4324', 1); };
  P.broom = (c, x, y, w, h) => { const s = w || 12; line(c, x + s * .2, y + s, x + s * .8, y, C.woodDark, 2); box(c, x + s * .6, y - s * .06, s * .4, s * .28, '#c8a24c', '#8a6c2c', 2); };
  P.bucket = (c, x, y, w, h) => { const s = w || 9; shadow(c, x, y, s, s, s / 2, .18); circle(c, x + s / 2, y + s / 2, s * .42, '#5b8fb0', '#3d6a86'); circle(c, x + s / 2, y + s / 2, s * .26, '#8fb8cf'); };
  P.ladder = (c, x, y, w, h) => { const vert = h > w; box(c, x, y, w, h, 'rgba(180,150,90,.2)', '#8a6c2c', 1); const n = Math.max(3, Math.round((vert ? h : w) / 7)); for (let i = 1; i < n; i++) { if (vert) line(c, x, y + (h / n) * i, x + w, y + (h / n) * i, '#8a6c2c', 1.6); else line(c, x + (w / n) * i, y, x + (w / n) * i, y + h, '#8a6c2c', 1.6); } };
  P.teddy = (c, x, y, w, h) => { const s = w || 10; circle(c, x + s / 2, y + s * .6, s * .32, '#b98a53', '#8a6236'); circle(c, x + s / 2, y + s * .26, s * .22, '#b98a53', '#8a6236'); circle(c, x + s * .3, y + s * .12, s * .1, '#8a6236'); circle(c, x + s * .7, y + s * .12, s * .1, '#8a6236'); };
  P.blocks = (c, x, y, w, h) => { const s = w || 10; box(c, x, y + s * .5, s * .4, s * .4, '#c85a4a', '#8e3a2e', 1); box(c, x + s * .45, y + s * .5, s * .4, s * .4, '#4f86b8', '#2f5f8a', 1); box(c, x + s * .2, y + s * .05, s * .4, s * .4, '#d4b04a', '#9a7c22', 1); };
  P.cat = (c, x, y, w, h) => { const s = w || 12; shadow(c, x, y, s, s * .7, s / 3, .18); c.fillStyle = '#4a4f59'; c.beginPath(); c.ellipse(x + s * .5, y + s * .45, s * .42, s * .28, 0, 0, Math.PI * 2); c.fill(); circle(c, x + s * .2, y + s * .3, s * .16, '#4a4f59'); circle(c, x + s * .16, y + s * .28, s * .04, '#f5d76e'); circle(c, x + s * .26, y + s * .28, s * .04, '#f5d76e'); };
  P.pram = (c, x, y, w, h) => { shadow(c, x, y, w, h, 3); box(c, x, y, w, h, '#7f8ea3', '#5a6779', 5); box(c, x + w * .12, y + h * .16, w * .76, h * .5, '#dfe6ec', null, 4); circle(c, x + w * .2, y + h * .92, w * .09, '#3d434d'); circle(c, x + w * .8, y + h * .92, w * .09, '#3d434d'); };


  /* --- odds and ends --- */
  P.phone = (c, x, y, w, h) => { const s = w || 8; box(c, x, y, s, s * .7, '#3a4250', '#22283a', 2); box(c, x + s * .1, y - s * .18, s * .8, s * .22, '#2b323d', null, 2); };
  P.wheelchair = (c, x, y, w, h) => { const s = w || 14; shadow(c, x, y, s, s, s / 2, .2); circle(c, x + s * .5, y + s * .5, s * .44, 'rgba(0,0,0,0)', C.metalDark); c.lineWidth = 2; box(c, x + s * .28, y + s * .25, s * .44, s * .44, '#4c5464', '#2f3540', 2); circle(c, x + s * .12, y + s * .5, s * .12, '#3d434d'); circle(c, x + s * .88, y + s * .5, s * .12, '#3d434d'); };
  P.globe = (c, x, y, w, h) => { const s = w || 11; shadow(c, x, y, s, s, s / 2, .18); circle(c, x + s / 2, y + s / 2, s * .42, '#5b8fb0', '#2f5f7d'); c.fillStyle = '#7fae63'; c.beginPath(); c.ellipse(x + s * .42, y + s * .45, s * .16, s * .1, .5, 0, Math.PI * 2); c.fill(); c.beginPath(); c.ellipse(x + s * .62, y + s * .6, s * .1, s * .07, -.3, 0, Math.PI * 2); c.fill(); };
  P['grandfather-clock'] = (c, x, y, w, h) => { shadow(c, x, y, w, h, 3); box(c, x, y, w, h, '#6b4a26', '#3f2b14', 3); circle(c, x + w / 2, y + h * .22, Math.min(w, h * .4) * .38, C.paper, '#3f2b14'); box(c, x + w * .22, y + h * .45, w * .56, h * .45, '#2f2a22', '#3f2b14', 2); line(c, x + w / 2, y + h * .48, x + w / 2, y + h * .8, C.gold, 1.4); circle(c, x + w / 2, y + h * .82, w * .12, C.gold); };
  P['stove-wood'] = (c, x, y, w, h) => { shadow(c, x, y, w, h, 2); box(c, x, y, w, h, '#3d3a36', '#211f1c', 3); box(c, x + w * .15, y + h * .35, w * .5, h * .5, '#1b1917', '#0f0e0d', 2); c.fillStyle = 'rgba(255,140,50,.85)'; c.beginPath(); c.moveTo(x + w * .4, y + h * .45); c.lineTo(x + w * .58, y + h * .8); c.lineTo(x + w * .22, y + h * .8); c.closePath(); c.fill(); circle(c, x + w * .8, y + h * .3, Math.min(w, h) * .12, '#5b5751'); };
  P.jars = (c, x, y, w, h) => { const n = Math.max(2, Math.round(w / 6)); for (let i = 0; i < n; i++) { const cx = x + (w / n) * (i + .5); circle(c, cx, y + h / 2, Math.min(w / n, h) * .34, ['#c8813f', '#8fae6a', '#b0554a', '#d0a44e'][i % 4], '#6a5230'); } };
  P.sewing = (c, x, y, w, h) => { shadow(c, x, y, w, h, 2); box(c, x, y, w, h, '#2f3540', '#191d24', 2); box(c, x + w * .1, y + h * .5, w * .8, h * .35, C.wood, C.woodDark, 2); line(c, x + w * .7, y + h * .18, x + w * .7, y + h * .5, C.metal, 2); };
  P.umbrella = (c, x, y, w, h) => { const s = w || 10; shadow(c, x, y, s, s, s / 2, .18); circle(c, x + s / 2, y + s / 2, s * .38, '#6b5334', '#3f2b14'); circle(c, x + s * .4, y + s * .45, s * .12, '#8a4a41'); circle(c, x + s * .62, y + s * .55, s * .1, '#3f5d7d'); };

  /* ------------------------------ floors ------------------------------ */
  function floorTile(ctx, ch, px, py, T, x, y) {
    const t = (global.DWH_TILES || {})[ch];
    const key = t ? t.key : 'concrete';
    if (key === 'void') { return; }
    const pal = C.floors[key] || C.floors.concrete;
    ctx.fillStyle = pal[(x + y) % 2 === 0 ? 0 : 1];
    ctx.fillRect(px, py, T + .6, T + .6);

    ctx.save();
    switch (key) {
      case 'wood': {                                   // long planks + seams
        ctx.fillStyle = 'rgba(255,255,255,.10)'; ctx.fillRect(px, py, T, T * .18);
        ctx.strokeStyle = 'rgba(90,55,20,.45)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px, py + T * .5); ctx.lineTo(px + T, py + T * .5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px, py + T); ctx.lineTo(px + T, py + T); ctx.stroke();
        if ((x + y * 3) % 4 === 0) { ctx.strokeStyle = 'rgba(90,55,20,.4)'; ctx.beginPath(); ctx.moveTo(px + T * .5, py); ctx.lineTo(px + T * .5, py + T * .5); ctx.stroke(); }
        break;
      }
      case 'tile': {
        ctx.strokeStyle = 'rgba(120,115,100,.45)'; ctx.lineWidth = 1;
        ctx.strokeRect(px + .5, py + .5, T - 1, T - 1);
        ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(px + 1.5, py + 1.5, T * .35, T * .35);
        break;
      }
      case 'marble': {
        ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
        if (x % 3 === 0) { ctx.beginPath(); ctx.moveTo(px + .5, py); ctx.lineTo(px + .5, py + T); ctx.stroke(); }
        if (y % 3 === 0) { ctx.beginPath(); ctx.moveTo(px, py + .5); ctx.lineTo(px + T, py + .5); ctx.stroke(); }
        if ((x * 7 + y * 13) % 11 === 0) { ctx.strokeStyle = 'rgba(140,145,155,.5)'; ctx.beginPath(); ctx.moveTo(px + 2, py + T * .3); ctx.quadraticCurveTo(px + T * .5, py + T * .8, px + T - 2, py + T * .35); ctx.stroke(); }
        break;
      }
      case 'carpet': {
        ctx.fillStyle = 'rgba(255,255,255,.10)';
        for (let i = 0; i < 5; i++) ctx.fillRect(px + ((x * 7 + i * 5 + y * 3) % T), py + ((y * 11 + i * 7 + x * 5) % T), 1.6, 1.6);
        break;
      }
      case 'gravel': {
        ctx.fillStyle = 'rgba(60,55,45,.35)';
        for (let i = 0; i < 6; i++) ctx.fillRect(px + ((x * 13 + i * 3 + y * 7) % T), py + ((y * 17 + i * 5 + x * 3) % T), 1.8, 1.8);
        break;
      }
      case 'grass': {
        ctx.strokeStyle = 'rgba(45,90,45,.45)'; ctx.lineWidth = 1;
        for (let i = 0; i < 4; i++) { const gx = px + ((x * 7 + i * 4 + y * 5) % T), gy = py + ((y * 9 + i * 6) % T); ctx.beginPath(); ctx.moveTo(gx, gy + 3); ctx.lineTo(gx + 1, gy); ctx.stroke(); }
        break;
      }
      case 'deck': {
        ctx.strokeStyle = 'rgba(90,60,25,.4)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px, py + T * .5); ctx.lineTo(px + T, py + T * .5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px, py + T); ctx.lineTo(px + T, py + T); ctx.stroke();
        break;
      }
      default: {                                        // concrete speckle
        ctx.fillStyle = 'rgba(255,255,255,.08)';
        for (let i = 0; i < 3; i++) ctx.fillRect(px + ((x * 5 + i * 7 + y * 3) % T), py + ((y * 7 + i * 5) % T), 1.4, 1.4);
      }
    }
    ctx.restore();
  }

  /* ------------------------------ main draw ------------------------------ */
  function draw(canvas, map, opts = {}) {
    const o = Object.assign({ tile: 22, walls: true, labels: true, grid: false, noise: false, props: true, pad: 1 }, opts);
    const T = o.tile, W = map.width, H = map.height;
    const dpr = Math.min(global.devicePixelRatio || 1, 2);
    const pxW = (W + o.pad * 2) * T, pxH = (H + o.pad * 2) * T;
    canvas.width = pxW * dpr; canvas.height = pxH * dpr;
    canvas.style.width = pxW + 'px'; canvas.style.height = pxH + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(o.pad * T, o.pad * T);

    const tile = (x, y) => (map.tiles[y] && map.tiles[y][x]) || ' ';
    const info = (ch) => (global.DWH_TILES || {})[ch] || { key: 'void', noise: 0 };
    const isWall = (x, y) => 'W#G'.includes(tile(x, y));
    const isSolid = (x, y) => isWall(x, y) || tile(x, y) === 'L';

    /* background */
    ctx.fillStyle = C.void;
    ctx.fillRect(-o.pad * T, -o.pad * T, pxW, pxH);

    /* floors */
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const ch = tile(x, y);
        if (ch === ' ') continue;
        floorTile(ctx, ch, x * T, y * T, T, x, y);
      }

    /* noise heat overlay */
    if (o.noise) {
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const n = info(tile(x, y)).noise || 0;
          if (!n || !info(tile(x, y)).walk) continue;
          ctx.fillStyle = `rgba(255,${Math.max(0, 210 - n * 42)},40,${0.06 + n * 0.055})`;
          ctx.fillRect(x * T, y * T, T + .6, T + .6);
        }
    }

    /* wall drop shadow onto the floor */
    ctx.save();
    ctx.fillStyle = C.wallShadow;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (isSolid(x, y) && !isSolid(x, y + 1) && tile(x, y + 1) !== ' ')
          ctx.fillRect(x * T, (y + 1) * T, T + .6, T * .34);
    ctx.restore();

    /* walls */
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const ch = tile(x, y);
        if (!'#WGL'.includes(ch)) continue;
        const px = x * T, py = y * T;
        if (ch === 'W' || ch === 'G') {
          const horiz = isWall(x - 1, y) || isWall(x + 1, y);
          ctx.fillStyle = C.wall; ctx.fillRect(px, py, T + .6, T + .6);
          ctx.fillStyle = ch === 'G' ? 'rgba(160,215,240,.75)' : C.glass;
          if (horiz) ctx.fillRect(px, py + T * .22, T + .6, T * .56);
          else ctx.fillRect(px + T * .22, py, T * .56, T + .6);
          ctx.strokeStyle = C.glassLine; ctx.lineWidth = 1.2;
          if (horiz) { ctx.strokeRect(px, py + T * .22, T, T * .56); line(ctx, px + T * .5, py + T * .22, px + T * .5, py + T * .78, 'rgba(255,255,255,.55)', 1); }
          else { ctx.strokeRect(px + T * .22, py, T * .56, T); line(ctx, px + T * .22, py + T * .5, px + T * .78, py + T * .5, 'rgba(255,255,255,.55)', 1); }
        } else if (ch === 'L') {
          ctx.fillStyle = '#6b5334'; ctx.fillRect(px, py, T + .6, T + .6);
          ctx.strokeStyle = '#40301b'; ctx.lineWidth = 1.5; ctx.strokeRect(px + 1, py + 1, T - 2, T - 2);
          circle(ctx, px + T * .5, py + T * .5, T * .16, '#d8b24a', '#8b6f22');
          line(ctx, px + T * .5, py + T * .5, px + T * .5, py + T * .72, '#8b6f22', 2);
        } else {
          ctx.fillStyle = C.wall; ctx.fillRect(px, py, T + .6, T + .6);
          ctx.fillStyle = C.wallTop;                                  // lit top edge
          if (!isSolid(x, y - 1)) ctx.fillRect(px, py, T + .6, T * .26);
          ctx.fillStyle = 'rgba(0,0,0,.16)';
          if (!isSolid(x, y + 1)) ctx.fillRect(px, py + T * .82, T + .6, T * .18);
        }
      }
    }

    /* crisp outline around every wall run — this is the "where are the walls" pass */
    ctx.save();
    ctx.strokeStyle = o.walls ? C.hi : C.wallLine;
    ctx.lineWidth = o.walls ? 2 : 1.2;
    if (o.walls) { ctx.shadowColor = C.hiGlow; ctx.shadowBlur = 6; }
    ctx.beginPath();
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (!isSolid(x, y)) continue;
        const px = x * T, py = y * T;
        if (!isSolid(x, y - 1)) { ctx.moveTo(px, py + .5); ctx.lineTo(px + T, py + .5); }
        if (!isSolid(x, y + 1)) { ctx.moveTo(px, py + T - .5); ctx.lineTo(px + T, py + T - .5); }
        if (!isSolid(x - 1, y)) { ctx.moveTo(px + .5, py); ctx.lineTo(px + .5, py + T); }
        if (!isSolid(x + 1, y)) { ctx.moveTo(px + T - .5, py); ctx.lineTo(px + T - .5, py + T); }
      }
    ctx.stroke();
    ctx.restore();

    /* doors, drawn in the gap with a swing arc */
    for (const op of map.openings || []) {
      const w = op.w || 1, h = op.h || 1, px = op.x * T, py = op.y * T;
      const horiz = op.axis ? op.axis === 'h' : w >= h;
      if (op.t === 'door') {
        ctx.fillStyle = 'rgba(120,90,50,.20)'; ctx.fillRect(px, py, w * T, h * T);
        ctx.strokeStyle = 'rgba(80,60,35,.55)'; ctx.lineWidth = 1.2;
        ctx.beginPath();
        if (horiz) { ctx.arc(px, py + h * T, w * T * .95, -Math.PI / 2, 0); } else { ctx.arc(px + w * T, py, h * T * .95, Math.PI / 2, Math.PI); }
        ctx.stroke();
        ctx.save(); ctx.translate(px, py);
        if (horiz) box(ctx, 0, h * T * .18, w * T * .92, h * T * .42, C.wood, '#5b4522', 1.5);
        else box(ctx, w * T * .18, 0, w * T * .42, h * T * .92, C.wood, '#5b4522', 1.5);
        ctx.restore();
      } else if (op.t === 'open') {
        ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(px, py, w * T, h * T);
        ctx.strokeStyle = 'rgba(60,66,78,.5)'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.2;
        ctx.strokeRect(px + .5, py + .5, w * T - 1, h * T - 1); ctx.setLineDash([]);
      } else if (op.t === 'vent') {
        box(ctx, px + 2, py + 2, w * T - 4, h * T - 4, '#7c848f', '#4b525b', 2);
        for (let i = 1; i < 4; i++) line(ctx, px + 3, py + (h * T / 4) * i, px + w * T - 3, py + (h * T / 4) * i, '#4b525b', 1.2);
      } else if (op.t === 'exit') {
        ctx.fillStyle = 'rgba(90,200,120,.35)'; ctx.fillRect(px, py, w * T, h * T);
        ctx.strokeStyle = '#3fae63'; ctx.lineWidth = 2; ctx.strokeRect(px + 1, py + 1, w * T - 2, h * T - 2);
        label(ctx, 'EXIT', px + w * T / 2, py + h * T / 2, Math.min(T * .5, 11), '#0f5c2c');
      } else if (op.t === 'stairs') {
        P.stairs(ctx, px, py, w * T, h * T, { d: horiz ? 'h' : 'v' });
      } else if (op.t === 'elevator') {
        box(ctx, px, py, w * T, h * T, '#8b939f', '#5a626d', 2);
        line(ctx, px + w * T / 2, py, px + w * T / 2, py + h * T, '#5a626d', 2);
      }
    }

    /* props */
    if (o.props) {
      const order = { rug: 0, 'rug-round': 0, mat: 0, doormat: 0, camera: 1,
                      'lamp-ceiling': 7, chandelier: 7, sleeper: 9, player: 9 };
      const list = (map.props || []).slice().sort((a, b) => (order[a.t] ?? 5) - (order[b.t] ?? 5));
      for (const pr of list) {
        const fn = P[pr.t];
        const w = (pr.w || defaultSize(pr.t)[0]) * T, h = (pr.h || defaultSize(pr.t)[1]) * T;
        if (!fn) { box(ctx, pr.x * T, pr.y * T, w, h, '#c76', '#853', 2); continue; }
        ctx.save();
        fn(ctx, pr.x * T, pr.y * T, w, h, pr, T);
        ctx.restore();
      }
    }

    /* ceiling lamps sit above everything else */
    /* (already drawn in props pass — kept simple on purpose) */

    /* spawn + sleeper markers */
    if (map.spawn) P.player(ctx, map.spawn.x * T, map.spawn.y * T, T * .9, T * .9, {}, T);

    /* grid */
    if (o.grid) {
      ctx.strokeStyle = 'rgba(0,0,0,.13)'; ctx.lineWidth = .6;
      ctx.beginPath();
      for (let x = 0; x <= W; x++) { ctx.moveTo(x * T, 0); ctx.lineTo(x * T, H * T); }
      for (let y = 0; y <= H; y++) { ctx.moveTo(0, y * T); ctx.lineTo(W * T, y * T); }
      ctx.stroke();
    }

    /* room name plates on top */
    if (o.labels) {
      for (const r of map.rooms) {
        const cx = (r.x + r.w / 2) * T, cy = (r.y + 0.62) * T;
        const txt = r.name;
        ctx.font = `700 ${Math.min(T * .62, 13)}px ui-sans-serif, system-ui, sans-serif`;
        const tw = ctx.measureText(txt).width;
        box(ctx, cx - tw / 2 - 6, cy - Math.min(T * .45, 10), tw + 12, Math.min(T * .9, 20), 'rgba(22,26,34,.82)', 'rgba(255,255,255,.22)', 5);
        label(ctx, txt, cx, cy, Math.min(T * .62, 13), '#eef2f8');
      }
    }
    return { width: pxW, height: pxH };
  }

  function defaultSize(t) {
    const S = {
      chair: [1, 1], 'office-chair': [1.2, 1.2], stool: [.9, .9], plant: [1.2, 1.2], 'plant-big': [1.5, 1.5],
      lamp: [.8, .8], 'lamp-table': [.8, .8], 'lamp-floor': [1, 1], sconce: [.6, .5], candle: [.5, .5],
      vase: [.9, .9], mug: [.5, .5], papers: [.8, .8], book: [.7, .7], trash: [.9, .9], register: [.9, .9],
      extinguisher: [.7, .9], 'coat-rack': [1, 1], camera: [.9, .9], turnstile: [1.1, 1.1], tray: [.7, .5],
      monitor: [.9, .6], computer: [.9, .6], clock: [.9, .9], tree: [2, 2], mirror: [.4, 1.6], iv: [.7, 1.6],
      laptop: [1, 1], keys: [.8, .8], 'water-cooler': [1, 1.2], kettle: [.7, .7], projector: [1.1, .6],
      microwave: [1.4, .9], suitcase: [1.2, .9], ball: [.8, .8], broom: [1, 1.2], bucket: [.8, .8],
      teddy: [.9, .9], blocks: [.9, .9], cat: [1, .8], pram: [1.6, 1.2],
      phone: [.7, .6], wheelchair: [1.3, 1.3], globe: [.9, .9], 'grandfather-clock': [1.2, 2.4],
      'stove-wood': [2, 1.6], jars: [2, .8], sewing: [1.6, 1],
      umbrella: [.9, .9],
      sleeper: [1.4, 1.4], player: [1, 1], nightlight: [.5, .5], hoop: [1.4, 1.4], sign: [2, .6], doormat: [1.6, 1],
    };
    return S[t] || [2, 1.4];
  }

  global.DWHRenderer = { draw, TILE_COLORS: C, PROPS: P, defaultSize };
})(window);
