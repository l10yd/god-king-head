/**
 * Юнит-тесты орбитальной математики.
 */
import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import {
  orbitPosition, orbitBasis, orbitNormal, orbitAdvance, orbitAngularDistance, clampPhi, wrapTheta,
} from '../src/math/Orbit';

describe('Orbit', () => {
  it('orbitPosition: экватор/полюса', () => {
    const out = new Vector3();
    orbitPosition({ theta: 0, phi: Math.PI / 2 }, 100, out);
    expect(out.x).toBeCloseTo(0);
    expect(out.y).toBeCloseTo(0);
    expect(out.z).toBeCloseTo(100);

    orbitPosition({ theta: 0, phi: 0 }, 100, out);
    expect(out.y).toBeCloseTo(100);
    expect(out.length()).toBeCloseTo(100, 3);
  });

  it('orbitPosition: радиус постоянен при любом theta/phi', () => {
    const out = new Vector3();
    for (let i = 0; i < 50; i++) {
      const s = { theta: (i * 0.7) % (Math.PI * 2), phi: 0.02 + (i % 28) * 0.1 };
      orbitPosition(s, 330, out);
      expect(out.length()).toBeCloseTo(330, 1);
    }
  });

  it('orbitBasis: ортонормированность и перпендикулярность нормали (включая полюса)', () => {
    const e = new Vector3();
    const n = new Vector3();
    const nn = new Vector3();
    for (const phi of [0.021, 0.1, Math.PI / 2, Math.PI - 0.1, Math.PI - 0.021]) {
      const st = { theta: 1.3, phi };
      orbitNormal(st, nn);
      orbitBasis(st, e, n);
      expect(e.dot(n)).toBeLessThan(1e-3);
      expect(e.dot(nn)).toBeLessThan(1e-3);
      expect(n.dot(nn)).toBeLessThan(1e-3);
      expect(e.length()).toBeCloseTo(1, 5);
      expect(n.length()).toBeCloseTo(1, 5);
    }
  });

  it('orbitAdvance: wrap theta, clamp phi (полюса не ломают движение)', () => {
    const s = { theta: Math.PI * 1.9, phi: 0.05 };
    for (let i = 0; i < 50; i++) orbitAdvance(s, 0.2, 0.2);
    expect(s.theta).toBeGreaterThanOrEqual(0);
    expect(s.theta).toBeLessThan(Math.PI * 2);
    expect(s.phi).toBeGreaterThanOrEqual(0.02);
    expect(s.phi).toBeLessThanOrEqual(Math.PI - 0.02);
  });

  it('orbitAngularDistance: себя=0, противоположность=PI, монотонность', () => {
    const a = { theta: 0.5, phi: 1.2 };
    expect(orbitAngularDistance(a, a)).toBeCloseTo(0, 5);
    const antipode = { theta: 0.5 + Math.PI, phi: Math.PI - 1.2 };
    expect(orbitAngularDistance(a, antipode)).toBeCloseTo(Math.PI, 2);
    const near = { theta: 0.5, phi: 1.3 };
    const far = { theta: 0.5, phi: 2.0 };
    expect(orbitAngularDistance(a, near)).toBeLessThan(orbitAngularDistance(a, far));
  });

  it('wrapTheta/clampPhi границы', () => {
    expect(wrapTheta(-Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapTheta(Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(clampPhi(-1)).toBeGreaterThanOrEqual(0.02);
    expect(clampPhi(99)).toBeLessThanOrEqual(Math.PI - 0.02);
  });
});
