/**
 * Здоровье игрока. Смерть детектируется здесь, остальное — подписчики.
 */
import { PLAYER } from '../constants';

export class HealthSystem {
  hp: number = PLAYER.MAX_HP;
  max: number = PLAYER.MAX_HP;
  dead = false;

  resetRun(): void {
    this.hp = this.max;
    this.dead = false;
  }

  /** @returns фактический нанесённый урон */
  damage(amount: number): number {
    if (this.dead) return 0;
    const before = this.hp;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) this.dead = true;
    return before - this.hp;
  }

  /** @returns фактическое лечение */
  heal(amount: number): number {
    if (this.dead) return 0;
    const before = this.hp;
    this.hp = Math.min(this.max, this.hp + amount);
    return this.hp - before;
  }

  get ratio(): number {
    return this.hp / this.max;
  }
}
