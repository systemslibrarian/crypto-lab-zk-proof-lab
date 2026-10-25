import { describe, expect, it } from 'vitest';
import { createField, freshChallengeSource, scriptedChallengeSource, seededChallengeSource } from '../../js/field.js';
import {
  evaluatePolynomial,
  evaluateUnivariate,
  formatPolynomial,
  formatUnivariate,
  hypercubeSum,
  interpolateUnivariate,
  parsePolynomial,
  partialSumUnivariate,
  variableDegrees,
} from '../../js/polynomial.js';
import {
  createSumcheckProver,
  createSumcheckSession,
  createSumcheckVerifier,
  liePolynomialUnit,
  parseTranscript,
  replaySumcheckTranscript,
  serializeTranscript,
  soundnessBound,
  sumcheckCensus,
  univariateAgreement,
} from '../../js/sumcheck.js';

const P = 2147483647n;
const field = createField(P);

// Thaler, Proofs, Arguments, and Zero-Knowledge (2023-07-18), §4.1 worked example.
const THALER_TEXT = '2*x1^3 + x1*x3 + x2*x3';
const thaler = parsePolynomial(field, THALER_TEXT);

/** An independent evaluator written from the exponent table, not from the module's code. */
function independentHypercubeSum(p: bigint, terms: Array<[bigint, number[]]>, variables: number): bigint {
  let total = 0n;
  for (let label = 0; label < 1 << variables; label += 1) {
    const point = Array.from({ length: variables }, (_, i) => BigInt((label >> (variables - 1 - i)) & 1));
    for (const [coefficient, exponents] of terms) {
      let value = coefficient;
      exponents.forEach((e, i) => { value = (value * point[i] ** BigInt(e)) % p; });
      total = (total + value) % p;
    }
  }
  return total;
}

const oracle = (point: bigint[]) => evaluatePolynomial(field, thaler, point);

describe('polynomial parsing and arithmetic', () => {
  it('parses, canonicalises and re-formats the example polynomial', () => {
    expect(formatPolynomial(thaler)).toBe('2*x1^3 + x1*x3 + x2*x3');
    expect(thaler.variables).toBe(3);
    expect(variableDegrees(thaler)).toEqual([3, 1, 1]);
    expect(formatPolynomial(parsePolynomial(field, ' x2 x1 - 3*x1 + 3 x1 + x1x2 '))).toBe('2*x1*x2');
    expect(formatPolynomial(parsePolynomial(createField(7n), '9*x1 - 2 + 3'))).toBe('2*x1 + 1');
  });

  it('refuses malformed polynomials with a named position', () => {
    expect(() => parsePolynomial(field, '')).toThrow('empty');
    expect(() => parsePolynomial(field, '2*x1^3 + + x2')).toThrow('position');
    expect(() => parsePolynomial(field, 'x1 * ')).toThrow('incomplete term');
    expect(() => parsePolynomial(field, 'x1^+2')).toThrow('integer exponent');
    expect(() => parsePolynomial(field, 'x1 ^ y')).toThrow('unexpected "y" at position 6');
    expect(() => parsePolynomial(field, 'x7')).toThrow('outside x1..x6');
    expect(() => parsePolynomial(field, 'x1^9')).toThrow('exceeds the limit');
    expect(() => parsePolynomial(field, '42')).toThrow('at least one variable');
    expect(() => parsePolynomial(field, '2x1 + 3 -')).toThrow('dangling sign');
    expect(() => parsePolynomial(field, 'x1 $ x2')).toThrow('unexpected "$"');
  });

  it('derives the Boolean-hypercube sum of the example independently: H = 12', () => {
    expect(hypercubeSum(field, thaler)).toBe(12n);
    expect(independentHypercubeSum(P, [[2n, [3, 0, 0]], [1n, [1, 0, 1]], [1n, [0, 1, 1]]], 3)).toBe(12n);
    // and a second, larger polynomial, both ways
    const g = parsePolynomial(field, '5*x1^2*x4 + 7*x2*x3 + x1 + 11');
    expect(hypercubeSum(field, g)).toBe(independentHypercubeSum(P, [[5n, [2, 0, 0, 1]], [7n, [0, 1, 1, 0]], [1n, [1, 0, 0, 0]], [11n, [0, 0, 0, 0]]], 4));
  });

  it('reproduces the honest prover messages of Thaler\'s walkthrough exactly', () => {
    expect(formatUnivariate(partialSumUnivariate(field, thaler, [], 1))).toBe('8*X^3 + 2*X + 1');
    expect(formatUnivariate(partialSumUnivariate(field, thaler, [2n], 2))).toBe('X + 34');
    expect(formatUnivariate(partialSumUnivariate(field, thaler, [2n, 3n], 3))).toBe('5*X + 16');
    expect(evaluateUnivariate(field, [16n, 5n], 6n)).toBe(evaluatePolynomial(field, thaler, [2n, 3n, 6n]));
    expect(evaluateUnivariate(field, [1n, 2n, 0n, 8n], 2n)).toBe(69n); // s1(2) = 34 + 35
  });

  it('interpolates through points exactly', () => {
    const coefficients = interpolateUnivariate(field, [0n, 1n, 2n, 3n], [1n, 11n, 69n, 223n]);
    expect(coefficients).toEqual([1n, 2n, 0n, 8n]);
    expect(() => interpolateUnivariate(field, [1n, 1n], [0n, 0n])).toThrow('distinct');
  });
});

