// @ts-check

import { egcd, modpowBig } from './shared.js';

/** RFC 3526 section 3, with whitespace removed exactly as published. */
export const RFC3526_GROUP14_HEX =
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
  '15728E5A8AACAA68FFFFFFFFFFFFFFFF';

export const RFC3526_GROUP14_P = BigInt(`0x${RFC3526_GROUP14_HEX}`);
export const RFC3526_GROUP14_Q = (RFC3526_GROUP14_P - 1n) / 2n;
export const OKAMOTO_H_SEED = 'crypto-lab-zk-proof-lab/okamoto-h/v1';

/** @typedef {{ p: bigint, q: bigint, g: bigint, h: bigint }} OkamotoParameters */
/** @typedef {{ alpha: bigint, beta: bigint }} OkamotoWitness */
/**
 * @typedef {Object} OkamotoTranscript
 * @property {bigint} u
 * @property {bigint} uT
 * @property {bigint} c
 * @property {bigint} zAlpha
 * @property {bigint} zBeta
 */
/**
 * @typedef {Object} GqTranscript
 * @property {bigint} y
 * @property {bigint} yT
 * @property {bigint} c
 * @property {bigint} xZ
 */

/** @param {bigint} value @param {bigint} modulus */
function modulo(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}

/** @param {bigint} a @param {bigint} b */
export function gcdBig(a, b) {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
}

/** @param {bigint} value @param {bigint} modulus @param {string} [name] */
function inverseBig(value, modulus, name = 'value') {
  const normalized = modulo(value, modulus);
  const result = egcd(normalized, modulus);
  if (result.gcd !== 1n) {
    throw new RangeError(`${name} is not invertible modulo the group modulus (gcd = ${result.gcd})`);
  }
  return modulo(result.x, modulus);
}

/** @param {bigint} base @param {bigint} exponent @param {bigint} modulus */
function powSigned(base, exponent, modulus) {
  return exponent >= 0n
    ? modpowBig(base, exponent, modulus)
    : modpowBig(inverseBig(base, modulus, 'negative-power base'), -exponent, modulus);
}

/**
 * A member of the order-q subgroup is non-zero and satisfies z^q = 1 mod p.
 * @param {bigint} value
 * @param {bigint} p
 * @param {bigint} q
 */
export function isPrimeOrderMember(value, p, q) {
  return value > 0n && value < p && modpowBig(value, q, p) === 1n;
}

/** @param {Uint8Array} bytes */
function bytesToBigInt(bytes) {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

/** @param {bigint} value */
function bigIntToBytes(value) {
  if (value < 0n) throw new RangeError('cannot encode a negative integer');
  if (value === 0n) return new Uint8Array([0]);
  const hex = value.toString(16).padStart(Math.ceil(value.toString(16).length / 2) * 2, '0');
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));
}

