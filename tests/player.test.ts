/**
 * Инварианты PlayerController:
 * 1) движение СТРОГО по сфере фиксированного радиуса (6000 кадров, рандом-ввод);
 * 2) касательный базис (upRef/right) параллельно переносится: он НЕ порождает
 *    самовращение — при удержании одной оси игрок летит по большой окружности,
 *    а не закручивается в спираль (регрессия «водоворота»);
 * 3) проход через полюс без сингулярности.
 */
import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { PlayerController } from '../src/player/PlayerController';
import { WORLD, PLAYER } from '../src/constants';
import { mulberry32 } from '../src/math/rng';

const R = WORLD.ORBIT_RADIUS;

describe('PlayerController — сферическая орбита', () => {
  it('|pos| неизменно = R при 6000 кадрах случайного ввода (boost+dash)', () => {
    const pc = new PlayerController();
    const rng = mulberry32(4242);
    const pos = new Vector3();

    for (let i = 0; i < 6000; i++) {
      pc.update(1 / 60, {
        x: rng() < 0.5 ? rng() * 2 - 1 : 0,
        y: rng() < 0.5 ? rng() * 2 - 1 : 0,
        boost: rng() < 0.25,
        dash: rng() < 0.01,
      }, R, 1);
      pc.position(pos, R);
      expect(pos.length()).toBeCloseTo(R, 6);
      expect(pc.d.length()).toBeCloseTo(1, 8);
      // upRef всегда касательный и единичный
      expect(pc.upRef.dot(pc.d)).toBeCloseTo(0, 5);
      expect(pc.upRef.length()).toBeCloseTo(1, 5);
    }
  });
});

describe('PlayerController — нет самовращения (регрессия водоворота)', () => {
  it('удержание S 8 секунд: путь — дуга БОЛЬШОЙ окружности, а не спираль', () => {
    const pc = new PlayerController();
    const startDir = new Vector3(0.6, 0.2, 0.77).normalize();
    pc.resetRun(startDir);
    const pos = new Vector3();
    const unit = new Vector3();
    const prev = new Vector3();
    const normal = new Vector3();
    let normalSet = false;
    let maxOut = 0; // насколько траектория отошла от плоскости орбиты

    for (let i = 0; i < 480; i++) {
      pc.update(1 / 60, { x: 0, y: -1, boost: false, dash: false }, R, 1);
      pc.position(pos, R);
      unit.copy(pos).divideScalar(R);
      if (i > 8 && !normalSet) {
        normal.crossVectors(prev, unit);
        if (normal.lengthSq() > 1e-8) { normal.normalize(); normalSet = true; }
      }
      if (normalSet) maxOut = Math.max(maxOut, Math.abs(unit.dot(normal)));
      prev.copy(unit);
    }
    expect(normalSet).toBe(true);
    // спираль/водоворот дал бы прецессию плоскости; геодезическая остаётся в ней
    expect(maxOut).toBeLessThan(0.01);
    // дуга пройдена (не залип)
    expect(unit.dot(startDir)).toBeLessThan(0.95);
    // угловая скорость стабильна (не расходится)
    expect(pc.vel.length() / R).toBeLessThan(PLAYER.BASE_YAW_SPEED * 1.35);
  });
});

describe('PlayerController — полюса', () => {
  it('проход через северный полюс без сингулярности', () => {
    const pc = new PlayerController();
    pc.resetRun(new Vector3(0, 0.999, 0.045).normalize());
    const pos = new Vector3();
    for (let i = 0; i < 2400; i++) {
      pc.update(1 / 60, { x: 0, y: 1, boost: false, dash: false }, R, 1);
      pc.position(pos, R);
      expect(pos.length()).toBeCloseTo(R, 6);
      expect(Number.isFinite(pos.x + pos.y + pos.z)).toBe(true);
    }
    // пересёк экватор по другую сторону — значит полюс пройден, а не залип
    expect(Math.abs(pc.d.y)).toBeGreaterThan(0.2);
    expect(pc.d.y).toBeLessThan(0.9);
  });
});
