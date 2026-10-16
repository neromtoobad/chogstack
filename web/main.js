import { Renderer, Art } from './render.js';
import { Crane } from './crane.js';
import { Live } from './live.js';
import { LocalGame, dailyOrder, today } from './arcade.js';
import { wallet, api, short } from './wallet.js';
import { sfx, unlock, toggleMute, isMuted } from './audio.js';
import { shapeFor, makePiece, pieces, headKind, material, Matter } from '../shared/physics.js';
const { Body, Query } = Matter;

const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ago = t => { const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`; };
const dur = ms => { if (ms <= 0) return 'now'; const h = Math.floor(ms / 3600e3), m = Math.floor(ms / 60e3) % 60; return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${m}m`; };

const nameOf = t => app.chogs?.[t]?.name || `Chog #${t}`;

const app = {
  mode: 'live', chogs: null, cfg: null, me: null, sel: null, live: null, local: null,
  state: null, tab: 'summit', busyDrop: false, pan: 0,
};

// ---------- boot ----------
async function boot() {
  const [chogs, cfg, state] = await Promise.all([fetch('/chogs.json').then(r => r.json()), api('/api/config'), api('/api/state')]);
  app.chogs = chogs; app.cfg = cfg; app.state = state;
  $('#pGust').textContent = (+cfg.prices.gust).toLocaleString();
  $('#pQuake').textContent = (+cfg.prices.quake).toLocaleString();
  app.art = new Art(chogs);
  app.r = new Renderer($('#game'), app.art);
  app.crane = new Crane(chogs);
  app.live = new Live(chogs, liveHooks);
  app.live.load(state);
  hud();
  wallet.load();
  if (wallet.token) refreshMe();
  renderWallet(); renderTray(); renderPane();
  connectEvents();
  bindInput();
  requestAnimationFrame(loop);
  let seen = false; try { seen = localStorage.getItem('cs:seen') === '1'; } catch {}
  if (!seen) howTo();
  setInterval(() => { if (app.mode === 'live') renderPane(true); }, 15000);
}

// ---------- events ----------
function connectEvents() {
  const es = new EventSource('/api/events');
  let first = true;
  es.onopen = async () => {
    if (first) { first = false; return; }
    const st = await api('/api/state').catch(() => null); // missed events while offline: resync
    if (st && st.seq !== app.live.seq && !app.live.busy) { app.state = st; app.live.load(st); hud(); renderPane(); }
  };
  es.onmessage = m => {
    const ev = JSON.parse(m.data);
    if (ev.piece?.chog) app.chogs[ev.piece.t] = ev.piece.chog;
    app.live.push(ev);
  };
}

const liveHooks = {
  onEventStart(ev) {
    if (app.mode !== 'live') return;
    if (ev.type === 'sabotage') {
      ev.kind === 'quake' ? sfx.quake() : sfx.gust();
      app.r.shake = ev.kind === 'quake' ? 18 : 6;
      shout(ev.kind === 'quake' ? 'QUAKE!' : 'GUST!', `${short(ev.from)} burned $CHOG`);
    } else if (ev.type === 'drop') {
      if (ev.piece.owner !== wallet.address) sfx.release();
      app.followPiece = ev.piece.id;
    }
  },
  onImpact(b, v) {
    if (app.mode !== 'live') return;
    sfx.thunk(Math.min(1.6, v / 10));
    app.r.puff(b.position.x, b.bounds.max.y, 10);
    app.r.shake = Math.min(10, v * 0.6);
  },
  onEventEnd(ev) {
    const mine = ev.piece?.owner === wallet.address || ev.from === wallet.address;
    app.followPiece = null;
    if (ev.type === 'daily') { if (app.mode === 'live') { sfx.crown(); toast(`👑 ${nameOf(ev.summit.t)} held the summit at midnight and took the daily crown`); } refreshState(); return; }
    if (ev.type === 'season') { refreshState(); if (app.mode === 'live') finale(ev, true); return; }
    if (app.mode === 'live') {
      if (ev.collapse) { sfx.collapse(); app.r.shake = 30; finale(ev.collapse); }
      else if (ev.missed) { sfx.miss(); shout('MISS!', `${nameOf(ev.piece.t)} went over the edge`); }
      else if (ev.knocked?.length) { sfx.knock(); shout(`${ev.knocked.length} OFF!`, ev.knocked.map(k => nameOf(k.t)).join(', ') + ' knocked off'); }
      else if (ev.newSummit) { sfx.summit(); const b = app.live.byId(ev.piece.id); if (b) app.r.burst(b.position.x, b.bounds.min.y); shout('NEW SUMMIT', `${nameOf(ev.piece.t)} is on top · ${ev.height.toFixed(1)} m`); }
      else if (ev.type === 'drop') sfx.thunk();
    }
    refreshState();
    if (mine) refreshMe();
  },
};

