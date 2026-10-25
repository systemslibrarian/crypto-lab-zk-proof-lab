import { checkPrimeSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MAX_FIELD_MODULUS,
  createField,
  freshChallengeSource,
  isPrime,
  scriptedChallengeSource,
  seededChallengeSource,
} from '../../js/field.js';

const MERSENNE_31 = 2147483647n;

describe('prime-field construction', () => {
  it('accepts primes and refuses composites, units and non-integers by name', () => {
    for (const p of [2n, 3n, 5n, 7n, 13n, 101n, MERSENNE_31, 18446744073709551557n]) {
      expect(createField(p).p).toBe(p);
    }
    expect(() => createField(1n)).toThrow('below 2');
    expect(() => createField(0n)).toThrow('below 2');
    expect(() => createField(-7n)).toThrow('below 2');
    expect(() => createField(4n)).toThrow('not prime');
    expect(() => createField(2147483649n)).toThrow('not prime'); // 3 × 715827883
    expect(() => createField(MAX_FIELD_MODULUS)).toThrow('below 2^64');
    expect(() => createField(13 as unknown as bigint)).toThrow('BigInt');
  });

  it('agrees with Node\'s independent primality test on every integer below 2000 and on sampled larger values', () => {
    for (let n = 0n; n < 2000n; n += 1n) {
      expect(isPrime(n)).toBe(n >= 2n && checkPrimeSync(n, { checks: 16 }));
    }
    for (const n of [MERSENNE_31, MERSENNE_31 + 2n, 4294967291n, 4294967297n, 18446744073709551557n, 18446744073709551559n]) {
      expect(isPrime(n)).toBe(checkPrimeSync(n, { checks: 32 }));
    }
  });
});

describe('prime-field arithmetic', () => {
  const field = createField(MERSENNE_31);

  it('normalizes into [0, p) and computes exact results against BigInt references', () => {
    const p = MERSENNE_31;
    expect(field.normalize(-1n)).toBe(p - 1n);
    expect(field.normalize(p)).toBe(0n);
    expect(field.add(p - 1n, 5n)).toBe(4n);
    expect(field.sub(3n, 5n)).toBe(p - 2n);
    expect(field.mul(p - 1n, p - 1n)).toBe(1n);
    expect(field.neg(0n)).toBe(0n);
    expect(field.neg(1n)).toBe(p - 1n);
    expect(field.pow(3n, p - 1n)).toBe(1n); // Fermat
    for (const a of [1n, 2n, 12345n, p - 1n, 987654321n]) {
      expect(field.mul(a, field.inv(a))).toBe(1n);
      expect(field.inv(a)).toBe(field.pow(a, p - 2n));
    }
  });

  it('refuses the inverse of zero, negative exponents and non-BigInt inputs', () => {
    expect(() => field.inv(0n)).toThrow('no inverse');
    expect(() => field.pow(2n, -1n)).toThrow('non-negative');
    expect(() => field.add(1 as unknown as bigint, 2n)).toThrow('BigInt');
    expect(field.isCanonical(0n)).toBe(true);
    expect(field.isCanonical(MERSENNE_31)).toBe(false);
    expect(field.isCanonical(-1n)).toBe(false);
    expect(field.isCanonical(1)).toBe(false);
    expect(field.isCanonical('1')).toBe(false);
  });

  it('lists a tiny field exhaustively and refuses to list a large one', () => {
    expect(createField(7n).elements()).toEqual([0n, 1n, 2n, 3n, 4n, 5n, 6n]);
    expect(() => field.elements()).toThrow('too large');
  });
});

describe('challenge sources', () => {
  const field = createField(MERSENNE_31);

  it('fresh randomness is canonical and not constant', () => {
    const source = freshChallengeSource(field);
    expect(source.kind).toBe('fresh');
    const draws = Array.from({ length: 8 }, () => source.draw());
    for (const value of draws) expect(field.isCanonical(value)).toBe(true);
    expect(new Set(draws.map(String)).size).toBeGreaterThan(1);
  });

  it('seeded randomness is replayable, seed-dependent and labelled as not secure', () => {
    const a = seededChallengeSource(field, 'ci-seed');
    const b = seededChallengeSource(field, 'ci-seed');
    const c = seededChallengeSource(field, 'other-seed');
    const first = Array.from({ length: 6 }, () => a.draw());
    expect(Array.from({ length: 6 }, () => b.draw())).toEqual(first);
    expect(Array.from({ length: 6 }, () => c.draw())).not.toEqual(first);
    for (const value of first) expect(field.isCanonical(value)).toBe(true);
    expect(a.kind).toBe('seeded');
    expect(a.label).toContain('not cryptographically secure');
    expect(() => seededChallengeSource(field, '')).toThrow('non-empty');
  });

  it('a scripted vector replays exactly and refuses to over-draw or leave the field', () => {
    const source = scriptedChallengeSource(field, [1n, 2n, 3n]);
    expect([source.draw(), source.draw(), source.draw()]).toEqual([1n, 2n, 3n]);
    expect(() => source.draw()).toThrow('exhausted');
    expect(() => scriptedChallengeSource(field, [MERSENNE_31]).draw()).toThrow('canonical');
  });
});
