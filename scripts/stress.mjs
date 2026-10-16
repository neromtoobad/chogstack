import fs from 'node:fs';
import { createEngine, makePiece, simulate, removeFallen, heightM, towerTop, pieces, shapeFor, Matter } from '../shared/physics.js';
const chogs = JSON.parse(fs.readFileSync('data/chogs.json'));
const ids = Object.keys(chogs).map(Number);
const kinds = {}; const mats = {};
for (const id of ids) { const s = shapeFor(id, chogs[id]); kinds[s.kind] = (kinds[s.kind] || 0) + 1; mats[s.mat.kind] = (mats[s.mat.kind] || 0) + 1; }
console.log('kinds', kinds, 'mats', mats);
const e = createEngine();
let fell = 0;
for (let i = 0; i < 40; i++) {
  const t = ids[Math.floor(Math.random() * ids.length)];
  const b = makePiece(i + 1, t, chogs[t], (Math.random() - .5) * 60, towerTop(e) - 250, 0);
  Matter.Composite.add(e.world, b);
  const t0 = performance.now();
  const fr = simulate(e, { maxSteps: 720 });
  const g = removeFallen(e); fell += g.length;
  if (i % 5 === 4) console.log(`drop ${i + 1}: h=${heightM(e).toFixed(2)}m pieces=${pieces(e).length} fell=${g.length} steps=${fr.length * 2} ${Math.round(performance.now() - t0)}ms json=${JSON.stringify(fr).length}`);
}
console.log('total fell', fell);