async function refreshState() {
  try {
    const st = await api('/api/state');
    app.state = st;
    if (!app.live.busy && st.season.n !== app.live.state?.season?.n) app.live.load(st);
    else app.live.state = st;
    hud(); renderPane();
  } catch {}
}

async function refreshMe() {
  try { app.me = await wallet.me(); } catch { app.me = null; }
  for (const c of app.me?.chogs || []) if (c.chog) app.chogs[c.t] = c.chog;
  const mine = app.me?.chogs || [];
  if (!mine.find(c => c.t === app.sel && !c.used)) app.sel = mine.find(c => !c.used)?.t ?? null;
  renderWallet(); renderTray();
}

// ---------- HUD ----------
function hud() {
  const st = app.state;
  let h = 0, label = '';
  if (app.mode === 'live') { h = app.live.height(); label = `SEASON ${st.season.n} · SITE 001`; $('#hSub').textContent = st.summit ? `${nameOf(st.summit.t)} is on top` : 'empty site — first drop takes the summit'; }
  else if (app.mode === 'arcade') { h = app.local?.peak || 0; label = `DAILY STACK · ${today()}`; $('#hSub').innerHTML = `best today · ${'❤️'.repeat(Math.max(0, app.local?.lives ?? 3))}${'🖤'.repeat(3 - Math.max(0, app.local?.lives ?? 3))}`; }
  else { h = app.local?.height() || 0; label = 'PRACTICE · NOTHING COUNTS'; $('#hSub').textContent = 'practice copy of the live tower'; }
  const v = $('#hVal'); const txt = h.toFixed(1);
  if (v.textContent !== txt) { v.textContent = txt; v.parentElement.classList.remove('bump'); void v.offsetWidth; v.parentElement.classList.add('bump'); }
  $('#seasonTag').textContent = app.mode === 'live' ? `SEASON ${st.season.n}` : app.mode === 'arcade' ? 'DAILY STACK' : 'PRACTICE';
  app.label = label;
}

// ---------- loop ----------
let last = performance.now();
function loop(now) { frame(now); requestAnimationFrame(loop); }
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  let engine, top, opts = {};
  if (app.mode === 'live') {
    app.live.update(dt);
    engine = app.live.engine; top = app.live.top();
    const st = app.state;
    opts = { height: app.live.height(), peak: st.season.peakM, summitId: !app.live.busy ? st.summit?.id : null, label: app.label };
    const canAim = !!app.sel && !app.busyDrop && Date.now() >= st.season.openAt;
    app.crane.set(canAim ? app.sel : null);
  } else if (app.local) {
    app.local.update(dt);
    engine = app.local.engine; top = app.local.top();
    const sm = app.local.state === 'aim' ? summitOf(engine) : null;
    opts = { height: app.local.height(), peak: app.mode === 'arcade' ? app.local.peak : 0, summitId: sm?.plugin.pieceId, label: app.label };
    if (app.mode === 'arcade') app.crane.set(app.local.over || app.local.state !== 'aim' ? null : app.local.nextToken());
    else app.crane.set(app.local.state === 'aim' ? app.sandSel : null);
    app.crane.speed = app.mode === 'arcade' ? 1 + Math.min(1.2, app.local.peak / 22) : 0.8;
    if (Math.random() < 0.05) hud();
  }
  if (app.mode === 'live') app.crane.speed = 1;
  app.crane.update(dt, top);
  // follow a falling piece if it's below the view
  let focus = top;
  if (app.followPiece != null) { const b = app.live.byId(app.followPiece); if (b) focus = Math.max(top, Math.min(b.position.y, 400)); }
  app.r.cam.pan = app.pan;
  app.r.follow(focus, dt);
  opts.crane = app.crane.view();
  app.r.draw(engine, opts);
  if (app.mode === 'live' && Math.random() < 0.03) hud();
}
const summitOf = engine => { let best = null; for (const b of pieces(engine)) if (b.position.y < 420 && (!best || b.bounds.min.y < best.bounds.min.y)) best = b; return best; };

