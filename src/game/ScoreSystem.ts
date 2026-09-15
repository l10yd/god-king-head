/**
 * Score + Combo. Комбо-множитель 1x..5x растёт за серии синих душ,
 * сбрасывается при получении урона. Все начисления идут через систему,
 * чтобы UI и логика не размывались по файлам.
 */
import { SCORE } from '../constants';

export interface FloaterRequest {
  text: string;
  kind: 'score' | 'heal' | 'danger' | 'gold' | 'info';
  worldPos?: { x: number; y: number; z: number };
}

export class ScoreSystem {
  score = 0;
  best = 0;
  mult = 1;
  comboCount = 0;
  comboTimer = 0;
  /** Всплывающие тексты для UI-слоя */
  floaters: FloaterRequest[] = [];

  loadBest(stored: number | null): void {
    this.best = stored ?? 0;
  }

  resetRun(): void {
    this.score = 0;
    this.mult = 1;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.floaters.length = 0;
  }

  private add(n: number): number {
    this.score = Math.max(0, this.score + n);
    if (this.score > this.best) this.best = this.score;
    return this.score;
  }

  blueCollected(large: boolean, gold: boolean): number {
    const base = gold ? SCORE.GOLD : large ? SCORE.BLUE_LARGE : SCORE.BLUE;
    const gained = base * this.mult;
    this.add(gained);
    this.comboCount++;
    this.comboTimer = SCORE.COMBO_WINDOW;
    const prevMult = this.mult;
    this.mult = Math.min(SCORE.COMBO_MAX, 1 + Math.floor(this.comboCount / 4));
    return gained;
  }

  /** Возвращает true, если множитель вырос (для UI-пульса) */
  comboStep(grew: boolean): boolean {
    return grew;
  }

  greenCollected(base: number): number {
    const gained = Math.round(base * this.mult);
    this.add(gained);
    return gained;
  }

  survivalTick(): void {
    this.add(SCORE.SURVIVAL_PER_SEC);
  }

  nearMiss(): number {
    this.add(SCORE.NEAR_MISS);
    return SCORE.NEAR_MISS;
  }

  gazeEscape(): number {
    this.add(SCORE.GAZE_ESCAPE);
    return SCORE.GAZE_ESCAPE;
  }

  spiritScore(): number {
    this.add(SCORE.SPIRIT_TOUCH);
    return SCORE.SPIRIT_TOUCH;
  }

  /** Бонус за духов, испепелённых золотой волной (не трогает комбо) */
  purgedSpirits(count: number): number {
    const gained = SCORE.SPIRIT_PURGED * count;
    this.add(gained);
    return gained;
  }

  /** Дух сожжён лучом головы — фиксированный бонус (не через комбо) */
  spiritBurned(): number {
    this.add(SCORE.SPIRIT_BURNED);
    return SCORE.SPIRIT_BURNED;
  }

  damageTaken(): void {
    if (this.mult > 1 || this.comboCount > 0) {
      this.mult = 1;
      this.comboCount = 0;
      this.comboTimer = 0;
    }
  }

  update(dt: number): boolean /* comboReset */ {
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0 && this.mult > 1) {
        this.mult = 1;
        this.comboCount = 0;
        return true;
      }
    }
    return false;
  }

  /** Формат «12 450» с узким неразрывным пробелом */
  static format(n: number): string {
    return Math.floor(n)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009');
  }
}
