import { expect, test } from '@playwright/test';
import { createField, scriptedChallengeSource, seededChallengeSource } from '../js/field.js';
import { evaluatePolynomial, parsePolynomial } from '../js/polynomial.js';
import {
  createSumcheckProver,
  createSumcheckSession,
  createSumcheckVerifier,
  replaySumcheckTranscript,
} from '../js/sumcheck.js';
import { DEMO_CIRCUIT, createGkrProver, createGkrVerifier, runGkr } from '../js/gkr.js';

/**
 * Fast, named owners for Exhibit 08's nine source mutations. The replayable
 * mutation runner invokes one at a time with --retries=0 and requires the kill
 * to be an assertion in exactly this test. Each fixture is scripted or seeded,
 * so the verdict a mutation changes is deterministic.
 */

const field = createField(2147483647n);
const g = parsePolynomial(field, '2*x1^3 + x1*x3 + x2*x3');
const oracle = (point: bigint[]) => evaluatePolynomial(field, g, point);
/** r0; four layer-0 sum-check coins; r*; four layer-1 coins; r*. */
const fullGkrChallenges = [2n, 3n, 5n, 7n, 9n, 10n, 4n, 6n, 8n, 11n, 15n];

test('mutation oracle · sum-check verifier enforces the recurrence', () => {
  const prover = createSumcheckProver({ field, polynomial: g, strategy: { kind: 'wrong-sum-naive', offset: 1n } });
  const session = createSumcheckSession({ field, polynomial: g, prover, challengeSource: scriptedChallengeSource(field, [7n, 8n, 9n]) });
  const verdict = session.run();
  expect(verdict.accepted).toBe(false);
  expect(verdict.failedCheck).toBe('recurrence');
  expect(verdict.reason).toBe('round 1: s1(0) + s1(1) = 12 but the verifier expected 13 (the claimed sum)');
});

test('mutation oracle · sum-check verifier enforces the degree bound', () => {
  const prover = createSumcheckProver({ field, polynomial: g, strategy: { kind: 'excessive-degree', round: 2 } });
  const session = createSumcheckSession({ field, polynomial: g, prover, challengeSource: scriptedChallengeSource(field, [7n, 8n, 9n]) });
  const verdict = session.run();
  expect(verdict.accepted).toBe(false);
  expect(verdict.failedCheck).toBe('degree');
  expect(verdict.reason).toBe('round 2: the message has degree 3 but the degree bound for X2 is 1');
});

test('mutation oracle · sum-check verifier rejects a false final evaluation', () => {
  // Challenges 7, 8, 9 miss every root the carried lie can hide behind (2, 3, 4 in round 1; 2 in rounds 2 and 3).
  const prover = createSumcheckProver({ field, polynomial: g, strategy: { kind: 'wrong-sum-carried', offset: 5n } });
  const session = createSumcheckSession({ field, polynomial: g, prover, challengeSource: scriptedChallengeSource(field, [7n, 8n, 9n]) });
  const verdict = session.run();
  expect(session.verifier.checks().every((check) => check.ok)).toBe(true);
  expect(verdict.accepted).toBe(false);
  expect(verdict.failedCheck).toBe('final');
  const final = session.verifier.final();
  expect(final?.ok).toBe(false);
  expect(final?.evaluated).toBe(oracle(final!.point));
  expect(final?.claimed).not.toBe(final?.evaluated);
});

test('mutation oracle · GKR verifier evaluates the wiring it derived itself', () => {
  const inputs = [3n, 2n, 3n, 1n];
  const run = runGkr({ field, circuit: DEMO_CIRCUIT, inputs, prover: createGkrProver({ field, circuit: DEMO_CIRCUIT, inputs }), challengeSource: seededChallengeSource(field, 'mutation-wiring') });
  expect(run.accepted).toBe(true);
  expect(run.failedAt).toBeNull();
  expect(run.transcript.layers.map((layer) => layer.final?.ok)).toEqual([true, true]);
  expect(run.transcript.terminal?.ok).toBe(true);
});

