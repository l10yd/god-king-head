/**
 * HeadSculpt — процедурная «лепка» головы Бога-Короля из сферы.
 *
 * Идея: стартуем с UV-сферы; голова смотрит по +Z, верх по +Y.
 * Для каждого направления на сфере радиальное смещение = сумма
 * проективных гауссиан («эллиптических фич») в касательном базисе
 * центра фичи:
 *   + амплитуда = выступ (нос, скулы, надбровье, подбородок, губы)
 *   - амплитуда = углубление (глазницы, виски)
 * Базовый эллипсоид вытягивает череп куполом и сужает лицо к челюсти.
 *
 * Ядро — чистые функции от направления: детерминированно, симметрично,
 * покрывается юнит-тестами (симметрия L/R, монотонность профиля).
 */
import { Vector3, SphereGeometry, BufferGeometry, BufferAttribute } from 'three';

export interface Feature {
  /** направление центра фичи в пространстве головы (нормализуется) */
  dir: [number, number, number];
  /** амплитуда в долях радиуса */
  amp: number;
  /** угловой радиус (рад) */
  sigma: number;
  /** множитель ширины по горизонтали (1 = изотропно) */
  rx?: number;
  /** множитель ширины по вертикали */
  ry?: number;
}

const V_UP = new Vector3(0, 1, 0);
const _c = new Vector3();
const _u = new Vector3();
const _v = new Vector3();

/**
 * Проективная гауссиана: координаты точки (p — единичный вектор)
 * в касательной плоскости центра c: tx = (p·u)/(p·c), ty = (p·v)/(p·c).
 * weight = exp(-( (tx/rx)² + (ty/ry)² ) / 2σ²), с затуханием за краем.
 */
function featureWeight(px: number, py: number, pz: number, f: Feature,
                       c: Vector3, u: Vector3, v: Vector3): number {
  const a = px * c.x + py * c.y + pz * c.z; // cos углового расстояния
  if (a <= 0.05) return 0; // за горизонтом фичи
  const tx = (px * u.x + py * u.y + pz * u.z) / a;
  const ty = (px * v.x + py * v.y + pz * v.z) / a;
  const rx = f.rx ?? 1;
  const ry = f.ry ?? 1;
  const d2 = (tx / rx) * (tx / rx) + (ty / ry) * (ty / ry);
  return Math.exp(-d2 / (2 * f.sigma * f.sigma));
}

/** Подготавливает ортонормированный базис фичи (c, u — горизонталь, v — вертикаль) */
function basis(f: Feature, c: Vector3, u: Vector3, v: Vector3): void {
  c.set(f.dir[0], f.dir[1], f.dir[2]).normalize();
  u.crossVectors(V_UP, c);
  if (u.lengthSq() < 1e-6) u.set(1, 0, 0); // для полярных центров
  u.normalize();
  v.crossVectors(c, u).normalize();
}

/** Анатомический профиль Бога-Короля. amp — доли радиуса. Лицо к +Z. */
export const FACE_FEATURES: readonly Feature[] = [
  // --- Глазницы: глубокие, тяжёлые, чуть «раскосые» ---
  { dir: [-0.34, 0.14, 0.93], amp: -0.13, sigma: 0.155, rx: 1.25, ry: 0.85 },
  { dir: [0.34, 0.14, 0.93], amp: -0.13, sigma: 0.155, rx: 1.25, ry: 0.85 },
  // --- Надбровный карниз — массивная «козырьба» ---
  { dir: [-0.20, 0.315, 0.94], amp: 0.05, sigma: 0.13, rx: 1.55, ry: 0.7 },
  { dir: [0.20, 0.315, 0.94], amp: 0.05, sigma: 0.13, rx: 1.55, ry: 0.7 },
  { dir: [0.0, 0.345, 0.96], amp: 0.038, sigma: 0.11, rx: 2.3, ry: 0.6 },
  // --- Нос: горбина + массивный кончик + крылья ---
  { dir: [0.0, 0.05, 0.999], amp: 0.062, sigma: 0.085, rx: 0.55, ry: 1.75 },
  { dir: [0.0, -0.115, 0.99], amp: 0.10, sigma: 0.10, rx: 0.85, ry: 1.35 },
  { dir: [-0.058, -0.185, 0.98], amp: 0.035, sigma: 0.062, rx: 0.85, ry: 0.85 },
  { dir: [0.058, -0.185, 0.98], amp: 0.035, sigma: 0.062, rx: 0.85, ry: 0.85 },
  // --- Скулы: огромные, «божественные» ---
  { dir: [-0.60, -0.085, 0.79], amp: 0.075, sigma: 0.185, rx: 1.35, ry: 0.9 },
  { dir: [0.60, -0.085, 0.79], amp: 0.075, sigma: 0.185, rx: 1.35, ry: 0.9 },
  // --- Щели рта: тяжёлые губы с впадиной между ---
  { dir: [0.0, -0.42, 0.905], amp: 0.042, sigma: 0.10, rx: 1.8, ry: 0.6 },
  { dir: [0.0, -0.472, 0.885], amp: -0.028, sigma: 0.055, rx: 1.6, ry: 0.35 },
  { dir: [0.0, -0.535, 0.855], amp: 0.045, sigma: 0.095, rx: 1.45, ry: 0.55 },
  // --- Подбородок и челюстные углы ---
  { dir: [0.0, -0.66, 0.76], amp: 0.088, sigma: 0.15, rx: 1.15, ry: 1.35 },
  { dir: [-0.30, -0.55, 0.78], amp: 0.042, sigma: 0.17, rx: 0.95, ry: 1.45 },
  { dir: [0.30, -0.55, 0.78], amp: 0.042, sigma: 0.17, rx: 0.95, ry: 1.45 },
  // --- Виски ---
  { dir: [-0.80, 0.28, 0.54], amp: -0.034, sigma: 0.20 },
  { dir: [0.80, 0.28, 0.54], amp: -0.034, sigma: 0.20 },
  // --- Лоб: высокий, величественный ---
  { dir: [0.0, 0.52, 0.86], amp: 0.055, sigma: 0.21, rx: 1.65, ry: 1.15 },
  // --- Теменной купол ---
  { dir: [0.0, 0.92, 0.34], amp: 0.05, sigma: 0.30, rx: 1.2, ry: 1.2 },
  // --- Затылок держим округлым ---
  { dir: [0.0, 0.25, -0.96], amp: 0.03, sigma: 0.28 },
];

