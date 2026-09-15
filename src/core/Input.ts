/**
 * Input — клавиатура + колесо мыши (ТОЛЬКО зум) + gamepad + сенсорный стик.
 * Мышью-обзором НЕ управляем: free-look конфликтовал с базисом движения.
 * TouchControls пишет в `touch` (непрерывный вклад) и `dashQueued/wheelAcc`
 * через queueDash()/nudgeZoom() — всё сливается в read() с клавиатурой.
 */
import { clamp } from '../math/Tracking';

export interface InputFrame {
  x: number;        // -1..1 (A/D)
  y: number;        // -1..1 (W/S)
  boost: boolean;   // SHIFT (или стик, отклонённый до упора)
  dashEdge: boolean;// SPACE — срабатывает один раз на нажатие
  zoomStep: number; // колесо: +1/-1 на щелчок (кумулятивно за кадр)
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class InputManager {
  private keys = new Set<string>();
  private dashQueued = false;
  private wheelAcc = 0;
  /** непрерывный вклад сенсорного стика (TouchControls) */
  readonly touch = { x: 0, y: 0, boost: false };
  /** эксклюзивные действия (пауза и т.п.) — подписки */
  onAction: (a: 'pause' | 'help' | 'debug' | 'mute' | 'restart' | 'start') => void = () => {};

  /** рывок с сенсорной кнопки (эквивалент нажатия SPACE) */
  queueDash(): void { this.dashQueued = true; }
  /** зум кнопками ±: v в «щелчках колеса» (+ = отдалить) */
  nudgeZoom(v: number): void { this.wheelAcc += v; }

  attach(_el: HTMLElement): void {
    window.addEventListener('keydown', this.kd);
    window.addEventListener('keyup', this.ku);
    window.addEventListener('blur', this.blur);
    window.addEventListener('wheel', this.wh, { passive: true });
  }

  detach(): void {
    window.removeEventListener('keydown', this.kd);
    window.removeEventListener('keyup', this.ku);
    window.removeEventListener('blur', this.blur);
    window.removeEventListener('wheel', this.wh);
  }

  private blur = () => this.keys.clear();

  /** колесо — только зум: вниз от себя (+), на себя (−); пропорционально углу */
  private wh = (e: WheelEvent): void => {
    // deltaMode: 0=пиксели (~100/щелчок), 1=строки, 2=страницы
    const unit = e.deltaMode === 1 ? 3 : e.deltaMode === 2 ? 30 : 1;
    this.wheelAcc += (e.deltaY * unit) / 100;
  };

  private kd = (e: KeyboardEvent): void => {
    const c = e.code;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(c)) e.preventDefault();
    if (c === 'Space' && !this.keys.has('Space')) this.dashQueued = true;
    this.keys.add(c);
    if (c === 'Escape' || c === 'KeyP') this.onAction('pause');
    if (c === 'KeyH') this.onAction('help');
    if (c === 'F3') { e.preventDefault(); this.onAction('debug'); }
    if (c === 'KeyM') this.onAction('mute');
    if (c === 'Enter') this.onAction('start');
    if (c === 'KeyR' && (e.ctrlKey || e.metaKey)) return;
    if (c === 'KeyR') this.onAction('restart');
  };

  private ku = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private axis(codeNeg: string, codePos: string): number {
    let v = 0;
    if (this.keys.has(codeNeg)) v -= 1;
    if (this.keys.has(codePos)) v += 1;
    return v;
  }

  read(): InputFrame {
    let x = this.axis('KeyA', 'KeyD') + this.axis('ArrowLeft', 'ArrowRight');
    let y = this.axis('KeyS', 'KeyW') + this.axis('ArrowDown', 'ArrowUp');
    let boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    // сенсорный стик — добавляем к клавиатуре (климпим, чтобы не >1)
    if (this.touch.x !== 0 || this.touch.y !== 0) {
      x = clamp(x + this.touch.x, -1, 1);
      y = clamp(y + this.touch.y, -1, 1);
    }
    if (this.touch.boost) boost = true;
    // gamepad (если есть — добавляем, не перезаписываем)
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) {
      if (!p) continue;
      const [lx, ly] = [p.axes[0] ?? 0, p.axes[1] ?? 0];
      if (Math.abs(lx) > 0.15) x = clamp(x + lx, -1, 1);
      if (Math.abs(ly) > 0.15) y = clamp(y - ly, -1, 1);
      if ((p.buttons[7]?.value ?? 0) > 0.4) boost = true;
      if (p.buttons[0]?.pressed) this.dashQueued = true;
      break;
    }
    const frame: InputFrame = {
      x, y, boost, dashEdge: this.dashQueued,
      zoomStep: Math.max(-5, Math.min(5, this.wheelAcc)),
    };
    this.dashQueued = false;
    this.wheelAcc = 0;
    return frame;
  }
}

export { clamp01 };
