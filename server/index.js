import express from 'express';
import compression from 'compression';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAddress, isAddress, parseUnits, formatUnits } from 'viem';
import { Tower } from './tower.js';
import { Assets } from './assets.js';
import { scanOwners, ensureFresh, ownedBy, ownerOf, checkSignature, readBurn, owners, CHOG_TOKEN, BURN, CHOG_NFT } from './chain.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +process.env.PORT || 8787;
const DATA_DIR = process.env.DATA_DIR || path.join(root, 'data', 'runtime');
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const PRICES = { gust: process.env.PRICE_GUST || '500', quake: process.env.PRICE_QUAKE || '1500' }; // whole $CHOG
// Local testing only (NODE_ENV=development): pretend these addresses hold these Chogs, e.g. {"0xabc...":[12,99]}
const devFile = path.join(root, 'data', 'dev-owners.json');
const DEV_OWNERS = process.env.NODE_ENV === 'development' && fs.existsSync(devFile) ? JSON.parse(fs.readFileSync(devFile, 'utf8')) : {};

const assets = new Assets(root, DATA_DIR);
const chogs = assets.chogs;
const tower = new Tower(DATA_DIR, chogs);

const app = express();
app.use(compression());
app.use(express.json({ limit: '16kb' }));

// ---------- sessions ----------
const nonces = new Map();
const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
function issue(addr) {
  const body = `${addr}.${Date.now() + 7 * 864e5}`;
  return `${Buffer.from(body).toString('base64url')}.${sign(body)}`;
}
function who(req) {
  const tok = (req.headers.authorization || '').replace(/^Bearer /, '');
  const [b, sig] = tok.split('.');
  if (!b || !sig) return null;
  const body = Buffer.from(b, 'base64url').toString();
  if (sign(body) !== sig) return null;
  const [addr, exp] = body.split('.');
  return Date.now() < +exp ? addr : null;
}
const devOwned = addr => Object.entries(DEV_OWNERS).find(([a]) => a.toLowerCase() === addr.toLowerCase())?.[1] || null;
function mine(addr) {
  return devOwned(addr) || ownedBy(addr);
}
async function owns(addr, id) {
  const d = devOwned(addr);
  if (d) return d.includes(id);
  return (await ownerOf(id)) === getAddress(addr);
}

const fail = (res, e) => res.status(e.code || 400).json({ error: e.shortMessage || e.message || String(e) });

app.get('/api/nonce', (req, res) => {
  const n = crypto.randomBytes(12).toString('hex');
  nonces.set(n, Date.now());
  res.json({ nonce: n, message: `Chog Stack sign-in\n\nSign to prove which Chogs you hold. This costs nothing.\n\nNonce: ${n}` });
});

app.post('/api/login', async (req, res) => {
  try {
    const { address, signature, nonce } = req.body || {};
    if (!isAddress(address) || !nonces.has(nonce)) throw new Error('Sign-in expired, try again');
    nonces.delete(nonce);
    const message = `Chog Stack sign-in\n\nSign to prove which Chogs you hold. This costs nothing.\n\nNonce: ${nonce}`;
    if (!(await checkSignature(address, message, signature))) throw new Error('Signature did not match');
    await ensureFresh(30_000);
    const addr = getAddress(address);
    res.json({ token: issue(addr), address: addr });
  } catch (e) { fail(res, e); }
});

// Local testing only (never in production): sign in as a DEV_OWNERS address without a wallet.
if (Object.keys(DEV_OWNERS).length) {
  app.post('/api/dev-login', (req, res) => {
    const addr = Object.keys(DEV_OWNERS).find(a => a.toLowerCase() === String(req.body?.address).toLowerCase());
    if (!addr) return res.status(404).json({ error: 'not a dev owner' });
    res.json({ token: issue(getAddress(addr)), address: getAddress(addr) });
  });
}

app.get('/api/me', async (req, res) => {
  const addr = who(req);
  if (!addr) return res.status(401).json({ error: 'Not signed in' });
  await ensureFresh(90_000);
  const ids = mine(addr);
  await Promise.all(ids.slice(0, 60).map(id => assets.ensureMeta(id).catch(() => null)));
  res.json({
    address: addr, holder: tower.s.holders[addr] || null,
    chogs: ids.map(id => ({ t: id, used: tower.usedToday(id), stats: tower.s.stats[id] || null, chog: chogs[id] })),
  });
});

