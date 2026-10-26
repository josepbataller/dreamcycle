// Compact storage format for nights (pure, no DOM; tested in Node).
//
// Sensor readings are stored as one byte per epoch on a log scale (~4%
// resolution, plenty for activity analysis; 255 = no reading). Stages are
// run-length encoded ("A38L30D82..."). An 8-hour night shrinks from ~6 KB of
// JSON to ~2 KB.

const NULL_CODE = 255;
const K = 25; // log1p(v) * K; covers values up to ~25,000

export function encode8(values) {
  if (values instanceof Uint8Array) return values;
  const out = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    out[i] = v == null ? NULL_CODE : Math.min(254, Math.round(Math.log1p(Math.max(0, v)) * K));
  }
  return out;
}

export function decode8(bytes) {
  if (Array.isArray(bytes)) return bytes;
  const out = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i] === NULL_CODE ? null : Math.round(Math.expm1(bytes[i] / K));
  }
  return out;
}

export function rle(stages) {
  if (!stages) return '';
  return stages.replace(/(.)\1*/g, (run) => run[0] + run.length);
}

export function unrle(encoded) {
  if (!encoded) return '';
  if (!/\d/.test(encoded)) return encoded; // already plain
  return encoded.replace(/([A-Z])(\d+)/g, (_, c, n) => c.repeat(Number(n)));
}

export function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Night as stored in IndexedDB (binary readings, RLE stages).
export function toRecord(night) {
  return { ...night, v: 2, m: encode8(night.m || []), s: encode8(night.s || []), stages: rle(night.stages) };
}

// Night as used by the app (stages expanded; readings stay compact because
// the views only need the stored analysis).
export function fromRecord(rec) {
  return { ...rec, m: encode8(rec.m || []), s: encode8(rec.s || []), stages: unrle(rec.stages) };
}

// Export file entry (JSON-safe): readings as base64.
export function toExport(night) {
  const r = toRecord(night);
  return { ...r, m: bytesToBase64(r.m), s: bytesToBase64(r.s) };
}

// Accepts both the old export format (plain arrays) and the compact one.
export function fromExport(entry) {
  const ch = (x) => (typeof x === 'string' ? base64ToBytes(x) : encode8(x || []));
  return fromRecord({ ...entry, m: ch(entry.m), s: ch(entry.s) });
}
