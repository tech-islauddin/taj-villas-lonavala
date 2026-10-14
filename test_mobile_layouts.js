const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9226;

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
    '--autoplay-policy=no-user-gesture-required',
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
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    // --- TEST 1: Full-bleed Cover on Mobile with adjusted typography ---
    await send('Runtime.evaluate', {
      expression: `(() => {
        const style = document.createElement('style');
        style.id = 'eval-style-1';
        style.innerHTML = \`
          .hero-video {
            width: 100% !important;
            height: 100% !important;
            object-fit: cover !important;
            object-position: center center !important;
          }
          .hero-title {
            font-size: clamp(1.8rem, 7vw, 2.3rem) !important;
            letter-spacing: 0.14em !important;
            margin-left: 0.14em !important;
          }
          .hero-overlay-content {
            padding: 1.5rem !important;
          }
          .hero-center-card {
            margin-top: -30px !important;
          }
        \`;
        document.head.appendChild(style);
      })()`
    });
    await wait(500);
    const shot1 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, 'layout_1_cover_refined.png'), Buffer.from(shot1.data, 'base64'));

    // --- TEST 2: Contain Strategy on Mobile with dark background and balanced layout ---
    await send('Runtime.evaluate', {
      expression: `(() => {
        const s1 = document.getElementById('eval-style-1');
        if (s1) s1.remove();
        const style = document.createElement('style');
        style.id = 'eval-style-2';
        style.innerHTML = \`
          .video-stage {
            background-color: #080A0C !important;
          }
          .hero-video {
            width: 100% !important;
            height: 100% !important;
            object-fit: contain !important;
            object-position: center center !important;
          }
          .cinematic-gradient-overlay {
            background: linear-gradient(180deg, 
              #080A0C 0%, 
              rgba(8,10,12,0.85) 15%, 
              rgba(8,10,12,0.2) 32%, 
              rgba(8,10,12,0.1) 50%, 
              rgba(8,10,12,0.2) 68%, 
              rgba(8,10,12,0.85) 85%, 
              #080A0C 100%) !important;
          }
          .hero-overlay-content {
            justify-content: space-between !important;
            padding: 5.5rem 1.5rem 3.5rem !important;
          }
          .hero-center-card {
            margin-top: 0 !important;
          }
          .hero-title {
            font-size: 2.1rem !important;
            letter-spacing: 0.14em !important;
            margin-left: 0.14em !important;
          }
          .hero-cta-wrapper {
            margin-top: 1rem !important;
          }
        \`;
        document.head.appendChild(style);
      })()`
    });
    await wait(500);
    const shot2 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, 'layout_2_contain_balanced.png'), Buffer.from(shot2.data, 'base64'));

    console.log('Mobile evaluation screenshots saved to mobile_eval/');
    ws.close();
  } finally {
    chrome.kill();
  }
})();
