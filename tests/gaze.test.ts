/**
 * Тесты GazeSystem: трёхфазность, тайминги заряда, near-miss, урон-хит.
 */
import { describe, it, expect } from 'vitest';
import { GazeSystem, GazePhase } from '../src/game/GazeSystem';
import { HEAD } from '../src/constants';

const base = (dot: number, over = {}) => ({
  dot, awakened: true, danger: 0.3,
  beamAngle: 999, hitAngle: 0.03, grazeAngle: 0.08,
  ...over,
});

function driveToLock(g: GazeSystem) {
  // доводим до LOCK
  for (let i = 0; i < 60; i++) g.update(1 / 60, base(0.98));
}

describe('GazeSystem', () => {
  it('без пробуждения — всегда CALM', () => {
    const g = new GazeSystem();
    for (let i = 0; i < 200; i++) g.update(1 / 60, base(0.999, { awakened: false }));
    expect(g.phase).toBe(GazePhase.CALM);
  });

  it('CALM → AWARENESS при dot > порога', () => {
    const g = new GazeSystem();
    g.update(1 / 60, base(0.92));
    expect([GazePhase.AWARENESS, GazePhase.LOCK]).toContain(g.phase);
  });

  it('полный цикл до CHARGE/FIRE с корректным временем заряда', () => {
    const g = new GazeSystem();
    let chargeAt = -1;
    let fireAt = -1;
    let t = 0;
    for (let i = 0; i < 600; i++) {
      const dt = 1 / 60; t += dt;
      const r = g.update(dt, base(0.99));
      if (r.chargeStarted) chargeAt = t;
      if (r.fireStarted) fireAt = t;
      if (fireAt >= 0) break;
    }
    expect(chargeAt).toBeGreaterThan(0);
    // между стартом заряда и выстрелом — ровно BEAM_CHARGE_TIME (±квантование кадра)
    expect(fireAt - chargeAt).toBeCloseTo(HEAD.BEAM_CHARGE_TIME, 1);
  });

  it('РЕГРЕССИЯ дедлока: голова НЕ ОТВОДИТ взгляд (dot≈1) → залпы повторяются', () => {
    // Баг: выход из COOLDOWN требовал dot < awareDot; непрерывный трекинг головы
    // держал dot≈1 вечно — система залипала в COOLDOWN и больше не атаковала.
    const g = new GazeSystem();
    let fires = 0;
    for (let i = 0; i < 60 * 30; i++) {
      const r = g.update(1 / 60, base(0.995, { beamAngle: 0.01 })); // игрок «стоит на оси»
      if (r.fireStarted) fires++;
      if (fires >= 3) break;
    }
    expect(fires).toBeGreaterThanOrEqual(3);
    expect(g.visits[GazePhase.FIRE]).toBeGreaterThanOrEqual(3);
    // и между залпами есть честная пауза COOLDOWN
    expect(g.visits[GazePhase.COOLDOWN]).toBeGreaterThanOrEqual(2);
  });

  it('срыв до выстрела (escapade) прерывает CHARGE', () => {
    const g = new GazeSystem();
    driveToLock(g);
    // переводим в CHARGE
    for (let i = 0; i < 20; i++) g.update(1 / 60, base(0.99));
    expect(g.phase).toBe(GazePhase.CHARGE);
    // резкий уход из конуса
    const r = g.update(1 / 60, base(0.4));
    expect(g.phase).toBe(GazePhase.COOLDOWN);
    expect(r.fireStarted).toBeFalsy();
  });

  it('уход в последнюю долю заряда => near-miss', () => {
    const g = new GazeSystem();
    driveToLock(g);
    let gotNear = false;
    // держим почти до конца заряда, потом уходим на пороге 0.72 прогресса
    for (let i = 0; i < HEAD.BEAM_CHARGE_TIME * 60; i++) {
      const r = g.update(1 / 60, base(0.99));
      if (g.phase === GazePhase.CHARGE && g.chargeProgress > 0.75 && g.chargeProgress < 0.9) {
        const rr = g.update(1 / 60, base(0.3));
        gotNear = !!rr.nearMiss;
        break;
      }
    }
    expect(gotNear).toBe(true);
  });

  it('FIRE: hitWhen в конусе попадания', () => {
    const g = new GazeSystem();
    driveToLock(g);
    for (let i = 0; i < 200; i++) g.update(1 / 60, base(0.99, { beamAngle: 0.01 }));
    expect(g.phase).toBe(GazePhase.FIRE);
    const r = g.update(1 / 60, base(0.99, { beamAngle: 0.005 }));
    expect(r.hitThisTick).toBe(true);
  });

  it('FIRE: касательный луч даёт near-miss при срыве', () => {
    const g = new GazeSystem();
    driveToLock(g);
    // вход в FIRE с graze (угол между hit и graze)
    let fired = false;
    for (let i = 0; i < 220; i++) {
      const r = g.update(1 / 60, base(0.99, { beamAngle: 0.06 }));
      if (r.fireStarted) { fired = true; break; }
    }
    expect(fired).toBe(true);
    // держим касание, потом срываем gaze
    for (let i = 0; i < 20; i++) g.update(1 / 60, base(0.99, { beamAngle: 0.06 }));
    let gotNear = false;
    for (let i = 0; i < 20; i++) {
      const r = g.update(1 / 60, base(0.5, { beamAngle: 0.06 })); // dot просел -> срыв
      if (r.nearMiss) { gotNear = true; break; }
      if (r.fireEnded) break;
    }
    expect(gotNear).toBe(true);
  });

  it('dangerous/firing флаги', () => {
    const g = new GazeSystem();
    expect(g.dangerous).toBe(false);
    driveToLock(g);
    expect(g.dangerous).toBe(true);
  });
});
