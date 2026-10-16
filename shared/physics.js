// Shared by server (authoritative tower) and browser (arcade, sandbox, rendering).
// A Chog's traits forge its block: Head -> top shape, Side -> which way the brim sticks out,
// Accessory -> side nub, Aura -> material, Tier -> size and weight.
import Matter from 'matter-js';

const { Engine, Bodies, Body, Composite, Vertices, Sleeping } = Matter;

export const PLATFORM = { w: 440, h: 44, top: 0 };
export const FALL_Y = 420;           // below this a piece has left the tower
export const PX_PER_M = 40;          // 40px of world = 1 metre on the height meter
export const DROP_GAP = 200;         // spawn height above the current top
export const SWEEP = 250;            // crane sweeps x in [-SWEEP, SWEEP]
export const SUB = 3;                // physics substeps per 60 Hz frame; one step per frame lets stacks drift apart

// ---------- trait -> shape ----------

function hash(n) {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 2246822507) >>> 0; x ^= x >>> 13;
  return (x >>> 0) / 4294967295;
}

const has = (v, ...words) => words.some(w => (v || '').toLowerCase().includes(w));

// Head trait -> top shape. Explicit picks first, then keywords for anything new.
const HEAD = {
  ears: ['Clown Nose', '3rd Eye', 'Blue Laser', 'Diamond'],
  flat: ['Japan Headband', 'Red Headband', 'Red Bandana', 'Holy Seal', 'Silver wreath'],
  bucket: ['Orange Bucket Cap', 'Blue Bucket Cap', 'Gray Bucket Cap'],
  spike: ['Spartan Helmet', 'Taped Banana', 'Horny Cap', 'Crown', 'Wizard Hat', 'Wizard Beanie'],
  dome: ['Durag', 'Bob Hair', 'Rainbow Wig', 'MEGA Chog', 'Plumber', 'Robber', 'Head Wrap', 'Poison Shroom'],
};
export function headKind(t) {
  const h = t.Head;
  if (!h || h === 'None') return 'ears';
  for (const [k, list] of Object.entries(HEAD)) if (list.includes(h)) return k;
  if (has(h, 'crown', 'horn', 'thorn', 'spike', 'wizard', 'cone', 'witch', 'unicorn', 'mohawk')) return 'spike';
  if (has(h, 'band', 'bandana', 'halo', 'wreath', 'goggle', 'visor')) return 'flat';
  if (has(h, 'bucket')) return 'bucket';
  if (has(h, 'beanie', 'top hat', 'chef', 'fez')) return 'tall';
  if (has(h, 'cap', 'hat', 'neet', 'mcga', 'helmet')) return 'cap';
  return 'dome';
}

export function material(t) {
  const a = (t.Aura || '').toLowerCase();
  if (a.includes('burn') || a.includes('fire') || a.includes('lightning') || a.includes('electric'))
    return { kind: 'bouncy', friction: 0.55, restitution: 0.28, density: 0.0016 };
  if (a.includes('smoke') || a.includes('ice') || a.includes('frost') || a.includes('water') || a.includes('bubble'))
    return { kind: 'slick', friction: 0.18, restitution: 0.02, density: 0.0014 };
  if (a) return { kind: 'charged', friction: 0.7, restitution: 0.08, density: 0.002 };
  return { kind: 'grippy', friction: 0.85, restitution: 0.02, density: 0.0016 };
}

const TIER_SCALE = { Common: 1, Uncommon: 1.04, Rare: 1.09, Epic: 1.13, Mythic: 1.18, Legendary: 1.26 };

function roundedRect(w, h, r, cx = 0, cy = 0) {
  const pts = [];
  const corners = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 90], [-w / 2 + r, -h / 2 + r, 180], [w / 2 - r, -h / 2 + r, 270]];
  for (const [x, y, a0] of corners)
    for (let k = 0; k <= 3; k++) {
      const a = (a0 + k * 30) * Math.PI / 180;
      pts.push([cx + x + Math.cos(a) * r, cy + y + Math.sin(a) * r]);
    }
  return pts;
}

function arc(w, h, cx, baseY, n = 10) {
  // upper half-ellipse sitting on baseY
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = Math.PI + (i / n) * Math.PI;
    pts.push([cx + Math.cos(a) * w / 2, baseY + Math.sin(a) * h]);
  }
  return pts;
}

