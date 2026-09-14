/**
 * AudioEngine — космический soundscape, синтезированный на лету (WebAudio).
 *
 * Слои:
 *  - глубокий дрон (2 расстроенных осциллятора + фильтрованный шум)
 *  - далёкий «ветер» (bandpass-шум с LFO)
 *  - минималистичный dark-ambient пад (расстроенные синусы, медленный filter)
 *  - саб-пульс «сердцебиение» — темп и громкость растут с tracking/gaze
 *  - тиннитус тон при захвате взгляда
 *  - луч: дисторшн-стек + низкий рёв (старт/стоп по фазам gaze)
 *  - SFX: подбор души, лечение, касание духа, near-miss, пробуждение (8-сек
 *    riser с колоколом), смерть (взрыв + sudden silence)
 * Никаких внешних файлов — всё из осцилляторов и шума.
 */
const TWO_PI = Math.PI * 2;

function noiseBuffer(ctx: AudioContext, seconds = 3, pink = true): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  if (pink) {
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.0990460;
      b1 = 0.96300 * b1 + w * 0.2965164;
      b2 = 0.57000 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.06;
    }
  } else {
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return buf;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private comp!: DynamicsCompressorNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private ambBus!: GainNode;

  // слои
  private droneGain!: GainNode;
  private droneFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private padGain!: GainNode;
  private padFilter!: BiquadFilterNode;
  private tinnitusGain!: GainNode;
  private beamGain!: GainNode;
  private beamFilter!: BiquadFilterNode;
  private rumbleGain!: GainNode;
  private noise!: AudioBuffer;

  private nextPulseAt = 0;
  private pulseRate = 1.4;
  private pulseStrength = 0;

  soundOn = true;
  musicOn = true;
  private started = false;

  /** вызывать по клику Start (требование autoplay-policy) */
  init(): void {
    if (this.started) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.started = true;
    const ctx = new AC();
    this.ctx = ctx;
    this.noise = noiseBuffer(ctx, 3, true);

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.ratio.value = 6;
    this.comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.comp);

    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 1; this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.55; this.musicBus.connect(this.master);
    this.ambBus = ctx.createGain(); this.ambBus.gain.value = 0.85; this.ambBus.connect(this.master);

    // ---- ДРОН: два баса + шум через LP ----
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 110;
    this.droneFilter.Q.value = 2.2;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.0;
    this.droneFilter.connect(this.droneGain);
    this.droneGain.connect(this.ambBus);
    for (const [f, det] of [[27.5, 0], [41.2, 8], [55, -5]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.detune.value = det;
      const g = ctx.createGain();
      g.gain.value = 0.4;
      o.connect(g);
      g.connect(this.droneFilter);
      o.start();
      // медленный LFO расстройки
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.03 + Math.random() * 0.04;
      const lg = ctx.createGain();
      lg.gain.value = 3 + Math.random() * 5;
      lfo.connect(lg);
      lg.connect(o.detune);
      lfo.start();
    }
    // шумовая составляющая дрона
    const dn = ctx.createBufferSource();
    dn.buffer = this.noise; dn.loop = true;
    const dnf = ctx.createBiquadFilter();
    dnf.type = 'lowpass'; dnf.frequency.value = 60;
    const dng = ctx.createGain(); dng.gain.value = 0.5;
    dn.connect(dnf); dnf.connect(dng); dng.connect(this.droneFilter);
    dn.start();

    // ---- ВЕТЕР ----
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.05;
    this.windGain.connect(this.ambBus);
    const wn = ctx.createBufferSource();
    wn.buffer = noiseBuffer(ctx, 4, false); wn.loop = true;
    const wf = ctx.createBiquadFilter();
    wf.type = 'bandpass'; wf.frequency.value = 340; wf.Q.value = 0.6;
    const wlfo = ctx.createOscillator();
    wlfo.frequency.value = 0.07;
    const wlg = ctx.createGain(); wlg.gain.value = 180;
    wlfo.connect(wlg); wlg.connect(wf.frequency); wlfo.start();
    wn.connect(wf); wf.connect(this.windGain);
    wn.start();

    // ---- PAD (dark ambient, минимализм) ----
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 320;
    this.padFilter.Q.value = 0.8;
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0;
    this.padFilter.connect(this.padGain);
    this.padGain.connect(this.musicBus);
    // аккорд A1 E2 C3 G3 — диссонанс малой секунды в верху добавляется позже
    for (const [f, a] of [[55, 0.5], [82.4, 0.4], [130.8, 0.32], [196, 0.18], [220, 0.12]] as const) {
      for (const det of [-4, 4]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        o.detune.value = det;
        const g = ctx.createGain();
        g.gain.value = a * 0.16;
        o.connect(g); g.connect(this.padFilter);
        o.start();
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.015 + Math.random() * 0.03;
        const lg = ctx.createGain();
        lg.gain.value = 0.35 * a;
        lfo.connect(lg); lg.connect((g as unknown as { gain: AudioParam }).gain);
        lfo.start();
      }
    }
    // медленный проход фильтра пад
    const plfo = ctx.createOscillator();
    plfo.frequency.value = 0.021;
    const plg = ctx.createGain(); plg.gain.value = 140;
    plfo.connect(plg); plg.connect(this.padFilter.frequency); plfo.start();

    // ---- ТИННИТУС ----
    this.tinnitusGain = ctx.createGain();
    this.tinnitusGain.gain.value = 0;
    this.tinnitusGain.connect(this.sfxBus);
    const t1 = ctx.createOscillator();
    t1.type = 'sine'; t1.frequency.value = 7900;
    const t2 = ctx.createOscillator();
    t2.type = 'sine'; t2.frequency.value = 11300;
    const trem = ctx.createOscillator();
    trem.frequency.value = 14;
    const treml = ctx.createGain(); treml.gain.value = 0.3;
    const tmix = ctx.createGain(); tmix.gain.value = 0.045;
    trem.connect(treml); treml.connect(tmix.gain);
    t1.connect(tmix); t2.connect(tmix);
    tmix.connect(this.tinnitusGain);
    t1.start(); t2.start(); trem.start();

    // ---- BEAM: дисторшн-стек + рёв ----
    this.beamGain = ctx.createGain();
    this.beamGain.gain.value = 0;
    this.beamGain.connect(this.sfxBus);
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(3.2 * x);
    }
    shaper.curve = curve;
    this.beamFilter = ctx.createBiquadFilter();
    this.beamFilter.type = 'bandpass';
    this.beamFilter.frequency.value = 900;
    this.beamFilter.Q.value = 0.4;
    const bp = ctx.createGain(); bp.gain.value = 0.32;
    bp.connect(shaper); shaper.connect(this.beamGain);
    for (const f of [147, 221, 440.5, 623]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0.22;
      o.connect(g); g.connect(bp);
      o.start();
      const vib = ctx.createOscillator();
      vib.frequency.value = 18 + Math.random() * 22;
      const vg = ctx.createGain(); vg.gain.value = 6;
      vib.connect(vg); vg.connect(o.frequency); vib.start();
    }
    const bn = ctx.createBufferSource();
    bn.buffer = this.noise; bn.loop = true;
    const bnf = ctx.createBiquadFilter();
    bnf.type = 'highpass'; bnf.frequency.value = 900;
    const bng = ctx.createGain(); bng.gain.value = 0.25;
    bn.connect(bnf); bnf.connect(bng); bng.connect(bp);
    bn.start();
    // низкочастотный рёв
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    this.rumbleGain.connect(this.sfxBus);
    const ro = ctx.createOscillator();
    ro.type = 'sine'; ro.frequency.value = 36;
    const ro2 = ctx.createOscillator();
    ro2.type = 'sine'; ro2.frequency.value = 41.5;
    const rg = ctx.createGain(); rg.gain.value = 0.9;
    ro.connect(rg); ro2.connect(rg); rg.connect(this.rumbleGain);
    ro.start(); ro2.start();
  }

  resume(): void {
    this.ctx?.resume();
  }

  /** плавные «сценические» параметры каждый кадр */
  setMood(opts: { awake01: number; danger: number; gaze01: number; beam01: number; alive: boolean; timeScale?: number }): void {
    const ctx = this.ctx;
    if (!ctx || !this.started) return;
    const t = ctx.currentTime;
    const ts = opts.timeScale ?? 1;
    const on = this.soundOn ? 1 : 0;
    // дрон: от едва слышимого сна до тяжёлого гула
    this.droneGain.gain.setTargetAtTime(on * (0.05 + opts.awake01 * 0.22 + opts.danger * 0.12), t, 0.4);
    this.droneFilter.frequency.setTargetAtTime(90 + opts.danger * 160 + opts.gaze01 * 200, t, 0.3);
    this.windGain.gain.setTargetAtTime(on * 0.045 * (1 - opts.awake01 * 0.5), t, 1.0);
    // пад: тишина сна → давящая музыка бодрствования
    const padLevel = this.musicOn ? 0.10 + opts.awake01 * 0.16 + opts.danger * 0.1 : 0;
    this.padGain.gain.setTargetAtTime(on * padLevel, t, 2.0);
    this.padFilter.frequency.setTargetAtTime(260 + opts.danger * 500, t, 1.5);
    // тиннитус при захвате
    this.tinnitusGain.gain.setTargetAtTime(on * opts.gaze01 * 0.55, t, 0.12);
    // луч
    this.beamGain.gain.setTargetAtTime(on * opts.beam01 * 0.5, t, 0.05);
    this.beamFilter.frequency.setTargetAtTime(700 + opts.beam01 * 2600, t, 0.08);
    this.rumbleGain.gain.setTargetAtTime(on * opts.beam01 * 0.34, t, 0.08);
    void ts;
  }

  /** сердцебиение — вызывать из update: сам решает, когда тик */
  pulse(danger01: number, rate01: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.soundOn) return;
    if (rate01 < 0.05) return;
    this.pulseStrength = danger01;
    this.pulseRate = 1.5 - rate01 * 0.95;
    if (ctx.currentTime >= this.nextPulseAt) {
      this.nextPulseAt = ctx.currentTime + this.pulseRate;
      this.heartbeat(0.35 + danger01 * 0.65);
    }
  }

  private heartbeat(strength: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(64, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5 * strength, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    o.connect(g); g.connect(this.ambBus);
    o.start(t); o.stop(t + 0.4);
    // вторая волна (lub-dub)
    const t2 = t + 0.24 * (1.2 - strength * 0.5);
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(58, t2);
    o2.frequency.exponentialRampToValueAtTime(28, t2 + 0.16);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0, t2);
    g2.gain.linearRampToValueAtTime(0.32 * strength, t2 + 0.012);
    g2.gain.exponentialRampToValueAtTime(0.001, t2 + 0.3);
    o2.connect(g2); g2.connect(this.ambBus);
    o2.start(t2); o2.stop(t2 + 0.4);
  }

  /** приятный FM-«бель» подбора */
  blip(freq: number, dur = 0.16, vol = 0.3): void {
    const ctx = this.ctx;
    if (!ctx || !this.soundOn) return;
    const t = ctx.currentTime;
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const mg = ctx.createGain();
    const env = ctx.createGain();
    car.type = 'sine'; car.frequency.value = freq;
    mod.type = 'sine'; mod.frequency.value = freq * 2.01;
    mg.gain.setValueAtTime(freq * 1.4, t);
    mg.gain.exponentialRampToValueAtTime(1, t + dur);
    mod.connect(mg); mg.connect(car.frequency);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vol, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    car.connect(env); env.connect(this.sfxBus);
    car.start(t); mod.start(t);
    car.stop(t + dur + 0.05); mod.stop(t + dur + 0.05);
  }

  collectBlue(large: boolean): void {
    const base = large ? 660 : 880;
    this.blip(base, 0.18, large ? 0.42 : 0.28);
    this.blip(base * 1.5, 0.24, 0.14);
  }

  collectGold(): void {
    this.blip(784, 0.3, 0.4);
    this.blip(1176, 0.42, 0.3);
    this.blip(1568, 0.5, 0.2);
  }

  collectGreen(): void {
    this.blip(523, 0.26, 0.3);
    this.blip(659, 0.3, 0.24);
  }

  /** дух: диссонансный удар + шумовой плевок */
  spiritHit(): void {
    const ctx = this.ctx;
    if (!ctx || !this.soundOn) return;
    const t = ctx.currentTime;
    for (const f of [73, 97.5, 138]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(f * 2, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0, t);
      g.gain.linearRampToValueAtTime(0.22, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      const of = ctx.createBiquadFilter();
      of.type = 'lowpass'; of.frequency.value = 500;
      o.connect(of); of.connect(g); g.connect(this.sfxBus);
      o.start(t); o.stop(t + 0.7);
    }
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass'; nf.frequency.setValueAtTime(2400, t);
    nf.frequency.exponentialRampToValueAtTime(300, t + 0.4);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.25, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    n.connect(nf); nf.connect(ng); ng.connect(this.sfxBus);
    n.start(t); n.stop(t + 0.5);
  }

  /** whoosh near-miss */
  nearMiss(): void {
    const ctx = this.ctx;
    if (!ctx || !this.soundOn) return;
    const t = ctx.currentTime;
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(420, t);
    f.frequency.exponentialRampToValueAtTime(6200, t + 0.16);
    f.frequency.exponentialRampToValueAtTime(900, t + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    n.connect(f); f.connect(g); g.connect(this.sfxBus);
    n.start(t); n.stop(t + 0.5);
    this.blip(1760, 0.1, 0.16);
  }

  /** ПРОБУЖДЕНИЕ: долгий 8-секундный riser + колокол */
  awaken(): void {
    const ctx = this.ctx;
    if (!ctx || !this.soundOn) return;
    const t0 = ctx.currentTime;
    // суб-глиссандо 20→60 Гц
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(20, t0);
    o.frequency.exponentialRampToValueAtTime(41, t0 + 4);
    o.frequency.exponentialRampToValueAtTime(64, t0 + 8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.5, t0 + 6.5);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 10);
    o.connect(g); g.connect(this.ambBus);
    o.start(t0); o.stop(t0 + 10.2);
    // шумовой swell через bandpass со свистом вверх
    const n = ctx.createBufferSource();
    n.buffer = this.noise; n.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 1.8;
    f.frequency.setValueAtTime(80, t0);
    f.frequency.exponentialRampToValueAtTime(1800, t0 + 7.5);
    f.frequency.exponentialRampToValueAtTime(200, t0 + 9.5);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t0);
    ng.gain.exponentialRampToValueAtTime(0.3, t0 + 7.5);
    ng.gain.exponentialRampToValueAtTime(0.001, t0 + 10);
    n.connect(f); f.connect(ng); ng.connect(this.sfxBus);
    n.start(t0); n.stop(t0 + 10.2);
    // колокол (удар в 6.5с — «глаза открылись»)
    const bt = t0 + 6.4;
    for (const [ratio, amp, dur] of [[1, 0.4, 7], [2.76, 0.16, 4.5], [5.4, 0.09, 3], [8.9, 0.05, 2]] as const) {
      const bo = ctx.createOscillator();
      bo.type = 'sine';
      bo.frequency.value = 55 * ratio;
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.0001, bt);
      bg.gain.linearRampToValueAtTime(amp, bt + 0.008);
      bg.gain.exponentialRampToValueAtTime(0.0001, bt + dur);
      bo.connect(bg); bg.connect(this.sfxBus);
      bo.start(bt); bo.stop(bt + dur + 0.1);
    }
  }

  /** старт луча: треск-инициализация поверх лупа */
  beamStart(): void {
    this.nearMiss();
    this.blip(220, 0.5, 0.35);
    this.blip(110, 0.7, 0.3);
  }

  /** СМЕРТЬ: бум и abrupt silence */
  death(): void {
    const ctx = this.ctx;
    if (!ctx || !this.soundOn) return;
    const t = ctx.currentTime;
    // вырезаем эмбиент
    this.droneGain.gain.setTargetAtTime(0, t, 0.6);
    this.padGain.gain.setTargetAtTime(0, t, 0.5);
    this.windGain.gain.setTargetAtTime(0, t, 0.6);
    // удар
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(20, t + 1.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 2.4);
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.setValueAtTime(6000, t);
    nf.frequency.exponentialRampToValueAtTime(120, t + 1.4);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
    n.connect(nf); nf.connect(ng); ng.connect(this.sfxBus);
    n.start(t); n.stop(t + 1.6);
  }

  /** рестарт — вернуть жизнь слоям */
  revive(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tinnitusGain.gain.setTargetAtTime(0, t, 0.1);
    this.beamGain.gain.setTargetAtTime(0, t, 0.1);
    this.rumbleGain.gain.setTargetAtTime(0, t, 0.1);
    this.master.gain.setTargetAtTime(0.9, t, 0.4);
  }

  click(): void {
    this.blip(1320, 0.05, 0.12);
  }

  lockPing(): void {
    this.blip(220, 0.12, 0.2);
    this.blip(233, 0.12, 0.2);
  }

  setSettings(sound: boolean, music: boolean): void {
    this.soundOn = sound;
    this.musicOn = music;
    if (this.ctx) {
      this.master.gain.setTargetAtTime(sound ? 0.9 : 0, this.ctx.currentTime, 0.08);
    }
  }

  suspend(): void {
    this.ctx?.suspend();
  }
  get currentTime(): number {
    return this.ctx?.currentTime ?? 0;
  }
}
