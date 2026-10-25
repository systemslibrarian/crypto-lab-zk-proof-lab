import { describe, expect, it } from 'vitest';
import { createField, freshChallengeSource, scriptedChallengeSource, seededChallengeSource } from '../../js/field.js';
import { evaluateMultilinearFromValues, evaluatePolynomial, hypercubeSum, multilinearExtension, restrictToLine, variableDegrees } from '../../js/polynomial.js';
import {
  DEMO_CIRCUIT,
  createGkrProver,
  evaluateCircuit,
  evaluateWiringExtension,
  gkrSoundnessBound,
  layerPolynomial,
  layerSizes,
  lineThrough,
  runGkr,
  validateCircuit,
  wiringTriples,
} from '../../js/gkr.js';

const P = 2147483647n;
const field = createField(P);
const INPUTS = [3n, 2n, 3n, 1n];

/** One r0, four layer-0 challenges, r*0, four layer-1 challenges, r*1. */
const gkrChallenges = (r0 = 2n, rStar0 = 10n, rStar1 = 15n) => [r0, 3n, 5n, 7n, 9n, rStar0, 4n, 6n, 8n, 11n, rStar1];

/** The circuit written out by hand, independently of the gate table. */
function handEvaluate(p: bigint, [x0, x1, x2, x3]: bigint[]) {
  const g10 = (x0 + x1) % p;
  const g11 = (x1 * x2) % p;
  const g12 = (x2 + x3) % p;
  const g13 = (x0 * x3) % p;
  return { layer1: [g10, g11, g12, g13], layer0: [(g10 * g11) % p, (g12 + g13) % p] };
}

/** Multilinear extension of a 4-entry table over two variables, written out as the four Lagrange terms. */
function handMle2(p: bigint, [v00, v01, v10, v11]: bigint[], [a, b]: bigint[]) {
  const na = (1n - a + p) % p;
  const nb = (1n - b + p) % p;
  return (v00 * na % p * nb + v01 * na % p * b + v10 * a % p * nb + v11 * a % p * b) % p;
}