describe('honest sum-check', () => {
  it('accepts with scripted challenges and prints a transcript that re-verifies by hand', () => {
    const prover = createSumcheckProver({ field, polynomial: thaler });
    const session = createSumcheckSession({ field, polynomial: thaler, prover, challengeSource: scriptedChallengeSource(field, [2n, 3n, 6n]) });
    const verdict = session.run();
    expect(verdict.accepted).toBe(true);
    const transcript = session.verifier.transcript();
    expect(transcript.rounds.map((round) => round.polynomial)).toEqual([[1n, 2n, 0n, 8n], [34n, 1n], [16n, 5n]]);
    expect(transcript.rounds.map((round) => round.challenge)).toEqual([2n, 3n, 6n]);
    // Every recurrence by hand: s1(0)+s1(1) = 12; s2(0)+s2(1) = s1(2) = 69; s3(0)+s3(1) = s2(3) = 37; s3(6) = g(2,3,6).
    expect(1n + 11n).toBe(12n);
    expect(34n + 35n).toBe(69n);
    expect(16n + 21n).toBe(37n);
    expect(evaluateUnivariate(field, [16n, 5n], 6n)).toBe(46n);
    expect(evaluatePolynomial(field, thaler, [2n, 3n, 6n])).toBe(46n);
    expect(verdict.reason).toContain('equals g(r) = 46');
  });

  it('accepts under fresh randomness and under a seeded source, and the sources differ', () => {
    const fresh = createSumcheckSession({ field, polynomial: thaler, prover: createSumcheckProver({ field, polynomial: thaler }), challengeSource: freshChallengeSource(field) });
    expect(fresh.run().accepted).toBe(true);
    const seededA = createSumcheckSession({ field, polynomial: thaler, prover: createSumcheckProver({ field, polynomial: thaler }), challengeSource: seededChallengeSource(field, 'seed-a') });
    const seededB = createSumcheckSession({ field, polynomial: thaler, prover: createSumcheckProver({ field, polynomial: thaler }), challengeSource: seededChallengeSource(field, 'seed-a') });
    expect(seededA.run().accepted).toBe(true);
    expect(seededB.run().accepted).toBe(true);
    expect(seededA.verifier.transcript()).toEqual(seededB.verifier.transcript());
    expect(fresh.verifier.transcript().rounds.map((round) => round.challenge)).not.toEqual(seededA.verifier.transcript().rounds.map((round) => round.challenge));
    // The seeded source is the deterministic teaching mode, labelled as such.
    expect(seededChallengeSource(field, 'seed-a').label).toMatch(/not cryptographically secure/);
  });

  it('exposes the soundness bound v·d/|F| and flags it vacuous when it exceeds one', () => {
    expect(soundnessBound(field, [3, 1, 1])).toMatchObject({ variables: 3, maxDegree: 3, numerator: 9n, denominator: P, vacuous: false });
    expect(soundnessBound(createField(5n), [3, 1, 1])).toMatchObject({ numerator: 9n, denominator: 5n, vacuous: true });
  });
});