// ---------- input ----------
function bindInput() {
  $('#dropBtn').onclick = () => { unlock(); drop(); };
  $('#rotL').onclick = () => { unlock(); app.crane.rotate(-1); sfx.rotate(); };
  $('#rotR').onclick = () => { unlock(); app.crane.rotate(1); sfx.rotate(); };
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); unlock(); drop(); }
    if (e.code === 'KeyQ' || e.code === 'ArrowLeft') { app.crane.rotate(-1); sfx.rotate(); }
    if (e.code === 'KeyE' || e.code === 'ArrowRight') { app.crane.rotate(1); sfx.rotate(); }
    if (e.code === 'Escape') closeModal();
  });
  $('#modes').onclick = e => { const m = e.target.closest('button')?.dataset.mode; if (m) setMode(m); };
  $('#tabs').onclick = e => { const t = e.target.closest('button')?.dataset.tab; if (t) { app.tab = t; renderPane(); } };
  $('#howBtn').onclick = howTo;
  $('#boardBtn').onclick = () => $('#side').classList.toggle('open');
  $('#walletBtn').onclick = walletClick;
  $('#sabo').onclick = e => { const k = e.target.closest('button')?.dataset.kind; if (k) sabotage(k); };
  $('#modal').onclick = e => { if (e.target.id === 'modal') closeModal(); };

  // pan with wheel / drag; tap a piece to inspect it
  const cv = $('#game');
  cv.addEventListener('wheel', e => { app.pan = Math.max(-4000, Math.min(200, app.pan + e.deltaY * 0.6)); clearTimeout(app.panT); app.panT = setTimeout(() => (app.pan = 0), 6000); }, { passive: true });
  let down = null;
  cv.addEventListener('pointerdown', e => { unlock(); down = { x: e.clientX, y: e.clientY, pan: app.pan, moved: false }; });
  cv.addEventListener('pointermove', e => {
    if (!down) return;
    const dy = e.clientY - down.y;
    if (Math.abs(dy) > 8) down.moved = true;
    if (down.moved) { app.pan = Math.max(-4000, Math.min(200, down.pan - dy / app.r.cam.s)); clearTimeout(app.panT); app.panT = setTimeout(() => (app.pan = 0), 6000); }
  });
  cv.addEventListener('pointerup', e => {
    if (down && !down.moved) {
      const w = app.r.toWorld(e.clientX, e.clientY);
      const engine = app.mode === 'live' ? app.live.engine : app.local?.engine;
      const hit = engine && Query.point(pieces(engine), w)[0];
      if (hit) chogCard(hit.plugin.tokenId, hit.plugin.pieceId);
      else if (app.mode !== 'live') drop();
    }
    down = null;
  });
}

function setMode(m) {
  if (m === app.mode && m === 'live') return;
  app.mode = m; app.pan = 0;
  document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  if (m === 'live') app.local = null;
  else startLocal();
  $('#sabo').style.display = m === 'live' ? '' : 'none';
  hud(); renderTray(); renderPane();
}

function startLocal() {
  const practice = app.mode === 'sandbox';
  const snap = practice ? app.live.state.pieces || [] : [];
  // Practice clones whatever the live tower looks like right now
  app.local = new LocalGame(app.chogs, localHooks, { practice, snapshot: practice ? currentSnapshot() : [] });
  if (practice) app.sandSel = app.sel || (app.me?.chogs?.[0]?.t) || randomChog();
  void snap;
}
// Chogs whose traits the site hasn't cached yet: ask the server (it pulls them from IPFS)
const asked = new Set();
function prefetchTraits(ids) {
  for (const t of ids) if (app.chogs[t]?.pending && !asked.has(t)) { asked.add(t); api(`/api/chog/${t}`).then(d => { if (d.traits && Object.keys(d.traits).length) app.chogs[t] = { n: d.n, name: d.name, traits: d.traits }; }).catch(() => {}); }
}
const currentSnapshot = () => pieces(app.live.engine).map(b => ({ id: b.plugin.pieceId, t: b.plugin.tokenId, x: b.position.x, y: b.position.y, a: b.angle }));
const randomChog = () => 1 + Math.floor(Math.random() * 1969);

const localHooks = {
  onImpact(b, v) { sfx.thunk(Math.min(1.6, v / 10)); app.r.puff(b.position.x, b.bounds.max.y, 8); app.r.shake = Math.min(8, v * 0.5); },
  onTurn(r) {
    if (r.missed) { sfx.miss(); shout('MISS!'); }
    else if (r.perfect) { sfx.summit(); shout(r.combo > 1 ? `PERFECT ×${r.combo}` : 'PERFECT', 'glued in place'); const sm = summitOf(app.local.engine); if (sm) app.r.burst(sm.position.x, sm.bounds.min.y); }
    else if (r.newPeak && app.mode === 'arcade' && Math.floor(r.height / 5) > Math.floor((r.height - 1.2) / 5)) { sfx.crown(); shout(`${Math.floor(r.height / 5) * 5} M!`); }
    hud(); renderTray();
  },
  onLost(n, lives, collapse) {
    if (app.mode === 'sandbox') { if (n >= 3) { sfx.collapse(); app.r.shake = 26; shout('TOWER DOWN', `that would've ended the season`); } else { sfx.knock(); shout(`${n} OFF!`); } return; }
    if (collapse) { sfx.collapse(); app.r.shake = 26; } else sfx.knock();
    hud();
  },
  onWind(w) { if (Math.abs(w) > 0.15) { sfx.gust(); toast(w > 0 ? 'Wind picking up → ' : '← Wind picking up'); } },
  onOver(res) { setTimeout(() => arcadeOver(res), 900); },
};

