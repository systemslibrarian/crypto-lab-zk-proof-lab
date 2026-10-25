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

const RFC3526_GROUP14_P = BigInt(
  '0x' +
  'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1' +
  '29024E088A67CC74020BBEA63B139B22514A08798E3404DD' +
  'EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245' +
  'E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
  'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3D' +
  'C2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F' +
  '83655D23DCA3AD961C62F356208552BB9ED529077096966D' +
  '670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B' +
  'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9' +
  'DE2BCBF6955817183995497CEA956AE515D2261898FA0510' +
  '15728E5A8AACAA68FFFFFFFFFFFFFFFF',
);

const mod = (value: bigint, modulus: bigint): bigint =>
  ((value % modulus) + modulus) % modulus;

function gcdBig(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

function inverseBig(value: bigint, modulus: bigint): bigint {
  let oldR = mod(value, modulus);
  let r = modulus;
  let oldS = 1n;
  let s = 0n;
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  expect(oldR, 'value must have a modular inverse').toBe(1n);
  return mod(oldS, modulus);
}

async function dataBig(page: Page, selector: string): Promise<bigint> {
  const raw = await page.locator(selector).getAttribute('data-value');
  expect(raw, `${selector} must expose its full computed integer`).toMatch(/^-?\d+$/);
  return BigInt(raw!);
}

function independentH(seed: string, p: bigint): bigint {
  const blocks: Buffer[] = [];
  let length = 0;
  for (let counter = 0; length < 264; counter += 1) {
    const suffix = Buffer.alloc(4);
    suffix.writeUInt32BE(counter);
    const block = createHash('sha256').update(seed, 'utf8').update(suffix).digest();
    blocks.push(block);
    length += block.length;
  }
  const expanded = BigInt(`0x${Buffer.concat(blocks).subarray(0, 264).toString('hex')}`);
  return modpow(expanded % p, 2n, p);
}

function toyTranscriptSupport(
  witness: { alpha: bigint; beta: bigint },
  adaptive: boolean,
): string[] {
  const p = 47n;
  const q = 23n;
  const g = 4n;
  const h = 9n;
  const u = modpow(g, witness.alpha, p) * modpow(h, witness.beta, p) % p;
  const out: string[] = [];
  for (let alphaT = 0n; alphaT < q; alphaT += 1n) {
    for (let betaT = 0n; betaT < q; betaT += 1n) {
      const uT = modpow(g, alphaT, p) * modpow(h, betaT, p) % p;
      const challenges = adaptive
        ? [uT % q]
        : Array.from({ length: Number(q) }, (_, index) => BigInt(index));
      for (const c of challenges) {
        out.push(`${u}:${uT}:${c}:${mod(alphaT + witness.alpha * c, q)}:${mod(betaT + witness.beta * c, q)}`);
      }
    }
  }
  return out.sort();
}

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
// Exhibit 07: Okamoto representations and Guillou–Quisquater RSA roots
// ---------------------------------------------------------------------------

test.describe('Beyond Schnorr: computed claims', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('exhibits/sigma-family.html');
    await expect(page.locator('#ok-run')).toBeEnabled({ timeout: 20_000 });
  });

  test('the RFC group, deterministic h, and Okamoto verifier equation are independently recomputed', async ({ page }) => {
    const claimIds = await page.locator('[data-claim]').evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLElement).dataset.claim),
    );
    expect(claimIds).toEqual([
      'special-soundness-intro',
      'okamoto-statement',
      'h-derivation',
      'okamoto-witness-scope',
      'okamoto-active-security',
      'gq-statement',
      'gq-small-e-negative',
    ]);

    const p = await dataBig(page, '#ok-p');
    const q = await dataBig(page, '#ok-q');
    const g = BigInt(await textOf(page, '#ok-g'));
    const h = await dataBig(page, '#ok-h');
    const seed = await textOf(page, '#ok-seed');
    expect(p).toBe(RFC3526_GROUP14_P);
    expect(q).toBe((p - 1n) / 2n);
    expect(p.toString(2)).toHaveLength(2048);
    expect(g).toBe(4n);
    expect(modpow(g, q, p)).toBe(1n);
    expect(h).toBe(independentH(seed, p));
    expect(h).not.toBe(1n);
    expect(modpow(h, q, p)).toBe(1n);

    await page.locator('#ok-run').click();
    await expect(page.locator('#ok-verdict')).toHaveAttribute('data-state', 'pass');
    const u = await dataBig(page, '#ok-u');
    const uT = await dataBig(page, '#ok-ut');
    const c = await dataBig(page, '#ok-c');
    const zAlpha = await dataBig(page, '#ok-za');
    const zBeta = await dataBig(page, '#ok-zb');
    const shownLhs = await dataBig(page, '#ok-lhs');
    const shownRhs = await dataBig(page, '#ok-rhs');
    const lhs = modpow(g, zAlpha, p) * modpow(h, zBeta, p) % p;
    const rhs = uT * modpow(u, c, p) % p;
    expect(shownLhs).toBe(lhs);
    expect(shownRhs).toBe(rhs);
    expect(lhs).toBe(rhs);
    expect(modpow(u, q, p)).toBe(1n);
    expect(modpow(uT, q, p)).toBe(1n);
    await expect(page.locator('#ok-verdict')).toContainText('PROOF ACCEPTED');
  });

  test('Okamoto rewind and both witness-independence experiments expose their complete arithmetic', async ({ page }) => {
    test.setTimeout(120_000);
    await page.locator('#ok-run').click();
    await expect(page.locator('#ok-verdict')).toHaveAttribute('data-state', 'pass');
    const p = await dataBig(page, '#ok-p');
    const q = await dataBig(page, '#ok-q');
    const g = BigInt(await textOf(page, '#ok-g'));
    const h = await dataBig(page, '#ok-h');
    const u = await dataBig(page, '#ok-u');
    const c = await dataBig(page, '#ok-c');
    const zAlpha = await dataBig(page, '#ok-za');
    const zBeta = await dataBig(page, '#ok-zb');

    await page.locator('#ok-rewind').click();
    await expect(page.locator('#ok-extract-verdict')).toHaveAttribute('data-state', 'alarm');
    const c2 = await dataBig(page, '#ok-c2');
    const zAlpha2 = await dataBig(page, '#ok-za2');
    const zBeta2 = await dataBig(page, '#ok-zb2');
    const alphaHat = await dataBig(page, '#ok-alpha-hat');
    const betaHat = await dataBig(page, '#ok-beta-hat');
    const reconstructed = await dataBig(page, '#ok-reconstructed');
    expect(c2).not.toBe(c);
    const invDelta = inverseBig(c - c2, q);
    expect(alphaHat).toBe(mod((zAlpha - zAlpha2) * invDelta, q));
    expect(betaHat).toBe(mod((zBeta - zBeta2) * invDelta, q));
    expect(reconstructed).toBe(modpow(g, alphaHat, p) * modpow(h, betaHat, p) % p);
    expect(reconstructed).toBe(u);
    await expect(page.locator('#ok-extract-verdict')).toContainText('protocol working as designed: special soundness');

    await page.locator('#toy-enumerate').click();
    await expect(page.locator('#toy-equality-verdict')).toHaveAttribute('data-state', 'pass');
    const registered = toyTranscriptSupport({ alpha: 5n, beta: 7n }, false);
    const alternate = toyTranscriptSupport({ alpha: 9n, beta: 8n }, false);
    expect(registered).toHaveLength(23 * 23 * 23);
    expect(alternate).toHaveLength(23 * 23 * 23);
    expect(createHash('sha256').update(registered.join('|')).digest('hex')).toBe(
      createHash('sha256').update(alternate.join('|')).digest('hex'),
    );
    expect(await intOf(page, '#toy-nonces-a')).toBe(23 * 23);
    expect(await intOf(page, '#toy-challenges-a')).toBe(23);
    expect(await intOf(page, '#toy-count-a')).toBe(23 * 23 * 23);
    expect(await intOf(page, '#toy-count-b')).toBe(23 * 23 * 23);

    const fixedA = `${mod(3n + 5n, 23n)}:${mod(8n + 7n, 23n)}`;
    const fixedB = `${mod(3n + 9n, 23n)}:${mod(8n + 8n, 23n)}`;
    expect(fixedA).not.toBe(fixedB);
    await expect(page.locator('#toy-equality-verdict')).toContainText('fixed-nonce control is unequal');

    await page.locator('label[for="toy-adaptive"]').click();
    await expect(page.locator('#toy-equality-verdict')).toHaveAttribute('data-state', 'pending');
    await page.locator('#toy-enumerate').click();
    const adaptiveA = toyTranscriptSupport({ alpha: 5n, beta: 7n }, true);
    const adaptiveB = toyTranscriptSupport({ alpha: 9n, beta: 8n }, true);
    expect(adaptiveA).toHaveLength(23 * 23);
    expect(createHash('sha256').update(adaptiveA.join('|')).digest('hex')).toBe(
      createHash('sha256').update(adaptiveB.join('|')).digest('hex'),
    );
    expect(await intOf(page, '#toy-challenges-a')).toBe(1);
    expect(await intOf(page, '#toy-count-a')).toBe(23 * 23);

    const dlog = BigInt(await textOf(page, '#toy-dlog'));
    expect(dlog).toBe(mod((5n - 9n) * inverseBig(8n - 7n, 23n), 23n));
    expect(BigInt(await textOf(page, '#toy-dlog-check'))).toBe(modpow(4n, dlog, 47n));
    expect(BigInt(await textOf(page, '#toy-dlog-check'))).toBe(9n);
    expect(await textOf(page, '#toy-second-lhs')).toBe(await textOf(page, '#toy-second-rhs'));
    await expect(page.locator('[data-claim="okamoto-witness-scope"]')).toContainText(
      'proves knowledge of a representation of u, not of the registered one',
    );
  });

  test('GQ verification, Shamir extraction, 65537 counter, and retirement all follow printed values', async ({ page }) => {
    test.setTimeout(300_000);
    await page.locator('#gq-run').click();
    await expect(page.locator('#gq-verdict')).toHaveAttribute('data-state', 'pass', { timeout: 120_000 });
    const e = BigInt(await page.locator('#gq-e').inputValue());
    const N = await dataBig(page, '#gq-n');
    const y = await dataBig(page, '#gq-y');
    const yT = await dataBig(page, '#gq-yt');
    const c = await dataBig(page, '#gq-c');
    const xZ = await dataBig(page, '#gq-xz');
    const shownLhs = await dataBig(page, '#gq-lhs');
    const shownRhs = await dataBig(page, '#gq-rhs');
    expect(e).toBe(65537n);
    expect(N.toString(2)).toHaveLength(2048);
    expect(gcdBig(y, N)).toBe(1n);
    expect(gcdBig(yT, N)).toBe(1n);
    expect(gcdBig(xZ, N)).toBe(1n);
    expect(shownLhs).toBe(modpow(xZ, e, N));
    expect(shownRhs).toBe(yT * modpow(y, c, N) % N);
    expect(shownLhs).toBe(shownRhs);

    await page.locator('#gq-rewind').click();
    await expect(page.locator('#gq-extract-verdict')).toHaveAttribute('data-state', 'alarm');
    const c2 = await dataBig(page, '#gq-c2');
    const deltaC = await dataBig(page, '#gq-dc');
    const s = await dataBig(page, '#gq-s');
    const t = await dataBig(page, '#gq-t');
    const root = await dataBig(page, '#gq-root');
    const rootCheck = await dataBig(page, '#gq-root-check');
    expect(deltaC).toBe(c - c2);
    expect(e * s + deltaC * t).toBe(1n);
    expect(rootCheck).toBe(modpow(root, e, N));
    expect(rootCheck).toBe(y);

    await page.locator('#gq-cheat').click();
    await expect(page.locator('#gq-cheat-verdict')).not.toHaveAttribute('data-state', 'busy', { timeout: 120_000 });
    expect(await intOf(page, '#gq-cheat-attempts')).toBe(1000);
    const acceptances = await intOf(page, '#gq-cheat-accepts');
    expect(acceptances).toBeGreaterThanOrEqual(0);
    expect(acceptances).toBeLessThanOrEqual(1000);
    await expect(page.locator('#gq-cheat-verdict')).toContainText(`${acceptances} of 1,000`);
    await expect(page.locator('#gq-cheat-verdict')).toContainText('1,000/65,537');

    const before = await page.locator('#gq-y').getAttribute('data-value');
    await page.locator('#gq-e').selectOption('65537');
    await page.locator('#gq-e').dispatchEvent('change');
    await expect(page.locator('#gq-verdict')).toHaveAttribute('data-state', 'pass');
    expect(await page.locator('#gq-y').getAttribute('data-value')).toBe(before);

    await page.locator('#gq-e').selectOption('3');
    await expect(page.locator('#gq-broken-warning')).toBeVisible();
    await expect(page.locator('#gq-verdict')).toHaveAttribute('data-state', 'pending');
    await expect(page.locator('#gq-extract-verdict')).toHaveAttribute('data-state', 'pending');
    await expect(page.locator('#gq-cheat-verdict')).toHaveAttribute('data-state', 'pending');
    await expect(page.locator('#gq-y')).toHaveAttribute('data-value', '');
    await expect(page.locator('#gq-retired')).toContainText('every prior GQ verdict were retired');
    await page.locator('#gq-e').selectOption('65537');
    await expect(page.locator('#gq-broken-warning')).toBeHidden();
  });

  test('the e=3 evidence fixture accepts a well-formed proof from a prover with no root', async ({ page }) => {
    test.setTimeout(300_000);
    await page.locator('#gq-e').selectOption('3');
    await expect(page.locator('#gq-broken-warning')).toBeVisible();
    await page.locator('#gq-run').click();
    await expect(page.locator('#gq-verdict')).toHaveAttribute('data-state', 'pass', { timeout: 180_000 });
    await page.locator('#gq-rewind').click();
    await expect(page.locator('#gq-extract-verdict')).toHaveAttribute('data-state', 'alarm');
    await page.locator('#gq-cheat').click();
    await expect(page.locator('#gq-cheat-verdict')).toHaveAttribute('data-state', 'alarm', { timeout: 120_000 });

    const N = await dataBig(page, '#gq-n');
    const y = await dataBig(page, '#gq-y');
    const yT = await dataBig(page, '#gq-cheat-yt');
    const xZ = await dataBig(page, '#gq-cheat-xz');
    const e = BigInt(await page.locator('#gq-e').inputValue());
    const guessed = BigInt(await textOf(page, '#gq-cheat-guess'));
    const challenge = BigInt(await textOf(page, '#gq-cheat-c'));
    const lhs = await dataBig(page, '#gq-cheat-lhs');
    const rhs = await dataBig(page, '#gq-cheat-rhs');
    expect(e).toBe(3n);
    expect(await intOf(page, '#gq-cheat-attempts')).toBeGreaterThanOrEqual(1);
    expect(await intOf(page, '#gq-cheat-accepts')).toBe(1);
    expect(guessed).toBeGreaterThanOrEqual(0n);
    expect(guessed).toBeLessThan(e);
    expect(challenge).toBe(guessed);
    expect(gcdBig(y, N)).toBe(1n);
    expect(gcdBig(yT, N)).toBe(1n);
    expect(gcdBig(xZ, N)).toBe(1n);
    expect(lhs).toBe(modpow(xZ, e, N));
    expect(rhs).toBe(yT * modpow(y, challenge, N) % N);
    expect(lhs).toBe(rhs);
    await expect(page.locator('#gq-cheat-checks')).toHaveText(
      'Verifier equation: holds · group membership: all public values are well-formed in Z*_N.',
    );
    await expect(page.locator('#gq-cheat-verdict')).toHaveText(
      '⚠ PROOF ACCEPTED — AND THE PROVER HOLDS NO ROOT',
    );
    await expect(page.locator('#gq-negative-claim')).toContainText(
      'With a small exponent e, an accepted GQ proof does not show the prover knows an e-th root: a cheater who holds only y passes about one time in e.',
    );
    expect(await page.locator('[data-verdict^="gq-"]').evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLElement).dataset.state),
    )).toEqual(['pass', 'alarm', 'alarm']);
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

  test('a fixed noncolliding tampered message breaks verification, and the numbers show why', async ({
    page,
  }) => {
    // The 50-value challenge domain can collide. Select the independently checked
    // rejection fixture, while tamper-collision.spec.ts covers the genuine pass.
    await page.goto('exhibits/fiat-shamir.html?seed=ci-fs');
    await page.locator('#fs-run-btn').click();
    await expect(page.locator('#fs-result')).toContainText('VERIFIED', { timeout: 15_000 });
    const message = await textOf(page, '#fs-msg');
    const R = BigInt(await intOf(page, '#fs-R'));
    const s = BigInt(await intOf(page, '#fs-s'));
    const originalRhs = BigInt(await intOf(page, '#fs-rhs'));
    const originalC = BigInt(match(await textOf(page, '#fs-c'), /^(\d+)/));
    const independentlyAlteredC = BigInt((parseInt(sha256hex(`${R}|375|${message}-tampered`).slice(0, 8), 16) % 50) + 1);
    expect(originalC).toBe(46n);
    expect(independentlyAlteredC).toBe(32n);
    expect(independentlyAlteredC).not.toBe(originalC);

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
    expect(weakExpected).toBe(weakKeyspace / 2);
    await expect(page.locator('#x-weak-recovered')).toHaveText(`${NODES} of ${NODES}`);
    // `bruteForceOpenings` stops the moment every digest has been matched, so
    // how many hashes that took depends on where the prover's five random
    // one-byte nonces happened to fall. Asserting the full 768 assumed the
    // search always runs to exhaustion, which it does not: when all five nonces
    // land inside the first chunk the loop exits at 501, and this test failed
    // about one run in eight. What the weakened control actually guarantees is
    // that the attacker recovers everything (asserted above) without ever
    // exceeding the keyspace — assert that instead of a number that is a
    // property of the nonces rather than of the attack.
    expect(weakHashes).toBeGreaterThan(0);
    expect(weakHashes).toBeLessThanOrEqual(weakKeyspace);
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

// ---------------------------------------------------------------------------
// Exhibit 08: sum-check and the GKR layer walk
// ---------------------------------------------------------------------------

type Term = { coefficient: bigint; exponents: number[] };

/** Independent parser for the exhibit's canonical form: terms joined by " + ", factors joined by "*". */
function parseTerms(text: string, variables: number): Term[] {
  return text.split(' + ').map((term) => {
    const exponents = new Array(variables).fill(0);
    let coefficient = 1n;
    for (const factor of term.split('*')) {
      const variable = factor.match(/^x(\d+)(?:\^(\d+))?$/);
      if (variable) exponents[Number(variable[1]) - 1] += variable[2] ? Number(variable[2]) : 1;
      else coefficient *= BigInt(factor);
    }
    return { coefficient, exponents };
  });
}

function evalTerms(terms: Term[], point: bigint[], p: bigint): bigint {
  let total = 0n;
  for (const term of terms) {
    let value = term.coefficient % p;
    term.exponents.forEach((exponent, index) => { value = (value * modpow(point[index], BigInt(exponent), p)) % p; });
    total = (total + value) % p;
  }
  return total;
}

/** Σ over every Boolean suffix of g(prefix, t, suffix): the honest round message evaluated at t. */
function honestPartial(terms: Term[], prefix: bigint[], t: bigint, variables: number, p: bigint): bigint {
  const free = variables - prefix.length - 1;
  let total = 0n;
  for (let label = 0; label < 1 << free; label += 1) {
    const suffix = Array.from({ length: free }, (_, i) => BigInt((label >> (free - 1 - i)) & 1));
    total = (total + evalTerms(terms, [...prefix, t, ...suffix], p)) % p;
  }
  return total;
}

const horner = (coefficients: bigint[], x: bigint, p: bigint): bigint =>
  coefficients.reduceRight((acc, coefficient) => (acc * x + coefficient) % p, 0n);

const bigList = (value: string | null): bigint[] => (value ?? '').split(',').filter(Boolean).map((entry) => BigInt(entry));

/** Multilinear extension of a 4-entry table at a 2-coordinate point, written out term by term. */
function mle2(table: bigint[], [a, b]: bigint[], p: bigint): bigint {
  const na = (1n - a + p) % p;
  const nb = (1n - b + p) % p;
  return (table[0] * na % p * nb + table[1] * na % p * b + table[2] * a % p * nb + table[3] * a % p * b) % p;
}

/** χ_w at a point for a label w of `bits` bits, most significant first. */
function chi(label: number, bits: number, point: bigint[], p: bigint): bigint {
  let value = 1n;
  for (let i = 0; i < bits; i += 1) {
    const bit = (label >> (bits - 1 - i)) & 1;
    value = (value * (bit ? point[i] : (1n - point[i] + p) % p)) % p;
  }
  return value;
}

// The walkthrough circuit as the page states it: (gate, in1, in2) triples per predicate.
const WIRING: Record<string, Array<[number, number, number]>> = {
  add_0: [[1, 2, 3]], mult_0: [[0, 0, 1]], add_1: [[0, 0, 1], [2, 2, 3]], mult_1: [[1, 1, 2], [3, 0, 3]],
};
const wiringTilde = (name: string, z: bigint[], b: bigint[], c: bigint[], p: bigint): bigint =>
  WIRING[name].reduce((sum, [a, in1, in2]) => (sum + chi(a, z.length, z, p) * chi(in1, 2, b, p) % p * chi(in2, 2, c, p)) % p, 0n);

interface RenderedRound { round: number; polynomial: bigint[]; degree: number; bound: number; sumAt01: bigint; expected: bigint; ok: boolean; challenge: bigint | null }

async function readRounds(page: Page, bodySelector: string): Promise<RenderedRound[]> {
  return page.locator(`${bodySelector} tr[data-round]`).evaluateAll((rows) => rows.map((row) => {
    const read = (selector: string) => (row.querySelector(selector) as HTMLElement).dataset;
    const challenge = read('.sc-challenge').value ?? '';
    return {
      round: Number(read('.sc-round').value),
      polynomial: (read('.sc-poly').value ?? '').split(',').filter(Boolean),
      degree: Number(read('.sc-degree').degree),
      bound: Number(read('.sc-degree').bound),
      sumAt01: read('.sc-sum01').value ?? '',
      expected: read('.sc-expected').value ?? '',
      ok: read('.sc-check').ok === 'true',
      challenge: challenge === '' ? null : challenge,
    };
  })).then((rows) => rows.map((row) => ({
    ...row,
    polynomial: row.polynomial.map((entry) => BigInt(entry)),
    sumAt01: BigInt(row.sumAt01),
    expected: BigInt(row.expected),
    challenge: row.challenge === null ? null : BigInt(row.challenge),
  })));
}

/** Re-run every verifier check on a rendered transcript, with the honest partial sums recomputed from g. */
function checkTranscript(rounds: RenderedRound[], claimed: bigint, terms: Term[], degrees: number[], p: bigint, variables: number) {
  let expected = claimed;
  const challenges: bigint[] = [];
  for (const row of rounds) {
    expect(row.degree).toBe(row.polynomial.length - 1);
    expect(row.bound).toBe(degrees[row.round - 1]);
    expect(row.degree).toBeLessThanOrEqual(row.bound);
    expect(row.sumAt01).toBe((horner(row.polynomial, 0n, p) + horner(row.polynomial, 1n, p)) % p);
    expect(row.expected).toBe(expected);
    expect(row.sumAt01).toBe(expected);
    expect(row.ok).toBe(true);
    // The message really is the honest partial sum: it agrees with brute force at 0, 1, 2 and 3.
    for (const t of [0n, 1n, 2n, 3n]) expect(horner(row.polynomial, t, p)).toBe(honestPartial(terms, challenges, t, variables, p));
    expect(row.challenge).not.toBeNull();
    challenges.push(row.challenge!);
    expected = horner(row.polynomial, row.challenge!, p);
  }
  return { challenges, lastValue: expected };
}

test.describe('Sum-check and GKR: computed claims', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('exhibits/sumcheck-gkr.html?seed=ci-sumcheck');
    await expect(page.locator('#sc-sum')).toHaveText('12');
  });

  test('the printed hypercube sum, the honest transcript and the final evaluation are all recomputed from g', async ({ page }) => {
    const claimIds = await page.locator('[data-claim]').evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.claim));
    expect(claimIds).toEqual(['sumcheck-intro', 'sumcheck-statement', 'sum-derivation', 'census-scope', 'gkr-statement', 'gkr-scope']);
    await expect(page.locator('#sc-randomness-label')).toContainText('not cryptographically secure');

    const p = BigInt(await textOf(page, '#sc-p'));
    const variables = Number(await textOf(page, '#sc-v'));
    const degrees = (await page.locator('#sc-degrees').getAttribute('data-value'))!.split(',').map(Number);
    const terms = parseTerms(await page.locator('#sc-custom').inputValue(), variables);
    expect(p).toBe(2147483647n);
    expect(variables).toBe(3);
    expect(degrees).toEqual([3, 1, 1]);
    const independentSum = honestPartial(terms, [], 0n, variables, p) + honestPartial(terms, [], 1n, variables, p);
    expect(independentSum % p).toBe(12n);
    expect(BigInt(await textOf(page, '#sc-sum'))).toBe(12n);
    expect(await page.locator('#sc-bound').getAttribute('data-value')).toBe(`9/${p}`);

    await page.locator('#sc-run').click();
    await expect(page.locator('#sc-verdict')).toHaveAttribute('data-state', 'pass');
    const claimed = BigInt((await page.locator('#sc-claim-line').getAttribute('data-value'))!);
    expect(claimed).toBe(12n);
    const rounds = await readRounds(page, '#sc-rounds-body');
    expect(rounds).toHaveLength(3);
    expect(rounds[0].polynomial).toEqual([1n, 2n, 0n, 8n]); // 8X^3 + 2X + 1, as in Thaler §4.1
    const { challenges, lastValue } = checkTranscript(rounds, claimed, terms, degrees, p, variables);
    const finalLine = page.locator('#sc-final-line');
    expect(bigList(await finalLine.getAttribute('data-point'))).toEqual(challenges);
    expect(BigInt((await finalLine.getAttribute('data-claimed'))!)).toBe(lastValue);
    expect(BigInt((await finalLine.getAttribute('data-evaluated'))!)).toBe(evalTerms(terms, challenges, p));
    expect(lastValue).toBe(evalTerms(terms, challenges, p));
    await expect(page.locator('#sc-verdict')).toContainText('✓ ACCEPTED');
  });

  test('each refused prover is rejected for the reason the numbers show', async ({ page }) => {
    const p = 2147483647n;
    const terms = parseTerms(await page.locator('#sc-custom').inputValue(), 3);

    await page.locator('#sc-strategy').selectOption('wrong-sum-naive');
    await page.locator('#sc-run').click();
    await expect(page.locator('#sc-verdict')).toHaveAttribute('data-state', 'fail');
    await expect(page.locator('#sc-verdict')).toHaveText('✗ REJECTED — round 1: s1(0) + s1(1) = 12 but the verifier expected 13 (the claimed sum).');
    expect(await page.locator('#sc-rounds-body tr[data-round]').count()).toBe(1);
    await expect(page.locator('#sc-rounds-body tr .sc-challenge')).toContainText('never drawn');

    await page.locator('#sc-strategy').selectOption('wrong-sum-carried');
    await page.locator('#sc-run').click();
    await expect(page.locator('#sc-verdict')).toHaveAttribute('data-state', 'fail');
    const rounds = await readRounds(page, '#sc-rounds-body');
    expect(rounds).toHaveLength(3);
    expect(rounds.every((row) => row.ok)).toBe(true);
    const point = rounds.map((row) => row.challenge!);
    const lastValue = horner(rounds[2].polynomial, point[2], p);
    const evaluated = evalTerms(terms, point, p);
    expect(lastValue).not.toBe(evaluated);
    await expect(page.locator('#sc-verdict')).toHaveText(`✗ REJECTED — final check: s3(r3) = ${lastValue} but the direct evaluation g(r) = ${evaluated}.`);
    expect(BigInt((await page.locator('#sc-final-line').getAttribute('data-evaluated'))!)).toBe(evaluated);

    await page.locator('#sc-strategy').selectOption('inconsistent-round');
    await page.locator('#sc-run').click();
    await expect(page.locator('#sc-verdict')).toHaveAttribute('data-state', 'fail');
    const partial = await readRounds(page, '#sc-rounds-body');
    expect(partial).toHaveLength(2);
    const expectedAtRound2 = horner(partial[0].polynomial, partial[0].challenge!, p);
    // δ = 1 added to the constant term shifts s2(0) + s2(1) by 2δ.
    expect(partial[1].sumAt01).toBe((expectedAtRound2 + 2n) % p);
    await expect(page.locator('#sc-verdict')).toHaveText(`✗ REJECTED — round 2: s2(0) + s2(1) = ${partial[1].sumAt01} but the verifier expected ${expectedAtRound2} (s1(r1)).`);

    await page.locator('#sc-strategy').selectOption('excessive-degree');
    await page.locator('#sc-run').click();
    await expect(page.locator('#sc-verdict')).toHaveAttribute('data-state', 'fail');
    await expect(page.locator('#sc-verdict')).toHaveText('✗ REJECTED — round 2: the message has degree 3 but the degree bound for X2 is 1.');
    const overDegree = await readRounds(page, '#sc-rounds-body');
    expect(overDegree[1].polynomial).toHaveLength(4);
    expect(overDegree[1].sumAt01).toBe(horner(overDegree[0].polynomial, overDegree[0].challenge!, p));
  });

  test('transcript replay accepts the recorded run and fails closed on every damaged variant', async ({ page }) => {
    await page.locator('#sc-run').click();
    await expect(page.locator('#sc-verdict')).toHaveAttribute('data-state', 'pass');
    const recorded = JSON.parse(await page.locator('#sc-transcript-json').inputValue());
    expect(recorded.protocol).toBe('sum-check');
    expect(recorded.rounds).toHaveLength(3);
    expect(recorded.rounds.map((round: { round: number }) => round.round)).toEqual([1, 2, 3]);
    await page.locator('#sc-replay').click();
    await expect(page.locator('#sc-replay-verdict')).toHaveAttribute('data-state', 'pass');
    await expect(page.locator('#sc-replay-verdict')).toContainText('3 rounds re-checked');

    const damaged: Array<[string, string]> = [
      ['sc-mutate-truncate', '2 rounds recorded but the statement has 3 variables'],
      ['sc-mutate-swap', 'entry 1 is labelled round 2: rounds are out of order'],
      ['sc-mutate-coefficient', 'round 2: s2(0) + s2(1) ='],
      ['sc-mutate-noncanonical', 'round 1 has a coefficient that is not a canonical field element'],
      ['sc-mutate-challenge-first', 'round 1 records a challenge without a prover message'],
      ['sc-mutate-bounds', 'degree bounds [5, 3, 3] do not match the statement\'s [3, 1, 1]'],
    ];
    for (const [id, reason] of damaged) {
      await page.locator('#sc-run').click();
      await page.locator(`#${id}`).click();
      await expect(page.locator('#sc-replay-verdict')).toHaveAttribute('data-state', 'fail');
      await expect(page.locator('#sc-replay-verdict')).toContainText('✗ REPLAY REFUSED');
      await expect(page.locator('#sc-replay-verdict')).toContainText(reason);
    }

    // Hand-typed garbage is refused as malformed JSON, not run.
    await page.locator('#sc-transcript-json').fill('{ not json');
    await page.locator('#sc-replay').click();
    await expect(page.locator('#sc-replay-verdict')).toContainText('malformed transcript: invalid JSON');
  });

  test('the tiny-field census counts match an independent closed form and the printed bound', async ({ page }) => {
    await page.locator('#sc-field').selectOption('13');
    await page.locator('#sc-preset').selectOption('x1*x2 + 3*x1^2');
    await expect(page.locator('#sc-degrees')).toHaveAttribute('data-value', '2,1');
    await expect(page.locator('#sc-bound')).toHaveAttribute('data-value', '4/13');
    await expect(page.locator('#sc-census')).toBeEnabled();
    await page.locator('#sc-census').click();
    await expect(page.locator('#sc-census-verdict')).toHaveAttribute('data-state', 'pass', { timeout: 60_000 });
    const total = 13 * 13;
    const closedForm = total - (13 - 2) * (13 - 1);
    const boundCount = Math.floor((4 * total) / 13);
    expect(closedForm).toBe(37);
    expect(boundCount).toBe(52);
    expect(await intOf(page, '#census-honest-accepted')).toBe(total);
    expect(await intOf(page, '#census-honest-total')).toBe(total);
    expect(await intOf(page, '#census-lie-accepted')).toBe(closedForm);
    expect(await intOf(page, '#census-lie-final')).toBe(total - closedForm);
    expect(await intOf(page, '#census-lie-degree')).toBe(0);
    expect(await intOf(page, '#census-lie-recurrence')).toBe(0);
    expect(await intOf(page, '#census-attack-accepted')).toBe(0);
    expect(await intOf(page, '#census-attack-degree')).toBe(total);
    await expect(page.locator('#sc-census-verdict')).toContainText(`carried lie ${closedForm} accepted (= ${closedForm}, within the bound's ${boundCount})`);
    await expect(page.locator('#census-readout')).toContainText('degree 12, agrees with the honest s1 on 12 of 13 points');

    await page.locator('#sc-strategy').selectOption('lagrange-degree-attack');
    await page.locator('#sc-run').click();
    await expect(page.locator('#sc-verdict')).toHaveText('✗ REJECTED — round 1: the message has degree 12 but the degree bound for X1 is 2.');
  });

  test('the GKR walk is recomputed by hand: gate values, wiring extensions, line endpoints and the terminal MLE', async ({ page }) => {
    const p = 2147483647n;
    const inputs = bigList(await page.locator('#gkr-val-2').getAttribute('data-value'));
    expect(inputs).toEqual([3n, 2n, 3n, 1n]);
    const layer1 = [(inputs[0] + inputs[1]) % p, (inputs[1] * inputs[2]) % p, (inputs[2] + inputs[3]) % p, (inputs[0] * inputs[3]) % p];
    const layer0 = [(layer1[0] * layer1[1]) % p, (layer1[2] + layer1[3]) % p];
    for (let gate = 0; gate < 4; gate += 1) await expect(page.locator(`#gkr-val-1-${gate}`)).toHaveText(String(layer1[gate]));
    for (let gate = 0; gate < 2; gate += 1) await expect(page.locator(`#gkr-val-0-${gate}`)).toHaveText(String(layer0[gate]));
    await expect(page.locator('#gkr-wiring')).toHaveText('add_0 = {(1,2,3)} · mult_0 = {(0,0,1)} · add_1 = {(0,0,1), (2,2,3)} · mult_1 = {(1,1,2), (3,0,3)}');
    await expect(page.locator('#gkr-bound')).toHaveAttribute('data-value', `21/${p}`);

    await page.locator('#gkr-run').click();
    await expect(page.locator('#gkr-verdict')).toHaveAttribute('data-state', 'pass');
    const facts = async (selector: string) => page.locator(`${selector} code[data-value]`).evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.value ?? ''));
    const outputs = await facts('#gkr-outputs');
    expect(bigList(outputs[0])).toEqual(layer0);
    const r0 = bigList(outputs[1]);
    expect(r0).toHaveLength(1);
    const m0 = BigInt(outputs[2]);
    expect(m0).toBe((layer0[0] * ((1n - r0[0] + p) % p) + layer0[1] * r0[0]) % p);

    const tables = [layer0, layer1, inputs];
    let point = r0;
    let claim = m0;
    for (const layer of [0, 1]) {
      const heading = page.locator(`#gkr-layer-${layer} h3`);
      expect(bigList(await heading.getAttribute('data-point'))).toEqual(point);
      expect(BigInt((await heading.getAttribute('data-claim'))!)).toBe(claim);
      const rounds = await readRounds(page, `#gkr-layer-${layer}-rounds-body`);
      expect(rounds).toHaveLength(4);
      let expected = claim;
      for (const row of rounds) {
        expect(row.bound).toBe(2);
        expect(row.degree).toBeLessThanOrEqual(2);
        expect(row.ok).toBe(true);
        expect(row.sumAt01).toBe((horner(row.polynomial, 0n, p) + horner(row.polynomial, 1n, p)) % p);
        expect(row.sumAt01).toBe(expected);
        expected = horner(row.polynomial, row.challenge!, p);
      }
      const line = await facts(`#gkr-layer-${layer}-line`);
      const bStar = bigList(line[0]);
      const cStar = bigList(line[1]);
      expect([...bStar, ...cStar]).toEqual(rounds.map((row) => row.challenge!));
      const q = bigList(line[2]);
      expect(line[3]).toBe(`${q.length - 1}/2`);
      expect(q.length - 1).toBeLessThanOrEqual(2);
      const [q0, q1] = bigList(line[4]);
      expect(q0).toBe(horner(q, 0n, p));
      expect(q1).toBe(horner(q, 1n, p));
      // The prover's line polynomial really is W̃_{i+1} on the line: both endpoints match the hand MLE.
      expect(q0).toBe(mle2(tables[layer + 1], bStar, p));
      expect(q1).toBe(mle2(tables[layer + 1], cStar, p));
      const addTilde = BigInt(line[5]);
      const multTilde = BigInt(line[6]);
      expect(addTilde).toBe(wiringTilde(`add_${layer}`, point, bStar, cStar, p));
      expect(multTilde).toBe(wiringTilde(`mult_${layer}`, point, bStar, cStar, p));
      const oracleValue = BigInt(line[7]);
      expect(oracleValue).toBe((addTilde * ((q0 + q1) % p) + multTilde * (q0 * q1 % p)) % p);
      expect(BigInt(line[8])).toBe(expected);
      expect(oracleValue).toBe(expected);
      expect(line[9]).toBe('true');
      const rStar = BigInt(line[10]);
      const nextPoint = bigList(line[11]);
      const nextClaim = BigInt(line[12]);
      expect(nextPoint).toEqual(bStar.map((value, index) => (value + rStar * ((cStar[index] - value + p) % p)) % p));
      expect(nextClaim).toBe(horner(q, rStar, p));
      expect(nextClaim).toBe(mle2(tables[layer + 1], nextPoint, p));
      await expect(page.locator(`#gkr-layer-${layer}-status`)).toHaveAttribute('data-ok', 'true');
      point = nextPoint;
      claim = nextClaim;
    }
    const terminal = await facts('#gkr-terminal');
    expect(bigList(terminal[0])).toEqual(point);
    expect(BigInt(terminal[1])).toBe(claim);
    expect(BigInt(terminal[2])).toBe(mle2(inputs, point, p));
    expect(BigInt(terminal[2])).toBe(claim);
    expect(terminal[3]).toBe('true');
    await expect(page.locator('#gkr-verdict')).toContainText('✓ ACCEPTED — terminal check');
    await expect(page.locator('[data-claim="gkr-scope"]')).toContainText('Not executed: the log-space-uniformity machinery, the sublinear verifier, Fiat–Shamir, or any general theorem');
  });

  test('each GKR cheating strategy is rejected at the stage the verdict names', async ({ page }) => {
    const p = 2147483647n;
    const cases: Array<[string, RegExp]> = [
      ['wrong-output', /^✗ REJECTED at recurrence \(round 1\) at layer 0 — layer 0: round 1: s1\(0\) \+ s1\(1\) = \d+ but the verifier expected \d+ \(the claimed sum\)\.$/],
      ['corrupt-gate', /^✗ REJECTED at recurrence \(round 1\) at layer 1 — layer 1: round 1: /],
      ['corrupt-wiring', /^✗ REJECTED at final at layer 1 — layer 1: final check: s4\(r4\) = \d+ but the direct evaluation g\(r\) = \d+ — the verifier evaluated add̃ and mult̃ from its own wiring/],
      ['invalid-line-degree', /^✗ REJECTED at line-degree at layer 0 — layer 0 line: q has degree 3 but W̃1 restricted to a line has degree at most 2\.$/],
      ['invalid-line-value', /^✗ REJECTED at recurrence \(round 1\) at layer 1 — /],
      ['invalid-line-last', /^✗ REJECTED at terminal at layer 2 — terminal check: W̃2\(\d+, \d+\) computed from the public inputs is (\d+) but the carried claim is (\d+)\.$/],
    ];
    for (const [strategy, pattern] of cases) {
      await page.locator('#gkr-strategy').selectOption(strategy);
      await expect(page.locator('#gkr-verdict')).toHaveAttribute('data-state', 'pending');
      await page.locator('#gkr-run').click();
      await expect(page.locator('#gkr-verdict')).toHaveAttribute('data-state', 'fail');
      const verdict = await textOf(page, '#gkr-verdict');
      expect(verdict).toMatch(pattern);
    }
    // The corrupted-gate prover's claimed outputs differ from the direct evaluation, and layer 0 still passed.
    await page.locator('#gkr-strategy').selectOption('corrupt-gate');
    await page.locator('#gkr-run').click();
    const claimed = bigList(await page.locator('#gkr-outputs code[data-value]').first().getAttribute('data-value'));
    expect(claimed).not.toEqual([30n, 7n]);
    await expect(page.locator('#gkr-layer-0-status')).toHaveAttribute('data-ok', 'true');
    // The terminal rejection's evaluated value is the hand MLE of the public inputs.
    await page.locator('#gkr-strategy').selectOption('invalid-line-last');
    await page.locator('#gkr-run').click();
    const terminal = await page.locator('#gkr-terminal code[data-value]').evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.value ?? ''));
    expect(BigInt(terminal[2])).toBe(mle2([3n, 2n, 3n, 1n], bigList(terminal[0]), p));
    expect(BigInt(terminal[2])).not.toBe(BigInt(terminal[1]));
    expect(terminal[3]).toBe('false');
  });

  test('changing the field, the randomness or the inputs retires every stale result', async ({ page }) => {
    await page.locator('#sc-run').click();
    await page.locator('#sc-replay').click();
    await page.locator('#gkr-run').click();
    await expect(page.locator('#sc-verdict')).toHaveAttribute('data-state', 'pass');
    await expect(page.locator('#sc-replay-verdict')).toHaveAttribute('data-state', 'pass');
    await expect(page.locator('#gkr-verdict')).toHaveAttribute('data-state', 'pass');

    await page.locator('#sc-field').selectOption('101');
    await expect(page.locator('#sc-p')).toHaveText('101');
    await expect(page.locator('#sc-verdict')).toHaveAttribute('data-state', 'pending');
    await expect(page.locator('#sc-rounds-body tr[data-round]')).toHaveCount(0);
    await expect(page.locator('#sc-transcript-json')).toHaveValue('');
    await expect(page.locator('#sc-replay-verdict')).toHaveAttribute('data-state', 'pending');
    await expect(page.locator('#gkr-verdict')).toHaveAttribute('data-state', 'pending');
    await expect(page.locator('.gkr-layer')).toHaveCount(0);
    await expect(page.locator('#sc-narration')).toContainText('the previous transcript was retired');

    await page.locator('#sc-run').click();
    await expect(page.locator('#sc-verdict')).toHaveAttribute('data-state', 'pass');
    await page.locator('#sc-random-fresh').check();
    await expect(page.locator('#sc-verdict')).toHaveAttribute('data-state', 'pending');
    await expect(page.locator('#sc-randomness-label')).toContainText('fresh verifier randomness');

    await page.locator('#gkr-run').click();
    await expect(page.locator('#gkr-verdict')).toHaveAttribute('data-state', 'pass');
    await page.locator('#gkr-x1').fill('5');
    await page.locator('#gkr-evaluate').click();
    await expect(page.locator('#gkr-verdict')).toHaveAttribute('data-state', 'pending');
    await expect(page.locator('#gkr-val-1-0')).toHaveText('8');
    await page.locator('#gkr-x1').fill('-1');
    await page.locator('#gkr-evaluate').click();
    await expect(page.locator('#sc-input-error')).toContainText('Circuit inputs must be non-negative integers');
    await expect(page.locator('#gkr-val-1-0')).toHaveText('8');
  });
});