describe('the walkthrough circuit', () => {
  it('has the declared shape and evaluates like the hand-written formula', () => {
    expect(layerSizes(DEMO_CIRCUIT)).toEqual([2, 4, 4]);
    expect(validateCircuit(DEMO_CIRCUIT)).toEqual([1, 2, 2]);
    for (const inputs of [INPUTS, [0n, 0n, 0n, 0n], [1n, 1n, 1n, 1n], [P - 1n, 2n, P - 3n, 5n]]) {
      const values = evaluateCircuit(field, DEMO_CIRCUIT, inputs);
      const hand = handEvaluate(P, inputs);
      expect(values[2]).toEqual(inputs);
      expect(values[1]).toEqual(hand.layer1);
      expect(values[0]).toEqual(hand.layer0);
    }
    expect(evaluateCircuit(field, DEMO_CIRCUIT, INPUTS)).toEqual([[30n, 7n], [5n, 6n, 4n, 3n], [3n, 2n, 3n, 1n]]);
    expect(() => evaluateCircuit(field, DEMO_CIRCUIT, [1n, 2n, 3n])).toThrow('takes 4 inputs');
    expect(() => validateCircuit({ name: 'bad', inputs: 3, layers: [[{ op: 'add', in1: 0, in2: 1 }]] })).toThrow('not a power of two');
    expect(() => validateCircuit({ name: 'bad', inputs: 4, layers: [[{ op: 'add', in1: 0, in2: 4 }, { op: 'add', in1: 0, in2: 1 }]] })).toThrow('reads outside');
  });

  it('derives the wiring predicates as the exact triples the circuit text states', () => {
    expect(wiringTriples(DEMO_CIRCUIT, 0, 'mult')).toEqual([[0, 0, 1]]);
    expect(wiringTriples(DEMO_CIRCUIT, 0, 'add')).toEqual([[1, 2, 3]]);
    expect(wiringTriples(DEMO_CIRCUIT, 1, 'add')).toEqual([[0, 0, 1], [2, 2, 3]]);
    expect(wiringTriples(DEMO_CIRCUIT, 1, 'mult')).toEqual([[1, 1, 2], [3, 0, 3]]);
    // On Boolean inputs the extension IS the predicate.
    const bit = (label: number, bits: number) => Array.from({ length: bits }, (_, i) => BigInt((label >> (bits - 1 - i)) & 1));
    for (let a = 0; a < 4; a += 1) for (let b = 0; b < 4; b += 1) for (let c = 0; c < 4; c += 1) {
      const expectedAdd = (a === 0 && b === 0 && c === 1) || (a === 2 && b === 2 && c === 3) ? 1n : 0n;
      const expectedMult = (a === 1 && b === 1 && c === 2) || (a === 3 && b === 0 && c === 3) ? 1n : 0n;
      expect(evaluateWiringExtension(field, DEMO_CIRCUIT, 1, 'add', bit(a, 2), bit(b, 2), bit(c, 2))).toBe(expectedAdd);
      expect(evaluateWiringExtension(field, DEMO_CIRCUIT, 1, 'mult', bit(a, 2), bit(b, 2), bit(c, 2))).toBe(expectedMult);
    }
  });

  it('multilinear extensions agree with the hand-written Lagrange form and with the explicit polynomial', () => {
    const values = evaluateCircuit(field, DEMO_CIRCUIT, INPUTS);
    const point = [987654321n, 123456789n];
    expect(evaluateMultilinearFromValues(field, values[1], point)).toBe(handMle2(P, values[1], point));
    expect(evaluateMultilinearFromValues(field, values[2], point)).toBe(handMle2(P, values[2], point));
    expect(evaluatePolynomial(field, multilinearExtension(field, values[1]), point)).toBe(handMle2(P, values[1], point));
    for (let label = 0; label < 4; label += 1) {
      const boolean = [BigInt(label >> 1), BigInt(label & 1)];
      expect(evaluateMultilinearFromValues(field, values[1], boolean)).toBe(values[1][label]);
    }
  });

  it('satisfies Lemma 4.7: Σ_{b,c} f_z(b,c) = W̃_i(z) at random z, with degree ≤ 2 in every variable', () => {
    const values = evaluateCircuit(field, DEMO_CIRCUIT, INPUTS);
    for (const z of [[5n, 11n], [1n, 0n], [777777n, 2147483646n]]) {
      const f = layerPolynomial(field, DEMO_CIRCUIT, 1, z, values[2]);
      expect(f.variables).toBe(4);
      expect(variableDegrees(f).every((degree) => degree <= 2)).toBe(true);
      expect(hypercubeSum(field, f)).toBe(handMle2(P, values[1], z));
    }
    const f0 = layerPolynomial(field, DEMO_CIRCUIT, 0, [424242n], values[1]);
    expect(hypercubeSum(field, f0)).toBe(evaluateMultilinearFromValues(field, values[0], [424242n]));
  });

  it('restricts W̃ to the line through two points with the right endpoints and degree', () => {
    const values = evaluateCircuit(field, DEMO_CIRCUIT, INPUTS);
    const line = lineThrough(field, [3n, 4n], [10n, 20n]);
    const q = restrictToLine(field, multilinearExtension(field, values[1]), line.base, line.direction);
    expect(q.length).toBeLessThanOrEqual(3);
    expect(q[0]).toBe(handMle2(P, values[1], [3n, 4n]));
    expect(q.reduce((sum, coefficient) => (sum + coefficient) % P, 0n)).toBe(handMle2(P, values[1], [10n, 20n]));
  });

  it('states the union bound this walk incurs: 21/|F| for the demo circuit', () => {
    const bound = gkrSoundnessBound(field, DEMO_CIRCUIT);
    expect(bound.numerator).toBe(21n);
    expect(bound.terms.map((term) => term.numerator)).toEqual([1, 8, 2, 8, 2]);
    expect(bound).toMatchObject({ vacuous: false, probabilityBound: 21 / Number(P) });

    const tiny = gkrSoundnessBound(createField(13n), DEMO_CIRCUIT);
    expect(tiny).toMatchObject({ numerator: 21n, denominator: 13n, vacuous: true, probabilityBound: 1 });
    expect(tiny.rawValue).toBeCloseTo(21 / 13);
  });
});

