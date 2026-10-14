const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9225;
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
    this.consoleLogs = [];
    this.networkErrors = [];
  }
  init() {
    return new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = rej;
      this.ws.onmessage = e => {
        const msg = JSON.parse(e.data);
        if (msg.method === 'Console.messageAdded') {
          this.consoleLogs.push({ source: 'console', ...msg.params.message });
        } else if (msg.method === 'Runtime.consoleAPICalled') {
          this.consoleLogs.push({ source: 'runtime', type: msg.params.type, args: msg.params.args });
        } else if (msg.method === 'Log.entryAdded') {
          this.consoleLogs.push({ source: 'log', ...msg.params.entry });
        } else if (msg.method === 'Network.responseReceived') {
          const resp = msg.params.response;
          if (resp.status >= 400) {
            this.networkErrors.push({ url: resp.url, status: resp.status, statusText: resp.statusText });
          }
        }
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

async function auditEntirePage() {
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--no-sandbox',
    '--hide-scrollbars',
    'about:blank'
  ]);
  await wait(1500);

  const outDir = path.join(__dirname, 'audit_reports', 'full_page');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  try {
    const json = await getJson(`http://127.0.0.1:${PORT}/json`);
    const pageTarget = json.find(t => t.type === 'page');
    const client = new CDP(pageTarget.webSocketDebuggerUrl);
    await client.init();

    await client.send('Page.enable');
    await client.send('DOM.enable');
    await client.send('Console.enable');
    await client.send('Log.enable');
    await client.send('Runtime.enable');
    await client.send('Network.enable');

    const viewports = [
      { name: 'desktop_1920x1080', width: 1920, height: 1080, mobile: false },
      { name: 'mobile_390x844', width: 390, height: 844, mobile: true },
      { name: 'mobile_375x667', width: 375, height: 667, mobile: true }
    ];

    for (const vp of viewports) {
      console.log(`\n========================================`);
      console.log(`AUDITING VIEWPORT: ${vp.name} (${vp.width}x${vp.height})`);
      console.log(`========================================`);

      await client.send('Emulation.setDeviceMetricsOverride', {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: vp.mobile ? 2 : 1,
        mobile: vp.mobile
      });

      await client.send('Page.navigate', { url: URL });
      await wait(2000);

      // Check all images
      const imgReport = await client.send('Runtime.evaluate', {
        expression: `(() => {
          const imgs = Array.from(document.querySelectorAll('img'));
          return imgs.map(img => ({
            src: img.src,
            alt: img.alt,
            complete: img.complete,
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
            renderedWidth: img.offsetWidth,
            renderedHeight: img.offsetHeight,
            isLoaded: img.naturalWidth > 0
          }));
        })()`,
        returnByValue: true
      });

      const images = imgReport.result.value;
      const brokenImages = images.filter(i => !i.isLoaded);
      console.log(`Total images: ${images.length}, Broken images: ${brokenImages.length}`);
      if (brokenImages.length > 0) {
        console.error('Broken images found:', brokenImages);
      }

      // Check section by section for layout overflow or clipping
      const sectionReport = await client.send('Runtime.evaluate', {
        expression: `(() => {
          const sections = Array.from(document.querySelectorAll('section, footer, header'));
          const winW = window.innerWidth;
          const overflows = [];

          sections.forEach(sec => {
            const rect = sec.getBoundingClientRect();
            // Check all children
            const els = Array.from(sec.querySelectorAll('*'));
            els.forEach(el => {
              const r = el.getBoundingClientRect();
              if (r.width > winW + 2) {
                overflows.push({
                  section: sec.id || sec.className,
                  tag: el.tagName,
                  class: el.className,
                  elementWidth: r.width,
                  windowWidth: winW
                });
              }
            });
          });

          return {
            docScrollWidth: document.documentElement.scrollWidth,
            bodyScrollWidth: document.body.scrollWidth,
            windowWidth: winW,
            hasHorizontalOverflow: document.documentElement.scrollWidth > winW || document.body.scrollWidth > winW,
            overflowingElementsCount: overflows.length,
            sampleOverflows: overflows.slice(0, 5)
          };
        })()`,
        returnByValue: true
      });
      console.log(`Layout check for ${vp.name}:`, JSON.stringify(sectionReport.result.value, null, 2));

      // Scroll through each section and verify animations / visibility
      const sectionIds = [
        'hero-scroll-container',
        'experience',
        'villa',
        'amenities',
        'gallery',
        'the-experience',
        'location',
        'reviews',
        'book-stay',
        'instagram'
      ];

      for (const id of sectionIds) {
        const secEval = await client.send('Runtime.evaluate', {
          expression: `(async () => {
            const el = document.getElementById('${id}');
            if (!el) return { found: false };
            el.scrollIntoView({ behavior: 'instant', block: 'start' });
            window.dispatchEvent(new Event('scroll'));
            await new Promise(r => setTimeout(r, 300));
            const r = el.getBoundingClientRect();
            return {
              found: true,
              top: r.top,
              bottom: r.bottom,
              width: r.width,
              height: r.height,
              inViewport: r.top < window.innerHeight && r.bottom > 0
            };
          })()`,
          awaitPromise: true,
          returnByValue: true
        });

        // Screenshot this section
        const shot = await client.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(outDir, `${vp.name}_sec_${id}.png`), Buffer.from(shot.data, 'base64'));
      }
    }

    console.log('\n--- Final Network Errors ---');
    console.log(client.networkErrors);

    console.log('\n--- Final Console Logs ---');
    client.consoleLogs.forEach(l => console.log(l));

    client.close();
  } finally {
    chrome.kill();
  }
}

auditEntirePage().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
