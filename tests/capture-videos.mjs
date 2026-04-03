import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.ZKPL_BASE_URL || 'http://127.0.0.1:8000';
const outDir = path.resolve(process.cwd(), 'artifacts', 'videos');
await fs.mkdir(outDir, { recursive: true });

const scenarios = [
  { route: '/exhibits/cave.html?seed=ci-video&auto=1', name: 'cave-honest' },
  { route: '/exhibits/schnorr.html?seed=ci-video&auto=1', name: 'schnorr-honest' },
  { route: '/exhibits/commit-reveal.html?seed=ci-video&mode=reveal&auto=1', name: 'commit-reveal-honest' },
  { route: '/exhibits/fiat-shamir.html?seed=ci-video&mode=tamper&auto=1', name: 'fiat-shamir-tamper' },
  { route: '/exhibits/snark.html?seed=ci-video&mode=tamper&auto=1', name: 'snark-tamper' }
];

const browser = await chromium.launch({ headless: true });

for (const scenario of scenarios) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: outDir, size: { width: 1280, height: 720 } }
  });

  const page = await context.newPage();
  const video = page.video();
  await page.goto(`${baseUrl}${scenario.route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);
  await page.close();

  const videoTemp = await video.path();
  await context.close();
  await fs.rename(videoTemp, path.join(outDir, `${scenario.name}.webm`));
  console.log(`Captured ${scenario.name}.webm`);
}

await browser.close();
console.log(`Video captures stored in ${outDir}`);
