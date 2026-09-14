/**
 * Пробуждение головы — скриптованный по таймингу cinematic (процедурно).
 * Чистая логика: таймлайн 0..1 с кривыми для век, свечения, вибрации.
 *
 * Этапы:
 *  [0.00–0.18] лёгкая вибрация век, тусклое свечение ПОД веками
 *  [0.18–0.45] веки чуть приоткрываются, свечение растёт
 *  [0.45–0.85] медленное раскрытие глаз
 *  [0.85–1.00] глаза открыты полностью, взгляд пустой, потом ищет игрока
 */
import { HEAD } from '../constants';
import { clamp01, smoothstep } from '../math/Tracking';

export class Awakening {
  active = false;
  /** 0..1 общий прогресс */
  progress = 0;
  finished = false;

  reset(): void {
    this.active = false;
    this.progress = 0;
    this.finished = false;
  }

  start(): void {
    if (this.active || this.finished) return;
    this.active = true;
    this.progress = 0;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.progress = clamp01(this.progress + dt / HEAD.AWAKENING_DURATION);
    if (this.progress >= 1) {
      this.active = false;
      this.finished = true;
    }
  }

  get eyesOpen(): boolean {
    return this.finished;
  }

  /** Открытость век 0..1 (нелинейная, «тяжёлая») */
  get lidOpen(): number {
    const p = this.progress;
    const creep = smoothstep(0.18, 0.45, p) * 0.14; // едва приоткрылись
    const open = smoothstep(0.45, 0.88, p) * 0.86; // основное раскрытие
    // лёгкий overshoot: веко «доворачивается» с инерцией
    return clamp01(creep + open + Math.sin(p * Math.PI) * 0.02);
  }

  /** Свечение ПОД веками / из глазниц 0..1 */
  get glow(): number {
    const p = this.progress;
    return smoothstep(0.0, 0.5, p) * 0.55 + smoothstep(0.4, 1, p) * 0.45;
  }

  /** Вибрация век 0..1 */
  get tremor(): number {
    const p = this.progress;
    return smoothstep(0.02, 0.16, p) * (1 - smoothstep(0.6, 0.95, p));
  }

  /** Готово ли пробуждение (глаза полностью открыты) */
  get complete(): boolean {
    return this.finished;
  }
}
