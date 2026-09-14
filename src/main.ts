/**
 * main.ts — точка входа: монтаж Game + интро-секвенция загрузки.
 */
import './ui/ui.css';
import { Game } from './Game';

const host = document.getElementById('app')!;
const game = new Game(host);
game.start();

// убираем boot-оверлей после первого кадра
requestAnimationFrame(() => requestAnimationFrame(() => {
  const boot = document.getElementById('boot');
  if (boot) {
    boot.classList.add('hidden');
    setTimeout(() => boot.remove(), 1400);
  }
}));

// глобальный хук для дебага в консоли
(window as unknown as { __GK: Game }).__GK = game;
