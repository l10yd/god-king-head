// @vitest-environment jsdom
/**
 * InputManager: слияние клавиатуры, сенсорного стика и кнопок.
 * Регрессия «десктоп не сломается»: без вклада touch поведение — чистая клавиатура.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InputManager } from '../src/core/Input';

const key = (type: 'keydown' | 'keyup', code: string) =>
  window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));

describe('InputManager — слияние клавиатуры и тача', () => {
  let input: InputManager;

  beforeEach(() => {
    input = new InputManager();
    input.attach(document.body);
  });
  afterEach(() => {
    input.detach();
    // на всякий случай снимаем все зажатые клавиши/вкладки
    for (const c of ['KeyA', 'KeyD', 'KeyW', 'KeyS', 'ShiftLeft']) key('keyup', c);
    input.touch.x = 0; input.touch.y = 0; input.touch.boost = false;
  });

  it('без тача — только клавиатура (десктоп-регрессия)', () => {
    key('keydown', 'KeyD');
    let f = input.read();
    expect(f.x).toBeCloseTo(1);
    expect(f.boost).toBe(false);
    key('keydown', 'ShiftLeft');
    f = input.read();
    expect(f.boost).toBe(true);
    key('keyup', 'KeyD'); key('keyup', 'ShiftLeft');
    f = input.read();
    expect(f.x).toBe(0);
    expect(f.boost).toBe(false);
  });

  it('стик добавляется к клавиатуре и клампится в ±1', () => {
    input.touch.x = 0.6; input.touch.y = -0.5;
    key('keydown', 'KeyD'); // +1 по x
    const f = input.read();
    expect(f.x).toBeCloseTo(1);      // 1+0.6 → clamp
    expect(f.y).toBeCloseTo(-0.5);   // чистый стик
    key('keyup', 'KeyD');
  });

  it('полное отклонение стика = boost; рывок/зум кнопками', () => {
    input.touch.x = 0.95; input.touch.boost = true;
    let f = input.read();
    expect(f.boost).toBe(true);

    input.queueDash();
    f = input.read();
    expect(f.dashEdge).toBe(true);
    f = input.read();
    expect(f.dashEdge).toBe(false); // edge — одноразовый

    input.nudgeZoom(3);
    f = input.read();
    expect(f.zoomStep).toBeCloseTo(3);
    f = input.read();
    expect(f.zoomStep).toBe(0);     // накопление сбрасывается каждый кадр
  });

  it('off-stick (dead zone нули) не двигает ничего', () => {
    const f = input.read();
    expect(f.x).toBe(0);
    expect(f.y).toBe(0);
    expect(f.boost).toBe(false);
    expect(f.dashEdge).toBe(false);
  });
});
