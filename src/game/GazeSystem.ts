/**
 * GAZE SYSTEM — трёхфазная автомат «БОЖЕСТВЕННОГО ВЗГЛЯДА».
 * Чистая логика (без three-объектов): фазы, гистерезис, тайминги,
 * попадание луча по угловому расстоянию, near-miss.
 *
 * Фазы: CALM → AWARENESS → LOCK → CHARGE → FIRE → (escape→COOL) ...
 * Игрок может сбежать: на CHARGE — до выстрела, на FIRE — сорвать лок.
 */
import { HEAD } from '../constants';
import { clamp01 } from '../math/Tracking';
import { lockDotThreshold } from './Difficulty';

export enum GazePhase {
  CALM = 'CALM',
  AWARENESS = 'AWARENESS',
  LOCK = 'LOCK',
  CHARGE = 'CHARGE',
  FIRE = 'FIRE',
  COOLDOWN = 'COOLDOWN',
}

export interface GazeInput {
  /** dot(headForward, dirToPlayer) */
  dot: number;
  /** угол между осью луча и направлением на игрока, рад (только в FIRE) */
  beamAngle: number;
  /** угловой радиус «верного» попадания, рад */
  hitAngle: number;
  /** угловой радиус касательного (near-miss) попадания, рад */
  grazeAngle: number;
  /** глаза открыты и голова «видит» вообще */
  awakened: boolean;
  /** 0..1 опасность (влияет на порог лока и скорость доворота) */
  danger: number;
}

export interface GazeStepResult {
  phase: GazePhase;
  chargeStarted?: boolean;
  fireStarted?: boolean;
  fireEnded?: boolean;
  nearMiss?: boolean;
  gazeEscape?: boolean;
  hitThisTick: boolean;
}

export class GazeSystem {
  phase: GazePhase = GazePhase.CALM;
  /** QA: сколько раз система посещала каждую фазу (не зависит от дискретизации) */
  readonly visits: Record<GazePhase, number> = {
    [GazePhase.CALM]: 0, [GazePhase.AWARENESS]: 0, [GazePhase.LOCK]: 0,
    [GazePhase.CHARGE]: 0, [GazePhase.FIRE]: 0, [GazePhase.COOLDOWN]: 0,
  };
  /** прогресс фаз для HUD */
  lockProgress = 0;
  chargeProgress = 0;
  fireTime = 0;
  /** 0..1 — насколько луч держит игрока (для интенсивности VFX/звука) */
  hitPressure = 0;

  private lockTimer = 0;
  private chargeTimer = 0;
  private coolTimer = 0;
  private hitDuringFire = false;
  private grazeDuringFire = false;
  private escapedLastMoment = false;

  /** переход фаз с учётом визитов */
  private to(p: GazePhase): void {
    if (this.phase !== p) {
      this.phase = p;
      this.visits[p]++;
    }
  }

  reset(): void {
    this.phase = GazePhase.CALM;
    this.lockProgress = this.chargeProgress = this.fireTime = this.hitPressure = 0;
    this.lockTimer = this.chargeTimer = this.coolTimer = 0;
    this.hitDuringFire = this.grazeDuringFire = this.escapedLastMoment = false;
  }

  /** Полный сброс между запусками */
  resetAll(): void {
    this.reset();
  }

