// Canvas renderer: paper + site-plan grid, elevation ruler, plinth, Chog pieces, crane.
import { PLATFORM, PX_PER_M, DROP_GAP, SWEEP, pieces } from '../shared/physics.js';

const INK = '#17141a', PAPER = '#efebdf', WALL = '#d8d6c7', PINK = '#d83e7e', SUN = '#ffc93c', MUTED = '#8a8478';

export class Art {
  constructor(chogs) { this.chogs = chogs; this.cache = new Map(); }
  url(t) { const n = this.chogs[t]?.n ?? t; return `/art/${n}.webp`; }
  get(t) {
    let im = this.cache.get(t);
    if (!im) { im = new Image(); im.decoding = 'async'; im.src = this.url(t); this.cache.set(t, im); }
    return im.complete && im.naturalWidth ? im : null;
  }
}

export class Renderer {
  constructor(canvas, art) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.art = art;
    this.cam = { y: -200, s: 1, pan: 0 }; this.offX = 0; // offX: screen px the scene centre shifts left for the side panel
    this.shake = 0; this.puffs = []; this.sparks = [];
    this.resize();
    addEventListener('resize', () => this.resize());
  }
  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.W = innerWidth; this.H = innerHeight; this.dpr = dpr;
    this.c.width = this.W * dpr; this.c.height = this.H * dpr;
    const panel = this.W >= 900 ? 332 : 0;
    this.offX = -panel / 2;
    this.cam.s = Math.max(0.42, Math.min((this.W - panel) / 760, this.H / 880, 1.25));
  }
  // world -> screen: x centred, camera y at 58% of the screen
  follow(top, dt) {
    const s = this.cam.s;
    const dockH = this.W < 560 ? 230 : 170;
    // keep the tower top at ~58% height, but never lift the ground above the dock
    let target = top - (this.H * 0.66 - this.H / 2) / s;
    const groundLimit = PLATFORM.h + 30 - (this.H - dockH - this.H / 2) / s;
    target = Math.min(target, groundLimit);
    target += this.cam.pan;
    this.cam.y += (target - this.cam.y) * Math.min(1, dt * 4);
  }
  toWorld(sx, sy) { const s = this.cam.s; return { x: (sx - this.W / 2 - this.offX) / s, y: (sy - this.H / 2) / s + this.cam.y }; }

  puff(x, y, n = 8) {
    for (let i = 0; i < n; i++) this.puffs.push({ x: x + (Math.random() - .5) * 40, y, vx: (Math.random() - .5) * 2.2, vy: -Math.random() * 1.4, r: 6 + Math.random() * 8, life: 1 });
  }
  burst(x, y, color = SUN, n = 18) {
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = 2 + Math.random() * 5; this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2, life: 1, color }); }
  }

  draw(engine, opts = {}) {
    const { ctx, W, H, dpr } = this, s = this.cam.s;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
    let sx = 0, sy = 0;
    if (this.shake > 0) { sx = (Math.random() - .5) * this.shake; sy = (Math.random() - .5) * this.shake; this.shake *= 0.9; if (this.shake < .3) this.shake = 0; }
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (W / 2 + this.offX + sx), dpr * (H / 2 - this.cam.y * s + sy));

    const vTop = this.cam.y - H / 2 / s, vBot = this.cam.y + H / 2 / s, vL = (-W / 2 - this.offX) / s, vR = (W / 2 - this.offX) / s;
    this.grid(vTop, vBot, vL, vR);
    this.ground(vBot, vL, vR, opts.label);
    this.ruler(vTop, vBot, opts.height || 0, opts.peak || 0);

    const all = pieces(engine);
    for (const b of all) this.piece(b, 1, opts.summitId === b.plugin.pieceId, opts.highlight === b.plugin.pieceId);
    if (opts.summitId) { const b = all.find(p => p.plugin.pieceId === opts.summitId); if (b) this.crown(b); }
    if (opts.crane) this.crane(opts.crane);

    // fx
    for (const p of this.puffs) { p.x += p.vx; p.y += p.vy; p.r += .5; p.life -= .03; }
    this.puffs = this.puffs.filter(p => p.life > 0);
    for (const p of this.puffs) { ctx.globalAlpha = p.life * .6; ctx.fillStyle = WALL; ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); ctx.stroke(); }
    for (const p of this.sparks) { p.x += p.vx; p.y += p.vy; p.vy += .25; p.life -= .025; }
    this.sparks = this.sparks.filter(p => p.life > 0);
    for (const p of this.sparks) { ctx.globalAlpha = Math.min(1, p.life * 1.5); ctx.fillStyle = p.color; ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.life * 6); ctx.fillRect(-4, -4, 8, 8); ctx.strokeRect(-4, -4, 8, 8); ctx.restore(); }
    ctx.globalAlpha = 1;
  }

  grid(vTop, vBot, vL, vR) {
    const { ctx } = this; const g = 40;
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(23,20,26,0.06)';
    ctx.beginPath();
    for (let x = Math.floor(vL / g) * g; x < vR; x += g) { ctx.moveTo(x, vTop); ctx.lineTo(x, Math.min(vBot, PLATFORM.h)); }
    for (let y = Math.floor(vTop / g) * g; y < Math.min(vBot, PLATFORM.h); y += g) { ctx.moveTo(vL, y); ctx.lineTo(vR, y); }
    ctx.stroke();
  }

  ground(vBot, vL, vR, label) {
    const { ctx } = this; const w = PLATFORM.w, h = PLATFORM.h;
    // street below the plinth
    ctx.fillStyle = WALL; ctx.fillRect(vL, h, vR - vL, Math.max(0, vBot - h));
    ctx.strokeStyle = 'rgba(23,20,26,.18)'; ctx.lineWidth = 2;
    for (let y = h + 26, row = 0; y < vBot; y += 26, row++) {
      ctx.beginPath(); ctx.moveTo(vL, y); ctx.lineTo(vR, y); ctx.stroke();
      for (let x = Math.floor(vL / 70) * 70 + (row % 2) * 35; x < vR; x += 70) { ctx.beginPath(); ctx.moveTo(x, y - 26); ctx.lineTo(x, y); ctx.stroke(); }
    }
    ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(vL, h); ctx.lineTo(vR, h); ctx.stroke();
    // plinth with hazard tape
    ctx.save();
    rr(ctx, -w / 2, 0, w, h, 10); ctx.fillStyle = INK; ctx.fill(); ctx.clip();
    ctx.fillStyle = PINK;
    for (let x = -w / 2 - h; x < w / 2 + h; x += 36) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 18, 0); ctx.lineTo(x + 18 - h, h); ctx.lineTo(x - h, h); ctx.fill(); }
    ctx.fillStyle = INK; rr(ctx, -w / 2 + 70, 9, w - 140, h - 18, 8); ctx.fill();
    ctx.fillStyle = PAPER; ctx.font = `22px Koulen, Impact, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label || 'CHOG STACK · SITE 001', 0, h / 2 + 2);
    ctx.restore();
    ctx.strokeStyle = INK; ctx.lineWidth = 4; rr(ctx, -w / 2, 0, w, h, 10); ctx.stroke();
  }

  ruler(vTop, vBot, height, peak) {
    const { ctx } = this; const x = -PLATFORM.w / 2 - 58;
    const top = Math.max(vTop, -(Math.max(height, peak) + 12) * PX_PER_M);
    ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, top); ctx.stroke();
    ctx.font = `700 20px Gaegu, cursive`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillStyle = INK;
    for (let m = 0; -m * PX_PER_M > top - 1; m++) {
      const y = -m * PX_PER_M;
      if (y > vBot + 40) continue;
      const major = m % 2 === 0;
      ctx.beginPath(); ctx.moveTo(x - (major ? 14 : 7), y); ctx.lineTo(x, y); ctx.stroke();
      if (major) ctx.fillText(`+${m}.0`, x - 18, y + 1);
    }
    // current height dimension line on the right
    if (height > 0.2) {
      const xr = PLATFORM.w / 2 + 48, yt = -height * PX_PER_M;
      ctx.strokeStyle = PINK; ctx.fillStyle = PINK; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(xr, 0); ctx.lineTo(xr, yt); ctx.stroke();
      for (const [yy, d] of [[0, 1], [yt, -1]]) { ctx.beginPath(); ctx.moveTo(xr, yy); ctx.lineTo(xr - 7, yy - 12 * d); ctx.lineTo(xr + 7, yy - 12 * d); ctx.fill(); ctx.beginPath(); ctx.moveTo(xr - 14, yy); ctx.lineTo(xr + 14, yy); ctx.stroke(); }
      ctx.save(); ctx.translate(xr + 22, yt / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.font = `700 24px Gaegu, cursive`; ctx.fillText(`${height.toFixed(1)} m`, 0, 0); ctx.restore();
    }
    if (peak > height + 0.5) {
      const y = -peak * PX_PER_M;
      ctx.setLineDash([8, 8]); ctx.strokeStyle = MUTED; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-PLATFORM.w / 2 - 40, y); ctx.lineTo(PLATFORM.w / 2 + 30, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = MUTED; ctx.textAlign = 'left'; ctx.font = `700 18px Gaegu, cursive`; ctx.fillText(`season peak ${peak.toFixed(1)} m`, -PLATFORM.w / 2 - 40, y - 12);
    }
  }

  piecePath(b) {
    const { ctx } = this;
    const parts = b.parts.length > 1 ? b.parts.slice(1) : [b];
    ctx.beginPath();
    for (const p of parts) {
      const v = p.vertices;
      ctx.moveTo(v[0].x, v[0].y);
      for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
      ctx.closePath();
    }
  }

  piece(b, alpha = 1, isSummit = false, hi = false) {
    const { ctx } = this; const pl = b.plugin;
    ctx.globalAlpha = alpha;
    ctx.lineJoin = 'round';
    this.piecePath(b);
    ctx.strokeStyle = hi ? PINK : INK; ctx.lineWidth = hi ? 11 : 9; ctx.stroke();
    ctx.fillStyle = WALL; ctx.fill();
    const im = this.art.get(pl.tokenId);
    if (im) {
      ctx.save(); ctx.clip();
      ctx.translate(b.position.x, b.position.y); ctx.rotate(b.angle);
      const S = Math.max(pl.w * 1.25, pl.h * 1.9);
      ctx.drawImage(im, pl.core.x - S / 2, pl.core.y - S * 0.56, S, S);
      ctx.restore();
    }
    // material hint
    if (pl.mat === 'slick' || pl.mat === 'bouncy') {
      ctx.save(); ctx.translate(b.position.x, b.position.y); ctx.rotate(b.angle);
      ctx.strokeStyle = pl.mat === 'slick' ? '#9fe3ff' : '#ffb03c'; ctx.lineWidth = 3; ctx.globalAlpha = alpha * .9;
      ctx.beginPath(); ctx.arc(pl.core.x, pl.core.y, pl.w * .52, Math.PI * 1.1, Math.PI * 1.35); ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  crown(b) {
    const { ctx } = this; const x = b.position.x, y = b.bounds.min.y - 18;
    const t = performance.now() / 300;
    ctx.save(); ctx.translate(x, y + Math.sin(t) * 3); ctx.rotate(-0.12);
    ctx.beginPath(); ctx.moveTo(-20, 8); ctx.lineTo(-22, -10); ctx.lineTo(-10, -1); ctx.lineTo(0, -16); ctx.lineTo(10, -1); ctx.lineTo(22, -10); ctx.lineTo(20, 8); ctx.closePath();
    ctx.fillStyle = SUN; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 3.5; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.restore();
  }

  // crane: { x, y (rail y), body (hanging piece) | null, angle, alpha }
  crane(c) {
    const { ctx } = this;
    const ry = c.y, vL = -SWEEP - 90, vR = SWEEP + 90;
    ctx.strokeStyle = INK; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(vL, ry); ctx.lineTo(vR, ry); ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = Math.floor(vL / 24) * 24; x < vR; x += 24) { ctx.moveTo(x, ry); ctx.lineTo(x + 12, ry - 14); ctx.lineTo(x + 24, ry); }
    ctx.moveTo(vL, ry - 14); ctx.lineTo(vR, ry - 14);
    ctx.stroke();
    // end caps
    ctx.fillStyle = INK; ctx.fillRect(vL - 6, ry - 20, 10, 28); ctx.fillRect(vR - 4, ry - 20, 10, 28);
    // trolley
    ctx.fillStyle = SUN; ctx.lineWidth = 3.5; rr(ctx, c.x - 22, ry - 8, 44, 18, 5); ctx.fill(); ctx.stroke();
    const b = c.body;
    const hookY = b ? b.bounds.min.y - 4 : ry + 60;
    ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(c.x, ry + 10); ctx.lineTo(c.x, hookY); ctx.stroke();
    ctx.beginPath(); ctx.arc(c.x, hookY - 2, 7, 0, Math.PI); ctx.stroke();
    if (b) {
      this.piece(b, c.alpha ?? 1);
      // drop guide
      ctx.setLineDash([6, 10]); ctx.strokeStyle = 'rgba(216,62,126,.55)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(b.position.x, b.bounds.max.y + 8); ctx.lineTo(b.position.x, b.bounds.max.y + DROP_GAP * 0.8); ctx.stroke(); ctx.setLineDash([]);
    }
  }
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
