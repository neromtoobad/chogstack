// Chog metadata + art. The repo ships what we could pull ahead of time; anything missing is
// fetched from IPFS on first use (and by a slow background warmer), then cached in DATA_DIR.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const META = 'bafybeid4ybujnscdipkno7ps5utqelp5ry5ryreqhay3zhgk3a6x4jruqu';
const IMG = 'bafybeihau2egcccbdxymeckmmbrqytbfor5gkt3en6d5fsbueymdbq7g6e';
const GWS = (process.env.IPFS_GATEWAYS || 'https://ipfs.filebase.io/ipfs,https://gateway.pinata.cloud/ipfs').split(',');
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class Assets {
  constructor(root, dataDir) {
    this.baseArt = path.join(root, 'public', 'art');
    this.cacheArt = path.join(dataDir, 'art');
    this.extraFile = path.join(dataDir, 'chogs-extra.json');
    fs.mkdirSync(this.cacheArt, { recursive: true });
    this.uris = JSON.parse(fs.readFileSync(path.join(root, 'data', 'uris.json'), 'utf8'));
    this.chogs = JSON.parse(fs.readFileSync(path.join(root, 'data', 'chogs.json'), 'utf8'));
    if (fs.existsSync(this.extraFile)) Object.assign(this.chogs, JSON.parse(fs.readFileSync(this.extraFile, 'utf8')));
    this.extra = {};
    this.cool = GWS.map(() => 0);
    this.inflight = new Map();
    this.version = Date.now();
    // placeholder entries keep the art number for tokens whose traits we don't have yet
    for (const [id, n] of Object.entries(this.uris)) if (!this.chogs[id]) this.chogs[id] = { n, name: `CHOG #${n}`, traits: {}, pending: true };
  }

  missingMeta() { return Object.keys(this.chogs).filter(id => this.chogs[id].pending).map(Number); }
  artFile(n) {
    const a = path.join(this.baseArt, `${n}.webp`);
    if (fs.existsSync(a)) return a;
    const b = path.join(this.cacheArt, `${n}.webp`);
    return fs.existsSync(b) ? b : null;
  }

  async get(p) {
    for (let t = 0; t < GWS.length * 3; t++) {
      const g = t % GWS.length;
      const wait = this.cool[g] - Date.now();
      if (wait > 0) { if (t >= GWS.length) await sleep(Math.min(wait, 8000)); else continue; }
      try {
        const r = await fetch(`${GWS[g]}/${p}`, { signal: AbortSignal.timeout(30000) });
        if (r.ok) return Buffer.from(await r.arrayBuffer());
        if (r.status === 429) this.cool[g] = Date.now() + 10000;
      } catch { /* timeout or network: try the next gateway */ }
    }
    return null;
  }

  once(key, fn) {
    if (!this.inflight.has(key)) this.inflight.set(key, fn().finally(() => this.inflight.delete(key)));
    return this.inflight.get(key);
  }

  ensureMeta(id) {
    const c = this.chogs[id];
    if (!c?.pending) return Promise.resolve(c);
    return this.once(`m${id}`, async () => {
      const b = await this.get(`${META}/${c.n}.json`);
      if (!b) return c;
      const j = JSON.parse(b.toString());
      const rec = { n: c.n, name: j.name, traits: Object.fromEntries(j.attributes.map(a => [a.trait_type, a.value])) };
      this.chogs[id] = rec; this.extra[id] = rec; this.version = Date.now();
      const all = fs.existsSync(this.extraFile) ? JSON.parse(fs.readFileSync(this.extraFile, 'utf8')) : {};
      all[id] = rec;
      fs.writeFileSync(this.extraFile, JSON.stringify(all));
      return rec;
    });
  }

  ensureArt(n) {
    const f = this.artFile(n);
    if (f) return Promise.resolve(f);
    return this.once(`a${n}`, async () => {
      const b = await this.get(`${IMG}/${n}.webp`);
      if (!b) return null;
      const out = path.join(this.cacheArt, `${n}.webp`);
      await sharp(b).resize(320, 320).webp({ quality: 78 }).toFile(out);
      return out;
    });
  }

  // Background: fill every gap, one at a time, so live requests keep priority.
  async warm() {
    for (const id of this.missingMeta()) { await this.ensureMeta(id).catch(() => {}); await sleep(1500); }
    for (let n = 1; n <= 1969; n++) if (!this.artFile(n)) { await this.ensureArt(n).catch(() => {}); await sleep(1500); }
    console.log('assets warm: meta missing', this.missingMeta().length);
  }
}
