const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
const regex = /(?:src|href|content)=["']([^"']+)["']/g;
let match;
const localPaths = new Set();

while ((match = regex.exec(html)) !== null) {
  const url = match[1];
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('#') || url.startsWith('mailto:') || url.startsWith('tel:') || url.startsWith('data:')) {
    continue;
  }
  // Ignore meta property/names like 'website' or viewport etc.
  if (url.includes(' ') || url === 'website' || url === 'summary_large_image' || url === '#080A0C' || url === 'width=device-width, initial-scale=1.0') {
    continue;
  }
  localPaths.add(url);
}

console.log('=== CHECKING REFERENCED ASSETS IN INDEX.HTML ===');
let missingCount = 0;
for (const p of Array.from(localPaths).sort()) {
  const clean = p.startsWith('/') ? p.slice(1) : p;
  const full = path.join(__dirname, clean);
  const exists = fs.existsSync(full);
  console.log(`${exists ? '[OK]     ' : '[MISSING]'} ${p}`);
  if (!exists) missingCount++;
}

console.log(`\nTotal checked: ${localPaths.size}, Missing: ${missingCount}`);
