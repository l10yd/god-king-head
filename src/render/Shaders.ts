/**
 * Shaders.ts — материалы главных «звёзд» визуала:
 * глазное яблоко, луч, души, духи, glow-спрайты, объёмный туман.
 * Каждый шейдер намеренно дешёвый: сложность только у головы.
 */
import { ShaderMaterial, Color, Vector3, AdditiveBlending, DoubleSide, BackSide, NormalBlending } from 'three';
import { GLSL_VALUE_NOISE } from './GlslCommon';

/* ============================== ГЛАЗ ============================== */
export interface EyeUniforms {
  uTime: { value: number };
  uGlow: { value: number };       // 0..1 свечение радужки
  uOpen: { value: number };       // для тонировки белков
  uPupil: { value: number };      // dilation 0..1
  uHit: { value: number };        // вспышка при выстреле луча
}

export function createEyeMaterial(): ShaderMaterial {
  const uniforms: EyeUniforms & { [k: string]: { value: unknown } } = {
    uTime: { value: 0 },
    uGlow: { value: 0 },
    uOpen: { value: 0 },
    uPupil: { value: 0.5 },
    uHit: { value: 0 },
  };
  return new ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vLocalPos;
      varying vec3 vN;
      void main() {
        vLocalPos = position;
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vLocalPos;
      varying vec3 vN;
      uniform float uTime, uGlow, uOpen, uPupil, uHit;
      ${GLSL_VALUE_NOISE}
      void main() {
        vec3 d = normalize(vLocalPos);
        float front = d.z; // радужка «смотрит» по +Z локально (глаз вращается)
        float ang = length(d.xy);

        // --- радужка: концентрические лучи + перелив ---
        float rings = 0.5 + 0.5 * sin(atan(d.y, d.x) * 46.0 + front * 6.0 + uTime * 0.4);
        float irisR = mix(0.34, 0.42, rings * 0.5 + fbm3(d * 6.0) * 0.5);
        float iris = smoothstep(irisR + 0.06, irisR - 0.02, ang);
        // --- зрачок ---
        float pupil = smoothstep(uPupil * 0.18 + 0.03, uPupil * 0.18 - 0.01, ang);
        // --- белок: тёмный, каменно-влажный, с прожилками ---
        float veins = smoothstep(0.55, 0.75, ridge(d * 9.0)) * 0.5;
        vec3 sclera = mix(vec3(0.075, 0.072, 0.082), vec3(0.16, 0.15, 0.17), fbm3(d * 4.0));
        sclera += vec3(0.10, 0.02, 0.02) * veins * (1.0 - uGlow * 0.5);
        // --- цвета радужки: сверхъестественный бело-циановый ---
        vec3 irisCol = mix(vec3(0.35, 0.75, 0.85), vec3(0.85, 0.95, 1.15), pow(front, 2.0));
        irisCol = mix(irisCol * 0.25, irisCol, uGlow);
        vec3 col = sclera;
        col = mix(col, irisCol, iris * (0.35 + 0.65 * uGlow));
        col = mix(col, vec3(0.006, 0.008, 0.012), pupil);
        // внутреннее свечение радужки (главное оружие бога)
        float rimGlow = pow(max(front, 0.0), 1.6);
        col += vec3(0.7, 0.95, 1.1) * uGlow * rimGlow * (0.9 + 0.25 * sin(uTime * 3.0)) * iris;
        // вспышка при выстреле
        col += vec3(1.4, 1.5, 1.7) * uHit * (iris + 0.25);
        // краевой свет века когда глаз полузакрыт
        col *= mix(0.55, 1.0, uOpen);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

/* ============================== ЛУЧ ============================== */
export interface BeamUniforms {
  uTime: { value: number };
  uIntensity: { value: number }; // заряд → вспышка → затухание
  uColorA: { value: Color };     // кор
  uColorB: { value: Color };     // кромка
  uSeed: { value: number };
}

export function createBeamMaterial(): ShaderMaterial {
  const uniforms: BeamUniforms & { [k: string]: { value: unknown } } = {
    uTime: { value: 0 },
    uIntensity: { value: 0 },
    uColorA: { value: new Color('#ffffff') },
    uColorB: { value: new Color('#7a4dff') },
    uSeed: { value: 0 },
  };
  return new ShaderMaterial({
    uniforms,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUvCyl;
      varying vec3 vN;
      varying vec3 vViewDir;
      void main() {
        vUvCyl = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vViewDir = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUvCyl;
      varying vec3 vN;
      varying vec3 vViewDir;
      uniform float uTime, uIntensity, uSeed;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      ${GLSL_VALUE_NOISE}
      void main() {
        // vUvCyl.y — вдоль луча; «текучая» энергия
        float flow = fbm2(vec2(vUvCyl.x * 6.0, vUvCyl.y * 22.0 - uTime * 4.5 + uSeed));
        float flow2 = fbm2(vec2(vUvCyl.x * 3.0 + 17.0, vUvCyl.y * 9.0 - uTime * 2.2 + uSeed));
        // радиальный профиль: ядро + корона
        float edge = abs(vUvCyl.x - 0.5) * 2.0; // 0 центр, 1 край (у открытого цилиндра uv.x по окружности)
        float corona = pow(max(flow, flow2 * 0.6), 1.5);
        float core = exp(-edge * edge * 2.2);
        vec3 col = uColorA * core * (1.6 + 0.8 * corona)
                 + uColorB * corona * 0.9
                 + vec3(0.5, 0.8, 1.2) * corona * edge * 0.8;
        // фрешел-кромка трубки
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vViewDir))), 2.0);
        col += uColorB * fres * 1.2;
        float flick = 0.85 + 0.15 * sin(uTime * 40.0 + vUvCyl.y * 60.0);
        gl_FragColor = vec4(col * uIntensity * flick, 1.0);
        gl_FragColor.a = uIntensity * clamp(core + corona * 0.8 + fres * 0.6, 0.0, 1.0) * flick;
      }
    `,
  });
}

/* ============================== ДУШИ ============================== */
export function createSoulMaterial(hex: number, halo = true): ShaderMaterial {
  const c = new Color(hex);
  const haloPow = halo ? 1.5 : 2.2;
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: c },
      uTime: { value: 0 },
      uSeed: { value: Math.random() * 10 },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vLocal;
      uniform float uTime;
      uniform float uSeed;
      ${GLSL_VALUE_NOISE}
      void main() {
        vLocal = position;
        vec3 p = position;
        // органическое «дыхание» поверхности
        float wob = vnoise(normalize(position) * 3.0 + uTime * 1.6 + uSeed) * 0.09;
        p *= 1.0 + wob;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vLocal;
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uSeed;
      ${GLSL_VALUE_NOISE}
      void main() {
        float fres = 1.0 - max(dot(normalize(vN), normalize(vV)), 0.0);
        float glow = pow(fres, ${haloPow.toFixed(2)});
        float inner = 0.55 + 0.45 * sin(uTime * 2.2 + uSeed + fbm3(vLocal * 4.0) * 8.0);
        vec3 col = uColor * (glow * 2.1 + pow(1.0 - fres, 2.5) * 0.35) * (0.75 + 0.5 * inner);
        // мягкая невидимая кромка вместо диска
        float a = clamp(glow * 1.35 + 0.12, 0.0, 1.0);
        gl_FragColor = vec4(col, a * (0.86 + 0.14 * inner));
      }
    `,
  });
}

