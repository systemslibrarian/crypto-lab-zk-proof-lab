// Captures key screenshots for README embedding
import { chromium } from 'playwright';

const BASE = 'http://localhost:8000';
const DIR = 'docs/screenshots';

const shots = [
  { name: 'lobby', url: '/', clip: null },
  { name: 'cave', url: '/exhibits/cave.html?seed=demo&auto=1', wait: 4000 },
  { name: 'schnorr', url: '/exhibits/schnorr.html?seed=demo&auto=1', wait: 3000 },
  { name: 'graph', url: '/exhibits/graph-coloring.html?seed=demo&auto=1', wait: 4000 },
  { name: 'commit', url: '/exhibits/commit-reveal.html?seed=demo&auto=1', wait: 4000 },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });

for (const s of shots) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}${s.url}`, { waitUntil: 'networkidle' });
  if (s.wait) await page.waitForTimeout(s.wait);
  await page.screenshot({ path: `${DIR}/${s.name}.png`, fullPage: false });
  console.log(`✓ ${s.name}.png`);
  await page.close();
}

await browser.close();
console.log('Done.');
