/**
 * HeadMaterial — «каменно-органическая» кожа Бога-Короля.
 * PBR-лайт без тяжёлых текстур: процедурные трещины, вариация цвета,
 * светящиеся прожилки (aVeinMask + ridge-шум), sub-surface-аппроксимуляция
 * (wrap-диффуз + внутреннее дыхание), подсветка от глаз.
 */
import { ShaderMaterial, Color, Vector3, DoubleSide } from 'three';
import { GLSL_VALUE_NOISE } from './GlslCommon';

export interface HeadUniforms {
  [k: string]: { value: unknown };
  uTime: { value: number };
  uAwake: { value: number };        // 0..1 прогресс пробуждения
  uDanger: { value: number };       // 0..1 текущая опасность (glow veins)
  uPulse: { value: number };        // 0..1 дыхание/пульсация
  uKeyDir: { value: Vector3 };
  uKeyColor: { value: Color };
  uKeyIntensity: { value: number };
  uAmbTop: { value: Color };
  uAmbBottom: { value: Color };
  uEyePosL: { value: Vector3 };     // object-space
  uEyePosR: { value: Vector3 };
  uEyeGlow: { value: number };      // сила свечения из глазниц
  uBeamGlow: { value: number };     // отсвет луча на лице
  uRimColor: { value: Color };
}