/* ============================== КРАСНЫЙ ДУХ ============================== */
export function createSpiritMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: 0 },
      uAggro: { value: 0 },
      uAlpha: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUvG;
      varying vec3 vN;
      varying vec3 vV;
      uniform float uTime;
      uniform float uSeed;
      ${GLSL_VALUE_NOISE}
      void main() {
        vUvG = uv;
        vec3 p = position;
        // дымящаяся деформация — «не совсем материя»
        float n = vnoise(p * 0.55 + vec3(uTime * 0.9 + uSeed, uTime * 0.4, 0.0));
        p += normal * n * 0.55;
        p.x += sin(p.y * 0.7 + uTime * 2.2 + uSeed) * 0.5;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUvG;
      varying vec3 vN;
      varying vec3 vV;
      uniform float uTime, uSeed, uAggro, uAlpha;
      ${GLSL_VALUE_NOISE}
      void main() {
        float fres = 1.0 - max(dot(normalize(vN), normalize(vV)), 0.0);
        float smoke = fbm2(vec2(vUvG.x * 5.0 + uSeed, vUvG.y * 3.0 - uTime * 0.8));
        float body = smoothstep(0.32, 0.72, smoke * 0.7 + fres * 0.8);
        vec3 deep = vec3(0.35, 0.012, 0.012);
        vec3 hot  = vec3(1.6, 0.18, 0.08);
        vec3 col = mix(deep, hot, body) * (0.65 + 0.5 * fres);
        col += vec3(1.0, 0.5, 0.2) * pow(body, 3.0) * 0.9;
        col *= 0.85 + 0.35 * uAggro;
        float flick = 0.8 + 0.2 * sin(uTime * 13.0 + uSeed * 7.0);
        float a = body * flick * uAlpha * 0.72;
        if (a < 0.01) discard;
        gl_FragColor = vec4(col, a);
      }
    `,
  });
}

/* ============================== GLOW-СПРАЙТ ============================== */
export function createGlowSpriteMaterial(hex: number, power = 2.0): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(hex) }, uOpacity: { value: 1 }, uPower: { value: power } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUvS;
      void main() { vUvS = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUvS;
      uniform vec3 uColor;
      uniform float uOpacity, uPower;
      void main() {
        float d = distance(vUvS, vec2(0.5)) * 2.0;
        float g = pow(max(1.0 - d, 0.0), uPower);
        gl_FragColor = vec4(uColor * g, g * uOpacity);
      }
    `,
  });
}

