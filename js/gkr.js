// @ts-check
// A bounded GKR layer walk: the bare-bones layer reduction of Goldwasser, Kalai and
// Rothblum ("Delegating Computation: Interactive Proofs for Muggles", STOC 2008;
// full version ECCC TR17-108, §3.1–3.3) executed for ONE fixed two-layer arithmetic
// circuit, in the multilinear form of Thaler's Lemma 4.7 and Figure 4.13. Each layer
// is one sum-check over the previous layer's wiring identity followed by the line
// reduction of two evaluation claims to one, and the walk ends with the verifier's
// own evaluation of the input layer's multilinear extension. Nothing here implements
// the paper's uniformity machinery, its sublinear verifier or its general theorem:
// this verifier evaluates the wiring predicates by enumerating all six gates.

import { createSumcheckProver, createSumcheckVerifier } from './sumcheck.js';
import {
  addPolynomials,
  chi,
  constantPolynomial,
  evaluateMultilinearFromValues,
  evaluateUnivariate,
  labelBit,
  linearPolynomial,
  log2Exact,
  multilinearExtension,
  multiplyPolynomials,
  restrictToLine,
  scalePolynomial,
} from './polynomial.js';

/** @typedef {import('./field.js').PrimeField} PrimeField */
/** @typedef {import('./field.js').ChallengeSource} ChallengeSource */
/** @typedef {import('./polynomial.js').Polynomial} Polynomial */
/** @typedef {import('./sumcheck.js').RoundCheck} RoundCheck */
/** @typedef {import('./sumcheck.js').FinalCheck} FinalCheck */
/** @typedef {import('./sumcheck.js').SumcheckTranscript} SumcheckTranscript */

/** @typedef {{ op: 'add' | 'mult', in1: number, in2: number }} Gate */
/**
 * A layered circuit. layers[0] is the output layer and its gates read the layer-1
 * gates; the last layer's gates read the inputs, which form layer d.
 * @typedef {{ name: string, inputs: number, layers: Gate[][] }} LayeredCircuit
 */

/** The fixed walkthrough circuit: four inputs, four internal gates, two outputs. */
export const DEMO_CIRCUIT = /** @type {LayeredCircuit} */ (Object.freeze({
  name: 'two-layer add/mult walkthrough',
  inputs: 4,
  layers: [
    [{ op: 'mult', in1: 0, in2: 1 }, { op: 'add', in1: 2, in2: 3 }],
    [{ op: 'add', in1: 0, in2: 1 }, { op: 'mult', in1: 1, in2: 2 }, { op: 'add', in1: 2, in2: 3 }, { op: 'mult', in1: 0, in2: 3 }],
  ],
}));

/** Gate counts per layer, output layer first and the inputs last. @param {LayeredCircuit} circuit */
export function layerSizes(circuit) {
  return [...circuit.layers.map((layer) => layer.length), circuit.inputs];
}

/** @param {LayeredCircuit} circuit */
export function validateCircuit(circuit) {
  if (!circuit || !Array.isArray(circuit.layers) || circuit.layers.length === 0) throw new RangeError('a circuit needs at least one gate layer');
  const sizes = layerSizes(circuit);
  sizes.forEach((size) => log2Exact(size));
  circuit.layers.forEach((layer, index) => {
    const below = sizes[index + 1];
    layer.forEach((gate, position) => {
      if (gate.op !== 'add' && gate.op !== 'mult') throw new RangeError(`gate ${position} of layer ${index} has an unknown operation`);
      for (const input of [gate.in1, gate.in2]) {
        if (!Number.isInteger(input) || input < 0 || input >= below) throw new RangeError(`gate ${position} of layer ${index} reads outside layer ${index + 1}`);
      }
    });
  });
  return sizes.map(log2Exact);
}

/** @param {PrimeField} field @param {Gate[]} gates @param {bigint[]} below */
function evaluateLayer(field, gates, below) {
  return gates.map((gate) => (gate.op === 'add' ? field.add(below[gate.in1], below[gate.in2]) : field.mul(below[gate.in1], below[gate.in2])));
}

/**
 * Gate-by-gate evaluation. Returns the value table of every layer, output layer
 * first and the (normalized) inputs last: values[i] is W_i.
 * @param {PrimeField} field
 * @param {LayeredCircuit} circuit
 * @param {bigint[]} inputs
 */
