/**
 * SoulField — менеджер популяции и коллизий всех сущностей.
 *
 * Пул объектов: mesh'и переиспользуются (никаких new каждый кадр).
 * Целевая плотность — из Difficulty. Красные духи: дрейф → группировка →
 * преследование (вероятность растёт с danger).
 */
import { Group, Vector3 } from 'three';
import { WORLD, PLAYER, DIFFICULTY, POOL, SPIRITS } from '../constants';
import { makeSoul, createSoulMesh, stepSoulMotion, type SoulData, type SoulKind } from './Soul';
import { targetPopulation, redSpeed, redChaseChance } from '../game/Difficulty';
import type { Rng } from '../math/rng';
import { orbitRandom } from '../math/Orbit';

const _tmp = new Vector3();
const _tmp2 = new Vector3();

export interface TouchResult {
  collected: SoulData[];
  spiritTouched: SoulData[];
}

export class SoulField {
  /** активные сущности (стабильный порядок не важен) */
  readonly souls: SoulData[] = [];
  /** free-листы по типам для mesh-пулов */
  private meshPool = new Map<string, Group[]>();
  private spawnAccum = { blue: 0, green: 0, red: 0, gold: 0 };
  /** счётчик «окон спавна» — детерминированный темп */
  private tickTimer = 0;

  constructor(
    private root: Group,
    private rng: Rng,
  ) {}

  /** новый rng на новый ран (новый сид) */
  setRng(rng: Rng): void {
    this.rng = rng;
  }

  resetRun(): void {
    for (const s of this.souls) this.retire(s);
    this.souls.length = 0;
    this.spawnAccum.blue = this.spawnAccum.green = this.spawnAccum.red = this.spawnAccum.gold = 0;
    this.tickTimer = 0;
    this.pendingRespawns = 0;
  }

  /** Начальная раскладка рана: «тихая гавань», но уже плотная (v4 ×2) */
  seedInitialRun(playerDir: Vector3): void {
    for (let i = 0; i < 30; i++) this.spawn('blue', playerDir);
    for (let i = 0; i < 9; i++) this.spawn('green', playerDir);
    for (let i = 0; i < DIFFICULTY.PHASES[0].red; i++) this.spawn('red', playerDir);
  }

  /** Кол-во живых данного типа */
  count(kind: SoulKind): number {
    let c = 0;
    for (const s of this.souls) if (s.kind === kind && s.alive) c++;
    return c;
  }

  private spawn(kind: SoulKind, playerDir: Vector3, nearPlayer = false, far = false): void {
    const sd = makeSoul(kind, this.rng, playerDir, far ? SPIRITS.RESPAWN_MIN_ANGLE : nearPlayer ? 0.25 : 0.7);
    const mesh = this.obtainMesh(kind, sd.large);
    mesh.position.copy(sd.pos);
    sd.mesh = mesh;
    this.root.add(mesh);
    this.souls.push(sd);
  }

  private obtainMesh(kind: SoulKind, large: boolean): Group {
    const key = `${kind}${large ? '-l' : ''}`;
    const pool = this.meshPool.get(key);
    if (pool && pool.length) return pool.pop()!;
    return createSoulMesh(kind, large);
  }

  private retire(sd: SoulData): void {
    if (!sd.mesh) return;
    this.root.remove(sd.mesh);
    const key = `${sd.kind}${sd.large ? '-l' : ''}`;
    let pool = this.meshPool.get(key);
    if (!pool) this.meshPool.set(key, (pool = []));
    pool.push(sd.mesh);
    sd.mesh = null;
    sd.alive = false;
  }

  private removeAt(i: number): void {
    const sd = this.souls[i];
    this.retire(sd);
    this.souls[i] = this.souls[this.souls.length - 1];
    this.souls.pop();
  }

