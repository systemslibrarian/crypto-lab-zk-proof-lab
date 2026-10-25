// @ts-check
// The sum-check protocol. The technique is Lund, Fortnow, Karloff and Nisan's
// ("Algebraic Methods for Interactive Proof Systems", §3: Lemma 4 is the step a
// random field element catches a wrong low-degree polynomial); the one-variable-
// per-round form for a sum over {0,1}^v is how Shamir and Babai–Fortnow applied it,
// and is what Goldwasser, Kalai and Rothblum restate as Figure 2 of their full
// version. Prover and verifier are separate objects joined only by messages. The
// verifier holds public data — the field, the degree bounds, the claim, an oracle
// for one evaluation of g — and nothing of the prover's.

import { scriptedChallengeSource } from './field.js';
import {
  addUnivariate,
  evaluatePolynomial,
  evaluateUnivariate,
  hypercubePoint,
  hypercubeSum,
  interpolateUnivariate,
  mulUnivariate,
  partialSumUnivariate,
  scaleUnivariate,
  univariateDegree,
  variableDegrees,
} from './polynomial.js';

/** @typedef {import('./field.js').PrimeField} PrimeField */
/** @typedef {import('./field.js').ChallengeSource} ChallengeSource */
/** @typedef {import('./polynomial.js').Polynomial} Polynomial */

/**
 * @typedef {Object} RoundCheck
 * @property {number} round
 * @property {bigint[]} polynomial
 * @property {number} degree
 * @property {number} bound
 * @property {bigint} sumAt01
 * @property {bigint} expected
 * @property {boolean} ok
 * @property {'shape' | 'degree' | 'recurrence' | null} failedCheck
 * @property {string} reason
 */
/**
 * @typedef {Object} FinalCheck
 * @property {bigint[]} point
 * @property {bigint} claimed
 * @property {bigint} evaluated
 * @property {boolean} ok
 * @property {string} reason
 */
/**
 * @typedef {Object} SumcheckRound
 * @property {number} round
 * @property {bigint[]} polynomial
 * @property {bigint | null} challenge
 */
/**
 * @typedef {Object} SumcheckTranscript
 * @property {'sum-check'} protocol
 * @property {bigint} modulus
 * @property {number} variables
 * @property {number[]} degreeBounds
 * @property {bigint} claimedSum
 * @property {SumcheckRound[]} rounds
 */
/** @typedef {'await-message' | 'await-challenge' | 'await-final' | 'accepted' | 'rejected'} VerifierPhase */

/** The verifier's error bound v·d/|F| (GKR Lemma 2.5; Thaler Proposition 4.1). @param {PrimeField} field @param {number[]} degreeBounds */
export function soundnessBound(field, degreeBounds) {
  const variables = degreeBounds.length;
  const maxDegree = degreeBounds.reduce((best, degree) => Math.max(best, degree), 0);
  const numerator = BigInt(variables * maxDegree);
  return {
    variables,
    maxDegree,
    numerator,
    denominator: field.p,
    value: Number(numerator) / Number(field.p),
    vacuous: numerator >= field.p,
  };
}

/**
 * @param {Object} options
 * @param {PrimeField} options.field
 * @param {number[]} options.degreeBounds deg_j(g) for each variable, from the public statement
 * @param {bigint} options.claimedSum
 * @param {ChallengeSource} options.challengeSource
 */
