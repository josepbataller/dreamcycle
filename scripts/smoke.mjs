// End-to-end smoke test in headless Chrome with fake microphone input.
// Usage: node scripts/smoke.mjs   (set CHROME_PATH if Chrome isn't in the default location)
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';
import { generateDemoNights } from '../js/demo.js';

const ROOT = process.cwd();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
page.on('dialog', (d) => d.accept());
// Controllable clock so we can jump to the alarm time.
await page.evaluateOnNewDocument(() => {
  const real = Date.now.bind(Date);
  window.__offset = 0;
  Date.now = () => real() + window.__offset;
});

await mkdir('screenshots', { recursive: true });
const shot = (name) => page.screenshot({ path: `screenshots/${name}.png` });
const click = async (sel) => {
  await page.waitForSelector(sel, { visible: true });
  await page.click(sel);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (msg) => console.log(`- ${msg}`);

await page.goto(url, { waitUntil: 'networkidle0' });
await shot('01-sleep');
step('sleep tab rendered');

await click('[data-action="tab"][data-tab="journal"]');
await click('[data-action="load-demo"]');
await shot('02-journal');
const cards = await page.$$eval('.night-card', (els) => els.length);
if (cards !== 14) throw new Error(`expected 14 demo nights, got ${cards}`);
step(`journal shows ${cards} sample nights`);

await click('.night-card');
await sleep(200);
await shot('03-detail');
await click('[data-action="note"][data-note="coffee"]');
await click('[data-action="mood"][data-mood="good"]');
await click('[data-action="close"]');
step('night detail opened, note + mood toggled');

await click('[data-action="tab"][data-tab="stats"]');
await shot('04-stats');
await click('[data-action="period"][data-p="30"]');
step('statistics rendered');

await click('[data-action="tab"][data-tab="sounds"]');
await click('[data-action="aid"][data-id="ocean"]');
await sleep(300);
if (!(await page.$('.sound.playing'))) throw new Error('sleep sound did not start');
await shot('05-sounds');
await click('[data-action="aid-stop"]');
await sleep(1500);
step('sleep sound played and stopped');

await click('[data-action="tab"][data-tab="settings"]');
await shot('06-settings');
await page.select('select[data-setting="snoozeMin"]', '5');
await click('[data-action="test-alarm"]');
step('settings rendered, test alarm played');

// Night session: regular alarm in ~3 minutes, then fast-forward.
await click('[data-action="tab"][data-tab="sleep"]');
await click('[data-action="mode"][data-mode="regular"]');
const t = new Date(Date.now() + 3 * 60000);
const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
await page.$eval('input[data-setting="alarmTime"]', (el, v) => {
  el.value = v;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, hhmm);
await click('[data-action="start"]');
await page.waitForSelector('.overlay.night #nightClock');
await sleep(2500);
await shot('07-night');
const status = await page.$eval('#nightStatus', (el) => el.textContent.replace(/\s+/g, ' ').trim());
step(`night screen: ${status}`);
if (!/Mic on/.test(status)) throw new Error('microphone not active');

await page.evaluate(() => (window.__offset = 4 * 60000));
await page.waitForSelector('.overlay.ringing', { timeout: 5000 });
await shot('08-ringing');
step('alarm rang at the set time');

await click('[data-action="snooze"]');
await page.waitForSelector('.overlay.night');
const sub = await page.$eval('#nightSub', (el) => el.textContent);
if (!/Snoozing/.test(sub)) throw new Error('snooze not shown');
step(`snoozed: ${sub}`);
await page.evaluate(() => (window.__offset += 6 * 60000));
await page.waitForSelector('.overlay.ringing', { timeout: 5000 });
step('alarm rang again after snooze');

// Hold to stop.
const btn = await page.$('[data-hold="stop"]');
const box = await btn.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await sleep(1300);
await page.mouse.up();
await page.waitForSelector('.sheet-body.wake');
await shot('09-wakeup');
step('hold-to-stop ended the night, wake-up screen shown');

await click('[data-action="mood"][data-mood="ok"]');
await click('.sheet-body.wake [data-action="open"]');
await page.waitForSelector('.detail-top');
await shot('10-new-night');
const alarmRow = await page.$$eval('.kv', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()).find((t) => t.startsWith('Alarm')));
step(`saved night: ${alarmRow}`);

const readDb = () =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open('dreamcycle');
        r.onsuccess = () => {
          const g = r.result.transaction('nights').objectStore('nights').getAll();
          g.onsuccess = () => {
            resolve(g.result.map((n) => ({ ...n, m: Array.from(n.m), s: Array.from(n.s) })));
            r.result.close();
          };
          g.onerror = () => reject(g.error);
        };
        r.onerror = () => reject(r.error);
      }),
  );
await sleep(300);
const saved = (await readDb()).filter((n) => !n.demo);
if (saved.length !== 1 || saved[0].mood !== 'ok' || saved[0].alarm.snoozes !== 1) throw new Error(`unexpected saved night ${JSON.stringify(saved[0]?.alarm)}`);
step(`stored night has ${saved[0].m.length} epochs, quality ${saved[0].summary.quality}`);

// Recovery after an interrupted night.
await page.evaluate(() => {
  localStorage.setItem('dc.active', JSON.stringify({ id: 'x1', start: Date.now() - 3600000, m: Array(100).fill(10), s: Array(100).fill(0), sensors: { motion: true, mic: true }, alarm: { mode: 'none' }, notes: [] }));
});
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForSelector('[data-action="recover-finish"]');
await click('[data-action="recover-finish"]');
await page.waitForSelector('.sheet-body.wake');
step('interrupted night recovered and saved');

// Migration from v1 storage (all nights as JSON in localStorage).
const before = (await readDb()).length;
const legacy = generateDemoNights(3).map((n, i) => ({ ...n, id: `legacy-${i}`, demo: false }));
await page.evaluate((list) => localStorage.setItem('dc.nights', JSON.stringify(list)), legacy);
await page.reload({ waitUntil: 'networkidle0' });
await sleep(300);
const afterDb = await readDb();
const legacyLeft = await page.evaluate(() => localStorage.getItem('dc.nights'));
if (afterDb.length !== before + 3 || legacyLeft !== null) throw new Error(`migration failed: ${before} -> ${afterDb.length}, legacy key ${legacyLeft ? 'still present' : 'removed'}`);
const mig = afterDb.find((n) => n.id === 'legacy-0');
if (!(mig.stages.length < 400 && /\d/.test(mig.stages))) throw new Error('migrated night not stored compactly');
step(`v1 localStorage nights migrated to IndexedDB (${before} -> ${afterDb.length}), legacy key removed`);
await page.evaluate(() => document.querySelector('#overlay [data-action="recover-discard"]')?.click());

// Backup reminder: shown once there are real nights and no backup.
await click('[data-action="tab"][data-tab="journal"]');
await page.waitForSelector('.banner [data-action="export"]', { timeout: 3000 });
await shot('11-backup-banner');
await click('.banner [data-action="export"]');
await sleep(500);
if (await page.$('.banner [data-action="export"]')) throw new Error('backup banner still shown after backing up');
step('backup reminder shown, disappears after backing up');

await click('[data-action="tab"][data-tab="settings"]');
await sleep(300);
step(`settings: ${await page.$eval('#storageInfo', (el) => el.textContent)}`);
await shot('12-settings-storage');

await browser.close();
server.close();
if (errors.length) {
  console.error('Errors:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('SMOKE TEST PASSED');