// ---------- actions ----------
async function drop() {
  if (app.mode !== 'live') {
    const g = app.local; if (!g || g.state !== 'aim' || g.over) return;
    const token = app.mode === 'arcade' ? g.nextToken() : app.sandSel;
    if (!token) return;
    sfx.release();
    g.release(token, app.crane.x, app.crane.angle, app.crane.vx);
    if (app.mode === 'sandbox') app.sandSel = app.sandSel; // keep the same Chog for another try
    app.crane.angle = 0; app.pan = 0;
    renderTray();
    return;
  }
  if (!wallet.token) return walletClick();
  if (!app.me) return toast('Loading your Chogs…');
  if (!app.me.chogs.length) return noChogs();
  if (!app.sel) return toast('All your Chogs have dropped today. Back after 00:00 UTC, or try Arcade.');
  if (Date.now() < app.state.season.openAt) return toast('New site opening — give the crew a few seconds');
  if (app.busyDrop) return;
  app.busyDrop = true; app.pan = 0;
  const token = app.sel, x = app.crane.x, angle = app.crane.angle, vx = app.crane.vx;
  sfx.release();
  app.crane.hidden = true;
  try {
    const r = await wallet.drop(token, x, angle, vx);
    const c = app.me.chogs.find(c => c.t === token); if (c) c.used = true;
    app.sel = app.me.chogs.find(c => !c.used)?.t ?? null;
    app.crane.angle = 0;
    renderTray();
    void r;
  } catch (e) { toast(e.message); }
  app.crane.hidden = false;
  app.busyDrop = false;
}

async function walletClick() {
  if (wallet.token) return accountSheet();
  try {
    $('#walletBtn').textContent = 'Signing…';
    await wallet.connect();
    toast('Signed in. Loading your Chogs…');
    await refreshMe();
  } catch (e) { toast(e.message?.includes('User rejected') ? 'Sign-in cancelled' : e.message); }
  renderWallet();
}

async function sabotage(kind) {
  const price = app.cfg.prices[kind];
  openModal(`
    <button class="ghost x" data-close>✕</button>
    <h2>${kind === 'quake' ? '💥 QUAKE' : '🌬️ GUST'}</h2>
    <p>${kind === 'quake' ? 'Shake the whole site for a second. Anything badly stacked comes down.' : 'A sideways gust hits the tower, hardest at the top.'}</p>
    <p>Costs <b>${(+price).toLocaleString()} $CHOG</b>, sent to the burn address <code>0x…dEaD</code>. Burned for good, not paid to anyone. If it topples the tower, the summit Chog takes the season crown and your wallet goes on the wall of shame.</p>
    <div style="display:flex;gap:10px;margin-top:14px"><button class="btn pink" id="goSabo">Burn ${(+price).toLocaleString()} $CHOG</button><button class="btn" data-close>Not now</button></div>
    <p class="note" id="saboNote"></p>`);
  $('#goSabo').onclick = async () => {
    const note = $('#saboNote');
    try {
      note.textContent = 'Confirm the burn in your wallet…';
      const { tx, result } = await wallet.burn(kind, price, app.cfg);
      note.textContent = `Sent ${tx.slice(0, 10)}… waiting for Monad to confirm`;
      await result;
      closeModal(); toast('Burn confirmed. Here it comes…');
    } catch (e) { note.textContent = e.message?.includes('User rejected') ? 'Cancelled.' : e.message; }
  };
}

// ---------- UI renderers ----------
function renderWallet() {
  const b = $('#walletBtn');
  b.textContent = wallet.address ? short(wallet.address) : 'Connect';
  b.classList.toggle('pink', !wallet.address);
}

function trayCard(t, opts = {}) {
  const b = el('button', `tc${opts.sel ? ' sel' : ''}${opts.used ? ' used' : ''}`);
  b.innerHTML = `<img src="${app.art.url(t)}" alt="Chog #${t}" loading="lazy"><span>#${t}</span>`;
  b.title = app.chogs[t]?.name || `Chog #${t}`;
  return b;
}

