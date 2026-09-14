/**
 * Плавный quaternion-based трекинг поворота головы.
 * Никаких Euler-хаков — корректно работает на полюсах (игрок сверху/снизу).
 */
import { Quaternion, Vector3, Matrix4 } from 'three';

const _m = /* @__PURE__ */ new Matrix4();
const _up = /* @__PURE__ */ new Vector3();
const _target = /* @__PURE__ */ new Vector3();
const _origin = /* @__PURE__ */ new Vector3();
const ALT_UP = /* @__PURE__ */ new Vector3(0, 0, -1);

/**
 * Ориентация объекта в центре, «смотрящего» по -Z (как камера three),
 * на цель target (в мировых координатах). Возвращает quaternion.
 * Safe-версия: при вертикальном направлении (взгляд точно вверх/вниз)
 * подменяет up-вектор, чтобы не было gimbal-проблем.
 */
export function lookRotation(from: Vector3, to: Vector3, out: Quaternion): Quaternion {
  _target.subVectors(to, from);
  if (_target.lengthSq() < 1e-9) return out.identity();
  _target.normalize();
  // up = +Y, кроме случая когда target почти вертикальный
  _up.set(0, 1, 0);
  if (Math.abs(_target.y) > 0.999) _up.copy(ALT_UP);
  _origin.set(0, 0, 0);
  _target.negate(); // lookAt смотрит по -Z
  _m.lookAt(_origin, _target, _up);
  _target.negate();
  out.setFromRotationMatrix(_m);
  return out;
}

/**
 * Сферическая интерполяция с постоянной угловой скоростью (rad/s).
 * head.quaternion "догоняет" target, но не быстрее maxAngle за шаг dt.
 * Возвращает оставшийся угол (0 = достигли).
 */
export function slerpAtRate(current: Quaternion, target: Quaternion, rate: number, dt: number): number {
  if (current.angleTo(target) < 1e-5) {
    current.copy(target);
    return 0;
  }
  const angle = current.angleTo(target);
  const step = Math.min(1, (rate * dt) / angle);
  current.slerp(target, step);
  return angle * (1 - step);
}

/**
 * Экспоненциальное сглаживание (frame-rate independent).
 */
export const damp = (current: number, target: number, smoothing: number, dt: number): number =>
  target + (current - target) * Math.exp(-smoothing * dt);

/** Мягкий clamp 0..1 */
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Плавная ступенька Hermite на [edge0, edge1] */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
