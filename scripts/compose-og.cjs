// Compose the 1200x630 link-preview image: approved artwork + bilingual title (rendered by Chromium for correct Hebrew shaping).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..');
  const base = fs.readFileSync(path.join(root, 'assets/og-base.jpg')).toString('base64');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
  await p.setContent(`<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Rubik:wght@700;800&display=block" rel="stylesheet">
<style>
body{margin:0;width:1200px;height:630px;background:url(data:image/jpeg;base64,${base}) center/cover;font-family:Rubik,sans-serif;overflow:hidden}
.t{position:absolute;left:56px;top:175px;width:520px;display:flex;flex-direction:column;gap:14px}
h1{margin:0;font-size:74px;font-weight:800;color:#fff;letter-spacing:.5px;text-shadow:0 6px 0 #2b8fc4,0 14px 30px rgba(20,60,100,.35)}
.he{font-size:50px;font-weight:800;color:#1f6f9e;direction:rtl;text-align:left}
p{margin:6px 0 0;font-size:26px;font-weight:700;color:#1f4f6e}
</style></head><body><div class="t"><h1>Learn2Brush</h1><div class="he" dir="rtl">לוֹמְדִים לְצַחְצֵחַ</div><p>Brush every tooth till it sparkles!</p></div></body></html>`);
  await p.waitForLoadState('networkidle');
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: path.join(root, 'public/img/og.jpg'), type: 'jpeg', quality: 86 });
  await b.close();
  console.log('og.jpg written');
})();
