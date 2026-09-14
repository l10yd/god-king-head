/**
 * Renderer.ts — обёрта над WebGLRenderer + EffectComposer.
 *
 * Почему WebGL2 как основной путь: он гарантированно доступен во всех
 * браузерах среды запуска, а пост-стек Three (UnrealBloom/ShaderPass)
 * написан под него. WebGPU-рендерер Three пока не даёт совместимого
 * пост-пайплайна. Выбор изолирован здесь — смена бэкенда не трогает игру.
 *
 * Пост-цепочка: Render → Bloom → Финальный шейдер (grading, vignette,
 * chromatic aberration, film grain, red pulse при gaze, white flash).
 */
import {
  WebGLRenderer, Scene, PerspectiveCamera, WebGLRenderTarget, HalfFloatType,
  Vector2, NoToneMapping, ACESFilmicToneMapping,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { QualityPreset } from '../constants';

const FINAL_SHADER = {
  uniforms: {
    tDiffuse: { value: null as WebGLRenderTarget['texture'] | null },
    uTime: { value: 0 },
    uVignette: { value: 0.42 },
    uGrain: { value: 0.045 },
    uChroma: { value: 0.0016 },
    uRedPulse: { value: 0 },
    uWhiteFlash: { value: 0 },
    uHeat: { value: 0 },
    uDamage: { value: 0 },
    uSlowmo: { value: 0 },
    uExposure: { value: 1.06 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uChroma, uRedPulse, uWhiteFlash, uHeat, uDamage, uSlowmo, uExposure;
    varying vec2 vUv;

    vec3 filmic(vec3 x) {
      // лёгкий ACES-подобный filmic
      x *= uExposure;
      const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
      return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
    }

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    void main() {
      vec2 uv = vUv;
      vec2 cc = uv - 0.5;
      float r2 = dot(cc, cc);

      // тепловое марево при нагреве экрана (gaze lock)
      uv += vec2(sin(uv.y * 60.0 + uTime * 8.0), cos(uv.x * 55.0 + uTime * 6.0)) * 0.0015 * uHeat;

      // хроматическая аберрация к краям
      float ca = uChroma * (1.0 + uDamage * 3.0 + uRedPulse * 2.0);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + cc * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - cc * ca).b;

      col = filmic(col);

      // холодный grade в тени, тёплый в света — cinematic teal-orange, очень мягко
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      vec3 shadowTint = vec3(0.86, 0.92, 1.12);
      vec3 highTint = vec3(1.08, 0.98, 0.82);
      col *= mix(shadowTint, highTint, smoothstep(0.0, 0.55, lum)) * 0.92;

      // красный пульс опасности — усилен к краям кадра, центр сохраняет читаемость
      float edge = smoothstep(0.02, 0.45, r2);
      col = mix(col, vec3(1.0, 0.16, 0.10) * (lum * 1.5 + 0.06), uRedPulse * 0.5 * (0.25 + 0.9 * edge));

      // белая вспышка (near miss / death)
      col += vec3(1.0, 0.97, 0.9) * uWhiteFlash;

      // виньетка
      float vig = smoothstep(0.85, 0.25, r2 * 1.4);
      col *= mix(1.0, vig, uVignette);

      // плёночное зерно
      float g = hash(uv * vec2(1920.0, 1080.0) + fract(uTime) * 331.0) - 0.5;
      col += g * uGrain * (1.0 - lum * 0.5);

      // лёгкие тёмные углы склейки «как в кино» только при danger
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class Renderer {
  readonly renderer: WebGLRenderer;
  readonly composer: EffectComposer;
  readonly finalPass: ShaderPass;
  readonly bloomPass: UnrealBloomPass;
  private size = new Vector2(1, 1);
  private bloomEnabled = true;

  constructor(canvas: HTMLCanvasElement, preset: QualityPreset) {
    this.renderer = new WebGLRenderer({
      canvas, antialias: false, powerPreference: 'high-performance', stencil: false,
    });
    this.renderer.toneMapping = NoToneMapping; // тонмаппинг делает финальный шейдер
    this.renderer.outputColorSpace = 'srgb';
    this.renderer.setClearColor(0x000000, 1);
    // статистика копится за весь композит-кадр (сброс управляемый)
    this.renderer.info.autoReset = false;

    this.composer = new EffectComposer(this.renderer, new WebGLRenderTarget(1, 1, {
      type: HalfFloatType, samples: 0,
    }));
    this.bloomPass = new UnrealBloomPass(new Vector2(512, 512), 0.75, 0.72, 0.62);
    this.finalPass = new ShaderPass(FINAL_SHADER);
  }

  attach(scene: Scene, camera: PerspectiveCamera): void {
    this.composer.addPass(new RenderPass(scene, camera));
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.finalPass);
  }

  setQuality(preset: QualityPreset): void {
    this.bloomEnabled = preset.bloom;
    this.bloomPass.strength = preset.bloomStrength;
    this.bloomPass.enabled = preset.bloom;
    this.finalPass.enabled = preset.post;
    this.resize(this.size.x, this.size.y, preset);
  }

  resize(cssW: number, cssH: number, preset: QualityPreset): void {
    this.size.set(cssW, cssH);
    const dpr = Math.min(window.devicePixelRatio || 1, preset.pixelRatioMax);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(cssW, cssH, false);
    this.composer.setSize(Math.floor(cssW * dpr), Math.floor(cssH * dpr));
    this.bloomPass.resolution.set(Math.floor(cssW * dpr * 0.5), Math.floor(cssH * dpr * 0.5));
  }

  render(): void {
    this.renderer.info.reset();
    this.composer.render();
  }

  get info() {
    return this.renderer.info;
  }

  /** Униформы финального прохода */
  get fx() {
    return this.finalPass.uniforms;
  }

  dispose(): void {
    this.composer.dispose();
    this.renderer.dispose();
  }
}