export function createSumcheckVerifier({ field, degreeBounds, claimedSum, challengeSource }) {
  if (!Array.isArray(degreeBounds) || degreeBounds.length === 0 || !degreeBounds.every((bound) => Number.isInteger(bound) && bound >= 0)) {
    throw new RangeError('degree bounds must be a non-empty list of non-negative integers');
  }
  if (!field.isCanonical(claimedSum)) throw new RangeError('the claimed sum must be a canonical field element');
  const variables = degreeBounds.length;
  /** @type {VerifierPhase} */
  let phase = 'await-message';
  let round = 1;
  let expected = claimedSum;
  /** @type {SumcheckRound[]} */
  const rounds = [];
  /** @type {RoundCheck[]} */
  const checks = [];
  /** @type {FinalCheck | null} */
  let final = null;
  let rejection = '';

  return {
    get phase() { return phase; },
    get round() { return round; },
    get expected() { return expected; },
    get variables() { return variables; },

    /**
     * Receive the prover's round polynomial and run the two per-round checks: the
     * degree bound, then the recurrence s_j(0) + s_j(1) = previous claim at the
     * previous challenge (the claimed sum itself in round 1).
     * @param {unknown} message
     * @returns {RoundCheck}
     */
    receiveMessage(message) {
      if (phase !== 'await-message') throw new Error(`protocol order: cannot receive a round-${round} message in phase "${phase}"`);
      const bound = degreeBounds[round - 1];
      if (!Array.isArray(message) || message.length === 0 || !message.every((coefficient) => field.isCanonical(coefficient))) {
        const reason = `round ${round}: the prover's message is not a non-empty list of canonical field elements`;
        /** @type {RoundCheck} */
        const check = { round, polynomial: [], degree: -1, bound, sumAt01: 0n, expected, ok: false, failedCheck: 'shape', reason };
        checks.push(check);
        phase = 'rejected';
        rejection = reason;
        return check;
      }
      const polynomial = /** @type {bigint[]} */ (message.slice());
      const degree = univariateDegree(polynomial);
      const sumAt01 = field.add(evaluateUnivariate(field, polynomial, 0n), evaluateUnivariate(field, polynomial, 1n));
      /** @type {RoundCheck['failedCheck']} */
      let failedCheck = null;
      let reason = '';
      if (degree > bound) {
        failedCheck = 'degree';
        reason = `round ${round}: the message has degree ${degree} but the degree bound for X${round} is ${bound}`;
      } else if (sumAt01 !== expected) {
        failedCheck = 'recurrence';
        const origin = round === 1 ? 'the claimed sum' : `s${round - 1}(r${round - 1})`;
        reason = `round ${round}: s${round}(0) + s${round}(1) = ${sumAt01} but the verifier expected ${expected} (${origin})`;
      }
      const ok = failedCheck === null;
      const degreeDescription = degree < 0 ? '−∞ (zero polynomial)' : String(degree);
      /** @type {RoundCheck} */
      const check = {
        round,
        polynomial,
        degree,
        bound,
        sumAt01,
        expected,
        ok,
        failedCheck,
        reason: ok ? `round ${round}: degree ${degreeDescription} ≤ ${bound} and s${round}(0) + s${round}(1) = ${expected}` : reason,
      };
      checks.push(check);
      if (ok) {
        rounds.push({ round, polynomial, challenge: null });
        phase = 'await-challenge';
      } else {
        phase = 'rejected';
        rejection = reason;
      }
      return check;
    },

    /**
     * Draw the challenge for the round whose message has just been accepted. The
     * phase guard is the ordering rule itself: no challenge exists before its
     * owning prover message has been received and checked.
     */
    drawChallenge() {
      if (phase !== 'await-challenge') {
        throw new Error(`protocol order: the round-${round} challenge cannot be drawn before the prover's round-${round} message has been received and checked (phase "${phase}")`);
      }
      const challenge = challengeSource.draw();
      if (!field.isCanonical(challenge)) throw new RangeError('the challenge source returned a value outside the field');
      const entry = rounds[rounds.length - 1];
      entry.challenge = challenge;
      expected = evaluateUnivariate(field, entry.polynomial, challenge);
      if (round === variables) {
        phase = 'await-final';
      } else {
        round += 1;
        phase = 'await-message';
      }
      return challenge;
    },

    /**
     * The final check: evaluate g at the full challenge point once and compare
     * with s_v(r_v). The oracle is the verifier's own evaluation route.
     * @param {(point: bigint[]) => bigint} oracle
     * @returns {FinalCheck}
     */
    finish(oracle) {
      if (phase !== 'await-final') throw new Error(`protocol order: cannot run the final evaluation in phase "${phase}"`);
      const point = rounds.map((entry) => /** @type {bigint} */ (entry.challenge));
      const evaluated = oracle(point);
      if (!field.isCanonical(evaluated)) throw new RangeError('the oracle returned a value outside the field');
      const ok = evaluated === expected;
      final = {
        point,
        claimed: expected,
        evaluated,
        ok,
        reason: ok
          ? `final check: s${variables}(r${variables}) = ${expected} equals g(r) = ${evaluated}`
          : `final check: s${variables}(r${variables}) = ${expected} but the direct evaluation g(r) = ${evaluated}`,
      };
      phase = ok ? 'accepted' : 'rejected';
      if (!ok) rejection = final.reason;
      return final;
    },

    /** @returns {SumcheckTranscript} */
    transcript() {
      return {
        protocol: 'sum-check',
        modulus: field.p,
        variables,
        degreeBounds: degreeBounds.slice(),
        claimedSum,
        rounds: rounds.map((entry) => ({ round: entry.round, polynomial: entry.polynomial.slice(), challenge: entry.challenge })),
      };
    },
    checks() { return checks.slice(); },
    final() { return final; },
    rejection() { return rejection; },
  };
}

