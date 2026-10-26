import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encode8, decode8, rle, unrle, toExport, fromExport, toRecord, fromRecord } from '../js/codec.js';
import { classifyStages } from '../js/analysis.js';
import { synthNight, generateDemoNights } from '../js/demo.js';

test('log-scale byte encoding keeps values within ~5% and preserves nulls', () => {
  const vals = [0, 1, 6, 9, 25, 80, 210, 1000, 5000, 20000, null];
  const back = decode8(encode8(vals));
  vals.forEach((v, i) => {
    if (v == null) assert.equal(back[i], null);
    else assert.ok(Math.abs(back[i] - v) <= Math.max(1, v * 0.05), `${v} -> ${back[i]}`);
  });
});

test('stage run-length encoding round-trips', () => {
  const st = 'AAAALLLLLLDDDDDDDDRRRLLA';
  assert.equal(rle(st), 'A4L6D8R3L2A1');
  assert.equal(unrle(rle(st)), st);
  assert.equal(unrle(''), '');
  assert.equal(unrle('AALD'), 'AALD');
});

test('compact readings give the same sleep analysis', () => {
  let agree = 0;
  let total = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const { m, s } = synthNight({ seed, hours: 8 });
    const a = classifyStages(m, s);
    const b = classifyStages(decode8(encode8(m)), decode8(encode8(s)));
    for (let i = 0; i < a.length; i++) if (a[i] === b[i]) agree++;
    total += a.length;
  }
  assert.ok(agree / total > 0.95, `agreement ${(agree / total).toFixed(3)}`);
});

test('a night is under 3 KB in the export format', () => {
  const [night] = generateDemoNights(1);
  const size = JSON.stringify(toExport(night)).length;
  assert.ok(size < 3000, `export size ${size}`);
});

test('export round-trip keeps analysis, notes and stages', () => {
  const [night] = generateDemoNights(1);
  const back = fromExport(JSON.parse(JSON.stringify(toExport(night))));
  assert.equal(back.stages, night.stages);
  assert.deepEqual(back.summary, night.summary);
  assert.deepEqual(back.notes, night.notes);
  assert.equal(back.m.length, night.m.length);
});

test('old export format (plain arrays) is still accepted', () => {
  const [night] = generateDemoNights(1);
  const old = JSON.parse(JSON.stringify(night)); // v1: arrays, plain stages
  const back = fromExport(old);
  assert.equal(back.stages, night.stages);
  assert.ok(back.m instanceof Uint8Array);
  assert.deepEqual(fromRecord(toRecord(back)).stages, night.stages);
});
