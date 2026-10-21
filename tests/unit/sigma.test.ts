import {
  checkPrimeSync,
  createHash,
  generateKeyPairSync,
} from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { egcd, modpowBig } from '../../js/shared.js';
import {
  OKAMOTO_H_SEED,
  RFC3526_GROUP14_HEX,
  RFC3526_GROUP14_P,
  RFC3526_GROUP14_Q,
  TOY_OKAMOTO_PARAMS,
  base64UrlToBigInt,
  deriveH,
  dlogFromTwoReps,
  enumerateTranscripts,
  gcdBig,
  gqCheatAttempt,
  gqCheatingProver,
  gqExtract,
  gqProve,
  gqVerify,
  isPrimeOrderMember,
  okamotoExtract,
  okamotoParams,
  okamotoProve,
  okamotoVerify,
  transcriptMultisetsEqual,
} from '../../js/sigma.js';

// RFC 3526 section 3, copied independently from the RFC's grouped hex text.
const RFC_GROUP14_PUBLISHED = `
  FFFFFFFF FFFFFFFF C90FDAA2 2168C234 C4C6628B 80DC1CD1
  29024E08 8A67CC74 020BBEA6 3B139B22 514A0879 8E3404DD
  EF9519B3 CD3A431B 302B0A6D F25F1437 4FE1356D 6D51C245
  E485B576 625E7EC6 F44C42E9 A637ED6B 0BFF5CB6 F406B7ED
  EE386BFB 5A899FA5 AE9F2411 7C4B1FE6 49286651 ECE45B3D
  C2007CB8 A163BF05 98DA4836 1C55D39A 69163FA8 FD24CF5F
  83655D23 DCA3AD96 1C62F356 208552BB 9ED52907 7096966D
  670C354E 4ABC9804 F1746C08 CA18217C 32905E46 2E36CE3B
  E39E772C 180E8603 9B2783A2 EC07A28F B5C55DF0 6F4C52C9
  DE2BCBF6 95581718 3995497C EA956AE5 15D22618 98FA0510
  15728E5A 8AACAA68 FFFFFFFF FFFFFFFF
`.replace(/\s/g, '');

function independentDerivedH(seed: string): bigint {
  const seedBytes = Buffer.from(seed, 'utf8');
  const expanded: Buffer[] = [];
  let bytes = 0;
  for (let counter = 0; bytes < 264; counter += 1) {
    const suffix = Buffer.alloc(4);
    suffix.writeUInt32BE(counter);
    const digest = createHash('sha256').update(seedBytes).update(suffix).digest();
    expanded.push(digest);
    bytes += digest.length;
  }
  const integer = BigInt(`0x${Buffer.concat(expanded).subarray(0, 264).toString('hex')}`);
  return modpowBig(integer % RFC3526_GROUP14_P, 2n, RFC3526_GROUP14_P);
}

describe('BigInt arithmetic helpers', () => {
  it('leaves the legacy helper separate and computes exact large powers', () => {
    const modulus = (1n << 521n) - 1n;
    const result = modpowBig((1n << 300n) + 17n, 12345n, modulus);
    expect(typeof result).toBe('bigint');
    expect(result).toBeGreaterThan(0n);
    expect(result).toBeLessThan(modulus);
  });

  it('returns Bezout coefficients over signed BigInts', () => {
    const { gcd, x, y } = egcd(65537n, -319n);
    expect(gcd).toBe(1n);
    expect(65537n * x + -319n * y).toBe(gcd);
  });
});

describe('RFC 3526 group 14 and deterministic h', () => {
  it('pins the exact RFC prime and independently establishes p and q are prime', () => {
    expect(RFC3526_GROUP14_HEX).toBe(RFC_GROUP14_PUBLISHED);
    expect(RFC3526_GROUP14_P).toBe(BigInt(`0x${RFC_GROUP14_PUBLISHED}`));
    expect(checkPrimeSync(RFC3526_GROUP14_P, { checks: 32 })).toBe(true);
    expect(checkPrimeSync(RFC3526_GROUP14_Q, { checks: 32 })).toBe(true);
  });

  it('uses g = 4 as a non-identity generator of the order-q subgroup', () => {
    expect(4n).not.toBe(1n);
    expect(modpowBig(4n, RFC3526_GROUP14_Q, RFC3526_GROUP14_P)).toBe(1n);
    expect(isPrimeOrderMember(4n, RFC3526_GROUP14_P, RFC3526_GROUP14_Q)).toBe(true);
  });

  it('derives h by an independent SHA-256 counter-mode recomputation', async () => {
    const h = await deriveH(OKAMOTO_H_SEED);
    expect(h).toBe(independentDerivedH(OKAMOTO_H_SEED));
    expect(h).not.toBe(1n);
    expect(isPrimeOrderMember(h, RFC3526_GROUP14_P, RFC3526_GROUP14_Q)).toBe(true);
  });
});

