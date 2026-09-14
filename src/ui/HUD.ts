/**
 * HUD — DOM-интерфейс поверх канваса. Строит всю разметку, умеет:
 * update(состояние ранa), floating-тексты с проекцией из мира,
 * баннеры («БОГ ПРОСЫПАЕТСЯ»), красные кромки при gaze.
 */
import { Vector3, PerspectiveCamera } from 'three';
import { ScoreSystem } from '../game/ScoreSystem';
import type { GameEvent } from '../core/Events';

export interface HudState {
  score: number;
  best: number;
  mult: number;
  hp01: number;
  boost01: number;
  dashReady: boolean;
  /** проклятие красного духа актив (тяга заблокирована) */
  cursed: boolean;
  gaze: { active: boolean; progress: number; lock: boolean; firing: boolean };
  danger01: number;
  timeSec: number;
  seedLabel: string;
}

export class HUD {
  private root: HTMLElement;
  private scoreEl!: HTMLElement;
  private bestEl!: HTMLElement;
  private comboEl!: HTMLElement;
  private hpFill!: HTMLElement;
  private hpBar!: HTMLElement;
  private boostFill!: HTMLElement;
  private boostBar!: HTMLElement;
  private gazeEl!: HTMLElement;
  private gazeMeter!: HTMLElement;
  private gazeSub!: HTMLElement;
  private statusEl!: HTMLElement;
  private hintEl!: HTMLElement;
  private floatersEl!: HTMLElement;
  private floaterPool: HTMLElement[] = [];
  private floaterActive: { el: HTMLElement; x: number; y: number; vy: number; life: number; maxLife: number }[] = [];
  private bannerEl!: HTMLElement;
  private redEdge!: HTMLElement;
  private debugEl!: HTMLElement;
  private debugOn = false;
  lastScore = -1;

  constructor(container: HTMLElement) {
    this.root = container;
    container.innerHTML = `
      <div class="gk-hud">
        <div class="gk-score">
          <div class="label">СЧЁТ</div>
          <div class="value num">0</div>
          <div class="best num">РЕКОРД&nbsp;&nbsp;0</div>
          <div class="gk-combo">×1</div>
        </div>
        <div class="gk-vitals">
          <div class="row"><span>ЖИЗНЬ</span><span class="hp-num num">100</span></div>
          <div class="gk-bar hp"><i></i></div>
          <div class="gk-bar boost"><i></i></div>
        </div>
        <div class="gk-gaze">
          <div class="title">БОЖЕСТВЕННЫЙ ВЗГЛЯД</div>
          <div class="meter"><i></i></div>
          <div class="sub">УХОДИ</div>
        </div>
        <div class="gk-status num"></div>
        <div class="gk-hint"><b>WASD</b> — полёт &nbsp;·&nbsp; <b>SHIFT</b> — ускорение &nbsp;·&nbsp; <b>ПРОБЕЛ</b> — рывок &nbsp;·&nbsp; <b>КОЛЕСО</b> — зум &nbsp;·&nbsp; <b>H</b> — помощь</div>
        <div class="gk-btns"><button data-act="help" title="Управление (H)">?</button><button data-act="settings" title="Настройки">⚙</button></div>
        <div class="gk-floaters"></div>
        <div class="gk-banner"></div>
        <div class="gk-red-edge"></div>
      </div>
      <div class="gk-debug"></div>
    `;
    const q = (s: string) => container.querySelector(s) as HTMLElement;
    this.scoreEl = q('.gk-score .value');
    this.bestEl = q('.gk-score .best');
    this.comboEl = q('.gk-combo');
    this.hpFill = q('.gk-bar.hp i');
    this.hpBar = q('.gk-bar.hp');
    this.boostFill = q('.gk-bar.boost i');
    this.boostBar = q('.gk-bar.boost');
    this.gazeEl = q('.gk-gaze');
    this.gazeMeter = q('.gk-gaze .meter i');
    this.gazeSub = q('.gk-gaze .sub');
    this.statusEl = q('.gk-status');
    this.hintEl = q('.gk-hint');
    this.floatersEl = q('.gk-floaters');
    this.bannerEl = q('.gk-banner');
    this.redEdge = q('.gk-red-edge');
    this.debugEl = q('.gk-debug');
    (q('.hp-num') as HTMLElement); // метка HP обновляется через this.hpNum
    this.hpNum = q('.hp-num');
  }

  private hpNum: HTMLElement;

