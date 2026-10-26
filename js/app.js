import { analyzeNight, nextAlarmTime, shouldWake, STAGE_INFO, STAGE_ORDER, EPOCH_MS } from './analysis.js';
import {
  initStorage, loadSettings, saveSettings, listNights, getNight, saveNight, saveNights, deleteNight,
  saveActive, loadActive, clearActive, exportAll, importAll, clearAll,
  markBackedUp, lastBackupAt, snoozeBackupReminder, backupDue, storageUsage,
} from './storage.js';
import {
  unlockAudio, startKeepAlive, stopKeepAlive, resumeAudio, setSessionType,
  AID_SOUNDS, playAid, stopAid, setAidVolume, currentAid, onAidChange,
  ALARM_SOUNDS, startAlarm, stopAlarm, previewAlarm,
} from './audio.js';
import { Tracker, requestMotionPermission, requestMic } from './tracker.js';
import { hypnogram, stageBar, qualityRing, barChart } from './charts.js';
import { generateDemoNights } from './demo.js';
import { icon, SOUND_ICON } from './icons.js';

const $ = (sel) => document.querySelector(sel);
const view = $('#view');
const overlay = $('#overlay');
const nav = $('#nav');

const NOTES = [
  { id: 'coffee', label: 'Coffee', icon: '☕' },
  { id: 'alcohol', label: 'Alcohol', icon: '🍷' },
  { id: 'workout', label: 'Workout', icon: '🏃' },
  { id: 'stress', label: 'Stress', icon: '😣' },
  { id: 'late-meal', label: 'Late meal', icon: '🍽️' },
  { id: 'screen', label: 'Screen in bed', icon: '📱' },
  { id: 'reading', label: 'Reading', icon: '📖' },
  { id: 'meditation', label: 'Meditation', icon: '🧘' },
  { id: 'nap', label: 'Daytime nap', icon: '💤' },
  { id: 'sick', label: 'Sick', icon: '🤒' },
  { id: 'medication', label: 'Medication', icon: '💊' },
  { id: 'shared', label: 'Shared bed', icon: '👥' },
];
const MOODS = [
  { id: 'good', icon: 'smile', label: 'Good' },
  { id: 'ok', icon: 'neutral', label: 'OK' },
  { id: 'bad', icon: 'frown', label: 'Bad' },
];
const noteInfo = (id) => NOTES.find((n) => n.id === id) || { id, label: id, icon: '' };
const moodInfo = (id) => MOODS.find((m) => m.id === id);

let settings = loadSettings();
let tab = 'sleep';
let statsPeriod = 7;
let session = null; // { night, tracker, phase: 'tracking'|'ringing'|'snoozing', snoozeUntil, clock }

// ---------------------------------------------------------------------------
// Formatting

const fmtTime = (ms) => (ms == null ? '–' : new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
const fmtDate = (ms) => new Date(ms).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
function fmtDur(ms) {
  if (ms == null || ms < 0) return '–';
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}
const fmtMin = (min) => fmtDur(min * 60000);

// ---------------------------------------------------------------------------
// Screen wake lock: the phone must stay awake all night for tracking + alarm.

let wakeLock = null;
const wakeLockSupported = 'wakeLock' in navigator;

async function requestWakeLock() {
  if (!wakeLockSupported || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
    });
  } catch (e) {
    console.warn('Wake lock failed', e);
  }
}
function releaseWakeLock() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && session) {
    requestWakeLock();
    resumeAudio();
    session.tracker.checkEpoch();
    updateNight();
  }
});

// ---------------------------------------------------------------------------
// Tabs