/* ============================== ТУМАН ВОКРУГ ГОЛОВЫ ============================== */
export function createMistMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uTint: { value: new Color('#35406a') }, uOpacity: { value: 0.10 } },
    transparent: true,
    depthWrite: false,
    side: BackSide,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec3 vLocal;
      varying vec3 vN;
      void main() { vLocal = position; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vLocal;
      varying vec3 vN;
      uniform float uTime, uOpacity;
      uniform vec3 uTint;
      ${GLSL_VALUE_NOISE}
      void main() {
        vec3 d = normalize(vLocal);
        float n = fbm3(d * 3.0 + vec3(0.0, uTime * 0.02, uTime * 0.015));
        float rim = pow(1.0 - abs(dot(normalize(vN), vec3(0.0,0.0,1.0))), 1.5);
        gl_FragColor = vec4(uTint * n, n * uOpacity * rim);
      }
    `,
  });
}

/* ============================== НЕБУЛА / SKY ============================== */
export function createNebulaMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vDir;
      uniform float uTime;
      ${GLSL_VALUE_NOISE}
      void main() {
        vec3 d = normalize(vDir);
        // глубокий космос: слоистая туманность + далёкие «структуры»
        float a = fbm3_hi(d * 2.2 + vec3(11.0));
        float b = fbm3(d * 5.5 + vec3(-7.0) + a * 1.5);
        float c = fbm3(d * 11.0 + b * 2.0);
        vec3 violet = vec3(0.045, 0.020, 0.085);
        vec3 teal = vec3(0.010, 0.050, 0.062);
        vec3 ember = vec3(0.075, 0.020, 0.008);
        vec3 col = mix(vec3(0.004, 0.005, 0.010), violet, smoothstep(0.42, 0.78, a));
        col = mix(col, teal, smoothstep(0.52, 0.85, b) * 0.7);
        col = mix(col, ember, smoothstep(0.68, 0.92, c) * 0.5);
        // тонкие «пылевые полосы»
        col *= 0.75 + 0.55 * fbm3(d * 1.3 + vec3(31.0, 0, 0));
        // далёкие гигантские дуги-структуры — почти невидимые, felt, не seen
        float arc = smoothstep(0.995, 1.0, dot(d, normalize(vec3(-0.4, 0.75, -0.5))));
        arc += smoothstep(0.997, 1.0, dot(d, normalize(vec3(0.8, -0.1, 0.5))));
        col += vec3(0.02, 0.025, 0.045) * arc * 2.0;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

/* ============================== ЗВЁЗДЫ ============================== */
export function createStarsMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aPhase;
      varying float vTw;
      uniform float uTime;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (280.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
        vTw = 0.55 + 0.45 * sin(uTime * (0.4 + aPhase) + aPhase * 40.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying float vTw;
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        float d = length(p);
        float s = smoothstep(0.5, 0.05, d);
        gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * s * vTw * 0.8, s);
      }
    `,
  });
}

/* ============================== ОРБИТАЛЬНАЯ ПЫЛЬ ============================== */
export function createDustMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aPhase;
      varying float vA;
      uniform float uTime;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (240.0 / max(1.0, -mv.z));
        gl_Position = projectionMatrix * mv;
        vA = 0.35 + 0.4 * sin(uTime * 0.5 + aPhase * 6.283);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying float vA;
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        float d = length(p);
        if (d > 0.5) discard;
        float s = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vec3(0.35, 0.45, 0.62) * s, s * vA * 0.25);
      }
    `,
  });
}

/* ============================== ЧАСТИЦЫ (burst/trail) ============================== */
export function createParticlesMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {},
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aLife;   // 0..1 затухание
      attribute float aSize;
      attribute vec3 aColor;
      varying vec3 vCol;
      varying float vAlpha;
      void main() {
        vCol = aColor;
        vAlpha = aLife;
        if (aLife <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (1.0 + (1.0 - aLife) * 1.2) * (170.0 / max(1.0, -mv.z));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vCol;
      varying float vAlpha;
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        float d = length(p);
        if (d > 0.5) discard;
        float s = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vCol * (s + pow(s, 4.0) * 1.6), s * vAlpha);
      }
    `,
  });
}

/** Кольцо-ударная волна (собирается из кольца, аддитивное) */
export function createShockRingMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color('#6fe8ff') }, uOpacity: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    vertexShader: `
      varying float vRad;
      void main() {
        vRad = length(position.xy); // RingGeometry лежит в XY, inner..outer
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying float vRad;
      uniform vec3 uColor;
      uniform float uOpacity;
      void main() {
        float ring = smoothstep(1.0, 0.82, vRad) * smoothstep(0.55, 0.8, vRad);
        gl_FragColor = vec4(uColor, ring * uOpacity);
      }
    `,
  });
}
