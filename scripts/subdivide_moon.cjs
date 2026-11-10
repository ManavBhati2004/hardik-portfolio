const fs = require('fs');

const content = fs.readFileSync('d:/Antigravity/hardik-gehlot-portfolio/public/models/moon_3d/Moon 2K.obj', 'utf-8');
const lines = content.split('\n');

const origVerts = [];
const origUVs = [];
const origFaces = [];

for (const line of lines) {
  const parts = line.trim().split(/\s+/);
  if (parts[0] === 'v') origVerts.push(parts.slice(1).map(Number));
  else if (parts[0] === 'vt') origUVs.push(parts.slice(1).map(Number));
  else if (parts[0] === 'f') {
    origFaces.push(parts.slice(1).map(p => {
      const idxs = p.split('/').map(Number);
      return { v: idxs[0] - 1, vt: idxs[1] - 1 };
    }));
  }
}

console.log('Original model:', {
  verts: origVerts.length,
  uvs: origUVs.length,
  faces: origFaces.length,
});

const R = 1.7459; // Moon sphere radius

function subdivide(verts, uvs, faces) {
  const newVerts = [...verts];
  const newUVs = [...uvs];
  const newFaces = [];
  const edgeMap = new Map();

  function getMidpoint(idx1, idx2) {
    const key = idx1.v < idx2.v ? `${idx1.v}_${idx2.v}` : `${idx2.v}_${idx1.v}`;
    if (edgeMap.has(key)) return edgeMap.get(key);

    const v1 = verts[idx1.v];
    const v2 = verts[idx2.v];
    let mx = (v1[0] + v2[0]) * 0.5;
    let my = (v1[1] + v2[1]) * 0.5;
    let mz = (v1[2] + v2[2]) * 0.5;
    const len = Math.sqrt(mx*mx + my*my + mz*mz);
    mx = (mx / len) * R;
    my = (my / len) * R;
    mz = (mz / len) * R;

    const uv1 = uvs[idx1.vt];
    const uv2 = uvs[idx2.vt];
    const mu = (uv1[0] + uv2[0]) * 0.5;
    const mv = (uv1[1] + uv2[1]) * 0.5;

    const vIdx = newVerts.length;
    newVerts.push([mx, my, mz]);
    const vtIdx = newUVs.length;
    newUVs.push([mu, mv]);

    const result = { v: vIdx, vt: vtIdx };
    edgeMap.set(key, result);
    return result;
  }

  for (const f of faces) {
    const p0 = f[0], p1 = f[1], p2 = f[2], p3 = f[3];
    const m01 = getMidpoint(p0, p1);
    const m12 = getMidpoint(p1, p2);
    const m23 = getMidpoint(p2, p3);
    const m30 = getMidpoint(p3, p0);

    const v0 = verts[p0.v], v1 = verts[p1.v], v2 = verts[p2.v], v3 = verts[p3.v];
    let cx = (v0[0] + v1[0] + v2[0] + v3[0]) * 0.25;
    let cy = (v0[1] + v1[1] + v2[1] + v3[1]) * 0.25;
    let cz = (v0[2] + v1[2] + v2[2] + v3[2]) * 0.25;
    const cLen = Math.sqrt(cx*cx + cy*cy + cz*cz);
    cx = (cx / cLen) * R;
    cy = (cy / cLen) * R;
    cz = (cz / cLen) * R;

    const uv0 = uvs[p0.vt], uv1 = uvs[p1.vt], uv2 = uvs[p2.vt], uv3 = uvs[p3.vt];
    const cu = (uv0[0] + uv1[0] + uv2[0] + uv3[0]) * 0.25;
    const cv = (uv0[1] + uv1[1] + uv2[1] + uv3[1]) * 0.25;

    const cIdx = { v: newVerts.length, vt: newUVs.length };
    newVerts.push([cx, cy, cz]);
    newUVs.push([cu, cv]);

    newFaces.push([p0, m01, cIdx, m30]);
    newFaces.push([m01, p1, m12, cIdx]);
    newFaces.push([cIdx, m12, p2, m23]);
    newFaces.push([m30, cIdx, m23, p3]);
  }

  return { verts: newVerts, uvs: newUVs, faces: newFaces };
}

// 2 iterations of subdivision for pristine cinematic smoothness
let current = { verts: origVerts, uvs: origUVs, faces: origFaces };
current = subdivide(current.verts, current.uvs, current.faces);
current = subdivide(current.verts, current.uvs, current.faces);

console.log('Final Cinematic 3D Moon model:', {
  verts: current.verts.length,
  uvs: current.uvs.length,
  faces: current.faces.length,
});

// Output OBJ with smooth vertex normals
let out = '# Subdivided Cinematic Photorealistic Moon 3D Model\n';
for (const [x, y, z] of current.verts) {
  out += `v ${x.toFixed(6)} ${y.toFixed(6)} ${z.toFixed(6)}\n`;
}
for (const [u, v] of current.uvs) {
  out += `vt ${u.toFixed(6)} ${v.toFixed(6)}\n`;
}
for (const [x, y, z] of current.verts) {
  const len = Math.sqrt(x*x + y*y + z*z);
  out += `vn ${(x/len).toFixed(6)} ${(y/len).toFixed(6)} ${(z/len).toFixed(6)}\n`;
}
for (const f of current.faces) {
  out += `f ${f[0].v+1}/${f[0].vt+1}/${f[0].v+1} ${f[1].v+1}/${f[1].vt+1}/${f[1].v+1} ${f[2].v+1}/${f[2].vt+1}/${f[2].v+1} ${f[3].v+1}/${f[3].vt+1}/${f[3].v+1}\n`;
}

fs.writeFileSync('d:/Antigravity/hardik-gehlot-portfolio/public/models/moon_3d/Moon_HighPoly.obj', out);
console.log('Saved Moon_HighPoly.obj successfully!');
