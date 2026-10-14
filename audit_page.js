const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9224;
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
    this.events = [];
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

async function runAudit() {
  console.log('Launching headless Chrome for comprehensive production audit...');
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--no-sandbox',
    '--hide-scrollbars',
    'about:blank'
  ]);
  await wait(1500);

  const auditDir = path.join(__dirname, 'audit_reports');
  if (!fs.existsSync(auditDir)) fs.mkdirSync(auditDir, { recursive: true });

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

    console.log('\n--- 1. Testing Desktop (1920x1080) ---');
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false
    });

    await client.send('Page.navigate', { url: URL });
    await wait(2000);

    // Initial evaluation
    const initialReport = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const v = document.getElementById('hero-video');
        const container = document.getElementById('hero-scroll-container');
        const frame = document.getElementById('hero-sticky-frame');
        const stage = document.getElementById('video-stage');
        const body = document.body;
        const html = document.documentElement;

        const vRect = v ? v.getBoundingClientRect() : null;
        const vComp = v ? getComputedStyle(v) : null;
        const bodyComp = getComputedStyle(body);

        return {
          hOverflow: html.scrollWidth > window.innerWidth || body.scrollWidth > window.innerWidth,
          scrollWidth: html.scrollWidth,
          windowWidth: window.innerWidth,
          bodyBg: bodyComp.backgroundColor,
          video: v ? {
            id: v.id,
            currentSrc: v.currentSrc,
            networkState: v.networkState,
            readyState: v.readyState,
            duration: v.duration,
            currentTime: v.currentTime,
            videoWidth: v.videoWidth,
            videoHeight: v.videoHeight,
            paused: v.paused,
            muted: v.muted,
            playsInline: v.playsInline,
            objectFit: vComp.objectFit,
            objectPosition: vComp.objectPosition,
            width: vRect.width,
            height: vRect.height
          } : null
        };
      })()`,
      returnByValue: true
    });
    console.log('Initial Desktop Evaluation:', JSON.stringify(initialReport.result.value, null, 2));

    // Screenshot Desktop Initial (0% scroll)
    let shot = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(auditDir, 'desktop_0pct.png'), Buffer.from(shot.data, 'base64'));

    // Test forward scrolling in multiple steps
    console.log('\n--- 2. Testing Forward Scroll Scrubbing (0% -> 25% -> 50% -> 75% -> 100%) ---');
    const steps = [0.25, 0.50, 0.75, 1.0];
    const forwardTimes = [];

    for (const pct of steps) {
      const stepRes = await client.send('Runtime.evaluate', {
        expression: `(async () => {
          const c = document.getElementById('hero-scroll-container');
          const totalTravel = c.offsetHeight - window.innerHeight;
          window.scrollTo({ top: totalTravel * ${pct}, behavior: 'instant' });
          window.dispatchEvent(new Event('scroll'));
          await new Promise(r => setTimeout(r, 600));
          const v = document.getElementById('hero-video');
          const hud = document.getElementById('hero-journey-hud');
          const conclusion = document.getElementById('hero-conclusion-card');
          return {
            scrollY: window.scrollY,
            currentTime: v ? v.currentTime : null,
            duration: v ? v.duration : null,
            hudVisible: hud ? hud.classList.contains('visible') : false,
            conclusionVisible: conclusion ? conclusion.classList.contains('visible') : false
          };
        })()`,
        awaitPromise: true,
        returnByValue: true
      });
      console.log(`Scroll ${(pct * 100).toFixed(0)}%: currentTime = ${stepRes.result.value.currentTime?.toFixed(2)}s / ${stepRes.result.value.duration?.toFixed(2)}s`);
      forwardTimes.push(stepRes.result.value.currentTime);

      shot = await client.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(auditDir, `desktop_forward_${(pct * 100).toFixed(0)}pct.png`), Buffer.from(shot.data, 'base64'));
    }

    // Test reverse scrolling (100% -> 75% -> 50% -> 25% -> 0%)
    console.log('\n--- 3. Testing Reverse Scroll Scrubbing (100% -> 75% -> 50% -> 25% -> 0%) ---');
    const revSteps = [0.75, 0.50, 0.25, 0.0];
    const reverseTimes = [];

    for (const pct of revSteps) {
      const stepRes = await client.send('Runtime.evaluate', {
        expression: `(async () => {
          const c = document.getElementById('hero-scroll-container');
          const totalTravel = c.offsetHeight - window.innerHeight;
          window.scrollTo({ top: totalTravel * ${pct}, behavior: 'instant' });
          window.dispatchEvent(new Event('scroll'));
          await new Promise(r => setTimeout(r, 600));
          const v = document.getElementById('hero-video');
          const card = document.getElementById('hero-center-card');
          return {
            scrollY: window.scrollY,
            currentTime: v ? v.currentTime : null,
            cardOpacity: card ? getComputedStyle(card).opacity : null
          };
        })()`,
        awaitPromise: true,
        returnByValue: true
      });
      console.log(`Reverse Scroll ${(pct * 100).toFixed(0)}%: currentTime = ${stepRes.result.value.currentTime?.toFixed(2)}s, Center Card Opacity = ${stepRes.result.value.cardOpacity}`);
      reverseTimes.push(stepRes.result.value.currentTime);

      shot = await client.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(auditDir, `desktop_reverse_${(pct * 100).toFixed(0)}pct.png`), Buffer.from(shot.data, 'base64'));
    }

    // Test Mobile Viewports
    console.log('\n--- 4. Testing Mobile Viewports (iPhone 390x844, 375x667, 414x896) ---');
    const mobileViewports = [
      { name: 'iPhone_12_390x844', width: 390, height: 844 },
      { name: 'iPhone_SE_375x667', width: 375, height: 667 },
      { name: 'iPhone_XR_414x896', width: 414, height: 896 }
    ];

    for (const mv of mobileViewports) {
      console.log(`\nTesting ${mv.name}:`);
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: mv.width,
        height: mv.height,
        deviceScaleFactor: 2,
        mobile: true
      });

      await client.send('Page.navigate', { url: URL });
      await wait(1800);

      const mReport = await client.send('Runtime.evaluate', {
        expression: `(() => {
          const v = document.getElementById('hero-video');
          const card = document.getElementById('hero-center-card');
          const title = document.querySelector('.hero-title');
          const btn = document.getElementById('btn-book-stay');
          const docEl = document.documentElement;
          const body = document.body;

          const hOverflow = docEl.scrollWidth > window.innerWidth || body.scrollWidth > window.innerWidth;
          const cardRect = card ? card.getBoundingClientRect() : null;
          const vRect = v ? v.getBoundingClientRect() : null;

          return {
            windowWidth: window.innerWidth,
            windowHeight: window.innerHeight,
            scrollWidth: docEl.scrollWidth,
            hOverflow,
            video: v ? {
              readyState: v.readyState,
              duration: v.duration,
              videoWidth: v.videoWidth,
              videoHeight: v.videoHeight,
              renderedWidth: vRect.width,
              renderedHeight: vRect.height
            } : null,
            centerCard: card ? {
              left: cardRect.left,
              right: cardRect.right,
              top: cardRect.top,
              bottom: cardRect.bottom,
              width: cardRect.width,
              height: cardRect.height,
              fitsInViewport: cardRect.left >= 0 && cardRect.right <= window.innerWidth
            } : null
          };
        })()`,
        returnByValue: true
      });
      console.log(`${mv.name} metrics:`, JSON.stringify(mReport.result.value, null, 2));

      shot = await client.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(auditDir, `${mv.name}_0pct.png`), Buffer.from(shot.data, 'base64'));

      // Also test scroll on mobile
      const mScrollRes = await client.send('Runtime.evaluate', {
        expression: `(async () => {
          const c = document.getElementById('hero-scroll-container');
          const totalTravel = c.offsetHeight - window.innerHeight;
          window.scrollTo({ top: totalTravel * 0.5, behavior: 'instant' });
          window.dispatchEvent(new Event('scroll'));
          await new Promise(r => setTimeout(r, 600));
          const v = document.getElementById('hero-video');
          return {
            currentTime: v ? v.currentTime : null,
            duration: v ? v.duration : null
          };
        })()`,
        awaitPromise: true,
        returnByValue: true
      });
      console.log(`${mv.name} scroll 50%: currentTime = ${mScrollRes.result.value.currentTime?.toFixed(2)}s`);

      shot = await client.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(auditDir, `${mv.name}_50pct.png`), Buffer.from(shot.data, 'base64'));
    }

    // Check Network and Console Logs
    console.log('\n--- 5. Network 404 / Errors ---');
    console.log(`Network errors count: ${client.networkErrors.length}`);
    if (client.networkErrors.length > 0) {
      console.log('Network errors:', client.networkErrors);
    }

    console.log('\n--- 6. Console Logs & Warnings & Errors ---');
    console.log(`Console messages count: ${client.consoleLogs.length}`);
    client.consoleLogs.forEach((log, i) => {
      console.log(`[${i}] ${log.source || ''} ${log.type || log.level || ''}:`, log.text || log.args || log);
    });

    client.close();
  } finally {
    chrome.kill();
  }
}

runAudit().catch(err => {
  console.error('Audit run error:', err);
  process.exit(1);
});