describe('cheating provers against the same verifier', () => {
  const seeded = () => seededChallengeSource(field, 'cheat');

  it('a wrong initial sum with honest messages fails round 1\'s recurrence', () => {
    const prover = createSumcheckProver({ field, polynomial: thaler, strategy: { kind: 'wrong-sum-naive', offset: 1n } });
    expect(prover.claimedSum()).toBe(13n);
    const verdict = createSumcheckSession({ field, polynomial: thaler, prover, challengeSource: seeded() }).run();
    expect(verdict.accepted).toBe(false);
    expect(verdict.failedCheck).toBe('recurrence');
    expect(verdict.reason).toBe('round 1: s1(0) + s1(1) = 12 but the verifier expected 13 (the claimed sum)');
  });

  it('a wrong sum carried consistently through every recurrence is caught by the final oracle evaluation', () => {
    const prover = createSumcheckProver({ field, polynomial: thaler, strategy: { kind: 'wrong-sum-carried', offset: 5n } });
    const session = createSumcheckSession({ field, polynomial: thaler, prover, challengeSource: seeded() });
    const verdict = session.run();
    expect(verdict.accepted).toBe(false);
    expect(verdict.failedCheck).toBe('final');
    expect(session.verifier.checks().every((check) => check.ok)).toBe(true);
    const final = session.verifier.final();
    expect(final?.ok).toBe(false);
    expect(final?.evaluated).toBe(oracle(final!.point));
    expect(verdict.reason).toMatch(/^final check: s3\(r3\) = \d+ but the direct evaluation g\(r\) = \d+$/);
  });

  it('an inconsistent message at round j fails round j\'s recurrence and names the previous value', () => {
    const prover = createSumcheckProver({ field, polynomial: thaler, strategy: { kind: 'inconsistent-round', round: 2, offset: 1n } });
    const session = createSumcheckSession({ field, polynomial: thaler, prover, challengeSource: seeded() });
    const verdict = session.run();
    expect(verdict.accepted).toBe(false);
    expect(verdict.failedCheck).toBe('recurrence');
    expect(verdict.reason).toMatch(/^round 2: s2\(0\) \+ s2\(1\) = \d+ but the verifier expected \d+ \(s1\(r1\)\)$/);
    expect(session.verifier.transcript().rounds).toHaveLength(1);
    // δ on the constant term shifts s2(0) + s2(1) by exactly 2δ.
    const refused = session.verifier.checks()[1];
    expect(refused.sumAt01).toBe(field.add(refused.expected, 2n));
  });

  it('a message above the degree bound is refused on the degree check even though its recurrence holds', () => {
    const prover = createSumcheckProver({ field, polynomial: thaler, strategy: { kind: 'excessive-degree', round: 2 } });
    const message = prover.message(2, [2n]);
    expect(message).toHaveLength(4);
    expect(field.add(evaluateUnivariate(field, message, 0n), evaluateUnivariate(field, message, 1n))).toBe(69n);
    const verdict = createSumcheckSession({ field, polynomial: thaler, prover, challengeSource: seeded() }).run();
    expect(verdict.accepted).toBe(false);
    expect(verdict.failedCheck).toBe('degree');
    expect(verdict.reason).toBe('round 2: the message has degree 3 but the degree bound for X2 is 1');
  });

  it('the lie polynomial has d roots and sums to 1 on {0,1}', () => {
    const unit = liePolynomialUnit(field, 3);
    expect(unit.roots).toEqual([2n, 3n, 4n]);
    expect(field.add(evaluateUnivariate(field, unit.polynomial, 0n), evaluateUnivariate(field, unit.polynomial, 1n))).toBe(1n);
    for (const root of unit.roots) expect(evaluateUnivariate(field, unit.polynomial, root)).toBe(0n);
    expect(liePolynomialUnit(field, 0).polynomial).toEqual([field.inv(2n)]);
  });
});

