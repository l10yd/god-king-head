/**
 * HeadTracking — чистая логика поворота головы к игроку.
 *
 * Голова «смотрит» по локальному +Z. Целевая ориентация — кватернион,
 * ставящий +Z по направлению на игрока с корректным up (без gimbal на полюсах).
 * Поворот — slerp с ограниченной угловой скоростью (rad/s) из Difficulty.
 *
 * Покрывается юнит-тестами: сходимость, верхний/нижний полюс, задняя полусфера.
 */
import { Quaternion, Vector3, Matrix4 } from 'three';
import { slerpAtRate } from '../math/Tracking';

const _dir = /* @__PURE__ */ new Vector3();
const _targetQ = /* @__PURE__ */ new Quaternion();
const _fwd = /* @__PURE__ */ new Vector3();
const _mm = /* @__PURE__ */ new Matrix4();
const UP = /* @__PURE__ */ new Vector3(0, 1, 0);
const ALT_UP = /* @__PURE__ */ new Vector3(0, 0, -1);

/**
 * Кватернион, при котором ЛОКАЛЬНЫЙ +Z объекта из начала координат
 * смотрит на точку playerPos. Safe-версия up-вектора для полюсов.
 */
export function faceForwardQuaternion(playerPos: Vector3, out: Quaternion): Quaternion {
  _dir.copy(playerPos);
  if (_dir.lengthSq() < 1e-12) return out.identity();
  _dir.normalize();
  const up = Math.abs(_dir.y) > 0.9985 ? ALT_UP : UP;
  // Matrix4.lookAt ставит -Z на цель; подаём -target => +Z смотрит на цель
  _fwd.set(0, 0, 0);
  _dir.negate();
  _mm.lookAt(_fwd, _dir, up);
  _dir.negate(); // восстановить (модульный temp переиспользуется)
  return out.setFromRotationMatrix(_mm);
}

export class HeadTracker {
  readonly q = new Quaternion();
  /** dot(+Z_head, dirToPlayer) — главная метрика gaze */
  gazeDot = -1;
  /** сколько rad/s голова реально повернулась за последний кадр */
  angularSpeed = 0;
  /** нормированное «отставание» головы (0 = смотрит точно, 1 = не смотрит) */
  lag01 = 1;

  reset(): void {
    this.q.identity();
    this.gazeDot = -1;
    this.angularSpeed = 0;
    this.lag01 = 1;
  }

  /**
   * @param dt сек
   * @param playerPos позиция игрока ОТНОСИТЕЛЬНО центра головы
   * @param rate rad/s — текущая скорость поворота (из Difficulty)
   */
  update(dt: number, playerPos: Vector3, rate: number): void {
    faceForwardQuaternion(playerPos, _targetQ);
    const angleBefore = this.q.angleTo(_targetQ);
    const remaining = slerpAtRate(this.q, _targetQ, rate, dt);
    this.angularSpeed = Math.max(0, (angleBefore - remaining) / Math.max(1e-6, dt));
    _dir.copy(playerPos).normalize();
    _fwd.set(0, 0, 1).applyQuaternion(this.q);
    this.gazeDot = _fwd.dot(_dir);
    this.lag01 = 1 - (this.gazeDot + 1) * 0.5;
  }

  /** Локальная +Z головы в мировых координатах (для лучей) */
  forward(out: Vector3): Vector3 {
    return out.set(0, 0, 1).applyQuaternion(this.q);
  }
}
