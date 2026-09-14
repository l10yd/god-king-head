/**
 * scripts/smoke.mjs — браузерный приёмочный прогон (системный Chrome + CDP).
 *
 * Сценарий по §59: интро → старт → сбор души → дух → пробуждение (8.5s) →
 * gaze → LOCK → CHARGE → BEAM-FIRE → урон → смерть → GAME OVER → рестарт.
 * Пиксельные проверки кадров, console/page errors, статистика рендера.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync } from 'node:fs';

const EXE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.env.GK_URL ?? 'http://127.0.0.1:5199/?debug=1';
const OUT = 'shots';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  if (!ok) failures++;
};

// ---- PNG-разбор без зависимостей: zlib inflate сырых scanlines ----
import { inflateSync } from 'node:zlib';
function decodePng(path) {
  const buf = readFileSync(path);
  let o = 8;
  let w = 0, h = 0, bitDepth = 0, colorType = 0;
  let idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  if (bitDepth !== 8 || ch < 3) throw new Error(`unsupported png ${bitDepth}/${colorType}`);
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  let ro = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[ro++];
    const line = raw.subarray(ro, ro + stride); ro += stride;
    const cur = Buffer.allocUnsafe(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev[x];
      const c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v = (v + a) & 255;
      else if (f === 2) v = (v + b) & 255;
      else if (f === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      cur[x] = v;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { w, h, ch, data: out };
}
function stats(img) {
  let sum = 0, bright = 0, warm = 0, cyan = 0, total = 0;
  const step = Math.max(1, Math.floor(img.w / 320)) * img.ch;
  for (let i = 0; i < img.data.length; i += step * (img.ch ? 1 : 1)) {
    // идём попиксельно по строкам с прореживанием
  }
  const stride = img.w * img.ch;
  for (let y = 0; y < img.h; y += 2) {
    for (let x = 0; x < img.w; x += 2) {
      const p = y * stride + x * img.ch;
      const r = img.data[p], g = img.data[p + 1], b = img.data[p + 2];
      const lum = (r + g + b) / 3;
      sum += lum; total++;
      if (lum > 140) bright++;
      if (r > g + 30 && r > b + 30 && lum > 60) warm++;
      if (b > r + 30 && g > r + 10 && lum > 50) cyan++;
    }
  }
  return { mean: sum / total, brightPct: 100 * bright / total, warmPct: 100 * warm / total, cyanPct: 100 * cyan / total };
}
async function shotStats(page, name) {
  const path = `${OUT}/${name}.png`;
  await page.screenshot({ path });
  const s = stats(decodePng(path));
  console.log(`[shot] ${name}: mean=${s.mean.toFixed(1)} bright=${s.brightPct.toFixed(2)}% warm=${s.warmPct.toFixed(2)}% cyan=${s.cyanPct.toFixed(2)}%`);
  return s;
}

const browser = await chromium.launch({
  executablePath: EXE,
  headless: true,
  args: [
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle',
    '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox', '--window-size=1280,720',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error') errors.push(`console.error: ${t.slice(0, 300)}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 300)}`));
const peek = () => page.evaluate(() => window.__GK?.debugPeek?.() ?? null);

console.log('[smoke]', URL);
await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await sleep(3500);

// ---------- 1. интро ----------
const p0 = await peek();
check('интро: фаза INTRO + сцена не чёрная', p0?.phase === 'INTRO');
const s1 = await shotStats(page, '01-intro');
check('интро: видна голова (яркие пиксели)', s1.brightPct > 0.05, `bright=${s1.brightPct}%`);

// ---------- 2. старт РЕАЛЬНЫМ кликом по кнопке ----------
const btnHit = await page.evaluate(() => {
  const btn = document.querySelector('.gk-screen.intro .start');
  const r = btn.getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return top === btn || btn.contains(top);
});
check('кнопка «НАЧАТЬ ПОЛЁТ» — верхний элемент под курсором', btnHit);
await page.click('.gk-screen.intro .start', { timeout: 8000 });
await sleep(2200);
const p2 = await peek();
check('клик по кнопке запускает ран', p2.phase === 'PLAYING', `phase=${p2.phase}`);
check('старт: PLAYING, сущности заспавнены', p2.phase === 'PLAYING' && p2.entities > 15, `entities=${p2.entities}`);
check('рендер: реальные треугольники > 50k', p2.tris > 50000, `tris=${p2.tris} calls=${p2.calls}`);
await shotStats(page, '02-run');

// ---------- 3. стороны света (голова в кадре со всех углов) ----------
let minBright = 100;
for (const [i, th] of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2].entries()) {
  await page.evaluate((t) => window.__GK.debugTeleport(t, 1.25), th);
  await sleep(1400);
  const s = await shotStats(page, `03-side-${i}`);
  minBright = Math.min(minBright, s.brightPct);
}
check('голова видна со всех 4 сторон', minBright > 0.05, `min bright=${minBright}%`);
await page.evaluate(() => window.__GK.debugTeleport(0.6, 0.05));
await sleep(1200);
await shotStats(page, '04-pole-n');
await page.evaluate(() => window.__GK.debugTeleport(0.6, Math.PI - 0.05));
await sleep(1200);
await shotStats(page, '04-pole-s');

// ---------- 3.5 движение вводом (не телепортом) ----------
await page.evaluate(() => { window.__GK.debugStartRun(11); });
// ждём окончания control-lock (игровое время идёт медленнее реального на софт-рендерере)
for (let i = 0; i < 60; i++) {
  const s = await peek();
  if (s.controlLock <= 0) break;
  await sleep(250);
}
const dA = await page.evaluate(() => window.__GK.debugPlayerDir());
await page.keyboard.down('KeyD');
await sleep(2200);
await page.keyboard.up('KeyD');
const dB = await page.evaluate(() => window.__GK.debugPlayerDir());
const angMoved = Math.acos(Math.max(-1, Math.min(1, dA.x * dB.x + dA.y * dB.y + dA.z * dB.z)));
check('движение D (игрок смещается по орбите)', angMoved > 0.012, `angle=${angMoved.toFixed(3)} rad (ускорение с нуля при ~7fps)`);
const dC = await page.evaluate(() => window.__GK.debugPlayerDir());
await page.keyboard.down('KeyW');
await sleep(2200);
await page.keyboard.up('KeyW');
const dD2 = await page.evaluate(() => window.__GK.debugPlayerDir());
const angMovedW = Math.acos(Math.max(-1, Math.min(1, dC.x * dD2.x + dC.y * dD2.y + dC.z * dD2.z)));
check('движение W (игрок смещается по орбите)', angMovedW > 0.03, `angle=${angMovedW.toFixed(3)} rad`);

// ---------- 3.6 РЕГРЕССИЯ «водоворота»: долгое удержание S ----------
await page.evaluate(() => window.__GK.debugStartRun(13));
for (let i = 0; i < 60; i++) {
  const s = await peek();
  if (s.controlLock <= 0) break;
  await sleep(250);
}
{
  const a0 = await page.evaluate(() => window.__GK.debugPlayerDir());
  const samples = [];
  await page.keyboard.down('KeyS');
  for (let i = 0; i < 10; i++) {
    await sleep(700);
    samples.push(await peek());
  }
  await page.keyboard.up('KeyS');
  const a1 = await page.evaluate(() => window.__GK.debugPlayerDir());
  const total = Math.acos(Math.max(-1, Math.min(1, a0.x * a1.x + a0.y * a1.y + a0.z * a1.z)));
  const maxAngVel = Math.max(...samples.map((s) => s.angVel));
  check('S-удержание: игрок летит, а не залип', total > 0.12, `дуга=${total.toFixed(2)} rad`);
  check('S-удержание: НЕТ самораскрутки (угл. скорость не убегает)', maxAngVel < 0.2, `max angVel=${maxAngVel.toFixed(3)} рад/с (база 0.14)`);
  check('S-удержание: жив, в PLAYING (не улетел в небытие)', samples[samples.length - 1].phase === 'PLAYING' && samples[samples.length - 1].hp > 0);
}

// ---------- 3.7 зум: раслёт до максимума + разблокировка колеса ----------
{
  // controlLock уже выдержан выше — раслёт (2.0 игровых сек) завершён на максимуме
  const z1 = (await peek()).zoom;
  check('старт рана: за 2с камера разлетелась до МАКСИМУМА', z1 > 2.4, `zoom=${z1.toFixed(2)}`);
  for (let k = 0; k < 6; k++) { await page.mouse.wheel(0, -300); await sleep(120); } // приближение
  let zIn = z1;
  for (let i = 0; i < 20; i++) {
    zIn = (await peek()).zoom;
    if (zIn < 1.5) break;
    await sleep(300);
  }
  check('колесо вверх — приближение камеры', zIn < 1.5, `zoom=${zIn.toFixed(2)}`);
  for (let k = 0; k < 4; k++) { await page.mouse.wheel(0, 500); await sleep(120); } // отдаление
  let zOut = zIn;
  for (let i = 0; i < 20; i++) {
    zOut = (await peek()).zoom;
    if (zOut > 2.4) break;
    await sleep(300);
  }
  check('колесо вниз — отдаление до упора (ZOOM_MAX)', zOut > 2.4 && zOut <= 2.75, `zoom=${zOut.toFixed(2)}`);
  // вернуть штатный старт для следующих секций
  await page.evaluate(() => { window.__GK.debugStartRun(14); });
  await sleep(600);
}

// ---------- 4. столкновение с духом → пробуждение ----------
await page.evaluate(() => window.__GK.debugStartRun(7));
await sleep(1500);
await page.evaluate(() => window.__GK.debugSpiritNearPlayer());
await page.evaluate(() => window.__GK.debugSpiritNearPlayer());
let st = null;
for (let i = 0; i < 30; i++) {
  st = await peek();
  if (st.redTouched > 0) break;
  await sleep(300);
}
check('дух: касание = проклятие БЕЗ урона (hp=100, redTouched>0, cursed)',
  st.redTouched > 0 && st.hp === 100 && st.curseTimer > 0, `hp=${st.hp} curse=${st.curseTimer?.toFixed(2)}`);
for (let i = 0; i < 120; i++) {
  st = await peek();
  if (st.lidOpen > 0.7) break;
  await sleep(400);
}
check('пробуждение: веки открыты >0.7', st.lidOpen > 0.7, `lidOpen=${st.lidOpen.toFixed(2)} t=${st.awakeProgress.toFixed(1)}`);
await shotStats(page, '05-awake');

// ---------- 5. взгляд → LOCK → CHARGE → FIRE ----------
let sawAware = false, sawLock = false, sawCharge = false, sawFire = false, hpDuringBeam = null;
for (let i = 0; i < 160; i++) {
  await page.evaluate(() => window.__GK.debugFaceGaze());
  st = await peek();
  if (st.gazeVisits?.AWARENESS > 0) sawAware = true;
  if (st.gazeVisits?.LOCK > 0) sawLock = true;
  if (st.gazePhase === 'CHARGE') sawCharge = true;
  if (st.gazePhase === 'FIRE') { sawFire = true; hpDuringBeam = st.hp; }
  if (sawFire && hpDuringBeam < 90) break;
  await sleep(250);
}
check('gaze-машина: AWARENESS→LOCK→CHARGE пройдены', sawAware && sawLock && sawCharge, `A=${sawAware} L=${sawLock} C=${sawCharge}`);
check('BEAM: FIRE наступил', sawFire);
const sBeam = await shotStats(page, '06-beam');
check('BEAM: на экране вспышка (яркие пиксели)', sBeam.brightPct > 0.1, `bright=${sBeam.brightPct}%`);
check('BEAM: урон по игроку', hpDuringBeam !== null && hpDuringBeam < 100, `hp=${hpDuringBeam}`);

// ---------- 5.5 РЕГРЕССИЯ дедлока: стоя под взглядом — залпов должно быть >= 2 ----------
{
  let refire = false;
  for (let i = 0; i < 90; i++) {
    await page.evaluate(() => window.__GK.debugFaceGaze());
    st = await peek();
    if (st.hp < 45) await page.evaluate(() => window.__GK.debugHeal());
    if ((st.gazeVisits?.FIRE ?? 0) >= 2) { refire = true; break; }
    await sleep(300);
  }
  check('повторный залп: голова НЕ залипает в COOLDOWN (FIRE>=2)', refire, `visits.FIRE=${st.gazeVisits?.FIRE}`);
}

// ---------- 5.6 золотая волна: подбор → испепеление ближайших красных ----------
{
  await page.evaluate(() => window.__GK.debugHeal());
  // 6 духов кольцом в 40 м от игрока (< радиуса волны 60)
  await page.evaluate(() => window.__GK.debugRedsRing(6, 40));
  await sleep(400);
  const before = (await peek()).reds;
  await page.evaluate(() => window.__GK.debugGoldNearPlayer());
  let after = before;
  for (let i = 0; i < 20; i++) {
    await sleep(250);
    after = (await peek()).reds;
    if (after <= before - 3) break;
  }
  check('золотая волна испепеляет ближайших духов', after <= before - 3, `reds ${before} -> ${after}`);
}

// ---------- 6. near-miss/escape ----------
await page.evaluate(() => window.__GK.debugHeal());
let nmDone = false;
await page.evaluate(() => window.__GK.debugFaceGaze()); // встаём на ось и стоим
for (let i = 0; i < 200 && !nmDone; i++) {
  st = await peek();
  if (st.gazePhase === 'CHARGE' && st.chargeProgress > 0.78) {
    await page.evaluate((th) => window.__GK.debugTeleport(th, 1.3), Math.PI / 2); // срыв!
    for (let k = 0; k < 12; k++) {
      await sleep(250);
      st = await peek();
      if (st.nearMissCount > 0 || st.escapeCount > 0) { nmDone = true; break; }
    }
  } else if (st.gazePhase === 'FIRE') {
    await page.evaluate((th) => window.__GK.debugTeleport(th, 1.3), Math.PI / 2);
  }
  await sleep(200);
}
check('near-miss/escape сработали', st.nearMissCount > 0 || st.escapeCount > 0,
  `nm=${st.nearMissCount} esc=${st.escapeCount}`);

// ---------- 7. смерть → GAME OVER → рестарт ----------
await page.evaluate(() => window.__GK.debugKill());
for (let i = 0; i < 40; i++) {
  st = await peek();
  if (st.phase === 'GAMEOVER') break;
  await sleep(400);
}
check('смерть → GAMEOVER', st.phase === 'GAMEOVER', `phase=${st.phase}`);
const overVisible = await page.evaluate(() => !!document.querySelector('.gk-screen:not(.hidden)'));
check('экран GAME OVER виден', overVisible);
await shotStats(page, '07-gameover');
// РЕАЛЬНЫЙ клик по кнопке рестарта на экране гибели
const rbHit = await page.evaluate(() => {
  const btn = document.querySelector('.gk-screen.over .restart');
  if (!btn) return false;
  const r = btn.getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return top === btn || btn.contains(top);
});
check('кнопка «ЕЩЁ ОДИН ПОЛЁТ» кликабельна', rbHit);
await page.click('.gk-screen.over .restart', { timeout: 8000 });
await sleep(900);
const sr0 = await peek();
check('клик по рестарту вернул в PLAYING', sr0.phase === 'PLAYING' && sr0.hp === 100);
// шестерёнка настроек: открыть → сменить пресет → закрыть
await page.click('.gk-btns [data-act="settings"]', { timeout: 5000 });
await sleep(400);
const settingsOpen = await page.evaluate(() => !document.querySelector('.gk-screen.settings')?.classList.contains('hidden'));
check('шестерёнка открывает настройки', settingsOpen);
await page.selectOption('.gk-screen.settings [data-q]', 'MEDIUM').catch(() => {});
await page.click('.gk-screen.settings .close', { timeout: 5000 });
await sleep(400);
const settingsClosed = await page.evaluate(() => !!document.querySelector('.gk-screen.settings')?.classList.contains('hidden'));
check('настройки закрываются', settingsClosed);
await page.evaluate(() => window.__GK.startRun());
await sleep(1200);
const sr = await peek();
check('рестарт: полный сброс', sr.phase === 'PLAYING' && sr.hp === 100 && sr.redTouched === 0 && !sr.awakened);

// ---------- 8. стабильность кадров ----------
let bad = 0, frames = 0;
for (let i = 0; i < 12; i++) {
  const s = await peek();
  frames++;
  if (s.fps < 3) bad++;
  await sleep(500);
}
check('нет зависаний (fps ≥ 3 на софт-рендеринге SwiftShader; на GPU цель 60)', bad === 0, `fps=${(await peek()).fps} (SwiftShader)`);

console.log(errors.length ? `[smoke] ERRORS (${errors.length}):\n` + [...new Set(errors)].slice(0, 10).join('\n') : '[smoke] консоль чистая');
console.log(`[smoke] ИТОГ: ${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`);
await browser.close();
process.exit(failures || errors.length ? 1 : 0);
