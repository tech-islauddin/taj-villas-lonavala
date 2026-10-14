const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:3000/';

// We can run Chrome with a user-script or inspect frames
// Or we can create a temporary test page that sets video.currentTime to specific times
const testTimes = [0, 2.5, 5.0, 7.5, 9.9];
const outDir = path.join(__dirname, 'test_scroll_frames');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Create an evaluation script that scrolls to progress
const htmlRunner = `
<!DOCTYPE html>
<html>
<head>
<script>
window.onload = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const scrollY = parseFloat(urlParams.get('y') || '0');
  window.scrollTo(0, scrollY);
};
</script>
</head>
<body style="margin:0;padding:0;">
<iframe id="f" src="${URL}" style="width:100%;height:100vh;border:none;"></iframe>
</body>
</html>
`;
fs.writeFileSync(path.join(__dirname, 'test_frame_helper.html'), htmlRunner);

console.log('Testing video currentTime directly...');
