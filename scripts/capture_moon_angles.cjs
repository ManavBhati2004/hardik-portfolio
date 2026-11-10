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

async function captureAngle(rotY, filename) {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const chromeProcess = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=' + path.join(__dirname, 'chrome_tmp_angle_' + filename),
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
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await client.send('Page.navigate', { url: 'http://127.0.0.1:5173/' });
    await sleep(2500);

    // Crop around moon
    const result = await client.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      clip: {
        x: 750,
        y: 50,
        width: 420,
        height: 420,
        scale: 1,
      }
    });

    const buffer = Buffer.from(result.data, 'base64');
    const outPath = path.join('C:\\Users\\Owner\\.gemini\\antigravity\\brain\\e17ac083-d184-439b-b20c-e9b658e2ac21', filename);
    fs.writeFileSync(outPath, buffer);
    console.log('Saved close-up:', outPath);
    client.close();
  } finally {
    chromeProcess.kill('SIGKILL');
  }
}

captureAngle(Math.PI, 'moon_closeup.png').catch(console.error);