  /**
   * Основной шаг. Возвращает, что игрок собрал/коснулся в этом кадре.
   * @param danger 0..1
   * @param time сек рана
   * @param playerPos мировая позиция игрока (центр головы = 0)
   */
  update(dt: number, time: number, danger: number, playerPos: Vector3, awakened: boolean, firstRedAt: number): TouchResult {
    const collected: SoulData[] = [];
    const spiritTouched: SoulData[] = [];
    const playerDir = _tmp.copy(playerPos).normalize();

    // --- целевая популяция + темп спавна (детерминированно по «тикам») ---
    this.tickTimer += dt;
    const target = targetPopulation(time);
    const period = 1.15; // сек между волнами дозасылания
    if (this.tickTimer >= period) {
      this.tickTimer -= period;
      this.refill('blue', target.blue, playerDir);
      this.refill('green', target.green, playerDir);
      // красные появляются не раньше firstRedAt
      if (time > firstRedAt) this.refill('red', Math.min(target.red, DIFFICULTY.MAX_RED), playerDir, danger);
      // редкие золотые — приманка в опасных местах
      if (this.rng() < 0.10 && this.count('gold') < 2 && time > 30) {
        this.spawn('gold', playerDir);
      }
    }

    // --- движение + коллизии ---
    const shellR = WORLD.ORBIT_RADIUS;
    const rspeed = redSpeed(danger) * shellR;
    const chaseChance = redChaseChance(danger); // сек⁻¹ «заметить игрока»
    const cone = DIFFICULTY.RED_CHASE_CONE;
    for (let i = this.souls.length - 1; i >= 0; i--) {
      const s = this.souls[i];
      if (!s.alive) { this.removeAt(i); continue; }

      if (s.kind === 'red') {
        // базовый блуждающий дрейф
        if (s.vel.lengthSq() < 0.01 || this.rng() < 0.016) {
          const dir = orbitRandom(this.rng);
          const sinP = Math.sin(dir.phi);
          _tmp2.set(sinP * Math.sin(dir.theta), Math.cos(dir.phi), sinP * Math.cos(dir.theta));
          const t = _tmp2.sub(s.n).normalize();
          s.vel.copy(t).multiplyScalar(rspeed * (0.6 + 0.5 * this.rng()));
        }
        // угловое расстояние до игрока на сфере — «видит ли дух его»
        const angToPlayer = s.n.angleTo(playerDir);
        if (!s.chase) {
          // захват: игрок в конусе обзора, голова уже видела игрока (awakened)
          // или общая опасность высокая; вероятность растёт с danger
          if ((awakened || danger > 0.08) && angToPlayer < cone && this.rng() < chaseChance * dt) {
            s.chase = true; s.chaseT = 0;
          }
        } else {
          s.chaseT += dt;
          // «поводок»: игрок ушёл рывком за конус — или погоня затянулась — loses interest
          if (angToPlayer > cone * 1.7 || s.chaseT > 8) {
            s.chase = false; s.chaseT = 0;
          } else {
            const toPlayer = _tmp2.copy(playerPos).sub(s.pos);
            toPlayer.addScaledVector(s.n, -toPlayer.dot(s.n));
            if (toPlayer.lengthSq() > 1e-6) {
              toPlayer.normalize();
              // погоня быстрее дрейфа; скорость растёт с danger (rspeed уже растёт)
              s.vel.lerp(toPlayer.multiplyScalar(rspeed * 1.7), Math.min(1, dt * 2.2));
            }
          }
        }
        stepSoulMotion(s, dt, time, shellR * (0.99 + 0.03 * Math.sin(s.seed)));
      } else {
        // мягкий орбитальный дрейф
        if (s.vel.lengthSq() < 1e-4) {
          const t = _tmp2.set(0, 1, 0).cross(s.n);
          if (t.lengthSq() < 1e-6) t.set(1, 0, 0);
          s.vel.copy(t).normalize().multiplyScalar(shellR * 0.006 * (0.5 + this.rng()));
        }
        stepSoulMotion(s, dt, time, shellR);
      }

      // визуал
      if (s.mesh) {
        s.mesh.position.copy(s.pos);
        const bobY = Math.sin(time * 1.4 + s.bob) * 1.2;
        s.mesh.position.addScaledVector(s.n, bobY);
        // преследующий дух пульсирует злее и чуть крупнее
        const redRate = s.chase ? 7.5 : 3.2;
        const redAmp = s.chase ? 0.13 : 0.07;
        const pulse = 1 + Math.sin(time * (s.kind === 'red' ? redRate : 2.1) + s.seed)
          * (s.kind === 'red' ? redAmp : 0.12);
        const fadeScale = s.kind === 'red' ? 1 : s.spawnFade;
        // обжигающийся в луче дух «сыплется» — уменьшается вместе с HP
        const burnShrink = s.kind === 'red' ? 0.55 + 0.45 * Math.max(0, s.hp) / SPIRITS.HP : 1;
        const chaseBoost = s.chase ? 1.12 : 1;
        s.mesh.scale.setScalar(pulse * (0.5 + 0.5 * fadeScale) * chaseBoost * burnShrink);
        if (s.kind === 'red') {
          s.mesh.lookAt(0, 0, 0);
          s.mesh.rotateY(Math.PI);
        }
      }

      // --- коллизии с игроком (сфера) ---
      const hitR = (s.kind === 'red' ? PLAYER.SPIRIT_HIT_RADIUS : PLAYER.COLLECT_RADIUS) + s.radius * 0.4;
      const d2 = s.pos.distanceToSquared(playerPos);
      if (d2 < hitR * hitR && s.spawnFade > 0.55) {
        if (s.kind === 'red') {
          spiritTouched.push(s);
          this.removeAt(i);
          this.redDied(); // дух рассеялся — поддержим численность за спиной игрока
        } else {
          collected.push(s);
          this.removeAt(i);
        }
        continue;
      }
      // мусорный сбор: очень далеко от орбитального пояса — в пул
      const r = s.pos.length();
      if (r < WORLD.ORBIT_RADIUS * 0.5 || this.souls.length > POOL.MAX_ENTITIES) {
        this.removeAt(i);
      }
    }

    // --- «замена павших»: смерть красного мгновенно порождает нового ДАЛЕКО от
    //     игрока (за спиной, за краем обзора на макс. зуме). Без уведомлений —
    //     просто плотность врагов не падает. ---
    while (this.pendingRespawns > 0) {
      this.pendingRespawns--;
      this.spawn('red', playerDir, false, true);
    }
    return { collected, spiritTouched };
  }