/**
 * @typedef {{ kind: 'honest' }
 *   | { kind: 'wrong-sum-naive', offset: bigint }
 *   | { kind: 'wrong-sum-carried', offset: bigint }
 *   | { kind: 'inconsistent-round', round: number, offset: bigint }
 *   | { kind: 'excessive-degree', round: number }
 *   | { kind: 'lagrange-degree-attack', offset: bigint }} ProverStrategy
 */

/**
 * A degree-≤d polynomial u with u(0) + u(1) = 1 and as many distinct roots as
 * the degree and field allow. A carried lie debt·u(X) survives the recurrence
 * and is caught only when the challenge misses every root. When d < |F| this
 * realizes d roots, making the d/|F| round bound tight. The returned root list
 * is authoritative when d ≥ |F|, where no non-zero function can vanish at all
 * field elements.
 * @param {PrimeField} field
 * @param {number} degree
 */
export function liePolynomialUnit(field, degree) {
  if (!Number.isInteger(degree) || degree < 0) throw new RangeError('a degree bound must be a non-negative integer');
  if (degree >= 1) {
    const rootCount = field.p <= BigInt(degree) ? Number(field.p - 1n) : degree;
    /** @param {bigint[]} roots */
    const fromRoots = (roots) => {
      let product = [1n];
      for (const root of roots) product = mulUnivariate(field, product, [field.neg(root), 1n]);
      const denominator = field.add(evaluateUnivariate(field, product, 0n), evaluateUnivariate(field, product, 1n));
      return denominator === 0n ? null : { polynomial: scaleUnivariate(field, product, field.inv(denominator)), roots: roots.slice() };
    };

    // Keep the readable roots 2, …, d+1 whenever they work. F_5 at d=3 is
    // the instructive exception: that product has u(0)+u(1)=0, so search a
    // small deterministic set of alternatives instead of silently dropping
    // from three roots to one.
    const preferred = Array.from({ length: rootCount }, (_, index) => BigInt(index + 2));
    if (preferred.every((root) => root < field.p)) {
      const candidate = fromRoots(preferred);
      if (candidate) return candidate;
    }

    const poolSize = field.p <= BigInt(rootCount + 2) ? Number(field.p) : rootCount + 2;
    const pool = Array.from({ length: poolSize }, (_, index) => BigInt(index));
    /** @type {{ polynomial: bigint[], roots: bigint[] } | null} */
    let found = null;
    /** @param {number} start @param {bigint[]} roots */
    const choose = (start, roots) => {
      if (found) return;
      if (roots.length === rootCount) {
        found = fromRoots(roots);
        return;
      }
      for (let index = start; index <= pool.length - (rootCount - roots.length); index += 1) {
        choose(index + 1, [...roots, pool[index]]);
        if (found) return;
      }
    };
    choose(0, []);
    if (found) return found;
    throw new RangeError(`could not construct a normalized lie polynomial of degree at most ${degree} over F_${field.p}`);
  }
  if (field.p === 2n) throw new RangeError('over F_2 a constant round cannot carry a lie');
  return { polynomial: [field.inv(2n)], roots: [] };
}

