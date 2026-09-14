/**
 * Player.ts — маленький мужичок в скафандре.
 *
 * Сборка из примитивов (никаких внешних моделей, всё процедурно):
 * капсула-торс, сфера-шлем с визором, ранец-лайф-саппорт, руки-ноги
 * с лёгким разворотом для полёта, синие emissive-акценты, микросопла.
 *
 * Поворот тела: forward = касательная скорость, up = радиал (головой к звёздам
 * по умолчанию, ноги смотрят на голову Бога — как «вниз» к центру).
 */
import {
  Group, Mesh, MeshStandardMaterial, MeshBasicMaterial, CapsuleGeometry, SphereGeometry,
  BoxGeometry, CylinderGeometry, Vector3, Matrix4, AdditiveBlending, Sprite, SpriteMaterial,
} from 'three';
import { PLAYER } from '../constants';
import { makeGlowTexture } from '../render/Textures';

const SUIT = new MeshStandardMaterial({ color: 0xdfe3ea, roughness: 0.55, metalness: 0.05 });
const SUIT_DARK = new MeshStandardMaterial({ color: 0x8f96a3, roughness: 0.65, metalness: 0.1 });
const GLASS = new MeshStandardMaterial({
  color: 0x22384f, roughness: 0.1, metalness: 0.75, emissive: 0x0a2740, emissiveIntensity: 0.6,
});
const EMISSIVE_BLUE = new MeshBasicMaterial({ color: 0x35c8ff });
const THRUST = new MeshBasicMaterial({ color: 0xffe9c9, transparent: true, opacity: 0.9, blending: AdditiveBlending });
/** материалы для fade-out при смерти */
const SHARED_MATS: MeshStandardMaterial[] = [SUIT, SUIT_DARK, GLASS];
// временные объекты (без аллокаций в кадре)
const _tmpF = new Vector3();
const _tmpX = new Vector3();
const _mB = new Matrix4();

export interface PlayerVisualState {
  pos: Vector3;       // мировая позиция игрока
  forward: Vector3;   // куда летит (касательная, нормализована)
  up: Vector3;        // «вверх» игрока = наружу от головы
  bank: number;
  speed01: number;
  boosting: boolean;
  dashing: boolean;
  time: number;
  hurt: number;       // 0..1 красная вспышка урона
  dying: number;      // 0..1 прогресс смерти (рассыпается)
}

export class Player {
  readonly group = new Group();
  private body = new Group();
  private nozzles: Mesh[] = [];
  private thrustSprites: Mesh[] = [];
  private accents: Mesh[] = [];
  private _up = new Vector3(0, 1, 0);

