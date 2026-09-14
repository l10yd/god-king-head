/**
 * Soul.ts — сущности на орбите: синие/золотые души (очки),
 * зелёные (HP), красные духи (опасность + разгон головы).
 *
 * Живут на тонкой сферической оболочке вокруг головы; дрейф — по касательной
 * с перепроецированием на сферу (как у игрока, но медленнее).
 * Геометрия кэшируется по типу — все сущности делят несколько буферов.
 */
import {
  Group, Mesh, Vector3, Color, Sprite, SpriteMaterial, AdditiveBlending,
  IcosahedronGeometry, CapsuleGeometry, SphereGeometry, ConeGeometry, BufferGeometry,
} from 'three';
import { createSoulMaterial, createSpiritMaterial, createGlowSpriteMaterial } from '../render/Shaders';
import { makeGlowTexture } from '../render/Textures';
import { WORLD } from '../constants';
import { orbitRandom } from '../math/Orbit';
import type { Rng } from '../math/rng';

export type SoulKind = 'blue' | 'green' | 'gold' | 'red';

export interface SoulData {
  kind: SoulKind;
  large: boolean;
  /** позиция ОТНОСИТЕЛЬНО центра головы (в метрах) */
  pos: Vector3;
  /** единичный радиальный вектор */
  n: Vector3;
  vel: Vector3;
  radius: number;
  alive: boolean;
  /** радиус «поля» духа для группировки */
  chase: boolean;
  seed: number;
  mesh: Group | null;
  bob: number;
  /** секунды в режиме погони (для «поводка») */
  chaseT: number;
  /** инверсия материализации (0→1 за ~0.6c, защита от спавна «в игрока») */
  spawnFade: number;
}

/** Кэш геометрий: ключ = тип+размер */
const geoCache = new Map<string, BufferGeometry>();
function cached<T extends BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g as T;
}

export function soulRadius(kind: SoulKind, large: boolean): number {
  if (kind === 'red') return 4.2;
  if (kind === 'gold') return 2.4;
  if (large) return 2.6;
  if (kind === 'green') return 1.9;
  return 1.6;
}

/** Спавн-позиция вне «зоны появления» игрока: minAngle — угол от игрока */
export function pickSpawnPosition(rng: Rng, playerDir: Vector3, minAngle: number, out: Vector3): Vector3 {
  const shellMin = WORLD.ORBIT_RADIUS * WORLD.SOUL_SHELL_MIN;
  const shellMax = WORLD.ORBIT_RADIUS * WORLD.SOUL_SHELL_MAX;
  for (let i = 0; i < 12; i++) {
    const s = orbitRandom(rng);
    const sinPhi = Math.sin(s.phi);
    out.set(sinPhi * Math.sin(s.theta), Math.cos(s.phi), sinPhi * Math.cos(s.theta));
    if (out.dot(playerDir) < Math.cos(minAngle)) {
      out.multiplyScalar(shellMin + (shellMax - shellMin) * rng());
      return out;
    }
  }
  out.multiplyScalar(shellMin + (shellMax - shellMin) * rng());
  return out;
}

export function makeSoul(kind: SoulKind, rng: Rng, playerDir: Vector3, minAngle = 0.5): SoulData {
  const pos = new Vector3();
  pickSpawnPosition(rng, playerDir, minAngle, pos);
  const large = kind === 'blue' && rng() < 0.16;
  const n = pos.clone().normalize();
  const r = soulRadius(kind, large);
  return {
    kind,
    large,
    pos,
    n,
    vel: new Vector3(),
    radius: r,
    alive: true,
    chase: false,
    seed: rng() * 100,
    mesh: null,
    bob: rng() * Math.PI * 2,
    chaseT: 0,
    spawnFade: 0,
  };
}

