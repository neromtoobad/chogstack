// Local physics modes.
// Arcade "Daily Stack": everyone gets the same Chog order today; 3 lives; score = peak height.
// Practice: a private copy of the live tower to try drops on; nothing counts.
import { createEngine, makePiece, restore, pieces, towerTop, heightM, removeFallen, summit, SUB, Matter as M } from '../shared/physics.js';
const { Engine, Composite, Body, Events } = M;

export const today = () => new Date().toISOString().slice(0, 10);

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function dailyOrder(day = today(), n = 300) {
  const seed = [...day].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);
  const r = rng(seed), out = [];
  while (out.length < n) out.push(1 + Math.floor(r() * 1969));
  return out;
}

export class LocalGame {
  constructor(chogs, hooks, { practice = false, snapshot = [] } = {}) {
    this.chogs = chogs; this.hooks = hooks; this.practice = practice;
    this.engine = createEngine();
    if (practice && snapshot.length) restore(this.engine, snapshot, chogs);
    this.nextId = 100000; this.acc = 0;
    this.lives = 3; this.peak = heightM(this.engine); this.startH = this.peak;
    this.order = dailyOrder(); this.turn = 0; this.used = [];
    this.active = null; this.state = 'aim'; this.wait = 0; this.combo = 0; this.over = false;
    this.wind = 0; this.windT = 0;
    const sm0 = summit(this.engine);
    this.summitBefore = sm0 ? { x: sm0.position.x, top: sm0.bounds.min.y } : null;
    Events.on(this.engine, 'collisionStart', e => {
      for (const p of e.pairs) {
        const b = [p.bodyA.parent, p.bodyB.parent].find(x => x === this.active);
        if (b && !b.plugin.hit) {
          const sp = b.speed;
          if (sp > 2) { b.plugin.hit = true; this.hooks.onImpact?.(b, sp); }
        }
      }
    });
  }

  nextToken() { return this.order[this.turn % this.order.length]; }
  top() { return towerTop(this.engine); }
  height() { return heightM(this.engine); }

  release(token, x, angle, vx) {
    if (this.state !== 'aim' || this.over) return false;
    const id = this.nextId++;
    const b = makePiece(id, token, this.chogs[token], x, this.top() - 250, angle);
    Body.setVelocity(b, { x: vx, y: 0 });
    Composite.add(this.engine.world, b);
    this.active = b; this.state = 'fall'; this.wait = 0;
    this.used.push(token);
    if (!this.practice) this.turn++;
    return true;
  }

  update(dt) {
    if (this.over) return;
    this.acc += Math.min(dt, 0.05);
    const step = 1 / 60;
    while (this.acc >= step) {
      this.acc -= step;
      // arcade wind kicks in above 8 m and grows with height
      if (!this.practice && this.peak > 8) {
        this.windT -= step;
        if (this.windT <= 0) { this.wind = (Math.random() - .5) * Math.min(1, (this.peak - 8) / 20); this.windT = 3 + Math.random() * 3; this.hooks.onWind?.(this.wind); }
        if (Math.abs(this.wind) > 0.05) for (const b of pieces(this.engine)) if (!b.isSleeping && b.position.y < -80) Body.applyForce(b, b.position, { x: this.wind * 0.00012 * b.mass, y: 0 });
      }
      for (let k = 0; k < SUB; k++) Engine.update(this.engine, 1000 / 60 / SUB);
    }
    if (this.state === 'fall') {
      this.wait += dt;
      const b = this.active;
      const settled = b && (b.isSleeping || (b.speed < 0.15 && b.angularSpeed < 0.01 && this.wait > 0.6));
      if (settled || this.wait > 4.5 || (b && b.position.y > 420)) this.endTurn();
    } else {
      // pieces can still slide off between turns
      const gone = removeFallen(this.engine);
      if (gone.length) this.lose(gone, false);
    }
  }

  endTurn() {
    const b = this.active; this.active = null; this.state = 'aim';
    const gone = removeFallen(this.engine);
    const missed = gone.includes(b);
    const h = this.height();
    let perfect = false;
    if (!missed && this.summitBefore) {
      const s = this.summitBefore;
      perfect = Math.abs(b.position.x - s.x) < 9 && b.bounds.min.y < s.top;
    }
    if (perfect) { this.combo++; Body.set(b, { friction: 1, frictionStatic: 2 }); } else this.combo = 0;
    const newPeak = h > this.peak + 0.01;
    this.peak = Math.max(this.peak, h);
    const sm = summit(this.engine);
    this.summitBefore = sm ? { x: sm.position.x, top: sm.bounds.min.y } : null;
    this.hooks.onTurn?.({ missed, perfect, combo: this.combo, height: h, newPeak, gone: gone.length });
    if (gone.length) this.lose(gone, true);
  }

  lose(gone, fromTurn) {
    if (this.practice) { this.hooks.onLost?.(gone.length, Infinity); return; }
    const collapse = gone.length >= 3;
    this.lives -= collapse ? this.lives : Math.min(gone.length, this.lives);
    this.hooks.onLost?.(gone.length, this.lives, collapse);
    if (this.lives <= 0) { this.over = true; this.hooks.onOver?.({ m: this.peak, tokens: this.used }); }
  }
}
