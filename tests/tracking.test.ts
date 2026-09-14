/**
 * Тесты quaternion-трекинга головы: сходимость, полюса, тыл, rate-limit.
 */
import { describe, it, expect } from 'vitest';
import { Vector3, Quaternion } from 'three';
import { HeadTracker, faceForwardQuaternion } from '../src/head/HeadTracking';
import { slerpAtRate, damp } from '../src/math/Tracking';

const RATE = 0.8;

describe('HeadTracking', () => {
  it('+Z лица сходится к направлению на игрока', () => {
    const t = new HeadTracker();
    const p = new Vector3(100, 40, 220);
    for (let i = 0; i < 400; i++) t.update(1 / 60, p, RATE);
    const fwd = new Vector3(0, 0, 1).applyQuaternion(t.q);
    const dir = p.clone().normalize();
    expect(fwd.dot(dir)).toBeGreaterThan(0.999);
    expect(t.gazeDot).toBeGreaterThan(0.999);
  });

  it('верхний полюс (игрок прямо над головой) корректен', () => {
    const t = new HeadTracker();
    const p = new Vector3(0.5, 330, 0.5);
    for (let i = 0; i < 600; i++) t.update(1 / 60, p, RATE);
    const fwd = new Vector3(0, 0, 1).applyQuaternion(t.q);
    expect(fwd.dot(p.clone().normalize())).toBeGreaterThan(0.98);
  });

  it('нижний полюс (игрок под головой) корректен', () => {
    const t = new HeadTracker();
    const p = new Vector3(0.5, -330, 0.5);
    for (let i = 0; i < 600; i++) t.update(1 / 60, p, RATE);
    const fwd = new Vector3(0, 0, 1).applyQuaternion(t.q);
    expect(fwd.dot(p.clone().normalize())).toBeGreaterThan(0.98);
  });

  it('пересесть с орбиты: gazeDot падает и потом восстанавливается', () => {
    const t = new HeadTracker();
    const front = new Vector3(0, 0, 330);
    for (let i = 0; i < 300; i++) t.update(1 / 60, front, RATE);
    expect(t.gazeDot).toBeGreaterThan(0.99);
    // мгновенный телепорт игрока на другую сторону (как рывок) — голова отстаёт
    for (let i = 0; i < 3; i++) t.update(1 / 60, new Vector3(330, 0, 0), RATE);
    expect(t.gazeDot).toBeLessThan(0.99);
    // и догоняет со временем
    for (let i = 0; i < 400; i++) t.update(1 / 60, new Vector3(330, 0, 0), RATE);
    expect(t.gazeDot).toBeGreaterThan(0.999);
  });

  it('slerpAtRate ограничен углом за кадр (rate*dt)', () => {
    const cur = faceForwardQuaternion(new Vector3(0, 0, 1), new Quaternion());
    const tgt = faceForwardQuaternion(new Vector3(1, 0, 0), new Quaternion());
    const total = cur.angleTo(tgt);
    const remain = slerpAtRate(cur, tgt, 1.0, 0.1);
    expect(remain).toBeCloseTo(total - 0.1, 4);
    expect(cur.angleTo(tgt)).toBeCloseTo(remain, 6);
  });

  it('damp сходится и почти не зависит от шага кадра', () => {
    let x = 0;
    for (let i = 0; i < 300; i++) x = damp(x, 10, 5, 1 / 60);
    let y = 0;
    for (let i = 0; i < 150; i++) y = damp(y, 10, 5, 1 / 30);
    expect(x).toBeGreaterThan(9.9);
    expect(Math.abs(x - y)).toBeLessThan(0.05);
  });
});
