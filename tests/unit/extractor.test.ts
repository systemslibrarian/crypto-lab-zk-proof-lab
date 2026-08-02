import { describe, it, expect } from 'vitest';
import { sha256hex } from '../../js/shared.js';
import {
  bruteForceOpenings,
  colorPermutations,
  consistentAfterOpening,
  consistentColorings,
  properColorings,
} from '../../js/extractor.js';

/**
 * The extractor bench on the Graph 3-Coloring exhibit is the lab's only
 * *exhibited* (rather than asserted) zero-knowledge claim, so both attacks are
 * pinned here: the real-SHA-256 preimage search must fail at 16-byte nonces and
 * succeed at 1-byte nonces, and the transcript extractor must never narrow the
 * candidate set below the proper colourings of the graph.
 */

// The exhibit's fixed graph (js/graph.js): a 5-cycle plus the 0–2 chord.
const EDGES: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [0, 2]];
const TRUTH = ['A', 'B', 'C', 'B', 'C'];
const NODES = 5;

// The attacker is handed exactly the hash the prover used, and nothing else.
const hash = (input: string) => sha256hex(input);
const commit = (color: string, nonce: string) => hash(`${color}|${nonce}`);

const fullTranscript = () =>
  EDGES.map((edge) => ({
    edge,
    revealed: [TRUTH[edge[0]], TRUTH[edge[1]]] as [string, string],
  }));

describe('palette permutations', () => {
  it('enumerates exactly the 6 bijections of a 3-colour palette', () => {
    const perms = colorPermutations();
    expect(perms).toHaveLength(6);
    expect(new Set(perms.map((p) => p.join(''))).size).toBe(6);
    for (const perm of perms) {
      expect(new Set(perm).size).toBe(3);
    }
  });
});

describe('transcript extractor (what a transcript-only verifier can know)', () => {
  it('rules out nothing before any round: the whole 3^5 space survives', () => {
    expect(consistentColorings(NODES, [])).toHaveLength(243);
  });

  it('the true colouring always survives — the extractor is complete', () => {
    const candidates = consistentColorings(NODES, fullTranscript());
    expect(candidates.some((c) => c.every((color, i) => color === TRUTH[i]))).toBe(true);
  });

  it('never narrows below the proper colourings of the graph — the statement itself', () => {
    const proper = properColorings(NODES, EDGES);
    // The exhibit's prose cites this count; pin it so the prose cannot drift.
    expect(proper).toHaveLength(18);

    const candidates = consistentColorings(NODES, fullTranscript());
    expect(candidates).toHaveLength(proper.length);
    // Challenging every edge yields exactly the proper colourings, no more.
    const properKeys = new Set(proper.map((c) => c.join('')));
    for (const candidate of candidates) {
      expect(properKeys.has(candidate.join(''))).toBe(true);
    }
  });

  it('a round only excludes colourings that clash on the challenged edge', () => {
    const transcript = [{ edge: [0, 1] as [number, number], revealed: ['A', 'B'] as [string, string] }];
    const candidates = consistentColorings(NODES, transcript);
    // 3^5 total minus the 3 * 3^3 assignments giving node 0 and node 1 the same colour.
    expect(candidates).toHaveLength(243 - 81);
    expect(candidates.every((c) => c[0] !== c[1])).toBe(true);
  });

  it('a fresh permutation each round is what stops an opened pair from pinning a label', () => {
    // The verifier opened edge 0-1 twice and saw two different colour pairs.
    // Per-round permutations make both openings consistent with the same
    // colouring; a fixed palette would have made them contradictory.
    const transcript = [
      { edge: [0, 1] as [number, number], revealed: ['A', 'B'] as [string, string] },
      { edge: [0, 1] as [number, number], revealed: ['C', 'A'] as [string, string] },
    ];
    expect(consistentColorings(NODES, transcript)).toHaveLength(243 - 81);
  });
});

describe('folding in a broken commitment', () => {
  it("knowing one round's full opening pins the colouring to its 6 relabelings", () => {
    const broken = consistentAfterOpening(NODES, [], ['A', 'B', 'C', 'B', 'C']);
    expect(broken).toHaveLength(6);
    expect(broken.some((c) => c.every((color, i) => color === TRUTH[i]))).toBe(true);
  });

  it('leaks strictly more than the transcript alone', () => {
    const zk = consistentColorings(NODES, fullTranscript()).length;
    const withBreak = consistentAfterOpening(NODES, fullTranscript(), TRUTH).length;
    expect(zk).toBe(18);
    expect(withBreak).toBe(6);
    expect(withBreak).toBeLessThan(zk);
  });
});

describe('brute-force preimage attack on the commitments (real SHA-256)', () => {
  it('recovers every colour when the nonce is 8 bits — proof the attacker works', async () => {
    const digests = await Promise.all([commit('A', '2a'), commit('B', 'ff'), commit('C', '00')]);
    const result = await bruteForceOpenings(digests, { nonceBytes: 1, budget: 3 * 256, hash });
    expect(result.recovered).toEqual(['A', 'B', 'C']);
    expect(result.recoveredCount).toBe(3);
    expect(result.keyspace).toBe(768);
    expect(result.hashesTried).toBeLessThanOrEqual(768);
  });

  it("recovers nothing against the exhibit's 16-byte nonce within a browser-sized budget", async () => {
    const digests = await Promise.all([
      commit('A', '9f2c41a7be03d5178c6e0b4a2df91c33'),
      commit('B', '0117aa39c4e2bd6650f8731c9a4de205'),
    ]);
    const budget = 6000;
    const result = await bruteForceOpenings(digests, { nonceBytes: 16, budget, hash });
    expect(result.recoveredCount).toBe(0);
    expect(result.recovered).toEqual([null, null]);
    expect(result.hashesTried).toBe(budget);
    // 3 * 2^128 openings exist; the searched fraction is what the panel prints.
    expect(result.keyspace).toBe(3 * 2 ** 128);
    expect(result.fractionSearched).toBeLessThan(1e-30);
    expect(result.expectedHashesToBreak).toBe(result.keyspace / 2);
    expect(result.exhausted).toBe(false);
  });

  it('stops at the budget rather than running away', async () => {
    // Nonce 0xaa = 170, so a 300-hash budget (100 nonces) cannot reach it.
    const digests = [await commit('A', '00aa'), 'f'.repeat(64)];
    const result = await bruteForceOpenings(digests, { nonceBytes: 2, budget: 300, hash });
    expect(result.hashesTried).toBe(300);
    expect(result.recoveredCount).toBe(0);
    expect(result.exhausted).toBe(false);
  });
});
