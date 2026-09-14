/**
 * GodHead — сборка и жизнь Бога-Короля.
 *
 * Граф:  group(центр мира = 0)
 *         ├─ rot   — полный 3D трекинг игрока (HeadTracker), локальный +Z = направление взгляда
 *         │   ├─ skull (шейдер камня) + crown (каменное кольцо)
 *         │   ├─ eyeGroup L/R — глаза-риги (опережающий трекинг внутри глазниц)
 *         │   │    ├─ eyeball (вращается внутри группы)
 *         │   │    ├─ lidUpper pivot / lidLower pivot (анимация век)
 *         │   │    └─ halo (glow-нимб)
 *         ├─ crown — венец-обруч (статичен в rot)
 *         └─ mist — объёмная дымка вокруг головы
 *
 * Все world-space запросы (позиция зрачка, forward) считаются вручную
 * по цепочке кватернионов — без зависимости от обновлённых matrixWorld.
 */
import {
  Group, Mesh, Sprite, SpriteMaterial, Vector3, SphereGeometry, Quaternion, Euler,
  AdditiveBlending, Color, ShaderMaterial,
} from 'three';
import { WORLD } from '../constants';
import { buildHeadGeometry, EYE_DIRS } from './HeadSculpt';
import { buildLidGeometry, buildCrownGeometry, skullSurfaceRadius } from './HeadParts';
import { createHeadMaterial, createLidMaterial, type HeadUniforms } from '../render/HeadMaterial';
import { createEyeMaterial, createMistMaterial } from '../render/Shaders';
import { makeGlowTexture } from '../render/Textures';
import { HeadTracker } from './HeadTracking';
import { Awakening } from '../game/Awakening';
import { damp, smoothstep, clamp01 } from '../math/Tracking';

const R = WORLD.HEAD_RADIUS;
const EYEBALL_R = R * 0.112;
const EYE_DEPTH = 0.805; // радиус центра глаза (доля локальной поверхности)

export interface HeadUpdateCtx {
  dt: number;
  time: number;
  /** позиция игрока относительно центра головы (= мировая, центр в нуле) */
  playerRel: Vector3;
  trackRate: number;   // rad/s головы
  eyeRate: number;     // rad/s глаз
  danger: number;      // 0..1
  firing: boolean;
  chargeProgress: number;
}

const _tmpA = new Vector3();
const _tmpB = new Vector3();
const _localDir = new Vector3();
const _desQ = new Quaternion();
const _Z3 = new Vector3(0, 0, 1);
const _qa = new Quaternion();
const _qb = new Quaternion();
const _identQ = new Quaternion();

class EyeRig {
  group = new Group();
  ball: Mesh;
  lidUpPivot = new Group();
  lidLoPivot = new Group();
  halo: Sprite;
  private upAxis: Vector3;
  private loAxis: Vector3;
  eyePos: Vector3;

