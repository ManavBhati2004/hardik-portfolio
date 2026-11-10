const fs = require('fs');
const fd = fs.openSync('d:/Antigravity/hardik-gehlot-portfolio/public/models/moon_3d/Moon 2K.obj', 'r');
const content = fs.readFileSync('d:/Antigravity/hardik-gehlot-portfolio/public/models/moon_3d/Moon 2K.obj', 'utf-8');

// Find min/max of UVs in Moon 2K.obj
const uvs = [];
for (const line of content.split('\n')) {
  if (line.startsWith('vt ')) {
    const parts = line.trim().split(/\s+/).slice(1).map(Number);
    uvs.push(parts);
  }
}
let minU = 1, maxU = 0, minV = 1, maxV = 0;
uvs.forEach(([u, v]) => {
  if (u < minU) minU = u;
  if (u > maxU) maxU = u;
  if (v < minV) minV = v;
  if (v > maxV) maxV = v;
});
console.log('UV bounds in OBJ:', { minU, maxU, minV, maxV, count: uvs.length });