/** Создание визуала души (материал на сущность — дешёвый; геометрия общая) */
export function createSoulMesh(kind: SoulKind, large: boolean): Group {
  const g = new Group();
  const r = soulRadius(kind, large);
  if (kind === 'red') {
    g.add(buildSpirit(r));
    return g;
  }
  const hex = kind === 'blue' ? 0x33d6ff : kind === 'green' ? 0x3aff88 : 0xffcf4d;
  const core = new Mesh(cached(`soul-${r.toFixed(1)}`, () => new IcosahedronGeometry(r, 2)), createSoulMaterial(hex, true));
  g.add(core);
  // Нимб — спрайт МЯГКОЙ КРУГЛОЙ glow-текстуры. Без map спрайт — ровный
  // аддитивный КВАДРАТ (это и было «двойное квадратное гало» в фидбеке).
  const halo = new Sprite(new SpriteMaterial({
    map: haloGlow(), color: new Color(hex), transparent: true,
    opacity: kind === 'gold' ? 0.6 : 0.42,
    blending: AdditiveBlending, depthWrite: false,
  }));
  halo.scale.setScalar(r * (kind === 'gold' ? 4.4 : 3.4));
  g.add(halo);
  if (large || kind === 'gold') {
    // второй, более широкий и очень мягкий слой — только у крупных/золотых
    const halo2 = new Sprite(new SpriteMaterial({
      map: haloGlow(), color: new Color(hex), transparent: true,
      opacity: 0.18, blending: AdditiveBlending, depthWrite: false,
    }));
    halo2.scale.setScalar(r * 7);
    g.add(halo2);
  }
  return g;
}

let _haloTex: ReturnType<typeof makeGlowTexture> | null = null;
function haloGlow() {
  if (!_haloTex) _haloTex = makeGlowTexture(128);
  return _haloTex;
}

const eyeGeo = cached('spirit-eye', () => new SphereGeometry(1, 8, 8));
const eyeMat = createGlowSpriteMaterial(0xff4a28, 1.1);

/** «призрачный» человекоподобный силуэт: торс-капсула, голова, глаза-щели, дымные крылья */
function buildSpirit(r: number): Group {
  const g = new Group();
  const mat = createSpiritMaterial();
  const body = new Mesh(cached('spirit-body', () => new CapsuleGeometry(0.55, 0.9, 6, 12)), mat);
  body.scale.setScalar(r);
  body.position.y = r * 0.2;
  g.add(body);
  const head = new Mesh(cached('spirit-head', () => new SphereGeometry(0.42, 14, 12)), mat);
  head.scale.setScalar(r);
  head.position.y = r * 1.15;
  g.add(head);
  for (const s of [-1, 1]) {
    const eye = new Mesh(eyeGeo, eyeMat);
    eye.scale.set(r * 0.1, r * 0.055, r * 0.06);
    eye.position.set(s * r * 0.16, r * 1.18, r * 0.36);
    g.add(eye);
  }
  const wingGeo = cached('spirit-wing', () => new ConeGeometry(0.7, 1.6, 8, 1, true));
  for (const s of [-1, 1]) {
    const wing = new Mesh(wingGeo, mat);
    wing.scale.setScalar(r);
    wing.position.set(s * r * 0.85, r * 0.15, -r * 0.45);
    wing.rotation.set(-0.55, 0, s * 0.95);
    g.add(wing);
  }
  return g;
}

/**
 * Шаг дрейфа сущности: скорость vel (м/с, касательная) + лёгкая «рысь»
 * по нормали (bob). Перепроецирование на оболочку не даёт улететь/провалиться.
 */
export function stepSoulMotion(sd: SoulData, dt: number, time: number, shellR: number): void {
  if (sd.vel.lengthSq() > 0) {
    const radial = sd.vel.dot(sd.n);
    sd.vel.addScaledVector(sd.n, -radial);
    sd.pos.addScaledVector(sd.vel, dt);
  }
  // держим на оболочке с лёгким «дыханием» радиуса
  const targetR = shellR * (1 + Math.sin(time * 0.6 + sd.bob) * 0.012);
  const curR = sd.pos.length();
  const k = 1 + ((targetR - curR) / Math.max(curR, 1e-3)) * Math.min(1, dt * 0.9);
  sd.pos.multiplyScalar(k);
  sd.n.copy(sd.pos).normalize();
  if (sd.spawnFade < 1) sd.spawnFade = Math.min(1, sd.spawnFade + dt * 1.8);
}