export function createHeadMaterial(radius: number): ShaderMaterial {
  const uniforms: HeadUniforms = {
    uTime: { value: 0 },
    uAwake: { value: 0 },
    uDanger: { value: 0 },
    uPulse: { value: 0 },
    uKeyDir: { value: new Vector3(0.45, 0.7, 0.55).normalize() },
    uKeyColor: { value: new Color('#8fa3c8') },
    uKeyIntensity: { value: 2.6 },
    uAmbTop: { value: new Color('#141a2c') },
    uAmbBottom: { value: new Color('#05070d') },
    uEyePosL: { value: new Vector3() },
    uEyePosR: { value: new Vector3() },
    uEyeGlow: { value: 0 },
    uBeamGlow: { value: 0 },
    uRimColor: { value: new Color('#3a4a7a') },
  };

  return new ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute float aVeinMask;
      varying vec3 vN;
      varying vec3 vPos;
      varying vec3 vViewPos;
      varying float vVein;
      uniform float uTime;
      uniform float uPulse;
      uniform float uAwake;
      void main() {
        vVein = aVeinMask;
        vPos = position;
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPos = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vN;
      varying vec3 vPos;
      varying vec3 vViewPos;
      varying float vVein;
      uniform float uTime;
      uniform float uAwake;
      uniform float uDanger;
      uniform float uPulse;
      uniform float uEyeGlow;
      uniform float uBeamGlow;
      uniform vec3 uKeyDir;
      uniform vec3 uKeyColor;
      uniform float uKeyIntensity;
      uniform vec3 uAmbTop;
      uniform vec3 uAmbBottom;
      uniform vec3 uEyePosL;
      uniform vec3 uEyePosR;
      uniform vec3 uRimColor;
      ${GLSL_VALUE_NOISE}

      float cracks(vec3 p) {
        float r = ridge(p * 1.7);
        r = mix(r, ridge(p * 4.3 + vec3(13.0)), 0.5);
        return 1.0 - smoothstep(0.52, 0.66, r); // тонкие линии
      }

      void main() {
        vec3 N = normalize(vN);
        vec3 V = normalize(vViewPos);
        vec3 p = vPos;

        // --- базовый цвет: тёмный камень с минеральными вариациями ---
        float nvar = fbm3_hi(p * 0.16 + vec3(3.0));
        float nvar2 = fbm3(p * 0.62);
        vec3 stoneDark = vec3(0.052, 0.050, 0.056);
        vec3 stoneMid  = vec3(0.132, 0.115, 0.104); // тёплый «кожный» камень
        vec3 stoneOchre= vec3(0.185, 0.140, 0.092);
        vec3 base = mix(stoneDark, stoneMid, smoothstep(0.25, 0.75, nvar));
        base = mix(base, stoneOchre, smoothstep(0.55, 0.85, nvar2) * 0.5);
        // микротрещины затемняют и меняют тон
        float cr = cracks(p) * (0.55 + 0.45 * nvar2);
        base *= 1.0 - 0.55 * cr;

        // --- освещение: key + hemisphere + rim (всё в world-нормалях модели) ---
        vec3 keyDirView = normalize((viewMatrix * vec4(uKeyDir, 0.0)).xyz);
        float ndl = dot(N, keyDirView);
        float wrap = clamp((ndl + 0.42) / 1.42, 0.0, 1.0);
        // sub-surface подобие: тёплый рассеянный проход сквозь «кожу»
        float sss = pow(clamp(1.0 - ndl, 0.0, 1.0), 2.0) * clamp(dot(-N, keyDirView), 0.0, 1.0);
        vec3 diffuse = base * uKeyColor * (pow(wrap, 1.5) * uKeyIntensity * 0.42 + 0.10)
                     + base * vec3(0.9, 0.45, 0.25) * sss * 0.22 * (0.4 + 0.6 * uAwake);
        // hemisphere
        float hemi = 0.5 + 0.5 * normalize(vN.z * vec3(0.0) + N).y; // N в view; приемлемо для «неба сверху»
        vec3 ambient = mix(uAmbBottom, uAmbTop, hemi) * (0.75 + 0.35 * nvar);
        diffuse += base * ambient * 2.2;
        // rim
        float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        diffuse += uRimColor * rim * (0.5 + 0.6 * uDanger);
        // мягкий specular камня — редкий, грязный
        float rough = 0.6 + 0.4 * nvar2;
        vec3 H = normalize(keyDirView + V);
        float spec = pow(max(dot(N, H), 0.0), mix(18.0, 4.0, rough)) * 0.25;
        diffuse += uKeyColor * spec * max(ndl, 0.0);

        // --- внутренние прожилки: дышащее свечение из-под кожи ---
        float veinPulse = 0.5 + 0.5 * sin(uTime * 0.5 + fbm3(p * 0.08) * 12.0);
        float vein = vVein * (0.22 + 0.55 * veinPulse * uPulse);
        vein += smoothstep(0.62, 0.85, ridge(p * 2.6 + vec3(uTime * 0.015))) * 0.35 * uAwake;
        vec3 veinColor = mix(vec3(0.22, 0.10, 0.03), vec3(0.05, 0.32, 0.42), uAwake); // тёплые → циан
        diffuse += veinColor * vein * (0.35 + uDanger * 1.4 + uBeamGlow * 0.6);

        // --- отсвет из глазниц ---
        float dL = distance(p, uEyePosL);
        float dR = distance(p, uEyePosR);
        float socketGlow = uEyeGlow * (exp(-dL * dL / (18.0)) + exp(-dR * dR / (18.0)));
        diffuse += mix(vec3(0.9, 0.85, 1.05), vec3(1.2, 1.1, 0.9), uBeamGlow) * socketGlow * 1.6;
        // отсвет луча по всей передней части
        diffuse += vec3(0.8, 0.9, 1.3) * uBeamGlow * 0.06;

        // лёгкий туманный «холод космоса» на сильно отвёрнутых участках
        float back = 1.0 - clamp(p.z / ${radius.toFixed(1)}, -1.0, 1.0);
        diffuse *= mix(0.55, 1.0, 1.0 - smoothstep(0.9, 2.0, back));

        gl_FragColor = vec4(diffuse, 1.0);
      }
    `,
  });
}

/**
 * Материалы век (lid). Делят UNIFORM-ССЫЛКИ с материалом головы
 * (uTime/uAwake/uEyeGlow обновляются один раз на GodHead).
 */
export function createLidMaterial(headUniforms: HeadUniforms): ShaderMaterial {
  const uniforms = {
    uTime: headUniforms.uTime,
    uAwake: headUniforms.uAwake,
    uDanger: headUniforms.uDanger,
    uPulse: headUniforms.uPulse,
    uKeyDir: headUniforms.uKeyDir,
    uKeyColor: headUniforms.uKeyColor,
    uKeyIntensity: headUniforms.uKeyIntensity,
    uAmbTop: headUniforms.uAmbTop,
    uAmbBottom: headUniforms.uAmbBottom,
    uEyeGlow: headUniforms.uEyeGlow,
    uBeamGlow: headUniforms.uBeamGlow,
    uLidTint: { value: new Color('#0a0a0c') },
  };
  return new ShaderMaterial({
    uniforms,
    side: DoubleSide, // внутренняя сторона века видна при открытии
    vertexShader: /* glsl */ `
      attribute float aVeinMask;
      varying vec3 vN;
      varying vec3 vPos;
      varying vec3 vViewPos;
      void main() {
        vPos = position;
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPos = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vN;
      varying vec3 vPos;
      varying vec3 vViewPos;
      uniform float uTime;
      uniform float uAwake;
      uniform float uEyeGlow;
      uniform vec3 uKeyDir;
      uniform vec3 uKeyColor;
      uniform float uKeyIntensity;
      uniform vec3 uAmbTop;
      uniform vec3 uAmbBottom;
      uniform vec3 uLidTint;
      ${GLSL_VALUE_NOISE}
      void main() {
        vec3 N = normalize(vN);
        vec3 V = normalize(vViewPos);
        vec3 p = vPos;
        float nvar = fbm3_hi(p * 0.2);
        vec3 base = mix(uLidTint, vec3(0.10, 0.088, 0.078), smoothstep(0.3, 0.7, nvar));
        vec3 keyDirView = normalize((viewMatrix * vec4(uKeyDir, 0.0)).xyz);
        float wrap = clamp((dot(N, keyDirView) + 0.5) / 1.5, 0.0, 1.0);
        vec3 col = base * (uKeyColor * pow(wrap, 1.3) * uKeyIntensity * 0.4 + 0.12);
        col += base * mix(uAmbBottom, uAmbTop, 0.5 + 0.5 * N.y) * 2.0;
        // край века светится из-под кожи, когда глаз открывается
        float edge = pow(1.0 - max(dot(N, V), 0.0), 2.5);
        col += vec3(0.6, 0.24, 0.10) * edge * uAwake * 0.9;
        col += vec3(1.0, 0.9, 1.1) * edge * uEyeGlow * 0.35;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