const TABS = [
  { id: 'sleep', label: 'Sleep', icon: 'moon' },
  { id: 'journal', label: 'Journal', icon: 'journal' },
  { id: 'stats', label: 'Statistics', icon: 'chart' },
  { id: 'sounds', label: 'Sounds', icon: 'sound' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

function renderNav() {
  nav.innerHTML = TABS.map(
    (t) => `<button data-action="tab" data-tab="${t.id}" class="${tab === t.id ? 'on' : ''}">${icon(t.icon, 22)}<span>${t.label}</span></button>`,
  ).join('');
}

function render() {
  renderNav();
  const views = { sleep: viewSleep, journal: viewJournal, stats: viewStats, sounds: viewSounds, settings: viewSettings };
  const banner = (tab === 'sleep' || tab === 'journal') && backupDue() ? backupBanner() : '';
  view.innerHTML = banner + views[tab]();
  if (tab === 'settings') fillStorageInfo();
}

function backupBanner() {
  const last = lastBackupAt();
  return `<div class="banner">${icon('save', 18, 'banner-ic')}<div><b>Back up your sleep history.</b> Your nights are only stored on this phone.
    ${last ? `Last backup: ${fmtDate(last)}.` : 'You haven\'t made a backup yet.'}
    Choose <b>Save to Files</b> (iCloud Drive) when asked.
    <div class="banner-actions"><button class="secondary" data-action="export">Back up now</button>
    <button class="link" data-action="backup-later">Later</button></div></div></div>`;
}

async function fillStorageInfo() {
  const el = $('#storageInfo');
  if (!el) return;
  const last = lastBackupAt();
  const count = listNights().filter((n) => !n.demo).length;
  let text = `${count} night${count === 1 ? '' : 's'} stored on this phone · last backup: ${last ? fmtDate(last) : 'never'}`;
  const u = await storageUsage();
  if (u && u.usage != null) text += ` · using ${(u.usage / 1048576).toFixed(1)} MB`;
  el.textContent = text;
}

const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function viewSleep() {
  const s = settings;
  const target = nextAlarmTime(s.alarmTime);
  const windowStart = target - s.windowMin * 60000;
  const subtitle =
    s.alarmMode === 'smart'
      ? `Wake up easy between <b>${fmtTime(windowStart)}</b> and <b>${fmtTime(target)}</b>`
      : s.alarmMode === 'regular'
        ? `Alarm rings at <b>${fmtTime(target)}</b>`
        : 'Track your sleep without an alarm';
  const aid = AID_SOUNDS.find((a) => a.id === s.aidSound);
  const installHint =
    isIOS && !isStandalone && !localStorage.getItem('dc.hideInstall')
      ? `<div class="banner">${icon('share', 18, 'banner-ic')}<div>To install: tap <b>Share</b> then <b>Add to Home Screen</b>. <button class="link" data-action="hide-install">Dismiss</button></div></div>`
      : '';
  return `
    ${installHint}
    <header class="top"><h1>Sleep</h1><span class="muted">${new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</span></header>
    <section class="card alarm-card">
      <div class="seg">${[['smart', 'Smart alarm'], ['regular', 'Regular'], ['none', 'No alarm']]
        .map(([m, l]) => `<button data-action="mode" data-mode="${m}" class="${s.alarmMode === m ? 'on' : ''}">${l}</button>`)
        .join('')}</div>
      ${s.alarmMode !== 'none' ? `<input type="time" class="big-time" data-setting="alarmTime" value="${s.alarmTime}" aria-label="Alarm time">` : `<div class="big-time moon">${icon('moon', 56)}</div>`}
      <p class="center sub">${subtitle}</p>
      ${s.alarmMode === 'smart'
        ? `<div class="label">Wake-up window</div>
           <div class="chips">${[10, 20, 30, 45, 60, 90]
             .map((w) => `<button class="chip ${s.windowMin === w ? 'on' : ''}" data-action="window" data-min="${w}">${w} min</button>`)
             .join('')}</div>`
        : ''}
      ${s.alarmMode !== 'none' ? `<p class="muted small center">Time in bed if you go to sleep now: ${fmtDur(target - Date.now())}</p>` : ''}
    </section>
    <section class="card row">
      <div class="grow">
        <div class="label">Sleep aid</div>
        <div class="row-value">${aid ? aid.name : 'None'} · ${s.aidTimerMin ? `${s.aidTimerMin} min` : 'all night'}
          <button class="link" data-action="tab" data-tab="sounds">Change</button></div>
      </div>
      <label class="switch"><input type="checkbox" data-setting="aidOnStart" ${s.aidOnStart ? 'checked' : ''}><span></span></label>
    </section>
    <button class="primary big" data-action="start">Start sleep tracking</button>
    <p class="tip">Plug your phone in. Put it face down on the mattress near your pillow (best: motion + sound), or on the nightstand with the microphone uncovered. Keep the app open: the screen stays on and dark until morning.</p>`;
}

function viewJournal() {
  const nights = listNights();
  if (!nights.length) {
    return `<header class="top"><h1>Journal</h1></header>
      <div class="empty">${icon('journal', 40, 'empty-ic')}<p>No nights yet. Start tracking from the Sleep tab tonight.</p>
      <button class="secondary" data-action="load-demo">Load sample data</button></div>`;
  }
  return `<header class="top"><h1>Journal</h1></header>
    ${nights
      .map((n) => {
        const mood = moodInfo(n.mood);
        return `<article class="card night-card" data-action="open" data-id="${n.id}">
          <div class="nc-head">
            <div><div class="nc-date">${fmtDate(n.start)}</div>
              <div class="muted small">${fmtTime(n.start)} – ${fmtTime(n.end)} · ${fmtDur(n.summary.asleepMs)} asleep</div></div>
            <div class="nc-q">${n.summary.quality}%</div>
          </div>
          <div class="mini">${hypnogram(n.stages, n.start, n.end, { mini: true, height: 54 })}</div>
          <div class="nc-foot">${mood ? `<span class="mood-ic ${mood.id}">${icon(mood.icon, 16)}</span>` : ''}${(n.notes || []).slice(0, 3).map((id) => `<span class="tag">${noteInfo(id).label}</span>`).join('')}${(n.notes || []).length > 3 ? `<span class="tag">+${n.notes.length - 3}</span>` : ''}${n.demo ? '<span class="tag sample">sample</span>' : ''}</div>
        </article>`;
      })
      .join('')}`;
}

// Clock times averaged relative to noon so 23:30 and 00:30 average to midnight.
const clockMin = (ms) => {
  const d = new Date(ms);
  return (d.getHours() * 60 + d.getMinutes() + 720) % 1440;
};
const fromClockMin = (m) => {
  const d = new Date();
  d.setHours(0, Math.round(m + 720) % 1440, 0, 0);
  return d.getTime();
};

function viewStats() {
  const all = listNights();
  const periods = [[7, '7 days'], [30, '30 days'], [90, '90 days'], [0, 'All']];
  const head = `<header class="top"><h1>Statistics</h1></header>
    <div class="seg small">${periods.map(([p, l]) => `<button data-action="period" data-p="${p}" class="${statsPeriod === p ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const nights = (statsPeriod ? all.filter((n) => n.start >= Date.now() - statsPeriod * 86400000) : all).slice().reverse();
  if (!nights.length) {
    return `${head}<div class="empty">${icon('chart', 40, 'empty-ic')}<p>No nights in this period yet.</p>
      ${all.length ? '' : '<button class="secondary" data-action="load-demo">Load sample data</button>'}</div>`;
  }
  const avg = (f) => nights.reduce((a, n) => a + f(n), 0) / nights.length;
  const bedMins = nights.map((n) => clockMin(n.start));
  const avgBed = bedMins.reduce((a, b) => a + b, 0) / bedMins.length;
  const sd = Math.sqrt(bedMins.reduce((a, b) => a + (b - avgBed) ** 2, 0) / bedMins.length);
  const avgWake = avg((n) => clockMin(n.end));
  const label = (n) => (nights.length <= 7 ? new Date(n.start).toLocaleDateString([], { weekday: 'short' }) : new Date(n.start).getDate());
  const stageAvg = {};
  STAGE_ORDER.forEach((c) => (stageAvg[c] = avg((n) => n.summary.minutes[c] || 0)));
  const asleepAvg = STAGE_ORDER.filter((c) => c !== 'A').reduce((a, c) => a + stageAvg[c], 0) || 1;

  // How each sleep note relates to sleep quality.
  const used = [...new Set(nights.flatMap((n) => n.notes || []))];
  const impact = used
    .map((id) => {
      const w = nights.filter((n) => (n.notes || []).includes(id));
      const wo = nights.filter((n) => !(n.notes || []).includes(id));
      if (!w.length || !wo.length) return null;
      const q = (arr) => arr.reduce((a, n) => a + n.summary.quality, 0) / arr.length;
      return { id, with: q(w), without: q(wo), n: w.length };
    })
    .filter(Boolean)
    .sort((a, b) => a.with - a.without - (b.with - b.without));

  const moodRows = MOODS.map((m) => {
    const arr = nights.filter((n) => n.mood === m.id);
    return arr.length ? `<div class="kv"><span class="with-ic"><span class="mood-ic ${m.id}">${icon(m.icon, 16)}</span>${m.label} <span class="muted small">(${arr.length})</span></span><b>${Math.round(arr.reduce((a, n) => a + n.summary.quality, 0) / arr.length)}% avg</b></div>` : '';
  }).join('');

  return `${head}
    <section class="tiles">
      <div class="tile"><span>Sleep quality</span><b>${Math.round(avg((n) => n.summary.quality))}%</b></div>
      <div class="tile"><span>Time asleep</span><b>${fmtDur(avg((n) => n.summary.asleepMs))}</b></div>
      <div class="tile"><span>Went to bed</span><b>${fmtTime(fromClockMin(avgBed))}</b></div>
      <div class="tile"><span>Woke up</span><b>${fmtTime(fromClockMin(avgWake))}</b></div>
      <div class="tile"><span>Regularity</span><b>±${Math.round(sd)} min</b></div>
      <div class="tile"><span>Nights</span><b>${nights.length}</b></div>
    </section>
    <section class="card"><div class="label">Sleep quality</div>
      ${barChart(nights.map((n) => ({ label: label(n), value: n.summary.quality, color: '#7b8cff' })), { max: 100, fmt: (v) => `${Math.round(v)}` })}</section>
    <section class="card"><div class="label">Time asleep (goal ${settings.goalHours}h)</div>
      ${barChart(nights.map((n) => ({ label: label(n), value: n.summary.asleepMs / 3600000, color: '#4fc3e8' })), { goal: settings.goalHours, fmt: (v) => v.toFixed(1) })}</section>
    <section class="card"><div class="label">Average night</div>
      ${stageBar(stageAvg)}
      <div class="legend">${STAGE_ORDER.map((c) => `<div class="kv"><span><i class="dot" style="background:${STAGE_INFO[c].color}"></i>${STAGE_INFO[c].label}</span><b>${fmtMin(stageAvg[c])}${c !== 'A' ? ` · ${Math.round((stageAvg[c] / asleepAvg) * 100)}%` : ''}</b></div>`).join('')}</div>
    </section>
    ${impact.length ? `<section class="card"><div class="label">Sleep notes vs quality</div>
      ${impact.map((r) => {
        const diff = Math.round(r.with - r.without);
        return `<div class="kv"><span>${noteInfo(r.id).label} <span class="muted small">(${r.n})</span></span><b class="${diff < 0 ? 'neg' : 'pos'}">${diff > 0 ? '+' : ''}${diff}%</b></div>`;
      }).join('')}
      <p class="muted small">Average quality on nights with the note, compared with nights without it.</p></section>` : ''}
    ${moodRows ? `<section class="card"><div class="label">Wake-up mood</div>${moodRows}</section>` : ''}`;
}

function viewSounds() {
  const playing = currentAid();
  const s = settings;
  return `<header class="top"><h1>Sleep sounds</h1></header>
    <p class="muted">Calming sounds generated on the phone (they work offline). Tap to play or stop.</p>
    <div class="sound-grid">${AID_SOUNDS.map(
      (a) => `<button class="sound ${s.aidSound === a.id ? 'sel' : ''} ${playing === a.id ? 'playing' : ''}" data-action="aid" data-id="${a.id}">
        <span class="sound-ic">${icon(SOUND_ICON[a.id] || 'sound', 24)}</span><span>${a.name}</span>${playing === a.id ? '<span class="eq"><i></i><i></i><i></i></span>' : ''}</button>`,
    ).join('')}</div>
    <section class="card">
      <div class="label">Sleep timer</div>
      <div class="chips">${[15, 30, 45, 60, 90, 0].map((m) => `<button class="chip ${s.aidTimerMin === m ? 'on' : ''}" data-action="aid-timer" data-min="${m}">${m ? `${m} min` : 'All night'}</button>`).join('')}</div>
      <div class="label">Volume</div>
      <input type="range" min="0.05" max="1" step="0.05" value="${s.aidVolume}" data-setting="aidVolume" class="range">
      <div class="row"><span class="grow">Play when I start sleep tracking</span>
        <label class="switch"><input type="checkbox" data-setting="aidOnStart" ${s.aidOnStart ? 'checked' : ''}><span></span></label></div>
      ${playing ? '<button class="secondary wide" data-action="aid-stop">Stop sound</button>' : ''}
    </section>
    <p class="muted small">While a sleep sound plays during tracking, the app ignores the microphone and uses motion only, so the sound isn't mistaken for you moving. Theta waves is a binaural beat and works best with headphones.</p>`;
}

const opt = (val, cur, label) => `<option value="${val}" ${String(val) === String(cur) ? 'selected' : ''}>${label}</option>`;

function viewSettings() {
  const s = settings;
  const demoCount = listNights().filter((n) => n.demo).length;
  return `<header class="top"><h1>Settings</h1></header>
    <section class="card form">
      <div class="label">Alarm</div>
      <label class="field"><span>Alarm sound</span><select data-setting="alarmSound">${ALARM_SOUNDS.map((a) => opt(a.id, s.alarmSound, a.name)).join('')}</select></label>
      <button class="secondary wide" data-action="test-alarm">▶ Test alarm sound (6 s)</button>
      <label class="field"><span>Gradually increase volume</span><select data-setting="rampSec" data-type="number">
        ${[[1, 'Off'], [30, 'Over 30 s'], [60, 'Over 1 min'], [120, 'Over 2 min'], [180, 'Over 3 min']].map(([v, l]) => opt(v, s.rampSec, l)).join('')}</select></label>
      <label class="field"><span>Alarm volume</span><input type="range" min="0.2" max="1" step="0.05" value="${s.alarmVolume}" data-setting="alarmVolume" class="range"></label>
      <label class="field"><span>Snooze length</span><select data-setting="snoozeMin" data-type="number">${[5, 9, 10, 15, 20].map((v) => opt(v, s.snoozeMin, `${v} min`)).join('')}</select></label>
      <label class="field row"><span class="grow">Shake phone to snooze</span><span class="switch"><input type="checkbox" data-setting="shakeToSnooze" ${s.shakeToSnooze ? 'checked' : ''}><span></span></span></label>
    </section>
    <section class="card form">
      <div class="label">Sleep tracking</div>
      <label class="field"><span>Sensors</span><select data-setting="sensorMode">
        ${opt('both', s.sensorMode, 'Microphone + motion (recommended)')}${opt('mic', s.sensorMode, 'Microphone only')}${opt('motion', s.sensorMode, 'Motion only (phone on mattress)')}</select></label>
      <label class="field"><span>Sleep goal</span><select data-setting="goalHours" data-type="number">${[6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5].map((v) => opt(v, s.goalHours, `${v} h`)).join('')}</select></label>
      <p class="muted small">Sound is only analysed on the phone to measure how much you move. Nothing is recorded or uploaded.</p>
    </section>
    <section class="card form">
      <div class="label">Your data</div>
      <p class="muted small" id="storageInfo">&nbsp;</p>
      <button class="secondary wide" data-action="export">Back up / export data</button>
      <label class="secondary wide filebtn">Import data<input type="file" accept="application/json,.json" data-action-change="import" hidden></label>
      ${demoCount ? `<button class="secondary wide" data-action="remove-demo">Remove sample data (${demoCount} nights)</button>` : '<button class="secondary wide" data-action="load-demo">Load sample data</button>'}
      <button class="danger wide" data-action="clear-all">Delete all data</button>
    </section>
    <section class="card about">
      <div class="label">How it works</div>
      <p>During the night the app measures movement through the microphone (rustling sounds) and the motion sensor. Long still periods are deep sleep, frequent small movements are light sleep, and still periods with small twitches later in a sleep cycle are counted as dreaming (REM). The smart alarm rings at the first sign of light sleep inside your wake-up window, and always by the end of it.</p>
      <p>For the alarm to ring, the app must stay open with the screen on. Keep the phone plugged in, ringer volume up, and don't lock it.</p>
      <p class="muted small">DreamCycle is a wellness tool, not a medical device. Sleep stages are estimates.</p>
    </section>`;
}

// ---------------------------------------------------------------------------
// Night session

function onStart(resumeNight = null) {
  // Everything that needs a user tap happens synchronously here, first.
  unlockAudio();
  requestWakeLock();
  const wantMotion = settings.sensorMode !== 'mic';
  const wantMic = settings.sensorMode !== 'motion';
  const motionP = wantMotion ? requestMotionPermission() : Promise.resolve(false);
  motionP.then(async (motion) => {
    const stream = wantMic ? await requestMic() : null;
    if (!motion && !stream) {
      const ok = confirm('Microphone and motion access are both unavailable, so sleep can\'t be tracked tonight. The alarm will still ring. Continue?');
      if (!ok) {
        releaseWakeLock();
        return;
      }
    }
    beginSession(resumeNight, motion, stream);
  });
}

function beginSession(resumeNight, motion, stream) {
  const now = Date.now();
  let night = resumeNight;
  if (!night) {
    const mode = settings.alarmMode;
    night = {
      id: `n${now}`,
      start: now,
      end: null,
      m: [],
      s: [],
      sensors: { motion, mic: !!stream },
      alarm: { mode, targetMs: mode === 'none' ? null : nextAlarmTime(settings.alarmTime, now), windowMin: settings.windowMin, firedAt: null, reason: null, snoozes: 0 },
      notes: [],
      mood: null,
      aid: settings.aidOnStart ? settings.aidSound : null,
    };
  } else {
    night.sensors.motion = night.sensors.motion || motion;
    night.sensors.mic = night.sensors.mic || !!stream;
  }
  session = { night, phase: 'tracking', snoozeUntil: null, gaps: 0 };
  setSessionType(stream ? 'play-and-record' : 'playback');
  startKeepAlive();
  session.tracker = new Tracker(night, {
    onEpoch,
    isAidActive: () => !!currentAid(),
    onShake: () => session && session.phase === 'ringing' && snooze(),
  });
  session.tracker.start({ motion, stream });
  if (!resumeNight && night.aid) playAid(night.aid, { volume: settings.aidVolume, timerMin: settings.aidTimerMin });
  saveActive(night);
  session.clock = setInterval(clockTick, 1000);
  showNight();
}

function onEpoch(night) {
  saveActive(night);
  const a = night.alarm;
  if (session.phase === 'tracking' && !a.firedAt) {
    const r = shouldWake({ m: night.m, s: night.s, nowMs: Date.now(), targetMs: a.targetMs, windowMin: a.windowMin, mode: a.mode });
    if (r.wake) fireAlarm(r.reason);
  }
  updateNight();
}

function clockTick() {
  if (!session) return;
  const now = Date.now();
  const a = session.night.alarm;
  if (session.phase === 'tracking' && !a.firedAt && a.mode !== 'none' && now >= a.targetMs) {
    fireAlarm(a.mode === 'smart' ? 'end-of-window' : 'time');
  } else if (session.phase === 'snoozing' && now >= session.snoozeUntil) {
    fireAlarm('snooze');
  }
  const clock = $('#nightClock');
  if (clock) clock.textContent = fmtTime(now);
  // Nudge the clock around a little each minute to avoid screen burn-in.
  if (clock && new Date(now).getSeconds() === 0) {
    clock.style.transform = `translate(${Math.round(Math.random() * 30 - 15)}px, ${Math.round(Math.random() * 40 - 20)}px)`;
  }
}

function fireAlarm(reason) {
  const a = session.night.alarm;
  if (!a.firedAt) {
    a.firedAt = Date.now();
    a.reason = reason;
  }
  session.phase = 'ringing';
  // iOS plays audio quietly through the earpiece while the mic is open, so
  // close it before ringing. Motion keeps tracking until you get up.
  session.tracker.stopMic();
  stopAid(2);
  startAlarm(settings.alarmSound, { rampSec: settings.rampSec, volume: settings.alarmVolume });
  session.tracker.shakeEnabled = settings.shakeToSnooze;
  saveActive(session.night);
  showRinging();
}

function snooze() {
  stopAlarm();
  session.night.alarm.snoozes = (session.night.alarm.snoozes || 0) + 1;
  session.phase = 'snoozing';
  session.snoozeUntil = Date.now() + settings.snoozeMin * 60000;
  session.tracker.shakeEnabled = false;
  saveActive(session.night);
  showNight();
}

function finishSession() {
  const { night, tracker, clock } = session;
  tracker.flush();
  tracker.stop();
  clearInterval(clock);
  stopAid(1);
  stopAlarm();
  stopKeepAlive();
  releaseWakeLock();
  setSessionType('auto');
  session = null;
  night.end = Date.now();
  finalizeNight(night);
}

function finalizeNight(night) {
  clearActive();
  const minutes = (night.end - night.start) / 60000;
  if (minutes < 10 && !confirm(`You only tracked ${Math.max(0, Math.round(minutes))} minutes. Save this session anyway?`)) {
    closeOverlay();
    render();
    return;
  }
  Object.assign(night, analyzeNight(night, { goalHours: settings.goalHours }));
  saveNight(night);
  tab = 'journal';
  render();
  showWakeUp(night);
}

// ---------------------------------------------------------------------------
// Overlays

function closeOverlay() {
  overlay.className = 'overlay hidden';
  overlay.innerHTML = '';
}

function showNight() {
  overlay.className = 'overlay night';
  overlay.innerHTML = `<div class="night-wrap">
      <div class="night-clock" id="nightClock">${fmtTime(Date.now())}</div>
      <div class="night-sub" id="nightSub"></div>
      <div class="night-status" id="nightStatus"></div>
      <div id="nightAid" class="night-aid"></div>
      ${wakeLockSupported ? '' : '<div class="warn">This iOS version can\'t keep the screen on by itself. Go to Settings › Display &amp; Brightness › Auto-Lock › Never before you sleep, and turn it back on in the morning.</div>'}
      <div id="nightWarn"></div>
      <button class="hold" data-hold="wake"><span class="fill"></span><span class="txt">Hold to wake up</span></button>
    </div>`;
  updateNight();
}

function updateNight() {
  if (!session || !overlay.classList.contains('night')) return;
  const { night, phase, tracker } = session;
  const a = night.alarm;
  let sub;
  if (phase === 'snoozing') sub = `Snoozing until ${fmtTime(session.snoozeUntil)}`;
  else if (a.mode === 'smart') sub = `Smart alarm ${fmtTime(a.targetMs - a.windowMin * 60000)} – ${fmtTime(a.targetMs)}`;
  else if (a.mode === 'regular') sub = `Alarm ${fmtTime(a.targetMs)}`;
  else sub = 'No alarm set';
  $('#nightSub').textContent = sub;
  const motionOk = tracker.motionSeen;
  const tracked = night.m.length * EPOCH_MS;
  $('#nightStatus').innerHTML = `
    <span class="pill ${tracker.micOn ? 'ok' : ''}">${icon('mic', 14)}Mic ${tracker.micOn ? (currentAid() ? 'paused' : 'on') : 'off'}</span>
    <span class="pill ${motionOk ? 'ok' : ''}">${icon('motion', 14)}Motion ${motionOk ? 'on' : 'off'}</span>
    <span class="pill">${icon('clock', 14)}${fmtDur(tracked)}</span>`;
  const aid = currentAid();
  const info = AID_SOUNDS.find((x) => x.id === (aid || settings.aidSound));
  $('#nightAid').innerHTML = aid
    ? `${info.name} playing <button class="link" data-action="aid-stop">Stop</button>`
    : `<button class="link" data-action="aid-night">${info ? `Play ${info.name}` : ''}</button>`;
  const gaps = night.m.filter((v) => v == null).length;
  $('#nightWarn').innerHTML =
    night.sensors.motion || night.sensors.mic
      ? gaps > 6 && night.m.length > 20 && night.s.filter((v) => v == null).length > 6 && !aid
        ? '<div class="warn small">Tracking paused for a while (was the app closed or the phone locked?). Keep the app open on screen.</div>'
        : ''
      : '<div class="warn small">No sensors: sleep isn\'t being tracked, but the alarm will ring.</div>';
}

function showRinging() {
  overlay.className = 'overlay ringing';
  overlay.innerHTML = `<div class="ring-wrap">
      <div class="ring-time">${fmtTime(Date.now())}</div>
      <div class="ring-msg">Good morning</div>
      <div class="muted">${session.night.alarm.reason === 'light-sleep' ? 'Woken up during light sleep' : ''}</div>
      <button class="primary big" data-action="snooze">Snooze ${settings.snoozeMin} min</button>
      ${settings.shakeToSnooze ? '<p class="muted small center">or shake the phone</p>' : ''}
      <button class="hold light" data-hold="stop"><span class="fill"></span><span class="txt">Hold to stop alarm</span></button>
    </div>`;
}

function moodButtons(n) {
  return `<div class="moods">${MOODS.map((m) => `<button class="mood ${n.mood === m.id ? 'on' : ''}" data-action="mood" data-id="${n.id}" data-mood="${m.id}">${icon(m.icon, 28)}<span>${m.label}</span></button>`).join('')}</div>`;
}
function noteChips(n) {
  return `<div class="chips">${NOTES.map((t) => `<button class="chip ${(n.notes || []).includes(t.id) ? 'on' : ''}" data-action="note" data-id="${n.id}" data-note="${t.id}">${t.label}</button>`).join('')}</div>`;
}

function showWakeUp(night) {
  overlay.className = 'overlay sheet';
  overlay.innerHTML = `<div class="sheet-body wake">
      <div class="wake-sun">${icon('sun', 36)}</div>
      <h2>Good morning</h2>
      ${qualityRing(night.summary.quality, 130)}
      <p class="center">${fmtDur(night.summary.asleepMs)} asleep · ${fmtDur(night.summary.inBedMs)} in bed</p>
      <div class="label">How do you feel?</div>
      ${moodButtons(night)}
      <div class="label">Anything special yesterday?</div>
      ${noteChips(night)}
      <button class="primary big" data-action="open" data-id="${night.id}">See my night</button>
    </div>`;
}

function alarmText(n) {
  const a = n.alarm || { mode: 'none' };
  if (a.mode === 'none') return 'No alarm';
  const snoozes = a.snoozes ? ` · snoozed ${a.snoozes}×` : '';
  if (!a.firedAt) return `Set for ${fmtTime(a.targetMs)} (stopped before it rang)`;
  if (a.mode === 'regular') return `Rang at ${fmtTime(a.firedAt)}${snoozes}`;
  const why = a.reason === 'light-sleep' ? 'light sleep detected' : 'end of window';
  return `Rang at ${fmtTime(a.firedAt)}, ${why} (window ${fmtTime(a.targetMs - a.windowMin * 60000)}–${fmtTime(a.targetMs)})${snoozes}`;
}

function showDetail(id) {
  const n = getNight(id);
  if (!n) return closeOverlay();
  const s = n.summary;
  const asleepMin = STAGE_ORDER.filter((c) => c !== 'A').reduce((a, c) => a + s.minutes[c], 0) || 1;
  const sensors = [n.sensors?.mic && 'microphone', n.sensors?.motion && 'motion'].filter(Boolean).join(' + ') || 'none';
  overlay.className = 'overlay sheet';
  overlay.innerHTML = `<div class="sheet-head">
      <button class="link with-ic" data-action="close">${icon('back', 18)}Back</button>
      <b>${fmtDate(n.start)}</b>
      <button class="link danger-text" data-action="delete" data-id="${n.id}">Delete</button>
    </div>
    <div class="sheet-body">
      <div class="detail-top">${qualityRing(s.quality)}
        <div class="detail-kv">
          <div><span>Time asleep</span><b>${fmtDur(s.asleepMs)}</b></div>
          <div><span>Time in bed</span><b>${fmtDur(s.inBedMs)}</b></div>
          <div><span>Went to bed</span><b>${fmtTime(n.start)}</b></div>
          <div><span>Woke up</span><b>${fmtTime(n.end)}</b></div>
        </div></div>
      <section class="card">${hypnogram(n.stages, n.start, n.end)}</section>
      <section class="card">
        ${stageBar(s.minutes)}
        <div class="legend">${STAGE_ORDER.map((c) => `<div class="kv"><span><i class="dot" style="background:${STAGE_INFO[c].color}"></i>${STAGE_INFO[c].label}</span><b>${fmtMin(s.minutes[c])}${c !== 'A' ? ` · ${Math.round((s.minutes[c] / asleepMin) * 100)}%` : ''}</b></div>`).join('')}</div>
      </section>
      <section class="card">
        <div class="kv"><span>Fell asleep after</span><b>${fmtDur(s.latencyMs)}</b></div>
        <div class="kv"><span>Times awake</span><b>${s.awakenings}</b></div>
        <div class="kv"><span>Sleep efficiency</span><b>${Math.round(s.efficiency * 100)}%</b></div>
        <div class="kv"><span>Alarm</span><b class="right">${alarmText(n)}</b></div>
        <div class="kv"><span>Sensors</span><b>${sensors}</b></div>
      </section>
      <section class="card"><div class="label">Wake-up mood</div>${moodButtons(n)}</section>
      <section class="card"><div class="label">Sleep notes</div>${noteChips(n)}</section>
      ${n.demo ? '<p class="muted small center">Sample data</p>' : ''}
    </div>`;
  overlay.scrollTop = 0;
}

function showRecover(night) {
  overlay.className = 'overlay sheet';
  overlay.innerHTML = `<div class="sheet-body wake">
      <h2>Unfinished night</h2>
      <p class="center">Tracking started at ${fmtTime(night.start)} on ${fmtDate(night.start)} was interrupted (the app was closed or reloaded).</p>
      <button class="primary big" data-action="recover-resume">Resume tracking</button>
      <button class="secondary wide" data-action="recover-finish">Finish and save</button>
      <button class="link danger-text" data-action="recover-discard">Discard</button>
    </div>`;
}

// ---------------------------------------------------------------------------
// Settings updates & actions

function setSetting(key, value) {
  settings = { ...settings, [key]: value };
  saveSettings(settings);
}

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.actionChange === 'import') return importFile(el);
  const key = el.dataset.setting;
  if (!key) return;
  let value = el.type === 'checkbox' ? el.checked : el.value;
  if (el.type === 'range' || el.dataset.type === 'number') value = Number(value);
  setSetting(key, value);
  if (el.type !== 'range') render();
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.type !== 'range' || !el.dataset.setting) return;
  setSetting(el.dataset.setting, Number(el.value));
  if (el.dataset.setting === 'aidVolume') setAidVolume(Number(el.value));
});

