const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9235;

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
    '--window-size=390,844',
    'about:blank'
  ]);
  await wait(1500);

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
    await send('Page.enable');
    await send('Page.navigate', { url: 'http://localhost:3000/' });
    await wait(2000);

    // Apply the overflow-x: clip fix
    await send('Runtime.evaluate', {
      expression: `(() => {
        document.documentElement.style.overflowX = 'clip';
        document.body.style.overflow = 'visible';
        document.body.style.overflowX = 'clip';
      })()`
    });

    const outDir = path.join(__dirname, 'test_sticky_screenshots');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    // 1. Initial 0%
    let shot0 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, '01_mobile_scroll_0pct.png'), Buffer.from(shot0.data, 'base64'));

    // 2. 50%
    await send('Runtime.evaluate', {
      expression: `(async () => {
        const c = document.getElementById('hero-scroll-container');
        const travel = c.offsetHeight - window.innerHeight;
        window.scrollTo({ top: travel * 0.5, behavior: 'instant' });
        window.dispatchEvent(new Event('scroll'));
        await new Promise(r => setTimeout(r, 600));
      })()`,
      awaitPromise: true
    });
    await wait(400);
    let shot50 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, '02_mobile_scroll_50pct.png'), Buffer.from(shot50.data, 'base64'));

    // 3. 100%
    await send('Runtime.evaluate', {
      expression: `(async () => {
        const c = document.getElementById('hero-scroll-container');
        const travel = c.offsetHeight - window.innerHeight;
        window.scrollTo({ top: travel * 0.98, behavior: 'instant' });
        window.dispatchEvent(new Event('scroll'));
        await new Promise(r => setTimeout(r, 600));
      })()`,
      awaitPromise: true
    });
    await wait(400);
    let shot100 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, '03_mobile_scroll_100pct.png'), Buffer.from(shot100.data, 'base64'));

    console.log('Mobile scroll screenshots saved to test_sticky_screenshots/');
    ws.close();
  } finally {
    chrome.kill();
  }
})();
