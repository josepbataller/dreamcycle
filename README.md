# DreamCycle: sleep tracker with smart alarm

DreamCycle is a personal Sleep Cycle–style app, built as an installable web app (PWA). It runs on iPhone and Android with no app store, and all data stays on your phone.

## Features

- **Sleep tracking:** uses the microphone (rustling sounds) and the motion sensor, sampled into 30-second readings. Each night is classified into **Awake / Dreaming (REM) / Light / Deep**.
- **Smart alarm:** choose a wake-up window (10–90 min). It rings at the first sign of light sleep inside the window, and always by the end of it. The volume rises gradually, there's snooze (tap or shake the phone), and a press-and-hold stop button.
- **Regular alarm** and **track-only (no alarm)** modes.
- **Journal:** every night with a sleep graph, quality score (1–100%), time asleep and time in bed, when you fell asleep, times awake, a stage breakdown, and how the alarm woke you.
- **Statistics:** 7 / 30 / 90 days / all. Shows quality and time-asleep trends against your sleep goal, average bedtime and wake time, regularity, average stages, how each sleep note relates to quality, and mood vs quality.
- **Sleep notes and wake-up mood:** tag nights (coffee, workout, stress, alcohol and more) and rate how you feel each morning.
- **Sleep sounds:** rain, ocean, stream, wind, campfire, fan, white/pink/brown noise and theta binaural beats. All are generated on the device, with a sleep timer and fade-out. They can start automatically when you begin tracking.
- **Offline support**, plus data export/import (JSON) and sample data for previewing.

## Where your data lives

Your sleep history is stored **only on your phone**, in the browser's IndexedDB database for this app. GitHub hosts only the app's code; nobody who opens the link can see your nights.

Each night takes about 2 KB, so 5 years is under 4 MB, well within what Safari allows. If you delete the app from the home screen or change phones, the data goes with it. So once a month the app reminds you to make a backup: tap **Back up now** and choose **Save to Files** (iCloud Drive). To restore, use **Settings › Import data**.

## Install on your iPhone

The app has to be served over **HTTPS** (iOS only allows the microphone and motion sensor on secure pages). The easiest free option is GitHub Pages:

1. Create a GitHub repository (it can be private if your plan includes Pages for private repos, otherwise public) and push this folder:
   ```bash
   git remote add origin https://github.com/<you>/dreamcycle.git
   git push -u origin main
   ```
2. On GitHub: **Settings › Pages › Build and deployment › Deploy from a branch › `main` / root**. After a minute the app is live at `https://<you>.github.io/dreamcycle/`.
3. On the iPhone, open that URL in **Safari**, tap **Share** › **Add to Home Screen**, then open DreamCycle from the home screen icon.

An alternative is [Netlify Drop](https://app.netlify.com/drop): drag this folder onto the page (you need a free account to keep the site). Any static HTTPS host works; there's no build step.

## Using it at night

1. Set the alarm on the **Sleep** tab and tap **Start**. Allow microphone and motion access the first time.
2. **Keep the app open with the screen on.** The app keeps the screen awake on its own on iOS 16.4+. If you see a warning, set *Settings › Display & Brightness › Auto-Lock › Never* for the night. Don't lock the phone or switch apps: iOS pauses web apps in the background, which stops tracking **and the alarm**.
3. Keep the phone **plugged in**, with the media volume up. Place it on the mattress near your pillow (motion + sound) or on the nightstand (sound).
4. In the morning, snooze (tap or shake) or **hold** the stop button. Then rate your mood and add notes.

Test it once during the day: use **Settings › Test alarm sound**, or set a regular alarm 2 minutes ahead and tap Start.

## Development

```bash
npm test            # unit tests for the sleep analysis / smart alarm logic
npm start           # serve locally at http://localhost:8080 (desktop browser; mic works on localhost)
npm run icons       # regenerate the PNG icons
node scripts/smoke.mjs   # end-to-end test in headless Chrome (needs `npm install` first)
```

When you change any file, bump `CACHE` in `sw.js` (e.g. `dreamcycle-v2`) so installed copies pick up the update.

### Project layout

| File | Purpose |
|------|---------|
| `js/analysis.js` | Sleep stage classification, quality score, smart alarm decision (pure, tested) |
| `js/tracker.js` | Microphone and motion sensors → per-30-second readings, shake detection |
| `js/audio.js` | Generated sleep sounds and alarm tones (Web Audio) |
| `js/app.js` | UI, night session, alarm flow |
| `js/charts.js` | SVG sleep graph and charts |
| `js/storage.js` | IndexedDB storage, migration from v1, backups (export/import) |
| `js/codec.js` | Compact night format (pure, tested) |
| `js/demo.js` | Synthetic nights for tests and sample data |

## Limitations

- Sleep stages are estimated from movement and sound, the same idea Sleep Cycle uses without a wearable. They aren't medical measurements, and "dreaming" in particular is inferred from the timing of sleep cycles.
- Because this is a web app, iOS won't let it run or ring while the phone is locked or the app is in the background. As a safety net, set a backup iPhone alarm a few minutes after the end of your window until you trust it.