test('mutation oracle · GKR verifier enforces the line-polynomial degree bound', () => {
  const inputs = [3n, 2n, 3n, 1n];
  const run = runGkr({
    field,
    circuit: DEMO_CIRCUIT,
    inputs,
    prover: createGkrProver({ field, circuit: DEMO_CIRCUIT, inputs, strategy: { kind: 'invalid-line', layer: 0, mode: 'degree' } }),
    // Keep enough verifier coins for the mutated guard to run through the
    // later semantic checks; source exhaustion must never masquerade as a kill.
    challengeSource: scriptedChallengeSource(field, fullGkrChallenges),
  });
  expect(run.accepted).toBe(false);
  expect(run.failedAt).toEqual({ stage: 'line-degree', layer: 0 });
  expect(run.reason).toBe('layer 0 line: q has degree 3 but W̃1 restricted to a line has degree at most 2');
});

test('mutation oracle · GKR terminal check is anchored to the public inputs', () => {
  const inputs = [3n, 2n, 3n, 1n];
  const challenges = [2n, 3n, 5n, 7n, 9n, 10n, 4n, 6n, 8n, 11n, 15n];
  const run = runGkr({
    field,
    circuit: DEMO_CIRCUIT,
    inputs,
    prover: createGkrProver({ field, circuit: DEMO_CIRCUIT, inputs, strategy: { kind: 'invalid-line', layer: 1, mode: 'value', offset: 1n } }),
    challengeSource: scriptedChallengeSource(field, challenges),
  });
  expect(run.accepted).toBe(false);
  expect(run.failedAt).toEqual({ stage: 'terminal', layer: 2 });
  expect(run.transcript.terminal?.ok).toBe(false);
  expect(run.transcript.terminal?.claim).not.toBe(run.transcript.terminal?.evaluated);
});

test('mutation oracle · GKR refuses verifier challenges outside its field', () => {
  const invalidSource = {
    kind: 'scripted' as const,
    label: 'invalid mutation fixture',
    draw: () => field.p,
  };
  const verifier = createGkrVerifier({
    field,
    circuit: DEMO_CIRCUIT,
    inputs: [3n, 2n, 3n, 1n],
    challengeSource: invalidSource,
  });
  // Exercise GKR's own r0 guard directly. If that guard is removed, this call
  // succeeds; a downstream sum-check guard cannot accidentally kill the mutant.
  expect(() => verifier.receiveOutputs([18n, 4n])).toThrow('the challenge source returned a value outside the field');
});

test('mutation oracle · a challenge cannot be drawn before its prover message', () => {
  const verifier = createSumcheckVerifier({ field, degreeBounds: [3, 1, 1], claimedSum: 12n, challengeSource: scriptedChallengeSource(field, [2n, 3n, 6n]) });
  expect(verifier.receiveMessage([1n, 2n, 0n, 8n]).ok).toBe(true);
  expect(verifier.drawChallenge()).toBe(2n);
  // Round 2's message has not arrived: drawing its challenge now must be refused, not silently redraw round 1's.
  expect(() => verifier.drawChallenge()).toThrow('cannot be drawn before the prover\'s round-2 message');
  expect(verifier.transcript().rounds[0].challenge).toBe(2n);
  const fresh = createSumcheckVerifier({ field, degreeBounds: [3, 1, 1], claimedSum: 12n, challengeSource: scriptedChallengeSource(field, [2n]) });
  expect(() => fresh.drawChallenge()).toThrow('cannot be drawn before the prover\'s round-1 message');
});

test('mutation oracle · transcript replay refuses a truncated transcript', () => {
  const session = createSumcheckSession({ field, polynomial: g, prover: createSumcheckProver({ field, polynomial: g }), challengeSource: scriptedChallengeSource(field, [2n, 3n, 6n]) });
  session.run();
  const transcript = session.verifier.transcript();
  const truncated = { ...transcript, rounds: transcript.rounds.slice(0, 2) };
  let outcome: ReturnType<typeof replaySumcheckTranscript> | undefined;
  expect(() => {
    outcome = replaySumcheckTranscript({ field, transcript: truncated, oracle, expectedDegreeBounds: [3, 1, 1] });
  }).not.toThrow();
  expect(outcome?.ok).toBe(false);
  expect(outcome?.reason).toBe('malformed transcript: 2 rounds recorded but the statement has 3 variables');
});
