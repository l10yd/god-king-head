/**
 * ParticleSystem — единый CPU-пул частиц (Points) на все эффекты:
 * всплески сбора, дымка луча, шлейф игрока, обломки смерти, dust при
 * повороте головы. Никаких аллокаций в кадре: всё в typed arrays.
 */
import { Points, BufferGeometry, BufferAttribute, Vector3, ShaderMaterial, AdditiveBlending } from 'three';
import { createParticlesMaterial } from '../render/Shaders';
import { POOL } from '../constants';

export class ParticleSystem {
  readonly points: Points;
  private max: number;
  private cursor = 0;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;      // 1 → 0
  private decay: Float32Array;     // 1/сек
  private size: Float32Array;
  private col: Float32Array;
  private drag: Float32Array;
  private aPos: BufferAttribute;
  private aLife: BufferAttribute;
  private aSize: BufferAttribute;
  private aCol: BufferAttribute;
  private _v = new Vector3();
  activeCount = 0;

  constructor(max = POOL.MAX_PARTICLES) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.decay = new Float32Array(max);
    this.size = new Float32Array(max);
    this.col = new Float32Array(max * 3);
    this.drag = new Float32Array(max);
    const geo = new BufferGeometry();
    this.aPos = new BufferAttribute(this.pos, 3).setUsage(35048); // DynamicDrawUsage
    this.aLife = new BufferAttribute(this.life, 1).setUsage(35048);
    this.aSize = new BufferAttribute(this.size, 1).setUsage(35048);
    this.aCol = new BufferAttribute(this.col, 3).setUsage(35048);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aLife', this.aLife);
    geo.setAttribute('aSize', this.aSize);
    geo.setAttribute('aColor', this.aCol);
    geo.boundingSphere = { radius: 1e9, center: new Vector3() } as never; // никогда не culлить
    const mat: ShaderMaterial = createParticlesMaterial();
    this.points = new Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 12;
  }

  /** кольцевой буфер: старые частицы тихо перетираются при перегрузе */
  spawn(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    lifeSec: number, sizeVal: number,
    r: number, g: number, b: number,
    drag = 1.2,
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.life[i] = 1;
    this.decay[i] = 1 / Math.max(0.05, lifeSec);
    this.size[i] = sizeVal;
    this.col[i3] = r; this.col[i3 + 1] = g; this.col[i3 + 2] = b;
    this.drag[i] = drag;
  }

  burst(
    at: Vector3, count: number, spread: number, lifeSec: number, sizeVal: number,
    r: number, g: number, b: number, speed = 18,
  ): void {
    for (let k = 0; k < count; k++) {
      const th = Math.random() * Math.PI * 2;
      const c = Math.random() * 2 - 1;
      const s = Math.sqrt(1 - c * c);
      const sp = speed * (0.35 + Math.random() * 0.85);
      this.spawn(
        at.x + s * Math.cos(th) * spread, at.y + c * spread, at.z + s * Math.sin(th) * spread,
        s * Math.cos(th) * sp, c * sp, s * Math.sin(th) * sp,
        lifeSec * (0.6 + Math.random() * 0.8), sizeVal * (0.6 + Math.random() * 0.9),
        r, g, b,
      );
    }
  }

  update(dt: number): void {
    let live = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= this.decay[i] * dt;
      if (this.life[i] <= 0) { this.life[i] = 0; this.size[i] = 0; continue; }
      const i3 = i * 3;
      const dfac = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= dfac; this.vel[i3 + 1] *= dfac; this.vel[i3 + 2] *= dfac;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      live++;
    }
    this.activeCount = live;
    this.aPos.needsUpdate = true;
    this.aLife.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aCol.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.size.fill(0);
    this.aLife.needsUpdate = true;
    this.aSize.needsUpdate = true;
  }
}
