/**
 * Тесты детерминированного RNG и score/combo логики.
 */
import { describe, it, expect } from 'vitest';
import { mulberry32, hashSeed, seedLabel, range, pick } from '../src/math/rng';
import { ScoreSystem } from '../src/game/ScoreSystem';
import { HealthSystem } from '../src/game/HealthSystem';
import { StateMachine } from '../src/core/StateMachine';

describe('RNG', () => {
  it('одинаковый сид → одинаковая последовательность', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('разные сиды → разные последовательности', () => {
    const a = mulberry32(1); const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  it('диапазон 0..1 и равномерность (грубо)', () => {
    const r = mulberry32(999);
    let lo = 0, hi = 0;
    for (let i = 0; i < 10000; i++) { const v = r(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); if (v < 0.5) lo++; else hi++; }
    expect(Math.abs(lo - hi)).toBeLessThan(500);
  });

  it('hashSeed строки стабилен, seedLabel читаем', () => {
    expect(hashSeed('god')).toBe(hashSeed('god'));
    expect(seedLabel(hashSeed('x')).length).toBeLessThanOrEqual(7);
  });

  it('range/pick работают по rng', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 50; i++) { const v = range(r, -3, 5); expect(v).toBeGreaterThanOrEqual(-3); expect(v).toBeLessThan(5); }
    const arr = [1, 2, 3, 4];
    expect(arr).toContain(pick(r, arr));
  });
});

describe('ScoreSystem / Combo', () => {
  it('комбо повышает множитель до 5x и сбрасывается уроном', () => {
    const s = new ScoreSystem();
    s.resetRun();
    const mults: number[] = [];
    for (let i = 0; i < 30; i++) { s.blueCollected(false, false); mults.push(s.mult); }
    expect(s.mult).toBe(5);
    expect(mults[0]).toBe(1);
    s.damageTaken();
    expect(s.mult).toBe(1);
    expect(s.comboCount).toBe(0);
  });

  it('крупная душа дороже; очки растут, best обновляется', () => {
    const s = new ScoreSystem(); s.resetRun();
    const small = s.blueCollected(false, false);
    s.resetRun();
    const big = s.blueCollected(true, false);
    expect(big).toBeGreaterThan(small);
    expect(s.best).toBeGreaterThanOrEqual(big);
  });

  it('окно комбо: простой > COMBO_WINDOW сбрасывает множитель', () => {
    const s = new ScoreSystem(); s.resetRun();
    for (let i = 0; i < 4; i++) s.blueCollected(false, false);
    expect(s.mult).toBe(2);
    let reset = false;
    for (let i = 0; i < 100; i++) reset = s.update(0.1) || reset;
    expect(reset).toBe(true);
    expect(s.mult).toBe(1);
  });

  it('near miss/escape добавляют очки, дух снимает но не ниже 0', () => {
    const s = new ScoreSystem(); s.resetRun();
    s.nearMiss(); s.gazeEscape();
    expect(s.score).toBeGreaterThanOrEqual(150);
    for (let i = 0; i < 100; i++) s.spiritScore();
    expect(s.score).toBe(0);
  });

  it('формат числа с разделителем', () => {
    expect(ScoreSystem.format(12450).replace(/\D/g, '')).toBe('12450');
    expect(ScoreSystem.format(12450)).toContain('450');
  });
});

describe('HealthSystem', () => {
  it('лечение не превышает максимум, урон не ниже 0, dead по нулям', () => {
    const h = new HealthSystem(); h.resetRun();
    expect(h.heal(50)).toBe(0); // уже полный
    h.damage(30);
    expect(h.hp).toBeCloseTo(70);
    expect(h.heal(5)).toBe(5);
    expect(h.hp).toBeLessThanOrEqual(h.max);
    h.damage(1000);
    expect(h.hp).toBe(0);
    expect(h.dead).toBe(true);
  });
});

describe('StateMachine', () => {
  it('разрешённые/запрещённые переходы', () => {
    const m = new StateMachine<'A' | 'B' | 'C'>('A', { A: ['B'], B: ['A', 'C'], C: [] });
    expect(m.to('B')).toBe(true);
    expect(m.current).toBe('B');
    expect(m.to('C')).toBe(true);
    expect(m.current).toBe('C');
    expect(m.to('A')).toBe(false); // из C нет переходов
    expect(m.current).toBe('C');
    expect(m.is('C')).toBe(true);
  });
});
