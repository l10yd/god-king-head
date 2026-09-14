/**
 * Детерминированный RNG (mulberry32).
 * Один сид на ран => воспроизводимые спавны и поведение духов.
 */
export type Rng = () => number;

/** Преобразует строку/число в uint32-сид */
export function hashSeed(input: string | number): number {
  if (typeof input === 'number') return input >>> 0;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — быстрый, статистически достаточный для игры */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Случайное число в диапазоне */
export const range = (rng: Rng, min: number, max: number) => min + (max - min) * rng();

/** Случайный знак */
export const sign = (rng: Rng) => (rng() < 0.5 ? -1 : 1);

/** Честный выбор из массива */
export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
}

/** Человекочитаемый сид для отображения в UI: 5 символов base36 */
export function seedLabel(seed: number): string {
  return (seed >>> 0).toString(36).toUpperCase().padStart(7, '0').slice(-7);
}