export function evaluateCircuit(field, circuit, inputs) {
  validateCircuit(circuit);
  if (inputs.length !== circuit.inputs) throw new RangeError(`the circuit takes ${circuit.inputs} inputs, received ${inputs.length}`);
  const depth = circuit.layers.length;
  /** @type {bigint[][]} */
  const values = new Array(depth + 1);
  values[depth] = inputs.map((value) => field.normalize(value));
  for (let layer = depth - 1; layer >= 0; layer -= 1) {
    values[layer] = evaluateLayer(field, circuit.layers[layer], values[layer + 1]);
  }
  return values;
}

/**
 * The wiring predicate add_i or mult_i as the set of label triples (a, b, c) on
 * which it is 1: gate a of layer i has the operation and reads gates b and c of
 * layer i+1 (GKR equations (4) and (5)). This is what the verifier derives for itself.
 * @param {LayeredCircuit} circuit
 * @param {number} layer
 * @param {'add' | 'mult'} op
 */
export function wiringTriples(circuit, layer, op) {
  /** @type {Array<[number, number, number]>} */
  const triples = [];
  circuit.layers[layer].forEach((gate, label) => {
    if (gate.op === op) triples.push([label, gate.in1, gate.in2]);
  });
  return triples;
}

/**
 * The verifier's own evaluation of the multilinear extension of a wiring predicate
 * at (z, b, c): Σ over its triples of χ_a(z) · χ_b(b) · χ_c(c). Numeric only — no
 * polynomial is built, so this shares no code path with the prover's construction.
 * @param {PrimeField} field
 * @param {LayeredCircuit} circuit
 * @param {number} layer
 * @param {'add' | 'mult'} op
 * @param {bigint[]} z
 * @param {bigint[]} b
 * @param {bigint[]} c
 */
export function evaluateWiringExtension(field, circuit, layer, op, z, b, c) {
  const bits = validateCircuit(circuit);
  const here = bits[layer];
  const below = bits[layer + 1];
  let total = 0n;
  for (const [a, in1, in2] of wiringTriples(circuit, layer, op)) {
    total = field.add(total, field.mul(field.mul(chi(field, a, here, z), chi(field, in1, below, b)), chi(field, in2, below, c)));
  }
  return total;
}

/**
 * The prover's explicit polynomial for one layer (Thaler Lemma 4.7, eq. 4.18):
 *   f_z(b, c) = add̃_i(z, b, c) · (W̃_{i+1}(b) + W̃_{i+1}(c)) + mult̃_i(z, b, c) · W̃_{i+1}(b) · W̃_{i+1}(c)
 * in 2k_{i+1} variables, b first. Degree ≤ 2 in every variable.
 * @param {PrimeField} field
 * @param {LayeredCircuit} circuit
 * @param {number} layer
 * @param {bigint[]} z
 * @param {bigint[]} nextValues the prover's table for layer i+1
 */
export function layerPolynomial(field, circuit, layer, z, nextValues) {
  const bits = validateCircuit(circuit);
  const here = bits[layer];
  const below = bits[layer + 1];
  const variables = 2 * below;
  if (z.length !== here) throw new RangeError(`layer ${layer} is addressed by ${here} coordinates, received ${z.length}`);
  if (nextValues.length !== 1 << below) throw new RangeError(`layer ${layer + 1} holds ${1 << below} values`);

  /** @param {number} label @param {number} offset */
  const basis = (label, offset) => {
    let term = constantPolynomial(field, variables, 1n);
    for (let position = 0; position < below; position += 1) {
      const factor = labelBit(label, below, position) === 1
        ? linearPolynomial(field, variables, offset + position, 1n, 0n)
        : linearPolynomial(field, variables, offset + position, -1n, 1n);
      term = multiplyPolynomials(field, term, factor);
    }
    return term;
  };
  /** @param {'add' | 'mult'} op */
  const wiring = (op) => {
    let total = constantPolynomial(field, variables, 0n);
    for (const [a, in1, in2] of wiringTriples(circuit, layer, op)) {
      const scalar = chi(field, a, here, z);
      if (scalar === 0n) continue;
      total = addPolynomials(field, total, scalePolynomial(field, multiplyPolynomials(field, basis(in1, 0), basis(in2, below)), scalar));
    }
    return total;
  };
  const wB = multilinearExtension(field, nextValues, variables, 0);
  const wC = multilinearExtension(field, nextValues, variables, below);
  const addTerm = multiplyPolynomials(field, wiring('add'), addPolynomials(field, wB, wC));
  const multTerm = multiplyPolynomials(field, wiring('mult'), multiplyPolynomials(field, wB, wC));
  return addPolynomials(field, addTerm, multTerm);
}