/** Кэш базисов фич — чтобы не пересчитывать на каждом из ~40k вершин */
const CACHED_BASES = FACE_FEATURES.map((f) => {
  const c = new Vector3(); const u = new Vector3(); const v = new Vector3();
  basis(f, c, u, v);
  return { f, c, u, v };
});

/**
 * Радиальное смещение (доли радиуса) для единичного направления лица головы.
 */
export function radialOffset(nx: number, ny: number, nz: number): number {
  let sum = 0;
  for (let i = 0; i < CACHED_BASES.length; i++) {
    const b = CACHED_BASES[i];
    sum += b.f.amp * featureWeight(nx, ny, nz, b.f, b.c, b.u, b.v);
  }
  return sum;
}

/** Базовая форма: купол черепа, уплощённый затылок, сужение к челюсти */
export function baseShape(out: Vector3, nx: number, ny: number, nz: number, r: number): Vector3 {
  let x = nx * r * 0.90;
  const y = ny * r * (ny > 0 ? 1.16 : 1.0);
  let z = nz * r * 1.05;
  if (ny < 0) {
    const t = Math.min(1, -ny / 0.85);
    if (nz > 0) x *= 1 - 0.34 * t; // сужаем передне-боковые части к челюсти
    z *= 1 + 0.05 * t;             // подбородок чуть вперёд
  }
  if (nz < 0) z *= 1 - 0.04;       // мягкий затылок
  return out.set(x, y, z);
}

/** Детерминированный хеш-шум для «каменной эрозии» вершин (CPU-версия) */
function vhash(x: number, y: number, z: number): number {
  let h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
function vnoise(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const n = (dx: number, dy: number, dz: number) => vhash(ix + dx, iy + dy, iz + dz);
  const nx00 = n(0, 0, 0) + (n(1, 0, 0) - n(0, 0, 0)) * sx;
  const nx10 = n(0, 1, 0) + (n(1, 1, 0) - n(0, 1, 0)) * sx;
  const nx01 = n(0, 0, 1) + (n(1, 0, 1) - n(0, 0, 1)) * sx;
  const nx11 = n(0, 1, 1) + (n(1, 1, 1) - n(0, 1, 1)) * sx;
  return (nx00 + (nx10 - nx00) * sy) + ((nx01 + (nx11 - nx01) * sy) - (nx00 + (nx10 - nx00) * sy)) * sz;
}
function erode(nvx: number, nvy: number, nvz: number): number {
  let v = 0, a = 0.5, px = nvx * 5.2, py = nvy * 5.2, pz = nvz * 5.2;
  for (let i = 0; i < 3; i++) {
    v += a * (vnoise(px, py, pz) * 2 - 1);
    px = px * 2.13 + 17.1; py = py * 2.13 + 9.2; pz = pz * 2.13 + 3.7;
    a *= 0.5;
  }
  return v;
}

/**
 * Строит BufferGeometry головы радиуса r (лицом к +Z), с baked-вершинными
 * атрибутами: aVeinMask — «каналы» под светящиеся прожилки.
 */
export function buildHeadGeometry(r: number, segments = 176): BufferGeometry {
  const geo = new SphereGeometry(r, segments, Math.round(segments * 0.74));
  const pos = geo.attributes.position as BufferAttributeLike;
  const dir = new Vector3();
  const base = new Vector3();
  const veins = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    dir.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    const disp = radialOffset(dir.x, dir.y, dir.z) * r;
    const erosion = erode(dir.x, dir.y, dir.z) * r * 0.014;
    baseShape(base, dir.x, dir.y, dir.z, r);
    base.addScaledVector(dir, disp + erosion);
    pos.setXYZ(i, base.x, base.y, base.z);
    // маска прожилок: ridged-шум по направлению
    const rv = 1 - Math.abs(erode(dir.x * 2.3 + 40, dir.y * 2.3, dir.z * 2.3) * 2);
    veins[i] = Math.pow(Math.max(0, Math.min(1, rv)), 3);
  }
  geo.setAttribute('aVeinMask', new BufferAttribute(veins, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** Типизация для обхода buffer-атрибутов без генериков three */
interface BufferAttributeLike {
  count: number;
  getX(i: number): number;
  getY(i: number): number;
  getZ(i: number): number;
  setXYZ(i: number, x: number, y: number, z: number): void;
}

/** Направления центров глаз (для позиционирования глазниц/глазных яблок) */
export const EYE_DIRS = {
  left: new Vector3(-0.34, 0.14, 0.93).normalize(),
  right: new Vector3(0.34, 0.14, 0.93).normalize(),
};

/** Радиус глазного яблока (доля от радиуса головы) */
export const EYEBALL_RATIO = 0.088;
/** Насколько глаз утоплен в глазницу (доля радиуса за поверхностью) */
export const EYEBALL_DEPTH = 0.88;
