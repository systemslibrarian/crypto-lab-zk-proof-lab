import { expect, test } from '@playwright/test';
import {
  TOY_OKAMOTO_PARAMS,
  enumerateTranscripts,
  gqCheatAttempt,
  gqExtract,
  gqProve,
  gqVerify,
  okamotoExtract,
  okamotoProve,
  okamotoVerify,
  transcriptMultisetsEqual,
} from '../js/sigma.js';

/**
 * Fast, named owners for Exhibit 07's six rendered verdicts. The replayable
 * mutation runner invokes one at a time with --retries=0. Browser claims still
 * exercise the DOM; these small arithmetic fixtures make each mutation fail
 * immediately instead of waiting on RSA generation or a UI timeout.
 */

test('mutation oracle · Okamoto verification keeps the h term', () => {
  const proof = okamotoProve(
    TOY_OKAMOTO_PARAMS,
    { alpha: 5n, beta: 7n },
    { alpha: 3n, beta: 8n },
    11n,
  );
  const result = okamotoVerify(TOY_OKAMOTO_PARAMS, proof);
  expect(result.ok).toBe(true);
  expect(result.lhs).toBe(result.rhs);
});

test('mutation oracle · Okamoto extraction keeps delta-c sign', () => {
  const witness = { alpha: 5n, beta: 7n };
  const nonce = { alpha: 3n, beta: 8n };
  const first = okamotoProve(TOY_OKAMOTO_PARAMS, witness, nonce, 4n);
  const second = okamotoProve(TOY_OKAMOTO_PARAMS, witness, nonce, 11n);
  const extracted = okamotoExtract(TOY_OKAMOTO_PARAMS, first, second);
  expect(extracted.ok).toBe(true);
  expect(extracted.alpha).toBe(witness.alpha);
  expect(extracted.beta).toBe(witness.beta);
});

test('mutation oracle · transcript multiset comparison checks entries', () => {
  const first = enumerateTranscripts({ alpha: 5n, beta: 7n }, 'fixed-nonce');
  const second = enumerateTranscripts({ alpha: 9n, beta: 8n }, 'fixed-nonce');
  expect(first).toHaveLength(second.length);
  expect(transcriptMultisetsEqual(first, second)).toBe(false);
});

test('mutation oracle · GQ verification keeps y-to-c', () => {
  const params = { N: 55n, e: 3n };
  const proof = gqProve(params, 2n, 1n, 3n);
  const result = gqVerify(params, proof);
  expect(result.ok).toBe(true);
  expect(result.lhs).toBe(result.rhs);
});

test("mutation oracle · Shamir's trick uses s on y", () => {
  const params = { N: 55n, e: 3n };
  const first = gqProve(params, 2n, 0n, 3n);
  const second = gqProve(params, 2n, 1n, 3n);
  const extracted = gqExtract(params, first, second);
  expect(extracted.ok).toBe(true);
  expect(extracted.root).toBe(2n);
  expect(extracted.check).toBe(first.y);
});

test('mutation oracle · GQ cheater is checked against verifier c', () => {
  const y = 8n; // 2^3 mod 55; cubing is bijective because gcd(3, phi(55)) = 1.
  let accepted = 0;
  for (let trial = 0; trial < 300; trial += 1) {
    const attempt = gqCheatAttempt(y, 3n, 55n);
    expect(attempt.accepted).toBe(attempt.verifierChallenge === attempt.guessedChallenge);
    if (attempt.accepted) accepted += 1;
  }
  expect(accepted).toBeGreaterThan(50);
  expect(accepted).toBeLessThan(150);
});