/** The line ℓ with ℓ(0) = b and ℓ(1) = c. @param {PrimeField} field @param {bigint[]} b @param {bigint[]} c */
export function lineThrough(field, b, c) {
  if (b.length !== c.length) throw new RangeError('a line needs two points of the same dimension');
  return { base: b.map((value) => field.normalize(value)), direction: c.map((value, index) => field.sub(value, b[index])) };
}

/** @param {PrimeField} field @param {{ base: bigint[], direction: bigint[] }} line @param {bigint} t */
export function evaluateLine(field, line, t) {
  return line.base.map((value, index) => field.add(value, field.mul(line.direction[index], t)));
}

/**
 * The union bound this walk actually incurs: k_0/|F| for the output claim, then per
 * layer 2·(2k_{i+1})/|F| for the degree-2 sum-check over 2k_{i+1} variables and
 * k_{i+1}/|F| for the degree-k_{i+1} line polynomial.
 * @param {PrimeField} field
 * @param {LayeredCircuit} circuit
 */
export function gkrSoundnessBound(field, circuit) {
  const bits = validateCircuit(circuit);
  const terms = [{ label: 'output claim D̃(r0) vs W̃0(r0)', numerator: bits[0] }];
  for (let layer = 0; layer < circuit.layers.length; layer += 1) {
    terms.push({ label: `layer ${layer} sum-check: ${2 * bits[layer + 1]} variables of degree ≤ 2`, numerator: 4 * bits[layer + 1] });
    terms.push({ label: `layer ${layer} line polynomial of degree ≤ ${bits[layer + 1]}`, numerator: bits[layer + 1] });
  }
  const numerator = BigInt(terms.reduce((sum, term) => sum + term.numerator, 0));
  return { terms, numerator, denominator: field.p, value: Number(numerator) / Number(field.p) };
}

/**
 * @typedef {{ kind: 'honest' }
 *   | { kind: 'wrong-output', gate: number, offset: bigint }
 *   | { kind: 'corrupt-gate', layer: number, gate: number, offset: bigint }
 *   | { kind: 'corrupt-wiring', layer: number, gate: number, in1: number, in2: number }
 *   | { kind: 'invalid-line', layer: number, mode: 'degree' | 'value', offset?: bigint }} GkrProverStrategy
 */

/**
 * @param {Object} options
 * @param {PrimeField} options.field
 * @param {LayeredCircuit} options.circuit
 * @param {bigint[]} options.inputs
 * @param {GkrProverStrategy} [options.strategy]
 */
