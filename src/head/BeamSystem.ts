/**
 * BeamSystem — «взор, сжигающий человека».
 *
 * Логическая ось луча — одно направление из «переносицы» головы;
 * визуально это ДВА цилиндра от каждого глаза, сходящиеся на точке
 * попадания (V-форма). Ось динамически доворачивается за игроком с
 * ограниченной скоростью (beamTurnSpeed) — игрок может уйти в последний миг.
 *
 * Фаза CHARGE: из глаз растёт накал (управляется GodHead), ось только формируется.
 * Фаза FIRE: луч, попадание = угол(ось, до игрока) < hitAngle.
 */
import {
  Group, Mesh, Vector3, CylinderGeometry, Sprite, SpriteMaterial, PointLight,
  Quaternion, AdditiveBlending, RingGeometry, Color, ShaderMaterial,
} from 'three';
import { createBeamMaterial, createGlowSpriteMaterial, createShockRingMaterial } from '../render/Shaders';
import { makeGlowTexture } from '../render/Textures';
import { WORLD } from '../constants';

const _up = new Vector3(0, 1, 0);
const _dir = new Vector3();
const _mid = new Vector3();
const _desired = new Vector3();
const _cross = new Vector3();
const _q = new Quaternion();

export class BeamSystem {
  readonly group = new Group();
  /** текущее направление оси луча (мировое, нормализовано) */
  readonly axis = new Vector3(0, 0, 1);
  /** точка «попадания» на сфере орбиты */
  readonly impactPoint = new Vector3();
  /** 0..1 интенсивность (charge → 0.35, fire → 1) */
  intensity = 0;
  /** true, если в этом кадре ось держит игрока в core */
  hitNow = false;
  /** угол до игрока (рад), для near-miss логики */
  axisAngle = 999;

  private beams: Mesh[] = [];
  private cores: Mesh[] = [];
  private impact: Sprite;
  private flash: Sprite;
  private ring: Mesh;
  private light: PointLight;
  private matOuter = createBeamMaterial();
  private matCore = createBeamMaterial();
  private ringPhase = 0;

  constructor() {
    this.matCore.uniforms.uColorA.value = new Color('#ffffff');
    this.matCore.uniforms.uColorB.value = new Color('#bfe9ff');

    for (let i = 0; i < 2; i++) {
      const outer = new Mesh(new CylinderGeometry(2.2, 6.4, 1, 18, 1, true), this.matOuter);
      const core = new Mesh(new CylinderGeometry(0.5, 1.7, 1, 12, 1, true), this.matCore);
      outer.visible = core.visible = false;
      outer.renderOrder = 8;
      core.renderOrder = 9;
      this.group.add(outer, core);
      this.beams.push(outer);
      this.cores.push(core);
    }

    this.impact = new Sprite(new SpriteMaterial({
      color: new Color('#eef6ff'), transparent: true,
      blending: AdditiveBlending, depthWrite: false, opacity: 0,
    }));
    this.impact.scale.setScalar(46);
    this.impact.visible = false;
    this.impact.renderOrder = 10;

    this.flash = new Sprite(new SpriteMaterial({
      color: new Color('#ff9d7a'), transparent: true,
      blending: AdditiveBlending, depthWrite: false, opacity: 0,
    }));
    this.flash.scale.setScalar(130);
    this.flash.visible = false;
    this.flash.renderOrder = 10;

    this.ring = new Mesh(new RingGeometry(0.78, 1.0, 48), createShockRingMaterial());
    this.ring.visible = false;
    this.ring.renderOrder = 11;

    this.light = new PointLight(0xbfe0ff, 0, 900, 1.4);
    this.group.add(this.impact, this.flash, this.ring, this.light);

    // glow-текстура ставим сразу (сгенерирована в Canvas)
    try {
      const tex = makeGlowTexture(128);
      (this.impact.material as SpriteMaterial).map = tex;
      (this.flash.material as SpriteMaterial).map = tex;
      (this.impact.material as SpriteMaterial).needsUpdate = true;
      (this.flash.material as SpriteMaterial).needsUpdate = true;
    } catch { /* вне браузера — пропускаем */ }
  }

  reset(): void {
    this.intensity = 0;
    this.hitNow = false;
    this.axis.set(0, 0, 1);
    for (const b of this.beams) b.visible = false;
    for (const c of this.cores) c.visible = false;
    this.impact.visible = false;
    this.flash.visible = false;
    this.ring.visible = false;
    this.light.intensity = 0;
  }