/** @param {string} value */
export function base64UrlToBigInt(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = globalThis.atob(base64);
  return bytesToBigInt(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

/** @param {number} length */
function secureRandomBytes(length) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** Uniform random integer in [0, limit), using rejection sampling. @param {bigint} limit */
export function randomBelow(limit) {
  if (limit <= 0n) throw new RangeError('random limit must be positive');
  const bits = limit.toString(2).length;
  const length = Math.ceil(bits / 8);
  const excess = length * 8 - bits;
  for (;;) {
    const bytes = secureRandomBytes(length);
    if (excess > 0) bytes[0] &= 0xff >>> excess;
    const candidate = bytesToBigInt(bytes);
    if (candidate < limit) return candidate;
  }
}

/** Uniform random member of Z*_N. @param {bigint} N */
export function randomUnit(N) {
  if (N <= 3n) throw new RangeError('N must be greater than 3');
  for (;;) {
    const candidate = randomBelow(N - 2n) + 2n;
    if (gcdBig(candidate, N) === 1n) return candidate;
  }
}

/**
 * Expand `seed || I2OSP(counter, 4)` with SHA-256 until `length` bytes exist.
 * @param {string} seed
 * @param {number} length
 */
async function sha256CounterExpand(seed, length) {
  const seedBytes = new TextEncoder().encode(seed);
  const output = new Uint8Array(length);
  let offset = 0;
  let counter = 0;
  while (offset < length) {
    const input = new Uint8Array(seedBytes.length + 4);
    input.set(seedBytes);
    new DataView(input.buffer).setUint32(seedBytes.length, counter, false);
    const block = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', input));
    const take = Math.min(block.length, length - offset);
    output.set(block.subarray(0, take), offset);
    offset += take;
    counter += 1;
  }
  return output;
}

/**
 * Deterministically derive h in the RFC 3526 order-q subgroup. The expansion is
 * 2048 + 64 bits; reducing modulo p and squaring maps the value into the
 * quadratic-residue subgroup. No discrete logarithm is computed or retained.
 * @param {string} [seed]
 */
export async function deriveH(seed = OKAMOTO_H_SEED) {
  const expanded = await sha256CounterExpand(seed, (2048 + 64) / 8);
  const reduced = bytesToBigInt(expanded) % RFC3526_GROUP14_P;
  const h = modpowBig(reduced, 2n, RFC3526_GROUP14_P);
  if (reduced === 0n || h === 1n) {
    throw new Error('the published h seed produced a degenerate subgroup element');
  }
  return h;
}

/** @param {string} [seed] @returns {Promise<OkamotoParameters & { seed: string }>} */
export async function okamotoParams(seed = OKAMOTO_H_SEED) {
  return {
    p: RFC3526_GROUP14_P,
    q: RFC3526_GROUP14_Q,
    g: 4n,
    h: await deriveH(seed),
    seed,
  };
}

/**
 * Produce one Okamoto transcript using caller-supplied nonces so the teaching
 * page can deliberately rewind to the exact same commitment.
 * @param {OkamotoParameters} params
 * @param {OkamotoWitness} witness
 * @param {OkamotoWitness} nonce
 * @param {bigint} challenge
 * @returns {OkamotoTranscript}
 */
export function okamotoProve(params, witness, nonce, challenge) {
  if (!isPrimeOrderMember(params.g, params.p, params.q) || params.g === 1n) {
    throw new RangeError('g is not a non-identity member of the order-q subgroup');
  }
  if (!isPrimeOrderMember(params.h, params.p, params.q) || params.h === 1n) {
    throw new RangeError('h is not a non-identity member of the order-q subgroup');
  }
  if (challenge < 0n || challenge >= params.q) {
    throw new RangeError('Okamoto challenge is outside Z_q');
  }
  const alpha = modulo(witness.alpha, params.q);
  const beta = modulo(witness.beta, params.q);
  const alphaT = modulo(nonce.alpha, params.q);
  const betaT = modulo(nonce.beta, params.q);
  const u = modpowBig(params.g, alpha, params.p) * modpowBig(params.h, beta, params.p) % params.p;
  const uT = modpowBig(params.g, alphaT, params.p) * modpowBig(params.h, betaT, params.p) % params.p;
  return {
    u,
    uT,
    c: challenge,
    zAlpha: modulo(alphaT + alpha * challenge, params.q),
    zBeta: modulo(betaT + beta * challenge, params.q),
  };
}

/**
 * @param {OkamotoParameters} params
 * @param {OkamotoTranscript} transcript
 * @returns {{ ok: boolean, lhs: bigint, rhs: bigint, reason: string }}
 */
export function okamotoVerify(params, transcript) {
  if (!isPrimeOrderMember(transcript.u, params.p, params.q)) {
    return { ok: false, lhs: 0n, rhs: 0n, reason: 'u is not in the order-q subgroup' };
  }
  if (!isPrimeOrderMember(transcript.uT, params.p, params.q)) {
    return { ok: false, lhs: 0n, rhs: 0n, reason: 'u_t is not in the order-q subgroup' };
  }
  if (transcript.c < 0n || transcript.c >= params.q) {
    return { ok: false, lhs: 0n, rhs: 0n, reason: 'challenge c is outside Z_q' };
  }
  if (
    transcript.zAlpha < 0n || transcript.zAlpha >= params.q ||
    transcript.zBeta < 0n || transcript.zBeta >= params.q
  ) {
    return { ok: false, lhs: 0n, rhs: 0n, reason: 'response is outside Z_q' };
  }
  const lhs = modpowBig(params.g, transcript.zAlpha, params.p) * modpowBig(params.h, transcript.zBeta, params.p) % params.p;
  const rhs = transcript.uT * modpowBig(transcript.u, transcript.c, params.p) % params.p;
  return { ok: lhs === rhs, lhs, rhs, reason: lhs === rhs ? 'equation holds' : 'verifier equation does not hold' };
}

/**
 * Extract a representation from two accepting answers to distinct challenges.
 * @param {OkamotoParameters} params
 * @param {OkamotoTranscript} first
 * @param {OkamotoTranscript} second
 */
export function okamotoExtract(params, first, second) {
  if (first.u !== second.u || first.uT !== second.uT) {
    throw new RangeError('special soundness requires the same statement and commitment');
  }
  if (!okamotoVerify(params, first).ok || !okamotoVerify(params, second).ok) {
    throw new RangeError('both Okamoto transcripts must be accepting');
  }
  const deltaC = modulo(first.c - second.c, params.q);
  if (deltaC === 0n) {
    throw new RangeError('special soundness needs two different challenges');
  }
  const inverseDelta = inverseBig(deltaC, params.q, 'challenge difference');
  const alpha = modulo((first.zAlpha - second.zAlpha) * inverseDelta, params.q);
  const beta = modulo((first.zBeta - second.zBeta) * inverseDelta, params.q);
  const reconstructed = modpowBig(params.g, alpha, params.p) * modpowBig(params.h, beta, params.p) % params.p;
  return { alpha, beta, reconstructed, ok: reconstructed === first.u };
}

export const TOY_OKAMOTO_PARAMS = Object.freeze({ p: 47n, q: 23n, g: 4n, h: 9n });

/** @param {OkamotoWitness} witness @param {OkamotoParameters} params */
function toyStatement(witness, params) {
  return modpowBig(params.g, modulo(witness.alpha, params.q), params.p) *
    modpowBig(params.h, modulo(witness.beta, params.q), params.p) % params.p;
}

/**
 * Exhaustively enumerate transcript support for the toy group. `random` visits
 * all q challenges for every q^2 nonce pair; `adaptive` uses c = u_t mod q;
 * `fixed-nonce` is a deliberately invalid control distribution.
 * @param {OkamotoWitness} witness
 * @param {'random' | 'adaptive' | 'fixed-nonce'} verifierStrategy
 * @param {OkamotoParameters} [params]
 */
export function enumerateTranscripts(witness, verifierStrategy, params = TOY_OKAMOTO_PARAMS) {
  const u = toyStatement(witness, params);
  /** @type {string[]} */
  const transcripts = [];
  const alphaStart = verifierStrategy === 'fixed-nonce' ? 3n : 0n;
  const alphaEnd = verifierStrategy === 'fixed-nonce' ? 4n : params.q;
  const betaStart = verifierStrategy === 'fixed-nonce' ? 8n : 0n;
  const betaEnd = verifierStrategy === 'fixed-nonce' ? 9n : params.q;
  for (let alphaT = alphaStart; alphaT < alphaEnd; alphaT += 1n) {
    for (let betaT = betaStart; betaT < betaEnd; betaT += 1n) {
      const uT = modpowBig(params.g, alphaT, params.p) * modpowBig(params.h, betaT, params.p) % params.p;
      const challenges = verifierStrategy === 'adaptive'
        ? [uT % params.q]
        : Array.from({ length: Number(params.q) }, (_, index) => BigInt(index));
      for (const c of challenges) {
        const zAlpha = modulo(alphaT + witness.alpha * c, params.q);
        const zBeta = modulo(betaT + witness.beta * c, params.q);
        transcripts.push(`${u}:${uT}:${c}:${zAlpha}:${zBeta}`);
      }
    }
  }
  return transcripts.sort();
}

/** @param {string[]} left @param {string[]} right */
export function transcriptMultisetsEqual(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

/**
 * Fact 10.3: two distinct representations reveal log_g(h).
 * @param {OkamotoWitness} rep1
 * @param {OkamotoWitness} rep2
 * @param {bigint} q
 */
export function dlogFromTwoReps(rep1, rep2, q) {
  const denominator = modulo(rep2.beta - rep1.beta, q);
  if (denominator === 0n) throw new RangeError('representations must differ in beta');
  return modulo((rep1.alpha - rep2.alpha) * inverseBig(denominator, q, 'beta difference'), q);
}

/** @param {bigint} exponent */
function exponentBytes(exponent) {
  return bigIntToBytes(exponent);
}

/** @param {bigint} exponent */
async function generateWebCryptoRsa(exponent) {
  const generated = /** @type {CryptoKeyPair} */ (await globalThis.crypto.subtle.generateKey(
    {
      name: 'RSA-PSS',
      modulusLength: 2048,
      publicExponent: exponentBytes(exponent),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  ));
  const publicJwk = await globalThis.crypto.subtle.exportKey('jwk', generated.publicKey);
  if (!publicJwk.n) throw new Error('WebCrypto exported an RSA key without n');
  return { generated, N: base64UrlToBigInt(publicJwk.n) };
}

/**
 * Generate a real 2048-bit RSA modulus. Only N leaves this function. For e=3,
 * use WebCrypto directly when possible; the fallback screens p and q solely to
 * establish that cubing is a permutation, then discards them.
 * @param {bigint} e
 */
export async function gqKeygen(e) {
  if (e !== 3n && e !== 65537n) throw new RangeError('this exhibit supports prime e = 3 or 65537');
  try {
    const { N } = await generateWebCryptoRsa(e);
    return { N, e, generationPath: `WebCrypto generated the modulus with publicExponent = ${e}` };
  } catch (error) {
    if (e !== 3n) throw error;
  }

  for (let attempt = 1; attempt <= 32; attempt += 1) {
    const { generated, N } = await generateWebCryptoRsa(65537n);
    const privateJwk = await globalThis.crypto.subtle.exportKey('jwk', generated.privateKey);
    if (!privateJwk.p || !privateJwk.q) throw new Error('WebCrypto fallback JWK omitted p or q');
    const p = base64UrlToBigInt(privateJwk.p);
    const q = base64UrlToBigInt(privateJwk.q);
    if ((p - 1n) % 3n !== 0n && (q - 1n) % 3n !== 0n) {
      return {
        N,
        e,
        generationPath: `WebCrypto 65537 fallback; p and q screened for e = 3 and discarded (attempt ${attempt})`,
      };
    }
  }
  throw new Error('WebCrypto could not produce an RSA modulus where cubing is bijective after 32 attempts');
}

/**
 * @param {{ N: bigint, e: bigint }} params
 * @param {bigint} x
 * @param {bigint} challenge
 * @param {bigint} nonce
 * @returns {GqTranscript}
 */
export function gqProve(params, x, challenge, nonce) {
  if (gcdBig(x, params.N) !== 1n) throw new RangeError('x is not in Z*_N');
  if (gcdBig(nonce, params.N) !== 1n) throw new RangeError('x_t is not in Z*_N');
  if (challenge < 0n || challenge >= params.e) throw new RangeError('GQ challenge is outside {0, ..., e-1}');
  const y = modpowBig(x, params.e, params.N);
  const yT = modpowBig(nonce, params.e, params.N);
  const xZ = nonce * modpowBig(x, challenge, params.N) % params.N;
  return { y, yT, c: challenge, xZ };
}

/** @param {bigint} value @param {bigint} N @param {string} name */
function gqMemberFailure(value, N, name) {
  if (value <= 0n || value >= N) return `${name} is outside Z*_N`;
  const divisor = gcdBig(value, N);
  if (divisor !== 1n) return `${name} is not in Z*_N (gcd = ${divisor})`;
  return '';
}

/**
 * @param {{ N: bigint, e: bigint }} params
 * @param {GqTranscript} transcript
 * @returns {{ ok: boolean, lhs: bigint, rhs: bigint, reason: string }}
 */
export function gqVerify(params, transcript) {
  for (const [name, value] of [['y', transcript.y], ['y_t', transcript.yT], ['x_z', transcript.xZ]]) {
    const reason = gqMemberFailure(/** @type {bigint} */ (value), params.N, /** @type {string} */ (name));
    if (reason) return { ok: false, lhs: 0n, rhs: 0n, reason };
  }
  if (transcript.c < 0n || transcript.c >= params.e) {
    return { ok: false, lhs: 0n, rhs: 0n, reason: 'challenge c is outside {0, ..., e-1}' };
  }
  const lhs = modpowBig(transcript.xZ, params.e, params.N);
  const rhs = transcript.yT * modpowBig(transcript.y, transcript.c, params.N) % params.N;
  return { ok: lhs === rhs, lhs, rhs, reason: lhs === rhs ? 'equation holds' : 'verifier equation does not hold' };
}

/**
 * Extract an e-th root using Shamir's trick from two accepting transcripts.
 * @param {{ N: bigint, e: bigint }} params
 * @param {GqTranscript} first
 * @param {GqTranscript} second
 */
export function gqExtract(params, first, second) {
  if (first.y !== second.y || first.yT !== second.yT) {
    throw new RangeError('special soundness requires the same statement and commitment');
  }
  if (!gqVerify(params, first).ok || !gqVerify(params, second).ok) {
    throw new RangeError('both GQ transcripts must be accepting');
  }
  const deltaC = first.c - second.c;
  if (deltaC % params.e === 0n) {
    throw new RangeError('special soundness needs two different challenges modulo e');
  }
  const inverseSecond = inverseBig(second.xZ, params.N, 'second response x_z');
  const deltaX = first.xZ * inverseSecond % params.N;
  const divisor = gcdBig(deltaX, params.N);
  if (divisor !== 1n) {
    const detail = divisor > 1n && divisor < params.N ? `; found factor ${divisor}` : '';
    throw new RangeError(`response ratio is not in Z*_N (gcd = ${divisor}${detail})`);
  }
  const coefficients = egcd(params.e, deltaC);
  if (coefficients.gcd !== 1n) {
    throw new RangeError(`gcd(e, delta-c) = ${coefficients.gcd}, so Shamir's trick does not apply`);
  }
  const root = powSigned(first.y, coefficients.x, params.N) * powSigned(deltaX, coefficients.y, params.N) % params.N;
  return {
    root,
    deltaX,
    deltaC,
    s: coefficients.x,
    t: coefficients.y,
    check: modpowBig(root, params.e, params.N),
    ok: modpowBig(root, params.e, params.N) === first.y,
  };
}

/**
 * Construct the book's small-challenge forgery from public values only. This
 * function cannot receive the root x.
 * @param {bigint} y
 * @param {bigint} e
 * @param {bigint} N
 */
export function gqCheatingProver(y, e, N) {
  const reason = gqMemberFailure(y, N, 'y');
  if (reason) throw new RangeError(reason);
  const guessedChallenge = randomBelow(e);
  const xZ = randomUnit(N);
  const yPower = modpowBig(y, guessedChallenge, N);
  const yT = modpowBig(xZ, e, N) * inverseBig(yPower, N, 'y^c*') % N;
  return { y, yT, guessedChallenge, xZ };
}

/**
 * One real verifier attempt against a cheating prover. The prover sees only
 * public y, e and N; the verifier samples c after the commitment exists.
 * @param {bigint} y
 * @param {bigint} e
 * @param {bigint} N
 */
export function gqCheatAttempt(y, e, N) {
  const forged = gqCheatingProver(y, e, N);
  const verifierChallenge = randomBelow(e);
  const transcript = { y, yT: forged.yT, c: verifierChallenge, xZ: forged.xZ };
  const verification = gqVerify({ N, e }, transcript);
  return {
    ...forged,
    verifierChallenge,
    transcript,
    verification,
    accepted: verification.ok,
  };
}