function renderTray() {
  const tray = $('#tray'); tray.innerHTML = '';
  const dropBtn = $('#dropBtn');
  if (app.mode === 'arcade') {
    const g = app.local;
    const order = dailyOrder(), i = g?.turn || 0;
    prefetchTraits(order.slice(i, i + 6));
    tray.append(el('div', 'tray-msg', g?.over ? 'Game over' : 'Up next'));
    for (let k = 0; k < 5; k++) { const c = trayCard(order[(i + k) % order.length], { sel: k === 0 }); c.onclick = () => chogCard(order[(i + k) % order.length]); tray.append(c); }
    dropBtn.textContent = g?.over ? 'AGAIN' : 'DROP';
    dropBtn.onclick = () => { unlock(); if (app.local?.over) { startLocal(); hud(); renderTray(); } else drop(); };
    return;
  }
  dropBtn.textContent = 'DROP';
  dropBtn.onclick = () => { unlock(); drop(); };
  if (app.mode === 'sandbox') {
    const dice = el('button', 'tc'); dice.innerHTML = `<div style="aspect-ratio:1;display:grid;place-items:center;font-size:30px">🎲</div><span>random</span>`;
    dice.onclick = () => { app.sandSel = randomChog(); sfx.click(); renderTray(); };
    tray.append(dice);
    const list = [...new Set([app.sandSel, ...(app.me?.chogs || []).map(c => c.t)])].filter(Boolean);
    for (const t of list.slice(0, 12)) { const c = trayCard(t, { sel: t === app.sandSel }); c.onclick = () => { app.sandSel = t; sfx.click(); renderTray(); }; tray.append(c); }
    const reset = el('button', 'tc'); reset.innerHTML = `<div style="aspect-ratio:1;display:grid;place-items:center;font-size:26px">↺</div><span>reset</span>`;
    reset.onclick = () => { startLocal(); hud(); renderTray(); };
    tray.append(reset);
    return;
  }
  if (!wallet.token) {
    tray.append(el('div', 'tray-msg', `Hold a Chog? <a id="tc1">Connect</a> to drop it on the tower. No Chog? Play <a id="tc2">Arcade</a> or <a id="tc3">Practice</a>.`));
    $('#tc1').onclick = walletClick; $('#tc2').onclick = () => setMode('arcade'); $('#tc3').onclick = () => setMode('sandbox');
    dropBtn.disabled = false; return;
  }
  if (!app.me) { tray.append(el('div', 'tray-msg', 'Loading your Chogs…')); return; }
  if (!app.me.chogs.length) { tray.append(el('div', 'tray-msg', `No Chogs in ${short(wallet.address)}. <a id="tc2">Arcade</a> and <a id="tc3">Practice</a> are open to everyone.`)); $('#tc2').onclick = () => setMode('arcade'); $('#tc3').onclick = () => setMode('sandbox'); return; }
  for (const c of app.me.chogs) {
    const b = trayCard(c.t, { sel: c.t === app.sel, used: c.used });
    b.onclick = () => { if (c.used) return chogCard(c.t); app.sel = c.t; sfx.click(); renderTray(); };
    tray.append(b);
  }
  dropBtn.disabled = !app.sel;
}

function chogRow(t, right, sub, cls = '') {
  const name = app.chogs[t]?.name || `Chog #${t}`;
  return `<div class="row click ${cls}" data-chog="${t}"><img src="${app.art.url(t)}" alt=""><div class="who"><b>${esc(name)}</b><span>${sub || ''}</span></div>${right != null ? `<div class="v">${right}</div>` : ''}</div>`;
}

function renderPane(quiet) {
  const p = $('#pane');
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === app.tab));
  const st = app.state;
  if (quiet && app.tab !== 'summit') return;
  let h = '';
  if (app.mode === 'arcade' && app.tab === 'summit') {
    const rows = (st.arcade || []).filter(r => new Date(r.at).toISOString().slice(0, 10) === today());
    h += `<h4>Daily Stack · ${today()}</h4><p class="note" style="margin-top:0">Same Chogs, same order for everyone today. 3 lives. Wind picks up past 8 m. Land dead-centre for a PERFECT glue.</p>`;
    h += rows.length ? rows.slice(0, 10).map((r, i) => `<div class="row"><div class="v" style="width:26px">${i + 1}</div><div class="who"><b>${esc(r.name)}</b><span>${ago(r.at)}</span></div><div class="v">${r.m.toFixed(1)}m</div></div>`).join('') : `<div class="empty">No runs yet today. Set the bar.</div>`;
    p.innerHTML = h; return;
  }
  if (app.tab === 'summit') {
    const s = st.summit;
    if (s) {
      h += `<div class="summitCard row click" data-chog="${s.t}" style="border:0"><img src="${app.art.url(s.t)}" alt=""><div><div class="k"><span class="crown">👑</span> on the summit</div><div class="n">${esc(app.chogs[s.t]?.name || '#' + s.t)}</div><div class="o">${short(s.owner)} · ${s.m.toFixed(1)} m up</div></div></div>`;
    } else h += `<div class="empty">The site is empty. The first Chog dropped takes the summit.</div>`;
    h += `<div class="stats"><div class="stat"><b>${st.pieces.length}</b><span>Chogs up</span></div><div class="stat"><b>${st.season.drops}</b><span>drops</span></div><div class="stat"><b>${st.season.peakM.toFixed(1)}</b><span>peak m</span></div></div>`;
    h += `<p class="note">Whoever's on top when it falls wins Season ${st.season.n}. Whoever knocks it down goes on the wall of shame. Daily crown at 00:00 UTC (in ${dur(nextMidnight() - Date.now())}). Season ends in ${dur(st.season.endsAt - Date.now())} if it never falls.</p>`;
    h += `<div class="pot">🔥 <b>${fmtChog(st.burns.total)}</b> $CHOG burned on sabotage so far</div>`;
  } else if (app.tab === 'feed') {
    h += st.feed.length ? st.feed.map(feedRow).join('') : `<div class="empty">Nothing yet. Be first.</div>`;
  } else if (app.tab === 'boards') {
    const b = st.boards;
    const sec = (title, list, unit) => `<h4>${title}</h4>` + (list.length ? list.map(r => chogRow(r.t, r.v, unit)).join('') : `<div class="empty">nobody yet</div>`);
    h += sec('👑 Season crowns', b.crowns, 'seasons won') + sec('🌙 Daily crowns', b.daily, 'midnights on top') + sec('🧱 Clean landings', b.landed, 'landed') + sec('💀 Wall of shame', b.shame, 'towers toppled') + sec('🥴 Most knocked off', b.knocked, 'times knocked off');
  } else if (app.tab === 'seasons') {
    h += `<h4>Season ${st.season.n} · live</h4><div class="note" style="margin-top:0">started ${ago(st.season.startedAt)}</div>`;
    h += st.history.length ? st.history.map(s => `<h4>Season ${s.season}</h4>` + (s.winner ? chogRow(s.winner.t, '👑', `won · ${s.peakM.toFixed(1)} m peak · ${s.drops} drops`) : `<div class="empty">no winner</div>`) + (s.shame ? (s.shame.tokenId ? chogRow(s.shame.tokenId, '💀', 'toppled it') : `<div class="row"><div class="who"><b>${short(s.shame.owner)}</b><span>toppled it with a burn</span></div><div class="v">💀</div></div>`) : `<div class="note">ran out the clock</div>`)).join('') : `<div class="empty">No finished seasons yet. This one could be the first.</div>`;
  }
  p.innerHTML = h;
  p.querySelectorAll('[data-chog]').forEach(r => r.onclick = () => chogCard(+r.dataset.chog));
}

