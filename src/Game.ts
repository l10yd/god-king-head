/**
 * Game.ts — оркестратор. Связывает: ввод → игрок-орбита → голова/взгляд/луч →
 * души/спавн → score/combo/HP → камера/VFX/UI/звук. Явная state machine фаз.
 *
 * INTRO → PLAYING ⇄ PAUSED → DYING → GAMEOVER → (PLAYING)
 * Внутри PLAYING голова: СОН → ПРОБУЖДЕНИЕ → ТРЕКИНГ; взгляд: GazeSystem-фазы.
 */
import { Group, Vector3, Color, Mesh, RingGeometry, ShaderMaterial } from 'three';
import { Renderer } from './render/Renderer';
import { World } from './world/World';
import { CameraRig } from './core/CameraRig';
import { GodHead } from './head/GodHead';
import { BeamSystem, ANGLE_GRAZE } from './head/BeamSystem';
import { PlayerController } from './player/PlayerController';
import { Player } from './player/Player';
import { SoulField } from './souls/SoulField';
import { ParticleSystem } from './render/Particles';
import { AudioEngine } from './audio/AudioEngine';
import { HUD } from './ui/HUD';
import { TouchControls } from './ui/TouchControls';
import { Screens, type RunSummary } from './ui/Screens';
import { EventBus } from './core/Events';
import { StateMachine } from './core/StateMachine';
import { InputManager } from './core/Input';
import { ScoreSystem } from './game/ScoreSystem';
import { HealthSystem } from './game/HealthSystem';
import { GazeSystem, GazePhase } from './game/GazeSystem';
import { Awakening } from './game/Awakening';
import { dangerScore, headTrackSpeed, eyeTrackSpeed, beamDamage, beamTurnSpeed } from './game/Difficulty';
import { mulberry32, seedLabel } from './math/rng';
import { damp, clamp, clamp01, smoothstep } from './math/Tracking';
import { createShockRingMaterial } from './render/Shaders';
import { PLAYER, HEAD, WORLD, CAM, SCORE, DIFFICULTY, GOLD_WAVE, SPIRITS, QUALITY_PRESETS, type QualityLevel } from './constants';

export type Phase = 'INTRO' | 'PLAYING' | 'PAUSED' | 'DYING' | 'GAMEOVER';

const PHASE_TRANSITIONS: Record<Phase, Phase[]> = {
  INTRO: ['PLAYING'],
  PLAYING: ['PAUSED', 'DYING'],
  PAUSED: ['PLAYING', 'INTRO'],
  DYING: ['GAMEOVER'],
  GAMEOVER: ['PLAYING', 'INTRO'],
};

const _v = new Vector3();
const _v2 = new Vector3();
// кэш объектов для горячего кадра (без new в tick)
const _camUp = new Vector3(0, 1, 0);
const _uT = new Vector3();
const _vT = new Vector3();
const _posT = new Vector3();
const _originL = new Vector3();
const _originR = new Vector3();
/** позиции духов, сгоревших в луче на этом кадре (обычно пусто) */
const _burnOut: Vector3[] = [];

export interface Settings {
  quality: QualityLevel;
  post: boolean;
  motion: boolean;
  sound: boolean;
  music: boolean;
}

const LS_SETTINGS = 'gk-settings-v1';
const LS_BEST = 'gk-best-v1';