app.post('/api/drop', async (req, res) => {
  const addr = who(req);
  if (!addr) return res.status(401).json({ error: 'Sign in with your wallet first' });
  try {
    const { tokenId, x, angle, vx } = req.body || {};
    const id = +tokenId;
    if (!(id >= 1 && id <= 1969)) throw new Error('Unknown Chog');
    if (!(await owns(addr, id))) throw Object.assign(new Error(`You don't hold Chog #${id}`), { code: 403 });
    // the block's shape comes from its traits, so they must be known before it touches the tower
    if ((await assets.ensureMeta(id)).pending) throw Object.assign(new Error("Couldn't load this Chog's traits from IPFS yet. Try again in a moment."), { code: 503 });
    const ev = await tower.drop(addr, id, x, angle, vx);
    res.json({ ok: true, seq: ev.seq, missed: ev.missed, newSummit: ev.newSummit, collapse: ev.collapse });
  } catch (e) { fail(res, e); }
});

app.post('/api/sabotage', async (req, res) => {
  try {
    const { tx, kind } = req.body || {};
    if (!['gust', 'quake'].includes(kind)) throw new Error('Unknown sabotage');
    if (!/^0x[0-9a-fA-F]{64}$/.test(tx || '')) throw new Error('Bad transaction hash');
    if (tower.s.burns.txs[tx]) throw new Error('That burn was already used');
    const { from, amount } = await readBurn(tx);
    if (amount < parseUnits(PRICES[kind], 18)) throw new Error(`A ${kind} costs ${PRICES[kind]} $CHOG`);
    const ev = await tower.sabotage(kind, from, amount, tx);
    res.json({ ok: true, seq: ev.seq, collapse: ev.collapse });
  } catch (e) { fail(res, e); }
});

app.post('/api/arcade', (req, res) => {
  const { name, m, tokens } = req.body || {};
  const score = +m;
  if (!(score > 0 && score < 400) || !Array.isArray(tokens)) return res.status(400).json({ error: 'bad score' });
  res.json({ rank: tower.addArcade(name, score, tokens.map(Number).filter(n => n >= 1 && n <= 1969)) });
});

app.get('/api/state', (req, res) => res.json(tower.publicState()));

app.get('/api/config', (req, res) => res.json({ prices: PRICES, chogToken: CHOG_TOKEN, burn: BURN, nft: CHOG_NFT, chainId: 143 }));

app.get('/api/chog/:id', async (req, res) => {
  const id = +req.params.id;
  if (!chogs[id]) return res.status(404).json({ error: 'no such chog' });
  await assets.ensureMeta(id).catch(() => null);
  res.json({ t: id, ...chogs[id], stats: tower.s.stats[id] || null, owner: owners.get(id) || null, usedToday: tower.usedToday(id) });
});

app.get('/api/events', (req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.write(`retry: 2000\n\n`);
  const send = ev => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  tower.listeners.add(send);
  const ping = setInterval(() => res.write(`: ping\n\n`), 20_000);
  req.on('close', () => { clearInterval(ping); tower.listeners.delete(send); });
});

app.get('/chogs.json', (req, res) => {
  res.set('cache-control', 'public, max-age=120');
  res.json(chogs);
});
app.get('/art/:file', async (req, res) => {
  const n = parseInt(req.params.file, 10);
  if (!(n >= 1 && n <= 1969)) return res.status(404).end();
  const f = await assets.ensureArt(n).catch(() => null);
  if (!f) return res.status(404).end();
  res.set('cache-control', 'public, max-age=604800, immutable');
  res.sendFile(f);
});
const dist = path.join(root, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: 'index.html' }));
  app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => console.log(`chogstack on :${PORT}, season ${tower.s.season.n}, ${tower.engine.world.bodies.length - 1} pieces`));
scanOwners().then(() => console.log('owners indexed', owners.size)).catch(e => console.error('scan failed', e.shortMessage || e.message));
setInterval(() => scanOwners().catch(() => {}), 180_000);
setInterval(() => tower.tick().catch(e => console.error('tick', e)), 30_000);
if (process.env.WARM !== '0') setTimeout(() => assets.warm().catch(e => console.error('warm', e.message)), 5000);
export { formatUnits };
