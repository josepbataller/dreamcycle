// Synthetic nights: used by the tests and by "Load sample data" in Settings.
import { EPOCH_MS, EPOCH_SEC, analyzeNight } from './analysis.js';

export function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Builds a ground-truth hypnogram from ~90-minute cycles, then emits noisy
// motion/sound readings the way the phone sensors would.
export function synthNight({ seed = 1, hours = 8 } = {}) {
  const rnd = mulberry32(seed);
  const perMin = 60 / EPOCH_SEC;
  const truth = [];
  const push = (stage, minutes) => {
    for (let i = 0; i < Math.round(minutes * perMin); i++) truth.push(stage);
  };
  const total = Math.round(hours * 60 * perMin);

  push('A', 8 + rnd() * 15);
  const deepMin = [45, 35, 20, 8, 0, 0, 0];
  const remMin = [8, 15, 20, 25, 30, 30, 30];
  for (let c = 0; truth.length < total; c++) {
    push('L', 12 + rnd() * 10);
    if (deepMin[c]) push('D', deepMin[c] * (0.8 + rnd() * 0.4));
    push('L', 8 + rnd() * 8);
    push('R', remMin[c] * (0.8 + rnd() * 0.4));
    if (c >= 2 && rnd() < 0.4) push('A', 1 + rnd() * 2);
  }
  truth.length = total;
  push('A', 4);

  const m = [];
  const s = [];
  for (const st of truth) {
    const noise = 6 + rnd() * 4;
    if (st === 'A') {
      m.push(Math.round(noise + 60 + rnd() * 150));
      s.push(rnd() < 0.7 ? Math.round(20 + rnd() * 80) : 0);
    } else if (st === 'L') {
      m.push(Math.round(noise + (rnd() < 0.25 ? 20 + rnd() * 60 : 0)));
      s.push(rnd() < 0.15 ? Math.round(5 + rnd() * 30) : 0);
    } else if (st === 'R') {
      m.push(Math.round(noise + (rnd() < 0.12 ? 10 + rnd() * 25 : 0)));
      s.push(rnd() < 0.08 ? Math.round(5 + rnd() * 20) : 0);
    } else {
      m.push(Math.round(noise));
      s.push(rnd() < 0.02 ? Math.round(rnd() * 10) : 0);
    }
  }
  return { m, s, truth: truth.join('') };
}

const NOTE_POOL = ['coffee', 'workout', 'stress', 'alcohol', 'late-meal', 'screen', 'reading'];
const MOODS = ['good', 'good', 'ok', 'bad'];

export function generateDemoNights(count = 14, goalHours = 8) {
  const nights = [];
  const today = new Date();
  for (let k = count; k >= 1; k--) {
    const seed = 1000 + k;
    const rnd = mulberry32(seed * 7);
    const d = new Date(today);
    d.setDate(d.getDate() - k);
    d.setHours(22, 30 + Math.round(rnd() * 90), 0, 0);
    const hours = 6 + rnd() * 2.5;
    const { m, s } = synthNight({ seed, hours });
    const start = d.getTime();
    const night = {
      id: `demo-${start}`,
      demo: true,
      start,
      end: start + m.length * EPOCH_MS,
      m,
      s,
      sensors: { motion: true, mic: true },
      alarm: { mode: 'smart', windowMin: 30, targetMs: start + m.length * EPOCH_MS + 10 * 60000, reason: 'light-sleep' },
      notes: NOTE_POOL.filter(() => rnd() < 0.2),
      mood: MOODS[Math.floor(rnd() * MOODS.length)],
    };
    night.alarm.firedAt = night.end;
    Object.assign(night, analyzeNight(night, { goalHours }));
    nights.push(night);
  }
  return nights;
}
