const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9223;
const URL = 'http://localhost:3000/';

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

const VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080, mobile: false },
  { name: '1440x900', width: 1440, height: 900, mobile: false },
  { name: '1280x720', width: 1280, height: 720, mobile: false },
  { name: '1024x768', width: 1024, height: 768, mobile: false },
  { name: '768x1024', width: 768, height: 1024, mobile: true },
  { name: '414x896', width: 414, height: 896, mobile: true },
  { name: '390x844', width: 390, height: 844, mobile: true },
  { name: '375x812', width: 375, height: 812, mobile: true }
];

async function main() {
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--no-sandbox',
    '--hide-scrollbars',
    'about:blank'
  ]);
  await wait(1500);

  const reportDir = path.join(__dirname, 'verification_reports');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });

  const results = [];

  try {
    const json = await getJson(`http://127.0.0.1:${PORT}/json`);
    const pageTarget = json.find(t => t.type === 'page');
    const client = new CDP(pageTarget.webSocketDebuggerUrl);
    await client.init();

    await client.send('Page.enable');
    await client.send('DOM.enable');

    for (const vp of VIEWPORTS) {
      console.log(`\n=== Testing Viewport: ${vp.name} (${vp.width}x${vp.height}) ===`);
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: 1,
        mobile: vp.mobile
      });

      await client.send('Page.navigate', { url: URL });
      await wait(1500);

      // 1. Initial State Check (scrollY: 0)
      const initialMetrics = await client.send('Runtime.evaluate', {
        expression: `(() => {
          const v = document.getElementById('hero-video');
          const f = document.getElementById('hero-sticky-frame');
          const c = document.getElementById('hero-scroll-container');
          const card = document.getElementById('hero-center-card');
          const title = document.querySelector('.hero-title');
          const btn = document.getElementById('btn-book-stay');
          
          const docEl = document.documentElement;
          const body = document.body;
          const hasHOverflow = docEl.scrollWidth > window.innerWidth || body.scrollWidth > window.innerWidth;
          
          const vRect = v ? v.getBoundingClientRect() : null;
          const fRect = f ? f.getBoundingClientRect() : null;
          const cardRect = card ? card.getBoundingClientRect() : null;
          const vComp = v ? getComputedStyle(v) : null;
          const fComp = f ? getComputedStyle(f) : null;

          return {
            windowWidth: window.innerWidth,
            windowHeight: window.innerHeight,
            scrollWidth: docEl.scrollWidth,
            hasHOverflow,
            video: v ? {
              width: vRect.width,
              height: vRect.height,
              fillsWidth: Math.abs(vRect.width - window.innerWidth) < 2,
              fillsHeight: Math.abs(vRect.height - window.innerHeight) < 2,
              objectFit: vComp.objectFit,
              objectPosition: vComp.objectPosition,
              display: vComp.display,
              muted: v.muted,
              playsInline: v.playsInline,
              hasControls: v.hasAttribute('controls'),
              autoplay: v.autoplay,
              videoWidth: v.videoWidth,
              videoHeight: v.videoHeight,
              aspectRatio: (v.videoWidth / v.videoHeight).toFixed(3),
              duration: v.duration,
              currentTime: v.currentTime,
              readyState: v.readyState
            } : null,
            frame: f ? {
              width: fRect.width,
              height: fRect.height,
              fillsWidth: Math.abs(fRect.width - window.innerWidth) < 2,
              fillsHeight: Math.abs(fRect.height - window.innerHeight) < 2,
              position: fComp.position,
              overflow: fComp.overflow
            } : null,
            centerCard: card ? {
              opacity: getComputedStyle(card).opacity,
              display: getComputedStyle(card).display,
              visibility: getComputedStyle(card).visibility,
              top: cardRect.top,
              left: cardRect.left,
              width: cardRect.width,
              height: cardRect.height,
              isWithinViewport: cardRect.top >= 0 && cardRect.bottom <= window.innerHeight && cardRect.left >= 0 && cardRect.right <= window.innerWidth
            } : null,
            titleText: title ? title.textContent.trim() : null,
            ctaText: btn ? btn.textContent.trim() : null
          };
        })()`,
        returnByValue: true
      });

      const initData = initialMetrics.result.value;

      // Capture screenshot at 0%
      const shot0 = await client.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(reportDir, `${vp.name}_0pct.png`), Buffer.from(shot0.data, 'base64'));

      // 2. Scroll Scrubbing Check (Scroll through 50% of hero)
      const scrollMetrics50 = await client.send('Runtime.evaluate', {
        expression: `(async () => {
          const c = document.getElementById('hero-scroll-container');
          const totalTravel = c.offsetHeight - window.innerHeight;
          const targetY = totalTravel * 0.5;
          window.scrollTo({ top: targetY, behavior: 'instant' });
          window.dispatchEvent(new Event('scroll'));
          await new Promise(r => setTimeout(r, 600));

          const v = document.getElementById('hero-video');
          const f = document.getElementById('hero-sticky-frame');
          const hud = document.getElementById('hero-journey-hud');
          const timeline = document.getElementById('timeline-bar');

          return {
            targetY,
            currentY: window.scrollY,
            stickyPinned: Math.abs(f.getBoundingClientRect().top) < 2,
            currentTime: v.currentTime,
            duration: v.duration,
            hudVisible: hud ? hud.classList.contains('visible') : false,
            timelineScale: timeline ? timeline.style.transform : null
          };
        })()`,
        awaitPromise: true,
        returnByValue: true
      });

      const midData = scrollMetrics50.result.value;

      // Capture screenshot at 50%
      const shot50 = await client.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(reportDir, `${vp.name}_50pct.png`), Buffer.from(shot50.data, 'base64'));

      // 3. Scroll Scrubbing Check (Scroll through 100% of hero)
      const scrollMetrics100 = await client.send('Runtime.evaluate', {
        expression: `(async () => {
          const c = document.getElementById('hero-scroll-container');
          const totalTravel = c.offsetHeight - window.innerHeight;
          const targetY = totalTravel * 0.98;
          window.scrollTo({ top: targetY, behavior: 'instant' });
          window.dispatchEvent(new Event('scroll'));
          await new Promise(r => setTimeout(r, 600));

          const v = document.getElementById('hero-video');
          const f = document.getElementById('hero-sticky-frame');
          const conclusion = document.getElementById('hero-conclusion-card');

          return {
            targetY,
            currentY: window.scrollY,
            stickyPinned: Math.abs(f.getBoundingClientRect().top) < 2,
            currentTime: v.currentTime,
            duration: v.duration,
            conclusionVisible: conclusion ? conclusion.classList.contains('visible') : false
          };
        })()`,
        awaitPromise: true,
        returnByValue: true
      });

      const endData = scrollMetrics100.result.value;

      // Capture screenshot at 100%
      const shot100 = await client.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(reportDir, `${vp.name}_100pct.png`), Buffer.from(shot100.data, 'base64'));

      // 4. Scroll Past Hero into Next Section
      const scrollPastMetrics = await client.send('Runtime.evaluate', {
        expression: `(async () => {
          const c = document.getElementById('hero-scroll-container');
          const exp = document.getElementById('experience');
          const targetY = c.offsetHeight + 100;
          window.scrollTo({ top: targetY, behavior: 'instant' });
          window.dispatchEvent(new Event('scroll'));
          await new Promise(r => setTimeout(r, 500));

          const expRect = exp ? exp.getBoundingClientRect() : null;

          return {
            targetY,
            currentY: window.scrollY,
            expInView: expRect ? expRect.top < window.innerHeight : false,
            expTop: expRect ? expRect.top : null
          };
        })()`,
        awaitPromise: true,
        returnByValue: true
      });

      const pastData = scrollPastMetrics.result.value;

      results.push({
        viewport: vp.name,
        width: vp.width,
        height: vp.height,
        initial: initData,
        midJourney: midData,
        endJourney: endData,
        pastHero: pastData
      });

      console.log(`Results for ${vp.name}:`);
      console.log(` - No Horizontal Overflow: ${!initData.hasHOverflow} (scrollWidth: ${initData.scrollWidth}px vs ${vp.width}px)`);
      console.log(` - Video Fills Container: width=${initData.video.fillsWidth} (${initData.video.width}px), height=${initData.video.fillsHeight} (${initData.video.height}px)`);
      console.log(` - Frame Fills Viewport: width=${initData.frame.fillsWidth}, height=${initData.frame.fillsHeight}`);
      console.log(` - Object Fit: ${initData.video.objectFit}, Object Position: ${initData.video.objectPosition}`);
      console.log(` - Video Attributes: muted=${initData.video.muted}, playsInline=${initData.video.playsInline}, controls=${initData.video.hasControls}`);
      console.log(` - Video Native Resolution: ${initData.video.videoWidth}x${initData.video.videoHeight} (${initData.video.aspectRatio})`);
      console.log(` - Text Visible: Title="${initData.titleText}", opacity=${initData.centerCard.opacity}`);
      console.log(` - Mid Scroll (50%): time=${midData.currentTime.toFixed(2)}s/${midData.duration.toFixed(2)}s, HUD visible=${midData.hudVisible}, stickyPinned=${midData.stickyPinned}`);
      console.log(` - End Scroll (100%): time=${endData.currentTime.toFixed(2)}s/${endData.duration.toFixed(2)}s, Conclusion visible=${endData.conclusionVisible}`);
      console.log(` - Past Hero: Next section in view=${pastData.expInView}`);
    }

    fs.writeFileSync(path.join(reportDir, 'verification_summary.json'), JSON.stringify(results, null, 2));
    console.log(`\nAll verifications completed! Summary saved to verification_reports/verification_summary.json`);

    client.close();
  } finally {
    chrome.kill();
  }
}

main().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