// Resolves true when the file was handed over (shared/saved or downloaded).
async function download(name, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false; // user cancelled
      // Sharing unavailable: fall back to a download below.
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return true;
}

async function backup() {
  const ok = await download(`dreamcycle-backup-${new Date().toISOString().slice(0, 10)}.json`, exportAll());
  if (ok) {
    markBackedUp();
    render();
  }
}

function importFile(input) {
  const f = input.files && input.files[0];
  if (!f) return;
  f.text()
    .then((t) => importAll(t))
    .then((count) => {
      alert(`Imported ${count} nights.`);
      render();
    })
    .catch((err) => alert(`Import failed: ${err.message}`));
}

function toggleOnNight(id, fn) {
  const n = getNight(id);
  if (!n) return;
  fn(n);
  saveNight(n);
}

const actions = {
  tab: (el) => {
    tab = el.dataset.tab;
    render();
    window.scrollTo(0, 0);
  },
  mode: (el) => {
    setSetting('alarmMode', el.dataset.mode);
    render();
  },
  window: (el) => {
    setSetting('windowMin', Number(el.dataset.min));
    render();
  },
  'hide-install': () => {
    localStorage.setItem('dc.hideInstall', '1');
    render();
  },
  start: () => onStart(),
  period: (el) => {
    statsPeriod = Number(el.dataset.p);
    render();
  },
  open: (el) => showDetail(el.dataset.id),
  close: () => {
    closeOverlay();
    render();
  },
  delete: (el) => {
    if (!confirm('Delete this night?')) return;
    deleteNight(el.dataset.id);
    closeOverlay();
    render();
  },
  mood: (el) => {
    toggleOnNight(el.dataset.id, (n) => {
      n.mood = n.mood === el.dataset.mood ? null : el.dataset.mood;
    });
    el.parentElement.querySelectorAll('.mood').forEach((b) => b.classList.toggle('on', b === el && !el.classList.contains('on')));
  },
  note: (el) => {
    toggleOnNight(el.dataset.id, (n) => {
      const set = new Set(n.notes || []);
      set.has(el.dataset.note) ? set.delete(el.dataset.note) : set.add(el.dataset.note);
      n.notes = [...set];
    });
    el.classList.toggle('on');
  },
  aid: (el) => {
    unlockAudio();
    const id = el.dataset.id;
    setSetting('aidSound', id);
    if (currentAid() === id) stopAid();
    else playAid(id, { volume: settings.aidVolume, timerMin: settings.aidTimerMin });
    render();
  },
  'aid-timer': (el) => {
    setSetting('aidTimerMin', Number(el.dataset.min));
    const playing = currentAid();
    if (playing) playAid(playing, { volume: settings.aidVolume, timerMin: settings.aidTimerMin });
    render();
  },
  'aid-stop': () => stopAid(),
  'aid-night': () => {
    if (settings.aidSound) playAid(settings.aidSound, { volume: settings.aidVolume, timerMin: settings.aidTimerMin });
  },
  snooze: () => snooze(),
  'test-alarm': () => {
    unlockAudio();
    setSessionType('playback');
    previewAlarm(settings.alarmSound, settings.alarmVolume);
  },
  export: () => backup(),
  'backup-later': () => {
    snoozeBackupReminder(7);
    render();
  },
  'load-demo': () => {
    const demo = generateDemoNights(14, settings.goalHours);
    saveNights([...listNights().filter((n) => !n.demo), ...demo]);
    render();
  },
  'remove-demo': () => {
    saveNights(listNights().filter((n) => !n.demo));
    render();
  },
  'clear-all': () => {
    if (!confirm('Delete ALL nights and settings? This cannot be undone. Export first if you want a backup.')) return;
    clearAll().then(() => {
      settings = loadSettings();
      render();
    });
  },
  'recover-resume': () => onStart(loadActive()),
  'recover-finish': () => {
    const night = loadActive();
    night.end = Math.max(night.start + night.m.length * EPOCH_MS, night.start);
    finalizeNight(night);
  },
  'recover-discard': () => {
    if (!confirm('Discard this night?')) return;
    clearActive();
    closeOverlay();
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) fn(el, e);
});

