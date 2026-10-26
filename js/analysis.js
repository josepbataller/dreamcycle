// Pure sleep-analysis logic (no DOM). Shared by the app and the Node tests.
//
// A night is recorded as one sample per 30-second epoch on two channels:
//   m[i] - motion energy (mean high-pass acceleration, milli m/s^2), or null
//   s[i] - sound activity (summed dB above the adaptive noise floor), or null
// Like Sleep Cycle, stages are estimated from activity: sustained movement =
// awake, frequent small movement = light sleep, long calm stretches = deep
// sleep, and calm stretches later in a cycle with small twitches = dreaming.

export const EPOCH_SEC = 30;
export const EPOCH_MS = EPOCH_SEC * 1000;

export const STAGE_INFO = {
  A: { key: 'awake', label: 'Awake', level: 0, color: '#f6c560' },
  R: { key: 'rem', label: 'Dreaming', level: 1, color: '#c17cf0' },
  L: { key: 'light', label: 'Light', level: 2, color: '#5ec8f2' },
  D: { key: 'deep', label: 'Deep', level: 3, color: '#3d63f0' },
};
export const STAGE_ORDER = ['A', 'R', 'L', 'D'];

// Smallest scale used to normalise each channel, so a very still night isn't
// blown up into "lots of movement" by sensor noise.
const MIN_SCALE = { m: 12, s: 25 };

export function percentile(values, p) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

// Centred triangular moving average.
export function smooth(x, radius) {
  const n = x.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let w = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j < 0 || j >= n) continue;
      const wk = radius + 1 - Math.abs(k);
      sum += x[j] * wk;
      w += wk;
    }
    out[i] = w ? sum / w : 0;
  }
  return out;
}

function normalizeChannel(raw, minScale) {
  if (!raw || !raw.length) return null;
  const vals = raw.filter((v) => v != null);
  if (vals.length < 3) return null;
  const base = percentile(vals, 0.1);
  const excess = vals.map((v) => Math.max(0, v - base));
  const scale = Math.max(percentile(excess, 0.9), minScale);
  return raw.map((v) => (v == null ? null : Math.max(0, v - base) / scale));
}

// Combined activity per epoch (~1 = a typical clear movement).
// Returns null when neither channel has usable data.
export function combinedActivity(m = [], s = []) {
  const n = Math.max(m.length, s.length);
  const nm = normalizeChannel(m, MIN_SCALE.m);
  const ns = normalizeChannel(s, MIN_SCALE.s);
  if (!nm && !ns) return null;
  const a = new Array(n);
  for (let i = 0; i < n; i++) {
    const vm = nm ? nm[i] ?? null : null;
    const vs = ns ? ns[i] ?? null : null;
    if (vm != null && vs != null) a[i] = Math.max(vm, 0.8 * vs);
    else a[i] = vm ?? (vs != null ? 0.8 * vs : 0);
  }
  return a;
}

function runs(arr) {
  const out = [];
  let start = 0;
  for (let i = 1; i <= arr.length; i++) {
    if (i === arr.length || arr[i] !== arr[start]) {
      out.push({ v: arr[start], start, end: i });
      start = i;
    }
  }
  return out;
}

// Returns the stage string (one char per epoch: A/R/L/D).
export function classifyStages(m, s) {
  const a = combinedActivity(m, s);
  const n = Math.max(m.length, s.length);
  if (n === 0) return '';
  if (!a || n < 8) return 'A'.repeat(n);

  const aShort = smooth(a, 1);
  const aLong = smooth(a, 8);
  const ref = Math.max(percentile(aLong, 0.85), 0.08);
  const depth = smooth(aLong.map((v) => 1 - Math.min(1, v / (ref * 1.2))), 6);
  const awakeT = Math.max(0.9, ref * 2);

  // Sleep onset: first stretch of 8 quiet minutes.
  const need = 16;
  let onset = -1;
  for (let i = 0; i + need <= n && onset < 0; i++) {
    let ok = true;
    for (let j = i; j < i + need; j++) {
      if (aShort[j] >= awakeT * 0.5) {
        ok = false;
        break;
      }
    }
    if (ok) onset = i;
  }
  if (onset < 0) return 'A'.repeat(n);

  // Final wake: trailing run of strong activity.
  let wake = n;
  while (wake > onset && aShort[wake - 1] >= awakeT) wake--;

  const st = new Array(n);
  for (let i = 0; i < n; i++) {
    if (i < onset || i >= wake || aShort[i] >= awakeT) st[i] = 'A';
    else st[i] = depth[i] >= 0.68 ? 'C' : 'L'; // C = calm (deep or dreaming)
  }

  // Single-epoch awakenings inside sleep are just big movements.
  for (const r of runs(st)) {
    if (r.v === 'A' && r.start > onset && r.end < wake && r.end - r.start < 2) {
      for (let i = r.start; i < r.end; i++) st[i] = 'L';
    }
  }

  // Merge calm runs separated by less than 3 minutes of light sleep.
  for (const r of runs(st)) {
    if (r.v === 'L' && r.end - r.start < 6 && st[r.start - 1] === 'C' && st[r.end] === 'C') {
      for (let i = r.start; i < r.end; i++) st[i] = 'C';
    }
  }

  // Decide deep vs dreaming for each calm run using cycle structure.
  const calmVals = [];
  for (let i = 0; i < n; i++) if (st[i] === 'C') calmVals.push(a[i]);
  const calmMedian = percentile(calmVals, 0.5);
  const sleepLen = Math.max(1, wake - onset);
  let prevCalm = null;
  for (const r of runs(st)) {
    if (r.v !== 'C') continue;
    let mean = 0;
    for (let i = r.start; i < r.end; i++) mean += a[i];
    mean /= r.end - r.start;
    const minutesIn = ((r.start - onset) * EPOCH_SEC) / 60;
    const position = (r.start - onset) / sleepLen;
    let score = 0;
    if (prevCalm === 'D') score += 1;
    if (position > 0.5) score += 1;
    if (mean > calmMedian * 1.3 + 0.01) score += 1;
    if (minutesIn < 60) score -= 2;
    const label = score >= 2 ? 'R' : 'D';
    for (let i = r.start; i < r.end; i++) st[i] = label;
    prevCalm = label;
  }

  // Absorb very short sleep-stage runs (< 2 min) into the previous stage.
  const out = st;
  const rs = runs(out);
  for (let k = 0; k < rs.length; k++) {
    const r = rs[k];
    if (r.v === 'A' || r.end - r.start >= 4) continue;
    const fill = k > 0 ? out[rs[k - 1].start] : rs[k + 1] ? rs[k + 1].v : 'L';
    if (fill === 'A') continue;
    for (let i = r.start; i < r.end; i++) out[i] = fill;
  }
  return out.join('');
}