  update(dt: number, input: GazeInput): GazeStepResult {
    const res: GazeStepResult = { phase: this.phase, hitThisTick: false };
    const awareDot = HEAD.AWARENESS_DOT;
    const lockDot = lockDotThreshold(input.danger);
    const releaseDot = HEAD.BEAM_RELEASE_DOT;

    if (!input.awakened) {
      this.reset();
      return res;
    }

    switch (this.phase) {
      case GazePhase.CALM:
      case GazePhase.COOLDOWN: {
        if (this.phase === GazePhase.COOLDOWN) {
          this.coolTimer -= dt;
          // ВАЖНО: выход по таймеру, НЕ по dot. Голова непрерывно доворачивает
          // взгляд к игроку (dot≈1), и условие «dot < awareDot» вечно не наступает —
          // система залипала в COOLDOWN и больше никогда не стреляла.
          // Если взгляд всё ещё на игроке — на следующем кадре CALM мгновенно
          // уходит в AWARENESS и цикл блоки/заряда/залпа повторяется.
          if (this.coolTimer <= 0) this.to(GazePhase.CALM);
        } else if (input.dot > awareDot) {
          this.to(GazePhase.AWARENESS);
        }
        this.lockProgress = 0;
        break;
      }

      case GazePhase.AWARENESS: {
        this.lockProgress = clamp01((input.dot - awareDot) / (lockDot - awareDot));
        if (input.dot > lockDot) {
          this.to(GazePhase.LOCK);
          this.lockTimer = 0;
        } else if (input.dot < awareDot - 0.02) {
          this.to(GazePhase.CALM); // гистерезис выхода
        }
        break;
      }

      case GazePhase.LOCK: {
        this.lockProgress = 1;
        if (input.dot > lockDot) {
          this.lockTimer += dt;
          this.chargeProgress = clamp01(this.lockTimer / 0.45);
          if (this.lockTimer >= 0.45) {
            this.to(GazePhase.CHARGE);
            this.chargeTimer = HEAD.BEAM_CHARGE_TIME;
            this.chargeProgress = 0;
            res.chargeStarted = true;
          }
        } else {
          this.lockTimer = Math.max(0, this.lockTimer - dt * 2);
          this.chargeProgress = clamp01(this.lockTimer / 0.45);
          if (input.dot < awareDot - 0.02) this.to(GazePhase.AWARENESS);
        }
        break;
      }

      case GazePhase.CHARGE: {
        this.chargeTimer -= dt;
        this.chargeProgress = clamp01(1 - this.chargeTimer / HEAD.BEAM_CHARGE_TIME);
        if (input.dot < releaseDot) {
          // игрок вывернул — срыв
          this.to(GazePhase.COOLDOWN);
          this.coolTimer = HEAD.BEAM_COOLDOWN * 0.5;
          if (this.chargeProgress > 0.72) {
            res.nearMiss = true; // ушёл в последнюю долю секунды
            this.escapedLastMoment = true;
          }
          this.chargeProgress = 0;
        } else if (this.chargeTimer <= 0) {
          this.to(GazePhase.FIRE);
          this.fireTime = 0;
          this.hitDuringFire = false;
          this.grazeDuringFire = false;
          res.fireStarted = true;
        }
        break;
      }

      case GazePhase.FIRE: {
        this.fireTime += dt;
        this.chargeProgress = 1;
        const angle = input.beamAngle;
        res.hitThisTick = angle < input.hitAngle;
        if (res.hitThisTick) this.hitDuringFire = true;
        else if (angle < input.grazeAngle) this.grazeDuringFire = true;
        this.hitPressure = res.hitThisTick ? 1 : clamp01((input.grazeAngle - angle) / (input.grazeAngle - input.hitAngle));

        if (input.dot < releaseDot || this.fireTime > HEAD.BEAM_MAX_DURATION) {
          // срыв взгляда головы — луч гаснет
          this.to(GazePhase.COOLDOWN);
          this.coolTimer = HEAD.BEAM_COOLDOWN;
          this.chargeProgress = 0;
          this.hitPressure = 0;
          res.fireEnded = true;
          if (this.grazeDuringFire && !this.hitDuringFire) {
            res.nearMiss = true; // луч «чиркнул» по касательной
          } else if (this.hitDuringFire || this.escapedLastMoment) {
            res.gazeEscape = true; // выжил под взором
            this.escapedLastMoment = false;
          }
        }
        break;
      }
    }

    res.phase = this.phase;
    return res;
  }

  /** Активен ли сейчас опасный взгляд (для HUD «DIVINE GAZE») */
  get dangerous(): boolean {
    return this.phase === GazePhase.LOCK || this.phase === GazePhase.CHARGE || this.phase === GazePhase.FIRE;
  }

  get firing(): boolean {
    return this.phase === GazePhase.FIRE;
  }
}