  constructor(
    public side: 'left' | 'right',
    public eyeMat: ReturnType<typeof createEyeMaterial>,
    public lidMatFactory: () => ReturnType<typeof createLidMaterial>,
    /** ссылка на rot-группу головы для перевода направлений */
    private rot: Group,
  ) {
    this.ball = new Mesh(new SphereGeometry(EYEBALL_R, 48, 32), eyeMat);
    this.group.add(this.ball);

    const dir = side === 'left' ? EYE_DIRS.left : EYE_DIRS.right;
    const up = buildLidGeometry(R, dir, true);
    const lo = buildLidGeometry(R, dir, false);
    const lidMat = this.lidMatFactory();

    up.geo.translate(-up.hingePoint.x, -up.hingePoint.y, -up.hingePoint.z);
    const upMesh = new Mesh(up.geo, lidMat);
    this.lidUpPivot.position.copy(up.hingePoint);
    this.lidUpPivot.add(upMesh);

    lo.geo.translate(-lo.hingePoint.x, -lo.hingePoint.y, -lo.hingePoint.z);
    const loMesh = new Mesh(lo.geo, lidMat);
    this.lidLoPivot.position.copy(lo.hingePoint);
    this.lidLoPivot.add(loMesh);

    this.halo = new Sprite(new SpriteMaterial({
      map: makeGlowTexture(), color: new Color('#d6ecff'), transparent: true,
      blending: AdditiveBlending, depthWrite: false, opacity: 0,
    }));
    this.halo.scale.setScalar(EYEBALL_R * 8);
    this.halo.position.set(0, 0, EYEBALL_R * 0.6);
    this.group.add(this.halo);

    this.upAxis = up.hingeAxis;
    this.loAxis = lo.hingeAxis;
    const surR = skullSurfaceRadius(dir.x, dir.y, dir.z, R);
    this.eyePos = dir.clone().multiplyScalar(surR * EYE_DEPTH);
    this.group.position.copy(this.eyePos);
    this.group.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), dir);
  }

  /** мировая позиция центра глаза (head root в нуле) */
  eyeWorld(out: Vector3): Vector3 {
    return out.copy(this.eyePos).applyQuaternion(this.rot.quaternion);
  }

  /** мировое направление «взгляда зрачка» (+Z глаза) */
  eyeForwardWorld(out: Vector3): Vector3 {
    const q = _qa.copy(this.rot.quaternion).multiply(this.group.quaternion).multiply(this.ball.quaternion);
    return out.set(0, 0, 1).applyQuaternion(q);
  }

  /** мир → пространство глаза (для local target) */
  private worldDirToLocal(dir: Vector3, out: Vector3): Vector3 {
    const q = _qb.copy(this.rot.quaternion).multiply(this.group.quaternion).invert();
    return out.copy(dir).applyQuaternion(q);
  }

  setOpen(open: number, tremor: number, time: number): void {
    const tw = Math.sin(time * 34 + (this.side === 'left' ? 0 : 2.1)) * tremor * 0.012;
    const upA = -open * 1.25 + tw;
    const loA = open * 0.42 + tw * 0.4;
    this.lidUpPivot.quaternion.setFromAxisAngle(this.upAxis, upA);
    this.lidLoPivot.quaternion.setFromAxisAngle(this.loAxis, loA);
  }

  /** быстрый трекинг игрока внутри глазницы (с ограничением угла) */
  look(playerRel: Vector3, rate: number, dt: number, open: number): void {
    _tmpA.copy(playerRel).sub(this.eyeWorld(_tmpB));
    if (_tmpA.lengthSq() < 1e-8) return;
    _tmpA.normalize();
    const local = this.worldDirToLocal(_tmpA, _localDir);
    const desired = _desQ.setFromUnitVectors(_Z3, local);
    const ang = desired.angleTo(_identQ);
    const lim = 0.30 * Math.max(0.35, open);
    if (ang > lim) desired.slerp(_identQ, lim / ang);
    const cur = this.ball.quaternion;
    const curAng = cur.angleTo(desired);
    if (curAng > 1e-5) cur.slerp(desired, Math.min(1, (rate * dt) / curAng));
  }
}

export class GodHead {
  readonly group = new Group();
  readonly rot = new Group();
  readonly tracker = new HeadTracker();
  readonly awakening = new Awakening();

  private skull: Mesh;
  private eyeL: EyeRig;
  private eyeR: EyeRig;
  private headUni: HeadUniforms;
  private eyeMatL: ReturnType<typeof createEyeMaterial>;
  private eyeMatR: ReturnType<typeof createEyeMaterial>;
  private mist: Mesh;
  lidOpen = 0;
  eyeGlow = 0;
  private prevBeamGlow = 0;

  constructor() {
    const headMat = createHeadMaterial(R);
    this.headUni = headMat.uniforms as HeadUniforms;

    this.skull = new Mesh(buildHeadGeometry(R, 176), headMat);
    this.rot.add(this.skull);

    const crown = new Mesh(buildCrownGeometry(R * 0.985, 0.04), headMat);
    crown.position.y = R * 0.30;
    this.rot.add(crown);
    // шеи/пьедестала нет — только парящая голова

    this.eyeMatL = createEyeMaterial();
    this.eyeMatR = createEyeMaterial();
    const lidFactory = () => createLidMaterial(this.headUni);
    this.eyeL = new EyeRig('left', this.eyeMatL, lidFactory, this.rot);
    this.eyeR = new EyeRig('right', this.eyeMatR, lidFactory, this.rot);
    this.rot.add(this.eyeL.group, this.eyeR.group);

    const mistMat = createMistMaterial();
    this.mist = new Mesh(new SphereGeometry(R * 1.55, 40, 28), mistMat);
    this.mist.renderOrder = 5;
    this.group.add(this.mist);
    this.group.add(this.rot);

    // позиции глаз (object space головы) для подсветки глазниц
    const setSocket = (uniKey: 'uEyePosL' | 'uEyePosR', dir: Vector3) => {
      (this.headUni[uniKey].value as Vector3)
        .copy(dir)
        .multiplyScalar(skullSurfaceRadius(dir.x, dir.y, dir.z, R) * 0.92);
    };
    setSocket('uEyePosL', EYE_DIRS.left);
    setSocket('uEyePosR', EYE_DIRS.right);

    this.eyeL.setOpen(0, 0, 0);
    this.eyeR.setOpen(0, 0, 0);
  }

  /** мировая точка выхода луча (зрачок + радиус) */
  getBeamOrigin(side: 'left' | 'right', out: Vector3): Vector3 {
    const rig = side === 'left' ? this.eyeL : this.eyeR;
    const fwd = _tmpA;
    rig.eyeForwardWorld(fwd);
    return rig.eyeWorld(out).addScaledVector(fwd, EYEBALL_R * 0.95);
  }

