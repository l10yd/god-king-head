/**
 * TouchControls — сенсорное управление для телефонов/планшетов.
 *
 *  — нижняя левая половина экрана: ВИРТУАЛЬНЫЙ СТИК (динамический начало —
 *    появляется там, где палец коснулся); отклонение = WASD;
 *    полное отклонение к краю (≥ BOOST_AT) = SHIFT-ускорение (тратит шкалу);
 *  — справа круглая кнопка «РЫВОК» (= ПРОБЕЛ) и маленькая «ПАУЗА» (= ESC);
 *  — зум на телефоне — две кнопки «−/+» (колесо мыши недоступно).
 *
 * Слой НЕВИДИМ и пассивен, пока (а) устройство тачевое и (б) реально
 * был хотя бы один touchstart — гибридные ноутбуки с мышью не трогаем.
 * На десктопе вклад вообще не создаётся (Game проверяет supported()).
 * Вклад в input.touch сливается с клавиатурой в InputManager.read().
 */
import type { InputManager } from '../core/Input';

const STICK_RADIUS = 62;  // px — полное отклонение
const DEAD_ZONE = 0.14;   // возврат стика в центр не считается вводом
const BOOST_AT = 0.9;     // отклонён почти в упор → «держим SHIFT»

export class TouchControls {
  static supported(): boolean {
    return (navigator.maxTouchPoints ?? 0) > 0 || matchMedia('(pointer: coarse)').matches;
  }

  private root: HTMLElement;
  private zone: HTMLElement;
  private base: HTMLElement;
  private knob: HTMLElement;
  private stickId = -1;
  private ox = 0;
  private oy = 0;
  private sawTouch = false; // гибрид: не показываем, пока не тронули экран
  private enabled = false;  // фаза PLAYING/DYING

  constructor(input: InputManager, private onPause: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'gk-touch hidden';
    this.root.innerHTML = `
      <div class="gk-stick-zone"></div>
      <div class="gk-stick-base"></div>
      <div class="gk-stick-knob"></div>
      <button class="gk-dash-btn" type="button">РЫВОК</button>
      <button class="gk-pause-btn" type="button" aria-label="пауза">‖</button>
      <button class="gk-zoom-btn zin" type="button" aria-label="приближить">＋</button>
      <button class="gk-zoom-btn zout" type="button" aria-label="отдалить">－</button>`;
    document.body.appendChild(this.root);

    this.zone = this.root.querySelector('.gk-stick-zone')!;
    this.base = this.root.querySelector('.gk-stick-base')!;
    this.knob = this.root.querySelector('.gk-stick-knob')!;
    const dash = this.root.querySelector('.gk-dash-btn')!;
    const pause = this.root.querySelector('.gk-pause-btn')!;
    const zin = this.root.querySelector('.gk-zoom-btn.zin')!;
    const zout = this.root.querySelector('.gk-zoom-btn.zout')!;

    // ---------- стик ----------
    this.zone.addEventListener('pointerdown', (e: PointerEvent) => {
      if (this.stickId !== -1) return;
      this.stickId = e.pointerId;
      this.ox = e.clientX; this.oy = e.clientY;
      this.base.style.left = `${this.ox}px`; this.base.style.top = `${this.oy}px`;
      this.knob.style.left = `${this.ox}px`; this.knob.style.top = `${this.oy}px`;
      this.base.classList.add('on'); this.knob.classList.add('on');
      try { this.zone.setPointerCapture(e.pointerId); } catch { /* синтетич. события в автотестах */ }
      e.preventDefault();
    });
    this.zone.addEventListener('pointermove', (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      let dx = e.clientX - this.ox;
      let dy = e.clientY - this.oy;
      const raw = Math.hypot(dx, dy);
      let mag = Math.min(1, raw / STICK_RADIUS);
      if (mag < DEAD_ZONE) mag = 0;
      const k = raw > 1e-6 ? (mag * STICK_RADIUS) / raw : 0;
      dx *= k; dy *= k;
      this.knob.style.left = `${this.ox + dx}px`;
      this.knob.style.top = `${this.oy + dy}px`;
      input.touch.x = dx / STICK_RADIUS;
      input.touch.y = -dy / STICK_RADIUS; // вверх экрана = «вперёд» (W)
      input.touch.boost = mag >= BOOST_AT;
      this.knob.classList.toggle('boost', input.touch.boost);
      this.base.classList.toggle('boost', input.touch.boost);
    });
    const release = (e: PointerEvent): void => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = -1;
      input.touch.x = 0; input.touch.y = 0; input.touch.boost = false;
      this.base.classList.remove('on', 'boost');
      this.knob.classList.remove('on', 'boost');
    };
    this.zone.addEventListener('pointerup', release);
    this.zone.addEventListener('pointercancel', release);

    // ---------- кнопки ----------
    dash.addEventListener('pointerdown', (e) => { e.preventDefault(); input.queueDash(); });
    pause.addEventListener('pointerdown', (e) => { e.preventDefault(); this.onPause(); });
    // зум «пальцем»: кнопки вместо колеса (шаг = 3 «щелчка» колеса)
    zin.addEventListener('pointerdown', (e) => { e.preventDefault(); input.nudgeZoom(-3); });
    zout.addEventListener('pointerdown', (e) => { e.preventDefault(); input.nudgeZoom(3); });

    // гибридные устройства: слой оживает только после первого касания экрана
    window.addEventListener('touchstart', () => {
      if (this.sawTouch) return;
      this.sawTouch = true;
      this.apply();
    }, { passive: true, once: true });
  }

  /** фаза PLAYING/DYING — показывать; остальное время прятать */
  setVisible(v: boolean): void {
    if (this.enabled === v) return;
    this.enabled = v;
    this.apply();
  }

  private apply(): void {
    // слой виден только в активной фазе И после первого реального касания
    // (на гибриде «мышь+тач» игрок с мышью его никогда не увидит)
    const show = this.enabled && this.sawTouch;
    this.root.classList.toggle('hidden', !show);
    if (!show && this.stickId !== -1) {
      // палец мог остаться на стике при смене фазы — сбрасываем ввод
      this.stickId = -1;
      this.base.classList.remove('on', 'boost');
      this.knob.classList.remove('on', 'boost');
    }
  }

  /** QA-хук: есть ли слой (для smoke) */
  get visible(): boolean { return !this.root.classList.contains('hidden'); }
}