export function summarize(night, stages, { goalHours = 8 } = {}) {
  const n = stages.length;
  const counts = { A: 0, R: 0, L: 0, D: 0 };
  for (const c of stages) counts[c]++;
  const sleepEpochs = n - counts.A;
  const first = stages.search(/[RLD]/);
  const last = Math.max(stages.lastIndexOf('R'), stages.lastIndexOf('L'), stages.lastIndexOf('D'));

  let awakenings = 0;
  if (first >= 0) {
    for (const r of runs(stages.slice(first, last + 1).split(''))) if (r.v === 'A') awakenings++;
  }

  const asleepMs = sleepEpochs * EPOCH_MS;
  const inBedMs = Math.max(night.end - night.start, n * EPOCH_MS);
  const frac = (k) => (sleepEpochs ? counts[k] / sleepEpochs : 0);

  const asleepH = asleepMs / 3600000;
  const efficiency = n ? sleepEpochs / n : 0;
  const duration = Math.min(1, asleepH / goalHours) * 45;
  const eff = Math.min(1, Math.max(0, (efficiency - 0.7) / 0.25)) * 20;
  const deep = Math.min(1, frac('D') / 0.2) * 15;
  const rem = Math.min(1, frac('R') / 0.2) * 10;
  const wakes = Math.max(0, 1 - awakenings / 6) * 10;
  const quality = sleepEpochs ? Math.max(1, Math.min(100, Math.round(duration + eff + deep + rem + wakes))) : 0;

  return {
    quality,
    inBedMs,
    asleepMs,
    latencyMs: first >= 0 ? first * EPOCH_MS : null,
    sleepStart: first >= 0 ? night.start + first * EPOCH_MS : null,
    sleepEnd: first >= 0 ? night.start + (last + 1) * EPOCH_MS : null,
    awakenings,
    minutes: {
      A: (counts.A * EPOCH_SEC) / 60,
      R: (counts.R * EPOCH_SEC) / 60,
      L: (counts.L * EPOCH_SEC) / 60,
      D: (counts.D * EPOCH_SEC) / 60,
    },
    efficiency,
  };
}

export function analyzeNight(night, opts) {
  const stages = classifyStages(night.m || [], night.s || []);
  return { stages, summary: summarize(night, stages, opts) };
}

// Live smart-alarm decision, called once per epoch during the night.
export function shouldWake({ m = [], s = [], nowMs, targetMs, windowMin = 30, mode = 'smart' }) {
  if (mode === 'none' || targetMs == null) return { wake: false };
  if (nowMs >= targetMs) return { wake: true, reason: mode === 'smart' ? 'end-of-window' : 'time' };
  if (mode !== 'smart') return { wake: false };
  if (nowMs < targetMs - windowMin * 60000) return { wake: false };

  const a = combinedActivity(m, s);
  if (!a || a.length < 6) return { wake: false, inWindow: true };
  const recent = a.slice(-3);
  const mean = recent.reduce((x, y) => x + y, 0) / recent.length;
  const peak = Math.max(...a.slice(-2));
  const lightT = Math.max(0.3, percentile(a, 0.7));
  if (mean >= lightT || peak >= Math.max(0.6, lightT * 2)) return { wake: true, reason: 'light-sleep' };
  return { wake: false, inWindow: true };
}

// Next occurrence of "HH:MM" after `fromMs`.
export function nextAlarmTime(hhmm, fromMs = Date.now()) {
  const [h, mi] = hhmm.split(':').map(Number);
  const d = new Date(fromMs);
  d.setHours(h, mi, 0, 0);
  if (d.getTime() <= fromMs + 60000) d.setDate(d.getDate() + 1);
  return d.getTime();
}
