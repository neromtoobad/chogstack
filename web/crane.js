// The swinging crane every mode shares. It sweeps the hook across the site; DROP lets go.
import { makePiece, SWEEP, DROP_GAP, Matter } from '../shared/physics.js';
const { Body } = Matter;

export class Crane {
  constructor(chogs) { this.chogs = chogs; this.phase = Math.random() * 6; this.angle = 0; this.token = null; this.body = null; this.speed = 1; this.hidden = false; this.alpha = 0; }
  set(token) {
    if (token === this.token && this.body) return;
    this.token = token; this.body = token ? makePiece(-1, token, this.chogs[token], 0, 0, 0) : null;
    this.alpha = 0; this.lastAngle = null;
  }
  rotate(dir) { this.angle = Math.round((this.angle + dir * Math.PI / 12) / (Math.PI / 12)) * (Math.PI / 12); if (Math.abs(this.angle) > Math.PI) this.angle -= Math.sign(this.angle) * Math.PI * 2; }
  omega() { return (2 * Math.PI / 2.9) * this.speed; }
  get x() { return Math.sin(this.phase) * SWEEP; }
  // pieces fall straight down from the hook: the skill is timing, and the guide line tells the truth
  get vx() { return 0; }
  update(dt, top) {
    this.phase += dt * this.omega();
    this.top = top;
    this.alpha = Math.min(1, this.alpha + dt * 3);
    if (this.body) {
      const y = top - DROP_GAP;
      // place core centre at (x, y): body.position = core + offset, rotated
      const c = this.body.plugin.core, a = this.angle;
      const ox = -(c.x * Math.cos(a) - c.y * Math.sin(a)), oy = -(c.x * Math.sin(a) + c.y * Math.cos(a));
      Body.setAngle(this.body, a);
      Body.setPosition(this.body, { x: this.x + ox, y: y + oy });
    }
  }
  view() {
    if (this.hidden) return { x: this.x, y: (this.top ?? 0) - DROP_GAP - 105, body: null };
    return { x: this.x, y: (this.top ?? 0) - DROP_GAP - 105, body: this.body, alpha: this.alpha };
  }
}
