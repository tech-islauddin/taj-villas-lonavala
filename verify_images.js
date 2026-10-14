const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9226;
const URL = 'http://127.0.0.1:3000/';

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

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.cbs = new Map();
  }
  init() {
    return new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = rej;
      this.ws.onmessage = e => {
        const msg = JSON.parse(e.data);
        if (msg.id && this.cbs.has(msg.id)) {
          const { resolve, reject } = this.cbs.get(msg.id);
          this.cbs.delete(msg.id);
          if (msg.error) reject(msg.error); else resolve(msg.result);
        }
      };
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const myId = this.id++;
      this.cbs.set(myId, { resolve, reject });
      this.ws.send(JSON.stringify({ id: myId, method, params }));
    });
  }
  close() { this.ws.close(); }
}

async function verifyAllImages() {
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--no-sandbox',
    '--hide-scrollbars',
    'about:blank'
  ]);
  await wait(1500);

  try {
    const json = await getJson(`http://127.0.0.1:${PORT}/json`);
    const pageTarget = json.find(t => t.type === 'page');
    const client = new CDP(pageTarget.webSocketDebuggerUrl);
    await client.init();

    await client.send('Page.enable');
    await client.send('DOM.enable');
    await client.send('Runtime.enable');

    await client.send('Page.navigate', { url: URL });
    await wait(2000);

    // Scroll through the whole page smoothly to trigger all lazy loading
    console.log('Scrolling through the page to trigger all image loads...');
    await client.send('Runtime.evaluate', {
      expression: `(async () => {
        const totalHeight = document.documentElement.scrollHeight;
        const step = 800;
        for (let y = 0; y < totalHeight; y += step) {
          window.scrollTo({ top: y, behavior: 'instant' });
          window.dispatchEvent(new Event('scroll'));
          await new Promise(r => setTimeout(r, 100));
        }
        window.scrollTo({ top: totalHeight, behavior: 'instant' });
        window.dispatchEvent(new Event('scroll'));
        await new Promise(r => setTimeout(r, 1500));
      })()`,
      awaitPromise: true
    });

    const report = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const imgs = Array.from(document.querySelectorAll('img'));
        return imgs.map(img => ({
          src: img.getAttribute('src'),
          alt: img.getAttribute('alt'),
          complete: img.complete,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          hasError: img.naturalWidth === 0
        }));
      })()`,
      returnByValue: true
    });

    const results = report.result.value;
    console.log(`\nVerified ${results.length} total images on the page:`);
    let errors = 0;
    results.forEach((img, idx) => {
      const ok = img.complete && img.naturalWidth > 0;
      if (!ok) errors++;
      console.log(`[${idx + 1}] ${ok ? 'LOADED' : 'ERROR'} ${img.naturalWidth}x${img.naturalHeight} - ${img.src} (${img.alt || 'no alt'})`);
    });

    console.log(`\nImage Check Summary: ${results.length - errors}/${results.length} images loaded successfully.`);
    if (errors > 0) {
      console.error(`Found ${errors} failed image loads!`);
    }

    client.close();
  } finally {
    chrome.kill();
  }
}

verifyAllImages().catch(console.error);