  /** смерть красного: 1-в-1 замена за спиной (на след. тике update) */
  private redDied(): void { this.pendingRespawns++; }
  private pendingRespawns = 0;

  /**
   * Луч головы жжёт духов в своём конусе. axisDir — мировая единичная ось луча.
   * Позиции сгоревших — в out. Возвращает число сгоревших.
   */
  beamBurn(axisDir: Vector3, dt: number, out: Vector3[]): number {
    let killed = 0;
    for (let i = this.souls.length - 1; i >= 0; i--) {
      const s = this.souls[i];
      if (!s.alive || s.kind !== 'red') continue;
      if (s.n.angleTo(axisDir) > SPIRITS.BURN_CONE) continue;
      s.hp -= SPIRITS.BURN_PER_SEC * dt;
      if (s.hp <= 0) {
        out.push(s.pos.clone());
        this.removeAt(i);
        this.redDied();
        killed++;
      }
    }
    return killed;
  }

  /**
   * Золотая волна: испепелить ближайших красных духов вокруг точки.
   * Пушит позиции убитых в `out` (опционально) и возвращает число.
   */
  purgeRedsNear(center: Vector3, radius: number, out?: Vector3[]): number {
    let killed = 0;
    const r2 = radius * radius;
    for (let i = this.souls.length - 1; i >= 0; i--) {
      const s = this.souls[i];
      if (s.kind === 'red' && s.alive && s.pos.distanceToSquared(center) < r2) {
        if (out) out.push(s.pos.clone());
        this.retire(s);
        this.souls.splice(i, 1);
        this.redDied(); // золотая волна не «разбирает» сложность — место займёт новый дух
        killed++;
      }
    }
    return killed;
  }

  /** доводит число живых типа до цели (не более budget за тик — волнами) */
  private refill(kind: SoulKind, target: number, playerDir: Vector3, danger = 0): void {
    let c = this.count(kind);
    let budget = kind === 'red' ? 3 : 4; // плотность ×2 — заполнять бодрее
    while (c < target && budget-- > 0 && this.souls.length < POOL.MAX_ENTITIES) {
      // красные духи ближе к позднему геймплею спавнятся «в стороне игрока»,
      // но изредка — рядом (искушение/угроза)
      const near = kind === 'red' && danger > 0.3 && this.rng() < 0.25;
      this.spawn(kind, playerDir, near);
      c++;
    }
  }

  /** QA-хук: сущность данного типа прямо у игрока (для автотестов) */
  debugKindAt(kind: SoulKind, pos: Vector3): void {
    const sd = makeSoul(kind, this.rng, new Vector3(0, 0, 1), 0);
    sd.pos.copy(pos).add(_tmp.set(0, 2, 2));
    sd.n.copy(sd.pos).normalize();
    sd.spawnFade = 1;
    const mesh = this.obtainMesh(kind, sd.large);
    mesh.position.copy(sd.pos);
    sd.mesh = mesh;
    this.root.add(mesh);
    this.souls.push(sd);
  }
  /** QA-хук: дух прямо у игрока (для автотестов scripted-события) */
  debugSpiritAt(pos: Vector3): void {
    this.debugKindAt('red', pos);
  }
}
