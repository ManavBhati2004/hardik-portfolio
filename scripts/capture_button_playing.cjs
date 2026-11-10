const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.callbacks = new Map();
  }
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

async function capture() {
  const outputPath = 'C:\\Users\\Owner\\.gemini\\antigravity\\brain\\e17ac083-d184-439b-b20c-e9b658e2ac21\\liquid_button_playing.png';
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const chromeProcess = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=' + path.join(__dirname, 'chrome_tmp_profile_btn'),
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
    await sleep(3500);

    // Click the liquid audio button to toggle MUSIC ON
    await client.send('Runtime.evaluate', {
      expression: `document.querySelector('.liquid-audio-btn').click();`,
    });

    // Wait 1.0 second for the smooth liquid surge and inversion animation
    await sleep(1000);

    const result = await client.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      clip: {
        x: 1650,
        y: 950,
        width: 250,
        height: 120,
        scale: 1,
      }
    });

    const buffer = Buffer.from(result.data, 'base64');
    fs.writeFileSync(outputPath, buffer);
    console.log('Saved close-up:', outputPath);
    client.close();
  } finally {
    chromeProcess.kill('SIGKILL');
  }
}

capture().catch(console.error);
