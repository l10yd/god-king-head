/**
 * Математика сферы: игрок и сущности живут на поверхности сферы радиуса R
 * вокруг центра головы. Никакого свободного полёта — позиция всегда
 * перепроецируется на орбиту, поэтому «улететь» невозможно.
 *
 * Координаты: theta — азимут (вращение вокруг оси Y),
 *             phi — широта от +Y (0 = северный полюс, PI = южный).
 */
import { Vector3 } from 'three';

export interface OrbitState {
  theta: number;
  phi: number;
}

export const clampPhi = (phi: number) => Math.min(Math.PI - 0.02, Math.max(0.02, phi));

export const wrapTheta = (theta: number) => {
  const TAU = Math.PI * 2;
  let t = theta % TAU;
  if (t < 0) t += TAU;
  return t;
};

/** Позиция на сфере радиуса r с центром center */
export function orbitPosition(state: OrbitState, radius: number, out: Vector3, center?: Vector3): Vector3 {
  const sinPhi = Math.sin(state.phi);
  out.set(
    sinPhi * Math.sin(state.theta),
    Math.cos(state.phi),
    sinPhi * Math.cos(state.theta),
  );
  out.multiplyScalar(radius);
  if (center) out.add(center);
  return out;
}

/** Единичный радиальный вектор (нормаль сферы) */
export function orbitNormal(state: OrbitState, out: Vector3): Vector3 {
  const sinPhi = Math.sin(state.phi);
  return out.set(sinPhi * Math.sin(state.theta), Math.cos(state.phi), sinPhi * Math.cos(state.theta));
}

/**
 * Касательный базис на сфере: east (рост theta) и north (уменьшение phi).
  * На полюсах east вырождается — берём безопасный fallback, чтобы
 * управление не «ломалось» при пересечении полюса.
 */
export function orbitBasis(state: OrbitState, east: Vector3, north: Vector3): void {
  const sinPhi = Math.sin(state.phi);
  north.set(
    Math.cos(state.phi) * Math.sin(state.theta),
    -Math.sin(state.phi),
    Math.cos(state.phi) * Math.cos(state.theta),
  );
  if (north.lengthSq() < 1e-8) north.set(0, 0, 1);
  north.normalize();
  // d/dtheta
  east.set(Math.cos(state.theta), 0, -Math.sin(state.theta));
  if (sinPhi < 1e-4) {
    // на полюсе east строим перпендикулярно north в плоскости XZ
    east.set(-north.z, 0, north.x);
  }
  east.normalize();
}

/**
 * Перемещение состояния на сфере по «скоростям» dTheta/dPhi.
 * phi ограничен полюсами (с мягким демпфированием у краёв).
 */
export function orbitAdvance(state: OrbitState, dTheta: number, dPhi: number): void {
  state.theta = wrapTheta(state.theta + dTheta);
  state.phi = clampPhi(state.phi + dPhi);
}

/** Угловое расстояние между двумя точками сферы (рад) — для near-miss и спавна */
export function orbitAngularDistance(a: OrbitState, b: OrbitState): number {
  const va = Math.sin(a.phi) * Math.sin(b.phi) * Math.cos(a.theta - b.theta) + Math.cos(a.phi) * Math.cos(b.phi);
  return Math.acos(Math.min(1, Math.max(-1, va)));
}

/** Случайная точка на сфере от rng */
export function orbitRandom(rng: () => number): OrbitState {
  return {
    theta: rng() * Math.PI * 2,
    phi: Math.acos(1 - 2 * rng()),
  };
}