// Press-and-hold buttons (wake up / stop alarm) so they can't be hit by accident.
const holdActions = {
  wake: () => finishSession(),
  stop: () => finishSession(),
};
let holdTimer = null;
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('[data-hold]');
  if (!el) return;
  el.classList.add('holding');
  holdTimer = setTimeout(() => {
    el.classList.remove('holding');
    holdTimer = null;
    if (session) holdActions[el.dataset.hold]();
  }, 1000);
});
const cancelHold = () => {
  clearTimeout(holdTimer);
  holdTimer = null;
  document.querySelectorAll('.holding').forEach((b) => b.classList.remove('holding'));
};
['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => document.addEventListener(t, cancelHold, true));
document.addEventListener('contextmenu', (e) => {
  if (e.target.closest('[data-hold]')) e.preventDefault();
});

onAidChange(() => {
  if (session) updateNight();
  else if (tab === 'sounds' || tab === 'sleep') render();
});

// Refresh the "time in bed" estimate on the Sleep tab every minute.
setInterval(() => {
  if (!session && tab === 'sleep' && overlay.classList.contains('hidden') && !document.activeElement?.matches('input')) render();
}, 60000);

// ---------------------------------------------------------------------------
// Boot

await initStorage();
render();
const pending = loadActive();
if (pending) showRecover(pending);

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW registration failed', e));
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
