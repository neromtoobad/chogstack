import fs from 'node:fs';
import { createEngine, makePiece, simulate, removeFallen, heightM, towerTop, pieces, Matter } from '../shared/physics.js';
const chogs = JSON.parse(fs.readFileSync('data/chogs.json'));
const forced = process.argv[2];
const fake = { traits: { Head: { flat: 'Red Headband', cap: 'Mon Cap', spike: 'Crown', bucket: 'Blue Bucket Cap', dome: 'Afro', ears: 'None', tall: 'Top Hat' }[forced], Side: 'Left', Tier: 'Common' } };
if (forced === 'box') fake.traits = { Tier: 'Common', Head: 'Red Headband' };
const e = createEngine(); let fell = 0;
for (let i = 0; i < 20; i++) {
  const b = makePiece(i + 1, 5, fake, 0, towerTop(e) - 250, 0);
  if (forced === 'box') { /* plain rectangle baseline */ Matter.Composite.add(e.world, Matter.Bodies.rectangle(0, towerTop(e) - 250, 100, 74, { label: 'piece', plugin: { pieceId: i + 1 }, friction: .85 })); }
  else Matter.Composite.add(e.world, b);
  simulate(e, { maxSteps: 720 }); const g = removeFallen(e); fell += g.length;
}
console.log(forced, 'fell', fell, 'h', heightM(e).toFixed(1), 'n', pieces(e).length);
