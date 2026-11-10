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
    '--user-data-dir=' + path.join(__dirname, 'chrome_tmp_redesign'),
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

    console.log('Redesigning Moon diffuse & bump textures using reference image...');

    const result = await client.send('Runtime.evaluate', {
      awaitPromise: true,
      expression: `
        (async () => {
          // 1. Load original 3D cubemap diffuse & bump
          const imgDiffuse = new Image();
          imgDiffuse.src = '/models/moon_3d/Textures/Diffuse_2K.png';
          const imgBump = new Image();
          imgBump.src = '/models/moon_3d/Textures/Bump_2K.png';
          // 2. Load user reference image
          const imgRef = new Image();
          imgRef.src = '/textures/moon_reference.jpg';

          await Promise.all([
            new Promise((res, rej) => { imgDiffuse.onload = res; imgDiffuse.onerror = rej; }),
            new Promise((res, rej) => { imgBump.onload = res; imgBump.onerror = rej; }),
            new Promise((res, rej) => { imgRef.onload = res; imgRef.onerror = rej; }),
          ]);

          const W = imgDiffuse.naturalWidth;
          const H = imgDiffuse.naturalHeight;

          // Canvases for processing
          const dCanvas = document.createElement('canvas');
          dCanvas.width = W; dCanvas.height = H;
          const dCtx = dCanvas.getContext('2d');
          dCtx.drawImage(imgDiffuse, 0, 0);
          const dData = dCtx.getImageData(0, 0, W, H);
          const dPix = dData.data;

          const bCanvas = document.createElement('canvas');
          bCanvas.width = W; bCanvas.height = H;
          const bCtx = bCanvas.getContext('2d');
          bCtx.drawImage(imgBump, 0, 0);
          const bData = bCtx.getImageData(0, 0, W, H);
          const bPix = bData.data;

          // Reference image canvas
          const rCanvas = document.createElement('canvas');
          rCanvas.width = imgRef.naturalWidth;
          rCanvas.height = imgRef.naturalHeight;
          const rCtx = rCanvas.getContext('2d');
          rCtx.drawImage(imgRef, 0, 0);
          const rData = rCtx.getImageData(0, 0, rCanvas.width, rCanvas.height);
          const rPix = rData.data;
          const rW = rCanvas.width;
          const rH = rCanvas.height;

          // Reference moon disc center and radius
          const refCx = 307.0;
          const refCy = 231.0;
          const refR = 188.0;

          // Sample reference image normalized luminance [0, 1]
          function getRefLum(normX, normY) {
            const px = refCx + normX * refR;
            const py = refCy - normY * refR;
            const dist = Math.sqrt(normX * normX + normY * normY);
            if (dist > 0.985) return null;

            const x0 = Math.max(0, Math.min(rW - 2, Math.floor(px)));
            const y0 = Math.max(0, Math.min(rH - 2, Math.floor(py)));
            const fx = px - x0;
            const fy = py - y0;

            const i00 = (y0 * rW + x0) * 4;
            const i10 = (y0 * rW + x0 + 1) * 4;
            const i01 = ((y0 + 1) * rW + x0) * 4;
            const i11 = ((y0 + 1) * rW + x0 + 1) * 4;

            const r = (1-fx)*(1-fy)*rPix[i00] + fx*(1-fy)*rPix[i10] + (1-fx)*fy*rPix[i01] + fx*fy*rPix[i11];
            const g = (1-fx)*(1-fy)*rPix[i00+1] + fx*(1-fy)*rPix[i10+1] + (1-fx)*(fy)*rPix[i01+1] + fx*fy*rPix[i11+1];
            const b = (1-fx)*(1-fy)*rPix[i00+2] + fx*(1-fy)*rPix[i10+2] + (1-fx)*(fy)*rPix[i01+2] + fx*fy*rPix[i11+2];
            return (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
          }

          // Center face in cubemap: column 1 (x ~ 518 to 1036), row 1 (y ~ 520 to 1040)
          const faceW = W / 4.0;
          const faceH = H / 3.0;
          const cFaceLeft = faceW;
          const cFaceTop = faceH;

          // Enhance contrast curve matching reference image (deepens maria, pops crater rims)
          function contrastCurve(x) {
            // S-curve contrast with gamma adjustment
            let v = x / 255.0;
            // Gamma 1.15 to deepen basalt maria
            v = Math.pow(v, 1.15);
            // Sigmoidal contrast
            v = 1.0 / (1.0 + Math.exp(-9.0 * (v - 0.46)));
            return Math.max(0, Math.min(255, Math.round(v * 255.0)));
          }

          for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
              const idx = (y * W + x) * 4;

              // Check if pixel is within active cross faces (alpha > 50)
              if (dPix[idx + 3] < 50) continue;

              const origR = dPix[idx];
              const origG = dPix[idx + 1];
              const origB = dPix[idx + 2];
              const origLum = 0.299 * origR + 0.587 * origG + 0.114 * origB;

              // Apply contrast enhancement
              let newLum = contrastCurve(origLum);

              // If inside center face (the near-side face seen from Earth)
              if (x >= cFaceLeft && x < cFaceLeft + faceW && y >= cFaceTop && y < cFaceTop + faceH) {
                // Map cubemap plane coords [-1, 1] to sphere normalized coords
                const uFace = ((x - cFaceLeft) / faceW) * 2.0 - 1.0;
                const vFace = -(((y - cFaceTop) / faceH) * 2.0 - 1.0);

                // Sphere projection: X = uFace / sqrt(1 + uFace^2 + vFace^2), Y = vFace / sqrt(...)
                const len = Math.sqrt(1.0 + uFace * uFace + vFace * vFace);
                const normX = uFace / len;
                const normY = vFace / len;

                const refL = getRefLum(normX, normY);
                if (refL !== null) {
                  // Blend reference image crater detail (65% reference + 35% original)
                  const targetL = refL * 255.0;
                  newLum = Math.round(newLum * 0.35 + targetL * 0.65);
                }
              }

              // Color grading matching reference image:
              // Basalt maria (low lum): deep charcoal umber
              // Crater highlands (high lum): crisp luminous silver-white
              const factor = newLum / 255.0;
              const rOut = Math.round(newLum * (0.95 + factor * 0.08));
              const gOut = Math.round(newLum * (0.92 + factor * 0.06));
              const bOut = Math.round(newLum * (0.88 + factor * 0.10));

              dPix[idx] = Math.min(255, rOut);
              dPix[idx + 1] = Math.min(255, gOut);
              dPix[idx + 2] = Math.min(255, bOut);

              // Enhanced Bump Relief Map:
              // Micro-crater relief + high-pass crater rims
              const origBump = bPix[idx];
              const bumpEnhanced = Math.min(255, Math.max(0, Math.round(origBump * 0.55 + newLum * 0.45)));
              bPix[idx] = bumpEnhanced;
              bPix[idx + 1] = bumpEnhanced;
              bPix[idx + 2] = bumpEnhanced;
            }
          }

          dCtx.putImageData(dData, 0, 0);
          bCtx.putImageData(bData, 0, 0);

          return {
            diffuseUrl: dCanvas.toDataURL('image/png'),
            bumpUrl: bCanvas.toDataURL('image/png')
          };
        })()
      `,
      returnByValue: true,
    });

    const diffBase64 = result.result.value.diffuseUrl.replace(/^data:image\/png;base64,/, '');
    const bumpBase64 = result.result.value.bumpUrl.replace(/^data:image\/png;base64,/, '');

    const outDiff = 'd:\\Antigravity\\hardik-gehlot-portfolio\\public\\models\\moon_3d\\Textures\\Diffuse_Redesigned.png';
    const outBump = 'd:\\Antigravity\\hardik-gehlot-portfolio\\public\\models\\moon_3d\\Textures\\Bump_Redesigned.png';

    fs.writeFileSync(outDiff, Buffer.from(diffBase64, 'base64'));
    fs.writeFileSync(outBump, Buffer.from(bumpBase64, 'base64'));

    console.log('Saved redesigned diffuse:', outDiff, `(${fs.statSync(outDiff).size} bytes)`);
    console.log('Saved redesigned bump:', outBump, `(${fs.statSync(outBump).size} bytes)`);

    client.close();
  } finally {
    chromeProcess.kill('SIGKILL');
  }
}

run().catch(console.error);
