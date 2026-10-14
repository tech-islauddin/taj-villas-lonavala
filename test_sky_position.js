const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9227;

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

    const outDir = path.join(__dirname, 'mobile_eval');

    // Test: Perfect mobile positioning
    await send('Runtime.evaluate', {
      expression: `(() => {
        const style = document.createElement('style');
        style.innerHTML = \`
          .hero-video {
            width: 100% !important;
            height: 100% !important;
            object-fit: cover !important;
            object-position: center 35% !important;
          }
          .hero-overlay-content {
            padding: 1.25rem !important;
            justify-content: flex-start !important;
            padding-top: 14vh !important;
          }
          .hero-center-card {
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 auto !important;
          }
          .hero-eyebrow {
            font-size: 0.68rem !important;
            letter-spacing: 0.28em !important;
            margin-bottom: 0.6rem !important;
          }
          .hero-title {
            font-size: clamp(1.85rem, 7.5vw, 2.35rem) !important;
            letter-spacing: 0.14em !important;
            margin-left: 0.14em !important;
            line-height: 1.1 !important;
          }
          .hero-location {
            font-size: 0.75rem !important;
            letter-spacing: 0.32em !important;
            margin-left: 0.32em !important;
            margin-top: 0.3rem !important;
          }
          .hero-tagline {
            font-size: 0.95rem !important;
            margin-top: 0.75rem !important;
          }
          .hero-cta-wrapper {
            margin-top: 1.4rem !important;
          }
          .btn-book-stay {
            padding: 0.75rem 1.6rem !important;
            font-size: 0.72rem !important;
          }
        \`;
        document.head.appendChild(style);
      })()`
    });
    await wait(500);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, 'layout_3_sky_positioned.png'), Buffer.from(shot.data, 'base64'));

    console.log('Saved layout_3_sky_positioned.png');
    ws.close();
  } finally {
    chrome.kill();
  }
})();
