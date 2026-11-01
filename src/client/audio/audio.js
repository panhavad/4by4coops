// All sound is synthesized with WebAudio at runtime - zero audio downloads.

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = localStorage.getItem('ridgeline:sound') !== 'off';
  }

  /** Must be called from a user gesture (mobile autoplay rules). */
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.8 : 0;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Engine: detuned saw + square through a lowpass.
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 500;
    this.engFilter.Q.value = 2;
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    const o2g = ctx.createGain();
    o2g.gain.value = 0.5;
    this.osc1.connect(this.engFilter);
    this.osc2.connect(o2g).connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.master);
    this.osc1.start();
    this.osc2.start();

    this.rumble = this.noiseLoop('bandpass', 140, 0.8);
    this.wind = this.noiseLoop('highpass', 700, 0.5);
    this.rain = this.noiseLoop('lowpass', 2800, 0.4);

    this.winchOsc = ctx.createOscillator();
    this.winchOsc.type = 'sawtooth';
    this.winchOsc.frequency.value = 160;
    this.winchGain = ctx.createGain();
    this.winchGain.gain.value = 0;
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 900;
    this.winchOsc.connect(wf).connect(this.winchGain).connect(this.master);
    this.winchOsc.start();
  }

  noiseLoop(type, freq, q) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    return g;
  }

  setEnabled(on) {
    this.enabled = on;
    localStorage.setItem('ridgeline:sound', on ? 'on' : 'off');
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.05);
  }

  /** Continuous sounds, called every frame. */
  update({ rpm, throttle, speed, rough, rain, winch, active }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const k = active ? 1 : 0;
    const f = 34 + rpm * 92;
    this.osc1.frequency.setTargetAtTime(f, t, 0.04);
    this.osc2.frequency.setTargetAtTime(f * 0.5 + 1.5, t, 0.04);
    this.engFilter.frequency.setTargetAtTime(380 + throttle * 900 + rpm * 500, t, 0.05);
    this.engGain.gain.setTargetAtTime(k * (0.045 + throttle * 0.05), t, 0.06);
    this.rumble.gain.setTargetAtTime(k * Math.min(0.5, speed * 0.02 * (0.4 + rough)), t, 0.08);
    this.wind.gain.setTargetAtTime(k * Math.min(0.12, speed * speed * 0.00018), t, 0.2);
    this.rain.gain.setTargetAtTime(rain * 0.18, t, 0.5);
    this.winchGain.gain.setTargetAtTime(k * (winch > 0 ? 0.035 + winch * 0.03 : 0), t, 0.05);
    this.winchOsc.frequency.setTargetAtTime(150 + winch * 90, t, 0.1);
  }

  env(node, peak, attack, decay, start = this.ctx.currentTime) {
    node.gain.setValueAtTime(0, start);
    node.gain.linearRampToValueAtTime(peak, start + attack);
    node.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
  }

  tone(freq, type, peak, attack, decay, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    o.connect(g).connect(this.master);
    this.env(g, peak, attack, decay, t);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  burst(type, freq, peak, decay) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    src.connect(f).connect(g).connect(this.master);
    this.env(g, peak, 0.005, decay, t);
    src.start(t, Math.random());
    src.stop(t + decay + 0.1);
  }

  horn(volume = 1) {
    if (!this.ctx || volume < 0.02) return;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1800;
    f.connect(g).connect(this.master);
    for (const fr of [392, 494]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = fr;
      o.connect(f);
      o.start(t);
      o.stop(t + 0.5);
    }
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12 * volume, t + 0.02);
    g.gain.setValueAtTime(0.12 * volume, t + 0.38);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.48);
  }

  chime() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 'sine', 0.12, 0.01, 0.5, i * 0.09));
  }

  discover() {
    [392, 494, 587].forEach((f) => this.tone(f, 'triangle', 0.07, 0.25, 1.4));
    this.tone(784, 'sine', 0.05, 0.4, 1.6, 0.25);
  }

  upgrade() {
    [440, 554, 659, 880].forEach((f, i) => this.tone(f, 'square', 0.04, 0.01, 0.25, i * 0.07));
  }

  shutter() {
    this.burst('highpass', 2500, 0.35, 0.05);
    this.tone(1800, 'square', 0.03, 0.002, 0.03, 0.06);
  }

  thud(v) {
    this.tone(55 + Math.random() * 15, 'sine', Math.min(0.5, v * 0.08), 0.005, 0.25);
    this.burst('lowpass', 400, Math.min(0.3, v * 0.05), 0.15);
  }

  splash() {
    this.burst('bandpass', 900, 0.25, 0.5);
  }

  click() {
    this.tone(900, 'square', 0.03, 0.002, 0.04);
  }
}
