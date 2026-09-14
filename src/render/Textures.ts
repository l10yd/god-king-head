/**
 * Textures — сгенерированные текстуры (без внешних файлов).
 */
import { CanvasTexture, SRGBColorSpace } from 'three';

const _cache = new Map<string, CanvasTexture>();

/** Мягкий радиальный glow (для спрайтов/нимбов) */
export function makeGlowTexture(size = 128): CanvasTexture {
  const key = `glow-${size}`;
  const cached = _cache.get(key);
  if (cached) return cached;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.16)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  _cache.set(key, tex);
  return tex;
}

/** «Пушистая» дымка для spirit trail */
export function makePuffTexture(size = 96): CanvasTexture {
  const key = `puff-${size}`;
  const cached = _cache.get(key);
  if (cached) return cached;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  _cache.set(key, tex);
  return tex;
}