describe('verifier ordering and malformed transcripts', () => {
  it('refuses to draw a challenge before its message, and to accept a message before the previous challenge', () => {
    const verifier = createSumcheckVerifier({ field, degreeBounds: [3, 1, 1], claimedSum: 12n, challengeSource: scriptedChallengeSource(field, [2n, 3n, 6n]) });
    expect(() => verifier.drawChallenge()).toThrow('cannot be drawn before the prover\'s round-1 message');
    expect(verifier.receiveMessage([1n, 2n, 0n, 8n]).ok).toBe(true);
    expect(() => verifier.receiveMessage([34n, 1n])).toThrow('protocol order');
    expect(() => verifier.finish(oracle)).toThrow('protocol order');
    expect(verifier.drawChallenge()).toBe(2n);
    expect(() => verifier.drawChallenge()).toThrow('cannot be drawn before the prover\'s round-2 message');
    expect(verifier.receiveMessage([34n, 1n]).ok).toBe(true);
    expect(verifier.drawChallenge()).toBe(3n);
    expect(verifier.receiveMessage([16n, 5n]).ok).toBe(true);
    expect(verifier.drawChallenge()).toBe(6n);
    expect(() => verifier.receiveMessage([1n])).toThrow('protocol order');
    expect(verifier.finish(oracle).ok).toBe(true);
    expect(() => verifier.finish(oracle)).toThrow('protocol order');
  });

  it('a non-canonical or empty message is refused as malformed before any arithmetic', () => {
    const verifier = createSumcheckVerifier({ field, degreeBounds: [3, 1, 1], claimedSum: 12n, challengeSource: freshChallengeSource(field) });
    const check = verifier.receiveMessage([1n, P, 0n, 8n]);
    expect(check.ok).toBe(false);
    expect(check.failedCheck).toBe('shape');
    expect(verifier.phase).toBe('rejected');
    expect(createSumcheckVerifier({ field, degreeBounds: [1], claimedSum: 0n, challengeSource: freshChallengeSource(field) }).receiveMessage([]).failedCheck).toBe('shape');
    expect(createSumcheckVerifier({ field, degreeBounds: [1], claimedSum: 0n, challengeSource: freshChallengeSource(field) }).receiveMessage('1,2').failedCheck).toBe('shape');
  });

  const honestTranscript = () => {
    const session = createSumcheckSession({ field, polynomial: thaler, prover: createSumcheckProver({ field, polynomial: thaler }), challengeSource: scriptedChallengeSource(field, [2n, 3n, 6n]) });
    session.run();
    return session.verifier.transcript();
  };
  const replay = (transcript: unknown) => replaySumcheckTranscript({ field, transcript, oracle, expectedDegreeBounds: [3, 1, 1] });

  it('round-trips an honest transcript through JSON and accepts it on replay', () => {
    const transcript = honestTranscript();
    const parsed = parseTranscript(serializeTranscript(transcript));
    expect(parsed).toEqual(transcript);
    const result = replay(parsed);
    expect(result.ok).toBe(true);
    expect(result.checks).toHaveLength(3);
  });

  it('fails closed, by name, on truncated, extended, reordered, challenge-first, non-canonical and foreign transcripts', () => {
    const base = honestTranscript();
    const truncated = { ...base, rounds: base.rounds.slice(0, 2) };
    expect(replay(truncated)).toMatchObject({ ok: false, failedCheck: 'shape', reason: 'malformed transcript: 2 rounds recorded but the statement has 3 variables' });
    const extended = { ...base, rounds: [...base.rounds, { round: 4, polynomial: [1n], challenge: 1n }] };
    expect(replay(extended).reason).toBe('malformed transcript: 4 rounds recorded but the statement has 3 variables');
    const reordered = { ...base, rounds: [base.rounds[1], base.rounds[0], base.rounds[2]] };
    expect(replay(reordered).reason).toBe('malformed transcript: entry 1 is labelled round 2: rounds are out of order');
    const challengeFirst = { ...base, rounds: [{ round: 1, polynomial: [], challenge: 2n }, base.rounds[1], base.rounds[2]] };
    expect(replay(challengeFirst).reason).toBe('malformed transcript: round 1 records a challenge without a prover message');
    const unanswered = { ...base, rounds: [base.rounds[0], base.rounds[1], { ...base.rounds[2], challenge: null }] };
    expect(replay(unanswered).reason).toBe('malformed transcript: round 3 has no canonical challenge recorded after its message');
    const nonCanonical = { ...base, rounds: [{ ...base.rounds[0], polynomial: [1n, 2n, 0n, P] }, base.rounds[1], base.rounds[2]] };
    expect(replay(nonCanonical).reason).toBe('malformed transcript: round 1 has a coefficient that is not a canonical field element');
    const looserBounds = { ...base, degreeBounds: [3, 3, 3] };
    expect(replay(looserBounds).reason).toBe('malformed transcript: degree bounds [3, 3, 3] do not match the statement\'s [3, 1, 1]');
    expect(replay({ ...base, modulus: 13n }).reason).toBe(`malformed transcript: modulus 13 is not the current field's ${P}`);
    expect(replay({ ...base, protocol: 'gkr' }).reason).toBe('malformed transcript: protocol is not "sum-check"');
    expect(replay(null).reason).toBe('malformed transcript: not an object');
    expect(replay([]).reason).toBe('malformed transcript: not an object');
    expect(() => parseTranscript('{ not json')).toThrow();
  });

  it('a message mutated after its challenge was drawn is caught on replay at the next recurrence or the final check', () => {
    const base = honestTranscript();
    const mutatedRound1 = { ...base, rounds: [{ ...base.rounds[0], polynomial: [1n, 2n, 1n, 7n] }, base.rounds[1], base.rounds[2]] };
    const first = replay(mutatedRound1);
    expect(first.ok).toBe(false);
    expect(first.failedCheck).toBe('recurrence');
    expect(first.reason).toMatch(/^round 2: /);
    // s3' = 17 + 3X keeps s3'(0) + s3'(1) = 37 = s2(3), so only the final evaluation can catch it: s3'(6) = 35 ≠ g(2,3,6) = 46.
    const mutatedRound3 = { ...base, rounds: [base.rounds[0], base.rounds[1], { ...base.rounds[2], polynomial: [17n, 3n] }] };
    const last = replay(mutatedRound3);
    expect(last.ok).toBe(false);
    expect(last.checks.every((check) => check.ok)).toBe(true);
    expect(last.failedCheck).toBe('final');
    expect(last.reason).toBe('final check: s3(r3) = 35 but the direct evaluation g(r) = 46');
  });
});

