// Local persistence (localStorage). Everything stays on the phone.
const KEYS = { settings: 'dc.settings', nights: 'dc.nights', active: 'dc.active' };

export const DEFAULT_SETTINGS = {
  alarmTime: '07:00',
  alarmMode: 'smart', // smart | regular | none
  windowMin: 30,
  snoozeMin: 9,
  alarmSound: 'chimes',
  rampSec: 60,
  alarmVolume: 1,
  shakeToSnooze: true,
  sensorMode: 'both', // both | mic | motion
  goalHours: 8,
  aidSound: 'rain', // sleep aid sound id
  aidOnStart: false,
  aidTimerMin: 30, // 0 = all night
  aidVolume: 0.5,
};

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error('Storage write failed', e);
    alert('Could not save: phone storage for this app is full. Export your data and delete old nights in Settings.');
    return false;
  }
}

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) };
}
export function saveSettings(s) {
  write(KEYS.settings, s);
}

export function listNights() {
  return read(KEYS.nights, []).sort((a, b) => b.start - a.start);
}
export function getNight(id) {
  return listNights().find((n) => n.id === id) || null;
}
export function saveNight(night) {
  const nights = listNights().filter((n) => n.id !== night.id);
  nights.push(night);
  return write(KEYS.nights, nights);
}
export function saveNights(list) {
  return write(KEYS.nights, list);
}
export function deleteNight(id) {
  write(KEYS.nights, listNights().filter((n) => n.id !== id));
}

// The night currently being tracked, saved every epoch so a reload or crash
// doesn't lose it.
export function saveActive(session) {
  write(KEYS.active, session);
}
export function loadActive() {
  return read(KEYS.active, null);
}
export function clearActive() {
  localStorage.removeItem(KEYS.active);
}

export function exportAll() {
  return JSON.stringify({ app: 'dreamcycle', version: 1, exportedAt: new Date().toISOString(), settings: loadSettings(), nights: listNights() });
}
export function importAll(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data.nights)) throw new Error('Not a DreamCycle export file');
  const byId = new Map(listNights().map((n) => [n.id, n]));
  for (const n of data.nights) byId.set(n.id, n);
  write(KEYS.nights, [...byId.values()]);
  return data.nights.length;
}
export function clearAll() {
  for (const k of Object.values(KEYS)) localStorage.removeItem(k);
}