export function createGkrProver({ field, circuit, inputs, strategy = { kind: 'honest' } }) {
  const depth = circuit.layers.length;
  /** @type {LayeredCircuit} */
  let privateCircuit = circuit;
  if (strategy.kind === 'corrupt-wiring') {
    if (strategy.layer < 0 || strategy.layer >= depth) throw new RangeError('corrupt-wiring layer is outside the circuit');
    privateCircuit = {
      ...circuit,
      layers: circuit.layers.map((layer, index) => layer.map((gate, position) => (
        index === strategy.layer && position === strategy.gate ? { ...gate, in1: strategy.in1, in2: strategy.in2 } : { ...gate }
      ))),
    };
    validateCircuit(privateCircuit);
  }
  const values = evaluateCircuit(field, privateCircuit, inputs);
  if (strategy.kind === 'corrupt-gate') {
    if (strategy.layer < 1 || strategy.layer >= depth) throw new RangeError('corrupt-gate must name an internal layer');
    if (!(strategy.gate >= 0 && strategy.gate < values[strategy.layer].length)) throw new RangeError('corrupt-gate names a gate outside its layer');
    if (strategy.offset === 0n) throw new RangeError('corrupt-gate needs a non-zero offset');
    values[strategy.layer][strategy.gate] = field.add(values[strategy.layer][strategy.gate], strategy.offset);
    for (let layer = strategy.layer - 1; layer >= 0; layer -= 1) {
      values[layer] = evaluateLayer(field, privateCircuit.layers[layer], values[layer + 1]);
    }
  }

  return {
    strategy,
    /** The prover's value tables and circuit copy: omniscient narration, never read by the verifier. */
    privateValues: () => values.map((layer) => layer.slice()),
    privateCircuit,
    claimedOutputs() {
      const outputs = values[0].slice();
      if (strategy.kind === 'wrong-output') {
        if (!(strategy.gate >= 0 && strategy.gate < outputs.length) || strategy.offset === 0n) throw new RangeError('wrong-output needs a valid gate and a non-zero offset');
        outputs[strategy.gate] = field.add(outputs[strategy.gate], strategy.offset);
      }
      return outputs;
    },
    /** The polynomial the prover sums in layer i, from ITS circuit copy and ITS tables. @param {number} layer @param {bigint[]} z */
    layerPolynomial(layer, z) {
      return layerPolynomial(field, privateCircuit, layer, z, values[layer + 1]);
    },
    /** q(t) = W̃_{i+1}(ℓ(t)) from the prover's table. @param {number} layer @param {{ base: bigint[], direction: bigint[] }} line */
    linePolynomial(layer, line) {
      const bits = log2Exact(values[layer + 1].length);
      let q = restrictToLine(field, multilinearExtension(field, values[layer + 1]), line.base, line.direction);
      while (q.length < bits + 1) q.push(0n);
      if (strategy.kind === 'invalid-line' && strategy.layer === layer) {
        if (strategy.mode === 'degree') {
          // add t^k·(t − 1): zero at 0 and 1, degree k+1 > k
          while (q.length < bits + 2) q.push(0n);
          q[bits] = field.sub(q[bits], 1n);
          q[bits + 1] = field.add(q[bits + 1], 1n);
        } else {
          // add offset·t·(t − 1): zero at 0 and 1, so q(0) and q(1) still satisfy the final check
          const offset = strategy.offset ?? 1n;
          if (offset === 0n) throw new RangeError('invalid-line value mode needs a non-zero offset');
          while (q.length < 3) q.push(0n);
          q[1] = field.sub(q[1], offset);
          q[2] = field.add(q[2], offset);
        }
      }
      return q;
    },
  };
}

/**
 * @typedef {Object} LayerRecord
 * @property {number} layer
 * @property {bigint[]} point
 * @property {bigint} claim
 * @property {number[]} degreeBounds
 * @property {RoundCheck[]} checks
 * @property {SumcheckTranscript} sumcheck
 * @property {{ bStar: bigint[], cStar: bigint[], base: bigint[], direction: bigint[], polynomial: bigint[], degree: number, bound: number, q0: bigint, q1: bigint, addTilde: bigint, multTilde: bigint, oracleValue: bigint } | null} line
 * @property {FinalCheck | null} final
 * @property {bigint | null} rStar
 * @property {bigint[] | null} nextPoint
 * @property {bigint | null} nextClaim
 * @property {boolean} ok
 * @property {string} reason
 */

/**
 * The verifier holds the public statement only: the circuit, the inputs and the
 * randomness. It never receives the prover object.
 * @param {Object} options
 * @param {PrimeField} options.field
 * @param {LayeredCircuit} options.circuit
 * @param {bigint[]} options.inputs
 * @param {ChallengeSource} options.challengeSource
 */
