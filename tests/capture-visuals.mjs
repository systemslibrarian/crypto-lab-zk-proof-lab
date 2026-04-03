import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, devices } from 'playwright';

const baseUrl = process.env.ZKPL_BASE_URL || 'http://127.0.0.1:8000';
const outDir = path.resolve(process.cwd(), 'artifacts', 'screenshots');

const targets = [
  { route: '/', name: 'lobby' },
  { route: '/exhibits/cave.html', name: 'exhibit-01-cave' },
  { route: '/exhibits/graph-coloring.html', name: 'exhibit-02-graph' },
  { route: '/exhibits/schnorr.html', name: 'exhibit-03-schnorr' },
  { route: '/exhibits/commit-reveal.html', name: 'exhibit-04-commit' },
  { route: '/exhibits/fiat-shamir.html', name: 'exhibit-05-fiat-shamir' },
  { route: '/exhibits/snark.html', name: 'exhibit-06-snark' },
  { route: '/exhibits/transcript-lab.html', name: 'transcript-lab' }
];

await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const desktop = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const mobile = await browser.newContext(devices['Pixel 7']);

for (const target of targets) {
  const desktopPage = await desktop.newPage();
  await desktopPage.goto(`${baseUrl}${target.route}`, { waitUntil: 'networkidle' });
  await desktopPage.screenshot({ path: path.join(outDir, `${target.name}-desktop.png`), fullPage: true });
  await desktopPage.close();

  const mobilePage = await mobile.newPage();
  await mobilePage.goto(`${baseUrl}${target.route}`, { waitUntil: 'networkidle' });
  await mobilePage.screenshot({ path: path.join(outDir, `${target.name}-mobile.png`), fullPage: true });
  await mobilePage.close();

  console.log(`Captured ${target.name}`);
}

await desktop.close();
await mobile.close();
await browser.close();

console.log(`Screenshots stored in ${outDir}`);