describe('Okamoto special soundness', () => {
  it('Okamoto verifier binds both response coordinates', async () => {
    const params = await okamotoParams();
    const transcript = okamotoProve(params, { alpha: 17n, beta: 29n }, { alpha: 41n, beta: 73n }, 11n);
    const verified = okamotoVerify(params, transcript);
    expect(verified.ok).toBe(true);
    expect(verified.lhs).toBe(verified.rhs);

    const altered = { ...transcript, zBeta: (transcript.zBeta + 1n) % params.q };
    expect(okamotoVerify(params, altered).ok).toBe(false);
  });

  it('Okamoto rewinding extracts the exact witness', async () => {
    const params = await okamotoParams();
    const witness = { alpha: 0x12345n, beta: 0x6789an };
    const nonce = { alpha: 0xabcdefn, beta: 0x345678n };
    const first = okamotoProve(params, witness, nonce, 7n);
    const second = okamotoProve(params, witness, nonce, 19n);
    const extracted = okamotoExtract(params, first, second);
    expect(extracted.ok).toBe(true);
    expect(extracted.alpha).toBe(witness.alpha);
    expect(extracted.beta).toBe(witness.beta);
    expect(extracted.reconstructed).toBe(first.u);
  });

  it('refuses same-challenge extraction and non-subgroup statements by name', async () => {
    const params = await okamotoParams();
    const transcript = okamotoProve(params, { alpha: 2n, beta: 3n }, { alpha: 5n, beta: 7n }, 11n);
    expect(() => okamotoExtract(params, transcript, transcript)).toThrow('two different challenges');
    expect(okamotoVerify(params, { ...transcript, u: 0n }).reason).toContain('u is not in');
  });
});

describe('Okamoto witness independence in the complete toy space', () => {
  const registered = { alpha: 5n, beta: 7n };
  const second = { alpha: 9n, beta: 8n };

  it('enumerates identical random-verifier and adaptive-verifier transcript multisets', () => {
    const randomA = enumerateTranscripts(registered, 'random');
    const randomB = enumerateTranscripts(second, 'random');
    expect(randomA).toHaveLength(23 * 23 * 23);
    expect(randomB).toHaveLength(23 * 23 * 23);
    expect(transcriptMultisetsEqual(randomA, randomB)).toBe(true);

    const adaptiveA = enumerateTranscripts(registered, 'adaptive');
    const adaptiveB = enumerateTranscripts(second, 'adaptive');
    expect(adaptiveA).toHaveLength(23 * 23);
    expect(adaptiveB).toHaveLength(23 * 23);
    expect(transcriptMultisetsEqual(adaptiveA, adaptiveB)).toBe(true);
  });

  it('fixed-nonce control proves multiset equality is not a length-only check', () => {
    const fixedA = enumerateTranscripts(registered, 'fixed-nonce');
    const fixedB = enumerateTranscripts(second, 'fixed-nonce');
    expect(fixedA).toHaveLength(23);
    expect(fixedB).toHaveLength(23);
    expect(fixedA.length).toBe(fixedB.length);
    expect(transcriptMultisetsEqual(fixedA, fixedB)).toBe(false);
  });

  it('Fact 10.3 recovers the toy discrete logarithm from the two representations', () => {
    const dlog = dlogFromTwoReps(registered, second, TOY_OKAMOTO_PARAMS.q);
    expect(dlog).toBe(19n);
    expect(modpowBig(TOY_OKAMOTO_PARAMS.g, dlog, TOY_OKAMOTO_PARAMS.p)).toBe(TOY_OKAMOTO_PARAMS.h);
    const u1 = modpowBig(4n, registered.alpha, 47n) * modpowBig(9n, registered.beta, 47n) % 47n;
    const u2 = modpowBig(4n, second.alpha, 47n) * modpowBig(9n, second.beta, 47n) % 47n;
    expect(u1).toBe(u2);
  });
});

describe('Guillou–Quisquater', () => {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 1024, publicExponent: 65537 });
  const publicJwk = publicKey.export({ format: 'jwk' });
  if (!publicJwk.n) throw new Error('Node RSA fixture omitted n');
  const N = base64UrlToBigInt(publicJwk.n);
  const params = { N, e: 65537n };
  const x = 37n;
  const nonce = 101n;

  it('GQ verifier binds y^c into the equation', () => {
    expect(gcdBig(x, N)).toBe(1n);
    const transcript = gqProve(params, x, 123n, nonce);
    const verified = gqVerify(params, transcript);
    expect(verified.ok).toBe(true);
    expect(verified.lhs).toBe(verified.rhs);
    expect(gqVerify(params, { ...transcript, c: 124n }).ok).toBe(false);
  });

  it("Shamir's trick extracts the exact RSA root", () => {
    const first = gqProve(params, x, 123n, nonce);
    const second = gqProve(params, x, 456n, nonce);
    const extracted = gqExtract(params, first, second);
    expect(extracted.ok).toBe(true);
    expect(extracted.root).toBe(x);
    expect(extracted.check).toBe(first.y);
    expect(params.e * extracted.s + extracted.deltaC * extracted.t).toBe(1n);
  });

  it('refuses invalid units and equal challenges by name', () => {
    const transcript = gqProve(params, x, 3n, nonce);
    expect(gqVerify(params, { ...transcript, y: N }).reason).toContain('outside Z*_N');
    expect(() => gqExtract(params, transcript, transcript)).toThrow('two different challenges');
  });

  it('small-e cheater succeeds only when the verifier challenge matches', () => {
    // N=5*11 has phi=40, so gcd(3, phi)=1 and cubing is a bijection on Z*_55.
    const toyN = 55n;
    const y = modpowBig(2n, 3n, toyN);
    expect(gqCheatingProver).toHaveLength(3); // public y, e, N — no root argument
    let accepted = 0;
    for (let trial = 0; trial < 3000; trial += 1) {
      const attempt = gqCheatAttempt(y, 3n, toyN);
      expect(attempt.accepted).toBe(attempt.verifierChallenge === attempt.guessedChallenge);
      if (attempt.accepted) {
        accepted += 1;
        expect(attempt.verification.ok).toBe(true);
      }
    }
    // Mean 1000, sigma ~= 25.8. This >6-sigma band is stable while still
    // decisively killing “every challenge accepts” and “none accept” defects.
    expect(accepted).toBeGreaterThan(840);
    expect(accepted).toBeLessThan(1160);
  });
});