export function createGkrVerifier({ field, circuit, inputs, challengeSource }) {
  const bits = validateCircuit(circuit);
  const depth = circuit.layers.length;
  if (inputs.length !== circuit.inputs) throw new RangeError(`the circuit takes ${circuit.inputs} inputs, received ${inputs.length}`);
  const publicInputs = inputs.map((value) => field.normalize(value));
  /** @type {'await-outputs' | 'await-sumcheck' | 'in-sumcheck' | 'await-line' | 'await-terminal' | 'accepted' | 'rejected'} */
  let phase = 'await-outputs';
  let layer = 0;
  /** @type {bigint[]} */
  let point = [];
  let claim = 0n;
  /** @type {bigint[]} */
  let claimedOutputs = [];
  /** @type {ReturnType<typeof createSumcheckVerifier> | null} */
  let sumcheck = null;
  /** @type {LayerRecord[]} */
  const layers = [];
  /** @type {{ claimed: bigint[], r0: bigint[], m0: bigint } | null} */
  let outputs = null;
  /** @type {{ point: bigint[], claim: bigint, evaluated: bigint, ok: boolean, reason: string } | null} */
  let terminal = null;
  let rejection = '';

  /** @param {string} reason */
  const reject = (reason) => {
    phase = 'rejected';
    rejection = reason;
  };
  /** @param {string} wanted @param {string} action */
  const requirePhase = (wanted, action) => {
    if (phase !== wanted) throw new Error(`protocol order: cannot ${action} in phase "${phase}"`);
  };

  return {
    get phase() { return phase; },
    get layer() { return layer; },
    get point() { return point.slice(); },
    get claim() { return claim; },
    bits: bits.slice(),

    /**
     * The prover's claimed outputs. The verifier draws r0 itself and computes
     * m0 = D̃(r0) from the claimed table; the rest of the walk tests that claim.
     * @param {unknown} message
     */
    receiveOutputs(message) {
      requirePhase('await-outputs', 'receive the claimed outputs');
      if (!Array.isArray(message) || message.length !== 1 << bits[0] || !message.every((value) => field.isCanonical(value))) {
        reject(`output claim: expected ${1 << bits[0]} canonical field elements`);
        return { ok: false, reason: rejection };
      }
      claimedOutputs = /** @type {bigint[]} */ (message.slice());
      const r0 = Array.from({ length: bits[0] }, () => challengeSource.draw());
      point = r0;
      claim = evaluateMultilinearFromValues(field, claimedOutputs, r0);
      outputs = { claimed: claimedOutputs.slice(), r0: r0.slice(), m0: claim };
      phase = 'await-sumcheck';
      return { ok: true, reason: `output claim D = [${claimedOutputs.join(', ')}]; r0 = [${r0.join(', ')}]; m0 = D̃(r0) = ${claim}` };
    },

    /** Open the sum-check for the current layer; the session drives it message by message. */
    startLayerSumcheck() {
      requirePhase('await-sumcheck', `start the layer-${layer} sum-check`);
      const bounds = new Array(2 * bits[layer + 1]).fill(2);
      sumcheck = createSumcheckVerifier({ field, degreeBounds: bounds, claimedSum: claim, challengeSource });
      layers.push({
        layer,
        point: point.slice(),
        claim,
        degreeBounds: bounds,
        checks: [],
        sumcheck: sumcheck.transcript(),
        line: null,
        final: null,
        rStar: null,
        nextPoint: null,
        nextClaim: null,
        ok: false,
        reason: '',
      });
      phase = 'in-sumcheck';
      return sumcheck;
    },

    /** Record a sum-check rejection raised by the layer's sum-check verifier. */
    noteSumcheckRejection() {
      requirePhase('in-sumcheck', 'record a sum-check rejection');
      const active = /** @type {ReturnType<typeof createSumcheckVerifier>} */ (sumcheck);
      const record = layers[layers.length - 1];
      record.checks = active.checks();
      record.sumcheck = active.transcript();
      record.reason = `layer ${layer}: ${active.rejection()}`;
      reject(record.reason);
    },

    /** The line through the sum-check's final point, available once every challenge is drawn. */
    currentLine() {
      requirePhase('in-sumcheck', 'read the current line');
      const active = /** @type {ReturnType<typeof createSumcheckVerifier>} */ (sumcheck);
      if (active.phase !== 'await-final') throw new Error('protocol order: the line exists only after the last sum-check challenge is drawn');
      const full = active.transcript().rounds.map((entry) => /** @type {bigint} */ (entry.challenge));
      const half = bits[layer + 1];
      return lineThrough(field, full.slice(0, half), full.slice(half));
    },

    /**
     * Receive q(t), claimed to be W̃_{i+1} on the line. The verifier checks its
     * degree, finishes the sum-check with q(0) and q(1) standing in for the two
     * evaluations it cannot make, then draws r* and moves to the next layer.
     * @param {unknown} message
     */
    receiveLine(message) {
      requirePhase('in-sumcheck', 'receive the line polynomial');
      const active = /** @type {ReturnType<typeof createSumcheckVerifier>} */ (sumcheck);
      if (active.phase !== 'await-final') throw new Error('protocol order: the line polynomial arrives only after the last sum-check challenge');
      const record = layers[layers.length - 1];
      const bound = bits[layer + 1];
      const full = active.transcript().rounds.map((entry) => /** @type {bigint} */ (entry.challenge));
      const bStar = full.slice(0, bound);
      const cStar = full.slice(bound);
      const line = lineThrough(field, bStar, cStar);
      if (!Array.isArray(message) || message.length === 0 || !message.every((value) => field.isCanonical(value))) {
        record.checks = active.checks();
        record.sumcheck = active.transcript();
        record.reason = `layer ${layer} line: the message is not a non-empty list of canonical field elements`;
        reject(record.reason);
        return { ok: false, reason: record.reason };
      }
      const q = /** @type {bigint[]} */ (message.slice());
      const degree = q.length - 1;
      if (degree > bound) {
        record.checks = active.checks();
        record.sumcheck = active.transcript();
        record.line = { bStar, cStar, base: line.base, direction: line.direction, polynomial: q, degree, bound, q0: 0n, q1: 0n, addTilde: 0n, multTilde: 0n, oracleValue: 0n };
        record.reason = `layer ${layer} line: q has degree ${degree} but W̃${layer + 1} restricted to a line has degree at most ${bound}`;
        reject(record.reason);
        return { ok: false, reason: record.reason };
      }
      const q0 = evaluateUnivariate(field, q, 0n);
      const q1 = evaluateUnivariate(field, q, 1n);
      const addTilde = evaluateWiringExtension(field, circuit, layer, 'add', point, bStar, cStar);
      const multTilde = evaluateWiringExtension(field, circuit, layer, 'mult', point, bStar, cStar);
      /** @param {bigint[]} fullPoint */
      const oracle = (fullPoint) => {
        const b = fullPoint.slice(0, bound);
        const c = fullPoint.slice(bound);
        const addHere = evaluateWiringExtension(field, circuit, layer, 'add', point, b, c);
        const multHere = evaluateWiringExtension(field, circuit, layer, 'mult', point, b, c);
        return field.add(field.mul(addHere, field.add(q0, q1)), field.mul(multHere, field.mul(q0, q1)));
      };
      const final = active.finish(oracle);
      record.checks = active.checks();
      record.sumcheck = active.transcript();
      record.final = final;
      record.line = { bStar, cStar, base: line.base, direction: line.direction, polynomial: q, degree, bound, q0, q1, addTilde, multTilde, oracleValue: final.evaluated };
      if (!final.ok) {
        record.reason = `layer ${layer}: ${final.reason} — the verifier evaluated add̃ and mult̃ from its own wiring and used the prover's q(0), q(1)`;
        reject(record.reason);
        return { ok: false, reason: record.reason };
      }
      const rStar = challengeSource.draw();
      point = evaluateLine(field, line, rStar);
      claim = evaluateUnivariate(field, q, rStar);
      record.rStar = rStar;
      record.nextPoint = point.slice();
      record.nextClaim = claim;
      record.ok = true;
      record.reason = `layer ${layer}: sum-check accepted; q has degree ${degree} ≤ ${bound}; r* = ${rStar} gives the layer-${layer + 1} claim W̃${layer + 1}(${point.join(', ')}) = ${claim}`;
      sumcheck = null;
      if (layer + 1 === depth) {
        phase = 'await-terminal';
      } else {
        layer += 1;
        phase = 'await-sumcheck';
      }
      return { ok: true, reason: record.reason };
    },

    /** The verifier evaluates the input layer's multilinear extension itself, from the public inputs. */
    terminal() {
      requirePhase('await-terminal', 'run the terminal check');
      const evaluated = evaluateMultilinearFromValues(field, publicInputs, point);
      const ok = evaluated === claim;
      terminal = {
        point: point.slice(),
        claim,
        evaluated,
        ok,
        reason: ok
          ? `terminal check: W̃${depth}(${point.join(', ')}) computed from the public inputs is ${evaluated}, equal to the carried claim`
          : `terminal check: W̃${depth}(${point.join(', ')}) computed from the public inputs is ${evaluated} but the carried claim is ${claim}`,
      };
      if (ok) phase = 'accepted';
      else reject(terminal.reason);
      return terminal;
    },

    transcript() {
      return {
        protocol: /** @type {const} */ ('gkr-layer-walk'),
        modulus: field.p,
        circuit: circuit.name,
        inputs: publicInputs.slice(),
        outputs: outputs ? { claimed: outputs.claimed.slice(), r0: outputs.r0.slice(), m0: outputs.m0 } : null,
        layers: layers.map((record) => ({ ...record })),
        terminal: terminal ? { ...terminal } : null,
      };
    },
    rejection() { return rejection; },
  };
}

