// Tiny WebAudio synth: no files, just blips, thunks and rumbles.
let ac = null, master = null, muted = false;
try { muted = localStorage.getItem('cs:mute') === '1'; } catch {}

export function unlock() {
  if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
  ac = new (window.AudioContext || window.webkitAudioContext)();
  master = ac.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(ac.destination);
}
export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('cs:mute', muted ? '1' : '0'); } catch {}
  if (master) master.gain.value = muted ? 0 : 0.5;
  return muted;
}
export const isMuted = () => muted;

function tone(f0, f1, dur, type = 'square', vol = 0.2, delay = 0) {
  if (!ac) return;
  const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol = 0.3, freq = 800, delay = 0, q = 0.8) {
  if (!ac) return;
  const t = ac.currentTime + delay, n = Math.floor(ac.sampleRate * dur), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  src.buffer = buf; f.type = 'lowpass'; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(master); src.start(t);
}

export const sfx = {
  click: () => tone(900, 600, 0.05, 'square', 0.08),
  rotate: () => tone(500, 700, 0.06, 'triangle', 0.12),
  release: () => { tone(700, 220, 0.25, 'triangle', 0.18); noise(0.18, 0.08, 2400); },
  thunk: (k = 1) => { tone(160 / k, 60, 0.18, 'sine', 0.35); noise(0.12, 0.25, 500); },
  wobble: () => tone(300, 260, 0.3, 'sine', 0.08),
  summit: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.16, 'square', 0.1, i * 0.08)),
  miss: () => { tone(400, 90, 0.6, 'sawtooth', 0.12); },
  knock: () => { tone(220, 80, 0.3, 'square', 0.12); noise(0.3, 0.2, 900); },
  collapse: () => { noise(2.2, 0.55, 380, 0, 1.5); tone(110, 30, 1.6, 'sawtooth', 0.22); [0, .25, .5, .8].forEach(d => noise(0.3, 0.3, 1200, d)); },
  gust: () => noise(1.4, 0.35, 1400, 0, 2.5),
  quake: () => { noise(1.4, 0.5, 160, 0, 3); tone(55, 40, 1.2, 'sine', 0.4); },
  crown: () => [784, 988, 1175, 1568].forEach((f, i) => tone(f, f * 1.01, 0.22, 'triangle', 0.14, i * 0.1)),
};
