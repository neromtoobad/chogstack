import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Tower } from '../server/tower.js';
const chogs = JSON.parse(fs.readFileSync('data/chogs.json'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-'));
const tw = new Tower(dir, chogs);
const evs = []; tw.listeners.add(e => evs.push(e));
let t = 1;
for (let i = 0; i < 120 && tw.s.history.length < 2; i++) {
  if (Date.now() < tw.s.season.openAt) tw.s.season.openAt = 0; // skip the rebuild pause in tests
  const sm = tw.summitInfo();
  const x = (sm ? tw.engine.world.bodies.find(b => b.plugin?.pieceId === sm.id).position.x : 0) + (Math.random() - .5) * 30;
  const ev = await tw.drop('0xA', t++, x, 0, 0);
  if (ev.collapse) console.log(`drop ${i + 1}: COLLAPSE season ${ev.collapse.season} winner #${ev.collapse.winner?.t} shame #${ev.collapse.shame.tokenId} peak ${ev.collapse.peakM.toFixed(1)}m after ${ev.collapse.drops} drops`);
}
const sab = await tw.sabotage('quake', '0xB', 1500n * 10n ** 18n, '0x' + 'ab'.repeat(32));
console.log('quake knocked', sab.knocked.length, 'h', sab.height.toFixed(1), 'collapse', !!sab.collapse);
try { await tw.sabotage('quake', '0xB', 1n, '0x' + 'ab'.repeat(32)); } catch (e) { console.log('replay blocked:', e.message); }
try { await tw.drop('0xA', 1, 0, 0, 0); } catch (e) { console.log('daily limit:', e.message); }
console.log('boards', JSON.stringify(tw.boards()).slice(0, 300));
console.log('state size', fs.statSync(path.join(dir, 'state.json')).size, 'events', evs.length);
// restart from disk keeps the tower
const tw2 = new Tower(dir, chogs);
console.log('reload pieces', tw2.engine.world.bodies.length - 1, 'season', tw2.s.season.n);
