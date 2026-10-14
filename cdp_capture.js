const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9222;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.msgId = 1;
    this.callbacks = new Map();
  }

  init() {
    return new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.callbacks.has(msg.id)) {
          const { resolve, reject } = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) reject(msg.error);
          else resolve(msg.result);
        }
      };
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.msgId++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.ws.close();
  }
}

async function captureAll(scenarios, outputPrefix = 'shot') {
  // Launch Chrome headless with remote debugging
  const chromeProcess = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-sandbox',
    'about:blank'
  ]);

  await wait(1500);

  try {
    const list = await getJson(`http://127.0.0.1:${PORT}/json`);
    const pageTarget = list.find(t => t.type === 'page');
    if (!pageTarget) throw new Error('No page target found');

    const client = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await client.init();

    await client.send('Page.enable');
    await client.send('DOM.enable');
    await client.send('Page.navigate', { url: 'http://localhost:3000/' });
    await wait(1500);

    const outDir = path.join(__dirname, 'cdp_screenshots');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    for (const sc of scenarios) {
      console.log(`Setting viewport: ${sc.width}x${sc.height}, scrollY: ${sc.scrollY || 0}, time: ${sc.time || 0}...`);
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: sc.width,
        height: sc.height,
        deviceScaleFactor: 1,
        mobile: !!sc.mobile
      });

      if (sc.scrollY !== undefined) {
        await client.send('Runtime.evaluate', {
          expression: `window.scrollTo(0, ${sc.scrollY});`
        });
      }

      if (sc.time !== undefined) {
        await client.send('Runtime.evaluate', {
          expression: `new Promise(resolve => {
            const v = document.getElementById('hero-video');
            if (!v) return resolve('no video');
            if (Math.abs(v.currentTime - ${sc.time}) < 0.05) return resolve('already at time');
            v.addEventListener('seeked', () => resolve('seeked'), { once: true });
            v.currentTime = ${sc.time};
            setTimeout(() => resolve('timeout: ' + v.currentTime + ' ready:' + v.readyState), 2000);
          })`,
          awaitPromise: true
        });
      }

      await wait(500);

      const shot = await client.send('Page.captureScreenshot', { format: 'png' });
      const filename = path.join(outDir, `${sc.name}.png`);
      fs.writeFileSync(filename, Buffer.from(shot.data, 'base64'));
      console.log(`Saved screenshot: ${filename}`);
    }

    client.close();
  } finally {
    chromeProcess.kill();
  }
}

// If run directly:
if (require.main === module) {
  const testScenarios = [
    { name: 'desktop_1920x1080_t0', width: 1920, height: 1080, scrollY: 0, time: 0 },
    { name: 'laptop_1440x900_t0', width: 1440, height: 900, scrollY: 0, time: 0 },
    { name: 'tablet_768x1024_t0', width: 768, height: 1024, scrollY: 0, time: 0 },
    { name: 'mobile_390x844_t0', width: 390, height: 844, scrollY: 0, time: 0, mobile: true },
    { name: 'mobile_390x844_scroll_mid', width: 390, height: 844, scrollY: 800, time: 5.0, mobile: true }
  ];
  captureAll(testScenarios).then(() => console.log('All captured!')).catch(console.error);
}

module.exports = { captureAll };
