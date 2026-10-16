// Live tower: mirrors the server. Never simulates; it replays the frames the server recorded.
import { createEngine, makePiece, restore, pieces, towerTop, heightM, Matter } from '../shared/physics.js';
const { Composite, Body } = Matter;
const FPS = 30; // server samples every 2nd 60 Hz step

export class Live {
  constructor(chogs, hooks) {
    this.chogs = chogs; this.hooks = hooks; // { onEventStart, onEventEnd, onImpact }
    this.engine = createEngine(); this.queue = []; this.anim = null; this.seq = 0;
    this.state = null; this.meta = {};
  }

  load(state) {
    this.state = state; this.seq = state.seq; this.queue = []; this.anim = null;
    this.engine = createEngine();
    restore(this.engine, state.pieces, this.chogs);
    this.meta = Object.fromEntries(state.pieces.map(p => [p.id, { owner: p.owner }]));
    for (const b of pieces(this.engine)) this.mark(b);
  }

  mark(b) { b.plugin.ax = b.position.x; b.plugin.ay = b.position.y; b.plugin.aa = b.angle; }

  push(ev) {
    if (ev.seq <= this.seq) return;
    this.seq = ev.seq;
    this.queue.push(ev);
  }

  get busy() { return !!this.anim || this.queue.length > 0; }
  top() { return towerTop(this.engine); }
  height() { return heightM(this.engine); }
  byId(id) { return pieces(this.engine).find(b => b.plugin.pieceId === id); }

  start(ev) {
    if (ev.type === 'drop') {
      const p = ev.piece;
      const b = makePiece(p.id, p.t, this.chogs[p.t], 0, 0, 0);
      Body.setPosition(b, { x: p.x, y: p.y }); Body.setAngle(b, p.a);
      Composite.add(this.engine.world, b); this.mark(b);
      this.meta[p.id] = { owner: p.owner };
    }
    this.anim = { ev, t: 0, applied: -1, impact: false, lastVy: 0 };
    this.hooks.onEventStart?.(ev);
  }

  update(dt) {
    if (!this.anim && this.queue.length) this.start(this.queue.shift());
    const a = this.anim;
    if (!a) return;
    const speed = this.queue.length > 1 ? 3 : 1;
    a.t += dt * speed;
    const frames = a.ev.frames || [];
    const f = a.t * FPS, k = Math.floor(f), frac = f - k;
    const map = new Map(pieces(this.engine).map(b => [b.plugin.pieceId, b]));
    for (let i = a.applied + 1; i <= Math.min(k, frames.length - 1); i++) {
      const fr = frames[i];
      for (let j = 0; j < fr.length; j += 4) {
        const b = map.get(fr[j]); if (!b) continue;
        if (a.ev.type === 'drop' && fr[j] === a.ev.piece.id) {
          const vy = fr[j + 2] - b.plugin.ay;
          if (!a.impact && a.lastVy > 6 && vy < a.lastVy * 0.4) { a.impact = true; this.hooks.onImpact?.(b, a.lastVy); }
          a.lastVy = vy;
        }
        b.plugin.ax = fr[j + 1]; b.plugin.ay = fr[j + 2]; b.plugin.aa = fr[j + 3];
      }
      a.applied = i;
    }
    // draw positions: lerp toward the next frame
    const next = frames[a.applied + 1];
    const nmap = new Map();
    if (next) for (let j = 0; j < next.length; j += 4) nmap.set(next[j], j);
    for (const b of map.values()) {
      const j = nmap.get(b.plugin.pieceId);
      let x = b.plugin.ax, y = b.plugin.ay, ang = b.plugin.aa;
      if (j !== undefined) { x += (next[j + 1] - x) * frac; y += (next[j + 2] - y) * frac; ang += (next[j + 3] - ang) * frac; }
      Body.setPosition(b, { x, y }); Body.setAngle(b, ang);
    }
    if (a.applied >= frames.length - 1) this.finish();
  }

  finish() {
    const ev = this.anim.ev;
    for (const b of pieces(this.engine)) { Body.setPosition(b, { x: b.plugin.ax, y: b.plugin.ay }); Body.setAngle(b, b.plugin.aa); }
    const gone = new Set(ev.fallen || []);
    for (const b of pieces(this.engine)) if (gone.has(b.plugin.pieceId)) Composite.remove(this.engine.world, b);
    this.anim = null;
    this.hooks.onEventEnd?.(ev);
    if (ev.collapse || ev.type === 'season') {
      for (const b of pieces(this.engine)) Composite.remove(this.engine.world, b);
      this.meta = {};
    }
  }
}
