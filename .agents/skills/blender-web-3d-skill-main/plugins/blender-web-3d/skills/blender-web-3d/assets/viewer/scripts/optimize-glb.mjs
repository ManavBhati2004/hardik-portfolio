// Raw Blender GLB -> runtime GLB. One reproducible, measured step.
//
//   node scripts/optimize-glb.mjs in-raw.glb public/models/out-v001.glb [--draco] [--simplify 0.75] [--tex 2048] [--palette] [--flatten]
//
// Default codec is meshopt (EXT_meshopt_compression + KHR_mesh_quantization): decodes 5-10x
// faster than Draco on the main thread, compresses animation too, and gzip/brotli on the CDN
// squeezes it further. Use --draco only when raw download size beats decode time (huge static scans).
// Textures -> WebP here (sharp). For GPU-compressed KTX2 (ETC1S/UASTC — far less VRAM),
// install KTX-Software and run `npx @gltf-transform/cli etc1s|uastc` on the output.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  dedup, draco, flatten, instance, join, meshopt, palette, prune, resample,
  simplify, sparse, textureCompress, weld,
} from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import { statSync } from "node:fs";

const [input, output, ...flags] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: optimize-glb.mjs <in.glb> <out.glb> [--draco] [--simplify <ratio>] [--tex <px>] [--palette] [--flatten]");
  process.exit(1);
}
const flag = (name, fallback) => {
  const i = flags.indexOf(name);
  return i < 0 ? fallback : flags[i + 1] ?? true;
};
const useDraco = flags.includes("--draco");
const simplifyRatio = Number(flag("--simplify", 0));
const texSize = Number(flag("--tex", 2048));

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "meshopt.encoder": MeshoptEncoder,
  ...(useDraco ? { "draco3d.encoder": await (await import("draco3d")).createEncoderModule() } : {}),
});

const doc = await io.read(input);
const stats = (d) => {
  const meshes = d.getRoot().listMeshes();
  let prims = 0, verts = 0;
  for (const m of meshes) for (const p of m.listPrimitives()) {
    prims++;
    verts += p.getAttribute("POSITION")?.getCount() ?? 0;
  }
  return { nodes: d.getRoot().listNodes().length, meshes: meshes.length, primitives: prims, vertices: verts };
};
const before = stats(doc);

// Order matters: dedup before instance (identical meshes must share first).
// flatten() is OPT-IN: it re-parents every mesh that is not under a glTF *animation* to the
// root — including meshes under pivots you rotate from JavaScript (rings, rotors, turntables).
// prune() then deletes the emptied pivot, and the part silently stops moving.
const steps = [
  dedup(),                                   // identical accessors / materials / textures
  instance({ min: 3 }),                      // repeated meshes -> EXT_mesh_gpu_instancing (1 draw);
                                             // gltf-transform skips this when the file has animations
  ...(flags.includes("--palette") ? [palette({ min: 4 })] : []), // opt-in: merges materials, loses names
  ...(flags.includes("--flatten") ? [flatten()] : []), // only for models with no JS-driven pivots
  join({ keepNamed: true }),                 // merge compatible static primitives -> fewer draw calls
  weld(),                                    // index + merge verts (required before simplify)
  ...(simplifyRatio ? [simplify({ simplifier: MeshoptSimplifier, ratio: simplifyRatio, error: 0.001 })] : []),
  resample(),                                // drop redundant animation keys
  prune({ keepLeaves: true }),               // keep empty named nodes (pivots, anchors, sockets)
  sparse(),
  textureCompress({ encoder: sharp, targetFormat: "webp", quality: 88, resize: [texSize, texSize] }),
  useDraco
    ? draco({ method: "edgebreaker", quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 })
    : meshopt({ encoder: MeshoptEncoder, level: "medium" }),
];
await doc.transform(...steps);
await io.write(output, doc);

const after = stats(doc);
const kb = (f) => Math.round(statSync(f).size / 1024);
console.log(JSON.stringify({
  input: { file: input, kb: kb(input), ...before },
  output: { file: output, kb: kb(output), codec: useDraco ? "draco" : "meshopt", ...after },
  ratio: +(statSync(input).size / statSync(output).size).toFixed(1),
}, null, 2));