function feedRow(f) {
  const who = f.owner ? short(f.owner) : '';
  const map = {
    drop: () => chogRow(f.t, `${f.m.toFixed(1)}m`, `${f.summit ? '👑 new summit · ' : ''}${f.knocked?.length ? `knocked ${f.knocked.map(k => '#' + k).join(' ')} · ` : ''}${who} · ${ago(f.at)}`),
    miss: () => chogRow(f.t, '💨', `missed the tower · ${who} · ${ago(f.at)}`),
    gust: () => `<div class="row"><div class="who"><b>🌬️ Gust</b><span>${who} burned $CHOG${f.knocked?.length ? ` · ${f.knocked.length} off` : ''} · ${ago(f.at)}</span></div></div>`,
    quake: () => `<div class="row"><div class="who"><b>💥 Quake</b><span>${who} burned $CHOG${f.knocked?.length ? ` · ${f.knocked.length} off` : ''} · ${ago(f.at)}</span></div></div>`,
    collapse: () => `<div class="row"><div class="who"><b>🏚️ Season ${f.season} collapsed</b><span>${f.winner ? `#${f.winner.t} took the crown` : 'no summit'} · ${ago(f.at)}</span></div></div>`,
    season: () => `<div class="row"><div class="who"><b>⏱️ Season ${f.season} ran out the clock</b><span>${f.winner ? `#${f.winner.t} took the crown` : ''} · ${ago(f.at)}</span></div></div>`,
    daily: () => chogRow(f.t, '🌙', `daily crown · ${f.m?.toFixed(1)} m · ${ago(f.at)}`),
  };
  return (map[f.type] || (() => ''))();
}

const fmtChog = wei => { try { return Number(BigInt(wei) / 10n ** 18n).toLocaleString(); } catch { return '0'; } };
const nextMidnight = () => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.getTime(); };

// ---------- modals ----------
function openModal(html) {
  $('#sheet').innerHTML = html; $('#modal').hidden = false;
  $('#sheet').querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
}
function closeModal() { $('#modal').hidden = true; }

function howTo() {
  try { localStorage.setItem('cs:seen', '1'); } catch {}
  openModal(`
    <button class="ghost x" data-close>✕</button>
    <h2>ONE TOWER.<br>1,969 CHOGS.</h2>
    <p>Everyone builds the same tower, live, on Monad.</p>
    <div class="steps">
      <div class="step"><i>1</i><div><b>Your traits forge your block</b>A cap's brim sticks out the way your Chog faces. Spiky crowns are a nightmare to stack on, headbands make a flat deck. A Smoke aura makes you slippery, Burning makes you bounce, Legendaries are big and heavy.</div></div>
      <div class="step"><i>2</i><div><b>One drop per Chog per day</b>Connect, pick a Chog, time the crane, DROP. Hold more Chogs, get more drops. Q/E or ⟲⟳ to rotate, Space to drop.</div></div>
      <div class="step"><i>3</i><div><b>Be on top when it falls</b>The highest Chog when the tower collapses wins the season crown. Whoever knocks it down lands on the wall of shame. On top at 00:00 UTC? Daily crown. Every crown goes on that Chog's permanent record, and follows it if it's ever sold.</div></div>
      <div class="step"><i>4</i><div><b>No Chog? Mess with it</b>Burn $CHOG to send a gust or a quake into the live tower. Or play the Daily Stack arcade and Practice on a copy of the tower.</div></div>
    </div>
    <button class="btn pink" data-close>LET'S STACK</button>`);
}

