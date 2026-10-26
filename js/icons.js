// Small inline SVG icon set (24px grid, stroke-based).
const P = {
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  journal: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  chart: '<path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>',
  sound: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a9 9 0 0 1 0 14"/>',
  settings: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>',
  rain: '<path d="M16 13v8"/><path d="M8 13v8"/><path d="M12 15v8"/><path d="M20 16.6A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3"/>',
  waves: '<path d="M2 6c2 0 2.5 2 5 2s3-2 5-2 2.5 2 5 2 3-2 5-2"/><path d="M2 12c2 0 2.5 2 5 2s3-2 5-2 2.5 2 5 2 3-2 5-2"/><path d="M2 18c2 0 2.5 2 5 2s3-2 5-2 2.5 2 5 2 3-2 5-2"/>',
  stream: '<path d="M3 7c3-3 6 3 9 0s6 3 9 0"/><path d="M3 17c3-3 6 3 9 0s6 3 9 0"/><path d="M8 12h.01"/><path d="M16 12h.01"/>',
  wind: '<path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/><path d="M17.7 7.7A2.5 2.5 0 1 1 19.5 12H2"/>',
  fire: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 17c1.4 0 2.5-1 2.5-2.5S12 12 12 10c-1 1-3.5 2.5-3.5 4.5z"/><path d="M12 2c0 3-3 4.5-5 7a7 7 0 1 0 10 0c-.7 1-1.5 1.5-2 1.5C15 7.5 12 5 12 2z"/>',
  fan: '<circle cx="12" cy="12" r="2"/><path d="M12 10c0-3 1-6 4-6s4 2 4 4-2 3-4 3"/><path d="M14 12c3 0 6 1 6 4s-2 4-4 4-3-2-3-4"/><path d="M12 14c0 3-1 6-4 6s-4-2-4-4 2-3 4-3"/><path d="M10 12c-3 0-6-1-6-4s2-4 4-4 3 2 3 4"/>',
  noise: '<circle cx="12" cy="12" r="9"/>',
  noiseHalf: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/>',
  noiseFull: '<circle cx="12" cy="12" r="9" fill="currentColor"/>',
  theta: '<path d="M2 12h3l3-7 4 14 3-9 2 4h5"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01"/><path d="M15 9h.01"/>',
  neutral: '<circle cx="12" cy="12" r="9"/><path d="M8 15h8"/><path d="M9 9h.01"/><path d="M15 9h.01"/>',
  frown: '<circle cx="12" cy="12" r="9"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><path d="M9 9h.01"/><path d="M15 9h.01"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 17v5"/>',
  motion: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M3 8v8"/><path d="M21 8v8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  save: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.3 17.7-1.4 1.4"/><path d="m19.1 4.9-1.4 1.4"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
};

export function icon(name, size = 20, cls = '') {
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

export const SOUND_ICON = {
  rain: 'rain', ocean: 'waves', stream: 'stream', wind: 'wind', fire: 'fire', fan: 'fan',
  white: 'noise', pink: 'noiseHalf', brown: 'noiseFull', theta: 'theta',
};
