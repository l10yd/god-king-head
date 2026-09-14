/**
 * World.ts — окружение: бесконечно далёкие звёзды, туманность-небо,
 * орбитальная пыль (подсказка сферического движения), свет.
 * Всё — процедурные шейдеры + Points, без внешних ассетов.
 */
import {
  Scene, PerspectiveCamera, Group, Mesh, Points, BufferGeometry, BufferAttribute,
  SphereGeometry, Vector3, DirectionalLight, HemisphereLight, Color, FogExp2, ShaderMaterial,
} from 'three';
import { createStarsMaterial, createDustMaterial, createNebulaMaterial } from '../render/Shaders';
import { WORLD, QUALITY_PRESETS, type QualityPreset } from '../constants';
import { mulberry32 } from '../math/rng';

export class World {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  private stars: Points;
  private dust: Points;
  private nebula: Mesh;
  private preset: QualityPreset;
  /** звёзды медленно «дышат» вместе со временем */
  private time = 0;

  constructor(preset: QualityPreset, camera: PerspectiveCamera) {
    this.preset = preset;
    this.camera = camera;

    this.scene.fog = new FogExp2(0x05070f, 0.00028);

    // --- небо-туманность (ogromная back-side сфера) ---
    this.nebula = new Mesh(new SphereGeometry(9000, 48, 32), createNebulaMaterial());
    this.nebula.frustumCulled = false;
    this.nebula.renderOrder = -10;
    this.scene.add(this.nebula);

    // --- звёзды ---
    this.stars = this.buildStars(preset.stars);
    this.scene.add(this.stars);

    // --- орбитальная пыль вокруг головы (вдоль оболочки игрока) ---
    this.dust = this.buildDust(preset.dust);
    this.scene.add(this.dust);

    // --- свет: стандартным материалам (игрок) нужен свет; голова считает свой ---
    const key = new DirectionalLight(0xbcc8e8, 2.2);
    key.position.set(420, 700, 520);
    this.scene.add(key);
    const hemi = new HemisphereLight(0x1a2136, 0x04050a, 1.1);
    this.scene.add(hemi);
    const fill = new DirectionalLight(0x223047, 0.7);
    fill.position.set(-500, -220, -420);
    this.scene.add(fill);
  }

  private buildStars(count: number): Points {
    const rng = mulberry32(1234);
    const pos = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const u = rng() * 2 - 1;
      const th = rng() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const r = 8600 * (0.85 + rng() * 0.15);
      pos[i * 3] = r * s * Math.cos(th);
      pos[i * 3 + 1] = r * u;
      pos[i * 3 + 2] = r * s * Math.sin(th);
      sizes[i] = 0.7 + Math.pow(rng(), 3) * 3.4;
      phases[i] = rng();
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new BufferAttribute(sizes, 1));
    geo.setAttribute('aPhase', new BufferAttribute(phases, 1));
    const p = new Points(geo, createStarsMaterial());
    p.frustumCulled = false;
    return p;
  }

  private buildDust(count: number): Points {
    const rng = mulberry32(777);
    const pos = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const r0 = WORLD.ORBIT_RADIUS;
    for (let i = 0; i < count; i++) {
      const u = rng() * 2 - 1;
      const th = rng() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      // оболочка вокруг орбиты + немножко «внутренних» частиц у головы
      const near = rng() < 0.22;
      const r = near ? r0 * (0.35 + rng() * 0.4) : r0 * (0.9 + rng() * 0.24);
      pos[i * 3] = r * s * Math.cos(th);
      pos[i * 3 + 1] = r * u;
      pos[i * 3 + 2] = r * s * Math.sin(th);
      sizes[i] = 0.5 + rng() * 1.6;
      phases[i] = rng();
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new BufferAttribute(sizes, 1));
    geo.setAttribute('aPhase', new BufferAttribute(phases, 1));
    const p = new Points(geo, createDustMaterial());
    p.frustumCulled = false;
    return p;
  }

  setQuality(preset: QualityPreset): void {
    // реконструкция облаков при смене плотности
    (this.scene as Scene).remove(this.stars);
    (this.scene as Scene).remove(this.dust);
    this.stars.geometry.dispose();
    this.dust.geometry.dispose();
    this.stars = this.buildStars(preset.stars);
    this.dust = this.buildDust(preset.dust);
    this.scene.add(this.stars, this.dust);
    this.preset = preset;
  }

  update(dt: number, cameraPos: Vector3): void {
    this.time += dt;
    (this.stars.material as ShaderMaterial).uniforms.uTime.value = this.time;
    (this.dust.material as ShaderMaterial).uniforms.uTime.value = this.time;
    (this.nebula.material as ShaderMaterial).uniforms.uTime.value = this.time;
    // бесконечность: небо и звёзды «едут» за камерой
    this.stars.position.copy(cameraPos);
    this.dust.position.set(0, 0, 0); // пыль привязана к голове — это якорь масштаба
    this.nebula.position.copy(cameraPos);
    // очень медленный дрейф пыли — ощущение жизни пространства
    this.dust.rotation.y += dt * 0.006;
    this.dust.rotation.x = Math.sin(this.time * 0.02) * 0.05;
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
