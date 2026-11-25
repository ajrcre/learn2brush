// Render every item (or a filtered set) on the 3D brush for the review page.
// usage: node scripts/render-items.cjs <outDir> [idPrefixFilter] [--frames]
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [out, filter = '', framesFlag] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1000, height: 620 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto((process.env.URL || 'http://localhost:5173/') + '?review&unlockall&q=high');
  await p.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  await p.locator('.big.play').click({ force: true });
  await p.waitForTimeout(1500);
  await p.addStyleTag({ content: '.overlay{display:none!important}' });
  const items = await p.evaluate(() => {
    const st = window.__store.getState();
    return null;
  });
  void items;
  // catalogue comes from the page bundle via the store's item list
  const list = await p.evaluate((filter) => {
    // the Customizer is unmounted (hidden); read catalogue from a global set below
    return window.__catalog.filter(i => ['handle', 'shape', 'paste', 'bristles'].includes(i.cat) && i.id.startsWith(filter)).map(i => ({ id: i.id, cat: i.cat }));
  }, filter);
  const combos = [
    { id: 'combo_sword_flames', o: { shape: 'shape_sword', handle: 'handle_flames' } },
    { id: 'combo_shark_zebra', o: { shape: 'shape_shark', handle: 'handle_zebra' } },
    { id: 'combo_blocky_pixelgrass', o: { shape: 'shape_blocky', handle: 'handle_pixelgrass', paste: 'paste_pixel' } },
    { id: 'combo_unicorn_pinkglitter', o: { shape: 'shape_unicorn', handle: 'handle_pinkglitter', paste: 'paste_unicorn' } },
    { id: 'combo_rocket_electric', o: { shape: 'shape_rocket', handle: 'handle_galaxy', brushType: 'type_electric' } },
    { id: 'combo_dino_tiger', o: { shape: 'shape_dino', handle: 'handle_tiger' } },
  ];
  const jobs = [...list.map(i => ({ id: i.id, o: { [i.cat]: i.id }, paste: i.cat === 'paste' })), ...(filter ? [] : combos.map(c => ({ ...c, paste: !!c.o.paste })))];
  for (const j of jobs) {
    // toothpaste and bristles get a close-up of the head (toothpaste-step camera, tube hidden)
    const closeUp = j.id.startsWith('paste_') || j.id.startsWith('bristles_');
    await p.evaluate(({ o, paste, closeUp }) => {
      const g = window.__game;
      const l = window.__looks(window.__store.getState().profile, o);
      g.setPhase(closeUp ? 'paste' : 'customize');
      g.setBrushLook(l.brush); g.setPasteLook(l.paste);
      if (closeUp) { g.paste.remaining = 1; g.paste.setAmount(0.7); g.paste.mesh.visible = true; g.tube.group.visible = false; }
      else g.setShowcasePaste(paste);
    }, { ...j, closeUp });
    await p.waitForTimeout(closeUp ? 2600 : 1600);
    if (closeUp) {
      const c = await p.evaluate(() => { const g = window.__game; const v = g.brush.head.getWorldPosition(g.brush.group.position.clone()); return g.toScreen(v); });
      await p.screenshot({ path: `${out}/${j.id}.jpg`, quality: 85, clip: { x: Math.max(0, Math.min(1000 - 520, c.x - 260)), y: Math.max(0, Math.min(620 - 380, c.y - 200)), width: 520, height: 380 } });
    } else {
      await p.screenshot({ path: `${out}/${j.id}.jpg`, quality: 85 });
    }
    if (framesFlag) {
      await p.waitForTimeout(400);
      await p.screenshot({ path: `${out}/${j.id}_b.jpg`, quality: 85 });
    }
    process.stdout.write('.');
  }
  console.log('\n' + jobs.length + ' renders', errs.slice(0, 5));
  await b.close();
})();
