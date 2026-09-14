/**
 * HeadParts — веки, «разрушенный постамент», корона Бога-Короля.
 * Вся геометрия процедурная и детерминированная.
 */
import { BufferGeometry, BufferAttribute, Vector3, SphereGeometry, CylinderGeometry } from 'three';
import { radialOffset, baseShape, type Feature } from './HeadSculpt';

const _c = new Vector3();
const _u = new Vector3();
const _v = new Vector3();
const _d = new Vector3();
const _base = new Vector3();

/** Радиус поверхности головы вдоль направления (mirrors HeadSculpt math) */
export function skullSurfaceRadius(nx: number, ny: number, nz: number, R: number): number {
  _d.set(nx, ny, nz).normalize();
  baseShape(_base, _d.x, _d.y, _d.z, R);
  const disp = radialOffset(_d.x, _d.y, _d.z) * R;
  return _base.addScaledVector(_d, disp).length();
}

function basisOf(dir: [number, number, number], c: Vector3, u: Vector3, v: Vector3): void {
  c.set(...dir).normalize();
  u.crossVectors(new Vector3(0, 1, 0), c);
  if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
  u.normalize();
  v.crossVectors(c, u).normalize();
}

/**
 * Геометрия века: эллиптический «колпачок», облегающий глазницу.
 * @param eyeDir направление центра глаза
 * @param upper верхнее (тяжёлое) или нижнее веко
 * @returns geometry в локальных координатах головы (pivot не включён)
 */
export function buildLidGeometry(
  R: number,
  eyeDir: Vector3,
  upper: boolean,
  nu = 26,
  nv = 14,
): { geo: BufferGeometry; hingePoint: Vector3; hingeAxis: Vector3 } {
  const c = eyeDir.clone().normalize();
  const u = new Vector3().crossVectors(new Vector3(0, 1, 0), c).normalize();
  const v = new Vector3().crossVectors(c, u).normalize();

  const A = 0.235; // полуширина века (в единицах угл. тангенса)
  // верхнее веко накрывает глаз сверху вниз; нижнее — узкая полоса снизу
  const vMin = upper ? -0.105 : -0.20;
  const vMax = upper ? 0.26 : -0.09;

  const pos: number[] = [];
  const idx: number[] = [];
  const veins: number[] = [];
  const uvs: number[] = [];
  const grid: number[][] = [];

  for (let j = 0; j <= nv; j++) {
    const t = j / nv;
    const b = vMin + (vMax - vMin) * t;
    const row: number[] = [];
    for (let i = 0; i <= nu; i++) {
      const s = i / nu;
      const a = -A + 2 * A * s;
      // край века (нижний у верхнего века) — с дугой, как разрез глаза
      let bb = b;
      if (upper && b < vMin + 0.05) {
        // нижний край верхнего века — дуга «разреза глаза»
        bb = vMin - 0.028 * Math.cos((s - 0.5) * Math.PI * 0.9);
      }
      _d.copy(c).addScaledVector(u, a).addScaledVector(v, bb).normalize();
      const surR = skullSurfaceRadius(_d.x, _d.y, _d.z, R);
      const dome = (upper ? 0.030 : 0.016) * (1 - (a / A) ** 2) * (1 - Math.min(1, Math.abs(bb) / Math.max(Math.abs(vMin), Math.abs(vMax))));
      const lift = surR * 1.004 + dome * R;
      const p = _d.clone().multiplyScalar(lift);
      row.push(pos.push(p.x, p.y, p.z) / 3 - 1);
      veins.push(0.12);
      uvs.push(s, t);
    }
    grid.push(row);
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a0 = grid[j][i], b0 = grid[j][i + 1], c0 = grid[j + 1][i], d0 = grid[j + 1][i + 1];
      idx.push(a0, c0, b0, b0, c0, d0);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('aVeinMask', new BufferAttribute(new Float32Array(veins), 1));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  // петля (hinge): верхнее веко откидывается назад по «бровной» касательной
  const hinge = upper ? vMax : vMin;
  _d.copy(c).addScaledVector(u, 0).addScaledVector(v, hinge).normalize();
  const hingePoint = _d.clone().multiplyScalar(skullSurfaceRadius(_d.x, _d.y, _d.z, R) * 0.99);
  const hingeAxis = u.clone();
  return { geo, hingePoint, hingeAxis };
}

/**
 * «Разрушенная колонна»-постамент под головой. Верх — рваный срез.
 */
export function buildPedestalGeometry(bottomR: number, topR: number, height: number, segments = 64): BufferGeometry {
  const geo = new CylinderGeometry(topR, bottomR, height, segments, 10, false);
  const p = geo.attributes.position as BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = Math.sin(x * 0.34) * Math.cos(z * 0.29) + 0.5 * Math.sin(y * 0.7 + x * 0.2);
    const rough = 1 + n * 0.03;
    let rx = x * rough, rz = z * rough, ry = y;
    // рваный верхний край
    const t = (y + height / 2) / height;
    if (t > 0.82) {
      const jag = (Math.sin(x * 1.2) * Math.cos(z * 1.7) + Math.sin(x * 3.1 + z * 2.2)) * 0.5 + 0.5;
      ry -= (t - 0.82) / 0.18 * jag * height * 0.22;
    }
    p.setXYZ(i, rx, ry, rz);
  }
  geo.computeVertexNormals();
  // атрибут для shared head-шейдера
  const veins = new Float32Array(p.count).fill(0.25);
  geo.setAttribute('aVeinMask', new BufferAttribute(veins, 1));
  return geo;
}

/** Каменное кольцо-«корона» — тонкий пояс с эрозией */
export function buildCrownGeometry(radius: number, tube: number): BufferGeometry {
  const geo = new SphereGeometry(radius, 96, 12, 0, Math.PI * 2, Math.PI * 0.5 - 0.085, 0.17);
  const p = geo.attributes.position as BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = Math.sin(x * 0.5) * Math.cos(z * 0.4) + 0.6 * Math.sin(y * 2 + x * 0.3);
    const s = 1 + (n > 0.4 ? 0.05 : -0.01) + n * 0.015;
    p.setXYZ(i, x * s, y * (1 + tube * 0.0), z * s);
  }
  const veins = new Float32Array(p.count).fill(0.5);
  geo.setAttribute('aVeinMask', new BufferAttribute(veins, 1));
  geo.computeVertexNormals();
  return geo;
}
