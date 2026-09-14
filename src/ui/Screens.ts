/**
 * Screens — полноэкранные DOM-оверлеи: intro, game over, pause, settings.
 */
import { ScoreSystem } from '../game/ScoreSystem';
import { QUALITY_PRESETS, type QualityLevel } from '../constants';

export interface RunSummary {
  score: number;
  best: number;
  timeSec: number;
  redTouched: number;
  soulsCollected: number;
  newBest: boolean;
}

export class Screens {
  private root: HTMLElement;
  private introEl!: HTMLElement;
  private overEl!: HTMLElement;
  private pauseEl!: HTMLElement;
  private settingsEl!: HTMLElement;
  private statsEl!: HTMLElement;

  onStart: () => void = () => {};
  onRestart: () => void = () => {};
  onResume: () => void = () => {};

  constructor(container: HTMLElement) {
    this.root = container;
    container.insertAdjacentHTML('beforeend', `
      <div class="gk-screen intro">
        <h1 class="gk-title">ГОЛОВА БОГА-КОРОЛЯ</h1>
        <div class="gk-sub">ЛЕТАЙ ВОКРУГ БОГА · СОБИРАЙ ДУШИ · НЕ ДАЙ ЕМУ ПОСМОТРЕТЬ НА ТЕБЯ</div>
        <div class="gk-controls">
          <div class="k">W A S D</div><div>полёт по орбите</div>
          <div class="k">SHIFT</div><div>ускорение</div>
          <div class="k">ПРОБЕЛ</div><div>рывок</div>
          <div class="k">КОЛЕСО</div><div>приближение камеры</div>
          <div class="k">ESC / P</div><div>пауза</div>
          <div class="k">R</div><div>рестарт</div>
        </div>
        <button class="gk-big-btn start">НАЧАТЬ ПОЛЁТ</button>
        <div class="gk-tiny">СИНИЕ — ОЧКИ · ЗОЛОТО — ОЧКИ + ВОЛНА, ЖГУЩАЯ ДУХОВ · ЗЕЛЁНЫЕ — ЖИЗНЬ · КРАСНЫЕ — КРАДУТ ТЯГУ И РАЗГОНЯЮТ ЕГО ВЗГЛЯД</div>
      </div>
      <div class="gk-screen over hidden">
        <div class="gk-dead-title">БОГ УВИДЕЛ ТЕБЯ</div>
        <div class="gk-dead-sub">THE GOD HAS SEEN YOU</div>
        <div class="gk-stats" data-stats></div>
        <button class="gk-big-btn restart">ЕЩЁ ОДИН ПОЛЁТ</button>
        <div class="gk-tiny">ENTER / R — ЗАНОВО</div>
      </div>
      <div class="gk-screen pause hidden">
        <div class="gk-dead-title" style="color:#9fb2d8;text-shadow:none;">ПАУЗА</div>
        <div class="gk-dead-sub">ESC — ПРОДОЛЖИТЬ</div>
      </div>
      <div class="gk-screen settings hidden">
        <div class="gk-modal">
          <h3>НАСТРОЙКИ</h3>
          <div class="gk-opt">ГРАФИКА
            <select data-q>
              ${(['LOW', 'MEDIUM', 'HIGH', 'ULTRA'] as QualityLevel[]).map((q) => `<option value="${q}">${q}</option>`).join('')}
            </select>
          </div>
          <div class="gk-opt">ПОСТОБРАБОТКА <button class="toggle" data-post>ВКЛ</button></div>
          <div class="gk-opt">ЭФФЕКТЫ ДВИЖЕНИЯ <button class="toggle" data-motion>ВКЛ</button></div>
          <div class="gk-opt">ЗВУКИ <button class="toggle" data-sound>ВКЛ</button></div>
          <div class="gk-opt">МУЗЫКА <button class="toggle" data-music>ВКЛ</button></div>
          <div class="gk-opt" style="margin-top:18px;"><button class="gk-big-btn close" style="padding:8px 30px;font-size:12px;">ЗАКРЫТЬ</button></div>
        </div>
      </div>
    `);
    this.introEl = container.querySelector('.intro')!;
    this.overEl = container.querySelector('.over')!;
    this.pauseEl = container.querySelector('.pause')!;
    this.settingsEl = container.querySelector('.settings')!;
    this.statsEl = container.querySelector('[data-stats]')!;

    this.introEl.querySelector('.start')!.addEventListener('click', () => this.onStart());
    this.overEl.querySelector('.restart')!.addEventListener('click', () => this.onRestart());
    this.pauseEl.addEventListener('click', () => this.onResume());
    this.settingsEl.querySelector('.close')!.addEventListener('click', () => this.hideSettings());
  }

