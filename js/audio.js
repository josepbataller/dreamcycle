// All sound is synthesised with the Web Audio API: no audio files to download,
// works offline. iOS only allows audio after a tap, so unlockAudio() must be
// called from a click handler (the Start button) and the context is then kept
// alive all night with an inaudible tone.

let ctx = null;
let keepAliveNode = null;

export function getCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    ctx.addEventListener('statechange', () => {
      if (ctx.state !== 'running' && (keepAliveNode || alarm || aid)) ctx.resume().catch(() => {});
    });
  }
  return ctx;
}

// iOS 17+: 'playback' ignores the silent switch; 'play-and-record' while the
// microphone is in use.
export function setSessionType(type) {
  try {
    if (navigator.audioSession) navigator.audioSession.type = type;
  } catch {
    /* unsupported */
  }
}

export function unlockAudio() {
  const c = getCtx();
  if (c.state !== 'running') c.resume().catch(() => {});
  const src = c.createBufferSource();
  src.buffer = c.createBuffer(1, 1, 22050);
  src.connect(c.destination);
  src.start(0);
}

export function startKeepAlive() {
  if (keepAliveNode) return;
  const c = getCtx();
  const osc = c.createOscillator();
  const g = c.createGain();
  g.gain.value = 0.0001;
  osc.frequency.value = 40;
  osc.connect(g).connect(c.destination);
  osc.start();
  keepAliveNode = { osc, g };
}

export function stopKeepAlive() {
  if (!keepAliveNode) return;
  try {
    keepAliveNode.osc.stop();
  } catch {
    /* already stopped */
  }
  keepAliveNode = null;
}

export function resumeAudio() {
  if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
}

// ---------------------------------------------------------------------------
// Sleep aid sounds: generated as loopable stereo buffers.

export const AID_SOUNDS = [
  { id: 'rain', name: 'Rain', icon: '🌧️' },
  { id: 'ocean', name: 'Ocean waves', icon: '🌊' },
  { id: 'stream', name: 'Forest stream', icon: '🏞️' },
  { id: 'wind', name: 'Soft wind', icon: '🍃' },
  { id: 'fire', name: 'Campfire', icon: '🔥' },
  { id: 'fan', name: 'Fan', icon: '🌀' },
  { id: 'white', name: 'White noise', icon: '⚪' },
  { id: 'pink', name: 'Pink noise', icon: '🌸' },
  { id: 'brown', name: 'Brown noise', icon: '🟤' },
  { id: 'theta', name: 'Theta waves', icon: '🧠' },
];

const LOOP_SEC = 24;
const bufferCache = new Map();

function pinkGen() {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  return () => {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    const out = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    return out * 0.11;
  };
}
function brownGen() {
  let last = 0;
  return () => {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    return last * 3.5;
  };
}
function onePole(cutoff, sr) {
  const a = Math.exp((-2 * Math.PI * cutoff) / sr);
  let y = 0;
  return (x) => (y = (1 - a) * x + a * y);
}

function fillChannel(id, data, sr) {
  const n = data.length;
  const pink = pinkGen();
  const brown = brownGen();
  const white = () => Math.random() * 2 - 1;
  const tau = 2 * Math.PI;
  switch (id) {
    case 'white':
      for (let i = 0; i < n; i++) data[i] = white() * 0.35;
      break;
    case 'pink':
      for (let i = 0; i < n; i++) data[i] = pink();
      break;
    case 'brown':
      for (let i = 0; i < n; i++) data[i] = brown();
      break;
    case 'fan': {
      const lp = onePole(500, sr);
      const lp2 = onePole(900, sr);
      for (let i = 0; i < n; i++) data[i] = lp2(lp(brown() * 2 + white() * 0.2)) * 1.3 + Math.sin((tau * 100 * i) / sr) * 0.01;
      break;
    }
    case 'rain': {
      const lp = onePole(300, sr);
      let drop = 0, dropEnv = 0;
      for (let i = 0; i < n; i++) {
        const p = pink();
        const hp = p - lp(p);
        if (Math.random() < 40 / sr) { dropEnv = 0.2 + Math.random() * 0.5; drop = 2000 + Math.random() * 4000; }
        dropEnv *= 0.9985;
        data[i] = hp * 0.9 + p * 0.25 + Math.sin((tau * drop * i) / sr) * white() * dropEnv * 0.15;
      }
      break;
    }
    case 'ocean': {
      const wash = onePole(1200, sr);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        // two waves per loop so the loop point is seamless
        const env = Math.pow(0.5 - 0.5 * Math.cos(tau * 2 * t), 1.6);
        data[i] = brown() * (0.25 + 0.75 * env) + wash(pink()) * env * env * 0.9;
      }
      break;
    }
    case 'wind': {
      const lp = onePole(700, sr);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const env = 0.45 + 0.3 * Math.sin(tau * 3 * t) + 0.25 * Math.sin(tau * 7 * t + 1);
        data[i] = lp(pink() * 2.2) * env * 1.6;
      }
      break;
    }
    case 'stream': {
      const lp = onePole(800, sr);
      let mod = 0.5;
      for (let i = 0; i < n; i++) {
        mod += (Math.random() - 0.5) * 0.002;
        mod = Math.min(1, Math.max(0.2, mod));
        const p = pink();
        data[i] = (p - lp(p)) * (0.6 + mod) * 1.2;
      }
      break;
    }
    case 'fire': {
      const lp = onePole(300, sr);
      let env = 0;
      for (let i = 0; i < n; i++) {
        if (Math.random() < 8 / sr) env = 0.3 + Math.random() * (Math.random() < 0.1 ? 1 : 0.4);
        env *= 0.996;
        data[i] = lp(brown() * 2) * 0.8 + white() * env * 0.5;
      }
      break;
    }
    default:
      for (let i = 0; i < n; i++) data[i] = 0;
  }
  // Short fade at the loop seam.
  const fade = Math.floor(sr * 0.05);
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    data[i] *= g;
    data[n - 1 - i] *= g;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(data[i]));
  if (peak > 0) for (let i = 0; i < n; i++) data[i] *= 0.8 / peak;
}

