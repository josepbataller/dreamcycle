import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStages, analyzeNight, shouldWake, nextAlarmTime, EPOCH_MS } from '../js/analysis.js';
import { synthNight, generateDemoNights } from '../js/demo.js';

const isSleep = (c) => c !== 'A';

test('sleep vs awake agrees with ground truth on synthetic nights', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { m, s, truth } = synthNight({ seed, hours: 7.5 });
    const st = classifyStages(m, s);
    assert.equal(st.length, truth.length);
    let agree = 0;
    for (let i = 0; i < st.length; i++) if (isSleep(st[i]) === isSleep(truth[i])) agree++;
    assert.ok(agree / st.length > 0.9, `seed ${seed}: sleep/wake agreement ${(agree / st.length).toFixed(2)}`);
  }
});

test('deep sleep is detected mostly in the first half, dreaming in the second', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { m, s } = synthNight({ seed, hours: 8 });
    const st = classifyStages(m, s);
    const half = st.length / 2;
    const count = (c, from, to) => [...st.slice(from, to)].filter((x) => x === c).length;
    const deep = count('D', 0, st.length);
    const rem = count('R', 0, st.length);
    assert.ok(deep / st.length > 0.08 && deep / st.length < 0.45, `seed ${seed}: deep share ${deep / st.length}`);
    assert.ok(rem > 0, `seed ${seed}: some dreaming detected`);
    assert.ok(count('D', 0, half) > count('D', half, st.length), `seed ${seed}: deep front-loaded`);
    assert.ok(count('R', half, st.length) >= count('R', 0, half), `seed ${seed}: dreaming back-loaded`);
  }
});

test('stage agreement with ground truth is reasonable', () => {
  let agree = 0;
  let total = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const { m, s, truth } = synthNight({ seed, hours: 8 });
    const st = classifyStages(m, s);
    for (let i = 0; i < st.length; i++) if (st[i] === truth[i]) agree++;
    total += st.length;
  }
  assert.ok(agree / total > 0.6, `overall stage agreement ${(agree / total).toFixed(2)}`);
});

test('summary gives a sensible quality score', () => {
  const { m, s } = synthNight({ seed: 3, hours: 8 });
  const night = { start: 0, end: m.length * EPOCH_MS, m, s };
  const { summary } = analyzeNight(night, { goalHours: 8 });
  assert.ok(summary.quality >= 60 && summary.quality <= 100, `quality ${summary.quality}`);
  assert.ok(summary.asleepMs > 6.5 * 3600000);
  assert.ok(summary.latencyMs > 0);

  const short = synthNight({ seed: 3, hours: 3 });
  const shortNight = { start: 0, end: short.m.length * EPOCH_MS, m: short.m, s: short.s };
  assert.ok(analyzeNight(shortNight).summary.quality < summary.quality);
});

test('a night with no readable data is all awake and scores 0', () => {
  const m = new Array(100).fill(null);
  const { stages, summary } = analyzeNight({ start: 0, end: 100 * EPOCH_MS, m, s: m });
  assert.equal(stages, 'A'.repeat(100));
  assert.equal(summary.quality, 0);
});

test('works with only one sensor channel', () => {
  const { m, s, truth } = synthNight({ seed: 5, hours: 7 });
  for (const [mm, ss] of [[m, []], [[], s.map((v, i) => v + (truth[i] === 'L' && i % 7 === 0 ? 20 : 0))]]) {
    const st = classifyStages(mm, ss);
    assert.equal(st.length, truth.length);
    assert.ok(/[LD]/.test(st), 'finds some sleep');
  }
});

test('smart alarm wakes on movement inside the window, not outside it', () => {
  const { m, s } = synthNight({ seed: 7, hours: 7 });
  const target = 10_000_000;
  const quiet = { m: [...m, ...Array(10).fill(8)], s: [...s, ...Array(10).fill(0)] };
  const moving = { m: [...quiet.m, 90, 120, 80], s: [...quiet.s, 30, 40, 0] };

  assert.equal(shouldWake({ ...moving, nowMs: target - 45 * 60000, targetMs: target, windowMin: 30 }).wake, false);
  assert.equal(shouldWake({ ...quiet, nowMs: target - 10 * 60000, targetMs: target, windowMin: 30 }).wake, false);
  const w = shouldWake({ ...moving, nowMs: target - 10 * 60000, targetMs: target, windowMin: 30 });
  assert.deepEqual(w, { wake: true, reason: 'light-sleep' });
  assert.deepEqual(shouldWake({ ...quiet, nowMs: target, targetMs: target, windowMin: 30 }), { wake: true, reason: 'end-of-window' });
});

test('regular alarm only fires at the set time; no alarm never fires', () => {
  const data = { m: [100, 120, 130, 90, 100, 110, 120], s: [] };
  assert.equal(shouldWake({ ...data, mode: 'regular', nowMs: 99, targetMs: 100 }).wake, false);
  assert.equal(shouldWake({ ...data, mode: 'regular', nowMs: 100, targetMs: 100 }).wake, true);
  assert.equal(shouldWake({ ...data, mode: 'none', nowMs: 1e12, targetMs: 100 }).wake, false);
});

test('nextAlarmTime picks the next occurrence', () => {
  const now = new Date(2026, 9, 24, 23, 0).getTime();
  assert.equal(new Date(nextAlarmTime('07:00', now)).getDate(), 25);
  assert.equal(new Date(nextAlarmTime('23:30', now)).getDate(), 24);
});

test('demo nights are analysed and plausible', () => {
  const nights = generateDemoNights(7);
  assert.equal(nights.length, 7);
  for (const n of nights) {
    assert.equal(n.stages.length, n.m.length);
    assert.ok(n.summary.quality > 30);
  }
});

test('a flat night (no sensor activity at all) is flagged as low signal', () => {
  const n = 900;
  const flat = { start: 0, end: n * EPOCH_MS, m: Array.from({ length: n }, (_, i) => 5 + (i % 3)), s: new Array(n).fill(0) };
  const { summary } = analyzeNight(flat);
  assert.equal(summary.lowSignal, true);
  assert.ok(summary.quality <= 50);
  const { m, s } = synthNight({ seed: 4, hours: 8 });
  assert.equal(analyzeNight({ start: 0, end: m.length * EPOCH_MS, m, s }).summary.lowSignal, false);
});
