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

async function runSchnorrInvariantCheck(page) {
  await page.goto(`${baseUrl}/exhibits/schnorr.html?seed=ci-schnorr&auto=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#s-result');
  await page.waitForFunction(() => {
    const t = document.getElementById('s-result')?.textContent || '';
    return t.includes('VERIFIED') || t.includes('FAILED');
  });
  const lhs = await page.locator('#s-lhs').textContent();
  const rhs = await page.locator('#s-rhs').textContent();
  const verdict = await page.locator('#s-result').textContent();
  assertPass(Boolean(verdict && verdict.includes('VERIFIED')), 'Schnorr seeded scenario verifies');
  assertPass(lhs === rhs, 'Schnorr invariant: g^s equals R·y^c');
}

async function runFiatShamirInvariantCheck(page) {
  await page.goto(`${baseUrl}/exhibits/fiat-shamir.html?seed=ci-fs&auto=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const t = document.getElementById('fs-result')?.textContent || '';
    return t.includes('VERIFIED') || t.includes('FAILED');
  });
  const verified = await page.locator('#fs-result').textContent();
  assertPass(Boolean(verified && verified.includes('VERIFIED')), 'Fiat-Shamir seeded scenario verifies');

  const check = await page.evaluate(async () => {
    const R = Number(document.getElementById('fs-R')?.textContent || 0);
    const message = document.getElementById('fs-msg')?.textContent || '';
    const cText = document.getElementById('fs-c')?.textContent || '';
    const cValue = Number((cText.match(/\d+/) || ['0'])[0]);
    const payload = `${R}|375|${message}`;
    const bytes = new TextEncoder().encode(payload);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(digest)).map(v => v.toString(16).padStart(2, '0')).join('');
    const computed = parseInt(hex.slice(0, 8), 16) % 50 + 1;
    return { computed, cValue };
  });
  assertPass(check.computed === check.cValue, 'Fiat-Shamir invariant: challenge re-derivation matches transcript');
}

async function runCommitInvariantCheck(page) {
  await page.goto(`${baseUrl}/exhibits/commit-reveal.html?seed=ci-commit&mode=reveal&auto=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const a = document.getElementById('ca-verify')?.textContent || '';
    const b = document.getElementById('cb-verify')?.textContent || '';
    return a.includes('matches commitment') && b.includes('matches commitment');
  });

  const hashOk = await page.evaluate(async () => {
    const bidA = document.getElementById('ca-bid')?.textContent || '';
    const nonceA = document.getElementById('ca-nonce')?.textContent || '';
    const hashA = document.getElementById('ca-hash')?.textContent || '';
    const payload = `${bidA}|${nonceA}`;
    const bytes = new TextEncoder().encode(payload);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(digest)).map(v => v.toString(16).padStart(2, '0')).join('');
    return hex === hashA;
  });
  assertPass(hashOk, 'Commit invariant: recomputed SHA-256 equals published commitment');
}

async function runSnarkTamperCheck(page) {
  await page.goto(`${baseUrl}/exhibits/snark.html?seed=ci-snark&mode=tamper&auto=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const t = document.getElementById('snark-result')?.textContent || '';
    return t.includes('accepted') || t.includes('rejected');
  });
  const verdict = await page.locator('#snark-result').textContent();
  assertPass(Boolean(verdict && verdict.includes('rejected')), 'SNARK tamper scenario is rejected');
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

await runSchnorrInvariantCheck(page);
await runFiatShamirInvariantCheck(page);
await runCommitInvariantCheck(page);
await runSnarkTamperCheck(page);

await browser.close();

if (failures > 0) {
  console.error(`\n${failures} browser quality checks failed.`);
  process.exit(1);
}

console.log('\nAll browser quality checks passed.');
