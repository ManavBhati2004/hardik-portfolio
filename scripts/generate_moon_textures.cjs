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
    '--user-data-dir=' + path.join(__dirname, 'chrome_tmp_tex'),
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

    console.log('Generating equirectangular diffuse & bump textures from reference image...');

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

          // Moon center and radius measured from reference
          const cx = 307.0;
          const cy = 231.0;
          const R = 188.5;

          // Bilinear sampler for reference image
          function sampleRef(px, py) {
            if (px < 0 || px >= sW - 1 || py < 0 || py >= sH - 1) return [0, 0, 0];
            const x0 = Math.floor(px);
            const y0 = Math.floor(py);
            const fx = px - x0;
            const fy = py - y0;

            const idx00 = (y0 * sW + x0) * 4;
            const idx10 = (y0 * sW + x0 + 1) * 4;
            const idx01 = ((y0 + 1) * sW + x0) * 4;
            const idx11 = ((y0 + 1) * sW + x0 + 1) * 4;

            const r = (1 - fx) * (1 - fy) * sPix[idx00] + fx * (1 - fy) * sPix[idx10] + (1 - fx) * fy * sPix[idx01] + fx * fy * sPix[idx11];
            const g = (1 - fx) * (1 - fy) * sPix[idx00+1] + fx * (1 - fy) * sPix[idx10+1] + (1 - fx) * fy * sPix[idx01+1] + fx * fy * sPix[idx11+1];
            const b = (1 - fx) * (1 - fy) * sPix[idx00+2] + fx * (1 - fy) * sPix[idx10+2] + (1 - fx) * fy * sPix[idx01+2] + fx * fy * sPix[idx11+2];
            return [r, g, b];
          }

          // Output dimensions: 2048 x 1024 2:1 equirectangular
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

          // Precompute noise for far-side crater detail blend
          function hash(x, y) {
            let n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
            return n - Math.floor(n);
          }
          function noise(x, y) {
            const i = Math.floor(x), j = Math.floor(y);
            const fX = x - i, fY = y - j;
            const u = fX * fX * (3.0 - 2.0 * fX);
            const v = fY * fY * (3.0 - 2.0 * fY);
            return (1.0 - u) * (1.0 - v) * hash(i, j) +
                   u * (1.0 - v) * hash(i + 1, j) +
                   (1.0 - u) * v * hash(i, j + 1) +
                   u * v * hash(i + 1, j + 1);
          }
          function fbm(x, y) {
            let val = 0, amp = 0.5, freq = 1;
            for (let k = 0; k < 6; k++) {
              val += amp * noise(x * freq, y * freq);
              freq *= 2.0;
              amp *= 0.5;
            }
            return val;
          }

          for (let y = 0; y < outH; y++) {
            const v = y / (outH - 1); // 0 at North pole, 1 at South pole
            const lat = (0.5 - v) * Math.PI; // +pi/2 at top, -pi/2 at bottom
            const cosLat = Math.cos(lat);
            const sinLat = Math.sin(lat);

            for (let x = 0; x < outW; x++) {
              const u = x / (outW - 1);
              // Center u = 0.5 corresponds to center of near side (facing camera)
              const lon = (u - 0.5) * 2.0 * Math.PI;

              const X = cosLat * Math.sin(lon);
              const Y = sinLat;
              const Z = cosLat * Math.cos(lon);

              let rgb = [0, 0, 0];
              let bumpVal = 128;

              // Front hemisphere (Z > -0.15 with smooth blend at horizon)
              const frontWeight = Math.min(Math.max((Z + 0.15) / 0.30, 0.0), 1.0);

              if (frontWeight > 0.0) {
                // Orthographic unproject from reference image
                const px = cx + X * R;
                const py = cy - Y * R;
                const samp = sampleRef(px, py);

                // Near the limb (edge of moon in photo), foreshortening occurs.
                // Enhance crater contrast and normalize lighting
                const lum = 0.299 * samp[0] + 0.587 * samp[1] + 0.114 * samp[2];
                rgb = [samp[0], samp[1], samp[2]];
                bumpVal = lum;
              }

              if (frontWeight < 1.0) {
                // Seamlessly blend with back hemisphere crater texture
                // Symmetric coordinate to map lunar highlands
                const symX = -X;
                const symPx = cx + symX * R;
                const symPy = cy - Y * R;
                const symSamp = sampleRef(symPx, symPy);
                const nDetail = fbm(x * 0.04, y * 0.04) * 40 - 20;

                const backR = Math.min(255, Math.max(0, symSamp[0] * 0.95 + nDetail));
                const backG = Math.min(255, Math.max(0, symSamp[1] * 0.95 + nDetail));
                const backB = Math.min(255, Math.max(0, symSamp[2] * 0.95 + nDetail));
                const backLum = 0.299 * backR + 0.587 * backG + 0.114 * backB;

                rgb[0] = rgb[0] * frontWeight + backR * (1.0 - frontWeight);
                rgb[1] = rgb[1] * frontWeight + backG * (1.0 - frontWeight);
                rgb[2] = rgb[2] * frontWeight + backB * (1.0 - frontWeight);
                bumpVal = bumpVal * frontWeight + backLum * (1.0 - frontWeight);
              }

              const outIdx = (y * outW + x) * 4;
              dPix[outIdx] = Math.round(rgb[0]);
              dPix[outIdx+1] = Math.round(rgb[1]);
              dPix[outIdx+2] = Math.round(rgb[2]);
              dPix[outIdx+3] = 255;

              bPix[outIdx] = Math.round(bumpVal);
              bPix[outIdx+1] = Math.round(bumpVal);
              bPix[outIdx+2] = Math.round(bumpVal);
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

    const outDiffPath = 'd:\\Antigravity\\hardik-gehlot-portfolio\\public\\textures\\moon_diffuse_ref.png';
    const outBumpPath = 'd:\\Antigravity\\hardik-gehlot-portfolio\\public\\textures\\moon_bump_ref.png';

    fs.writeFileSync(outDiffPath, Buffer.from(diffBase64, 'base64'));
    fs.writeFileSync(outBumpPath, Buffer.from(bumpBase64, 'base64'));

    console.log('Saved diffuse texture:', outDiffPath, `(${fs.statSync(outDiffPath).size} bytes)`);
    console.log('Saved bump texture:', outBumpPath, `(${fs.statSync(outBumpPath).size} bytes)`);

    client.close();
  } finally {
    chromeProcess.kill('SIGKILL');
  }
}

run().catch(console.error);