function aidBuffer(id) {
  if (bufferCache.has(id)) return bufferCache.get(id);
  const c = getCtx();
  const buf = c.createBuffer(2, Math.floor(c.sampleRate * LOOP_SEC), c.sampleRate);
  for (let ch = 0; ch < 2; ch++) fillChannel(id, buf.getChannelData(ch), c.sampleRate);
  bufferCache.set(id, buf);
  return buf;
}

let aid = null; // { id, gain, sources, stopTimer }

export function currentAid() {
  return aid ? aid.id : null;
}

export function playAid(id, { volume = 0.5, timerMin = 0, fadeSec = 60 } = {}) {
  stopAid(0.3);
  const c = getCtx();
  if (c.state !== 'running') c.resume().catch(() => {});
  const gain = c.createGain();
  const t0 = c.currentTime;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + 3);
  gain.connect(c.destination);
  const sources = [];
  if (id === 'theta') {
    // Binaural beat: 200 Hz left, 205 Hz right (best with headphones).
    [200, 205].forEach((f, ch) => {
      const osc = c.createOscillator();
      osc.frequency.value = f;
      const pan = c.createStereoPanner();
      pan.pan.value = ch ? 1 : -1;
      const g = c.createGain();
      g.gain.value = 0.35;
      osc.connect(g).connect(pan).connect(gain);
      osc.start();
      sources.push(osc);
    });
    const bed = c.createBufferSource();
    bed.buffer = aidBuffer('brown');
    bed.loop = true;
    const g = c.createGain();
    g.gain.value = 0.25;
    bed.connect(g).connect(gain);
    bed.start();
    sources.push(bed);
  } else {
    const src = c.createBufferSource();
    src.buffer = aidBuffer(id);
    src.loop = true;
    src.connect(gain);
    src.start();
    sources.push(src);
  }
  aid = { id, gain, sources, volume, stopTimer: null, endsAt: null };
  if (timerMin > 0) {
    const tEnd = t0 + timerMin * 60;
    gain.gain.setValueAtTime(volume, tEnd - fadeSec);
    gain.gain.linearRampToValueAtTime(0.0001, tEnd);
    aid.endsAt = Date.now() + timerMin * 60000;
    const me = aid;
    aid.stopTimer = setTimeout(() => {
      if (aid === me) stopAid(0);
    }, timerMin * 60000 + 500);
  }
  notifyAid();
}

export function setAidVolume(v) {
  if (!aid) return;
  aid.volume = v;
  if (aid.endsAt) return; // don't break a scheduled fade-out
  const c = getCtx();
  aid.gain.gain.cancelScheduledValues(c.currentTime);
  aid.gain.gain.setTargetAtTime(v, c.currentTime, 0.1);
}

export function stopAid(fadeSec = 1) {
  if (!aid) return;
  const { gain, sources, stopTimer } = aid;
  aid = null;
  clearTimeout(stopTimer);
  const c = getCtx();
  const t = c.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(gain.gain.value, t);
  gain.gain.linearRampToValueAtTime(0.0001, t + Math.max(0.05, fadeSec));
  setTimeout(() => {
    sources.forEach((s) => {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    });
    gain.disconnect();
  }, Math.max(0.05, fadeSec) * 1000 + 100);
  notifyAid();
}

const aidListeners = new Set();
export function onAidChange(fn) {
  aidListeners.add(fn);
}
function notifyAid() {
  aidListeners.forEach((fn) => fn(currentAid()));
}

// ---------------------------------------------------------------------------
// Alarm sounds.

