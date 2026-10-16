// The one shared tower. All mutations go through a single queue so drops never overlap.
import fs from 'node:fs';
import path from 'node:path';
import {
  Matter, createEngine, makePiece, simulate, removeFallen, heightM, summit, towerTop, snapshot, restore,
  pieces, quakeEffect, gustEffect, DROP_GAP, SWEEP,
} from '../shared/physics.js';

const { Composite, Body } = Matter;
const DAY = () => new Date().toISOString().slice(0, 10);
const SEASON_MS = 7 * 24 * 3600 * 1000;
const REBUILD_MS = 15_000;

export class Tower {
  constructor(dataDir, chogs) {
    this.file = path.join(dataDir, 'state.json');
    this.chogs = chogs;
    this.listeners = new Set();
    this.chain = Promise.resolve();
    fs.mkdirSync(dataDir, { recursive: true });
    this.s = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : this.fresh();
    this.engine = createEngine();
    restore(this.engine, this.s.season.snap, chogs);
  }

  fresh() {
    return {
      seq: 0, nextPiece: 1,
      season: this.newSeason(1),
      history: [], feed: [], stats: {}, holders: {}, used: { day: DAY(), ids: {} },
      burns: { total: '0', txs: {} }, arcade: [], crownDay: DAY(),
    };
  }

  newSeason(n) {
    const now = Date.now();
    return { n, startedAt: now, endsAt: now + SEASON_MS, openAt: now, snap: [], meta: {}, drops: 0, peakM: 0, sabotages: 0 };
  }

