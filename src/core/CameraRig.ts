/**
 * CameraRig — кинематографичная chase-камера на сфере.
 *
 * Камера строго «за спиной» игрока на радиале. ЕЁ UP приходит извне
 * (параллельно-переносимый upRef контроллера) — перпендикуляр лучу
 * зрения, поэтому lookAt никогда не вырождается (раньше up был радиальным
 * и совпадал с направлением взгляда —orientation камеры скачки → «водоворот»).
 * Инерция, banking-крен, тряска (trauma-модель), FOV от скорости,
 * мягкий pull к голове при опасном взгляде, зум колесом мыши.
 */
import { PerspectiveCamera, Vector3 } from 'three';
import { CAM, WORLD } from '../constants';
import { damp, clamp } from '../math/Tracking';
import { orbitNormal } from '../math/Orbit';

const _pos = new Vector3();
const _target = new Vector3();
const _n = new Vector3();

export interface CamState {
  playerPos: Vector3;
  /** касательная «скорость» направления движения игрока для look-ahead */
  forward: Vector3;
  /** касательный экран-верх (стабильный ref контроллера) */
  up: Vector3;
  speed01: number;
  boosting: boolean;
  bank: number;
  /** 0..1 — насколько опасен gaze (pull к голове) */
  gaze01: number;
  /** 0..1 — trauma: тряска */
  trauma: number;
  /** множитель FOV поверх всего (near-miss вспышка и пр.) */
  fovPunch: number;
  /** 0..1 — затягивание камеры к голове во время пробуждения */
  awakenPull: number;
  /** множитель дистанции камеры (зум колесом; 1 = штатно) */
  zoom: number;
  time: number;
  dt: number;
}

export class CameraRig {
  readonly cam: PerspectiveCamera;
  private curPos = new Vector3();
  private curLook = new Vector3();
  private curUp = new Vector3(0, 0, -1);
  private inited = false;
  /** смещение тряски */
  shakeVec = new Vector3();
  private roll = 0;

  constructor() {
    this.cam = new PerspectiveCamera(CAM.FOV_BASE, 1, 1.1, 14000);
    this.cam.position.set(0, 0, WORLD.ORBIT_RADIUS + CAM.BACK_DISTANCE);
  }

  reset(): void {
    this.inited = false;
  }

  update(s: CamState): void {
    const { dt } = s;
    _n.copy(s.playerPos).normalize();
    orbitNormal({ theta: Math.atan2(_n.x, _n.z), phi: Math.acos(clamp(_n.y, -1, 1)) }, _n);

    // позиция: радиал-сфера + приподнята вдоль экранного up; дистанция с зумом
    const back = CAM.BACK_DISTANCE * s.zoom;
    _pos.copy(s.playerPos).addScaledVector(_n, back).addScaledVector(s.up, CAM.LIFT * s.zoom);
    // мягкие пуллы к голове
    const pull = s.awakenPull * CAM.AWAKEN_PULL_M + s.gaze01 * CAM.GAZE_PULL;
    _pos.addScaledVector(_n, -pull);
    _pos.setLength(Math.max(WORLD.ORBIT_RADIUS + 12, _pos.length()));

    // look-at: игрок + опережение по движению + чуть «к голове» при pull
    _target.copy(s.playerPos)
      .addScaledVector(s.forward, Math.min(6, s.speed01 * 6))
      .addScaledVector(s.up, -CAM.LIFT * s.zoom * 0.65)
      .addScaledVector(_n, -(2.4 + s.awakenPull * 26 + s.gaze01 * CAM.GAZE_TARGET_PULL));

    // инерция позиции/взгляда
    const k = this.inited ? 1 - Math.exp(-CAM.SMOOTH * dt) : 1;
    this.curPos.lerp(_pos, k);
    this.curLook.lerp(_target, this.inited ? 1 - Math.exp(-(CAM.SMOOTH + 1.6) * dt) : 1);
    this.curUp.lerp(s.up, k).normalize();
    this.inited = true;

    // тряска: trauma^2, высокочастотная
    const shakeAmp = s.trauma * s.trauma;
    const t = s.time;
    this.shakeVec.set(
      Math.sin(t * 47.3) * Math.sin(t * 11.1),
      Math.sin(t * 38.7 + 2) * Math.sin(t * 9.7),
      Math.sin(t * 41.9 + 4) * Math.sin(t * 13.3),
    ).multiplyScalar(shakeAmp * 1.15);

    this.cam.position.copy(this.curPos).add(this.shakeVec);
    this.cam.up.copy(this.curUp); // стабильный касательный up — no degenerate lookAt
    this.cam.lookAt(this.curLook);
    // subtle roll при крене игрока (визуал, в базис ввода не попадает)
    this.roll = damp(this.roll, -s.bank * 0.6 + shakeAmp * Math.sin(t * 23) * 0.3, 5, dt);
    this.cam.rotateZ(this.roll);

    // FOV
    const fov = CAM.FOV_BASE
      + s.speed01 * CAM.FOV_SPEED_ADD
      + (s.boosting ? CAM.FOV_BOOST - CAM.FOV_BASE : 0)
      + s.fovPunch * 6
      + shakeAmp * 2;
    this.cam.fov = damp(this.cam.fov, fov, 6, dt);
    this.cam.updateProjectionMatrix();
  }

  resize(aspect: number): void {
    this.cam.aspect = aspect;
    this.cam.updateProjectionMatrix();
  }
}