/**
 * @param {Object} options
 * @param {PrimeField} options.field
 * @param {Polynomial} options.polynomial
 * @param {ProverStrategy} [options.strategy]
 */
export function createSumcheckProver({ field, polynomial, strategy = { kind: 'honest' } }) {
  const degrees = variableDegrees(polynomial);
  const trueSum = hypercubeSum(field, polynomial);
  if ('offset' in strategy && !(field.isCanonical(strategy.offset) && strategy.offset !== 0n)) {
    throw new RangeError('a lying strategy needs a non-zero canonical offset');
  }
  if ('round' in strategy && !(Number.isInteger(strategy.round) && strategy.round >= 1 && strategy.round <= polynomial.variables)) {
    throw new RangeError(`the strategy's round must lie in 1..${polynomial.variables}`);
  }
  /** @type {bigint[] | null} */
  let lastCorrection = null;
  /** @type {Array<{ round: number, debt: bigint, roots: bigint[] }>} */
  const corrections = [];

  return {
    strategy,
    variables: polynomial.variables,
    degreeBounds: degrees.slice(),
    trueSum,
    /** What the prover tells the verifier the sum is. */
    claimedSum() {
      return strategy.kind === 'wrong-sum-naive' || strategy.kind === 'wrong-sum-carried' || strategy.kind === 'lagrange-degree-attack'
        ? field.add(trueSum, strategy.offset)
        : trueSum;
    },
    /** Omniscient narration for the page; the verifier never reads it. */
    corrections() { return corrections.slice(); },
    /**
     * @param {number} round
     * @param {bigint[]} challenges the challenges r_1 … r_{round−1}
     */
    message(round, challenges) {
      const honest = partialSumUnivariate(field, polynomial, challenges, round);
      switch (strategy.kind) {
        case 'honest':
        case 'wrong-sum-naive':
          return honest;
        case 'inconsistent-round': {
          if (round !== strategy.round) return honest;
          const altered = honest.slice();
          if (field.p !== 2n) altered[0] = field.add(altered[0], strategy.offset);
          else if (altered.length > 1) altered[1] = field.add(altered[1], strategy.offset);
          else throw new RangeError('over F_2 a constant message cannot be made inconsistent');
          return altered;
        }
        case 'excessive-degree': {
          if (round !== strategy.round) return honest;
          const bound = degrees[round - 1];
          const altered = honest.slice();
          while (altered.length < bound + 3) altered.push(0n);
          // add X^bound · X · (X − 1): zero at 0 and 1, so the recurrence still holds
          altered[bound + 1] = field.sub(altered[bound + 1], 1n);
          altered[bound + 2] = field.add(altered[bound + 2], 1n);
          return altered;
        }
        case 'wrong-sum-carried': {
          const debt = round === 1
            ? strategy.offset
            : evaluateUnivariate(field, /** @type {bigint[]} */ (lastCorrection), challenges[round - 2]);
          if (debt === 0n) {
            lastCorrection = [0n];
            corrections.push({ round, debt, roots: [] });
            return honest;
          }
          const unit = liePolynomialUnit(field, degrees[round - 1]);
          lastCorrection = scaleUnivariate(field, unit.polynomial, debt);
          corrections.push({ round, debt, roots: unit.roots });
          return addUnivariate(field, honest, lastCorrection);
        }
        case 'lagrange-degree-attack': {
          if (round !== 1) return honest;
          const xs = field.elements();
          const ys = xs.map((x) => evaluateUnivariate(field, honest, x));
          ys[0] = field.add(ys[0], strategy.offset);
          return interpolateUnivariate(field, xs, ys);
        }
        default:
          throw new RangeError('unknown prover strategy');
      }
    },
  };
}

