import { chromium } from 'playwright';

const baseUrl = process.env.ZKPL_BASE_URL || 'http://127.0.0.1:8000';
const pages = [
  '/',
  '/exhibits/cave.html',
  '/exhibits/graph-coloring.html',
  '/exhibits/schnorr.html',
  '/exhibits/commit-reveal.html',
  '/exhibits/fiat-shamir.html',
  '/exhibits/snark.html',
  '/exhibits/transcript-lab.html'
];

const trustExpected = new Set([
  '/',
  '/exhibits/cave.html',
  '/exhibits/graph-coloring.html',
  '/exhibits/schnorr.html',
  '/exhibits/commit-reveal.html',
  '/exhibits/fiat-shamir.html',
  '/exhibits/snark.html',
  '/exhibits/transcript-lab.html'
]);

let failures = 0;

function assertPass(ok, message) {
  if (ok) {
    console.log(`PASS: ${message}`);
    return;
  }
  failures += 1;
  console.error(`FAIL: ${message}`);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await context.newPage();

for (const route of pages) {
  const url = `${baseUrl}${route}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  const title = await page.title();
  assertPass(Boolean(title.trim()), `${route} has non-empty title`);

  const viewportMeta = await page.locator('meta[name="viewport"]').count();
  assertPass(viewportMeta > 0, `${route} has viewport meta`);

  const onclickAttrs = await page.locator('[onclick]').count();
  assertPass(onclickAttrs === 0, `${route} has no inline onclick handlers`);

  if (trustExpected.has(route)) {
    const trustBanners = await page.locator('.trust-banner').count();
    assertPass(trustBanners > 0, `${route} contains trust messaging`);
  }

  const focusVisibleSelectors = await page.evaluate(async () => {
    const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
    let css = '';
    for (const link of links) {
      const href = link.getAttribute('href');
      if (!href) {
        continue;
      }
      const abs = new URL(href, window.location.href).toString();
      const content = await fetch(abs).then(r => r.text());
      css += content + '\n';
    }
    return css.includes(':focus-visible');
  });
  assertPass(focusVisibleSelectors, `${route} stylesheet includes focus-visible accessibility styles`);
}

await browser.close();

if (failures > 0) {
  console.error(`\n${failures} browser quality checks failed.`);
  process.exit(1);
}

console.log('\nAll browser quality checks passed.');
