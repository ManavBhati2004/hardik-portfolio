// Material patches: add procedural surface detail to glTF materials at runtime via
// onBeforeCompile — zero texture bytes, a few ALU ops per pixel. Keyed on material NAME,
// so Blender material names are the contract between the model and the viewer.
//
//   panels  — hull plating: staggered panel seams, per-panel tint + roughness variation
//   windows — per-room occupancy, brightness, colour temperature, rare flicker
//   cells   — solar-cell grid + thin-film iridescence (material upgraded to Physical)
//
// Detail is computed in the mesh's PARENT space (uLocal = mesh.matrix) so it rides along with
// rotating parts and is in real units. Not raw object space: with KHR_mesh_quantization
// (meshopt / gltf-transform quantize) `position` is a normalized Int16 in [-1, 1] and the
// metres live in the node matrix — a "2 m panel" in raw object space covers the whole mesh.
// Detail fades out (via fwidth) before it can moire at distance.
import * as THREE from "three";

export const shared = {
  uTime: { value: 0 },
  uPanel: { value: 2.4 },      // panel size, model units (Blender metres before fit-scaling)
  uWinCell: { value: 2.2 },    // "room" size for window variation
  uCell: { value: 0.9 },       // solar cell pitch
};

const COMMON = /* glsl */ `
varying vec3 vObjPos;
varying vec3 vObjNrm;
uniform float uTime, uPanel, uWinCell, uCell;
float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
// dominant-axis projection: cheaper than blended triplanar, seams hide in the panel lines
vec3 projUV(vec3 p, vec3 n) {
  vec3 a = abs(n);
  if (a.x > a.y && a.x > a.z) return vec3(p.yz, 1.0);
  if (a.y > a.z) return vec3(p.xz, 2.0);
  return vec3(p.xy, 3.0);
}
// 1 on the seam, 0 inside the panel. f = distance from panel centre (0) to edge (0.5).
float gridLines(vec2 g, float width) {
  vec2 f = abs(fract(g) - 0.5);
  vec2 aa = fwidth(g) * 1.5;
  vec2 l = smoothstep(vec2(0.5 - width) - aa, vec2(0.5 - width), f);
  float fade = 1.0 - smoothstep(0.12, 0.35, max(aa.x, aa.y)); // kill before moire
  return max(l.x, l.y) * fade;
}
`;

const FRAG = {
  panels: {
    color: /* glsl */ `
      vec3 pj = projUV(vObjPos, vObjNrm);
      vec2 pg = pj.xy / uPanel * vec2(0.55, 1.0);          // long plates, not bricks
      pg.x += step(1.0, mod(floor(pg.y), 2.0)) * 0.37;    // offset rows (not a 50% brick bond)
      float seam = gridLines(pg, 0.012);
      float ph = h13(vec3(floor(pg), pj.z) + 0.5);
      // a few plates per hundred are replacements: visibly newer/darker — reads as history
      float patchPlate = step(0.93, ph);
      diffuseColor.rgb *= (1.0 - seam * 0.42) * (0.9 + ph * 0.14) * (1.0 - patchPlate * 0.22);`,
    rough: /* glsl */ `
      roughnessFactor = clamp(roughnessFactor + (ph - 0.5) * 0.16 + seam * 0.25 - patchPlate * 0.12, 0.04, 1.0);`,
  },
  windows: {
    emissive: /* glsl */ `
      vec3 wc = floor(vObjPos / uWinCell);
      float occ = h13(wc + 3.1);
      float lvl = 0.5 + 0.7 * h13(wc + 7.7);
      vec3 tint = mix(vec3(1.0), vec3(0.8, 0.92, 1.25), step(0.84, h13(wc + 1.3)));
      float flick = 1.0 - 0.6 * step(0.93, h13(wc + floor(uTime * 9.0))) * step(0.965, occ);
      totalEmissiveRadiance *= mix(0.05, lvl, step(0.16, occ)) * tint * flick;`,
  },
  cells: {
    color: /* glsl */ `
      vec3 cj = projUV(vObjPos, vObjNrm);
      float cellLine = gridLines(cj.xy / uCell * vec2(1.0, 1.35), 0.04);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.35, 0.37, 0.4), cellLine * 0.7);`,
    rough: /* glsl */ `
      roughnessFactor = mix(roughnessFactor, 0.5, cellLine);`,
  },
};

function patch(material, kind, local) {
  const f = FRAG[kind];
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, { uLocal: { value: local } });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vObjPos;\nvarying vec3 vObjNrm;\nuniform mat4 uLocal;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvObjPos = (uLocal * vec4(transformed, 1.0)).xyz;\nvObjNrm = mat3(uLocal) * objectNormal;`);
    let fs = shader.fragmentShader.replace("#include <common>", `#include <common>\n${COMMON}`);
    if (f.color) fs = fs.replace("#include <color_fragment>", `#include <color_fragment>\n${f.color}`);
    if (f.rough) fs = fs.replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${f.rough}`);
    if (f.emissive) fs = fs.replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${f.emissive}`);
    shader.fragmentShader = fs;
  };
  // Programs are cached by this key: every "panels" material shares one compiled program.
  material.customProgramCacheKey = () => `patch:${kind}`;
  material.needsUpdate = true;
}

/** Physical upgrade for thin-film surfaces (solar arrays, visors, coated optics). */
function toIridescent(m) {
  const p = new THREE.MeshPhysicalMaterial();
  THREE.MeshStandardMaterial.prototype.copy.call(p, m);
  p.name = m.name;
  p.iridescence = 0.55;
  p.iridescenceIOR = 1.45;
  p.iridescenceThicknessRange = [220, 520];
  p.clearcoat = 0.4;
  p.clearcoatRoughness = 0.18;
  return p;
}

/**
 * Walk the model once (after batching); returns every material now in use.
 * rules: [{ match: RegExp, kind: "panels"|"windows"|"cells" }]
 * Patched materials are cloned per mesh to carry that mesh's static uLocal; all clones of
 * a kind share one compiled program (customProgramCacheKey), so the cost is a few uniforms.
 */
export function applyPatches(root, rules) {
  const used = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const out = list.map((m) => {
      const rule = rules.find((r) => r.match.test(m.name));
      if (!rule) return used.add(m), m;
      const mm = rule.kind === "cells" ? toIridescent(m) : m.clone();
      o.updateMatrix();
      patch(mm, rule.kind, o.matrix.clone());
      used.add(mm);
      return mm;
    });
    o.material = Array.isArray(o.material) ? out : out[0];
  });
  return [...used];
}