function noChogs() {
  openModal(`<button class="ghost x" data-close>✕</button><h2>NO CHOGS HERE</h2>
    <p>${short(wallet.address)} doesn't hold a Chog Genesis NFT, so it can't drop on the live tower. The tower is only built from real Chogs.</p>
    <p>You can still burn $CHOG to sabotage it, top the Daily Stack board, or practise on a copy of today's tower.</p>
    <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap"><button class="btn pink" id="nA">Play arcade</button><button class="btn" id="nP">Practice</button></div>`);
  $('#nA').onclick = () => { closeModal(); setMode('arcade'); };
  $('#nP').onclick = () => { closeModal(); setMode('sandbox'); };
}

function accountSheet() {
  const h = app.me?.holder;
  openModal(`<button class="ghost x" data-close>✕</button><h2>${short(wallet.address)}</h2>
    <div class="stats"><div class="stat"><b>${app.me?.chogs.length ?? '–'}</b><span>Chogs held</span></div><div class="stat"><b>${h?.streak ?? 0}🔥</b><span>day streak</span></div><div class="stat"><b>${(h?.best ?? 0).toFixed(1)}</b><span>best summit m</span></div></div>
    <p class="note">Drops left today: ${(app.me?.chogs || []).filter(c => !c.used).length}. Resets 00:00 UTC.</p>
    <div style="display:flex;gap:10px;margin-top:14px"><button class="btn" id="mute">${isMuted() ? '🔇 Sound off' : '🔊 Sound on'}</button><button class="btn" id="out">Sign out</button></div>`);
  $('#out').onclick = () => { wallet.clear(); app.me = null; app.sel = null; renderWallet(); renderTray(); closeModal(); };
  $('#mute').onclick = e => { e.target.textContent = toggleMute() ? '🔇 Sound off' : '🔊 Sound on'; };
}

async function chogCard(t, pieceId) {
  const c = app.chogs[t] || {}; const tr = c.traits || {};
  const sh = shapeFor(t, c);
  const kindTxt = { cap: `Cap → a brim sticking out ${sh.dir > 0 ? 'right' : 'left'}`, flat: 'Headband → flat deck, easy to stack on', tall: 'Beanie → a narrow tower on top', bucket: 'Bucket hat → a wide brim, the best deck in the set', spike: 'Spiky head → nothing sits on it', ears: 'Bare head → two ears to snag on', dome: 'Round head → stuff slides off', star: 'Legendary 1:1 → a big crown of spikes' }[sh.kind];
  const matTxt = { bouncy: `${tr.Aura} aura → bouncy`, slick: `${tr.Aura} aura → slippery`, charged: `${tr.Aura} aura → heavy and grippy`, grippy: 'No aura → grippy' }[sh.mat.kind];
  const keys = new Set(['Head', 'Side', 'Accessory', 'Aura', 'Tier', 'Body', 'Naked', 'Base']);
  const meta = pieceId != null && app.mode === 'live' ? app.live.meta[pieceId] : null;
  openModal(`<button class="ghost x" data-close>✕</button>
    <div class="chogHero"><canvas id="forge" width="300" height="300" style="width:150px;height:150px"></canvas><div><h2 style="font-size:32px">${esc(c.name || 'Chog #' + t)}</h2><div class="note" style="margin:0">token #${t} · ${esc(tr.Tier || '')}</div><div class="note" id="ownerLine" style="margin:4px 0 0">${meta?.owner ? 'dropped by ' + short(meta.owner) : ''}</div></div></div>
    <div class="traits">${Object.entries(tr).map(([k, v]) => `<span class="${keys.has(k) ? 'key' : ''}">${esc(k)}: ${esc(v)}</span>`).join('')}</div>
    <div class="forge">✍️ ${kindTxt}<br>${tr.Accessory && tr.Accessory !== 'None' ? `${esc(tr.Accessory)} → a side nub<br>` : ''}${matTxt}<br>${esc(tr.Tier || 'Common')} → ${sh.w.toFixed(0)}px wide</div>
    <h4 style="font-family:var(--display);font-weight:400;font-size:20px;margin:14px 0 6px">Career</h4>
    <div class="stats" id="career"><div class="stat"><b>…</b><span>loading</span></div></div>`);
  drawForge($('#forge'), t);
  try {
    const d = await api(`/api/chog/${t}`);
    const s = d.stats || {};
    $('#career').innerHTML = [['👑', s.crowns, 'season crowns'], ['🌙', s.daily, 'daily crowns'], ['🧱', s.landed, 'landed'], ['💨', s.misses, 'misses'], ['🥴', s.knocked, 'knocked off'], ['💀', s.toppled, 'toppled']].map(([i, v, l]) => `<div class="stat"><b>${i} ${v || 0}</b><span>${l}</span></div>`).join('');
    if (d.owner && !meta?.owner) $('#ownerLine').textContent = `held by ${short(d.owner)}${d.usedToday ? ' · dropped today' : ' · drop available'}`;
  } catch {}
}