describe('the GKR layer walk', () => {
  const honest = (source = seededChallengeSource(field, 'gkr-honest')) =>
    runGkr({ field, circuit: DEMO_CIRCUIT, inputs: INPUTS, prover: createGkrProver({ field, circuit: DEMO_CIRCUIT, inputs: INPUTS }), challengeSource: source });

  it('accepts an honest prover, reusing the sum-check verifier for every layer, and its terminal value is the input MLE', () => {
    const run = honest();
    expect(run.accepted).toBe(true);
    expect(run.failedAt).toBeNull();
    const { transcript } = run;
    expect(transcript.outputs?.claimed).toEqual([30n, 7n]);
    // Two outputs, so D̃ is univariate: D̃(r0) = 30·(1 − r0) + 7·r0.
    const r0 = transcript.outputs!.r0[0];
    expect(transcript.outputs?.m0).toBe((30n * ((1n - r0 + P) % P) + 7n * r0) % P);
    expect(transcript.layers).toHaveLength(2);
    for (const layer of transcript.layers) {
      expect(layer.degreeBounds).toEqual([2, 2, 2, 2]);
      expect(layer.sumcheck.protocol).toBe('sum-check');
      expect(layer.sumcheck.rounds).toHaveLength(4);
      expect(layer.checks.every((check) => check.ok)).toBe(true);
      expect(layer.final?.ok).toBe(true);
      expect(layer.line?.degree).toBeLessThanOrEqual(2);
      // The prover's q really is W̃_{i+1} on the line: q(0) and q(1) match the hand MLE at b*, c*.
      const values = evaluateCircuit(field, DEMO_CIRCUIT, INPUTS);
      expect(layer.line?.q0).toBe(handMle2(P, values[layer.layer + 1], layer.line!.bStar));
      expect(layer.line?.q1).toBe(handMle2(P, values[layer.layer + 1], layer.line!.cStar));
      expect(layer.nextClaim).toBe(handMle2(P, values[layer.layer + 1], layer.nextPoint!));
    }
    expect(transcript.terminal?.ok).toBe(true);
    expect(transcript.terminal?.evaluated).toBe(handMle2(P, INPUTS, transcript.terminal!.point));
    expect(transcript.terminal?.claim).toBe(transcript.layers[1].nextClaim);
    expect(honest(freshChallengeSource(field)).accepted).toBe(true);
  });

  it('is replayable from a seed and differs between seeds', () => {
    const a = honest(seededChallengeSource(field, 'x'));
    const b = honest(seededChallengeSource(field, 'x'));
    const c = honest(seededChallengeSource(field, 'y'));
    expect(a.transcript).toEqual(b.transcript);
    expect(a.transcript.outputs?.r0).not.toEqual(c.transcript.outputs?.r0);
  });

  const cheat = (strategy: Parameters<typeof createGkrProver>[0]['strategy']) =>
    runGkr({ field, circuit: DEMO_CIRCUIT, inputs: INPUTS, prover: createGkrProver({ field, circuit: DEMO_CIRCUIT, inputs: INPUTS, strategy }), challengeSource: seededChallengeSource(field, 'gkr-cheat') });

  it('a wrong output claim fails the first recurrence of layer 0', () => {
    const run = cheat({ kind: 'wrong-output', gate: 0, offset: 1n });
    expect(run.accepted).toBe(false);
    expect(run.failedAt).toEqual({ stage: 'recurrence', layer: 0, round: 1 });
    expect(run.reason).toMatch(/^layer 0: round 1: s1\(0\) \+ s1\(1\) = \d+ but the verifier expected \d+ \(the claimed sum\)$/);
  });

  it('a corrupted internal gate value survives layer 0 and is caught where the walk reaches the public inputs', () => {
    const run = cheat({ kind: 'corrupt-gate', layer: 1, gate: 1, offset: 7n });
    expect(run.accepted).toBe(false);
    expect(run.transcript.layers[0].ok).toBe(true);
    expect(run.failedAt).toEqual({ stage: 'recurrence', layer: 1, round: 1 });
    expect(run.transcript.outputs?.claimed).not.toEqual([30n, 7n]);
  });

  it('a prover whose circuit copy has one wrong wire passes every recurrence and fails the verifier\'s own wiring evaluation', () => {
    const run = cheat({ kind: 'corrupt-wiring', layer: 1, gate: 1, in1: 1, in2: 3 });
    expect(run.accepted).toBe(false);
    expect(run.transcript.layers[0].ok).toBe(true);
    expect(run.transcript.layers[1].checks.every((check) => check.ok)).toBe(true);
    expect(run.failedAt).toEqual({ stage: 'final', layer: 1 });
    expect(run.reason).toContain('evaluated add̃ and mult̃ from its own wiring');
  });

  it('an invalid layer reduction is refused on degree, or caught one layer later, or at the terminal check', () => {
    const degree = cheat({ kind: 'invalid-line', layer: 0, mode: 'degree' });
    expect(degree.failedAt).toEqual({ stage: 'line-degree', layer: 0 });
    expect(degree.reason).toBe('layer 0 line: q has degree 3 but W̃1 restricted to a line has degree at most 2');
    const value = cheat({ kind: 'invalid-line', layer: 0, mode: 'value', offset: 9n });
    expect(value.transcript.layers[0].final?.ok).toBe(true);
    expect(value.failedAt).toEqual({ stage: 'recurrence', layer: 1, round: 1 });
    const last = cheat({ kind: 'invalid-line', layer: 1, mode: 'value', offset: 9n });
    expect(last.failedAt).toEqual({ stage: 'terminal', layer: 2 });
    expect(last.reason).toMatch(/^terminal check: W̃2\(\d+, \d+\) computed from the public inputs is \d+ but the carried claim is \d+$/);
    expect(last.transcript.terminal?.evaluated).toBe(handMle2(P, INPUTS, last.transcript.terminal!.point));
  });

  it('exhibits the exact endpoint soundness events instead of promising deterministic rejection', () => {
    for (const endpoint of [0n, 1n]) {
      const wrongOutput = runGkr({
        field,
        circuit: DEMO_CIRCUIT,
        inputs: INPUTS,
        prover: createGkrProver({ field, circuit: DEMO_CIRCUIT, inputs: INPUTS, strategy: { kind: 'wrong-output', gate: 0, offset: 1n } }),
        challengeSource: scriptedChallengeSource(field, gkrChallenges(1n)),
      });
      expect(wrongOutput.accepted).toBe(true);
      expect(wrongOutput.transcript.outputs?.claimed).not.toEqual(evaluateCircuit(field, DEMO_CIRCUIT, INPUTS)[0]);

      const middleLine = runGkr({
        field,
        circuit: DEMO_CIRCUIT,
        inputs: INPUTS,
        prover: createGkrProver({ field, circuit: DEMO_CIRCUIT, inputs: INPUTS, strategy: { kind: 'invalid-line', layer: 0, mode: 'value', offset: 1n } }),
        challengeSource: scriptedChallengeSource(field, gkrChallenges(2n, endpoint)),
      });
      expect(middleLine.accepted).toBe(true);
      expect(middleLine.transcript.layers[0].rStar).toBe(endpoint);

      const lastLine = runGkr({
        field,
        circuit: DEMO_CIRCUIT,
        inputs: INPUTS,
        prover: createGkrProver({ field, circuit: DEMO_CIRCUIT, inputs: INPUTS, strategy: { kind: 'invalid-line', layer: 1, mode: 'value', offset: 1n } }),
        challengeSource: scriptedChallengeSource(field, gkrChallenges(2n, 10n, endpoint)),
      });
      expect(lastLine.accepted).toBe(true);
      expect(lastLine.transcript.layers[1].rStar).toBe(endpoint);
    }
  });

  it('admits explicit root-event transcripts for corrupted gates and private wiring', () => {
    const honestOutputs = evaluateCircuit(field, DEMO_CIRCUIT, INPUTS)[0];
    const allZeroChallenges = new Array<bigint>(11).fill(0n);
    const strategies = [
      { kind: 'corrupt-gate', layer: 1, gate: 1, offset: 1n } as const,
      { kind: 'corrupt-wiring', layer: 1, gate: 1, in1: 1, in2: 3 } as const,
    ];
    for (const strategy of strategies) {
      const run = runGkr({
        field,
        circuit: DEMO_CIRCUIT,
        inputs: INPUTS,
        prover: createGkrProver({ field, circuit: DEMO_CIRCUIT, inputs: INPUTS, strategy }),
        challengeSource: scriptedChallengeSource(field, allZeroChallenges),
      });
      expect(run.transcript.outputs?.claimed).not.toEqual(honestOutputs);
      expect(run.accepted).toBe(true);
      expect(run.failedAt).toBeNull();
      expect(run.transcript.terminal).toMatchObject({ point: [0n, 0n], claim: 3n, evaluated: 3n, ok: true });
    }
  });

  it('reports the zero line polynomial with mathematical degree minus infinity', () => {
    const zeros = [0n, 0n, 0n, 0n];
    const run = runGkr({
      field,
      circuit: DEMO_CIRCUIT,
      inputs: zeros,
      prover: createGkrProver({ field, circuit: DEMO_CIRCUIT, inputs: zeros }),
      challengeSource: scriptedChallengeSource(field, gkrChallenges()),
    });
    expect(run.accepted).toBe(true);
    expect(run.transcript.layers.map((layer) => layer.line?.degree)).toEqual([-1, -1]);
  });

  it('refuses a verifier challenge source that leaves the selected field', () => {
    const uncheckedSource = (values: bigint[]) => {
      let index = 0;
      return {
        kind: 'scripted' as const,
        label: 'deliberately invalid test source',
        draw() {
          if (index >= values.length) throw new RangeError('test source exhausted');
          const value = values[index];
          index += 1;
          return value;
        },
      };
    };
    const honest = () => createGkrProver({ field, circuit: DEMO_CIRCUIT, inputs: INPUTS });
    expect(() => runGkr({ field, circuit: DEMO_CIRCUIT, inputs: INPUTS, prover: honest(), challengeSource: uncheckedSource([P]) })).toThrow('outside the field');
    expect(() => runGkr({
      field,
      circuit: DEMO_CIRCUIT,
      inputs: INPUTS,
      prover: honest(),
      challengeSource: uncheckedSource([2n, 3n, 5n, 7n, 9n, P]),
    })).toThrow('outside the field');
  });

  it('refuses strategies that name a gate or layer outside the circuit', () => {
    expect(() => createGkrProver({ field, circuit: DEMO_CIRCUIT, inputs: INPUTS, strategy: { kind: 'corrupt-gate', layer: 0, gate: 0, offset: 1n } })).toThrow('internal layer');
    expect(() => createGkrProver({ field, circuit: DEMO_CIRCUIT, inputs: INPUTS, strategy: { kind: 'corrupt-wiring', layer: 1, gate: 1, in1: 9, in2: 0 } })).toThrow('reads outside');
  });
});
