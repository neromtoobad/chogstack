import fs from 'node:fs';
import { createEngine, makePiece, simulate, removeFallen, heightM, towerTop, pieces, Matter } from '../shared/physics.js';
const chogs = JSON.parse(fs.readFileSync('data/chogs.json'));
const ids = Object.keys(chogs).map(Number);
const air = +process.argv[2] || 0, spread = +(process.argv[3] ?? 20), gap = +process.argv[4] || 250;
function aimX(e) { let best = null; for (const b of pieces(e)) if (!best || b.bounds.min.y < best.bounds.min.y) best = b; return best ? best.position.x : 0; }
function run(seed) {
  let s = seed; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const e = createEngine(); let fell = 0, peak = 0;
  for (let i = 0; i < 30; i++) {
    const t = ids[Math.floor(r() * ids.length)];
    const b = makePiece(i + 1, t, chogs[t], aimX(e) + (r() - .5) * spread, towerTop(e) - gap, 0);
    b.frictionAir = air;
    Matter.Composite.add(e.world, b);
    simulate(e, { maxSteps: 720 }); fell += removeFallen(e).length; peak = Math.max(peak, heightM(e));
  }
  return { fell, peak: +peak.toFixed(1), n: pieces(e).length };
}
const rs = [1, 2, 3, 4, 5].map(run);
console.log(`air=${air} spread=${spread} gap=${gap}`, rs.map(r => `${r.fell}f/${r.peak}m/${r.n}p`).join('  '));