function loadSettings(): Settings {
  const def: Settings = { quality: 'HIGH', post: true, motion: true, sound: true, music: true };
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (raw) return { ...def, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return def;
}

export class Game {
  private renderer: Renderer;
  private world: World;
  private rig: CameraRig;
  private head: GodHead;
  private beam: BeamSystem;
  private pc: PlayerController;
  private player: Player;
  private field: SoulField;
  private fx: ParticleSystem;
  private audio = new AudioEngine();
  private hud: HUD;
  private screens: Screens;
  /** сенсорный стик/кнопки — только на тач-устройствах */
  private touchCtl: TouchControls | null = null;
  private bus = new EventBus();
  private fsm = new StateMachine<Phase>('INTRO', PHASE_TRANSITIONS);
  private input = new InputManager();
  private score = new ScoreSystem();
  private health = new HealthSystem();
  private gaze = new GazeSystem();

  /** seed и rng текущего рана */
  seed = 0;
  private rng = mulberry32(1);
  private fieldRoot = new Group();

  /** ран-статистика */
  private runTime = 0;
  private redTouched = 0;
  private soulsCollected = 0;
  private nearMissCount = 0;
  private escapeCount = 0;
  private firstRedAt = 0;
  private danger = 0;
  private survivalAcc = 0;
  private introT = 0;
  private dyingT = 0;
  private controlLock = 0;
  /** зум: текущий/целевой множитель дистанции камеры (колесо мыши) */
  private zoom = 1;
  private zoomTarget = 1;
  private awakenPull = 0;
  private trauma = 0;
  private hitFlash = 0;
  private whiteFlash = 0;
  private heat = 0;
  private timeScale = 1;
  /** золотая ударная волна: кольцо, растущее из точки подбора */
  private waveRing!: Mesh;
  private waveMat!: ShaderMaterial;
  private waveT = -1; // сек с момента запуска волны; <0 — не активна
  private waveOrigin = new Vector3();
  /** красные волны от сгоревших духов (пул колец): пересечение = замедление */
  private redWaves: { t: number; hit: boolean; origin: Vector3; mesh: Mesh; mat: ShaderMaterial }[] = [];
  private purgedTotal = 0;
  private burnedTotal = 0;
  private nearMissSlowmo = 0;
  private lastHurtSource: 'beam' | 'spirit' = 'beam';

  settings: Settings;
  debugMode = false;
  private debugAcc = 0;
  private fps = 60;
  private running = false;
  private disposed = false;

  constructor(host: HTMLElement) {
    this.settings = loadSettings();
    const preset = QUALITY_PRESETS[this.settings.quality];

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;';
    host.appendChild(canvas);

    this.renderer = new Renderer(canvas, preset);
    this.rig = new CameraRig();
    this.world = new World(preset, this.rig.cam);
    this.renderer.attach(this.world.scene, this.rig.cam);

    this.head = new GodHead();
    this.world.scene.add(this.head.group);

    this.beam = new BeamSystem();
    this.world.scene.add(this.beam.group);

    this.player = new Player();
    this.world.scene.add(this.player.group);
    this.pc = new PlayerController();

    this.fx = new ParticleSystem();
    this.world.scene.add(this.fx.points);

    this.fieldRoot = new Group();
    this.world.scene.add(this.fieldRoot);
    // кольцо золотой волны (геометрия единичная, масштабом управляем)
    this.waveMat = createShockRingMaterial();
    this.waveMat.uniforms.uColor.value = new Color('#ffd873');
    this.waveRing = new Mesh(new RingGeometry(0.8, 1.0, 72), this.waveMat);
    this.waveRing.visible = false;
    this.waveRing.renderOrder = 12;
    this.world.scene.add(this.waveRing);
    // пул колец красных волн (дух сгорел → волна расходится, игрока замедляет)
    for (let i = 0; i < 3; i++) {
      const mat = createShockRingMaterial();
      mat.uniforms.uColor.value = new Color('#ff5030');
      const mesh = new Mesh(new RingGeometry(0.78, 1.0, 56), mat);
      mesh.visible = false;
      mesh.renderOrder = 12;
      this.world.scene.add(mesh);
      this.redWaves.push({ t: -1, hit: false, origin: new Vector3(), mesh, mat });
    }
    this.seed = (Date.now() ^ (performance.now() * 1000)) >>> 0;
    this.rng = mulberry32(this.seed);
    this.field = new SoulField(this.fieldRoot, this.rng);

    const ui = document.getElementById('ui')!;
    this.hud = new HUD(ui);
    this.screens = new Screens(ui);

    this.score.loadBest(Number(localStorage.getItem(LS_BEST) ?? '0'));

    // renderer size
    const resize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      const p = { ...QUALITY_PRESETS[this.settings.quality], post: this.settings.post };
      this.renderer.resize(w, h, p);
      this.rig.resize(w / h);
    };
    window.addEventListener('resize', resize);
    this.resizeFn = resize;
    resize();

    this.bindUI();
    this.input.attach(canvas.parentElement!);
    // сенсорное управление: создаём ТОЛЬКО на тач-устройствах (десктоп не трогаем)
    if (TouchControls.supported()) {
      this.touchCtl = new TouchControls(this.input, () => this.togglePause());
      this.hud.setTouchHints();
    }
    if (new URLSearchParams(location.search).get('debug') === '1') this.debugMode = true;

    // стартовая кинематографичная «спящая» поза: голова лицом вниз-от игрока
    this.head.rot.quaternion.identity();
    this.applySettings(this.settings, false);
  }

  private resizeFn: () => void = () => {};

  private bindUI(): void {
    this.screens.onStart = () => this.startRun();
    this.screens.onRestart = () => this.startRun();
    this.screens.onResume = () => this.togglePause();
    this.screens.onHelpClosed = () => {
      if (!this.helpPaused) return;
      this.helpPaused = false;
      if (this.fsm.current === 'PAUSED') this.fsm.current = 'PLAYING';
    };
    this.hud.onBtn((act) => {
      if (act === 'settings') {
        if (this.screens.helpOpen()) this.toggleHelpPanel(); // закрыть help (и снять его паузу)
        const open = this.screens.toggleSettings();
        if (open) this.screens.bindSettings({
          ...this.settings,
          onChange: (s) => this.applySettings(s, true),
        } as Settings & { onChange: (s: Settings) => void });
      }
      if (act === 'help') {
        // «?» — полноэкранный справочник (клик в любом месте закрывает).
        // Читаем с паузой: нечестно сгорать, пока смотришь легенду.
        this.toggleHelpPanel();
      }
    });
    this.input.onAction = (a) => {
      if (a === 'pause') {
        if (this.screens.helpOpen()) this.toggleHelpPanel();
        else this.togglePause();
      }
      if (a === 'help') this.toggleHelpPanel();
      if (a === 'debug') { this.debugMode = !this.debugMode; this.hud.toggleDebug(); }
      if (a === 'restart' && (this.fsm.is('PLAYING') || this.fsm.is('GAMEOVER'))) this.startRun();
      if (a === 'start' && this.fsm.is('INTRO')) this.startRun();
      if (a === 'start' && this.fsm.is('GAMEOVER')) this.startRun();
      if (a === 'mute') this.applySettings({ ...this.settings, sound: !this.settings.sound }, true);
    };
  }

  private hintShowTimer = 0;

  private applySettings(s: Settings, live: boolean): void {
    this.settings = s;
    try { localStorage.setItem(LS_SETTINGS, JSON.stringify(s)); } catch { /* private mode */ }
    const preset = { ...QUALITY_PRESETS[s.quality], post: s.post };
    this.renderer.setQuality(preset);
    if (live) this.world.setQuality(preset);
    this.audio.setSettings(s.sound, s.music);
    const post = s.post;
    (this.renderer.fx.uGrain as { value: number }).value = post && s.motion ? 0.04 : post ? 0.02 : 0;
  }

  startRun(): void {
    this.audio.init();
    this.audio.resume();
    this.screens.hideIntro();
    this.screens.hidePause();
    this.seed = (Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0;
    this.rng = mulberry32(this.seed);
    this.field.setRng(this.rng);
    this.field.resetRun();
    this.head.resetRun();
    this.beam.reset();
    this.score.resetRun();
    this.health.resetRun();
    this.gaze.resetAll();
    this.pc.resetRun();
    this.fx.clear();
    this.runTime = 0;
    this.redTouched = 0;
    this.soulsCollected = 0;
    this.firstRedAt = 0; // зададим ниже
    this.danger = 0;
    this.survivalAcc = 0;
    this.timeScale = 1;
    this.trauma = 0;
    this.hitFlash = 0;
    this.whiteFlash = 0;
    this.heat = 0;
    this.awakenPull = 0;
    this.dyingT = 0;
    // старт: камера у самого игрока (zoom=MIN) → за ZOOM_INTRO_TIME сек разлёт
    // до МАКСИМУМА (easeOutCubic); колесо разблокируется после раслёта
    this.zoom = CAM.ZOOM_MIN;
    this.zoomTarget = CAM.ZOOM_MAX;
    this.controlLock = CAM.ZOOM_INTRO_TIME;
    this.waveT = -1;
    this.waveRing.visible = false;
    for (const w of this.redWaves) { w.t = -1; w.hit = false; w.mesh.visible = false; }
    this.purgedTotal = 0;
    this.burnedTotal = 0;
    this.hintShowTimer = 8;
    this.hud.setHintVisible(true);
    this.screens.hideOver();
    this.screens.hideHelp();
    this.helpPaused = false; // startRun сам вернёт PLAYING
    // игрок стартует «сбоку-спереди» от лица спящей головы
    const startDir = new Vector3(0.75, 0.35, 0.55).normalize();
    this.pc.resetRun(startDir);
    this.field.seedInitialRun(startDir);
    // спящая голова: развёрнута затылком к старту игрока → ощущение безразличия
    this.head.rot.quaternion.identity();
    this.head.rot.updateMatrix();
    _v.copy(startDir).negate();
    _v.z += -0.3; _v.x += 0.2; _v.normalize();
    this.head.rot.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), _v);
    this.rig.reset();
    this.fsm.current = 'PLAYING';
    this.firstRedAt = DIFFICULTY.FIRST_RED_AT;
    this.bus.emit({ type: 'run_started', seed: this.seed });
    this.audio.revive();
  }

  togglePause(): void {
    if (this.fsm.current === 'PLAYING') {
      this.fsm.current = 'PAUSED';
      this.screens.showPause();
    } else if (this.fsm.current === 'PAUSED') {
      this.fsm.current = 'PLAYING';
      this.screens.hidePause();
    }
  }

  /** Панель «?» ставим ПАУЗОЙ (без экрана паузы — он под ней), снимаем при закрытии */
  private helpPaused = false;
  private toggleHelpPanel(): void {
    const opened = this.screens.toggleHelp();
    // открытие: заморозить; закрытие: resume — в onHelpClosed (один путь для любых закрытий)
    if (opened && this.fsm.current === 'PLAYING') { this.fsm.current = 'PAUSED'; this.helpPaused = true; }
    this.audio.click();
  }

  /** главный цикл */
  start(): void {
    this.running = true;
    let last = performance.now();
    const frame = (now: number) => {
      if (this.disposed) return;
      requestAnimationFrame(frame);
      const rawDt = (now - last) / 1000;
      last = now;
      const dt = Math.min(0.05, Math.max(0, rawDt));
      // честный fps из СЫРОГО dt (не от обрезанного) — для отладки/профилирования
      this.fps += (1 / Math.max(rawDt, 1e-4) - this.fps) * 0.05;
      this.tick(dt);
      this.render();
    };
    requestAnimationFrame(frame);
  }

  private tick(rdt: number): void {
    const time = this.fxTime(rdt);
    // тач-слой активен только в игровых фазах (на экранах — свои кнопки)
    this.touchCtl?.setVisible(
      this.fsm.current === 'PLAYING' || this.fsm.current === 'DYING');
    // пауза и настройки не «снимают» рендер сцены — просто нет симуляции
    if (this.fsm.current === 'PAUSED') {
      this.hud.updateFloaters(rdt);
      return;
    }
    const sdt = rdt * this.timeScale;

    // ---- INTRO: кинематографический облёт спящей головы ----
    if (this.fsm.current === 'INTRO') {
      this.introT += rdt;
      const ang = this.introT * 0.05;
      // кинематографичный отлёт: старт вблизи лица → постепенно дальше и дальше
      const ease = smoothstep(0, 16, this.introT);
      const r = WORLD.ORBIT_RADIUS - 60 + ease * 240;
      _v.set(Math.sin(ang) * r, 40 + ease * 90 + Math.sin(this.introT * 0.13) * 40, Math.cos(ang) * r);
      this.rig.cam.position.lerp(_v, 0.04);
      this.rig.cam.up.set(0, 1, 0);
      this.rig.cam.lookAt(0, WORLD.HEAD_RADIUS * 0.4, 0);
      this.head.update({
        dt: rdt, time, playerRel: _v2.set(0, 0, 1).multiplyScalar(WORLD.ORBIT_RADIUS),
        trackRate: 0, eyeRate: 0, danger: 0, firing: false, chargeProgress: 0,
      });
      this.world.update(rdt, this.rig.cam.position);
      this.fx.update(rdt);
      this.updateFxUniforms(rdt, 0, 0);
      return;
    }

    // ---- PLAYING / DYING ----
    const playing = this.fsm.current === 'PLAYING';

    // ввод → СТАБИЛЬНЫЙ касательный базис контроллера (параллельный перенос).
    // Камера в формировании базиса НЕ участвует — иначе её инерция/pull-к-голове
    // поворачивают направление тяги и рожают self-feedback «вечный вираж».
    const frame = this.input.read();
    // стартовый раслёт: первые ZOOM_INTRO_TIME сек камера летит от MIN к MAX,
    // колесо в это время Глухо; после — разблокировано (стартует с МАКСИМУМА)
    if (this.controlLock > 0) {
      this.controlLock = Math.max(0, this.controlLock - rdt);
      const p = 1 - this.controlLock / CAM.ZOOM_INTRO_TIME;
      const e = 1 - (1 - p) * (1 - p) * (1 - p); // easeOutCubic
      this.zoom = CAM.ZOOM_MIN + (CAM.ZOOM_MAX - CAM.ZOOM_MIN) * e;
      this.zoomTarget = this.zoom;
    } else {
      if (frame.zoomStep !== 0) {
        this.zoomTarget = clamp(this.zoomTarget + frame.zoomStep * CAM.ZOOM_STEP, CAM.ZOOM_MIN, CAM.ZOOM_MAX);
      }
      this.zoom = damp(this.zoom, this.zoomTarget, 7, rdt);
    }
    let inx = frame.x, iny = frame.y, inBoost = frame.boost && playing, inDash = frame.dashEdge && playing;
    if (this.controlLock > 0) {
      // пока камера подлетает — ввод гасим, но базис держим валидным
      inx = 0; iny = 0; inBoost = false; inDash = false;
    }
    this.pc.update(sdt, { x: inx, y: iny, boost: inBoost, dash: inDash }, WORLD.ORBIT_RADIUS, 1);

    // позиция игрока
    const playerPos = this.pc.position(_posT, WORLD.ORBIT_RADIUS);

    // ---- difficulty / danger ----
    if (playing) this.runTime += sdt;
    this.danger = playing ? dangerScore(this.runTime, this.redTouched) : this.danger;

    // ---- голова: трекинг + awakening ----
    const awake = this.head.awakening.eyesOpen;
    const trackRate = awake ? headTrackSpeed(this.danger) : 0;
    const eyeRate = awake ? eyeTrackSpeed(this.danger) : 0.5;
    const firingNow = this.gaze.phase === GazePhase.FIRE;
    this.head.update({
      dt: sdt, time, playerRel: playerPos, trackRate, eyeRate,
      danger: this.danger, firing: firingNow, chargeProgress: this.gaze.chargeProgress,
    });
    // затягивание камеры к голове во время пробуждения
    if (this.head.awakening.active) {
      const p = this.head.awakening.progress;
      this.awakenPull = smoothstep(0.05, 0.55, p) * (1 - smoothstep(0.75, 1.0, p));
    } else {
      this.awakenPull = damp(this.awakenPull, 0, 1.2, rdt);
    }

    // ---- gaze / beam ----
    const dot = awake ? this.head.gazeDot : -1;
    const hitAngle = Math.atan2(HEAD.BEAM_CORE_RADIUS + 2.2, WORLD.ORBIT_RADIUS);
    const beamOriginL = this.head.getBeamOrigin('left', _originL);
    const beamOriginR = this.head.getBeamOrigin('right', _originR);
    const gs = this.gaze.update(sdt, {
      dot,
      awakened: awake && this.head.lidOpen > 0.75,
      danger: this.danger,
      beamAngle: this.beam.axisAngle,
      hitAngle,
      grazeAngle: ANGLE_GRAZE,
    });
    // события gaze
    if (gs.chargeStarted) {
      this.audio.lockPing();
      this.bus.emit({ type: 'beam_charge' });
      this.trauma = Math.max(this.trauma, 0.18);
    }
    if (gs.fireStarted) {
      this.audio.beamStart();
      this.bus.emit({ type: 'beam_fire' });
      this.trauma = Math.max(this.trauma, 0.5);
      this.whiteFlash = Math.max(this.whiteFlash, 0.16);
    }
    if (gs.fireEnded) this.bus.emit({ type: 'beam_end', hitPlayer: this.beam.hitNow });
    if (gs.nearMiss && playing) { this.nearMissCount++; this.onNearMiss(); }
    if (gs.gazeEscape && playing) {
      this.escapeCount++;
      const gained = this.score.gazeEscape();
      this.hud.floatScreen(`ВЫСКОЧИЛ ИЗ ВЗГЛЯДА +${gained}`, 'score');
      this.audio.collectBlue(false);
    }

    // луч: визуал и попадание — даже после срыва лок даёт кадры добегания
    const beamOn = this.gaze.phase === GazePhase.FIRE || this.beam.intensity > 0.02;
    this.beam.update(
      sdt, time, beamOriginL, beamOriginR, playerPos,
      this.gaze.phase === GazePhase.FIRE, this.gaze.chargeProgress,
      beamTurnSpeed(this.danger),
    );

    // у луча есть и «мелкая» работа: красные духи в его конусе сгорают (скрытое HP)
    if (playing && this.gaze.phase === GazePhase.FIRE && this.beam.intensity > 0.4) {
      _burnOut.length = 0;
      if (this.field.beamBurn(this.beam.axis, sdt, _burnOut) > 0) {
        for (const p of _burnOut) this.onSpiritBurned(p);
      }
    }

    // урон луча
    if (playing && this.gaze.phase === GazePhase.FIRE && this.beam.hitNow) {
      const dmg = beamDamage(this.danger) * sdt;
      const applied = this.health.damage(dmg);
      if (applied > 0) {
        this.lastHurtSource = 'beam';
        this.score.damageTaken();
        this.hitFlash = Math.min(1, this.hitFlash + sdt * 5);
        this.trauma = Math.max(this.trauma, 0.45);
        this.heat = 1;
        // тряска частиц на игроке
        this.fx.burst(playerPos, 2, 1.2, 0.4, 6, 1.6, 0.9, 0.5, 10);
        if (this.health.dead) this.beginDeath();
      }
    }
    this.heat = damp(this.heat, this.gaze.phase === GazePhase.FIRE && this.beam.hitNow ? 1 : 0, 3, rdt);

    // gaze-события для HUD (awareness/lock on/off)
    this.bus.emit({ type: 'gaze_awareness', on: this.gaze.phase === GazePhase.AWARENESS });
    this.bus.emit({ type: 'gaze_lock', on: this.gaze.dangerous });

    // ---- души ----
    const touched = playing || this.fsm.current === 'DYING';
    if (touched) {
      const res = this.field.update(sdt, this.runTime, this.danger, playerPos, awake, this.firstRedAt);
      for (const s of res.collected) this.onCollect(s, playerPos);
      for (const s of res.spiritTouched) this.onSpiritTouched(s, playerPos, playing);
    } else {
      this.field.update(sdt, this.runTime, this.danger, playerPos, awake, this.firstRedAt);
    }

    // survival score: +10/сек
    if (playing) {
      this.survivalAcc += sdt;
      while (this.survivalAcc >= 1) {
        this.survivalAcc -= 1;
        this.score.survivalTick();
      }
    }
    const comboReset = this.score.update(sdt);
    if (comboReset) this.bus.emit({ type: 'combo_reset' });

    // ---- комбо-события для HUD ----
    if (this.score.mult > 1) { /* HUD показывает */ }

    // ---- частицы окружения ----
    this.ambientParticles(sdt, playerPos, awake);

    // ---- смерть ----
    if (this.fsm.current === 'DYING') {
      this.dyingT += rdt;
      this.timeScale = damp(this.timeScale, this.dyingT < 0.5 ? 0.16 : 0.5, 4, rdt);
      if (this.dyingT > 1.0 && !this.deathBurstDone) {
        this.deathBurstDone = true;
        this.fx.burst(playerPos, 90, 2.4, 1.6, 7, 1.4, 1.2, 0.8, 34);
        this.fx.burst(playerPos, 40, 1.5, 2.2, 5, 0.4, 0.8, 1.4, 22);
        this.whiteFlash = 1;
        this.trauma = 1;
        this.audio.death();
      }
      if (this.dyingT > 3.0) {
        this.timeScale = 1;
        this.beam.snap();
        this.fsm.current = 'GAMEOVER';
        this.showGameOver();
      }
    } else {
      this.deathBurstDone = false;
      // микромедленно после near-miss
      if (this.nearMissSlowmo > 0) {
        this.nearMissSlowmo -= rdt;
        this.timeScale = 0.35;
      } else {
        this.timeScale = damp(this.timeScale, 1, 8, rdt);
      }
    }

    // ---- камера ----
    const fwd = this.pc.vel.lengthSq() > 1
      ? _v.copy(this.pc.vel).addScaledVector(this.pc.d, -this.pc.vel.dot(this.pc.d)).normalize()
      : this.pc.screenRight(_vT);
    const gaze01 = smoothstep(HEAD.AWARENESS_DOT, HEAD.LOCK_DOT, dot);
    this.rig.update({
      dt: rdt, playerPos, forward: fwd, up: this.pc.screenUp(_uT),
      speed01: this.pc.speed01, boosting: this.pc.boosting, bank: this.pc.bank,
      gaze01: playing ? gaze01 * this.head.lidOpen : 0,
      trauma: this.settings.motion ? this.trauma : this.trauma * 0.35,
      fovPunch: this.whiteFlash,
      awakenPull: this.awakenPull, zoom: this.zoom, time,
    });
    this.trauma = Math.max(0, this.trauma - rdt * 1.5);
    this.hitFlash = Math.max(0, this.hitFlash - rdt * 1.8);
    this.whiteFlash = Math.max(0, this.whiteFlash - rdt * (this.fsm.current === 'DYING' ? 0.8 : 4));

    // ---- визуал игрока ----
    this.player.update({
      pos: playerPos, forward: fwd, up: this.pc.d, bank: this.pc.bank,
      speed01: this.pc.speed01, boosting: this.pc.boosting, dashing: this.pc.dashTimer > 0,
      time, hurt: this.hitFlash,
      dying: this.fsm.is('DYING') ? clamp01(this.dyingT / 2.4) : 0,
    });

    // ---- world/particles/hud ----
    this.world.update(rdt, this.rig.cam.position);
    this.fx.update(sdt);
    // золотая ударная волна: биллборд-кольцо, растущее до GOLD_WAVE.RADIUS
    if (this.waveT >= 0) {
      this.waveT += rdt;
      const k = this.waveT / GOLD_WAVE.DURATION;
      if (k >= 1) { this.waveT = -1; this.waveRing.visible = false; this.waveMat.uniforms.uOpacity.value = 0; }
      else {
        const e = 1 - (1 - k) * (1 - k); // easeOut — быстрый старт
        this.waveRing.scale.setScalar(4 + GOLD_WAVE.RADIUS * e);
        this.waveMat.uniforms.uOpacity.value = (1 - k) * 0.9;
        this.waveRing.quaternion.copy(this.rig.cam.quaternion); // лицом к камере
        // волна «выталкивает» точку наружу от центра головы
        this.waveRing.position.copy(this.waveOrigin).multiplyScalar(1 + k * 0.12);
      }
    }
    // красные волны сгоревших духов: медленное кольцо; пересёк — проклятие
    if (this.redWaves.length) {
      for (const w of this.redWaves) {
        if (w.t < 0) continue;
        w.t += rdt;
        const k = w.t / SPIRITS.WAVE_DURATION;
        if (k >= 1) { w.t = -1; w.mesh.visible = false; w.mat.uniforms.uOpacity.value = 0; continue; }
        const e = 1 - (1 - k) * (1 - k);
        const radius = SPIRITS.WAVE_RADIUS * e;
        w.mesh.visible = true;
        w.mesh.position.copy(w.origin);
        w.mesh.quaternion.copy(this.rig.cam.quaternion);
        w.mesh.scale.setScalar(2.5 + radius);
        w.mat.uniforms.uOpacity.value = (1 - k) * 0.7;
        if (!w.hit && playing && w.origin.distanceTo(playerPos) <= radius + 2) {
          w.hit = true;
          this.pc.curse(SPIRITS.WAVE_CURSE);
          this.hud.float('КРАСНАЯ ВОЛНА', 'danger', playerPos, this.rig.cam);
          this.audio.spiritHit();
          this.hitFlash = Math.max(this.hitFlash, 0.6);
          this.trauma = Math.max(this.trauma, 0.22);
        }
      }
    }
    this.updateFxUniforms(rdt, gaze01, this.beam.intensity);
    this.hud.update({
      score: this.score.score, best: this.score.best, mult: this.score.mult,
      hp01: this.health.ratio, boost01: this.pc.boostMeter / PLAYER.BOOST_MAX, dashReady: this.pc.dashCooldown <= 0,
      gaze: {
        active: this.gaze.phase === GazePhase.AWARENESS ? false : this.gaze.dangerous && awake,
        progress: this.gaze.phase === GazePhase.FIRE ? 1 : this.gaze.lockProgress * 0.5 + this.gaze.chargeProgress * 0.5,
        lock: this.gaze.dangerous,
        firing: this.gaze.phase === GazePhase.FIRE,
      },
      danger01: this.danger, timeSec: this.runTime, seedLabel: seedLabel(this.seed),
      cursed: this.pc.cursed,
    }, rdt);
    this.hud.updateFloaters(rdt);
    if (this.hintShowTimer > 0) {
      this.hintShowTimer -= rdt;
      if (this.hintShowTimer <= 0) this.hud.setHintVisible(false);
    }

    // ---- audio mood ----
    this.audio.setMood({
      awake01: this.head.awakening.progress,
      danger: this.danger,
      gaze01: (this.gaze.dangerous ? Math.max(gaze01, this.gaze.lockProgress) : 0) * (awake ? 1 : 0),
      beam01: this.beam.intensity * (this.beam.hitNow ? 1 : 0.75),
      alive: playing,
      timeScale: this.timeScale,
    });
    this.audio.pulse(this.danger, awake ? clamp01(this.head.headAngularSpeed / HEAD.TRACK_SPEED_MAX + (this.gaze.dangerous ? 0.4 : 0)) : 0);

    // ---- debug ----
    if (this.debugMode) {
      this.debugAcc += rdt;
      if (this.debugAcc > 0.25) {
        this.debugAcc = 0;
        const info = this.renderer.info;
        this.hud.setDebug([
          `FPS ${this.fps.toFixed(0)} | draws ${info.render.calls} | tris ${info.render.triangles} | geo ${info.memory.geometries} tex ${info.memory.textures}`,
          `state ${this.fsm.current} | awake ${awake} | gaze ${this.gaze.phase}`,
          `dot ${dot.toFixed(4)} | danger ${this.danger.toFixed(2)} | track ${trackRate.toFixed(3)} rad/s`,
          `pos ${playerPos.x.toFixed(0)},${playerPos.y.toFixed(0)},${playerPos.z.toFixed(0)} | R ${playerPos.length().toFixed(1)}`,
          `seed ${seedLabel(this.seed)} | souls ${this.field.souls.length} (r ${this.field.count('red')}) | parts ${this.fx.activeCount}`,
          `hp ${this.health.hp.toFixed(0)} | mult x${this.score.mult} | ts ${this.timeScale.toFixed(2)}`,
        ].join('\n'));
      }
    }
  }

  private deathBurstDone = false;

  private fxTime(rdt: number): number {
    this._t += rdt;
    return this._t;
  }
  private _t = 0;

  private onNearMiss(): void {
    const gained = this.score.nearMiss();
    this.hud.floatScreen(`ПОЧТИ! +${gained}`, 'score');
    this.audio.nearMiss();
    this.whiteFlash = Math.max(this.whiteFlash, 0.5);
    this.nearMissSlowmo = 0.08;
    this.fx.burst(this.beam.impactPoint, 26, 1.5, 0.5, 6, 1.2, 1.3, 1.6, 26);
    this.bus.emit({ type: 'near_miss', value: gained });
  }

  private onCollect(s: import('./souls/Soul').SoulData, playerPos: Vector3): void {
    this.soulsCollected++;
    if (s.kind === 'green') {
      const healed = this.health.heal(PLAYER.HEAL_GREEN);
      this.score.greenCollected(SCORE.GREEN);
      this.hud.float(`+${Math.round(healed)} ЖИЗНЬ`, 'heal', s.pos, this.rig.cam);
      this.audio.collectGreen();
      this.fx.burst(s.pos, 26, 1.2, 0.6, 6, 0.25, 1.5, 0.5, 16);
    } else if (s.kind === 'red') {
      void s;
    } else {
      const prevMult = this.score.mult;
      const gained = this.score.blueCollected(s.large, s.kind === 'gold');
      this.hud.float(`+${gained}`, s.kind === 'gold' ? 'gold' : 'score', s.pos, this.rig.cam);
      if (s.kind === 'gold') { this.audio.collectGold(); this.fireGoldWave(s.pos); }
      else this.audio.collectBlue(s.large);
      const c = s.kind === 'gold' ? [1.5, 1.1, 0.3] : [0.25, 1.1, 1.5];
      this.fx.burst(s.pos, s.large || s.kind === 'gold' ? 34 : 22, 1.0, 0.55, s.large ? 7 : 5, c[0], c[1], c[2], 15);
      if (this.score.mult > prevMult) {
        this.hud.comboPulse();
        this.bus.emit({ type: 'combo', mult: this.score.mult });
      }
    }
    this.bus.emit({ type: 'blue_collected', value: 0, large: false, position: { x: s.pos.x, y: s.pos.y, z: s.pos.z } });
    void playerPos;
  }

  /** ЗОЛОТО: круговая волна — испепеляет ближайших красных духов, щит на мгновение */
  private fireGoldWave(pos: Vector3): void {
    const killed = this.field.purgeRedsNear(pos, GOLD_WAVE.RADIUS);
    this.waveT = 0;
    this.waveOrigin.copy(pos).normalize().multiplyScalar(WORLD.ORBIT_RADIUS);
    this.waveRing.position.copy(this.waveOrigin);
    this.waveRing.visible = true;
    this.audio.blip(180, 0.4, 0.35);
    this.trauma = Math.max(this.trauma, 0.3);
    this.whiteFlash = Math.max(this.whiteFlash, 0.12);
    if (killed > 0) {
      this.purgedTotal += killed;
      this.hud.banner(`ВОЛНА ИСПЕПЕЛИЛА ×${killed}`);
      this.score.purgedSpirits(killed);
      // мини-взрывы на месте уничтоженных
      for (let i = 0; i < killed; i++) {
        this.fx.burst(pos, 24, 2.2, 1.0, 7, 1.8, 0.4, 0.1, 14);
      }
    }
  }

  /** Дух сгорел в луче: очки + взрыв + КРАСНАЯ ВОЛНА (пересечёшь — замедлит).
   *  Замена ему спавнится сразу, но за спиной игрока — без уведомлений. */
  private onSpiritBurned(pos: Vector3): void {
    this.burnedTotal++;
    this.score.spiritBurned();
    this.hud.float(`+${SCORE.SPIRIT_BURNED}`, 'danger', pos, this.rig.cam);
    this.fx.burst(pos, 30, 1.8, 1.0, 6, 1.9, 0.3, 0.08, 15);
    this.audio.spiritHit();
    // занять самый старый/свободный слот волны
    let slot = this.redWaves[0];
    for (const w of this.redWaves) if (w.t < slot.t) slot = w;
    slot.t = 0;
    slot.hit = false;
    slot.origin.copy(pos).normalize().multiplyScalar(WORLD.ORBIT_RADIUS);
    slot.mesh.visible = true;
  }

  private onSpiritTouched(s: import('./souls/Soul').SoulData, playerPos: Vector3, playing: boolean): void {
    this.redTouched++;
    this.audio.spiritHit();
    this.fx.burst(s.pos, 40, 1.6, 0.9, 6, 1.6, 0.15, 0.08, 20);
    this.trauma = Math.max(this.trauma, 0.4);
    this.hitFlash = 1;
    if (playing) {
      this.score.spiritScore();
      this.score.damageTaken(); // сброс комбо — контакт всё ещё «дорог»
      // КРАСНЫЙ ДУХ НЕ СНИМАЕТ HP: крадёт тягу — замедление + запрет SHIFT/рывка.
      this.pc.curse(PLAYER.CURSE_DURATION);
      this.hud.float('ЗАМЕДЛЕНИЕ', 'danger', s.pos, this.rig.cam);
    }
    if (!this.head.awakening.active && !this.head.awakening.finished) {
      // ПЕРВЫЙ ДУХ — ПРОБУЖДЕНИЕ
      this.head.startAwakening();
      this.audio.awaken();
      this.hud.banner('БОГ ПРОСЫПАЕТСЯ');
      this.bus.emit({ type: 'awaken_start' });
    } else if (this.head.awakening.finished) {
      this.bus.emit({ type: 'spirit_touch', dangerLevel: this.redTouched });
      if (this.redTouched % 5 === 0) this.hud.floatScreen(`ОНА ЧУВСТВУЕТ ТЕБЯ (${this.redTouched})`, 'danger');
    }
    void playerPos;
  }

  private beginDeath(): void {
    if (this.fsm.current !== 'PLAYING') return;
    this.fsm.current = 'DYING';
    this.dyingT = 0;
    this.gaze.reset();
    this.beam.intensity = 0;
    this.hud.setHintVisible(false);
    this.bus.emit({ type: 'player_died', cause: this.lastHurtSource === 'beam' ? 'gaze' : 'spirit' });
  }

  private showGameOver(): void {
    const best = Math.max(this.score.best, this.score.score);
    try { localStorage.setItem(LS_BEST, String(best)); } catch { /* ignore */ }
    const summary: RunSummary = {
      score: this.score.score,
      best,
      timeSec: this.runTime,
      redTouched: this.redTouched,
      soulsCollected: this.soulsCollected,
      newBest: this.score.score >= best && best > 0,
    };
    this.screens.showOver(summary);
  }

  /** частицы: шлейф игрока, дымка духов, dust головы, halo взгляда */
  private ambientParticles(dt: number, playerPos: Vector3, awake: boolean): void {
    // thruster trail
    const spd = this.pc.vel.length();
    if (spd > 4 && Math.random() < dt * (this.pc.boosting ? 160 : 60)) {
      _v.copy(playerPos).addScaledVector(this.pc.vel, -0.15).addScaledVector(this.pc.d, -1.2);
      const g = this.pc.boosting ? 1.3 : 0.9;
      this.fx.spawn(_v.x, _v.y, _v.z, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 0.35, 2.2, 0.25, 0.55 * g, 0.8 * g);
    }
    // red spirit smoke
    if (awake || this.danger > 0.05) {
      for (const s of this.field.souls) {
        if (s.kind !== 'red' || !s.alive || Math.random() > dt * 14) continue;
        this.fx.spawn(
          s.pos.x + (Math.random() - 0.5) * 6, s.pos.y + (Math.random() - 0.5) * 8, s.pos.z + (Math.random() - 0.5) * 6,
          (Math.random() - 0.5) * 3, 3 + Math.random() * 5, (Math.random() - 0.5) * 3,
          1.1, 4.2, 0.9 * (0.4 + Math.random() * 0.6), 0.06, 0.04,
        );
      }
    }
    // debris при повороте головы (каменная пыль из-под век/глазниц)
    const rot = this.head.headAngularSpeed;
    if (rot > 0.05 && Math.random() < dt * rot * 6) {
      const side = Math.random() < 0.5 ? 'left' : 'right';
      const p = this.head.getBeamOrigin(side, _v2);
      this.fx.spawn(p.x, p.y, p.z, (Math.random() - 0.5) * 6, Math.random() * 5, (Math.random() - 0.5) * 6, 1.4, 2.6, 0.5, 0.44, 0.36);
    }
  }

  /** screen-space униформы финального прохода */
  private updateFxUniforms(dt: number, gaze01: number, beamInt: number): void {
    const fx = this.renderer.fx;
    (fx.uTime as { value: number }).value = this._t;
    (fx.uRedPulse as { value: number }).value = Math.max(0, gaze01 * 0.22 + this.hitFlash * 0.25 - beamInt * 0.05);
    (fx.uWhiteFlash as { value: number }).value = this.whiteFlash * (this.fsm.current === 'DYING' ? 0.8 : 0.5);
    (fx.uHeat as { value: number }).value = this.heat * 0.8 + gaze01 * 0.2;
    (fx.uDamage as { value: number }).value = Math.max(this.hitFlash, 1 - this.health.ratio);
    (fx.uSlowmo as { value: number }).value = this.timeScale < 0.9 ? 1 : 0;
    (fx.uVignette as { value: number }).value = 0.42 + this.danger * 0.18 + this.hitFlash * 0.1;
    (fx.uChroma as { value: number }).value = this.settings.post ? 0.0016 + this.trauma * 0.002 : 0;
    void dt;
  }

  private render(): void {
    this.renderer.render();
  }

  /** текущий объект камеры (для external) */
  get camera() { return this.rig.cam; }
  get phase(): Phase { return this.fsm.current; }

  /** для тестов/отладки: программный старт */
  debugStartRun(seed?: number): void {
    this.startRun();
    if (seed !== undefined) this.seed = seed >>> 0;
  }

  /** ---- QA API: используется Playwright-smoke-скриптом ---- */
  debugSpiritNearPlayer(): void {
    this.field.debugSpiritAt(this.pc.position(new Vector3(), WORLD.ORBIT_RADIUS));
  }
  /** QA: золото прямо у игрока (подбор → золотая волна) */
  debugGoldNearPlayer(): void {
    this.field.debugKindAt('gold', this.pc.position(new Vector3(), WORLD.ORBIT_RADIUS));
  }
  /** QA: красный дух в конусе луча (но вне радиуса касания) — для теста выжигания.
   *  Требует, чтобы голова уже вела луч на игрока (использовать с debugFaceGaze). */
  debugBurnTarget(): void {
    const player = this.pc.position(_posT, WORLD.ORBIT_RADIUS);
    _vT.copy(player).normalize(); // радиальное направление игрока
    // касательная к сфере в сторону луча: проецируем ось луча в плоскость ⟂ d
    _v2.copy(this.beam.axis).addScaledVector(_vT, -this.beam.axis.dot(_vT));
    if (_v2.lengthSq() < 1e-6) _v2.set(1, 0, 0).addScaledVector(_vT, -_vT.x);
    _v2.normalize();
    // ~18 м по касательной: угол ≈0.075 рад — в конусе луча (0.09), но вне касания (13.2)
    const pos = _v2.multiplyScalar(18).add(player).normalize().multiplyScalar(WORLD.ORBIT_RADIUS);
    this.field.debugKindAt('red', pos);
  }
  /** QA: N духов по кругу на радиусе dist от игрока (для проверки волны) */
  debugRedsRing(n: number, dist: number): void {
    const center = this.pc.position(new Vector3(), WORLD.ORBIT_RADIUS);
    const a = new Vector3().copy(this.pc.d).cross(new Vector3(0, 1, 0)).normalize();
    if (!isFinite(a.x + a.y + a.z) || a.lengthSq() < 1e-6) a.set(1, 0, 0);
    const b = new Vector3().copy(this.pc.d).cross(a).normalize();
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      const p = center.clone()
        .addScaledVector(a, Math.cos(ang) * dist)
        .addScaledVector(b, Math.sin(ang) * dist)
        .normalize().multiplyScalar(WORLD.ORBIT_RADIUS);
      this.field.debugKindAt('red', p);
    }
  }
  /** телепорт на сферические углы (theta, phi) — для проверки полюсов/тыла */
  debugTeleport(theta: number, phi: number): void {
    const sinPhi = Math.sin(phi);
    _v.set(sinPhi * Math.sin(theta), Math.cos(phi), sinPhi * Math.cos(theta));
    this.pc.resetRun(_v);
  }
  debugKill(): void {
    if (this.fsm.current !== 'PLAYING') return;
    this.health.damage(this.health.hp + 1);
    this.beginDeath();
  }
  /** QA: телепорт игрока точно на ось взгляда головы (в gaze-конус) */
  debugFaceGaze(): void {
    const fwd = new Vector3(0, 0, 1).applyQuaternion(this.head.rot.quaternion);
    this.pc.resetRun(fwd.normalize());
  }
  /** QA: полная починка HP (для следующих секций теста) */
  debugHeal(): void {
    this.health.hp = this.health.max;
    this.health.dead = false;
  }
  /** QA: текущее радиальное направление игрока (для проверки движения) */
  debugPlayerDir(): { x: number; y: number; z: number } {
    return { x: this.pc.d.x, y: this.pc.d.y, z: this.pc.d.z };
  }
  debugPeek(): Record<string, unknown> {
    return {
      phase: this.fsm.current,
      awakened: this.head.awakened,
      awakeProgress: this.head.awakening.progress,
      lidOpen: this.head.lidOpen,
      gazePhase: this.gaze.phase,
      chargeProgress: this.gaze.chargeProgress,
      gazeVisits: { ...this.gaze.visits },
      gazeDot: this.gazeDotSafe(),
      hp: this.health.hp,
      score: this.score.score,
      mult: this.score.mult,
      danger: this.danger,
      redTouched: this.redTouched,
      nearMissCount: this.nearMissCount,
      escapeCount: this.escapeCount,
      entities: this.field.souls.length,
      reds: this.field.count('red'),
      particles: this.fx.activeCount,
      controlLock: this.controlLock,
      cursed: this.pc.cursed,
      curseTimer: this.pc.curseTimer,
      boosting: this.pc.boosting,
      boostMeter: this.pc.boostMeter,
      boostDepleted: this.pc.boostDepleted,
      dashTimer: this.pc.dashTimer,
      dashCooldown: this.pc.dashCooldown,
      /** есть ли тач-слой и виден ли он сейчас (smoke-проверка) */
      touch: !!this.touchCtl,
      spiritsBurned: this.burnedTotal,
      spiritsPurged: this.purgedTotal,
      zoom: this.zoom,
      zoomTarget: this.zoomTarget,
      /** угловая скорость игрока, рад/с (анти-водоворотная диагностика) */
      angVel: this.pc.vel.length() / WORLD.ORBIT_RADIUS,
      fps: Math.round(this.fps),
      tris: this.renderer.info.render.triangles,
      calls: this.renderer.info.render.calls,
      seed: this.seed,
    };
  }
  private gazeDotSafe(): number {
    return this.head.gazeDot;
  }

  dispose(): void {
    this.disposed = true;
    this.resizeFn();
    window.removeEventListener('resize', this.resizeFn);
    this.input.detach();
    this.renderer.dispose();
    this.head.dispose();
  }
}
