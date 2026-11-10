const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

class CDPClient {
  constructor(wsUrl) { this.ws = new WebSocket(wsUrl); this.id = 1; this.callbacks = new Map(); }
  async connect() {
    return new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.callbacks.has(msg.id)) {
          const { resolve, reject } = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      };
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.ws.close(); }
}

async function run() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const chromeProcess = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=' + path.join(__dirname, 'chrome_tmp_perfect'),
  ]);

  try {
    let targets = null;
    for (let i = 0; i < 30; i++) {
      await sleep(250);
      try {
        targets = await fetchJson('http://127.0.0.1:9222/json');
        if (targets && targets.length > 0) break;
      } catch (e) {}
    }

    const pageTarget = targets.find((t) => t.type === 'page') || targets[0];
    const client = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await client.connect();

    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Page.navigate', { url: 'http://127.0.0.1:5173/' });
    await sleep(2000);

    console.log('Generating flawless 2048x1024 equirectangular texture from reference...');

    const result = await client.send('Runtime.evaluate', {
      awaitPromise: true,
      expression: `
        (async () => {
          const img = new Image();
          img.src = '/textures/moon_reference.jpg';
          await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });

          const srcCanvas = document.createElement('canvas');
          srcCanvas.width = img.naturalWidth;
          srcCanvas.height = img.naturalHeight;
          const sCtx = srcCanvas.getContext('2d');
          sCtx.drawImage(img, 0, 0);
          const sData = sCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
          const sPix = sData.data;
          const sW = srcCanvas.width;
          const sH = srcCanvas.height;

          const cx = 307.0;
          const cy = 231.0;
          const R = 188.0;

          // Safe clamped bilinear sampler inside moon circle
          function sampleMoon(px, py) {
            const dx = px - cx;
            const dy = py - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            // Clamp to inside circle (at most 0.985 * R to never sample black border)
            let sx = px, sy = py;
            if (dist > R * 0.982) {
              const scale = (R * 0.982) / dist;
              sx = cx + dx * scale;
              sy = cy + dy * scale;
            }

            const x0 = Math.max(0, Math.min(sW - 2, Math.floor(sx)));
            const y0 = Math.max(0, Math.min(sH - 2, Math.floor(sy)));
            const fx = sx - x0;
            const fy = sy - y0;

            const idx00 = (y0 * sW + x0) * 4;
            const idx10 = (y0 * sW + x0 + 1) * 4;
            const idx01 = ((y0 + 1) * sW + x0) * 4;
            const idx11 = ((y0 + 1) * sW + x0 + 1) * 4;

            const r = (1 - fx) * (1 - fy) * sPix[idx00] + fx * (1 - fy) * sPix[idx10] + (1 - fx) * fy * sPix[idx01] + fx * fy * sPix[idx11];
            const g = (1 - fx) * (1 - fy) * sPix[idx00+1] + fx * (1 - fy) * sPix[idx10+1] + (1 - fx) * fy * sPix[idx01+1] + fx * fy * sPix[idx11+1];
            const b = (1 - fx) * (1 - fy) * sPix[idx00+2] + fx * (1 - fy) * sPix[idx10+2] + (1 - fx) * fy * sPix[idx01+2] + fx * fy * sPix[idx11+2];
            return [r, g, b];
          }

          const outW = 2048;
          const outH = 1024;
          const diffCanvas = document.createElement('canvas');
          diffCanvas.width = outW;
          diffCanvas.height = outH;
          const dCtx = diffCanvas.getContext('2d');
          const dImgData = dCtx.createImageData(outW, outH);
          const dPix = dImgData.data;

          const bumpCanvas = document.createElement('canvas');
          bumpCanvas.width = outW;
          bumpCanvas.height = outH;
          const bCtx = bumpCanvas.getContext('2d');
          const bImgData = bCtx.createImageData(outW, outH);
          const bPix = bImgData.data;

          // Procedural lunar crater fbm generator for seamless back hemisphere
          function hash2(x, y) {
            const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
            return s - Math.floor(s);
          }
          function noise2(x, y) {
            const ix = Math.floor(x), iy = Math.floor(y);
            const fx = x - ix, fy = y - iy;
            const ux = fx * fx * (3.0 - 2.0 * fx);
            const uy = fy * fy * (3.0 - 2.0 * fy);
            return (1.0 - ux) * (1.0 - uy) * hash2(ix, iy) +
                   ux * (1.0 - uy) * hash2(ix + 1, iy) +
                   (1.0 - ux) * uy * hash2(ix, iy + 1) +
                   ux * uy * hash2(ix + 1, iy + 1);
          }
          function craterNoise(x, y) {
            let n = 0, a = 0.5, f = 1.0;
            for (let i = 0; i < 7; i++) {
              n += a * noise2(x * f, y * f);
              f *= 2.05;
              a *= 0.48;
            }
            return n;
          }

          for (let y = 0; y < outH; y++) {
            const v = y / (outH - 1);
            const lat = (0.5 - v) * Math.PI;
            const cosLat = Math.cos(lat);
            const sinLat = Math.sin(lat);

            for (let x = 0; x < outW; x++) {
              const u = x / (outW - 1);
              // Center u = 0.5 is longitude 0 (near side, facing Earth)
              const lon = (u - 0.5) * 2.0 * Math.PI;

              const X = cosLat * Math.sin(lon);
              const Y = sinLat;
              const Z = cosLat * Math.cos(lon);

              let rgb = [0, 0, 0];
              let bump = 128;

              // Hemisphere blend weight: 1.0 at front (lon = 0), fades smoothly to 0 at back (lon = +/- pi)
              // Z = cosLat * cos(lon) >= 0 is front hemisphere
              // We use cos(lon) directly: when cos(lon) > 0, it is on the Earth-facing half
              const cosLon = Math.cos(lon);
              const frontFactor = Math.min(Math.max((cosLon + 0.15) / 0.45, 0.0), 1.0);

              // Sample near side (reference image)
              const px = cx + X * R;
              const py = cy - Y * R;
              const frontSamp = sampleMoon(px, py);
              const frontLum = 0.299 * frontSamp[0] + 0.587 * frontSamp[1] + 0.114 * frontSamp[2];

              // Sample back side (seamless reflection + crater noise)
              const symX = -X;
              const symPx = cx + symX * R;
              const symSamp = sampleMoon(symPx, py);
              const cNoise = (craterNoise(u * 18.0, v * 18.0) - 0.5) * 35;
              const backR = Math.max(0, Math.min(255, symSamp[0] * 0.92 + cNoise));
              const backG = Math.max(0, Math.min(255, symSamp[1] * 0.92 + cNoise));
              const backB = Math.max(0, Math.min(255, symSamp[2] * 0.92 + cNoise));
              const backLum = 0.299 * backR + 0.587 * backG + 0.114 * backB;

              rgb[0] = frontSamp[0] * frontFactor + backR * (1.0 - frontFactor);
              rgb[1] = frontSamp[1] * frontFactor + backG * (1.0 - frontFactor);
              rgb[2] = frontSamp[2] * frontFactor + backB * (1.0 - frontFactor);
              bump = frontLum * frontFactor + backLum * (1.0 - frontFactor);

              const outIdx = (y * outW + x) * 4;
              dPix[outIdx] = Math.round(rgb[0]);
              dPix[outIdx+1] = Math.round(rgb[1]);
              dPix[outIdx+2] = Math.round(rgb[2]);
              dPix[outIdx+3] = 255;

              bPix[outIdx] = Math.round(bump);
              bPix[outIdx+1] = Math.round(bump);
              bPix[outIdx+2] = Math.round(bump);
              bPix[outIdx+3] = 255;
            }
          }

          dCtx.putImageData(dImgData, 0, 0);
          bCtx.putImageData(bImgData, 0, 0);

          return {
            diffuseDataUrl: diffCanvas.toDataURL('image/png'),
            bumpDataUrl: bumpCanvas.toDataURL('image/png')
          };
        })()
      `,
      returnByValue: true,
    });

    const diffBase64 = result.result.value.diffuseDataUrl.replace(/^data:image\/png;base64,/, '');
    const bumpBase64 = result.result.value.bumpDataUrl.replace(/^data:image\/png;base64,/, '');

    const outDiffPath = 'd:\\Antigravity\\hardik-gehlot-portfolio\\public\\textures\\moon_reference_diffuse.png';
    const outBumpPath = 'd:\\Antigravity\\hardik-gehlot-portfolio\\public\\textures\\moon_reference_bump.png';

    fs.writeFileSync(outDiffPath, Buffer.from(diffBase64, 'base64'));
    fs.writeFileSync(outBumpPath, Buffer.from(bumpBase64, 'base64'));

    console.log('Successfully saved perfect moon textures:');
    console.log(' - Diffuse:', outDiffPath, `(${fs.statSync(outDiffPath).size} bytes)`);
    console.log(' - Bump:', outBumpPath, `(${fs.statSync(outBumpPath).size} bytes)`);

    client.close();
  } finally {
    chromeProcess.kill('SIGKILL');
  }
}

run().catch(console.error);
