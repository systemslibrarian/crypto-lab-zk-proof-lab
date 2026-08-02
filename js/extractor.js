// @ts-check
// Extractor bench for the Graph 3-Coloring exhibit (js/graph.js).
//
// The rest of the lab *states* the zero-knowledge property. This module makes
// the learner able to attack it and measure what the attack actually yields.
// Nothing here is narrated: every number the panel prints comes out of one of
// the two functions below, run against the digests and transcript that the
// current round really produced.
//
// Attack 1 — `bruteForceOpenings` is a real bounded preimage search against the
// published SHA-256(colour ‖ nonce) commitments. It enumerates the nonce space
// in order and hashes each candidate opening with Web Crypto. Against the
// exhibit's 16-byte nonce it recovers nothing; against a deliberately weakened
// 1-byte nonce the *same* function recovers every colour. That contrast is the
// point: hiding is a property of the nonce space, not of the word "commitment".
//
// Attack 2 — `consistentColorings` is the extractor a verifier could actually
// run offline. Given only the challenge/reveal transcript, it enumerates all
// 3^n assignments and keeps the ones no round rules out. Because the prover
// re-permutes the palette every round, a round only rules out assignments that
// give its two endpoints the same colour, so the candidate set converges on
// "the proper colourings of the challenged edges" — which is the statement
// being proved — and never on a single colouring.

/** The three colour identifiers the exhibit commits to. */
export const COLOR_IDS = ['A', 'B', 'C'];

/**
 * All 6 palette permutations, as arrays where entry i is the image of
 * COLOR_IDS[i]. Same convention as the prover's `shuffleColors()`.
 * @returns {string[][]}
 */
export function colorPermutations() {
  /** @type {string[][]} */
  const out = [];
  for (const i of [0, 1, 2]) {
    for (const j of [0, 1, 2]) {
      for (const k of [0, 1, 2]) {
        if (i !== j && j !== k && i !== k) {
          out.push([COLOR_IDS[i], COLOR_IDS[j], COLOR_IDS[k]]);
        }
      }
    }
  }
  return out;
}

/**
 * @typedef {Object} RevealRound
 * @property {[number, number]} edge the challenged edge
 * @property {[string, string]} revealed the two opened (permuted) colours
 */

/**
 * Decode an integer into a colour assignment over `nodeCount` nodes, base 3.
 * @param {number} code
 * @param {number} nodeCount
 * @returns {string[]}
 */
function decodeAssignment(code, nodeCount) {
  /** @type {string[]} */
  const assignment = [];
  let remaining = code;
  for (let i = 0; i < nodeCount; i += 1) {
    assignment.push(COLOR_IDS[remaining % 3]);
    remaining = Math.floor(remaining / 3);
  }
  return assignment;
}

/**
 * True when `assignment` could have produced this round's opened pair under
 * *some* palette permutation. The permutation is fresh and secret each round,
 * so the verifier must quantify over all 6 rather than assume one.
 * @param {string[]} assignment
 * @param {RevealRound} round
 * @param {string[][]} perms
 * @returns {boolean}
 */
function roundAllows(assignment, round, perms) {
  const [a, b] = round.edge;
  const ia = COLOR_IDS.indexOf(assignment[a]);
  const ib = COLOR_IDS.indexOf(assignment[b]);
  return perms.some(perm => perm[ia] === round.revealed[0] && perm[ib] === round.revealed[1]);
}

/**
 * Every colouring of `nodeCount` nodes that the transcript does not rule out.
 * This is the honest measure of what a transcript-only verifier knows.
 * @param {number} nodeCount
 * @param {RevealRound[]} transcript
 * @returns {string[][]}
 */
export function consistentColorings(nodeCount, transcript) {
  const perms = colorPermutations();
  const total = 3 ** nodeCount;
  /** @type {string[][]} */
  const candidates = [];
  for (let code = 0; code < total; code += 1) {
    const assignment = decodeAssignment(code, nodeCount);
    if (transcript.every(round => roundAllows(assignment, round, perms))) {
      candidates.push(assignment);
    }
  }
  return candidates;
}

