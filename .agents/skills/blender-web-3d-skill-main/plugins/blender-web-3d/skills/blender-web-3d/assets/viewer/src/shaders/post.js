// Post-processing shaders.
//
// NAN_SCRUB — mandatory before bloom. Some GPU/light/material combos emit isolated NaN
// fragments; bloom's separable blur smears ONE NaN pixel over the whole frame (black screen).
// Without a composer the LDR output clamps it and hides the bug, which is why it ambushes
// you the day bloom goes in.
//
// FINISH — runs after OutputPass (display-referred): radial chromatic aberration,
// vignette, and animated grain. The grain doubles as dither — it breaks up the 8-bit
// banding that dark nebula gradients otherwise show.

export const NAN_SCRUB = {
  name: "NanScrub",
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      if (c.r != c.r || c.g != c.g || c.b != c.b || c.a != c.a) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = clamp(c, vec4(0.0), vec4(1000.0));
    }`,
};

export const FINISH = {
  name: "Finish",
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.035 },
    uVignette: { value: 0.32 },
    uAberration: { value: 0.0018 },
    uFade: { value: 1 },         // 1 = black, animated to 0 on reveal (no DOM overlay needed)
  },
  vertexShader: NAN_SCRUB.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uVignette, uAberration, uFade;
    varying vec2 vUv;
    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main() {
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * r2 * uAberration * 4.0;
      vec3 c = vec3(texture2D(tDiffuse, vUv - off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + off).b);
      c *= 1.0 - uVignette * smoothstep(0.08, 0.55, r2);
      float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      float n = hash(gl_FragCoord.xy + fract(uTime * 7.13) * 431.0) - 0.5;
      c += n * uGrain * (1.0 - lum * 0.7);
      gl_FragColor = vec4(c * (1.0 - uFade), 1.0);
    }`,
};