  /**
   * @param dt
   * @param originL/R мировые точки выхода из глаз
   * @param playerPos мировая позиция игрока
   * @param firing активен ли луч
   * @param charge 0..1 прогресс заряда
   * @param turnSpeed rad/s доворота оси
   */
  update(
    dt: number, time: number,
    originL: Vector3, originR: Vector3,
    playerPos: Vector3,
    firing: boolean, charge: number, turnSpeed: number,
  ): void {
    const mid = _mid.copy(originL).add(originR).multiplyScalar(0.5);
    // желаемое направление — на текущую позицию игрока
    const desired = _desired.copy(playerPos).sub(mid).normalize();
    if (firing) {
      const ang = this.axis.angleTo(desired);
      if (ang > 1e-5) {
        _cross.crossVectors(this.axis, desired);
        if (_cross.lengthSq() < 1e-10) _cross.set(1, 0, 0);
        _cross.normalize();
        _q.setFromAxisAngle(_cross, Math.min(ang, turnSpeed * dt));
        this.axis.applyQuaternion(_q).normalize();
      }
    } else {
      // в простое ось «лежит» на forward головы (чтобы выстрел не был из ниоткуда)
      this.axis.lerp(desired, Math.min(1, dt * 1.6)).normalize();
    }

    this.axisAngle = this.axis.angleTo(desired);
    this.hitNow = firing && this.axisAngle < (HEAD_ANGLE_HIT);

    // интенсивность
    const targetInt = firing ? 1 : charge * 0.16;
    this.intensity += (targetInt - this.intensity) * Math.min(1, dt * (firing ? 26 : 6));
    const visible = this.intensity > 0.01;

    // точка пересечения оси со сферой орбиты
    this.impactPoint.copy(this.axis).multiplyScalar(WORLD.ORBIT_RADIUS);

    // расстановка «глаз → точка попадания»
    const origins = [originL, originR];
    for (let i = 0; i < 2; i++) {
      const beam = this.beams[i];
      const core = this.cores[i];
      beam.visible = core.visible = visible;
      if (!visible) continue;
      const from = origins[i];
      _dir.copy(this.impactPoint).sub(from);
      const len = _dir.length();
      _dir.normalize();
      _q.setFromUnitVectors(_up, _dir);
      beam.position.copy(from).addScaledVector(_dir, len / 2);
      beam.quaternion.copy(_q);
      beam.scale.set(1, len, 1);
      core.position.copy(beam.position);
      core.quaternion.copy(_q);
      core.scale.set(1, len, 1);
    }

    this.matOuter.uniforms.uTime.value = time;
    this.matCore.uniforms.uTime.value = time;
    this.matOuter.uniforms.uIntensity.value = this.intensity;
    this.matCore.uniforms.uIntensity.value = this.intensity * (0.8 + 0.2 * Math.sin(time * 31));
    this.matOuter.uniforms.uSeed.value = 0;
    this.matCore.uniforms.uSeed.value = 4.7;

    // ударная точка
    this.impact.visible = this.flash.visible = this.ring.visible = visible;
    if (visible) {
      this.impact.position.copy(this.impactPoint);
      this.flash.position.copy(this.impactPoint);
      const flick = 0.75 + 0.25 * Math.sin(time * 47) * Math.sin(time * 13.7);
      // МИКРО-масштабы: камера в 16–50 м от точки удара — спрайты не должны
      // «отбеливать» весь кадр: удар = плотная точка + расширяющееся кольцо
      this.impact.scale.setScalar(4.5 + 5.5 * this.intensity * flick);
      (this.impact.material as SpriteMaterial).opacity = this.intensity * 0.9;
      this.flash.scale.setScalar(12 + 22 * this.intensity * flick);
      (this.flash.material as SpriteMaterial).opacity = this.intensity * 0.22;
      this.ring.position.copy(this.impactPoint);
      this.ring.quaternion.copy(_q.setFromUnitVectors(_up, this.axis));
      this.ringPhase = (this.ringPhase + dt * 2.4) % 1;
      const rs = 2 + this.ringPhase * 20 * (0.4 + this.intensity);
      this.ring.scale.setScalar(rs);
      const ringMat = this.ring.material as ShaderMaterial;
      ringMat.uniforms.uOpacity.value = (1 - this.ringPhase) * this.intensity * 0.75;
      this.light.position.copy(this.impactPoint);
      this.light.intensity = 26 * this.intensity * flick;
    } else {
      this.light.intensity = 0;
    }
  }

  /** мгновенный сброс при смерти/рестарте */
  snap(): void {
    this.intensity = 0;
  }
}

/** угловой радиус «верного» попадания — core луча на дистанции орбиты (рад) */
import { HEAD as HEAD_CFG } from '../constants';
const HEAD_ANGLE_HIT = Math.atan2(HEAD_CFG.BEAM_CORE_RADIUS + 2.2, WORLD.ORBIT_RADIUS - HEAD_CFG.BEAM_CORE_RADIUS);
/** угловой радиус касательного (near-miss) */
export const ANGLE_GRAZE = Math.atan2(HEAD_CFG.BEAM_NEAR_RADIUS + 6, WORLD.ORBIT_RADIUS);