/**
 * Colourings that remain once the attacker also holds a full opened colouring
 * for one round — i.e. once commitment hiding has been broken. Knowing σ(c)
 * for a secret permutation σ pins c down to the 6 relabelings of σ(c), which
 * is strictly more than the transcript alone leaks.
 * @param {number} nodeCount
 * @param {RevealRound[]} transcript
 * @param {string[]} openedColoring the permuted colouring recovered by the attack
 * @returns {string[][]}
 */
export function consistentAfterOpening(nodeCount, transcript, openedColoring) {
  const perms = colorPermutations();
  return consistentColorings(nodeCount, transcript).filter(candidate =>
    perms.some(perm =>
      candidate.every((color, node) => perm[COLOR_IDS.indexOf(color)] === openedColoring[node])));
}

/**
 * Assignments that are proper on every edge of the graph — the set the
 * candidate list converges to, and the floor the verifier can never go below,
 * because that set *is* the statement "a proper 3-colouring exists".
 * @param {number} nodeCount
 * @param {[number, number][]} edges
 * @returns {string[][]}
 */
export function properColorings(nodeCount, edges) {
  const total = 3 ** nodeCount;
  /** @type {string[][]} */
  const proper = [];
  for (let code = 0; code < total; code += 1) {
    const assignment = decodeAssignment(code, nodeCount);
    if (edges.every(([a, b]) => assignment[a] !== assignment[b])) {
      proper.push(assignment);
    }
  }
  return proper;
}

/**
 * @typedef {Object} AttackResult
 * @property {number} hashesTried real SHA-256 invocations actually performed
 * @property {(string|null)[]} recovered opened colour per digest, null if unbroken
 * @property {number} recoveredCount
 * @property {number} keyspace total (colour, nonce) openings that exist
 * @property {number} fractionSearched hashesTried / keyspace
 * @property {number} expectedHashesToBreak keyspace / 2, the average cost of success
 * @property {boolean} exhausted true when the whole keyspace was searched
 */

/**
 * Bounded brute-force preimage search against published commitments.
 *
 * Enumerates nonces 0,1,2,… over the given byte width, hashes every
 * (colour, nonce) pair with the supplied real hash function, and matches the
 * digests against the published ones. No shortcut and no oracle: the only way
 * it recovers a colour is by actually re-deriving the prover's digest.
 *
 * @param {string[]} digests published commitments to attack
 * @param {{nonceBytes: number, budget: number, hash: (input: string) => Promise<string>, chunk?: number}} options
 * @returns {Promise<AttackResult>}
 */
export async function bruteForceOpenings(digests, { nonceBytes, budget, hash, chunk = 500 }) {
  /** @type {(string|null)[]} */
  const recovered = digests.map(() => null);
  /** @type {Map<string, number[]>} */
  const targets = new Map();
  digests.forEach((digest, index) => {
    const bucket = targets.get(digest);
    if (bucket) {
      bucket.push(index);
    } else {
      targets.set(digest, [index]);
    }
  });

  const nonceSpace = Math.pow(256, nonceBytes);
  const keyspace = nonceSpace * COLOR_IDS.length;
  let hashesTried = 0;
  let nonce = 0;

  while (hashesTried < budget && nonce < nonceSpace && recovered.some(value => value === null)) {
    /** @type {{color: string, nonce: string}[]} */
    const batch = [];
    while (batch.length < chunk && nonce < nonceSpace
      && hashesTried + batch.length + COLOR_IDS.length <= budget) {
      const nonceHex = nonce.toString(16).padStart(nonceBytes * 2, '0');
      for (const color of COLOR_IDS) {
        batch.push({ color, nonce: nonceHex });
      }
      nonce += 1;
    }
    const digestsOut = await Promise.all(batch.map(candidate => hash(`${candidate.color}|${candidate.nonce}`)));
    hashesTried += batch.length;
    digestsOut.forEach((digest, i) => {
      const hits = targets.get(digest);
      if (hits) {
        hits.forEach(index => {
          recovered[index] = batch[i].color;
        });
      }
    });
  }

  return {
    hashesTried,
    recovered,
    recoveredCount: recovered.filter(value => value !== null).length,
    keyspace,
    fractionSearched: hashesTried / keyspace,
    expectedHashesToBreak: keyspace / 2,
    exhausted: nonce >= nonceSpace
  };
}
