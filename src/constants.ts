/**
 * ГОЛОВА БОГА-КОРОЛЯ — единый файл тюнинга.
 * 1 юнит = 1 метр. Все игровые константы собраны здесь,
 * чтобы баланс правился в одном месте.
 */

/** Геометрия мира */
export const WORLD = {
  /** Радиус головы (сфера-основа черепа) — гигантская, заполняет полнеба с орбиты */
  HEAD_RADIUS: 80,
  /** Фиксированный радиус орбиты игрока вокруг центра головы (близко к лицу) */
  ORBIT_RADIUS: 240,
  /** Центр мира */
  CENTER: { x: 0, y: 0, z: 0 },
  /** Мин/макс радиус обитания душ и духов (относительно орбиты игрока) */
  SOUL_SHELL_MIN: 0.92,
  SOUL_SHELL_MAX: 1.10,
} as const;

/** Игрок */
export const PLAYER = {
  HEIGHT: 1.8,
  MAX_HP: 100,
  /** Угловые скорости движения по сфере (рад/с) */
  BASE_YAW_SPEED: 0.14,
  BASE_PITCH_SPEED: 0.12,
  BOOST_MULT: 1.9,
  /** Скорость нарастания/спада скорости (инерция) */
  ACCEL: 3.2,
  DECEL: 2.1,
  /** Дэш: импульс и длительность */
  DASH_IMPULSE: 1.6,
  DASH_DURATION: 0.45,
  DASH_COOLDOWN: 2.2,
  /** Буст-метр */
  BOOST_MAX: 100,
  BOOST_DRAIN: 42,
  BOOST_REGEN: 20,
  BOOST_MIN_USE: 12,
  /** Радиус подбора душ (щедший, аркадный; чтобы влетали в кадр до подбора) */
  COLLECT_RADIUS: 12,
  /** Радиус касания красного духа */
  SPIRIT_HIT_RADIUS: 11.5,
  /** Неуязвимость после касания духа, сек */
  SPIRIT_INVULN: 1.6,
} as const;

/** Голова и взгляд */
export const HEAD = {
  /** dot(headForward, toPlayer) пороги фаз */
  AWARENESS_DOT: 0.90,
  LOCK_DOT: 0.965,
  /** Углы, на которых луч «срывается» с игрока (для near-miss) */
  BEAM_RELEASE_DOT: 0.90,
  NEARMISS_DOT: 0.955,
  /** Базовые скорости трекинга, рад/с (масштабируются danger-уровнем).
   *  ПОТОЛОК намеренно ниже дэша игрока (0.336 рад/с) — из захвата головы
   *  можно вырваться ходом/бустом/рывком, иначе побег невозможен. */
  TRACK_SPEED_BASE: 0.10,
  TRACK_SPEED_PER_DANGER: 0.055,
  TRACK_SPEED_MAX: 0.30,
  /** Скорость глаз (опережают поворот головы) */
  EYE_TRACK_BASE: 0.5,
  EYE_TRACK_PER_DANGER: 0.14,
  EYE_TRACK_MAX: 4.5,
  /** Пробуждение: сколько длится полный cinematic, сек */
  AWAKENING_DURATION: 8.5,
  /** Заряд луча — время на побег, сек */
  BEAM_CHARGE_TIME: 1.25,
  /** Длительность firing, пока не сорвётся лок */
  BEAM_MAX_DURATION: 2.8,
  BEAM_COOLDOWN: 1.1,
  /** Урон луча в секунду */
  BEAM_DAMAGE_BASE: 16,
  BEAM_DAMAGE_PER_DANGER: 1.6,
  BEAM_DAMAGE_MAX: 34,
  /** Ширина луча (в метрах на конце) */
  BEAM_CORE_RADIUS: 7,
  BEAM_NEAR_RADIUS: 20,
} as const;

/** Очки */
export const SCORE = {
  BLUE: 100,
  BLUE_LARGE: 250,
  GOLD: 1000,
  GREEN: 25,
  SURVIVAL_PER_SEC: 10,
  NEAR_MISS: 50,
  GAZE_ESCAPE: 100,
  SPIRIT_TOUCH: -25,
  COMBO_MAX: 5,
  COMBO_WINDOW: 6.0,
} as const;

