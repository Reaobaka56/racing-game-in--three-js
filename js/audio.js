/** Fully synthesised audio: engine, turbo, tyre squeal, wind, impacts, UI beeps. No assets. */
export class GameAudio {
  constructor() { this.ctx = null; this.muted = false; this.ready = false; }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
    this.master.connect(comp); comp.connect(ctx.destination);

    // --- engine: two saws + square through a lowpass, plus a sub
    this.eng = {
      o1: ctx.createOscillator(), o2: ctx.createOscillator(), o3: ctx.createOscillator(),
      lp: ctx.createBiquadFilter(), gain: ctx.createGain(), shaper: ctx.createWaveShaper(),
    };
    this.eng.o1.type = 'sawtooth'; this.eng.o2.type = 'sawtooth'; this.eng.o3.type = 'square';
    const curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.2); }
    this.eng.shaper.curve = curve;
    this.eng.lp.type = 'lowpass'; this.eng.lp.Q.value = 2.5;
    const og = [ctx.createGain(), ctx.createGain(), ctx.createGain()];
    og[0].gain.value = 0.5; og[1].gain.value = 0.32; og[2].gain.value = 0.22;
    this.eng.o1.connect(og[0]); this.eng.o2.connect(og[1]); this.eng.o3.connect(og[2]);
    og.forEach(g => g.connect(this.eng.shaper));
    this.eng.shaper.connect(this.eng.lp); this.eng.lp.connect(this.eng.gain); this.eng.gain.connect(this.master);
    this.eng.gain.gain.value = 0;
    this.eng.o1.start(); this.eng.o2.start(); this.eng.o3.start();

    // --- turbo whistle
    this.turbo = { o: ctx.createOscillator(), g: ctx.createGain() };
    this.turbo.o.type = 'sine'; this.turbo.g.gain.value = 0;
    this.turbo.o.connect(this.turbo.g); this.turbo.g.connect(this.master); this.turbo.o.start();

    // --- noise source
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const mkNoise = () => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };

    // wind
    this.wind = { s: mkNoise(), f: ctx.createBiquadFilter(), g: ctx.createGain() };
    this.wind.f.type = 'bandpass'; this.wind.f.frequency.value = 700; this.wind.f.Q.value = 0.5; this.wind.g.gain.value = 0;
    this.wind.s.connect(this.wind.f); this.wind.f.connect(this.wind.g); this.wind.g.connect(this.master);

    // tyre squeal
    this.squeal = { s: mkNoise(), f: ctx.createBiquadFilter(), g: ctx.createGain(), o: ctx.createOscillator(), og: ctx.createGain() };
    this.squeal.f.type = 'bandpass'; this.squeal.f.frequency.value = 1500; this.squeal.f.Q.value = 6; this.squeal.g.gain.value = 0;
    this.squeal.s.connect(this.squeal.f); this.squeal.f.connect(this.squeal.g); this.squeal.g.connect(this.master);
    this.squeal.o.type = 'triangle'; this.squeal.o.frequency.value = 900; this.squeal.og.gain.value = 0;
    this.squeal.o.connect(this.squeal.og); this.squeal.og.connect(this.master); this.squeal.o.start();

    // gravel / off-road rumble
    this.rumble = { s: mkNoise(), f: ctx.createBiquadFilter(), g: ctx.createGain() };
    this.rumble.f.type = 'lowpass'; this.rumble.f.frequency.value = 380; this.rumble.g.gain.value = 0;
    this.rumble.s.connect(this.rumble.f); this.rumble.f.connect(this.rumble.g); this.rumble.g.connect(this.master);

    // nitro roar
    this.nitroN = { s: mkNoise(), f: ctx.createBiquadFilter(), g: ctx.createGain() };
    this.nitroN.f.type = 'bandpass'; this.nitroN.f.frequency.value = 1100; this.nitroN.f.Q.value = 0.8; this.nitroN.g.gain.value = 0;
    this.nitroN.s.connect(this.nitroN.f); this.nitroN.f.connect(this.nitroN.g); this.nitroN.g.connect(this.master);
    this.ready = true;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  /** s: physics state, active: whether the car is being driven */
  update(s, active = true) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, set = (p, v, tc = 0.05) => p.setTargetAtTime(v, t, tc);
    const rpm = s.rpm; // 0..1
    const hz = 26 + rpm * 190;        // firing freq
    const thr = s.throttle || 0;
    set(this.eng.o1.frequency, hz); set(this.eng.o2.frequency, hz * 1.005 * 2.0, 0.03); set(this.eng.o3.frequency, hz * 0.5);
    set(this.eng.lp.frequency, 260 + rpm * 1500 + thr * 900 + (s.nitroOn ? 500 : 0), 0.06);
    set(this.eng.gain.gain, active ? 0.14 + thr * 0.2 + rpm * 0.08 : 0.0, 0.08);
    // turbo
    set(this.turbo.o.frequency, 2400 + rpm * 4200);
    set(this.turbo.g.gain, active ? thr * rpm * 0.012 : 0, 0.1);
    const sp = Math.min(1, s.speed / 70);
    set(this.wind.g.gain, 0.02 + sp * sp * 0.16, 0.1); set(this.wind.f.frequency, 400 + sp * 1400);
    const sq = s.drifting && s.onRoad ? Math.min(1, Math.abs(s.vL) / 7) : (s.slip > 0.35 && s.onRoad ? s.slip * 0.4 : 0);
    set(this.squeal.g.gain, sq * 0.2, 0.04); set(this.squeal.og.gain, sq * 0.018, 0.04);
    set(this.squeal.f.frequency, 1300 + sq * 900); set(this.squeal.o.frequency, 780 + sq * 260 + Math.random() * 20);
    set(this.rumble.g.gain, !s.onRoad ? Math.min(0.28, s.speed / 120) : 0, 0.06);
    set(this.nitroN.g.gain, s.nitroOn ? 0.17 : 0, 0.07); set(this.nitroN.f.frequency, 900 + sp * 1600);
  }

  silence() { if (this.ready) { const t = this.ctx.currentTime; this.eng.gain.gain.setTargetAtTime(0, t, 0.1); this.squeal.g.gain.setTargetAtTime(0, t, 0.05); this.squeal.og.gain.setTargetAtTime(0, t, 0.05); this.turbo.g.gain.setTargetAtTime(0, t, 0.1); this.nitroN.g.gain.setTargetAtTime(0, t, 0.05); this.rumble.g.gain.setTargetAtTime(0, t, 0.05); } }

  thud(strength = 1) {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500 + strength * 400;
    const g = ctx.createGain(); g.gain.setValueAtTime(Math.min(0.9, 0.2 + strength * 0.5), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + 0.4);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    const og = ctx.createGain(); og.gain.setValueAtTime(Math.min(0.8, 0.3 + strength * 0.4), t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(og); og.connect(this.master); o.start(t); o.stop(t + 0.35);
  }

  beep(freq = 660, dur = 0.18, vol = 0.25, type = 'square') {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  chime(notes = [660, 880, 1320], gap = 0.09) { notes.forEach((n, i) => setTimeout(() => this.beep(n, 0.22, 0.2, 'triangle'), i * gap * 1000)); }
  whoosh() {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2; f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(3200, t + 0.5);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0, t); g.gain.linearRampToValueAtTime(0.35, t + 0.12); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + 0.8);
  }
}
