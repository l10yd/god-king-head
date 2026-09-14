/**
 * PlayerController — полёт «по поверхности невидимой сферы».
 *
 * Храним единичный радиальный вектор d и касательную скорость vel (м/с).
 * Интегрирование: d ← normalize(d + vel/R * dt) — позиция ВСЕГДА на сфере,
 * улететь невозможно, полюса не являются особыми точками.
 *
 * КАСАТЕЛЬНЫЙ БАЗИС (up/right) живёт ЗДЕСЬ и переносится параллельно
 * вдоль траектории (минимальный поворот, без производных от камеры).
 * Раньше базис брали из quaternion камеры → камера тянулась к голове,
 * базис поворачивался, тяга поворачивалась за ним — петля обратной связи
 * давала «вечный вираж» при удержании S. Теперь обратной связи нет.
 */
import { Vector3 } from 'three';
import { PLAYER } from '../constants';
import { damp } from '../math/Tracking';
import type { OrbitState } from '../math/Orbit';

export interface MoveInput {
  /** -1..1 по осям экрана */
  x: number;
  y: number;
  boost: boolean;
  dash: boolean;
}

const _tmpA = new Vector3();
const _tmpB = new Vector3();
const _AXIS_Y = new Vector3(0, 1, 0);
const _AXIS_Z = new Vector3(0, 0, 1);

export class PlayerController {
  /** единичный радиальный вектор (позиция = R*d) */
  readonly d = new Vector3(0.82, 0.14, 0.55).normalize();
  /** касательная скорость, м/с */
  readonly vel = new Vector3();
  /** текущая «желаемая» для визуала скорость */
  readonly desiredVel = new Vector3();
  /** экранная «верх» ортогональна d — параллельно переносимый ref (для камеры = up) */
  readonly upRef = new Vector3(0, 0, -1);
  boostMeter: number = PLAYER.BOOST_MAX;
  boosting = false;
  dashTimer = 0;
  dashCooldown = 0;
  /** 0..1 — боковой крен для banking */
  bank = 0;
  /** нормализованная текущая скорость (для FOV/визуала) */
  speed01 = 0;

  /** экранное «право»: u = up × d (согласовано с камерой up=upRef, look −d) */
  screenRight(out: Vector3): Vector3 {
    return out.crossVectors(this.upRef, this.d).normalize();
  }

  /** экранное «верх» (касательная) */
  screenUp(out: Vector3): Vector3 {
    return out.copy(this.upRef);
  }

  resetRun(d?: Vector3): void {
    if (d) this.d.copy(d).normalize();
    this.vel.set(0, 0, 0);
    this.desiredVel.set(0, 0, 0);
    this.boostMeter = PLAYER.BOOST_MAX;
    this.boosting = false;
    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.bank = 0;
    this.speed01 = 0;
    this._initUpRef();
  }

  /** произвольный, но детерминированный стартовый касательный up */
  private _initUpRef(): void {
    // «север» на сфере: проекция мировой Y; на полюсах — проекция Z
    _tmpA.copy(_AXIS_Y).addScaledVector(this.d, -_AXIS_Y.dot(this.d));
    if (_tmpA.lengthSq() < 1e-6) _tmpA.copy(_AXIS_Z).addScaledVector(this.d, -_AXIS_Z.dot(this.d));
    this.upRef.copy(_tmpA).normalize();
  }

  /** радиальное состояние (для спавна/логировки) */
  toOrbit(out: OrbitState): OrbitState {
    out.phi = Math.acos(Math.min(1, Math.max(-1, this.d.y)));
    out.theta = Math.atan2(this.d.x, this.d.z);
    return out;
  }

  /**
   * @param dt сек
   * @param orbitRadius метры
   */
  update(dt: number, input: MoveInput, orbitRadius: number, timeScale = 1): void {
    const sdt = dt * timeScale;

    // актуальный касательный базис (upRef перепроецирован на d)
    _tmpA.copy(this.upRef).addScaledVector(this.d, -this.upRef.dot(this.d)).normalize();
    this.upRef.copy(_tmpA);
    const u = _tmpB.crossVectors(this.upRef, this.d).normalize(); // экран-право
    const v = this.upRef; // экран-верх

    // --- boost ---
    const wantBoost = input.boost && this.boostMeter > PLAYER.BOOST_MIN_USE
      && (Math.abs(input.x) + Math.abs(input.y) > 0.05);
    this.boosting = wantBoost;
    if (wantBoost) this.boostMeter = Math.max(0, this.boostMeter - PLAYER.BOOST_DRAIN * sdt);
    else this.boostMeter = Math.min(PLAYER.BOOST_MAX, this.boostMeter + PLAYER.BOOST_REGEN * sdt);

    // --- dash ---
    this.dashCooldown = Math.max(0, this.dashCooldown - sdt);
    if (input.dash && this.dashCooldown <= 0 && (Math.abs(input.x) + Math.abs(input.y) > 0.05)) {
      this.dashTimer = PLAYER.DASH_DURATION;
      this.dashCooldown = PLAYER.DASH_COOLDOWN;
    }
    const dashActive = this.dashTimer > 0;
    if (dashActive) this.dashTimer -= sdt;

    // --- desired velocity в касательной плоскости ---
    const base = PLAYER.BASE_YAW_SPEED * orbitRadius;
    const speed = base * (this.boosting ? PLAYER.BOOST_MULT : 1) * (dashActive ? 2.4 : 1);
    const mag = Math.hypot(input.x, input.y);
    if (mag > 1e-4) {
      const nx = input.x / Math.max(mag, 1);
      const ny = input.y / Math.max(mag, 1);
      this.desiredVel.copy(u).multiplyScalar(nx * speed).addScaledVector(v, ny * speed);
    } else {
      this.desiredVel.set(0, 0, 0);
    }

    // --- инерция ---
    const accel = dashActive ? 9 : this.desiredVel.lengthSq() > 1 ? PLAYER.ACCEL : PLAYER.DECEL;
    this.vel.lerp(this.desiredVel, 1 - Math.exp(-accel * sdt));

    // --- проекция на касательную (uard: drift из-за численных ошибок) ---
    const radial = this.d.dot(this.vel);
    this.vel.addScaledVector(this.d, -radial);

    // --- интеграция по сфере ---
    this.d.addScaledVector(this.vel, sdt / orbitRadius).normalize();

    // --- параллельный перенос базиса: upRef ⟂ новому d (минимальный поворот) ---
    _tmpA.copy(this.upRef).addScaledVector(this.d, -this.upRef.dot(this.d));
    if (_tmpA.lengthSq() < 1e-12) {
      // вырождение (upRef ∥ d из-за накопленной ошибки) — пересеять
      this._initUpRef();
    } else {
      this.upRef.copy(_tmpA).normalize();
    }

    // --- banking: боковая составляющая ускорения ---
    const lat = this.vel.dot(u);
    this.bank = damp(this.bank, -lat / speed * 0.9, 6, sdt);
    this.speed01 = Math.min(1, this.vel.length() / (base * PLAYER.BOOST_MULT * 2.4));
  }

  /** позиция в метрах */
  position(out: Vector3, radius: number): Vector3 {
    return out.copy(this.d).multiplyScalar(radius);
  }
}
