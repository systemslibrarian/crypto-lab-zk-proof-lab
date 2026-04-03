// Captures an animated GIF of the Schnorr exhibit via frame-by-frame PNGs
// then assembles with ImageMagick (convert) or ffmpeg
import { chromium } from 'playwright';
import { mkdirSync, readdirSync } from 'fs';
import { execSync } from 'child_process';

const BASE = 'http://localhost:8000';
const FRAMES = 'docs/screenshots/gif-frames';
mkdirSync(FRAMES, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

// Navigate to Schnorr with a seed for reproducibility
await page.goto(`${BASE}/exhibits/schnorr.html?seed=gif-demo`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

// Scroll to the protocol interaction area
await page.evaluate(() => {
  const btn = document.getElementById('s-btn');
  if (btn) btn.scrollIntoView({ block: 'center' });
});
await page.waitForTimeout(300);

let frame = 0;
async function snap() {
  const pad = String(frame).padStart(4, '0');
  await page.screenshot({ path: `${FRAMES}/f${pad}.png`, fullPage: false });
  frame++;
}

// Frame 0: initial state
await snap();

// Run 3 honest rounds with captures between steps
for (let i = 0; i < 3; i++) {
  await page.click('#s-btn');
  await page.waitForTimeout(800);
  await snap();
  await page.waitForTimeout(600);
  await snap();
  await page.waitForTimeout(400);
  await snap();
}

// Run a cheat attempt
await page.click('#s-cheat-btn');
await page.waitForTimeout(800);
await snap();
await page.waitForTimeout(600);
await snap();
await page.waitForTimeout(400);
await snap();

// Final pause frame (duplicate last for dwell)
await snap();
await snap();

await browser.close();
console.log(`✓ ${frame} frames captured`);

// Assemble GIF with ffmpeg (more reliable than ImageMagick in containers)
try {
  execSync(
    `ffmpeg -y -framerate 2 -i ${FRAMES}/f%04d.png -vf "scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer" docs/screenshots/schnorr-demo.gif 2>&1`,
    { stdio: 'pipe' }
  );
  console.log('✓ docs/screenshots/schnorr-demo.gif created');
} catch (e) {
  console.log('ffmpeg not available, trying convert...');
  try {
    execSync(
      `convert -delay 50 -loop 0 ${FRAMES}/f*.png -resize 720x docs/screenshots/schnorr-demo.gif 2>&1`,
      { stdio: 'pipe' }
    );
    console.log('✓ docs/screenshots/schnorr-demo.gif created via convert');
  } catch (e2) {
    console.error('Neither ffmpeg nor convert available. Frames saved in', FRAMES);
  }
}
