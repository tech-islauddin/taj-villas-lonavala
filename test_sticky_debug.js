const { spawn } = require('child_process');
const http = require('http');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9222;

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
    'about:blank'
  ]);
  await wait(1200);
  try {
    const list = await getJson(`http://127.0.0.1:${PORT}/json`);
    const target = list.find(t => t.type === 'page');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
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

    await send('Page.enable');
    await send('Page.navigate', { url: 'http://localhost:3000/' });
    await wait(1200);

    const evalResult = await send('Runtime.evaluate', {
      expression: `(() => {
        const f = document.getElementById('hero-sticky-frame');
        const c = document.getElementById('hero-scroll-container');
        const b0 = f.getBoundingClientRect();
        const r0 = { top: b0.top, bottom: b0.bottom, height: b0.height };
        window.scrollTo(0, 600);
        const b600 = f.getBoundingClientRect();
        const r600 = { top: b600.top, bottom: b600.bottom, height: b600.height };
        const scrollProgress = (window.scrollY || window.pageYOffset);
        const htmlOF = getComputedStyle(document.documentElement).overflow;
        const htmlOFX = getComputedStyle(document.documentElement).overflowX;
        const bodyOF = getComputedStyle(document.body).overflow;
        const bodyOFX = getComputedStyle(document.body).overflowX;
        const framePos = getComputedStyle(f).position;
        return {
          r0,
          r600,
          htmlOF, htmlOFX,
          bodyOF, bodyOFX,
          framePos
        };
      })()`,
      returnByValue: true
    });
    console.log(JSON.stringify(evalResult.result.value, null, 2));
    ws.close();
  } finally {
    chrome.kill();
  }
})();
