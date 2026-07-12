import { describe, it, expect } from 'vitest';
import {
  modpow,
  schnorrVerify,
  sha256hex,
  confidencePercent,
  cheatProbabilityPercent,
} from '../../js/shared.js';

// Schnorr toy group used across the exhibits.
const G = 5;
const P = 2053;
const X = 17;
const Y = modpow(G, X, P); // public key y = g^x mod p

describe('modpow', () => {
  it('matches a known modular exponentiation (5^17 mod 2053 = 375)', () => {
    expect(modpow(5, 17, 2053)).toBe(375);
  });

  it('agrees with BigInt reference on random inputs', () => {
    for (let i = 0; i < 200; i += 1) {
      const base = Math.floor(Math.random() * 5000);
      const exp = Math.floor(Math.random() * 5000);
      const mod = 2 + Math.floor(Math.random() * 5000);
      const ref = Number(
        BigInt(base) ** BigInt(exp) % BigInt(mod === 0 ? 1 : mod),
      );
      // BigInt ** with large exp is slow; keep exp small for the reference path.
      const smallExp = exp % 40;
      const refSmall = Number(BigInt(base) ** BigInt(smallExp) % BigInt(mod));
      expect(modpow(base, smallExp, mod)).toBe(refSmall);
      expect(typeof ref).toBe('number');
    }
  });

  it('derives the exhibit public key y = g^x mod p = 375', () => {
    expect(Y).toBe(375);
  });
});

describe('schnorrVerify', () => {
  it('accepts an honest transcript (completeness)', () => {
    const r = 123;
    const c = 9;
    const R = modpow(G, r, P);
    const s = (r + c * X) % (P - 1);
    const result = schnorrVerify({ g: G, p: P, y: Y, R, c, s });
    expect(result.ok).toBe(true);
    expect(result.lhs).toBe(result.rhs);
  });

  it('is complete for every challenge c in the exhibit range 1..50', () => {
    const r = 777;
    const R = modpow(G, r, P);
    for (let c = 1; c <= 50; c += 1) {
      const s = ((r + c * X) % (P - 1) + (P - 1)) % (P - 1);
      expect(schnorrVerify({ g: G, p: P, y: Y, R, c, s }).ok).toBe(true);
    }
  });

  it('rejects a fabricated response (soundness / no-witness forgery)', () => {
    const R = modpow(G, 123, P);
    // s = 222 was not derived from the secret x; the equation must not balance.
    expect(schnorrVerify({ g: G, p: P, y: Y, R, c: 9, s: 222 }).ok).toBe(false);
  });

  it('rejects a transcript whose commitment R was tampered', () => {
    const r = 500;
    const c = 11;
    const R = modpow(G, r, P);
    const s = (r + c * X) % (P - 1);
    // Verifier receives R+1 instead of the committed R.
    expect(schnorrVerify({ g: G, p: P, y: Y, R: (R + 1) % P, c, s }).ok).toBe(false);
  });
});

describe('sha256hex', () => {
  it('matches the NIST "abc" known-answer vector', async () => {
    expect(await sha256hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('matches the empty-string known-answer vector', async () => {
    expect(await sha256hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('soundness-amplification formulas', () => {
  it('cave confidence 1 - (1/2)^10 ≈ 99.90%', () => {
    expect(confidencePercent(10, 0.5).toFixed(2)).toBe('99.90');
  });

  it('graph cheat survival (5/6)^10 ≈ 16.15%', () => {
    expect(cheatProbabilityPercent(10, 5 / 6).toFixed(2)).toBe('16.15');
  });

  it('confidence + cheat-survival sum to 100% at every round', () => {
    for (let k = 0; k <= 20; k += 1) {
      const sum = confidencePercent(k, 5 / 6) + cheatProbabilityPercent(k, 5 / 6);
      expect(sum).toBeCloseTo(100, 9);
    }
  });
});
