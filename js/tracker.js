// Reads the microphone and motion sensors and condenses them into one
// reading per 30-second epoch (see analysis.js for the format).
import { getCtx } from './audio.js';
import { EPOCH_MS } from './analysis.js';

// Must be called from a tap (iOS asks for permission).
export async function requestMotionPermission() {
  if (typeof DeviceMotionEvent === 'undefined') return false;
  if (typeof DeviceMotionEvent.requestPermission === 'function') {
    try {
      return (await DeviceMotionEvent.requestPermission()) === 'granted';
    } catch {
      return false;
    }
  }
  return true;
}

export async function requestMic() {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch {
    return null;
  }
}

export class Tracker {
  constructor(night, { onEpoch, isAidActive, onShake }) {
    this.night = night;
    this.onEpoch = onEpoch;
    this.isAidActive = isAidActive || (() => false);
    this.onShake = onShake || (() => {});
    this.shakeEnabled = false;
    this.motionSeen = false;
    this.micOn = false;
    this.resetAcc();
    this.onMotion = this.onMotion.bind(this);
  }

  resetAcc() {
    this.acc = { mSum: 0, mCount: 0, sEx: 0, sFrames: 0 };
  }

  start({ motion, stream }) {
    const n = this.night;
    if (motion) window.addEventListener('devicemotion', this.onMotion);
    if (stream) this.attachMic(stream);
    // Resume support: fill any gap since the last stored epoch with nulls.
    this.epochStart = n.start + n.m.length * EPOCH_MS;
    while (Date.now() >= this.epochStart + EPOCH_MS) {
      n.m.push(null);
      n.s.push(null);
      this.epochStart += EPOCH_MS;
    }
    this.tick = setInterval(() => this.checkEpoch(), 1000);
  }

  attachMic(stream) {
    const c = getCtx();
    this.stream = stream;
    this.source = c.createMediaStreamSource(stream);
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 2048;
    this.source.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
    this.floor = null;
    this.micTimer = setInterval(() => this.sampleMic(), 100);
    this.micOn = true;
  }

  stopMic() {
    clearInterval(this.micTimer);
    if (this.source) this.source.disconnect();
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = this.source = this.analyser = null;
    this.micOn = false;
  }

  sampleMic() {
    if (!this.analyser) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const db = 20 * Math.log10(Math.sqrt(sum / this.buf.length) + 1e-9);
    if (this.floor == null) this.floor = db;
    // Noise floor follows quiet levels quickly and loud levels slowly, so
    // steady noise (fan, rain sound) is ignored but short sounds stand out.
    this.floor += (db - this.floor) * (db < this.floor ? 0.05 : 0.0008);
    const ex = db - this.floor - 8;
    if (ex > 0) this.acc.sEx += ex;
    this.acc.sFrames++;
  }

  onMotion(e) {
    let x, y, z;
    const a = e.acceleration;
    if (a && a.x != null) {
      ({ x, y, z } = a);
    } else if (e.accelerationIncludingGravity && e.accelerationIncludingGravity.x != null) {
      const g = e.accelerationIncludingGravity;
      if (!this.grav) this.grav = { x: g.x, y: g.y, z: g.z };
      this.grav.x += (g.x - this.grav.x) * 0.05;
      this.grav.y += (g.y - this.grav.y) * 0.05;
      this.grav.z += (g.z - this.grav.z) * 0.05;
      x = g.x - this.grav.x;
      y = g.y - this.grav.y;
      z = g.z - this.grav.z;
    } else {
      return;
    }
    this.motionSeen = true;
    const mag = Math.sqrt(x * x + y * y + z * z);
    this.acc.mSum += mag;
    this.acc.mCount++;
    if (this.shakeEnabled) this.detectShake(mag);
  }

  detectShake(mag) {
    const now = Date.now();
    if (this.shakeCooldown && now < this.shakeCooldown) return;
    if (mag < 6) return;
    this.peaks = (this.peaks || []).filter((t) => now - t < 1500);
    if (this.peaks.length && now - this.peaks[this.peaks.length - 1] < 120) return;
    this.peaks.push(now);
    if (this.peaks.length >= 3) {
      this.peaks = [];
      this.shakeCooldown = now + 2500;
      this.onShake();
    }
  }

  closeEpoch() {
    const { mSum, mCount, sEx, sFrames } = this.acc;
    this.night.m.push(mCount ? Math.round((1000 * mSum) / mCount) : null);
    // Sound is ignored while the sleep aid plays (the mic would hear it).
    this.night.s.push(sFrames && !this.isAidActive() ? Math.round(sEx) : null);
    this.resetAcc();
  }

  checkEpoch() {
    let closed = false;
    while (Date.now() >= this.epochStart + EPOCH_MS) {
      this.closeEpoch();
      this.epochStart += EPOCH_MS;
      closed = true;
    }
    if (closed) this.onEpoch(this.night);
  }

  // Close the partial epoch at the end of the night.
  flush() {
    if (this.acc.mCount || this.acc.sFrames) this.closeEpoch();
  }

  stop() {
    clearInterval(this.tick);
    window.removeEventListener('devicemotion', this.onMotion);
    this.stopMic();
  }
}