  resetRun(): void {
    this.awakening.reset();
    this.tracker.reset();
    this.rot.quaternion.identity();
    this.lidOpen = 0;
    this.eyeGlow = 0;
    this.prevBeamGlow = 0;
    this.eyeL.ball.quaternion.identity();
    this.eyeR.ball.quaternion.identity();
  }

  startAwakening(): void {
    this.awakening.start();
  }

  get awakened(): boolean { return this.awakening.eyesOpen; }
  get gazeDot(): number { return this.tracker.gazeDot; }
  get headAngularSpeed(): number { return this.tracker.angularSpeed; }

  update(ctx: HeadUpdateCtx): void {
    const { dt, time, playerRel } = ctx;

    // 1. пробуждение / веки / свечение
    this.awakening.update(dt);
    this.lidOpen = damp(this.lidOpen, this.awakening.lidOpen, 6, dt);
    const targetGlow = ctx.firing ? 1.55 : this.awakening.glow * (0.55 + ctx.chargeProgress * 0.55);
    this.eyeGlow = damp(this.eyeGlow, targetGlow, ctx.firing ? 10 : 3, dt);

    // 2. трекинг головы: спит — смотрит «в пустоту» (затылком к игроку)
    const trackingOn = this.awakening.eyesOpen;
    _tmpB.set(0, 0, -1); // покойная «поза»: лицом от игрока, чуть вниз
    _tmpB.y = -0.25;
    this.tracker.update(dt, trackingOn ? playerRel : _tmpB, trackingOn ? ctx.trackRate : 0.35);
    this.rot.quaternion.copy(this.tracker.q);

    // 3. дыхание + тремор + тяжёлый доворот
    const breathe = 1 + Math.sin(time * 0.55) * 0.0035 + Math.sin(time * 0.23) * 0.002;
    this.skull.scale.setScalar(breathe);
    const tr = this.awakening.tremor;
    if (tr > 0.01) {
      this.rot.quaternion.multiply(_qa.setFromEuler(new Euler(
        Math.sin(time * 41) * 0.0035 * tr,
        Math.sin(time * 37 + 2) * 0.004 * tr,
        0,
      )));
    }
    const sway = smoothstep(0.15, 1, this.tracker.angularSpeed * 0.9);
    this.rot.quaternion.multiply(_qa.setFromEuler(new Euler(
      Math.sin(time * 6.2) * 0.004 * sway,
      Math.sin(time * 5.3) * 0.005 * sway,
      0,
    )));

    // 4. глаза: веки, опережающий трекинг, нимбы
    const open = this.lidOpen;
    this.eyeL.setOpen(open, tr, time);
    this.eyeR.setOpen(open, tr, time);
    this.eyeL.look(playerRel, ctx.eyeRate, dt, open);
    this.eyeR.look(playerRel, ctx.eyeRate * 1.1, dt, open);
    const haloOp = smoothstep(0.15, 1, open) * (0.18 + this.eyeGlow * 0.55);
    (this.eyeL.halo.material as SpriteMaterial).opacity = haloOp;
    (this.eyeR.halo.material as SpriteMaterial).opacity = haloOp;

    // 5. униформы материалов
    this.headUni.uTime.value = time;
    this.headUni.uAwake.value = clamp01(this.awakening.progress);
    this.headUni.uDanger.value = ctx.danger;
    this.headUni.uPulse.value = 0.5 + 0.5 * Math.sin(time * 0.6);
    this.headUni.uEyeGlow.value = this.eyeGlow * 0.95;
    this.prevBeamGlow = damp(this.prevBeamGlow, ctx.firing ? 1 : 0, 5, dt);
    this.headUni.uBeamGlow.value = this.prevBeamGlow;

    (this.mist.material as ShaderMaterial).uniforms.uTime.value = time;
    (this.mist.material as ShaderMaterial).uniforms.uOpacity.value =
      0.075 + this.awakening.progress * 0.02 + (ctx.firing ? 0.045 : 0);

    for (const em of [this.eyeMatL, this.eyeMatR]) {
      em.uniforms.uTime.value = time;
      em.uniforms.uGlow.value = this.eyeGlow;
      em.uniforms.uOpen.value = open;
      em.uniforms.uPupil.value = ctx.firing ? 0.85 + 0.1 * Math.sin(time * 22) : 0.5 + 0.12 * Math.sin(time * 1.3);
      em.uniforms.uHit.value = ctx.firing ? Math.min(1, (em.uniforms.uHit.value as number) + dt * 8) : Math.max(0, (em.uniforms.uHit.value as number) - dt * 3);
    }
  }

  dispose(): void {
    this.skull.geometry.dispose();
    (this.skull.material as { dispose(): void }).dispose();
    this.mist.geometry.dispose();
    (this.mist.material as { dispose(): void }).dispose();
  }
}