// Returns local-space convex parts (arrays of [x,y]), y grows downward, origin near the core centre.
export function shapeFor(id, chog) {
  const t = chog?.traits || {};
  const tier = t.Tier || 'Common';
  const s = (TIER_SCALE[tier] || 1) * (1 + (hash(id) - 0.5) * 0.08);
  const naked = t.Naked === 'Yes';
  const bulky = has(t.Body, 'jacket', 'hoodie', 'puffer', 'vest', 'coat', 'armor', 'armour', 'jersey');
  const w = 100 * s * (naked ? 0.9 : 1) * (bulky ? 1.08 : 1);
  const h = 74 * s;
  const dir = t.Side === 'Right' ? 1 : -1;
  const kind = tier === 'Legendary' || t.Base === '1:1' ? 'star' : headKind(t);
  const parts = [roundedRect(w, h, 14 * s)];
  const top = -h / 2;

  if (kind === 'cap') {
    parts.push([[-w * 0.36, top + 2], [-w * 0.3, top - h * 0.3], [w * 0.3, top - h * 0.3], [w * 0.36, top + 2]]);
    const bx0 = dir > 0 ? w * 0.1 : -w * 0.1 - w * 0.62;
    parts.push([[bx0, top - 2], [bx0 + w * 0.62, top - 2], [bx0 + w * 0.62, top + h * 0.1], [bx0, top + h * 0.1]]);
  } else if (kind === 'flat') {
    parts.push([[-w * 0.55, top - h * 0.14], [w * 0.55, top - h * 0.14], [w * 0.55, top + 4], [-w * 0.55, top + 4]]);
  } else if (kind === 'bucket') {
    // wide floppy brim: the best deck in the set
    parts.push([[-w * 0.3, top + 2], [-w * 0.26, top - h * 0.3], [w * 0.26, top - h * 0.3], [w * 0.3, top + 2]]);
    parts.push([[-w * 0.64, top - 2], [w * 0.64, top - 2], [w * 0.6, top + h * 0.1], [-w * 0.6, top + h * 0.1]]);
  } else if (kind === 'tall') {
    parts.push([[-w * 0.26, top + 2], [-w * 0.26, top - h * 0.55], [w * 0.26, top - h * 0.55], [w * 0.26, top + 2]]);
  } else if (kind === 'spike') {
    // nearly a point: the hardest thing in the set to stack on
    parts.push([[-w * 0.36, top + 2], [-w * 0.12, top - h * 0.42], [w * 0.12, top - h * 0.42], [w * 0.36, top + 2]]);
  } else if (kind === 'ears') {
    // two flat-topped ears: a wobbly bridge
    parts.push([[-w * 0.48, top + 6], [-w * 0.42, top - h * 0.24], [-w * 0.24, top - h * 0.24], [-w * 0.16, top + 4]]);
    parts.push([[w * 0.16, top + 4], [w * 0.24, top - h * 0.24], [w * 0.42, top - h * 0.24], [w * 0.48, top + 6]]);
  } else if (kind === 'dome') {
    // shallow dome with a small flat crown
    const d = arc(w * 0.94, h * 0.2, 0, top + 4, 8);
    parts.push([d[0], d[1], d[2], [-w * 0.22, top + 4 - h * 0.2], [w * 0.22, top + 4 - h * 0.2], d[6], d[7], d[8]]);
  } else if (kind === 'star') {
    for (let k = 0; k < 3; k++) {
      const cx = (k - 1) * w * 0.32;
      parts.push([[cx - w * 0.16, top + 2], [cx, top - h * (k === 1 ? 0.5 : 0.32)], [cx + w * 0.16, top + 2]]);
    }
  }

  if (t.Accessory && t.Accessory !== 'None') {
    const nx = -dir; // nub on the side opposite the brim
    const nw = w * 0.2, nh = h * 0.32;
    const x0 = nx > 0 ? w / 2 - 4 : -w / 2 + 4 - nw;
    parts.push([[x0, -nh / 2], [x0 + nw, -nh / 2 + 4], [x0 + nw, nh / 2 - 4], [x0, nh / 2]]);
  }

  return { parts, w, h, kind, mat: material(t), dir };
}

// ---------- matter world ----------

export function createEngine() {
  const engine = Engine.create({ enableSleeping: true, positionIterations: 14, velocityIterations: 10, constraintIterations: 4 });
  engine.gravity.y = 1;
  const plat = Bodies.rectangle(0, PLATFORM.top + PLATFORM.h / 2, PLATFORM.w, PLATFORM.h, {
    isStatic: true, label: 'platform', friction: 0.9, chamfer: { radius: 10 },
  });
  Composite.add(engine.world, plat);
  engine.platform = plat;
  return engine;
}