/**
 * Run the whole walk. The verifier receives only messages; the prover receives only
 * the verifier's public point and challenges.
 * @param {Object} options
 * @param {PrimeField} options.field
 * @param {LayeredCircuit} options.circuit
 * @param {bigint[]} options.inputs
 * @param {ReturnType<typeof createGkrProver>} options.prover
 * @param {ChallengeSource} options.challengeSource
 */
export function runGkr({ field, circuit, inputs, prover, challengeSource }) {
  const verifier = createGkrVerifier({ field, circuit, inputs, challengeSource });
  const opening = verifier.receiveOutputs(prover.claimedOutputs());
  if (opening.ok) {
    while (verifier.phase === 'await-sumcheck') {
      const layer = verifier.layer;
      const sumcheck = verifier.startLayerSumcheck();
      // The sum-check sub-prover is the exhibit's own honest sum-check prover over the
      // polynomial the GKR prover constructs; every GKR lie lives in that polynomial's
      // inputs, never in the sum-check mechanics.
      const subProver = createSumcheckProver({ field, polynomial: prover.layerPolynomial(layer, verifier.point) });
      let failed = false;
      while (sumcheck.phase === 'await-message' || sumcheck.phase === 'await-challenge') {
        if (sumcheck.phase === 'await-message') {
          const challenges = sumcheck.transcript().rounds.flatMap((entry) => (entry.challenge === null ? [] : [entry.challenge]));
          const check = sumcheck.receiveMessage(subProver.message(sumcheck.round, challenges));
          if (!check.ok) {
            failed = true;
            break;
          }
        } else {
          sumcheck.drawChallenge();
        }
      }
      if (failed) {
        verifier.noteSumcheckRejection();
        break;
      }
      const outcome = verifier.receiveLine(prover.linePolynomial(layer, verifier.currentLine()));
      if (!outcome.ok) break;
    }
    if (verifier.phase === 'await-terminal') verifier.terminal();
  }
  const transcript = verifier.transcript();
  const accepted = verifier.phase === 'accepted';
  return {
    accepted,
    reason: accepted ? /** @type {NonNullable<typeof transcript.terminal>} */ (transcript.terminal).reason : verifier.rejection(),
    failedAt: failedStage(verifier, transcript),
    transcript,
    bound: gkrSoundnessBound(field, circuit),
  };
}

/** @typedef {{ stage: 'outputs' | 'shape' | 'degree' | 'recurrence' | 'final' | 'line-degree' | 'line-shape' | 'terminal', layer: number, round?: number }} FailedStage */

/**
 * @param {ReturnType<typeof createGkrVerifier>} verifier
 * @param {ReturnType<ReturnType<typeof createGkrVerifier>['transcript']>} transcript
 * @returns {FailedStage | null}
 */
function failedStage(verifier, transcript) {
  if (verifier.phase !== 'rejected') return null;
  if (transcript.terminal && !transcript.terminal.ok) return { stage: 'terminal', layer: transcript.layers.length };
  const last = transcript.layers[transcript.layers.length - 1];
  if (!last) return { stage: 'outputs', layer: 0 };
  if (last.final && !last.final.ok) return { stage: 'final', layer: last.layer };
  if (last.line && last.line.degree > last.line.bound) return { stage: 'line-degree', layer: last.layer };
  const check = last.checks[last.checks.length - 1];
  if (check && !check.ok) return { stage: check.failedCheck ?? 'shape', layer: last.layer, round: check.round };
  return { stage: 'line-shape', layer: last.layer };
}