  constructor() {
    this.group.add(this.body);
    const H = PLAYER.HEIGHT;

    // торс
    const torso = new Mesh(new CapsuleGeometry(H * 0.16, H * 0.28, 6, 12), SUIT);
    torso.position.y = H * 0.18;
    torso.scale.set(1.12, 1, 0.82);
    this.body.add(torso);

    // шлем
    const helmet = new Mesh(new SphereGeometry(H * 0.135, 20, 16), SUIT);
    helmet.position.set(0, H * 0.52, 0);
    this.body.add(helmet);
    const visor = new Mesh(new SphereGeometry(H * 0.125, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), GLASS);
    visor.position.set(0, H * 0.52, 0);
    visor.rotation.x = Math.PI * 0.62;
    this.body.add(visor);

    // ранец life support
    const pack = new Mesh(new BoxGeometry(H * 0.26, H * 0.3, H * 0.14), SUIT_DARK);
    pack.position.set(0, H * 0.22, -H * 0.16);
    this.body.add(pack);
    // синие акценты на груди и ранце
    for (const [x, y, z, w, h] of [[0, H * 0.26, H * 0.135, 0.1, 0.028], [0.08, H * 0.3, -H * 0.235, 0.05, 0.05], [-0.08, H * 0.3, -H * 0.235, 0.05, 0.05]] as const) {
      const m = new Mesh(new BoxGeometry(H * w, H * h, H * 0.01), EMISSIVE_BLUE);
      m.position.set(H * x * (w > 0.09 ? 1 : 1), y, z);
      if (z < 0) m.rotation.y = Math.PI;
      this.body.add(m);
      this.accents.push(m);
    }
    // стабилизаторы на ранце
    for (const s of [-1, 1]) {
      const fin = new Mesh(new BoxGeometry(H * 0.03, H * 0.16, H * 0.1), SUIT_DARK);
      fin.position.set(s * H * 0.17, H * 0.3, -H * 0.2);
      fin.rotation.z = s * 0.5;
      this.body.add(fin);
    }

    // руки и ноги (в позе «парения»)
    const limb = (r: number, len: number) => new Mesh(new CapsuleGeometry(r, len, 5, 8), SUIT);
    const arm = (s: number) => {
      const a = limb(H * 0.045, H * 0.2);
      a.position.set(s * H * 0.21, H * 0.3, -H * 0.02);
      a.rotation.set(0.4, 0, s * 0.9);
      return a;
    };
    this.body.add(arm(-1), arm(1));
    const leg = (s: number) => {
      const l = limb(H * 0.055, H * 0.26);
      l.position.set(s * H * 0.09, -H * 0.05, -H * 0.04);
      l.rotation.set(-0.25, 0, s * 0.12);
      return l;
    };
    this.body.add(leg(-1), leg(1));

    // микросопла + thrust-спрайты
    for (const [x, y] of [[-0.1, -0.02], [0.1, -0.02], [0, -0.16]] as const) {
      const n = new Mesh(new CylinderGeometry(H * 0.028, H * 0.04, H * 0.06, 8), SUIT_DARK);
      n.position.set(H * x, H * (0.18 + y), -H * 0.22);
      n.rotation.x = Math.PI / 2;
      this.body.add(n);
      this.nozzles.push(n);
      const t = new Mesh(new CylinderGeometry(H * 0.02, H * 0.005, H * 0.18, 6, 1, true), THRUST);
      t.position.copy(n.position);
      t.position.z -= H * 0.1;
      t.rotation.x = -Math.PI / 2;
      t.visible = false;
      this.body.add(t);
      this.thrustSprites.push(t);
    }
    // маленький blue aura glow — круглая мягкая текстура (без map спрайт квадратный)
    const halo = new Sprite(new SpriteMaterial({
      map: makeGlowTexture(128), color: 0x2f9fd6, transparent: true,
      opacity: 0.3, blending: AdditiveBlending, depthWrite: false,
    }));
    halo.scale.setScalar(H * 2.0);
    this.body.add(halo);
  }

  update(s: PlayerVisualState): void {
    this.group.position.copy(s.pos);
    // Ориентация «супергероя»: голова наружу от головы Бога (+Y = радиаль n),
    // корпус развёрнут по направлению движения (+Z = forward).
    const f = _tmpF.copy(s.forward);
    if (f.lengthSq() < 1e-6) f.set(0, 0, 1);
    const y = this._up.copy(s.up).normalize();
    f.addScaledVector(y, -f.dot(y));
    if (f.lengthSq() < 1e-6) f.set(0, 0, 1).addScaledVector(y, -y.z); // fwd ∥ n — редко, страховка
    f.normalize();
    const x = _tmpX.crossVectors(y, f);
    _mB.makeBasis(x, y, f);
    this.group.quaternion.setFromRotationMatrix(_mB);
    // banking-крен вокруг направления движения + смерть-кувырок
    this.group.rotateZ(s.bank * 0.5 + s.dying * 3.2);

    // лёгкое «парение» тела
    this.body.rotation.z = Math.sin(s.time * 1.7) * 0.05;
    this.body.rotation.x = Math.sin(s.time * 1.3) * 0.05;

    const th = s.speed01;
    for (let i = 0; i < this.nozzles.length; i++) {
      const flame = this.thrustSprites[i];
      const active = (th > 0.02 || s.boosting || s.dashing) && s.dying < 0.5;
      flame.visible = active;
      const sc = 0.5 + th * 1.6 + (s.boosting ? 0.8 : 0) + Math.sin(s.time * 40 + i) * 0.15;
      flame.scale.set(sc, sc, sc);
    }

    // hurt: акценты вспыхивают красным
    for (const a of this.accents) {
      (a.material as MeshBasicMaterial).color.setHex(s.hurt > 0.01 ? 0xff5040 : 0x35c8ff);
    }

    // рассыпание при смерти
    if (s.dying > 0) {
      this.group.scale.setScalar(1 - s.dying * 0.4);
      const o = Math.max(0, 1 - s.dying);
      if (!this.dyingApplied) {
        for (const m of SHARED_MATS) m.transparent = true;
        this.dyingApplied = true;
      }
      for (const m of SHARED_MATS) m.opacity = o;
    } else if (this.dyingApplied) {
      for (const m of SHARED_MATS) m.opacity = 1;
      this.dyingApplied = false;
    }
  }

  private dyingApplied = false;
}
