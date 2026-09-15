/**
 * SoulField: скрытое HP красных духов — выжигание лучом и «молчаливый»
 * респаун-замена далеко от игрока (за спиной), плюс замена после золотой волны.
 */
import { describe, it, expect } from 'vitest';
import { Group, Vector3 } from 'three';
import { SoulField } from '../src/souls/SoulField';
import { mulberry32 } from '../src/math/rng';
import { WORLD, SPIRITS } from '../src/constants';

const R = WORLD.ORBIT_RADIUS;

function mkField(seed = 7): SoulField {
  return new SoulField(new Group(), mulberry32(seed));
}

describe('SoulField — выжигание духа лучом', () => {
  it('дух в конусе луча не сгорает за 1 c, но сгорает за ~2 c; вне конуса — вечен', () => {
    const field = mkField();
    const axis = new Vector3(0, 0, 1);
    // ~0.05 рад от оси — внутри конуса 0.09
    const near = new Vector3(0.05, 0, Math.sqrt(1 - 0.0025)).multiplyScalar(R);
    field.debugKindAt('red', near);
    // ~0.3 рад — снаружи
    const far = new Vector3(0.3, 0, Math.sqrt(1 - 0.09)).multiplyScalar(R);
    field.debugKindAt('red', far);
    expect(field.count('red')).toBe(2);

    const out: Vector3[] = [];
    // 1 секунды мало (HP=80, burn=48/с) — и конус не задевает дальний дух
    expect(field.beamBurn(axis, 1.0, out)).toBe(0);
    // ещё секунда — ближний сгорел, дальний (0.3 рад) так и не начал
    expect(field.beamBurn(axis, 1.0, out)).toBe(1);
    expect(out.length).toBe(1);
    expect(field.count('red')).toBe(1);
    expect(field.beamBurn(axis, 5.0, out)).toBe(0); // дальний — «вечен» вне конуса
    // труп: позиция смерти на сфере
    expect(out[0].length()).toBeGreaterThan(R * 0.9);
  });

  it('смерть духа мгновенно восполняется НОВЫМ далеко от игрока (за спиной)', () => {
    const field = mkField(11);
    const axis = new Vector3(0, 0, 1);
    const playerDir = axis.clone();
    const pos = new Vector3(0.05, 0, Math.sqrt(1 - 0.0025)).multiplyScalar(R);
    field.debugKindAt('red', pos);
    expect(field.count('red')).toBe(1);

    const out: Vector3[] = [];
    field.beamBurn(axis, 2.5, out); // смерть
    expect(field.count('red')).toBe(0); // до тика update — минус один

    // один тик поля (dt мал, штатный refill не успевает сработать) — замена
    field.update(1 / 60, 40, 0.3, playerDir.clone().multiplyScalar(R), true, 0);
    expect(field.count('red')).toBe(1); // численность восстановлена МОЛЧА

    const reborn = field.souls.find((s) => s.kind === 'red')!;
    const ang = reborn.n.angleTo(playerDir);
    // спавн строго за краем обзора: ≥ RESPAWN_MIN_ANGLE от игрока
    expect(ang).toBeGreaterThanOrEqual(SPIRITS.RESPAWN_MIN_ANGLE - 0.01);
    // и с полным HP — новый дух, не «полумёртвый»
    expect(reborn.hp).toBe(SPIRITS.HP);
  });

  it('золотая волна тоже оставляет место: purge → мгновенная замена за спиной', () => {
    const field = mkField(23);
    const playerDir = new Vector3(1, 0, 0);
    const center = playerDir.clone().multiplyScalar(R);
    field.debugKindAt('red', center.clone()); // ровно на игроке (в радиусе волны)
    field.debugKindAt('red', new Vector3(1, 0.15, 0).normalize().multiplyScalar(R)); // ~0.15 рад — в волне 60 м
    expect(field.count('red')).toBe(2);

    const killed = field.purgeRedsNear(center, 60);
    expect(killed).toBe(2);
    expect(field.count('red')).toBe(0);

    field.update(1 / 60, 30, 0.2, center, true, 0);
    expect(field.count('red')).toBe(2); // обе позиции заняты новыми
    for (const s of field.souls) {
      if (s.kind === 'red') expect(s.n.angleTo(playerDir)).toBeGreaterThanOrEqual(SPIRITS.RESPAWN_MIN_ANGLE - 0.01);
    }
  });
});
