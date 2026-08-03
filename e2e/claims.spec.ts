import { createHash } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Functional claims gate for ZK Proof Lab.
 *
 * The a11y spec clicks every button on every page and looks only at contrast
 * and landmarks. This spec checks the mathematics those buttons print. Nothing
 * here trusts the page's own verdict: the Schnorr and Fiat-Shamir verifier
 * equations are recomputed with BigInt modular arithmetic, the Fiat-Shamir
 * challenge and every SHA-256 commitment are recomputed with Node's crypto
 * from values read back out of the DOM, and every soundness counter
 * ((1/2)^n, (5/6)^n, (1/50)^n) is re-derived from the round count the page
 * itself displays.
 *
 * Every failure path is exercised and required to say why it failed: a cheating
 * Schnorr prover, a tampered Fiat-Shamir message, a bid changed after commit,
 * a bluffing cave prover (on a fixed seed, so the catch is deterministic), and
 * graph-coloring openings altered after their digests were published.
 */

// Toy parameters the exhibits state in their own parameter tables.
const P = 2053n;
const G = 5n;
const ORDER = 2052n; // p - 1

function modpow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

const sha256hex = (input: string): string => createHash('sha256').update(input, 'utf8').digest('hex');

const clean = (value: string | null): string => (value ?? '').replace(/\s+/g, ' ').trim();

async function textOf(page: Page, selector: string): Promise<string> {
  return clean(await page.locator(selector).textContent());
}

async function intOf(page: Page, selector: string): Promise<number> {
  const raw = await textOf(page, selector);
  const value = Number(raw.replace(/[^\d-]/g, ''));
  expect(Number.isFinite(value), `expected an integer in "${raw}" (${selector})`).toBe(true);
  return value;
}

/** Pull the first captured group out of a DOM string. */
function match(text: string, re: RegExp): string {
  const m = text.match(re);
  expect(m, `expected ${re} to match in: ${text}`).not.toBeNull();
  return m![1];
}

async function logLines(page: Page, id: string): Promise<string[]> {
  return (await page.locator(`#${id} div`).allTextContents()).map((line) => clean(line));
}

/** Percentage strings the shared confidence meter renders. */
const confidencePct = (rounds: number, cheatProb: number): string =>
  `${((1 - Math.pow(cheatProb, rounds)) * 100).toFixed(2)}%`;

const cheatPct = (rounds: number, cheatProb: number, digits: number): string =>
  `${(Math.pow(cheatProb, rounds) * 100).toFixed(digits)}%`;

// ---------------------------------------------------------------------------
// Schnorr identification
// ---------------------------------------------------------------------------

interface SchnorrRun {
  r: bigint;
  R: bigint;
  c: bigint;
  s: bigint;
  lhs: bigint;
  rhs: bigint;
  x: bigint;
  y: bigint;
  result: string;
}

async function readSchnorr(page: Page): Promise<SchnorrRun> {
  const read = async (selector: string): Promise<bigint> => BigInt(await intOf(page, selector));
  return {
    r: await read('#s-r'),
    R: await read('#s-R'),
    c: await read('#s-c'),
    s: await read('#s-s'),
    lhs: await read('#s-lhs'),
    rhs: await read('#s-rhs'),
    x: await read('#s-x-val'),
    y: await read('#s-y-val'),
    result: await textOf(page, '#s-result'),
  };
}

/** Recompute the verifier's own equation from the transcript the page printed. */
function checkSchnorrArithmetic(run: SchnorrRun): { verifies: boolean } {
  expect(run.y, 'public key y must be g^x mod p').toBe(modpow(G, run.x, P));
  expect(run.R, 'commitment R must be g^r mod p').toBe(modpow(G, run.r, P));
  expect(run.lhs, 'lhs must be g^s mod p').toBe(modpow(G, run.s, P));
  expect(run.rhs, 'rhs must be R * y^c mod p').toBe((run.R * modpow(run.y, run.c, P)) % P);
  return { verifies: run.lhs === run.rhs };
}

