// @ts-check
// Prime-field arithmetic for Exhibit 08 (sum-check and the GKR layer walk).
//
// Every element is a canonical BigInt in [0, p). The modulus is proven prime by a
// deterministic Miller–Rabin test before any arithmetic is offered, so nothing
// downstream can silently run over a composite ring. This is inspectable teaching
// code: no operation here is constant-time.

import { createSeededRng, egcd, modpowBig } from './shared.js';
import { randomBelow } from './sigma.js';

/**
 * @typedef {Object} PrimeField
 * @property {bigint} p
 * @property {number} bits
 * @property {(a: bigint, b: bigint) => bigint} add
 * @property {(a: bigint, b: bigint) => bigint} sub
 * @property {(a: bigint, b: bigint) => bigint} mul
 * @property {(a: bigint) => bigint} neg
 * @property {(a: bigint) => bigint} inv
 * @property {(a: bigint, e: bigint) => bigint} pow
 * @property {(a: bigint) => bigint} normalize
 * @property {(value: unknown) => value is bigint} isCanonical
 * @property {() => bigint[]} elements
 */

/**
 * @typedef {Object} ChallengeSource
 * @property {'fresh' | 'seeded' | 'scripted'} kind
 * @property {string} label
 * @property {() => bigint} draw
 */

/** Moduli at or above 2^64 are refused; the lab has no use for them. */
export const MAX_FIELD_MODULUS = 1n << 64n;
/** Largest field whose elements may be listed one by one. */
export const MAX_ENUMERABLE_MODULUS = 4096n;

const MILLER_RABIN_BASES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];

/**
 * Deterministic Miller–Rabin. Testing exactly these twelve prime bases decides
 * primality with no error for every n below 3.1 × 10^23 (Sorenson and Webster,
 * "Strong pseudoprimes to twelve prime bases", Math. Comp. 86, 2017), which is far
 * above the 2^64 ceiling imposed here. There is no probabilistic residue.
 * @param {bigint} n
 */
export function isPrime(n) {
  if (typeof n !== 'bigint') throw new TypeError('the primality test needs a BigInt');
  if (n >= MAX_FIELD_MODULUS) throw new RangeError('the primality test is only used below 2^64');
  if (n < 2n) return false;
  for (const base of MILLER_RABIN_BASES) {
    if (n === base) return true;
    if (n % base === 0n) return false;
  }
  let d = n - 1n;
  let s = 0;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    s += 1;
  }
  for (const base of MILLER_RABIN_BASES) {
    let x = modpowBig(base, d, n);
    if (x === 1n || x === n - 1n) continue;
    let witnessOfCompositeness = true;
    for (let round = 1; round < s; round += 1) {
      x = x * x % n;
      if (x === n - 1n) {
        witnessOfCompositeness = false;
        break;
      }
    }
    if (witnessOfCompositeness) return false;
  }
  return true;
}

/**
 * Build the prime field Z/pZ, refusing by name anything that is not a prime below 2^64.
 * @param {bigint} modulus
 * @returns {PrimeField}
 */
export function createField(modulus) {
  if (typeof modulus !== 'bigint') throw new TypeError('a field modulus must be a BigInt');
  if (modulus < 2n) throw new RangeError(`${modulus} is below 2 and cannot be a field modulus`);
  if (modulus >= MAX_FIELD_MODULUS) throw new RangeError('this lab only builds fields with a modulus below 2^64');
  if (!isPrime(modulus)) throw new RangeError(`${modulus} is not prime, so the integers modulo ${modulus} are not a field`);
  const p = modulus;

  /** @param {bigint} a */
  const normalize = (a) => {
    if (typeof a !== 'bigint') throw new TypeError('field elements must be BigInts');
    return ((a % p) + p) % p;
  };
  /** @param {unknown} value @returns {value is bigint} */
  function isCanonical(value) {
    return typeof value === 'bigint' && value >= 0n && value < p;
  }
  /** @param {bigint} a @param {bigint} b */
  const add = (a, b) => (normalize(a) + normalize(b)) % p;
  /** @param {bigint} a @param {bigint} b */
  const sub = (a, b) => (normalize(a) - normalize(b) + p) % p;
  /** @param {bigint} a @param {bigint} b */
  const mul = (a, b) => normalize(a) * normalize(b) % p;
  /** @param {bigint} a */
  const neg = (a) => (p - normalize(a)) % p;
  /** @param {bigint} a */
  const inv = (a) => {
    const value = normalize(a);
    if (value === 0n) throw new RangeError('0 has no inverse in a field');
    const { gcd, x } = egcd(value, p);
    if (gcd !== 1n) throw new RangeError(`${value} is not invertible modulo ${p}`);
    return ((x % p) + p) % p;
  };
  /** @param {bigint} a @param {bigint} e */
  const pow = (a, e) => {
    if (typeof e !== 'bigint' || e < 0n) throw new RangeError('field exponents must be non-negative BigInts');
    return modpowBig(normalize(a), e, p);
  };
  const elements = () => {
    if (p > MAX_ENUMERABLE_MODULUS) throw new RangeError(`a field of size ${p} is too large to list exhaustively`);
    return Array.from({ length: Number(p) }, (_, index) => BigInt(index));
  };
  return Object.freeze({ p, bits: p.toString(2).length, add, sub, mul, neg, inv, pow, normalize, isCanonical, elements });
}

/**
 * Fresh verifier randomness: uniform in [0, p) from crypto.getRandomValues with
 * rejection sampling. This is the source an interactive verifier is supposed to use.
 * @param {PrimeField} field
 * @returns {ChallengeSource}
 */
export function freshChallengeSource(field) {
  return {
    kind: 'fresh',
    label: 'fresh verifier randomness: crypto.getRandomValues with rejection sampling',
    draw: () => randomBelow(field.p),
  };
}

/**
 * Deterministic teaching randomness, so a run can be replayed from a seed. It is
 * an FNV-seeded LCG and is labelled as such everywhere it appears: it is NOT
 * cryptographically secure verifier randomness and a prover who knows the seed
 * knows every challenge in advance.
 * @param {PrimeField} field
 * @param {string} seed
 * @returns {ChallengeSource}
 */
export function seededChallengeSource(field, seed) {
  if (typeof seed !== 'string' || seed.length === 0) throw new RangeError('a seeded challenge source needs a non-empty seed string');
  const rng = createSeededRng(seed);
  return {
    kind: 'seeded',
    label: `deterministic teaching seed "${seed}" — replayable, not cryptographically secure verifier randomness`,
    draw: () => {
      const hi = BigInt(Math.floor(rng() * 4294967296));
      const lo = BigInt(Math.floor(rng() * 4294967296));
      return ((hi << 32n) | lo) % field.p;
    },
  };
}

/**
 * A fixed challenge vector, used to replay a recorded transcript and to walk every
 * vector of a tiny field in the exhaustive census. Draws beyond the vector throw.
 * @param {PrimeField} field
 * @param {bigint[]} values
 * @returns {ChallengeSource}
 */
export function scriptedChallengeSource(field, values) {
  let next = 0;
  return {
    kind: 'scripted',
    label: 'scripted challenge vector',
    draw: () => {
      if (next >= values.length) throw new RangeError('the scripted challenge vector is exhausted');
      const value = values[next];
      next += 1;
      if (!field.isCanonical(value)) throw new RangeError('scripted challenges must be canonical field elements');
      return value;
    },
  };
}
