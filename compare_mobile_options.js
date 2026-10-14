const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9225;

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

(async () => {
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--no-sandbox',
    'about:blank'
  ]);
  await wait(1200);

  try {
    const list = await getJson(`http://127.0.0.1:${PORT}/json`);
    const page = list.find(t => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise(r => ws.onopen = r);
    let id = 1;
    function send(method, params = {}) {
      return new Promise((res, rej) => {
        const myId = id++;
        function onMsg(e) {
          const m = JSON.parse(e.data);
          if (m.id === myId) {
            ws.removeEventListener('message', onMsg);
            if (m.error) rej(m.error); else res(m.result);
          }
        }
        ws.addEventListener('message', onMsg);
        ws.send(JSON.stringify({ id: myId, method, params }));
      });
    }

    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await send('Page.navigate', { url: 'http://localhost:3000/' });
    await wait(1500);

    const outDir = path.join(__dirname, 'options_test');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    // Option 1: object-fit: cover
    await send('Runtime.evaluate', {
      expression: `
        const v = document.getElementById('hero-video');
        v.style.objectFit = 'cover';
        v.style.objectPosition = 'center center';
      `
    });
    await wait(400);
    let shot1 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, 'option_1_cover.png'), Buffer.from(shot1.data, 'base64'));

    // Option 2: object-fit: contain (raw)
    await send('Runtime.evaluate', {
      expression: `
        const v = document.getElementById('hero-video');
        v.style.objectFit = 'contain';
        v.style.objectPosition = 'center center';
      `
    });
    await wait(400);
    let shot2 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, 'option_2_contain_raw.png'), Buffer.from(shot2.data, 'base64'));

    // Option 3: contain with styled dark ambient background, seamless gradient blend
    await send('Runtime.evaluate', {
      expression: `
        const v = document.getElementById('hero-video');
        v.style.objectFit = 'contain';
        v.style.objectPosition = 'center center';
        const stage = document.getElementById('video-stage');
        stage.style.background = 'radial-gradient(ellipse at center, #151a24 0%, #0c0f14 50%, #080A0C 100%)';
        const overlay = document.querySelector('.cinematic-gradient-overlay');
        if (overlay) {
          overlay.style.background = 'linear-gradient(180deg, rgba(8,10,12,0.85) 0%, rgba(8,10,12,0.2) 25%, rgba(8,10,12,0.2) 75%, rgba(8,10,12,0.95) 100%)';
        }
        const card = document.getElementById('hero-center-card');
        if (card) {
          card.style.transform = 'translateY(-20px)';
        }
      `
    });
    await wait(400);
    let shot3 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, 'option_3_contain_styled.png'), Buffer.from(shot3.data, 'base64'));

    console.log('Options captured in options_test/');
    ws.close();
  } finally {
    chrome.kill();
  }
})();
