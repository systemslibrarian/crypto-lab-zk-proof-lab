import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const challenge = (s: string) => parseInt(digest(s).slice(0, 8), 16) % 50 + 1;
function pow(b: bigint, e: bigint, p: bigint): bigint {
  let n = 1n;
  while (e) {
    if (e & 1n) n = n * b % p;
    b = b * b % p;
    e >>= 1n;
  }
  return n;
}
async function stored(page: Page): Promise<string> {
  return page.evaluate(() => localStorage.getItem('zkpl:last:fiat-shamir')!);
}
async function assertCollision(page: Page): Promise<void> {
  const original = JSON.parse(await stored(page));
  expect(original.message).toBe('proof-note:264d31c8c1645707');
  expect(original.transcript.R).toBe(1206);
  const input = '1206|375|' + original.message;
  expect(digest(input)).not.toBe(digest(input + '-tampered'));
  expect(challenge(input)).toBe(26);
  expect(challenge(input + '-tampered')).toBe(26);
  const left = pow(5n, BigInt(original.transcript.s), 2053n);
  const right = 1206n * pow(375n, 26n, 2053n) % 2053n;
  expect(left).toBe(right);
  await expect(page.locator('#fs-lhs')).toHaveText(String(left));
  await expect(page.locator('#fs-rhs')).toHaveText(String(right));
  await expect(page.locator('#fs-result')).toContainText('Tamper passed — toy challenge collision');
  await expect(page.locator('#fs-result')).toContainText('original c=26, altered c=26');
  await expect(page.locator('#fs-log')).toContainText('verification passed');
  await expect(page.locator('#fs-log')).not.toContainText('verification failed');
  await expect(page.locator('#fs-narration')).toContainText('Tamper check passed');
  await expect(page.locator('#fs-narration')).toContainText('50');
  await expect(page.locator('#fs-narration')).toContainText('not a SHA-256 collision');
  await expect(page.locator('#fs-narration')).not.toContainText('tampering is detected');
  expect(JSON.parse(await stored(page))).toEqual(original);
}

for (const width of [1280, 380, 320]) {
  test('actual seed=3 tamper verdict and narration agree at ' + width + 'px', async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('exhibits/fiat-shamir.html?seed=3');
    await page.click('#fs-run-btn');
    await expect(page.locator('#fs-result')).toContainText('VERIFIED');
    const before = await stored(page);
    await page.click('#fs-tamper-btn');
    await assertCollision(page);
    expect(await stored(page)).toBe(before); // The probe never changes the Copy/Replay proof.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test('automatic collision, reset and next proof do not retain stale tamper claims', async ({ page }) => {
  await page.goto('exhibits/fiat-shamir.html?seed=3&mode=tamper&auto=1');
  await expect(page.locator('#fs-tamper-btn')).toBeEnabled();
  await assertCollision(page);
  await page.click('#fs-reset-btn');
  await expect(page.locator('#fs-result')).toHaveText('Ready.');
  await expect(page.locator('#fs-c')).toHaveText('—');
  await expect(page.locator('#fs-copy-btn')).toBeDisabled();
  await expect(page.locator('#fs-narration')).not.toContainText('Tamper check passed');
  await page.click('#fs-run-btn');
  await expect(page.locator('#fs-result')).toContainText('VERIFIED');
  await expect(page.locator('#fs-result')).not.toContainText('Tamper passed');
});

test('unavailable hash evidence cannot leave a prior verified badge as a tamper result', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('exhibits/fiat-shamir.html?seed=3');
  await page.click('#fs-run-btn');
  await expect(page.locator('#fs-result')).toContainText('VERIFIED');
  const before = await stored(page);
  // Deliberate provider failure after the genuine proof: no fake successful hash or equation.
  await page.evaluate(() => {
    Object.defineProperty(crypto.subtle, 'digest', { value: async () => { throw new Error('fixture: hash unavailable'); } });
  });
  await page.click('#fs-tamper-btn');
  await expect(page.locator('#fs-result')).toContainText('Tamper check unavailable');
  await expect(page.locator('#fs-result')).not.toContainText('VERIFIED');
  await expect(page.locator('#fs-log')).toContainText('verification did not complete');
  await expect(page.locator('#fs-narration')).toContainText('No tamper verdict');
  await expect(page.locator('#fs-run-btn')).toBeEnabled();
  expect(await stored(page)).toBe(before);
  expect(errors).toEqual([]);
});
