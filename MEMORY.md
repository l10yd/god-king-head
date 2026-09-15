# Проект: god-king-head — «ГОЛОВА БОГА-КОРОЛЯ», браузерная 3D-игра (WebGL2)

## Стек
TypeScript 5.9 strict · Vite 7 · three 0.180 (+@types/three) · EffectComposer-пост ·
WebAudio-процедур · vitest (47 тестов, input.test — jsdom) · playwright-core + системный Chrome (smoke).
npm в песочнице: `--cache ./.npm-cache --ignore-scripts`.

## Архитектура
Игрок — точка на сфере ORBIT_RADIUS=240 вокруг головы R=80 (1u=1m, без шеи —
парящая голова; пьедестал удалён). Всё процедурно:
череп — сферическая сетка 176 сегм. + ~24 проективных Gaussian-черты (HeadSculpt);
шейдерные материалы (камень/кожа/глаза/луч/души/туман/звёзды) — Shaders/HeadMaterial;
звук — AudioEngine (дрон/сердцебиение/колокол/луч). Голова следит кватернионом
(HeadTracking, +Z = лицо, safe на полюсах); gaze — чистая машина фаз GazeSystem
(CALM→AWARENESS→LOCK→CHARGE 1.25s→FIRE→COOLDOWN, гистерезис release 0.90);
луч — BeamSystem (V-цилиндры, логическая ось с ограниченным доворотом, hitAngle).
Оркестрация — Game.ts (состояния INTRO/PLAYING/PAUSED/DYING/GAMEOVER, timeScale,
сглаженные FX-униформы в финальный пост-шейдер). Пулинг: меши душ + кольцевой буфер
частиц 2600. QA-хуки окна: `window.__GK` (debugPeek/teleport/faceGaze/spirit/goldNearPlayer/
redsRing/kill/heal/playerDir; в peek — cursed, curseTimer, reds, boosting, dashTimer, touch).
ТАЧ (src/ui/TouchControls.ts): слой в body z-8, создаётся ТОЛЬКО если supported()
(maxTouchPoints/coarse); виден в PLAYING/DYING после первого touchstart (гибрид с
мышью не трогается). Стикт пишет в input.touch (непрерывно), queueDash()/nudgeZoom()
— в очереди; Input.read() сливает с клавиатурой (клмп -1..1). Отклонение ≥0.9 = boost.
setPointerCapture в try/catch (синтетические PointerEvent в smoke). html: user-scalable=no
+ touch-action:none (иначе стик скроллит Chrome). На десктопе DOM-слоя нет — регрессия в smoke.
КАСАТЕЛЬНЫЙ БАЗИС ВВОДА — внутри PlayerController (upRef, параллельный перенос
вдоль траектории). КАМЕРА берёт up оттуда же; никогда не наоборот: базис из
камерного quaternion давал петлю обратной связи («водоворот» при удержании S).
Камера радиально-догоняющая, зум колесом (CAM.ZOOM_*; старт рана: за 2s разлёт
MIN→MAX (easeOutCubic), controlLock, колесо глухо до конца раслёта; потом zoomTarget=MAX).
Скорости игрока/духов — УГЛОВЫЕ (rad/s) → смена радиуса орбиты не ломает ритм.
Луч: beamTurnSpeed НИЖЕ игроцких 0.14/0.266/0.336 (убеждаемость), headTrack ≤0.30;
COOLDOWN выходит по таймеру (НЕ по dot — голова-трекер держит dot≈1 → был дедлок
«никогда больше не стреляет»). Души: гало-спрайты ОБЯЗАТЕЛЬНО с map=makeGlowTexture
(без map спрайт = аддитивный КВАДРАТ).

