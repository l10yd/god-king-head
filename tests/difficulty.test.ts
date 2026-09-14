/**
 * Тесты кривой сложности: монотонность, границы, корректность danger-формулы.
 */
import { describe, it, expect } from 'vitest';
import {
  dangerScore, headTrackSpeed, eyeTrackSpeed, beamDamage, beamTurnSpeed,
  targetPopulation, redSpeed, redChaseChance, lockDotThreshold,
} from '../src/game/Difficulty';
import { HEAD, DIFFICULTY, PLAYER } from '../src/constants';

describe('Difficulty', () => {
  it('dangerScore растёт с временем и с числом духов; 0..1', () => {
    expect(dangerScore(0, 0)).toBeCloseTo(0, 3);
    expect(dangerScore(60, 0)).toBeGreaterThan(dangerScore(10, 0));
    expect(dangerScore(0, 8)).toBeGreaterThan(dangerScore(0, 1));
    expect(dangerScore(9999, 999)).toBeLessThanOrEqual(1);
    expect(dangerScore(9999, 999)).toBeGreaterThan(0.9);
  });

  it('headTrackSpeed монотонна и ограничена максимумом', () => {
    let prev = -1;
    for (let d = 0; d <= 1.0001; d += 0.05) {
      const v = headTrackSpeed(d);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(v).toBeLessThanOrEqual(HEAD.TRACK_SPEED_MAX + 1e-6);
      prev = v;
    }
    expect(headTrackSpeed(1)).toBeCloseTo(HEAD.TRACK_SPEED_MAX, 2);
    // потолок трекинга головы НИЖЕ скорости дэша игрока (0.14*2.4=0.336) —
    // иначе из-под взгляда нельзя вырваться в принципе
    expect(headTrackSpeed(1)).toBeLessThan(PLAYER.BASE_YAW_SPEED * 2.4);
  });

  it('луч обгоняется игроком: beamTurnSpeed < скорости побега', () => {
    // угловые скорости игрока: ход 0.14, буст ×1.9, дэш ×2.4 (рад/с при любой R)
    const walk = PLAYER.BASE_YAW_SPEED;
    const dash = walk * 2.4;
    expect(beamTurnSpeed(0)).toBeLessThan(walk);   // рано — убегаешь ХОДОМ
    expect(beamTurnSpeed(1)).toBeLessThan(dash);   // пик — спасают буст/рывок
  });

  it('все производные сложности неубывающи и в границах', () => {
    const checkers: Array<[string, (d: number) => number, number]> = [
      ['eye', eyeTrackSpeed, HEAD.EYE_TRACK_MAX],
      ['beamDmg', beamDamage, HEAD.BEAM_DAMAGE_MAX],
      ['turn', beamTurnSpeed, 5],
      ['redSpeed', redSpeed, DIFFICULTY.RED_SPEED_MAX],
    ];
    for (const [, fn, cap] of checkers) {
      let prev = -Infinity;
      for (let d = 0; d <= 1; d += 0.1) {
        const v = fn(d);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
        expect(v).toBeLessThanOrEqual(cap + 1e-6);
        prev = v;
      }
    }
    expect(redChaseChance(0)).toBeCloseTo(0);
    expect(redChaseChance(1)).toBeLessThanOrEqual(1);
  });

  it('targetPopulation: монотонный рост по фазам', () => {
    let prev = { blue: 0, green: 0, red: 0 };
    for (const t of [0, 30, 60, 90, 120, 180, 260, 400, 600]) {
      const p = targetPopulation(t);
      expect(p.blue).toBeGreaterThanOrEqual(prev.blue);
      expect(p.red).toBeGreaterThanOrEqual(prev.red);
      expect(p.blue).toBeLessThanOrEqual(DIFFICULTY.MAX_BLUE);
      expect(p.red).toBeLessThanOrEqual(DIFFICULTY.MAX_RED);
      prev = p;
    }
    // старт не нулевой и не «экстрим»
    const s = targetPopulation(0);
    expect(s.blue).toBeGreaterThanOrEqual(10);
    expect(s.red).toBeLessThanOrEqual(6);
  });

  it('lockDot сужается с danger (late game жестче)', () => {
    expect(lockDotThreshold(1)).toBeLessThan(lockDotThreshold(0));
  });
});