function drawForge(cv, t) {
  const ctx = cv.getContext('2d');
  const b = makePiece(-2, t, app.chogs[t], 0, 0, 0);
  const tmp = new (app.r.constructor)(document.createElement('canvas'), app.art);
  tmp.ctx = ctx;
  const go = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, 300, 300);
    const w = b.bounds.max.x - b.bounds.min.x, h = b.bounds.max.y - b.bounds.min.y, k = 230 / Math.max(w, h);
    ctx.setTransform(k, 0, 0, k, 150 - (b.bounds.min.x + w / 2) * k, 150 - (b.bounds.min.y + h / 2) * k);
    tmp.piece(b);
  };
  go();
  const im = app.art.cache.get(t); if (im && !im.complete) im.onload = go;
}

function finale(c, timed) {
  const w = c.winner, sh = c.shame;
  const wn = w ? (app.chogs[w.t]?.name || `#${w.t}`) : null;
  openModal(`<div class="finale"><h2 style="font-size:56px;color:var(--pink)">${timed ? 'TIME!' : 'TOWER DOWN!'}</h2>
    <p>Season ${c.season} ${timed ? 'ran out the clock' : 'came crashing down'} after ${c.drops} drops and a ${(c.peakM || 0).toFixed(1)} m peak.</p>
    <div class="pair">
      ${w ? `<div><img src="${app.art.url(w.t)}" alt=""><div class="lab">👑 ${esc(wn)}</div><div class="sub">on top · wins the season</div></div>` : ''}
      ${sh ? (sh.tokenId ? `<div><img src="${app.art.url(sh.tokenId)}" alt="" style="filter:grayscale(.6)"><div class="lab">💀 #${sh.tokenId}</div><div class="sub">knocked it down</div></div>` : `<div><div style="width:120px;height:120px;margin:auto;border-radius:16px;border:3px solid var(--ink);display:grid;place-items:center;font-size:54px;background:var(--wall)">💀</div><div class="lab">${short(sh.owner)}</div><div class="sub">burned $CHOG and toppled it</div></div>`) : ''}
    </div>
    <p class="note">A new site opens in a few seconds. Season ${c.season + 1} starts from zero.</p>
    <button class="btn pink" data-close>NEXT SEASON</button></div>`);
  if (w) sfx.crown();
}

function arcadeOver(res) {
  let name = ''; try { name = localStorage.getItem('cs:name') || ''; } catch {}
  openModal(`<button class="ghost x" data-close>✕</button><h2>STACK DOWN</h2>
    <p>You reached <b>${res.m.toFixed(1)} m</b> with ${res.tokens.length} Chogs.</p>
    <input class="name" id="nm" maxlength="18" placeholder="name for the board" value="${esc(name)}">
    <div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap"><button class="btn pink" id="sub">Post score</button><button class="btn" id="again">Play again</button></div>
    <p class="note" id="rk"></p>`);
  $('#again').onclick = () => { closeModal(); startLocal(); hud(); renderTray(); };
  $('#sub').onclick = async () => {
    const n = $('#nm').value.trim() || 'anon';
    try { localStorage.setItem('cs:name', n); } catch {}
    try { const r = await api('/api/arcade', { name: n, m: res.m, tokens: res.tokens }); $('#rk').textContent = `#${r.rank} on the board`; $('#sub').disabled = true; refreshState(); } catch (e) { $('#rk').textContent = e.message; }
  };
}

// ---------- toasts ----------
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3200); }
function shout(big, small) { const c = $('#callout'); c.innerHTML = `${esc(big)}${small ? `<small>${esc(small)}</small>` : ''}`; c.classList.remove('go'); void c.offsetWidth; c.classList.add('go'); }

// expose for debugging and the demo recorder
// debug: step frames by hand when the tab gets no animation frames (headless checks)
window.__cs = { app, headKind, material, Body, step: (n = 60) => { for (let i = 0; i < n; i++) { last -= 1000 / 60; frame(performance.now()); } } };
boot().catch(e => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<div class="toast show">Couldn't reach the site: ${esc(e.message)}</div>`); });