/**
 * @typedef {{ kind: 'claim', value: bigint }
 *   | { kind: 'message', check: RoundCheck }
 *   | { kind: 'challenge', round: number, value: bigint }
 *   | { kind: 'final', check: FinalCheck }} SumcheckEvent
 */

/**
 * Wire one prover to one verifier. The verifier is handed only the public
 * statement: the degree bounds read off the public polynomial, the prover's claim,
 * and an oracle that evaluates the public polynomial once.
 * @param {Object} options
 * @param {PrimeField} options.field
 * @param {Polynomial} options.polynomial
 * @param {ReturnType<typeof createSumcheckProver>} options.prover
 * @param {ChallengeSource} options.challengeSource
 */
export function createSumcheckSession({ field, polynomial, prover, challengeSource }) {
  const degreeBounds = variableDegrees(polynomial);
  const claimedSum = prover.claimedSum();
  const verifier = createSumcheckVerifier({ field, degreeBounds, claimedSum, challengeSource });
  /** @param {bigint[]} point */
  const oracle = (point) => evaluatePolynomial(field, polynomial, point);
  /** @type {SumcheckEvent[]} */
  const events = [{ kind: 'claim', value: claimedSum }];

  const session = {
    verifier,
    claimedSum,
    degreeBounds,
    events,
    get done() {
      return verifier.phase === 'accepted' || verifier.phase === 'rejected';
    },
    /** Advance by one protocol event. @returns {SumcheckEvent} */
    step() {
      switch (verifier.phase) {
        case 'await-message': {
          const round = verifier.round;
          const challenges = verifier.transcript().rounds.flatMap((entry) => (entry.challenge === null ? [] : [entry.challenge]));
          const check = verifier.receiveMessage(prover.message(round, challenges));
          events.push({ kind: 'message', check });
          break;
        }
        case 'await-challenge': {
          const round = verifier.round;
          const value = verifier.drawChallenge();
          events.push({ kind: 'challenge', round, value });
          break;
        }
        case 'await-final': {
          const check = verifier.finish(oracle);
          events.push({ kind: 'final', check });
          break;
        }
        default:
          throw new Error('the session is finished');
      }
      return events[events.length - 1];
    },
    run() {
      while (!session.done) session.step();
      return session.verdict();
    },
    verdict() {
      const accepted = verifier.phase === 'accepted';
      const final = verifier.final();
      return {
        accepted,
        finished: session.done,
        phase: verifier.phase,
        reason: accepted ? /** @type {FinalCheck} */ (final).reason : verifier.rejection(),
        failedCheck: session.failedCheck(),
      };
    },
    /** @returns {'shape' | 'degree' | 'recurrence' | 'final' | null} */
    failedCheck() {
      if (verifier.phase !== 'rejected') return null;
      const final = verifier.final();
      if (final && !final.ok) return 'final';
      const last = verifier.checks()[verifier.checks().length - 1];
      return last && last.failedCheck ? last.failedCheck : null;
    },
  };
  return session;
}

// ---------------------------------------------------------------------------
// Transcripts: serialization and fail-closed replay.
// ---------------------------------------------------------------------------

/** @param {SumcheckTranscript} transcript */
export function serializeTranscript(transcript) {
  return JSON.stringify(transcript, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2);
}

