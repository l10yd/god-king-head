/**
 * SoulField — менеджер популяции и коллизий всех сущностей.
 *
 * Пул объектов: mesh'и переиспользуются (никаких new каждый кадр).
 * Целевая плотность — из Difficulty. Красные духи: дрейф → группировка →
 * преследование (вероятность растёт с danger).
 */
import { Group, Vector3 } from 'three';
import { WORLD, PLAYER, DIFFICULTY } from '../constants';
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
  }

  /** Начальная раскладка рана: мало душ, «тихая гавань» */
  seedInitialRun(playerDir: Vector3): void {
    for (let i = 0; i < 15; i++) this.spawn('blue', playerDir);
    for (let i = 0; i < 5; i++) this.spawn('green', playerDir);
    for (let i = 0; i < DIFFICULTY.PHASES[0].red; i++) this.spawn('red', playerDir);
  }

  /** Кол-во живых данного типа */
  count(kind: SoulKind): number {
    let c = 0;
    for (const s of this.souls) if (s.kind === kind && s.alive) c++;
    return c;
  }

  private spawn(kind: SoulKind, playerDir: Vector3, nearPlayer = false): void {
    const sd = makeSoul(kind, this.rng, playerDir, nearPlayer ? 0.25 : 0.7);
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
    const chase = redChaseChance(danger);
    for (let i = this.souls.length - 1; i >= 0; i--) {
      const s = this.souls[i];
      if (!s.alive) { this.removeAt(i); continue; }

      if (s.kind === 'red') {
        // дрейф + иногда преследование
        if (s.vel.lengthSq() < 0.01 || this.rng() < 0.016) {
          const dir = orbitRandom(this.rng);
          const sinP = Math.sin(dir.phi);
          _tmp2.set(sinP * Math.sin(dir.theta), Math.cos(dir.phi), sinP * Math.cos(dir.theta));
          const t = _tmp2.sub(s.n).normalize();
          s.vel.copy(t).multiplyScalar(rspeed * (0.6 + 0.5 * this.rng()));
        }
        // преследование: с вероятностью chase на «перезагрузке» — лок в сторону игрока
        if (chase > 0.02 && (awakened || danger > 0.08)) {
          if (!s.chase && this.rng() < dt * chase * 0.55) s.chase = true;
          if (s.chase) {
            if (this.rng() < dt * 0.12) s.chase = false;
            const toPlayer = _tmp2.copy(playerPos).sub(s.pos);
            const dist = toPlayer.length();
            toPlayer.addScaledVector(s.n, -toPlayer.dot(s.n));
            if (toPlayer.lengthSq() > 1e-6) {
              toPlayer.normalize();
              const speed = rspeed * (dist > 90 ? 1.5 : 0.75);
              s.vel.lerp(toPlayer.multiplyScalar(speed), Math.min(1, dt * 1.8));
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
        const pulse = 1 + Math.sin(time * (s.kind === 'red' ? 3.2 : 2.1) + s.seed) * (s.kind === 'red' ? 0.07 : 0.12);
        const fadeScale = s.kind === 'red' ? 1 : s.spawnFade;
        s.mesh.scale.setScalar(pulse * (0.5 + 0.5 * fadeScale));
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
        } else {
          collected.push(s);
          this.removeAt(i);
        }
        continue;
      }
      // мусорный сбор: очень далеко от орбитального пояса — в пул
      const r = s.pos.length();
      if (r < WORLD.ORBIT_RADIUS * 0.5 || this.souls.length > 140) {
        this.removeAt(i);
      }
    }
    return { collected, spiritTouched };
  }

  /** доводит число живых типа до цели (не более 2 за тик — волнами) */
  private refill(kind: SoulKind, target: number, playerDir: Vector3, danger = 0): void {
    let c = this.count(kind);
    let budget = 2;
    while (c < target && budget-- > 0 && this.souls.length < 120) {
      // красные духи ближе к позднему геймплею спавнятся «в стороне игрока»,
      // но изредка — рядом (искушение/угроза)
      const near = kind === 'red' && danger > 0.3 && this.rng() < 0.25;
      this.spawn(kind, playerDir, near);
      c++;
    }
  }

  /** QA-хук: дух прямо у игрока (для автотестов scripted-события) */
  debugSpiritAt(pos: Vector3): void {
    const sd = makeSoul('red', this.rng, new Vector3(0, 0, 1), 0);
    sd.pos.copy(pos).add(_tmp.set(0, 2, 2));
    sd.n.copy(sd.pos).normalize();
    sd.spawnFade = 1;
    const mesh = this.obtainMesh('red', false);
    mesh.position.copy(sd.pos);
    sd.mesh = mesh;
    this.root.add(mesh);
    this.souls.push(sd);
  }
}
