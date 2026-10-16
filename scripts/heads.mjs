import fs from 'node:fs';
import { headKind, shapeFor } from '../shared/physics.js';
const c = JSON.parse(fs.readFileSync('data/chogs.json'));
const by = {};
for (const v of Object.values(c)) { const h = v.traits.Head || '(none)'; by[h] = by[h] || { n: 0, k: headKind(v.traits) }; by[h].n++; }
const groups = {};
for (const [h, { n, k }] of Object.entries(by)) (groups[k] ||= []).push(`${h}(${n})`);
for (const [k, l] of Object.entries(groups)) console.log(k.toUpperCase(), l.length, ':', l.join(', '));
const kinds = {}; for (const [id, v] of Object.entries(c)) { const s = shapeFor(+id, v); kinds[s.kind] = (kinds[s.kind] || 0) + 1; } console.log(kinds);