/**
 * Parse transcript JSON back into BigInt form. Throws on invalid JSON; shape is
 * judged by replaySumcheckTranscript, which fails closed with a named reason.
 * @param {string} json
 * @returns {unknown}
 */
export function parseTranscript(json) {
  return JSON.parse(json, (key, value) => {
    if ((key === 'modulus' || key === 'claimedSum' || key === 'challenge') && typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
    if (key === 'polynomial' && Array.isArray(value)) {
      return value.map((entry) => (typeof entry === 'string' && /^\d+$/.test(entry) ? BigInt(entry) : entry));
    }
    return value;
  });
}

/**
 * Replay a recorded transcript through a fresh verifier. Every structural defect —
 * missing or extra rounds, rounds out of order, a challenge recorded without its
 * message, a non-canonical value — is refused by name before any arithmetic runs.
 * @param {Object} options
 * @param {PrimeField} options.field
 * @param {unknown} options.transcript
 * @param {(point: bigint[]) => bigint} options.oracle
 * @param {number[]} [options.expectedDegreeBounds] the statement's bounds; a transcript claiming looser bounds is refused
 */
export function replaySumcheckTranscript({ field, transcript, oracle, expectedDegreeBounds }) {
  /** @param {string} reason */
  const malformed = (reason) => ({ ok: false, reason: `malformed transcript: ${reason}`, failedCheck: /** @type {const} */ ('shape'), checks: [], final: null });
  if (typeof transcript !== 'object' || transcript === null || Array.isArray(transcript)) return malformed('not an object');
  const record = /** @type {Record<string, unknown>} */ (transcript);
  if (record.protocol !== 'sum-check') return malformed('protocol is not "sum-check"');
  if (record.modulus !== field.p) return malformed(`modulus ${String(record.modulus)} is not the current field's ${field.p}`);
  const variables = record.variables;
  if (!Number.isInteger(variables) || /** @type {number} */ (variables) < 1) return malformed('variables is not a positive integer');
  const degreeBounds = record.degreeBounds;
  if (!Array.isArray(degreeBounds) || degreeBounds.length !== variables || !degreeBounds.every((bound) => Number.isInteger(bound) && bound >= 0)) {
    return malformed('degreeBounds must list one non-negative integer per variable');
  }
  if (expectedDegreeBounds) {
    if (expectedDegreeBounds.length !== degreeBounds.length || degreeBounds.some((bound, index) => bound !== expectedDegreeBounds[index])) {
      return malformed(`degree bounds [${degreeBounds.join(', ')}] do not match the statement's [${expectedDegreeBounds.join(', ')}]`);
    }
  }
  if (!field.isCanonical(record.claimedSum)) return malformed('claimedSum is not a canonical field element');
  const rounds = record.rounds;
  if (!Array.isArray(rounds)) return malformed('rounds is not a list');
  if (rounds.length !== variables) {
    return malformed(`${rounds.length} round${rounds.length === 1 ? '' : 's'} recorded but the statement has ${variables} variables`);
  }
  /** @type {bigint[][]} */
  const messages = [];
  /** @type {bigint[]} */
  const challenges = [];
  for (let index = 0; index < rounds.length; index += 1) {
    const entry = rounds[index];
    if (typeof entry !== 'object' || entry === null) return malformed(`entry ${index + 1} is not a round object`);
    const round = /** @type {Record<string, unknown>} */ (entry);
    if (round.round !== index + 1) return malformed(`entry ${index + 1} is labelled round ${String(round.round)}: rounds are out of order`);
    const polynomial = round.polynomial;
    const hasMessage = Array.isArray(polynomial) && polynomial.length > 0;
    if (!hasMessage && field.isCanonical(round.challenge)) return malformed(`round ${index + 1} records a challenge without a prover message`);
    if (!hasMessage) return malformed(`round ${index + 1} has no prover message`);
    if (!polynomial.every((coefficient) => field.isCanonical(coefficient))) return malformed(`round ${index + 1} has a coefficient that is not a canonical field element`);
    if (!field.isCanonical(round.challenge)) return malformed(`round ${index + 1} has no canonical challenge recorded after its message`);
    messages.push(/** @type {bigint[]} */ (polynomial.slice()));
    challenges.push(round.challenge);
  }
  const verifier = createSumcheckVerifier({
    field,
    degreeBounds: /** @type {number[]} */ (degreeBounds),
    claimedSum: record.claimedSum,
    challengeSource: scriptedChallengeSource(field, challenges),
  });
  for (const message of messages) {
    const check = verifier.receiveMessage(message);
    if (!check.ok) return { ok: false, reason: check.reason, failedCheck: check.failedCheck, checks: verifier.checks(), final: null };
    verifier.drawChallenge();
  }
  const final = verifier.finish(oracle);
  return { ok: final.ok, reason: final.reason, failedCheck: final.ok ? null : /** @type {const} */ ('final'), checks: verifier.checks(), final };
}

// ---------------------------------------------------------------------------
// Exhaustive census over a tiny field.
// ---------------------------------------------------------------------------

export const MAX_CENSUS_TRANSCRIPTS = 100_000;

/** Every challenge vector in F^v, in lexicographic order. @param {PrimeField} field @param {number} variables */
export function enumerateChallengeVectors(field, variables) {
  const elements = field.elements();
  const total = BigInt(elements.length) ** BigInt(variables);
  if (total > BigInt(MAX_CENSUS_TRANSCRIPTS)) throw new RangeError(`${total} challenge vectors exceed the census limit of ${MAX_CENSUS_TRANSCRIPTS}`);
  /** @type {bigint[][]} */
  const vectors = [];
  const count = Number(total);
  for (let label = 0; label < count; label += 1) {
    const vector = [];
    let rest = label;
    for (let position = 0; position < variables; position += 1) {
      vector.unshift(elements[rest % elements.length]);
      rest = Math.floor(rest / elements.length);
    }
    vectors.push(vector);
  }
  return vectors;
}

/**
 * Run one prover strategy against the real verifier on EVERY challenge vector of a
 * tiny field and count what happened. This is a complete enumeration for teaching;
 * a field this small is not a security parameter.
 * @param {Object} options
 * @param {PrimeField} options.field
 * @param {Polynomial} options.polynomial
 * @param {() => ReturnType<typeof createSumcheckProver>} options.makeProver
 */
export function sumcheckCensus({ field, polynomial, makeProver }) {
  const vectors = enumerateChallengeVectors(field, polynomial.variables);
  const tally = { accepted: 0, shape: 0, degree: 0, recurrence: 0, final: 0 };
  /** @type {bigint[][]} */
  const acceptingVectors = [];
  for (const vector of vectors) {
    const session = createSumcheckSession({ field, polynomial, prover: makeProver(), challengeSource: scriptedChallengeSource(field, vector) });
    const verdict = session.run();
    if (verdict.accepted) {
      tally.accepted += 1;
      if (acceptingVectors.length < 16) acceptingVectors.push(vector);
    } else if (verdict.failedCheck) {
      tally[verdict.failedCheck] += 1;
    }
  }
  return { total: vectors.length, ...tally, acceptingVectors, bound: soundnessBound(field, variableDegrees(polynomial)) };
}

/**
 * How many field elements x satisfy a(x) = b(x): the agreement count behind the
 * degree bound. Two polynomials of degree ≤ d agree on at most d points; two
 * arbitrary functions can agree everywhere but a handful.
 * @param {PrimeField} field
 * @param {bigint[]} a
 * @param {bigint[]} b
 */
export function univariateAgreement(field, a, b) {
  return field.elements().filter((x) => evaluateUnivariate(field, a, x) === evaluateUnivariate(field, b, x)).length;
}

export { hypercubePoint };
