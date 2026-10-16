// Fills data/chogs.json and public/art from IPFS, gently: two gateways, backoff on 429.
// usage: node scripts/fetch-all.mjs <uris.json>   (uris.json: tokenId -> art/metadata number)
import fs from 'node:fs';
import sharp from 'sharp';
const META = 'bafybeid4ybujnscdipkno7ps5utqelp5ry5ryreqhay3zhgk3a6x4jruqu';
const IMG = 'bafybeihau2egcccbdxymeckmmbrqytbfor5gkt3en6d5fsbueymdbq7g6e';
const GWS = ['https://ipfs.filebase.io/ipfs', 'https://gateway.pinata.cloud/ipfs'];
const uris = JSON.parse(fs.readFileSync(process.argv[2]));
const out = JSON.parse(fs.readFileSync('data/chogs.json'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cool = [0, 0];
async function get(path, gi) {
  for (let t = 0; t < 12; t++) {
    const g = (gi + t) % GWS.length;
    const wait = cool[g] - Date.now(); if (wait > 0) await sleep(wait);
    try {
      const r = await fetch(`${GWS[g]}/${path}`, { signal: AbortSignal.timeout(40000) });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      if (r.status === 429) cool[g] = Date.now() + 8000;
    } catch {}
    await sleep(400);
  }
  return null;
}
async function pool(items, n, fn) { let i = 0; await Promise.all([...Array(n)].map(async (_, w) => { while (i < items.length) { const it = items[i++]; await fn(it, w); } })); }

const metaTodo = Object.entries(uris).filter(([id]) => !out[id]);
console.log('meta todo', metaTodo.length);
let k = 0;
await pool(metaTodo, 4, async ([id, n], w) => {
  const b = await get(`${META}/${n}.json`, w % 2);
  if (b) { const j = JSON.parse(b.toString()); out[id] = { n, name: j.name, traits: Object.fromEntries(j.attributes.map(a => [a.trait_type, a.value])) }; }
  if (++k % 50 === 0) { fs.writeFileSync('data/chogs.json', JSON.stringify(out)); console.log('meta', k); }
});
fs.writeFileSync('data/chogs.json', JSON.stringify(out));
console.log('meta total', Object.keys(out).length);

fs.mkdirSync('public/art', { recursive: true });
const artTodo = [...Array(1969)].map((_, i) => i + 1).filter(n => !fs.existsSync(`public/art/${n}.webp`));
console.log('art todo', artTodo.length);
k = 0; const failed = [];
await pool(artTodo, 4, async (n, w) => {
  const b = await get(`${IMG}/${n}.webp`, w % 2);
  if (b) await sharp(b).resize(320, 320).webp({ quality: 78 }).toFile(`public/art/${n}.webp`); else failed.push(n);
  if (++k % 100 === 0) console.log('art', k);
});
console.log('art done, failed:', failed.join(',') || 'none');
