// SVG chart builders (return markup strings).
import { STAGE_INFO, STAGE_ORDER, smooth } from './analysis.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function fmtHour(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Smooth Sleep Cycle-style sleep graph: Awake on top, Deep at the bottom.
export function hypnogram(stages, startMs, endMs, { width = 340, height = 190, mini = false } = {}) {
  if (!stages || !stages.length) return '<div class="muted small">No data</div>';
  const padL = mini ? 0 : 62;
  const padR = mini ? 0 : 8;
  const padT = mini ? 4 : 10;
  const padB = mini ? 4 : 24;
  const w = width - padL - padR;
  const h = height - padT - padB;
  const levels = smooth([...stages].map((c) => STAGE_INFO[c].level), Math.max(1, Math.round(stages.length / 70)));
  const maxPts = mini ? 80 : 240;
  const step = Math.max(1, Math.floor(levels.length / maxPts));
  const pts = [];
  for (let i = 0; i < levels.length; i += step) pts.push([i, levels[i]]);
  pts.push([levels.length - 1, levels[levels.length - 1]]);
  const X = (i) => padL + (i / Math.max(1, levels.length - 1)) * w;
  const Y = (lv) => padT + (lv / 3) * h;
  let d = `M${X(pts[0][0]).toFixed(1)},${Y(pts[0][1]).toFixed(1)}`;
  for (let k = 1; k < pts.length; k++) {
    const [i0, l0] = pts[k - 1];
    const [i1, l1] = pts[k];
    const mx = (X(i0) + X(i1)) / 2;
    d += ` C${mx.toFixed(1)},${Y(l0).toFixed(1)} ${mx.toFixed(1)},${Y(l1).toFixed(1)} ${X(i1).toFixed(1)},${Y(l1).toFixed(1)}`;
  }
  const area = `${d} L${X(levels.length - 1).toFixed(1)},${padT + h} L${padL},${padT + h} Z`;
  const id = `g${Math.random().toString(36).slice(2, 8)}`;

  let grid = '';
  if (!mini) {
    STAGE_ORDER.forEach((c) => {
      const y = Y(STAGE_INFO[c].level);
      grid += `<line x1="${padL}" x2="${padL + w}" y1="${y}" y2="${y}" class="grid"/>`;
      grid += `<circle cx="7" cy="${y}" r="4" fill="${STAGE_INFO[c].color}"/>`;
      grid += `<text x="15" y="${y + 4}" class="axis">${STAGE_INFO[c].label}</text>`;
    });
    // Hour ticks
    const first = new Date(startMs);
    first.setMinutes(0, 0, 0);
    const span = endMs - startMs;
    const every = span > 6 * 3600000 ? 2 : 1;
    for (let t = first.getTime() + 3600000; t < endMs; t += 3600000 * every) {
      const x = padL + ((t - startMs) / span) * w;
      if (x < padL + 70 || x > padL + w - 70) continue;
      grid += `<text x="${x}" y="${height - 6}" class="axis" text-anchor="middle">${esc(fmtHour(t))}</text>`;
    }
    grid += `<text x="${padL}" y="${height - 6}" class="axis">${esc(fmtHour(startMs))}</text>`;
    grid += `<text x="${padL + w}" y="${height - 6}" class="axis" text-anchor="end">${esc(fmtHour(endMs))}</text>`;
  }

  return `<svg viewBox="0 0 ${width} ${height}" class="chart" preserveAspectRatio="none" role="img" aria-label="Sleep graph">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${STAGE_INFO.A.color}" stop-opacity="0.55"/>
      <stop offset="0.35" stop-color="${STAGE_INFO.R.color}" stop-opacity="0.45"/>
      <stop offset="0.68" stop-color="${STAGE_INFO.L.color}" stop-opacity="0.35"/>
      <stop offset="1" stop-color="${STAGE_INFO.D.color}" stop-opacity="0.25"/>
    </linearGradient></defs>
    ${grid}
    <path d="${area}" fill="url(#${id})"/>
    <path d="${d}" fill="none" stroke="#e8ecff" stroke-width="${mini ? 1.5 : 2}" stroke-linejoin="round"/>
  </svg>`;
}

export function stageBar(minutes) {
  const total = STAGE_ORDER.reduce((s, c) => s + (minutes[c] || 0), 0) || 1;
  return `<div class="stagebar">${STAGE_ORDER.map(
    (c) => `<span style="width:${((minutes[c] || 0) / total) * 100}%;background:${STAGE_INFO[c].color}"></span>`,
  ).join('')}</div>`;
}

export function qualityRing(q, size = 120) {
  const r = size / 2 - 9;
  const circ = 2 * Math.PI * r;
  const off = circ * (1 - Math.max(0, Math.min(100, q)) / 100);
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="ring">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-bg"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fg" stroke-dasharray="${circ}" stroke-dashoffset="${off}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="50%" dy="0.1em" text-anchor="middle" dominant-baseline="middle" class="ring-text">${Math.round(q)}%</text>
  </svg>`;
}

// Vertical bars. values: [{ label, value, color? }]
export function barChart(values, { height = 150, max = null, fmt = (v) => v, goal = null } = {}) {
  if (!values.length) return '<div class="muted small">No data yet</div>';
  const width = 340;
  const padB = 20;
  const padT = 16;
  const h = height - padB - padT;
  const top = max ?? Math.max(...values.map((v) => v.value), goal || 0, 1);
  const bw = width / values.length;
  const showLabelEvery = Math.ceil(values.length / 10);
  let out = '';
  values.forEach((v, i) => {
    const bh = (Math.max(0, v.value) / top) * h;
    const x = i * bw + bw * 0.15;
    out += `<rect x="${x}" y="${padT + h - bh}" width="${bw * 0.7}" height="${bh}" rx="${Math.min(4, bw * 0.2)}" fill="${v.color || '#5b7cfa'}"><title>${esc(v.label)}: ${esc(fmt(v.value))}</title></rect>`;
    if (values.length <= 14) out += `<text x="${x + bw * 0.35}" y="${padT + h - bh - 4}" class="axis" text-anchor="middle">${esc(fmt(v.value))}</text>`;
    if (i % showLabelEvery === 0) out += `<text x="${x + bw * 0.35}" y="${height - 5}" class="axis" text-anchor="middle">${esc(v.label)}</text>`;
  });
  if (goal) {
    const y = padT + h - (goal / top) * h;
    out += `<line x1="0" x2="${width}" y1="${y}" y2="${y}" class="goal"/>`;
  }
  return `<svg viewBox="0 0 ${width} ${height}" class="chart" role="img">${out}</svg>`;
}