export function makePiece(pieceId, tokenId, chog, x, y, angle = 0) {
  const sh = shapeFor(tokenId, chog);
  const bodies = sh.parts.map(verts => {
    const v = verts.map(([px, py]) => ({ x: px, y: py }));
    const c = Vertices.centre(v);
    return Bodies.fromVertices(c.x, c.y, [v], { friction: sh.mat.friction, restitution: sh.mat.restitution, density: sh.mat.density });
  });
  const body = bodies.length === 1 ? bodies[0] : Body.create({ parts: bodies });
  Body.set(body, { friction: sh.mat.friction, frictionStatic: 1.2, frictionAir: 0.02, restitution: sh.mat.restitution, sleepThreshold: 90 });
  // anchor: shift so the core centre sits at (x,y)
  const off = { x: body.position.x, y: body.position.y };
  Body.setPosition(body, { x: x + off.x, y: y + off.y });
  if (angle) Body.rotate(body, angle, { x, y });
  body.label = 'piece';
  // core: where the core centre sits relative to body.position in the unrotated frame (for art placement)
  body.plugin = { pieceId, tokenId, kind: sh.kind, mat: sh.mat.kind, core: { x: -off.x, y: -off.y }, w: sh.w, h: sh.h };
  return body;
}

export function pieces(engine) {
  return Composite.allBodies(engine.world).filter(b => b.label === 'piece');
}

export function towerTop(engine) {
  let top = PLATFORM.top;
  for (const b of pieces(engine)) if (b.bounds.min.y < top && b.position.y < FALL_Y) top = b.bounds.min.y;
  return top;
}

export function heightM(engine) {
  return Math.max(0, (PLATFORM.top - towerTop(engine)) / PX_PER_M);
}

export function summit(engine) {
  let best = null;
  for (const b of pieces(engine)) if (b.position.y < FALL_Y && (!best || b.bounds.min.y < best.bounds.min.y)) best = b;
  return best;
}

// Steps the world until it settles (or maxSteps), recording frames of whatever moved.
// effect: optional (engine, step) => void, used for quakes and gusts.
export function simulate(engine, { maxSteps = 600, sampleEvery = 2, effect = null, minSteps = 90 } = {}) {
  const dt = 1000 / 60;
  const frames = [];
  let still = 0;
  for (let step = 0; step < maxSteps; step++) {
    if (effect) effect(engine, step);
    for (let k = 0; k < SUB; k++) Engine.update(engine, dt / SUB);
    const all = pieces(engine);
    if (step % sampleEvery === 0) {
      const f = [];
      for (const b of all) if (!b.isSleeping) f.push(b.plugin.pieceId, +b.position.x.toFixed(2), +b.position.y.toFixed(2), +b.angle.toFixed(4));
      frames.push(f);
    }
    const moving = all.some(b => !b.isSleeping && b.position.y < FALL_Y && (b.speed > 0.08 || b.angularSpeed > 0.004));
    still = moving ? 0 : still + 1;
    if (step > minSteps && still > 30) break;
  }
  return frames;
}

export function removeFallen(engine) {
  const gone = pieces(engine).filter(b => b.position.y > FALL_Y || Math.abs(b.position.x) > 1400);
  for (const b of gone) Composite.remove(engine.world, b);
  return gone;
}

export function quakeEffect(strength = 1) {
  return (engine, step) => {
    if (step > 70) return;
    const p = engine.platform;
    const x = Math.sin(step * 0.9) * 7 * strength * (1 - step / 70);
    Body.setPosition(p, { x, y: p.position.y }, true);
    if (step === 0) for (const b of pieces(engine)) Sleeping.set(b, false);
    if (step === 70) Body.setPosition(p, { x: 0, y: p.position.y }, true);
  };
}

export function gustEffect(dir = 1, strength = 1) {
  return (engine, step) => {
    if (step > 60) return;
    const top = towerTop(engine);
    for (const b of pieces(engine)) {
      if (step === 0) Sleeping.set(b, false);
      const k = Math.max(0, (PLATFORM.top - b.position.y) / Math.max(1, PLATFORM.top - top)); // higher = windier
      Body.applyForce(b, b.position, { x: dir * 0.00055 * b.mass * k * strength, y: 0 });
    }
  };
}

export function snapshot(engine) {
  return pieces(engine).map(b => ({
    id: b.plugin.pieceId, t: b.plugin.tokenId,
    x: b.position.x, y: b.position.y, a: b.angle,
  }));
}

// Rebuild bodies from a snapshot. Pieces are put to sleep so a reload doesn't jolt the tower.
export function restore(engine, snap, chogs, meta = {}) {
  for (const s of snap) {
    const b = makePiece(s.id, s.t, chogs[s.t], 0, 0, 0);
    Body.setPosition(b, { x: s.x, y: s.y });
    Body.setAngle(b, s.a);
    Object.assign(b.plugin, meta[s.id] || {});
    Composite.add(engine.world, b);
    Sleeping.set(b, true);
  }
}

export { Matter };
