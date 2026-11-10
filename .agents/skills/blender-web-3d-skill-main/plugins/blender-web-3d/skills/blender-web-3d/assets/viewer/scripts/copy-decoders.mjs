// Copies three's Draco + Basis (KTX2) decoders into public/ so loaders can fetch them
// same-origin. Meshopt needs no files — its decoder is an ES module import.
import { cpSync, existsSync } from "node:fs";
const libs = "node_modules/three/examples/jsm/libs";
for (const [from, to] of [[`${libs}/draco/gltf`, "public/draco"], [`${libs}/basis`, "public/basis"]]) {
  if (existsSync(from)) cpSync(from, to, { recursive: true });
}
console.log("decoders copied to public/draco and public/basis");