  onBtn(cb: (act: string) => void): void {
    this.root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.dataset?.act) cb(t.dataset.act);
    });
  }

  setHintVisible(v: boolean): void {
    this.hintEl.classList.toggle('fade', !v);
  }

  update(s: HudState, dt: number): void {
    if (s.score !== this.lastScore) {
      this.lastScore = s.score;
      this.scoreEl.textContent = ScoreSystem.format(s.score);
    }
    this.bestEl.innerHTML = `РЕКОРД&nbsp;&nbsp;${ScoreSystem.format(s.best)}`;
    this.comboEl.textContent = `×${s.mult}`;
    this.comboEl.classList.toggle('on', s.mult > 1);
    this.hpFill.style.transform = `scaleX(${s.hp01})`;
    this.hpBar.classList.toggle('low', s.hp01 < 0.34);
    this.hpNum.textContent = String(Math.round(s.hp01 * 100));
    this.boostFill.style.transform = `scaleX(${s.boost01})`;
    // ПРОКЛЯТИЕ: шкала тяги «гаснет» красным, SHIFT/рывок недоступны
    this.boostBar.classList.toggle('cursed', s.cursed);
    this.boostFill.style.filter = s.cursed ? 'grayscale(1) brightness(.6)' : '';
    this.gazeEl.classList.toggle('on', s.gaze.active);
    this.gazeMeter.style.width = `${Math.round(s.gaze.progress * 100)}%`;
    this.gazeSub.textContent = s.gaze.firing ? 'СОЖЖЕНИЕ' : s.gaze.lock ? 'ЗАХВАТ' : 'ОН СМОТРИТ';
    this.gazeEl.querySelector('.title')!.classList.toggle('firing', s.gaze.firing);
    this.redEdge.style.opacity = String(Math.min(1, s.danger01 * (s.gaze.active ? 1 : 0.25)));
    const m = Math.floor(s.timeSec / 60);
    const sec = Math.floor(s.timeSec % 60);
    this.statusEl.textContent = `ВРЕМЯ ${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')} · БОГ-КОРОЛЬ · СИД ${s.seedLabel}`;
  }

  /** всплывающий текст с мировой проекцией */
  float(text: string, kind: 'score' | 'heal' | 'danger' | 'gold' | 'info', world: Vector3, cam: PerspectiveCamera): void {
    const el = this.floaterPool.pop() ?? this.makeFloater();
    el.textContent = text;
    el.className = `gk-floater ${kind}`;
    this.floatersEl.appendChild(el);
    const v = world.clone().project(cam);
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    this.floaterActive.push({ el, x, y, vy: 46, life: 1.15, maxLife: 1.15 });
  }

  floatScreen(text: string, kind: 'score' | 'info' | 'danger'): void {
    const el = this.floaterPool.pop() ?? this.makeFloater();
    el.textContent = text;
    el.className = `gk-floater ${kind}`;
    this.floatersEl.appendChild(el);
    this.floaterActive.push({ el, x: window.innerWidth / 2 + (Math.random() * 160 - 80), y: window.innerHeight * 0.42, vy: 40, life: 1.4, maxLife: 1.4 });
  }

  private makeFloater(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'gk-floater';
    return el;
  }

  updateFloaters(dt: number): void {
    for (let i = this.floaterActive.length - 1; i >= 0; i--) {
      const f = this.floaterActive[i];
      f.life -= dt;
      if (f.life <= 0) {
        f.el.remove();
        if (this.floaterPool.length < 20) this.floaterPool.push(f.el);
        this.floaterActive.splice(i, 1);
        continue;
      }
      f.y -= f.vy * dt;
      const t = f.life / f.maxLife;
      f.el.style.left = `${f.x}px`;
      f.el.style.top = `${f.y}px`;
      f.el.style.opacity = String(t > 0.7 ? (1 - t) / 0.3 : Math.min(1, t * 1.6));
    }
  }

  banner(text: string): void {
    this.bannerEl.textContent = text;
    this.bannerEl.classList.remove('show');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('show');
  }

  setDebug(lines: string): void {
    if (!this.debugOn) return;
    this.debugEl.textContent = lines;
  }

  toggleDebug(): boolean {
    this.debugOn = !this.debugOn;
    this.debugEl.classList.toggle('on', this.debugOn);
    return this.debugOn;
  }

  comboPulse(): void {
    this.comboEl.classList.remove('pulse');
    void this.comboEl.offsetWidth;
    this.comboEl.classList.add('pulse');
  }
}