export const ALARM_SOUNDS = [
  { id: 'chimes', name: 'Gentle chimes' },
  { id: 'sunrise', name: 'Sunrise' },
  { id: 'birds', name: 'Morning birds' },
  { id: 'classic', name: 'Classic beep' },
];

function bell(dest, freq, t, amp = 0.25, dur = 2.4) {
  const c = getCtx();
  [[1, 1], [2.76, 0.35], [5.4, 0.15]].forEach(([mult, a]) => {
    const o = c.createOscillator();
    o.frequency.value = freq * mult;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp * a, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur / mult);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.1);
  });
}

function pad(dest, freqs, t, dur) {
  const c = getCtx();
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1400;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.09, t + 1.5);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  lp.connect(g).connect(dest);
  freqs.forEach((f) => {
    [-6, 6].forEach((det) => {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.1);
    });
  });
}

function chirp(dest, t) {
  const c = getCtx();
  const reps = 2 + Math.floor(Math.random() * 4);
  const f0 = 2500 + Math.random() * 2000;
  for (let k = 0; k < reps; k++) {
    const st = t + k * 0.13;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(f0, st);
    o.frequency.exponentialRampToValueAtTime(f0 * (1.3 + Math.random() * 0.4), st + 0.05);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.8, st + 0.09);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, st);
    g.gain.exponentialRampToValueAtTime(0.12, st + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, st + 0.1);
    o.connect(g).connect(dest);
    o.start(st);
    o.stop(st + 0.12);
  }
  return reps * 0.13;
}

const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66];
const CHORDS = [
  [261.63, 329.63, 392, 493.88],
  [220, 261.63, 329.63, 392],
  [174.61, 220, 261.63, 329.63],
  [196, 246.94, 293.66, 392],
];

const PATTERNS = {
  chimes(dest, t, step) {
    const idx = step % 8;
    if (idx === 7) return 1.4;
    bell(dest, PENTA[(step * 3 + Math.floor(step / 8)) % PENTA.length], t);
    return 0.42;
  },
  sunrise(dest, t, step) {
    pad(dest, CHORDS[step % CHORDS.length], t, 4.6);
    bell(dest, PENTA[(step * 2) % PENTA.length] * 2, t + 0.5, 0.12, 3);
    return 4;
  },
  birds(dest, t) {
    return chirp(dest, t) + 0.3 + Math.random() * 1.4;
  },
  classic(dest, t) {
    const c = getCtx();
    for (let k = 0; k < 4; k++) {
      const o = c.createOscillator();
      o.type = 'square';
      o.frequency.value = 880;
      const g = c.createGain();
      const st = t + k * 0.2;
      g.gain.setValueAtTime(0.0001, st);
      g.gain.linearRampToValueAtTime(0.08, st + 0.01);
      g.gain.setValueAtTime(0.08, st + 0.1);
      g.gain.linearRampToValueAtTime(0.0001, st + 0.11);
      o.connect(g).connect(dest);
      o.start(st);
      o.stop(st + 0.12);
    }
    return 1.4;
  },
};

let alarm = null;

export function isAlarmPlaying() {
  return !!alarm;
}

export function startAlarm(id = 'chimes', { rampSec = 60, volume = 1 } = {}) {
  stopAlarm();
  setSessionType('playback');
  const c = getCtx();
  if (c.state !== 'running') c.resume().catch(() => {});
  const master = c.createGain();
  const now = c.currentTime;
  master.gain.setValueAtTime(0.02, now);
  master.gain.exponentialRampToValueAtTime(Math.max(0.03, volume), now + Math.max(0.5, rampSec));
  const comp = c.createDynamicsCompressor();
  const boost = c.createGain();
  boost.gain.value = 2.2;
  master.connect(comp).connect(boost).connect(c.destination);
  const pattern = PATTERNS[id] || PATTERNS.chimes;
  let next = now + 0.1;
  let step = 0;
  const schedule = () => {
    while (next < c.currentTime + 0.6) {
      next += pattern(master, next, step++);
    }
  };
  schedule();
  const timer = setInterval(schedule, 150);
  alarm = { master, boost, timer };
}

export function stopAlarm() {
  if (!alarm) return;
  const { master, boost, timer } = alarm;
  alarm = null;
  clearInterval(timer);
  const c = getCtx();
  master.gain.cancelScheduledValues(c.currentTime);
  master.gain.setValueAtTime(master.gain.value, c.currentTime);
  master.gain.linearRampToValueAtTime(0.0001, c.currentTime + 0.25);
  setTimeout(() => boost.disconnect(), 400);
}

let previewTimer = null;
export function previewAlarm(id, volume = 1) {
  clearTimeout(previewTimer);
  startAlarm(id, { rampSec: 0.5, volume });
  previewTimer = setTimeout(stopAlarm, 6000);
}