test.describe('Schnorr identification', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('exhibits/schnorr.html');
    await expect(page.locator('#s-btn')).toBeEnabled();
  });

  test('an honest run satisfies the verifier equation the page prints', async ({ page }) => {
    await page.locator('#s-btn').click();
    await expect(page.locator('#s-result')).toContainText('VERIFIED', { timeout: 15_000 });

    const run = await readSchnorr(page);
    // The response really is s = (r + c*x) mod (p-1) — not a value reverse
    // engineered to make the check pass.
    expect(run.s).toBe((run.r + run.c * run.x) % ORDER);
    expect(checkSchnorrArithmetic(run).verifies).toBe(true);
    expect(run.lhs).toBe(run.rhs);
    expect(run.result).toContain('✓ VERIFIED');

    // The confidence meter is 1 - (1/50)^n over accepted runs.
    await expect(page.locator('#s-pct')).toHaveText(confidencePct(1, 1 / 50));
    await page.locator('#s-btn').click();
    await expect(page.locator('#s-pct')).toHaveText(confidencePct(2, 1 / 50), { timeout: 15_000 });

    // What the exhibit stores as "the transcript" is what a verifier sees:
    // (R, c, s) and no nonce.
    const stored = JSON.parse(
      (await page.evaluate(() => localStorage.getItem('zkpl:last:schnorr'))) ?? '{}',
    );
    expect(Object.keys(stored.transcript)).toEqual(['R', 'c', 's', 'lhs', 'rhs', 'verified']);
    expect(stored.transcript).not.toHaveProperty('r');
    expect(stored.transcript.verified).toBe(true);
  });

  test('the secret selector recomputes the public key for every option', async ({ page }) => {
    const options = await page.locator('#s-x-select option').evaluateAll((els) =>
      els.map((el) => (el as HTMLOptionElement).value),
    );
    expect(options.length).toBeGreaterThanOrEqual(3);
    for (const option of options) {
      await page.locator('#s-x-select').selectOption(option);
      const x = BigInt(option);
      await expect(page.locator('#s-x-val')).toHaveText(option);
      await expect(page.locator('#s-prover-x')).toHaveText(option);
      // y = g^x mod p, recomputed here rather than read from a table.
      await expect(page.locator('#s-y-val')).toHaveText(String(modpow(G, x, P)));
    }
  });

  test('a cheating prover is rejected and the log says the equation failed', async ({ page }) => {
    await page.locator('#s-btn').click();
    await expect(page.locator('#s-result')).toContainText('VERIFIED', { timeout: 15_000 });
    const honestPct = await textOf(page, '#s-pct');

    // A cheat guesses s at random, so it fails with probability 2051/2052.
    // Retry a few times so a lucky guess cannot make the suite flaky, but
    // require every single run to agree with its own arithmetic.
    let sawRejection = false;
    for (let attempt = 0; attempt < 6 && !sawRejection; attempt += 1) {
      await page.locator('#s-cheat-btn').click();
      await expect(page.locator('#s-result')).toContainText(/VERIFIED|FAILED/, { timeout: 15_000 });
      const run = await readSchnorr(page);
      const { verifies } = checkSchnorrArithmetic(run);
      if (verifies) {
        expect(run.result).toContain('VERIFIED');
      } else {
        sawRejection = true;
        expect(run.result).toContain('✗ FAILED');
        expect(run.result).toContain(`${run.lhs} ≠ ${run.rhs}`);
        const lines = await logLines(page, 's-log');
        expect(lines.some((line) => /CHEAT: g\^s=.* ≠ R·y\^c=.* → CAUGHT/.test(line))).toBe(true);
      }
    }
    expect(sawRejection, 'six cheat attempts all passed verification').toBe(true);

    // A cheat never advances the verifier's confidence.
    await expect(page.locator('#s-pct')).toHaveText(honestPct);
  });

  test('leaking the nonce recovers the private key from the transcript', async ({ page }) => {
    await page.locator('#s-btn').click();
    await expect(page.locator('#s-result')).toContainText('VERIFIED', { timeout: 15_000 });
    const run = await readSchnorr(page);

    await page.locator('#s-leak-btn').click();
    await expect(page.locator('#s-leak')).toBeVisible();
    const panel = await textOf(page, '#s-leak');

    // The congruence the panel prints is the real one, with the real numbers.
    const residue = ((run.s - run.r) % ORDER + ORDER) % ORDER;
    expect(panel).toContain(`${run.c}·x ≡ (${run.s} − ${run.r}) ≡ ${residue} (mod 2052)`);
    // ...and the x it solves out is the secret the exhibit is holding.
    expect(panel).toContain('Private key recovered');
    const recovered = match(panel, /Private key recovered: x = ([\d\s or]+?)\./)
      .split(' or ')
      .map((value) => value.trim());
    expect(recovered).toContain(String(run.x));
    for (const candidate of recovered) {
      // Every candidate really does satisfy c*x = s - r (mod p-1).
      expect((run.c * BigInt(candidate)) % ORDER).toBe(residue);
    }
    const lines = await logLines(page, 's-log');
    expect(lines.some((line) => line.includes(`LEAKED r=${run.r} → recovered x=`))).toBe(true);
  });

  test('stepping through the protocol reaches the same verified equation', async ({ page }) => {
    await page.locator('#s-reset-btn').click();
    for (let step = 1; step <= 4; step += 1) {
      await page.locator('#s-step-btn').click();
      const label = await textOf(page, '#s-step-btn');
      expect(label).toBe(step >= 4 ? 'Step ▷ (restart)' : `Step ▷ (${step}/4)`);
    }
    await expect(page.locator('#s4')).toBeVisible();
    const run = await readSchnorr(page);
    expect(run.s).toBe((run.r + run.c * run.x) % ORDER);
    expect(checkSchnorrArithmetic(run).verifies).toBe(true);
    expect(run.result).toContain('✓ VERIFIED');
    const lines = await logLines(page, 's-log');
    expect(lines.filter((line) => /^Step [1-4] —/.test(line))).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// Fiat-Shamir
// ---------------------------------------------------------------------------

test.describe('Fiat-Shamir', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('exhibits/fiat-shamir.html');
    await expect(page.locator('#fs-run-btn')).toBeEnabled();
  });

  test('the challenge really is the hash of the transcript', async ({ page }) => {
    await page.locator('#fs-run-btn').click();
    await expect(page.locator('#fs-result')).toContainText('VERIFIED', { timeout: 15_000 });

    const message = await textOf(page, '#fs-msg');
    const R = BigInt(await intOf(page, '#fs-R'));
    const s = BigInt(await intOf(page, '#fs-s'));
    const lhs = BigInt(await intOf(page, '#fs-lhs'));
    const rhs = BigInt(await intOf(page, '#fs-rhs'));
    const shown = await textOf(page, '#fs-c');
    const c = BigInt(match(shown, /^(\d+)/));
    const shownDigestPrefix = match(shown, /hash ([0-9a-f]+)\.\.\./);

    // c = H(R || y || m) mod 50 + 1, recomputed here with Node's SHA-256.
    const y = 375n; // the exhibit's published public key
    const digest = sha256hex(`${R}|${y}|${message}`);
    expect(digest.startsWith(shownDigestPrefix)).toBe(true);
    expect(c).toBe(BigInt((parseInt(digest.slice(0, 8), 16) % 50) + 1));

    // ...and the verifier equation balances on those values.
    expect(lhs).toBe(modpow(G, s, P));
    expect(rhs).toBe((R * modpow(y, c, P)) % P);
    expect(lhs).toBe(rhs);

    const lines = await logLines(page, 'fs-log');
    expect(lines.some((line) => line === `Generated proof with c = H(R||y||m) = ${c}`)).toBe(true);
  });

  test('tampering with the message breaks verification, and the numbers show why', async ({
    page,
  }) => {
    await page.locator('#fs-run-btn').click();
    await expect(page.locator('#fs-result')).toContainText('VERIFIED', { timeout: 15_000 });
    const message = await textOf(page, '#fs-msg');
    const R = BigInt(await intOf(page, '#fs-R'));
    const s = BigInt(await intOf(page, '#fs-s'));
    const originalRhs = BigInt(await intOf(page, '#fs-rhs'));

    await page.locator('#fs-tamper-btn').click();
    await expect(page.locator('#fs-result')).toContainText('Tamper detected', { timeout: 15_000 });

    // The altered message hashes to a different challenge, so the old response
    // no longer satisfies the equation — recompute both sides to prove it.
    const y = 375n;
    const digest = sha256hex(`${R}|${y}|${message}-tampered`);
    const tamperedC = BigInt((parseInt(digest.slice(0, 8), 16) % 50) + 1);
    const expectedRhs = (R * modpow(y, tamperedC, P)) % P;
    const lhs = BigInt(await intOf(page, '#fs-lhs'));
    const rhs = BigInt(await intOf(page, '#fs-rhs'));

    expect(lhs).toBe(modpow(G, s, P)); // unchanged: the response was not touched
    expect(rhs).toBe(expectedRhs);
    expect(rhs).not.toBe(originalRhs);
    expect(lhs).not.toBe(rhs);

    const lines = await logLines(page, 'fs-log');
    expect(
      lines.some((line) =>
        line.includes(`Tamper check with altered message produced c=${tamperedC}`),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Hash commit-reveal
// ---------------------------------------------------------------------------

test.describe('Hash commit-reveal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('exhibits/commit-reveal.html');
    await expect(page.locator('#c-btn-commit')).toBeEnabled();
  });

  test('the published commitments really are SHA-256 of the revealed bids', async ({ page }) => {
    await page.locator('#c-btn-commit').click();
    await expect(page.locator('#ca-hash')).toHaveText(/^[0-9a-f]{64}$/, { timeout: 15_000 });
    await expect(page.locator('#cb-hash')).toHaveText(/^[0-9a-f]{64}$/);

    const hashA = await textOf(page, '#ca-hash');
    const hashB = await textOf(page, '#cb-hash');
    const nonceA = await textOf(page, '#ca-nonce');
    const nonceB = await textOf(page, '#cb-nonce');
    expect(nonceA).toMatch(/^[0-9a-f]{64}$/); // 32 random bytes
    expect(nonceB).toMatch(/^[0-9a-f]{64}$/);
    expect(nonceA).not.toBe(nonceB);
    // Hiding: nothing about the bid is on screen before the reveal.
    await expect(page.locator('#ca-bid')).toHaveText('*** (hidden)');
    await expect(page.locator('#cb-bid')).toHaveText('*** (hidden)');

    await page.locator('#c-btn-reveal').click();
    await expect(page.locator('#ca-verify')).toContainText('matches commitment', { timeout: 15_000 });
    await expect(page.locator('#cb-verify')).toContainText('matches commitment');

    const bidA = Number(match(await textOf(page, '#ca-bid'), /\$(\d+)/));
    const bidB = Number(match(await textOf(page, '#cb-bid'), /\$(\d+)/));
    // The binding check, redone here: the commitment published BEFORE the
    // reveal is exactly SHA-256("$bid|nonce") of what was revealed after.
    expect(sha256hex(`$${bidA}|${nonceA}`)).toBe(hashA);
    expect(sha256hex(`$${bidB}|${nonceB}`)).toBe(hashB);

    // The auction result follows from the two revealed bids.
    const result = await textOf(page, '#commit-result');
    if (bidA === bidB) {
      expect(result).toContain('Tie');
    } else {
      expect(result).toContain(`Bidder ${bidA > bidB ? 'A' : 'B'} wins`);
      expect(result).toContain(`$${Math.max(bidA, bidB)} vs $${Math.min(bidA, bidB)}`);
    }
  });

  test('changing a bid after committing is caught by the published digest', async ({ page }) => {
    await page.locator('#c-btn-commit').click();
    await expect(page.locator('#ca-hash')).toHaveText(/^[0-9a-f]{64}$/, { timeout: 15_000 });
    const publishedHash = await textOf(page, '#ca-hash');
    const nonceA = await textOf(page, '#ca-nonce');

    await page.locator('#c-btn-cheat').click();
    await expect(page.locator('#ca-verify')).toContainText('CAUGHT', { timeout: 15_000 });

    const fakeBid = Number(match(await textOf(page, '#ca-bid'), /\$(\d+) ← changed!/));
    const verify = await textOf(page, '#ca-verify');
    const fakeHash = match(verify, /([0-9a-f]{64})/);
    // The digest shown for the altered bid is the real SHA-256 of it...
    expect(sha256hex(`$${fakeBid}|${nonceA}`)).toBe(fakeHash);
    // ...and it is not the digest published at commit time, which is the whole
    // binding argument.
    expect(fakeHash).not.toBe(publishedHash);
    expect(verify).toContain('✗ CAUGHT — recomputed hash ≠ published commitment');

    const result = await textOf(page, '#commit-result');
    expect(result).toContain('Binding property holds');
    expect(result).toContain(fakeHash.slice(0, 16));
    expect(result).toContain(publishedHash.slice(0, 16));
  });
});

// ---------------------------------------------------------------------------
// Ali Baba cave
// ---------------------------------------------------------------------------

async function caveRound(page: Page): Promise<void> {
  await page.locator('#cave-btn').click();
  await expect(page.locator('#cave-btn')).toBeEnabled({ timeout: 30_000 });
}

test.describe('Ali Baba cave', () => {
  test('each honest round halves the probability a cheater survives', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('exhibits/cave.html');
    await expect(page.locator('#cave-n')).toHaveText('0');
    await expect(page.locator('#cave-cp')).toHaveText('100%');

    for (let round = 1; round <= 3; round += 1) {
      await caveRound(page);
      await expect(page.locator('#cave-status')).toContainText('Exited correct side');
      // n, the confidence meter and the soundness bound must all agree.
      await expect(page.locator('#cave-n')).toHaveText(String(round));
      await expect(page.locator('#cave-cp')).toHaveText(cheatPct(round, 0.5, 4));
      await expect(page.locator('#cave-pct')).toHaveText(confidencePct(round, 0.5));
      const lines = await logLines(page, 'cave-log');
      expect(lines.some((line) => line.startsWith(`R${round}:`) && line.includes('✓ PASS'))).toBe(true);
    }
  });

  test('a bluffing prover is caught, and a caught round never counts', async ({ page }) => {
    test.setTimeout(120_000);
    // Fixed seed so the catch is deterministic rather than a coin flip.
    await page.goto('exhibits/cave.html?seed=bluff-1&mode=bluff');
    await expect(page.locator('#bluff-tog')).toBeChecked();

    await caveRound(page);
    await expect(page.locator('#cave-status')).toContainText('CAUGHT bluffing');
    // Caught means the round is not survived: the counters must not move.
    await expect(page.locator('#cave-n')).toHaveText('0');
    await expect(page.locator('#cave-cp')).toHaveText('100%');
    await expect(page.locator('#cave-pct')).toHaveText('0.00%');
    expect((await logLines(page, 'cave-log')).some((line) => /\[BLUFF\] → ✗ CAUGHT/.test(line))).toBe(
      true,
    );

    // The complementary seed passes, and then the counter does move — so the
    // difference above is the catch, not a dead counter.
    await page.goto('exhibits/cave.html?seed=bluff-2&mode=bluff');
    await caveRound(page);
    await expect(page.locator('#cave-status')).toContainText('Exited correct side');
    await expect(page.locator('#cave-n')).toHaveText('1');
    await expect(page.locator('#cave-cp')).toHaveText(cheatPct(1, 0.5, 4));

    // Over an unseeded bluff run the invariant still holds round by round:
    // n only ever equals the number of PASS lines in the log.
    await page.goto('exhibits/cave.html?mode=bluff');
    for (let i = 0; i < 6; i += 1) {
      await caveRound(page);
      const lines = await logLines(page, 'cave-log');
      const passes = lines.filter((line) => line.includes('✓ PASS')).length;
      const caught = lines.filter((line) => line.includes('✗ CAUGHT')).length;
      expect(passes + caught).toBe(i + 1);
      await expect(page.locator('#cave-n')).toHaveText(String(passes));
      // With no surviving round yet the meter still shows its initial 100%.
      await expect(page.locator('#cave-cp')).toHaveText(
        passes === 0 ? '100%' : cheatPct(passes, 0.5, 4),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Graph 3-coloring + extractor bench
// ---------------------------------------------------------------------------

const NODES = 5;
const EDGE_COUNT = 6;
const ALL_COLORINGS = 3 ** NODES; // 243
const PROPER_COLORINGS = 18; // proper 3-colourings of this graph
const RELABELINGS = 6; // 3! palette permutations

async function graphRound(page: Page): Promise<void> {
  await page.locator('#g-btn-r').click();
  await expect(page.locator('#g-btn-c')).toBeEnabled();
  await page.locator('#g-btn-c').click();
  await expect(page.locator('#g-btn-r')).toBeEnabled();
}

function parseCount(text: string): number {
  return Number(match(text, /^([\d,]+) of/).replace(/,/g, ''));
}

/** "1.02e+39" / "199,998" as rendered by the bench. */
function parseBig(text: string): number {
  return Number(text.replace(/,/g, '').replace(/ hashes$/, ''));
}

test.describe('Graph 3-coloring', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('exhibits/graph-coloring.html');
    await expect(page.locator('#g-btn-r')).toBeEnabled();
  });

  test('each accepted round tightens the (5/6)^n soundness bound', async ({ page }) => {
    await expect(page.locator('#g-n')).toHaveText('0');
    await expect(page.locator('#g-cp')).toHaveText('100%');

    for (let round = 1; round <= 4; round += 1) {
      await graphRound(page);
      await expect(page.locator('#g-n')).toHaveText(String(round));
      await expect(page.locator('#g-cp')).toHaveText(cheatPct(round, 5 / 6, 2));
      await expect(page.locator('#g-pct')).toHaveText(confidencePct(round, 5 / 6));

      const lines = await logLines(page, 'g-log');
      const line = lines.find((entry) => entry.startsWith(`R${round}:`));
      expect(line, `no log line for round ${round}`).toBeTruthy();
      expect(line!).toContain('(openings verified)');
      // The two opened regions must carry DIFFERENT colours — that is the
      // property each round actually checks.
      const [left, right] = match(line!, /→ ([A-Z]{3,4} ≠ [A-Z]{3,4})/).split(' ≠ ');
      expect(left).not.toBe(right);
    }

    // Five committed regions, each a distinct published digest prefix.
    const cells = await page.locator('#g-commit-table tr td:nth-child(2)').allTextContents();
    expect(cells).toHaveLength(NODES);
    for (const cell of cells) expect(clean(cell)).toMatch(/^[0-9a-f]{8}…$/);
    expect(new Set(cells.map(clean)).size).toBe(NODES);
  });

  test('openings altered after commitment are rejected and do not count', async ({ page }) => {
    await graphRound(page);
    await graphRound(page);
    await expect(page.locator('#g-n')).toHaveText('2');
    const soundnessBefore = await textOf(page, '#g-cp');
    const confidenceBefore = await textOf(page, '#g-pct');

    await page.locator('#g-btn-r').click();
    await expect(page.locator('#g-btn-t')).toBeEnabled();
    await page.locator('#g-btn-t').click();
    await expect(page.locator('#g-round-info')).toContainText('Tamper injected');
    await page.locator('#g-btn-c').click();
    await expect(page.locator('#g-btn-r')).toBeEnabled();

    // The rejection names the reason: the opening does not re-hash to the
    // digest that was published before the challenge.
    const lines = await logLines(page, 'g-log');
    expect(
      lines.some((line) => line.includes('commitment opening did not re-hash to published digest')),
    ).toBe(true);

    // Regression: a rejected round is not a round the prover survived, so the
    // exponent under (5/6)^n and the confidence meter must not move. They used
    // to, which meant catching a tamper RAISED the verifier's confidence.
    await expect(page.locator('#g-n')).toHaveText('2');
    await expect(page.locator('#g-cp')).toHaveText(soundnessBefore);
    await expect(page.locator('#g-pct')).toHaveText(confidenceBefore);
    expect(soundnessBefore).toBe(cheatPct(2, 5 / 6, 2));

    // ...and the extractor, which counts accepted rounds independently, agrees.
    await page.locator('#x-btn-recon').click();
    await expect(page.locator('#x-recon-verdict')).toContainText('accepted round');
    const verdict = await textOf(page, '#x-recon-verdict');
    expect(Number(match(verdict, /After (\d+) accepted round/))).toBe(2);
  });

  test('the transcript extractor measures what the transcript leaks', async ({ page }) => {
    // Prior: with no transcript at all, every colouring is possible.
    await expect(page.locator('#x-prior-count')).toHaveText(String(ALL_COLORINGS));
    await expect(page.locator('#x-prior-guess')).toHaveText(
      `${(100 / ALL_COLORINGS).toFixed(2)}%`,
    );

    for (let round = 0; round < 3; round += 1) await graphRound(page);
    await page.locator('#x-btn-recon').click();
    await expect(page.locator('#x-recon-count')).toHaveText(/of 243/);

    const afterThree = parseCount(await textOf(page, '#x-recon-count'));
    expect(afterThree).toBeLessThan(ALL_COLORINGS);
    expect(afterThree).toBeGreaterThanOrEqual(PROPER_COLORINGS);
    // The "best guess" column is 1/|candidates|.
    await expect(page.locator('#x-recon-guess')).toHaveText(`${(100 / afterThree).toFixed(2)}%`);

    const verdict = await textOf(page, '#x-recon-verdict');
    expect(Number(match(verdict, /After (\d+) accepted round/))).toBe(3);
    expect(verdict).toContain(`leaves ${afterThree} colourings possible`);
    expect(verdict).toContain('the true colouring is still in that set');
    expect(verdict).toContain(`${PROPER_COLORINGS} colourings that are proper on all ${EDGE_COUNT} edges`);

    // More accepted rounds can only shrink (never grow) the candidate set, and
    // it can never fall below the statement being proved.
    for (let round = 0; round < 5; round += 1) await graphRound(page);
    await page.locator('#x-btn-recon').click();
    await expect(page.locator('#x-recon-verdict')).toContainText('After 8 accepted round');
    const afterEight = parseCount(await textOf(page, '#x-recon-count'));
    expect(afterEight).toBeLessThanOrEqual(afterThree);
    expect(afterEight).toBeGreaterThanOrEqual(PROPER_COLORINGS);
    await expect(page.locator('#x-recon-guess')).toHaveText(`${(100 / afterEight).toFixed(2)}%`);
  });

  test('the brute-force attack recovers nothing at 16 bytes and everything at 1', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    for (let round = 0; round < 3; round += 1) await graphRound(page);

    await page.locator('#x-btn-brute').click();
    await expect(page.locator('#x-strong-recovered')).not.toHaveText('—', { timeout: 90_000 });
    await expect(page.locator('#x-weak-recovered')).not.toHaveText('—');

    // 16-byte nonce: 3 colours * 256^16 openings, none of them found.
    const strongKeyspace = parseBig(await textOf(page, '#x-strong-keyspace'));
    const strongHashes = parseBig(await textOf(page, '#x-strong-hashes'));
    const strongExpected = parseBig(await textOf(page, '#x-strong-expected'));
    const strongFraction = parseBig(await textOf(page, '#x-strong-fraction'));
    // Printed to three significant figures, so compare as a ratio.
    expect(strongKeyspace / (3 * 256 ** 16)).toBeCloseTo(1, 2);
    expect(strongHashes).toBeGreaterThan(100_000);
    await expect(page.locator('#x-strong-recovered')).toHaveText(`0 of ${NODES}`);
    // The printed statistics are consistent with each other: an average break
    // costs half the keyspace, and the search covered hashes/keyspace of it.
    expect(strongExpected / strongKeyspace).toBeCloseTo(0.5, 2);
    expect(strongFraction / (strongHashes / strongKeyspace)).toBeCloseTo(1, 1);

    // 1-byte nonce: same attacker, same colours, 768 openings — all recovered.
    const weakKeyspace = parseBig(await textOf(page, '#x-weak-keyspace'));
    const weakHashes = parseBig(await textOf(page, '#x-weak-hashes'));
    const weakExpected = parseBig(await textOf(page, '#x-weak-expected'));
    expect(weakKeyspace).toBe(3 * 256);
    expect(weakHashes).toBe(weakKeyspace);
    expect(weakExpected).toBe(weakKeyspace / 2);
    await expect(page.locator('#x-weak-recovered')).toHaveText(`${NODES} of ${NODES}`);
    await expect(page.locator('#x-weak-fraction')).toHaveText('100% (exhausted)');
    // The only thing that changed is the nonce width.
    expect(strongKeyspace / weakKeyspace).toBeGreaterThan(1e30);

    const verdict = await textOf(page, '#x-attack-verdict');
    expect(verdict).toContain('Nothing recovered at 16 bytes');
    expect(verdict).toContain('recovered every colour at 1 byte');

    const lines = await logLines(page, 'x-log');
    expect(lines.some((line) => /16-byte nonce: .* → 0 openings recovered/.test(line))).toBe(true);
    expect(lines.some((line) => new RegExp(`1-byte nonce: .* → ${NODES} openings recovered`).test(line))).toBe(true);

    // Folding the broken commitments into the extractor leaks strictly more
    // than the transcript alone: exactly the 6 relabelings of the colouring.
    const brokenCount = parseCount(await textOf(page, '#x-broken-count'));
    const transcriptCount = parseCount(await textOf(page, '#x-recon-count'));
    expect(brokenCount).toBe(RELABELINGS);
    expect(brokenCount).toBeLessThan(transcriptCount);
    await expect(page.locator('#x-broken-guess')).toHaveText(`${(100 / RELABELINGS).toFixed(2)}%`);
  });
});
