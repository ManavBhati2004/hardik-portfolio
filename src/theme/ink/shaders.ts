/*
 * Ink spread shader. The mask (blob, tendrils, paper fibres, haze, speckles and the
 * pigment rim) is ported from "Ink Bleed" by Codemure (https://www.codemure.com),
 * MIT License, Copyright (c) 2026 Codemure.
 *
 * Adapted for a live WebGL page: instead of blending two page snapshots, the overlay
 * shows the frozen "from" frame and the ink makes it TRANSPARENT, revealing the live,
 * already-switched scene underneath. Output is premultiplied alpha.
 */
import { NOISE_CELLS } from './noiseTexture'

export const FULLSCREEN_VERT = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`

export const INK_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uFrom;    // frozen frame, viewport-sized, top-down rows
uniform float uCanvasScale; // device px per CSS px
uniform vec2 uRes;          // canvas device px

uniform vec2 uCenter;       // CSS px, viewport-relative
uniform float uRadius;      // CSS px, eased base radius
uniform float uCleanup;     // CSS px, extra reach that guarantees full coverage at the end
uniform float uTime;        // seconds since click
uniform float uRef;         // CSS px, noise reference length (max viewport side)
uniform vec2 uSeed;
uniform mat2 uSeedRot;

uniform float uTendril;
uniform float uNoiseScale;
uniform float uSoftness;
uniform float uDrift;
uniform vec3 uRimColor;     // pigment pooled at the frontier (ink by night, bleach by day)

out vec4 outColor;

const float A_LOBE = 0.22;
const float A_BLOB = 0.20;
const float A_SUM = A_LOBE + A_BLOB;
const float TENDRIL_REACH = 0.24;
const float FIBRE_PX = 1.8;
const float THIN_MAX_PX = 26.0;
const float SPECK_PX = 18.0;
const float HAZE_PX = 16.0;

uniform sampler2D uNoise;
const float INV_CELLS = 1.0 / ${NOISE_CELLS.toFixed(1)};

float gnoise(vec2 p) { return textureLod(uNoise, p * INV_CELLS, 0.0).r * 2.0 - 1.0; }
float gnoise2(vec2 p) { return textureLod(uNoise, p * INV_CELLS, 0.0).g * 2.0 - 1.0; }

const mat2 OCT = mat2(0.8, 0.6, -0.6, 0.8) * 2.03;

float fbm3(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * gnoise(p); p = OCT * p + 17.13; a *= 0.5; }
  return s / 0.875;
}
float fbm4(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * gnoise(p); p = OCT * p + 17.13; a *= 0.5; }
  return s / 0.9375;
}
float fbm5(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * gnoise(p); p = OCT * p + 17.13; a *= 0.5; }
  return s / 0.96875;
}

vec3 sampleFrom(vec2 devPx) {
  vec2 uv = clamp(devPx / uRes, vec2(0.0), vec2(1.0));
  return texture(uFrom, uv).rgb;
}

void main() {
  vec2 devPx = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 css = devPx / uCanvasScale;
  vec2 rel = css - uCenter;
  float d = length(rel);
  float R = uRadius;
  float cleanup = uCleanup;

  float inner = R * (1.0 - A_SUM) + cleanup - FIBRE_PX - THIN_MAX_PX - uSoftness * 2.0;
  float outer = R * (1.0 + A_SUM) * (1.0 + TENDRIL_REACH * uTendril) + cleanup + FIBRE_PX + SPECK_PX + uSoftness * 2.0;
  if (d < inner) { outColor = vec4(0.0); return; }
  if (d > outer) { outColor = vec4(sampleFrom(devPx), 1.0); return; }

  float t = uTime * uDrift;
  vec2 p = rel / uRef;
  vec2 dir = uSeedRot * (rel / max(d, 1e-3));
  float ns = uNoiseScale;

  vec2 q = p * (2.4 * ns) + uSeed;
  vec2 w = vec2(fbm3(q + vec2(0.0, 0.31 * t)), fbm3(q + vec2(5.2, 1.3) - vec2(0.27 * t, 0.0)));
  float blob = fbm5(q + 2.3 * w + vec2(0.12 * t, -0.08 * t));
  vec2 lq = dir * 0.9 + uSeed.yx * 0.37 + vec2(0.06 * t);
  float lobes = gnoise(lq) * 0.75 + gnoise(lq * 2.1 + 9.1) * 0.25;
  float reach = clamp(1.0 + A_LOBE * 1.6 * lobes + A_BLOB * 1.5 * blob, 1.0 - A_SUM, 1.0 + A_SUM);
  float f = d - R * reach;

  float gate = smoothstep(-0.35, 0.4, fbm3(dir * 1.6 + uSeed * 0.61 + 3.7));
  vec2 tq = dir * (2.2 * ns) + (d / uRef) * vec2(2.6, -1.9) * ns + 1.2 * w + uSeed * 1.7 + vec2(0.0, 0.18 * t);
  float n = fbm4(tq);
  float ridgePx = abs(n) * max(d, 24.0) / (4.0 * ns);
  float lenN = gnoise(dir * 3.1 + uSeed * 0.43 + vec2(0.1 * t)) * 0.5 + 0.5;
  float L = uTendril * TENDRIL_REACH * R * gate * (0.35 + 0.65 * lenN);
  float along = clamp(f / max(L, 1.0), 0.0, 1.0);
  float width = clamp(R * 0.022, 1.5, 9.0) * (1.0 - along * along) * gate;
  float ft = max(f - L, ridgePx - width);
  float k = 6.0;
  float hh = clamp(0.5 + 0.5 * (ft - f) / k, 0.0, 1.0);
  f = mix(ft, f, hh) - k * hh * (1.0 - hh);

  vec2 fq = css * 0.34 + uSeed * 13.0;
  float fibre = gnoise2(fq) * 0.65 + gnoise2(OCT * fq + 5.3) * 0.35;
  f += fibre * FIBRE_PX;
  f -= cleanup;

  float soft = max(uSoftness, 0.6);
  float inked = 1.0 - smoothstep(-soft, soft, f);
  float thinW = mix(3.0, THIN_MAX_PX, clamp(blob * 0.8 + 0.3, 0.0, 1.0));
  float density = mix(0.6, 1.0, smoothstep(0.0, thinW, -f));
  float cov = inked * density;

  float hazeW = mix(4.0, HAZE_PX, clamp(0.5 + 0.5 * blob, 0.0, 1.0));
  float haze = (1.0 - smoothstep(0.0, hazeW, f)) * smoothstep(-0.3, 0.6, 0.35 * fibre + w.x);
  cov = max(cov, haze * 0.24 * step(0.0, f));

  float ahead = clamp(f / SPECK_PX, 0.0, 1.0);
  if (f > 0.0 && ahead < 1.0) {
    float sn = gnoise2(css * 0.55 + uSeed * 7.0 + 41.0) * 0.5 + 0.5;
    float th = mix(0.80, 0.96, ahead);
    cov = max(cov, smoothstep(th, th + 0.04, sn) * 0.75 * (1.0 - ahead));
  }

  // "from" stays where there is no ink; ink reveals the live scene (transparent)
  float a = 1.0 - cov;
  vec3 col = sampleFrom(devPx) * a; // premultiplied

  // pigment rim pooled at the frontier
  float rimX = (f + soft * 1.1) / (soft * 1.4 + 1.2);
  float rim = exp(-rimX * rimX) * inked * 0.45;
  col = col * (1.0 - rim) + uRimColor * rim;
  a = a * (1.0 - rim) + rim;

  outColor = vec4(col, a);
}
`
