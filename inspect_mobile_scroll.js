const { spawn } = require('child_process');
const http = require('http');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9224;

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

    const check = await send('Runtime.evaluate', {
      expression: `(() => {
        window.scrollTo(0, 800);
        window.dispatchEvent(new Event('scroll'));
        const container = document.getElementById('hero-scroll-container');
        const frame = document.getElementById('hero-sticky-frame');
        const video = document.getElementById('hero-video');
        const stage = document.getElementById('video-stage');
        const hud = document.getElementById('hero-journey-hud');
        return {
          scrollY: window.scrollY,
          containerRect: container ? container.getBoundingClientRect() : null,
          frameRect: frame ? frame.getBoundingClientRect() : null,
          stageRect: stage ? stage.getBoundingClientRect() : null,
          videoRect: video ? video.getBoundingClientRect() : null,
          videoComputed: video ? {
            display: getComputedStyle(video).display,
            visibility: getComputedStyle(video).visibility,
            opacity: getComputedStyle(video).opacity,
            width: getComputedStyle(video).width,
            height: getComputedStyle(video).height,
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            currentTime: video.currentTime,
            duration: video.duration
          } : null,
          hudComputed: hud ? {
            display: getComputedStyle(hud).display,
            visibility: getComputedStyle(hud).visibility,
            opacity: getComputedStyle(hud).opacity,
            classList: Array.from(hud.classList)
          } : null
        };
      })()`,
      returnByValue: true
    });
    console.log(JSON.stringify(check.result.value, null, 2));
    ws.close();
  } finally {
    chrome.kill();
  }
})();
