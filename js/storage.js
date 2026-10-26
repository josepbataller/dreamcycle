// Local persistence. Everything stays on the phone.
//
// - Nights live in IndexedDB (compact format from codec.js). Safari allows
//   IndexedDB a large share of free disk space, so years of nights fit.
// - All nights are loaded into memory once at startup (initStorage), so the
//   views can read them synchronously; writes update memory immediately and
//   are persisted in the background.
// - Settings and the night currently being tracked stay in localStorage
//   (small, and the active night must be saved synchronously every epoch).
import { toRecord, fromRecord, toExport, fromExport } from './codec.js';

const KEYS = {
  settings: 'dc.settings',
  legacyNights: 'dc.nights', // v1 storage, migrated to IndexedDB
  active: 'dc.active',
  lastBackup: 'dc.lastBackup',
  backupSnooze: 'dc.backupSnooze',
};
const DB_NAME = 'dreamcycle';
const STORE = 'nights';

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
    return false;
  }
}

function reportWriteError(e) {
  console.error('Saving nights failed', e);
  alert('Could not save your sleep data on this phone. Export a backup from Settings so nothing is lost.');
}

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) };
}
export function saveSettings(s) {
  write(KEYS.settings, s);
}

// ---------------------------------------------------------------------------
// IndexedDB

let db = null;
let nights = []; // in-memory copy, newest first

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('Database blocked by another open copy of the app'));
  });
}

// Runs fn(store) in one transaction; resolves when it is committed.
function tx(mode, fn) {
  if (!db) return Promise.reject(new Error('Storage not available'));
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
  });
}

const sortNights = () => nights.sort((a, b) => b.start - a.start);

export async function initStorage() {
  try {
    db = await openDb();
  } catch (e) {
    console.error('IndexedDB unavailable', e);
    alert('This browser can\'t store sleep history (private browsing?). Open DreamCycle from the home screen icon.');
    nights = (read(KEYS.legacyNights, []) || []).map(fromExport);
    sortNights();
    return;
  }
  const records = await req(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
  nights = records.map(fromRecord);
  await migrateLegacy();
  sortNights();
}

// v1 kept every night as JSON in localStorage (~5 MB limit). Move them over
// once, and only delete the old copy after IndexedDB has committed.
async function migrateLegacy() {
  const legacy = read(KEYS.legacyNights, null);
  if (!Array.isArray(legacy) || !legacy.length) {
    if (legacy) localStorage.removeItem(KEYS.legacyNights);
    return;
  }
  const migrated = legacy.map(fromExport);
  await tx('readwrite', (store) => migrated.forEach((n) => store.put(toRecord(n))));
  const byId = new Map(nights.map((n) => [n.id, n]));
  migrated.forEach((n) => byId.set(n.id, n));
  nights = [...byId.values()];
  localStorage.removeItem(KEYS.legacyNights);
}

export function listNights() {
  return nights;
}
export function getNight(id) {
  return nights.find((n) => n.id === id) || null;
}
export function saveNight(night) {
  const n = fromRecord(toRecord(night));
  nights = nights.filter((x) => x.id !== n.id);
  nights.push(n);
  sortNights();
  return tx('readwrite', (store) => store.put(toRecord(n))).catch(reportWriteError);
}
// Replaces the whole history with `list`.
export function saveNights(list) {
  nights = list.map((n) => fromRecord(toRecord(n)));
  sortNights();
  return tx('readwrite', (store) => {
    store.clear();
    nights.forEach((n) => store.put(toRecord(n)));
  }).catch(reportWriteError);
}
export function deleteNight(id) {
  nights = nights.filter((n) => n.id !== id);
  return tx('readwrite', (store) => store.delete(id)).catch(reportWriteError);
}

// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Backups

export function exportAll() {
  return JSON.stringify({
    app: 'dreamcycle',
    version: 2,
    exportedAt: new Date().toISOString(),
    settings: loadSettings(),
    nights: nights.map(toExport),
  });
}

export async function importAll(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data.nights)) throw new Error('Not a DreamCycle export file');
  const incoming = data.nights.map(fromExport);
  const byId = new Map(nights.map((n) => [n.id, n]));
  incoming.forEach((n) => byId.set(n.id, n));
  nights = [...byId.values()];
  sortNights();
  await tx('readwrite', (store) => incoming.forEach((n) => store.put(toRecord(n))));
  return incoming.length;
}

export function markBackedUp() {
  localStorage.setItem(KEYS.lastBackup, String(Date.now()));
  localStorage.removeItem(KEYS.backupSnooze);
}
export function lastBackupAt() {
  const v = Number(localStorage.getItem(KEYS.lastBackup));
  return v || null;
}
export function snoozeBackupReminder(days = 7) {
  localStorage.setItem(KEYS.backupSnooze, String(Date.now() + days * 86400000));
}

// Remind monthly once there is something worth keeping.
export function backupDue() {
  const real = nights.filter((n) => !n.demo);
  if (real.length < 3) return false;
  const snooze = Number(localStorage.getItem(KEYS.backupSnooze));
  if (snooze && Date.now() < snooze) return false;
  const last = lastBackupAt();
  if (!last) return true;
  return Date.now() - last > 30 * 86400000 && real.some((n) => n.start > last);
}

export async function storageUsage() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    return { usage, quota };
  } catch {
    return null;
  }
}

export async function clearAll() {
  nights = [];
  for (const k of Object.values(KEYS)) localStorage.removeItem(k);
  await tx('readwrite', (store) => store.clear()).catch(reportWriteError);
}
