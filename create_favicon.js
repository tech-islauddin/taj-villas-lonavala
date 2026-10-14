const fs = require('fs');
const path = require('path');

const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#F3E5AB" />
      <stop offset="50%" stop-color="#D4AF37" />
      <stop offset="100%" stop-color="#AA8022" />
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="#080A0C"/>
  <rect x="1.5" y="1.5" width="61" height="61" rx="12.5" fill="none" stroke="url(#goldGrad)" stroke-width="1.5" opacity="0.8"/>
  <circle cx="32" cy="32" r="26" fill="none" stroke="#D4AF37" stroke-width="0.8" stroke-dasharray="2 2" opacity="0.4"/>
  <!-- Luxury Monogram TV -->
  <text x="32" y="39" font-family="'Playfair Display', Georgia, serif" font-size="24" font-weight="700" fill="url(#goldGrad)" text-anchor="middle" letter-spacing="1">TV</text>
  <!-- Subtle star accent -->
  <polygon points="32,11 33.2,14 36,14.8 33.2,15.6 32,18.5 30.8,15.6 28,14.8 30.8,14" fill="#F3E5AB"/>
</svg>`;

const publicSvgPath = path.join(__dirname, 'public', 'favicon.svg');
fs.writeFileSync(publicSvgPath, svgContent, 'utf-8');
console.log('Created:', publicSvgPath);

// Generate valid 32x32 standard Windows ICO file
// ICO Header: 6 bytes
// Directory Entry: 16 bytes
// BITMAPINFOHEADER (DIB): 40 bytes
// Color Table / Pixel data: 32 * 32 * 4 bytes BGRA + 32 * 4 bytes AND mask
const width = 32;
const height = 32;
const bpp = 32;
const xorSize = width * height * 4;
const andRowSize = Math.ceil(width / 32) * 4; // 4 bytes per row
const andSize = andRowSize * height;
const dibSize = 40 + xorSize + andSize;
const fileSize = 6 + 16 + dibSize;

const icoBuffer = Buffer.alloc(fileSize);

// 1. ICO Header
icoBuffer.writeUInt16LE(0, 0); // Reserved, must be 0
icoBuffer.writeUInt16LE(1, 2); // Image type: 1 = ICO
icoBuffer.writeUInt16LE(1, 4); // Number of images: 1

// 2. Directory Entry
icoBuffer.writeUInt8(width, 6);        // Width (32)
icoBuffer.writeUInt8(height, 7);       // Height (32)
icoBuffer.writeUInt8(0, 8);            // Color palette count (0 for 24/32 bpp)
icoBuffer.writeUInt8(0, 9);            // Reserved
icoBuffer.writeUInt16LE(1, 10);        // Color planes
icoBuffer.writeUInt16LE(bpp, 12);      // Bits per pixel (32)
icoBuffer.writeUInt32LE(dibSize, 14);  // Image data size
icoBuffer.writeUInt32LE(22, 18);       // Image data offset (6 + 16 = 22)

// 3. BITMAPINFOHEADER (DIB)
const dibOffset = 22;
icoBuffer.writeUInt32LE(40, dibOffset);               // Header size
icoBuffer.writeInt32LE(width, dibOffset + 4);         // Width
icoBuffer.writeInt32LE(height * 2, dibOffset + 8);    // Height (doubled for XOR + AND mask)
icoBuffer.writeUInt16LE(1, dibOffset + 12);           // Planes
icoBuffer.writeUInt16LE(bpp, dibOffset + 14);         // Bits per pixel
icoBuffer.writeUInt32LE(0, dibOffset + 16);           // Compression (0 = BI_RGB)
icoBuffer.writeUInt32LE(xorSize + andSize, dibOffset + 20); // Image size
icoBuffer.writeInt32LE(0, dibOffset + 24);            // X pixels per meter
icoBuffer.writeInt32LE(0, dibOffset + 28);            // Y pixels per meter
icoBuffer.writeUInt32LE(0, dibOffset + 32);           // Colors used
icoBuffer.writeUInt32LE(0, dibOffset + 36);           // Important colors

// 4. Pixel Data (Bottom-up, BGRA)
// Design a luxury dark circle with gold border and monogram inside 32x32
const pixelOffset = dibOffset + 40;
for (let y = 0; y < height; y++) {
  // BMP is bottom-up, so actual row from top is (height - 1 - y)
  const topY = height - 1 - y;
  for (let x = 0; x < width; x++) {
    const idx = pixelOffset + (y * width + x) * 4;
    const dx = x - 15.5;
    const dy = topY - 15.5;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= 14.5) {
      if (dist >= 13.0) {
        // Gold border: #D4AF37 (B: 55, G: 175, R: 212)
        icoBuffer.writeUInt8(55, idx);     // B
        icoBuffer.writeUInt8(175, idx + 1); // G
        icoBuffer.writeUInt8(212, idx + 2); // R
        icoBuffer.writeUInt8(255, idx + 3); // A
      } else if (dist >= 11.8 && dist <= 12.4) {
        // Inner gold accent ring
        icoBuffer.writeUInt8(70, idx);     // B
        icoBuffer.writeUInt8(190, idx + 1); // G
        icoBuffer.writeUInt8(230, idx + 2); // R
        icoBuffer.writeUInt8(180, idx + 3); // A
      } else {
        // Background deep dark: #080A0C (B: 12, G: 10, R: 8)
        // Check if inside T or V letter shapes
        // T: top bar at topY around 10-12, stem at x 14-17 from topY 11 to 22
        // V: angled lines meeting at (16, 23)
        let isLetter = false;
        // 'T': horizontal bar (x from 8 to 23, topY 10 to 12)
        if (topY >= 10 && topY <= 12 && x >= 8 && x <= 23) isLetter = true;
        // 'T': vertical stem (x 14 to 17, topY 12 to 22)
        if (topY >= 12 && topY <= 22 && x >= 14 && x <= 17) isLetter = true;
        // 'V' accent: angled wings
        if (topY >= 14 && topY <= 23) {
          const vProgress = (topY - 14) / 9; // 0 at 14, 1 at 23
          const leftTarget = 10 + vProgress * 5.5;
          const rightTarget = 21 - vProgress * 5.5;
          if (Math.abs(x - leftTarget) < 1.2 || Math.abs(x - rightTarget) < 1.2) {
            isLetter = true;
          }
        }

        if (isLetter) {
          // Warm champagne gold #F3E5AB (B: 171, G: 229, R: 243)
          icoBuffer.writeUInt8(171, idx);
          icoBuffer.writeUInt8(229, idx + 1);
          icoBuffer.writeUInt8(243, idx + 2);
          icoBuffer.writeUInt8(255, idx + 3);
        } else {
          icoBuffer.writeUInt8(12, idx);
          icoBuffer.writeUInt8(10, idx + 1);
          icoBuffer.writeUInt8(8, idx + 2);
          icoBuffer.writeUInt8(255, idx + 3);
        }
      }
    } else {
      // Outside circle: Transparent
      icoBuffer.writeUInt8(0, idx);
      icoBuffer.writeUInt8(0, idx + 1);
      icoBuffer.writeUInt8(0, idx + 2);
      icoBuffer.writeUInt8(0, idx + 3);
    }
  }
}

// 5. AND mask (1 bit per pixel, 0 = opaque, 1 = transparent)
const andOffset = pixelOffset + xorSize;
for (let y = 0; y < height; y++) {
  const topY = height - 1 - y;
  for (let byteX = 0; byteX < andRowSize; byteX++) {
    let maskByte = 0;
    for (let bit = 0; bit < 8; bit++) {
      const x = byteX * 8 + bit;
      if (x < width) {
        const dx = x - 15.5;
        const dy = topY - 15.5;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 14.5) {
          maskByte |= (1 << (7 - bit)); // Transparent
        }
      }
    }
    icoBuffer.writeUInt8(maskByte, andOffset + y * andRowSize + byteX);
  }
}

// Write favicon.ico to root and public/
const rootIco = path.join(__dirname, 'favicon.ico');
const publicIco = path.join(__dirname, 'public', 'favicon.ico');
fs.writeFileSync(rootIco, icoBuffer);
fs.writeFileSync(publicIco, icoBuffer);
console.log('Created:', rootIco);
console.log('Created:', publicIco);
