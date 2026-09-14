/**
 * Кривая сложности: difficulty = f(time, dangerLevel).
 * Чистые функции — покрываются unit-тестами.
 */
import { DIFFICULTY, HEAD } from '../constants';
import { clamp01, lerp, smoothstep } from '../math/Tracking';

/** Опасность: смешивает время рана и число СОБРАННЫХ красных духов.
 *  Каждый подобранный дух ощутимо разгоняет голову Бога (быстрее погоня/луч). */
export function dangerScore(timeSec: number, redSpiritsTouched: number): number {
  const timePart = 1 - Math.exp(-timeSec / DIFFICULTY.TIME_DANGER_PERIOD);
  // короткая «насыщающая» кривая: уже ~10 духов сильно поднимают danger
  const redPart = 1 - Math.exp(-redSpiritsTouched / 10);
  return clamp01(0.4 * timePart + 0.85 * redPart);
}

/** Скорость поворота головы к игроку, рад/с */
export function headTrackSpeed(danger: number): number {
  const t = danger * 20; // dangerLevel-аналог: 0..20 условных «ступеней»
  return Math.min(HEAD.TRACK_SPEED_MAX, HEAD.TRACK_SPEED_BASE + HEAD.TRACK_SPEED_PER_DANGER * t * 0.35 + danger * danger * 1.3);
}

/** Скорость глаз (опережают голову) */
export function eyeTrackSpeed(danger: number): number {
  return Math.min(HEAD.EYE_TRACK_MAX, HEAD.EYE_TRACK_BASE + danger * 6);
}

/** Урон луча в секунду */
export function beamDamage(danger: number): number {
  return Math.min(HEAD.BEAM_DAMAGE_MAX, HEAD.BEAM_DAMAGE_BASE + danger * 14);
}

/**
 * Скорость «доворота» луча за игроком, рад/с.
 * Держим НИЖЕ угловой скорости игрока (база 0.14, буст 0.266, дэш 0.336),
 * иначе из зоны поражения физически невозможно выбраться — луч обязан
 * «отставать»: уход ходом спасает в ранней игре, буст/рывок — в поздней.
 */
export function beamTurnSpeed(danger: number): number {
  return lerp(0.075, 0.115, smoothstep(0, 1, danger)) + danger * danger * 0.05;
}

/** Целевая популяция [blue, green, red] по времени рана */
export function targetPopulation(timeSec: number): { blue: number; green: number; red: number } {
  const ph = DIFFICULTY.PHASES;
  let i = 0;
  while (i < ph.length - 1 && timeSec >= ph[i + 1].t) i++;
  const a = ph[i];
  const b = ph[Math.min(ph.length - 1, i + 1)];
  const span = b.t - a.t;
  const t = span > 0 ? clamp01((timeSec - a.t) / span) : 1;
  return {
    blue: Math.round(lerp(a.blue, b.blue, t)),
    green: Math.round(lerp(a.green, b.green, t)),
    red: Math.round(lerp(a.red, b.red, t)),
  };
}

/** Скорость красных духов, рад/с */
export function redSpeed(danger: number): number {
  return Math.min(DIFFICULTY.RED_SPEED_MAX, DIFFICULTY.RED_SPEED_BASE + danger * DIFFICULTY.RED_SPEED_PER_DANGER * 20);
}

/**
 * Интенсивность преследования: вероятность в секунду, с которой дух «замечает»
 * игрока и уходит в погоню. РАВНА НУЛЮ при danger=0 (духи не охотятся в самой
 * ранней игре) и растёт с опасностью — «постепенно красные начинают преследовать».
 */
export function redChaseChance(danger: number): number {
  return Math.min(1, danger * DIFFICULTY.RED_CHASE_PER_DANGER);
}

/** Порог gaze чуть сужается со сложностью — late game безжалостнее */
export function lockDotThreshold(danger: number): number {
  return lerp(HEAD.LOCK_DOT, HEAD.LOCK_DOT - 0.02, clamp01(danger));
}
