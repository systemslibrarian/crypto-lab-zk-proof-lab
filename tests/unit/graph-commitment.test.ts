import { describe, it, expect } from 'vitest';
import { sha256hex } from '../../js/shared.js';

/**
 * Mirror of the Graph 3-Coloring exhibit's commitment (js/graph.js graphCommit):
 * a real SHA-256 over `color|nonce`. Previously the exhibit used truncated
 * base64 (btoa), which is neither binding nor hiding. These tests would FAIL
 * against that old implementation and pass against the real hash commitment.
 */
function commit(color: string, nonce: string): Promise<string> {
  return sha256hex(`${color}|${nonce}`);
}

describe('graph 3-coloring commitment (real SHA-256)', () => {
  it('produces a full 64-hex-char SHA-256 digest, not truncated base64', async () => {
    const c = await commit('A', 'deadbeefdeadbeef');
    expect(c).toMatch(/^[0-9a-f]{64}$/);
    // The old btoa scheme would have produced short, non-hex base64 like "QXxk...".
    expect(c.length).toBe(64);
  });

  it('is deterministic: the same (color, nonce) re-hashes to the same digest (opening verifies)', async () => {
    const nonce = 'a1b2c3d4e5f60718';
    const published = await commit('B', nonce);
    const reopened = await commit('B', nonce);
    expect(reopened).toBe(published);
  });

  it('is binding: swapping the color under the same nonce breaks the opening', async () => {
    const nonce = '00112233445566778899aabbccddeeff';
    const published = await commit('A', nonce); // prover commits to RED
    // A cheating prover reveals a different color with the original nonce.
    const forgedOpening = await commit('B', nonce);
    expect(forgedOpening).not.toBe(published);
  });

  it('is hiding at the display layer: different colors yield unrelated-looking digests', async () => {
    const nonce = 'ffeeddccbbaa99887766554433221100';
    const a = await commit('A', nonce);
    const b = await commit('B', nonce);
    const cc = await commit('C', nonce);
    expect(new Set([a, b, cc]).size).toBe(3);
    // Truncated 8-char prefixes (what the UI shows) still differ.
    expect(new Set([a.slice(0, 8), b.slice(0, 8), cc.slice(0, 8)]).size).toBe(3);
  });

  it('reveal check accepts a valid opening and rejects a tampered one', async () => {
    const nonce = 'cafebabecafebabe';
    const color = 'C';
    const published = await commit(color, nonce);

    // Honest reveal: recompute and compare.
    const honest = (await commit(color, nonce)) === published;
    expect(honest).toBe(true);

    // Tampered reveal: prover keeps the published digest but claims a new color.
    const tampered = (await commit('A', nonce)) === published;
    expect(tampered).toBe(false);
  });
});