describe('tiny-field exhaustive census (a teaching control, not a security parameter)', () => {
  const tiny = createField(13n);
  const h = parsePolynomial(tiny, 'x1*x2 + 3*x1^2'); // degrees [2, 1]
  const census = (strategy?: Parameters<typeof createSumcheckProver>[0]['strategy']) =>
    sumcheckCensus({ field: tiny, polynomial: h, makeProver: () => createSumcheckProver({ field: tiny, polynomial: h, strategy }) });

  it('the honest prover is accepted on every one of the 169 challenge vectors', () => {
    const result = census();
    expect(result).toMatchObject({ total: 169, accepted: 169, degree: 0, recurrence: 0, final: 0 });
    expect(result.bound).toMatchObject({ numerator: 4n, denominator: 13n });
  });

  it('the carried lie is accepted on exactly p^v − Π(p − d_j) vectors, under the v·d/|F| bound, and only via the final check', () => {
    const result = census({ kind: 'wrong-sum-carried', offset: 4n });
    const expected = 13 * 13 - (13 - 2) * (13 - 1);
    expect(expected).toBe(37);
    expect(result).toMatchObject({ total: 169, accepted: expected, final: 169 - expected, degree: 0, recurrence: 0 });
    expect(result.accepted / result.total).toBeLessThanOrEqual(result.bound.value);
    // Every accepting vector hits a root of the round-1 lie (2 or 3) or of the round-2 lie (2).
    for (const vector of result.acceptingVectors) {
      expect(vector[0] === 2n || vector[0] === 3n || vector[1] === 2n).toBe(true);
    }
  });

  it('a degree-(p−1) interpolant that agrees with the honest message everywhere but one point is rejected on the degree bound at every vector', () => {
    const attack = createSumcheckProver({ field: tiny, polynomial: h, strategy: { kind: 'lagrange-degree-attack', offset: 4n } }).message(1, []);
    const honest = partialSumUnivariate(tiny, h, [], 1);
    expect(attack).toHaveLength(13);
    expect(univariateAgreement(tiny, attack, honest)).toBe(12);
    expect(tiny.add(evaluateUnivariate(tiny, attack, 0n), evaluateUnivariate(tiny, attack, 1n))).toBe(tiny.add(hypercubeSum(tiny, h), 4n));
    expect(census({ kind: 'lagrange-degree-attack', offset: 4n })).toMatchObject({ total: 169, accepted: 0, degree: 169 });
  });
});
