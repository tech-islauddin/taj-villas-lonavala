const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:3000/';

const viewports = [
  { name: 'desktop_1920x1080', width: 1920, height: 1080 },
  { name: 'laptop_1440x900', width: 1440, height: 900 },
  { name: 'desktop_1280x720', width: 1280, height: 720 },
  { name: 'tablet_landscape_1024x768', width: 1024, height: 768 },
  { name: 'tablet_portrait_768x1024', width: 768, height: 1024 },
  { name: 'mobile_414x896', width: 414, height: 896 },
  { name: 'mobile_390x844', width: 390, height: 844 },
  { name: 'mobile_375x812', width: 375, height: 812 }
];

const outDir = path.join(__dirname, 'test_screenshots');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

for (const vp of viewports) {
  const outFile = path.join(outDir, `${vp.name}.png`);
  console.log(`Capturing ${vp.name} (${vp.width}x${vp.height})...`);
  const cmd = `"${CHROME_PATH}" --headless=new --hide-scrollbars --window-size=${vp.width},${vp.height} --screenshot="${outFile}" "${URL}"`;
  try {
    execSync(cmd, { stdio: 'pipe' });
    console.log(`Saved: ${outFile}`);
  } catch (err) {
    console.error(`Error on ${vp.name}:`, err.message);
  }
}
console.log('Done!');
