// Rasterise public/icons/icon.svg (or an approved PNG) into PWA icon sizes using the preinstalled Playwright Chromium.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..');
  const src = process.argv[2] || path.join(root, 'public/icons/icon.svg');
  const data = fs.readFileSync(src);
  const mime = src.endsWith('.svg') ? 'image/svg+xml' : src.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const url = `data:${mime};base64,${data.toString('base64')}`;
  const b = await chromium.launch();
  const p = await b.newPage();
  const out = [
    ['icon-192.png', 192, 0, false], ['icon-512.png', 512, 0, false], ['apple-touch-icon.png', 180, 0, true],
    ['icon-maskable-512.png', 512, 0.12, true],
  ];
  for (const [name, size, pad, opaque] of out) {
    await p.setViewportSize({ width: size, height: size });
    const inner = Math.round(size * (1 - pad * 2));
    await p.setContent(`<html><body style="margin:0;background:${opaque ? '#7fd3e8' : 'transparent'};display:grid;place-items:center;width:${size}px;height:${size}px"><img src="${url}" style="width:${inner}px;height:${inner}px;${pad ? '' : ''}"></body></html>`);
    await p.waitForTimeout(100);
    await p.screenshot({ path: path.join(root, 'public/icons', name), omitBackground: !opaque });
  }
  await b.close();
  console.log('icons written');
})();
