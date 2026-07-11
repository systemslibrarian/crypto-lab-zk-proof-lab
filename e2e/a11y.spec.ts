import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Strict WCAG regression gate for the ZK Proof Lab.
 *
 * This is a multi-page static site: a lobby (index.html) plus eight exhibit
 * pages, each an independent HTML document with its own live demo. Every demo
 * injects its result / transcript / attack regions only after a run button is
 * clicked, so for each page we DRIVE every demo (primary `.bp` "run" buttons
 * and danger `.bd` "attack/tamper" buttons), expand any collapsibles, and
 * neutralize motion so mid-flight states can't hide text from axe. Then we scan
 * the whole page with WCAG 2.0/2.1 A + AA rules and assert zero violations, in
 * BOTH the dark (default) and light themes.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Every page reachable in the shipped site (relative to the base URL).
const PAGES = [
  '.',
  'exhibits/cave.html',
  'exhibits/graph-coloring.html',
  'exhibits/schnorr.html',
  'exhibits/commit-reveal.html',
  'exhibits/fiat-shamir.html',
  'exhibits/snark.html',
  'exhibits/transcript-lab.html',
  'exhibits/scenario-presets.html',
];

// Neutralize animation/transition/opacity so mid-flight states (fade-ins,
// spinners) can't hide text from the contrast checker.
async function killMotion(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `*,*::before,*::after{
      animation-duration:0s!important;animation-delay:0s!important;
      transition-duration:0s!important;transition-delay:0s!important;
      opacity:1!important;scroll-behavior:auto!important;
    }`,
  });
}

// Force every collapsible / hidden region into the visible tree so axe scans
// the whole page in one pass.
async function revealAll(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const d of document.querySelectorAll('details')) (d as HTMLDetailsElement).open = true;
    for (const el of document.querySelectorAll<HTMLElement>('[hidden]')) el.removeAttribute('hidden');
    for (const p of document.querySelectorAll<HTMLElement>('[role="tabpanel"],.panel,.tab-panel')) {
      p.classList.add('active');
    }
  });
}

// Drive every live demo on the current page so injected output regions exist
// when axe runs. Primary `.bp` buttons run protocols; danger `.bd` buttons run
// attack/tamper paths (which inject their own result regions). We click each
// enabled one, then also step through any multi-step "step/next" controls.
async function driveDemos(page: Page): Promise<void> {
  const runButtons = page.locator('button.bp:enabled, button.bd:enabled');
  const count = await runButtons.count();
  for (let i = 0; i < count; i++) {
    const btn = runButtons.nth(i);
    if (await btn.isEnabled().catch(() => false)) {
      await btn.click().catch(() => {});
    }
  }

  // Step buttons (Schnorr `#s-step-btn`, etc.) reveal per-step markup; click a
  // few times to walk through all steps.
  const stepBtn = page.locator('#s-step-btn, [id$="-step-btn"]');
  if ((await stepBtn.count()) > 0) {
    for (let i = 0; i < 6; i++) {
      if (await stepBtn.first().isEnabled().catch(() => false)) {
        await stepBtn.first().click().catch(() => {});
      }
    }
  }

  // Transcript lab: load transcripts into both panes then compare so the
  // comparison report region is injected and scanned.
  const compareBtn = page.locator('#compare-btn');
  if ((await compareBtn.count()) > 0) {
    for (const id of ['#left-load-schnorr', '#right-load-commit']) {
      const b = page.locator(id);
      if ((await b.count()) > 0) await b.click().catch(() => {});
    }
    if (await compareBtn.isEnabled().catch(() => false)) {
      await compareBtn.click().catch(() => {});
    }
  }

  // Let any async (Web Crypto / hashing) work settle.
  await page.waitForTimeout(400);
}

async function prepare(page: Page): Promise<void> {
  await killMotion(page);
  await driveDemos(page);
  await killMotion(page);
  await revealAll(page);
  await killMotion(page);
}

async function scan(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 5),
  }));
  expect(summary).toEqual([]);
}

// Switch to the light theme. The lobby (index.html) carries the shared header
// with #cl-theme-toggle; the exhibit pages have no toggle button but honor the
// same html[data-theme='light'] CSS (they read 'theme' from localStorage on
// load), so we flip the attribute directly there.
async function setLightTheme(page: Page): Promise<void> {
  const toggle = page.locator('#cl-theme-toggle');
  if ((await toggle.count()) > 0) {
    await toggle.click();
  } else {
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light');
    });
  }
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
}

for (const path of PAGES) {
  test(`no WCAG A/AA violations (dark) — ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await prepare(page);
    await scan(page);
  });

  test(`no WCAG A/AA violations (light) — ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    await setLightTheme(page);
    await prepare(page);
    await scan(page);
  });
}