## Ключевые файлы
- src/Game.ts — цикл/состояния/события; горячий кадр без аллокаций (модульные temps)
- src/constants.ts — все тюнинг-числа (DIFFICULTY фазы, HEAD-пороги gaze, QUALITY_PRESETS)
- src/game/GazeSystem.ts — фазы+visits (тестируется); Awakening — кривые век 8.5s
- src/head/* — черчение лица, веки-риг, трекинг, луч
- src/render/Renderer.ts — композер + FINAL_SHADER (teal-orange, vignette, grain, CA,
  redPulse-к-краям, whiteFlash, heat)
- src/ui/TouchControls.ts — виртуальный стик + кнопки рывка/зума/паузы (только тач)
- scripts/smoke.mjs — приёмочный прогон §59 (40 проверок, вкл. мобильный тач-контекст)
- tests/*.test.ts — орбита/трекинг/gaze/difficulty/score/rng/fsm + инварианты
  PlayerController (сфера R при 6000 кадров, анти-спираль большой окружности, полюса)

## Прогресс
✅ Полный цикл работает в браузере: интро→раслёт камеры→сбор→дух→пробуждение→взгляд→
LOCK→CHARGE→BEAM (урон)→escape→СМЕРТЬ (залпы повторяются)→GAME OVER→рестарт.
Smoke 40/40 PASS (реальные клики, зум-раслёт/упоры, регрессии водоворота, повторного
залпа, золотой волны, + мобильный тач-контекст), консоль чистая. 47/47 юнит-тестов.
tsc чистый, vite build OK.
БАЛАНС v4 (по фидбеку юзера): спавн ×2 кроме золота (PHASES blue28-60/green8-14/red4-56,
MAX_BLUE60/GREEN14/RED56, POOL.MAX_ENTITIES=170); зелёные лечат 7 (PLAYER.HEAL_GREEN);
красных больше со временем; КРАСНЫЙ НЕ СНИМАЕТ HP — крадёт тягу: PlayerController.curseTimer
(PLAYER.CURSE_DURATION=2.4s, CURSE_SLOW=0.5, блок Shift/рывок), HUD гасит шкалу тяги
(.gk-bar.boost.cursed); духи преследуют в поле зрения (SoulField: angToPlayer<RED_CHASE_CONE,
поводок cone×1.7, redChaseChance=danger×0.35); скорость красных растёт с danger
(RED_SPEED_BASE 0.045→MAX 0.13 < дэш 0.336); dangerScore вес красных 0.85 (1−e^−red/10) →
чем больше собрано, тем быстрее голова; ЗОЛОТО→fireGoldWave: кольцо createShockRingMaterial
(GOLD_WAVE.RADIUS=60) + field.purgeRedsNear + по +75 за духа. старт зум=MIN→за 2s до MAX.
v2/v3: голова 80м / орбита 240м / камера 26м + зум 0.35–2.6×; мышь-обзор, beamDodge,
пьедестал-«шея» удалены; луч убегаем (turn<скорости игрока); гало — круглые glow-текстуры.
Dev-порт 5199 (5173 занят nebula-rush в этом воркспейсе; vite жёстко на 127.0.0.1).

## Баг-реестр (важно)
- **Кнопка интро не нажималась** (найдена юзером): правило `#ui > * { pointer-events: auto }`
  в index.html (специфичность id 1,0,0) перебивало `.gk-screen.hidden { pointer-events: none }`
  (0,2,0) — невидимый экран settings (последний в DOM, inset:0, z:20) глушил клики.
  Лечится: НЕ вешать pointer-events:auto на всех детей #ui; интерактивные элементы включают
  auto сами (ui.css). Плюс `.gk-screen.hidden` теперь ещё и `visibility:hidden`. Smoke сверяет
  topEl под курсором — регрессия не пройдёт.
- **Водоворот при удержании S** (регрессия v2, найдена юзером): базис ввода брался из
  quaternion камеры, а камера тянулась к голове/инерцировала → петля обратной связи.
  Лечится только переносом базиса В PlayerController (upRef + параллельный перенос);
  камера берёт up СНАРУЖИ. Smoke-секция 3.6 + unit «анти-спираль» стерегут.
- **Луч неубегаем + залп был всегда один** (найдено юзером): (1) beamTurnSpeed 0.55–2.2
  >> 0.14 игрока — порезано до 0.075–0.165; (2) GazeSystem COOLDOWN выход требовал
  dot<0.90, но голова-трекер держит dot≈1 → вечный залип → «фарм без атак». Выход —
  по таймеру. Стерегут: unit «повторные залпы» + smoke 5.5 (FIRE>=2), difficulty «луч
  обгоняется».
- **Квадратное гало душ**: спрайты нимбов без map → белый аддитивный квадрат (у красных
  духов спрайтов нет — потому и «только у душ»). map=makeGlowTexture обязателен.
- ВНИМАНИЕ: правки файлов проекта — только write/edit-инструментами. Перезапись
  PowerShell `Get-Content|Set-Content` ломает кириллицу (PS5.1 читает UTF-8 без BOM как ANSI).

## TODO / что осталось сделать
- Проверить 60 fps на реальной GPU-машине (smoke гонялся на SwiftShader ~5–7 fps)
- Полировка вайба по вкусу после живого прогона (bloom/дрон/тайминги)
- Web Worker не нужен: логика кадра дёшева (решение задокументировано)

## Замечания
- `package.json` править точечно: vite крашится на EBUSY временного tmp-dir редактора
- Vite dev + Chrome headless: `--use-angle=swiftshader --enable-unsafe-swiftshader`
- Игровые таймеры при низком fps идут медленнее wall-time (dt clamp 0.05) — в тестах поллить