  /** вернул true, если настройки были открыты (клик переключает) */
  toggleSettings(): boolean {
    const open = !this.settingsEl.classList.contains('hidden');
    this.settingsEl.classList.toggle('hidden', open);
    return !open;
  }
  hideSettings(): void {
    this.settingsEl.classList.add('hidden');
  }
  settingsOpen(): boolean {
    return !this.settingsEl.classList.contains('hidden');
  }

  hideIntro(): void {
    this.introEl.classList.add('hidden');
  }
  showIntro(): void {
    this.introEl.classList.remove('hidden');
  }

  showOver(sum: RunSummary): void {
    const m = Math.floor(sum.timeSec / 60);
    const s = Math.floor(sum.timeSec % 60);
    this.statsEl.innerHTML = `
      ${stat('СЧЁТ', ScoreSystem.format(sum.score), 'hl')}
      ${stat('РЕКОРД', ScoreSystem.format(sum.best) + (sum.newBest ? ' ✦' : ''), '')}
      ${stat('ВРЕМЯ', `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`, '')}
      ${stat('ДУХИ', String(sum.redTouched), 'dg')}
      ${stat('ДУШИ', String(sum.soulsCollected), '')}
    `;
    this.overEl.classList.remove('hidden');
  }
  hideOver(): void {
    this.overEl.classList.add('hidden');
  }

  showPause(): void { this.pauseEl.classList.remove('hidden'); }
  hidePause(): void { this.pauseEl.classList.add('hidden'); }

  bindSettings(opts: {
    quality: QualityLevel; post: boolean; motion: boolean; sound: boolean; music: boolean;
    onChange: (o: { quality: QualityLevel; post: boolean; motion: boolean; sound: boolean; music: boolean }) => void;
  }): void {
    const qSel = this.settingsEl.querySelector('[data-q]') as HTMLSelectElement;
    qSel.value = opts.quality;
    const postB = this.settingsEl.querySelector('[data-post]') as HTMLButtonElement;
    const motB = this.settingsEl.querySelector('[data-motion]') as HTMLButtonElement;
    const sndB = this.settingsEl.querySelector('[data-sound]') as HTMLButtonElement;
    const musB = this.settingsEl.querySelector('[data-music]') as HTMLButtonElement;
    const sync = () => {
      postB.textContent = opts.post ? 'ВКЛ' : 'ВЫКЛ';
      motB.textContent = opts.motion ? 'ВКЛ' : 'ВЫКЛ';
      sndB.textContent = opts.sound ? 'ВКЛ' : 'ВЫКЛ';
      musB.textContent = opts.music ? 'ВКЛ' : 'ВЫКЛ';
    };
    sync();
    const fire = () => opts.onChange({ quality: qSel.value as QualityLevel, post: opts.post, motion: opts.motion, sound: opts.sound, music: opts.music });
    qSel.onchange = fire;
    postB.onclick = () => { opts.post = !opts.post; sync(); fire(); };
    motB.onclick = () => { opts.motion = !opts.motion; sync(); fire(); };
    sndB.onclick = () => { opts.sound = !opts.sound; sync(); fire(); };
    musB.onclick = () => { opts.music = !opts.music; sync(); fire(); };
  }
}

function stat(label: string, value: string, cls: string): string {
  return `<div class="gk-stat ${cls}"><div class="label">${label}</div><div class="value num">${value}</div></div>`;
}

export { QUALITY_PRESETS };