  save() {
    this.s.season.snap = snapshot(this.engine);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.s));
    fs.renameSync(tmp, this.file);
  }

  run(fn) {
    const p = this.chain.then(fn);
    this.chain = p.catch(() => {});
    return p;
  }

  emit(ev) {
    ev.seq = ++this.s.seq;
    for (const fn of this.listeners) fn(ev);
    return ev;
  }

  note(item) {
    this.s.feed.unshift({ at: Date.now(), ...item });
    this.s.feed.length = Math.min(this.s.feed.length, 60);
  }

  stat(id) {
    return (this.s.stats[id] ||= { drops: 0, landed: 0, misses: 0, knocked: 0, toppled: 0, crowns: 0, daily: 0, bestM: 0, summits: 0 });
  }

  holder(addr) {
    return (this.s.holders[addr] ||= { drops: 0, streak: 0, lastDay: null, best: 0 });
  }

  rollDay() {
    const d = DAY();
    if (this.s.used.day !== d) this.s.used = { day: d, ids: {} };
  }

  usedToday(id) {
    this.rollDay();
    return !!this.s.used.ids[id];
  }

  summitInfo() {
    const b = summit(this.engine);
    if (!b) return null;
    const m = this.s.season.meta[b.plugin.pieceId] || {};
    return { id: b.plugin.pieceId, t: b.plugin.tokenId, owner: m.owner, m: +((0 - b.bounds.min.y) / 40).toFixed(2) };
  }

  publicState() {
    const s = this.s;
    return {
      seq: s.seq,
      season: { n: s.season.n, startedAt: s.season.startedAt, endsAt: s.season.endsAt, openAt: s.season.openAt, drops: s.season.drops, peakM: s.season.peakM, sabotages: s.season.sabotages },
      pieces: snapshot(this.engine).map(p => ({ ...p, owner: s.season.meta[p.id]?.owner })),
      height: heightM(this.engine), summit: this.summitInfo(),
      feed: s.feed.slice(0, 30), history: s.history.slice(0, 12),
      burns: { total: s.burns.total, count: Object.keys(s.burns.txs).length },
      arcade: s.arcade.slice(0, 15),
      boards: this.boards(),
    };
  }

  boards() {
    const rows = Object.entries(this.s.stats).map(([t, v]) => ({ t: +t, ...v }));
    const top = (k, n = 8) => rows.filter(r => r[k] > 0).sort((a, b) => b[k] - a[k]).slice(0, n).map(r => ({ t: r.t, v: r[k] }));
    return { crowns: top('crowns'), daily: top('daily'), landed: top('landed'), shame: top('toppled'), knocked: top('knocked') };
  }

  // Shared ending for drops and sabotage: who fell, did it topple, update records.
  settle(before, fallen, newId, actor) {
    const season = this.s.season;
    const knocked = fallen.filter(b => b.plugin.pieceId !== newId).map(b => ({ id: b.plugin.pieceId, t: b.plugin.tokenId }));
    for (const k of knocked) { this.stat(k.t).knocked++; delete season.meta[k.id]; }
    const h = heightM(this.engine);
    const toppled = before.count >= 4 && (knocked.length >= 3 || (before.h >= 3 && h < before.h * 0.55));
    let collapse = null;
    if (toppled) {
      const winner = before.summit;
      if (winner) this.stat(winner.t).crowns++;
      if (actor.tokenId) this.stat(actor.tokenId).toppled++;
      collapse = { season: season.n, winner, shame: actor, peakM: season.peakM, drops: season.drops };
      this.s.history.unshift({ ...collapse, reason: 'collapse', startedAt: season.startedAt, endedAt: Date.now() });
      this.note({ type: 'collapse', ...collapse });
      for (const b of pieces(this.engine)) Composite.remove(this.engine.world, b);
      const next = this.newSeason(season.n + 1);
      next.openAt = Date.now() + REBUILD_MS;
      this.s.season = next;
    } else {
      season.peakM = Math.max(season.peakM, h);
    }
    return { knocked, height: h, collapse };
  }

  before() {
    return { h: heightM(this.engine), summit: this.summitInfo(), count: pieces(this.engine).length };
  }

  drop(owner, tokenId, x, angle, vx) {
    return this.run(() => {
      const season = this.s.season;
      if (Date.now() < season.openAt) throw Object.assign(new Error('The crew is still sweeping up the rubble. New tower opens in a few seconds.'), { code: 409 });
      if (this.usedToday(tokenId)) throw Object.assign(new Error(`Chog #${tokenId} already dropped today. Back after 00:00 UTC.`), { code: 409 });
      const before = this.before();
      const id = this.s.nextPiece++;
      const x0 = Math.max(-SWEEP - 20, Math.min(SWEEP + 20, +x || 0));
      const a0 = Math.max(-Math.PI, Math.min(Math.PI, +angle || 0));
      const y0 = towerTop(this.engine) - DROP_GAP;
      const body = makePiece(id, tokenId, this.chogs[tokenId], x0, y0, a0);
      Body.setVelocity(body, { x: Math.max(-4, Math.min(4, +vx || 0)), y: 0 });
      Composite.add(this.engine.world, body);
      season.meta[id] = { owner, at: Date.now() };
      const start = { id, t: tokenId, owner, x: body.position.x, y: body.position.y, a: body.angle, chog: this.chogs[tokenId] };

      const frames = simulate(this.engine, { maxSteps: 720 });
      const fallen = removeFallen(this.engine);
      const missed = fallen.some(b => b.plugin.pieceId === id);
      if (missed) delete season.meta[id];

      this.s.used.ids[tokenId] = 1;
      season.drops++;
      const st = this.stat(tokenId);
      st.drops++;
      missed ? st.misses++ : st.landed++;
      const hd = this.holder(owner);
      hd.drops++;
      const today = DAY();
      if (hd.lastDay !== today) {
        const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
        hd.streak = hd.lastDay === y ? hd.streak + 1 : 1;
        hd.lastDay = today;
      }

      const res = this.settle(before, fallen, id, { tokenId, owner });
      const sm = res.collapse ? null : this.summitInfo();
      const newSummit = !missed && sm && sm.id === id;
      if (newSummit) { st.summits++; st.bestM = Math.max(st.bestM, sm.m); hd.best = Math.max(hd.best, sm.m); }
      if (!res.collapse) this.note({ type: missed ? 'miss' : 'drop', t: tokenId, owner, m: +res.height.toFixed(2), summit: newSummit, knocked: res.knocked.map(k => k.t) });
      this.save();
      return this.emit({
        type: 'drop', season: season.n, piece: start, frames, fallen: fallen.map(b => b.plugin.pieceId),
        missed, knocked: res.knocked, height: res.height, summit: sm, newSummit, collapse: res.collapse,
        next: res.collapse ? { n: this.s.season.n, openAt: this.s.season.openAt } : null,
      });
    });
  }

  sabotage(kind, from, amount, tx) {
    return this.run(() => {
      if (this.s.burns.txs[tx]) throw Object.assign(new Error('That burn was already used.'), { code: 409 });
      this.s.burns.txs[tx] = { kind, from, amount: amount.toString(), at: Date.now() };
      this.s.burns.total = (BigInt(this.s.burns.total) + amount).toString();
      const season = this.s.season;
      const before = this.before();
      const dir = Math.random() < 0.5 ? -1 : 1;
      const effect = kind === 'quake' ? quakeEffect(1) : gustEffect(dir, 1);
      const frames = simulate(this.engine, { maxSteps: 720, effect });
      const fallen = removeFallen(this.engine);
      season.sabotages++;
      const res = this.settle(before, fallen, -1, { owner: from, saboteur: true });
      if (!res.collapse) this.note({ type: kind, owner: from, knocked: res.knocked.map(k => k.t) });
      this.save();
      return this.emit({
        type: 'sabotage', kind, dir, season: season.n, from, frames, fallen: fallen.map(b => b.plugin.pieceId),
        knocked: res.knocked, height: res.height, summit: res.collapse ? null : this.summitInfo(), collapse: res.collapse,
        next: res.collapse ? { n: this.s.season.n, openAt: this.s.season.openAt } : null,
      });
    });
  }

  // Runs every 30s: daily summit crown, season time limit.
  tick() {
    return this.run(() => {
      const d = DAY();
      let changed = false;
      if (this.s.crownDay !== d) {
        const sm = this.summitInfo();
        if (sm) { this.stat(sm.t).daily++; this.note({ type: 'daily', t: sm.t, owner: sm.owner, m: sm.m, day: this.s.crownDay }); this.emit({ type: 'daily', summit: sm }); }
        this.s.crownDay = d;
        changed = true;
      }
      const season = this.s.season;
      if (Date.now() > season.endsAt) {
        const winner = this.summitInfo();
        if (winner) this.stat(winner.t).crowns++;
        const rec = { season: season.n, winner, shame: null, peakM: season.peakM, drops: season.drops, reason: 'time', startedAt: season.startedAt, endedAt: Date.now() };
        this.s.history.unshift(rec);
        this.note({ type: 'season', ...rec });
        for (const b of pieces(this.engine)) Composite.remove(this.engine.world, b);
        this.s.season = this.newSeason(season.n + 1);
        this.emit({ type: 'season', ...rec, next: { n: this.s.season.n, openAt: this.s.season.openAt } });
        changed = true;
      }
      if (changed) this.save();
    });
  }

  addArcade(name, score, tokens) {
    const row = { name: String(name).replace(/[^\w .\-#@]/g, '').slice(0, 18) || 'anon', m: Math.round(score * 10) / 10, tokens: tokens.slice(0, 40), at: Date.now() };
    this.s.arcade.push(row);
    this.s.arcade.sort((a, b) => b.m - a.m);
    this.s.arcade.length = Math.min(this.s.arcade.length, 50);
    this.save();
    return this.s.arcade.indexOf(row) + 1;
  }
}