/** Кривая сложности: density-фазы по времени */
export const DIFFICULTY = {
  /** Первый красный дух не появляется раньше этого времени, сек */
  FIRST_RED_AT: 12,
  /** Период полуроста danger-таймера */
  TIME_DANGER_PERIOD: 95,
  /** Максимум времени в danger-формуле, сек */
  TIME_DANGER_CAP: 420,
  /** Целевая популяция: [blue, green, red] на фазу по времени (сек) */
  PHASES: [
    { t: 0,   blue: 14, green: 5, red: 3 },
    { t: 60,  blue: 18, green: 5, red: 6 },
    { t: 120, blue: 22, green: 6, red: 10 },
    { t: 180, blue: 26, green: 6, red: 15 },
    { t: 260, blue: 30, green: 7, red: 22 },
    { t: 360, blue: 34, green: 8, red: 30 },
  ],
  MAX_RED: 34,
  MAX_BLUE: 40,
  MAX_GREEN: 10,
  /** Скорость красных духов: базовая + рост по danger, рад/с */
  RED_SPEED_BASE: 0.028,
  RED_SPEED_PER_DANGER: 0.006,
  RED_SPEED_MAX: 0.12,
  /** Вероятность «преследования» игрока красным духом по danger */
  RED_CHASE_PER_DANGER: 0.06,
} as const;

/** HP красных духов-прикосновений (штраф по здоровью) */
export const SPIRIT_DAMAGE = 6;

/** Камера */
export const CAM = {
  /** Дистанция камеры за игроком (по радиалу от центра) */
  BACK_DISTANCE: 26,
  /** Смещение вверх от линии игрок-центр */
  LIFT: 2.5,
  FOV_BASE: 62,
  FOV_BOOST: 72,
  FOV_SPEED_ADD: 6,
  SMOOTH: 5.5,
  /** Смещение камеры к голове при опасном gaze (метры) */
  GAZE_PULL: 4.5,
  /** Насколько сильно gaze «тянет» точку взгляда камеры к голове */
  GAZE_TARGET_PULL: 3.2,
  /** Затягивание камеры к голове во время пробуждения (метры) */
  AWAKEN_PULL_M: 16,
  /** Зум колесом: множитель BACK_DISTANCE [мин, макс]; старт рана — близко */
  ZOOM_MIN: 0.35,
  ZOOM_MAX: 2.6,
  ZOOM_START: 0.5,
  /** Скорость «раслёта» камеры на старте (damp-лямбда, 1/с) */
  ZOOM_IN_RATE: 1.1,
  /** Шаг зума на один тик колеса */
  ZOOM_STEP: 0.16,
} as const;

/** Звук/музыка */
export const AUDIO = {
  MASTER: 0.9,
} as const;

/** Пресеты графики */
export type QualityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA';

export interface QualityPreset {
  pixelRatioMax: number;
  bloom: boolean;
  bloomStrength: number;
  /** Множитель лимитов частиц */
  particles: number;
  mistBillboards: number;
  stars: number;
  dust: number;
  spiritMeshQuality: number; // 1..3
  post: boolean;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  LOW: {
    pixelRatioMax: 0.75, bloom: false, bloomStrength: 0, particles: 0.35,
    mistBillboards: 6, stars: 1200, dust: 600, spiritMeshQuality: 1, post: false,
  },
  MEDIUM: {
    pixelRatioMax: 1.0, bloom: true, bloomStrength: 0.55, particles: 0.6,
    mistBillboards: 10, stars: 2400, dust: 1400, spiritMeshQuality: 2, post: true,
  },
  HIGH: {
    pixelRatioMax: 1.5, bloom: true, bloomStrength: 0.8, particles: 1.0,
    mistBillboards: 16, stars: 3800, dust: 2600, spiritMeshQuality: 2, post: true,
  },
  ULTRA: {
    pixelRatioMax: 2.0, bloom: true, bloomStrength: 0.95, particles: 1.5,
    mistBillboards: 22, stars: 5200, dust: 4200, spiritMeshQuality: 3, post: true,
  },
};

/** Лимиты пулов (абсолютный максимум; quality-множитель сужает активную часть) */
export const POOL = {
  MAX_PARTICLES: 2600,
  MAX_FLOATERS: 14,
  /** Сколько максимум активных сущностей душ/духов на сцене */
  MAX_ENTITIES: 120,
} as const;
