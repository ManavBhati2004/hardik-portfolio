// Runtime static batching — the second draw-call lever after Blender-side consolidation.
// Merges static meshes that share (animation root, material, attribute layout, spatial cell)
// into one geometry. Spatial cells keep frustum culling useful on large models.
//
// Never merges: anything under an animated/JS-driven node (it would freeze at rest pose while
// its parent moves), skinned/morph/instanced meshes, transparent or transmissive materials
// (they need per-object depth sorting).
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Meshopt/KHR_mesh_quantization geometry stores positions as normalized Int16/Int8 (with the
// dequantization folded into the node matrix). applyMatrix4() on those arrays silently
// truncates to integers — dequantize to Float32 first.
function toFloat(g) {
  for (const [name, a] of Object.entries(g.attributes)) {
    if (a.array instanceof Float32Array && !a.isInterleavedBufferAttribute) continue;
    const out = new Float32Array(a.count * a.itemSize);
    const get = [a.getX, a.getY, a.getZ, a.getW]; // these denormalize; getComponent does not
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = get[k].call(a, i);
    g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
  return g;
}

export function staticBatch(model, { animatedNodes, cellSize }) {
  model.updateMatrixWorld(true);
  const animated = new Set(animatedNodes);
  // nearest moving ancestor (or the mesh itself) — merged geometry must stay under it
  const rootOf = (o) => {
    for (let p = o; p && p !== model; p = p.parent) if (animated.has(p)) return p;
    return model;
  };
  const groups = new Map();
  const tmp = new THREE.Matrix4();
  model.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o.morphTargetInfluences) return;
    const m = o.material;
    if (Array.isArray(m) || m.transparent || m.transmission > 0) return;
    const root = rootOf(o);
    if (root === o) return;
    const g = o.geometry;
    const sig = Object.keys(g.attributes).sort().join(",") + (g.index ? ":i" : ":n");
    const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).divideScalar(cellSize).floor();
    const key = `${root.uuid}|${m.uuid}|${sig}|${c.x},${c.y},${c.z}|${o.castShadow}${o.receiveShadow}`;
    if (!groups.has(key)) groups.set(key, { root, material: m, meshes: [] });
    groups.get(key).meshes.push(o);
  });

  let before = 0, after = 0;
  for (const { root, material, meshes } of groups.values()) {
    before += meshes.length;
    if (meshes.length < 2) { after += meshes.length; continue; }
    const inv = tmp.copy(root.matrixWorld).invert();
    const geos = meshes.map((o) => toFloat(o.geometry.clone()).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)));
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) { after += meshes.length; continue; }
    const batch = new THREE.Mesh(merged, material);
    batch.name = `Batch_${material.name}`;
    batch.castShadow = meshes[0].castShadow;
    batch.receiveShadow = meshes[0].receiveShadow;
    root.add(batch);
    for (const o of meshes) { o.removeFromParent(); o.geometry.dispose(); }
    after += 1;
  }
  return { before, after };
}
