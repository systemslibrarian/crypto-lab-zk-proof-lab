# ZKP Primer

## Core Properties

Completeness: If the prover is honest and really knows the witness (secret), an honest verifier should accept.

Soundness: If the prover does not know the witness, they should only pass with small probability.

Zero-knowledge: The verifier should learn nothing beyond the truth of the statement being proved.

## How The Four Exhibits Map

## Exhibit 01 - Ali Baba Cave (Conceptual)

- Completeness: A prover with the secret door phrase can always exit whichever side is requested.
- Soundness: A bluffer can only guess correctly with probability 1/2 per round, so undetected cheating is (1/2)^n.
- Zero-knowledge: The verifier never sees which branch was taken, only successful compliance with challenges.

## Exhibit 02 - Graph 3-Coloring (Commitments Simplified)

- Completeness: A prover with a valid coloring always reveals different colors on any challenged edge.
- Soundness: For this graph, at least one bad edge must exist in a fake coloring, so each challenge catches cheating with probability 1/6 and undetected cheating is (5/6)^k.
- Zero-knowledge: Random color permutation each round prevents linking revealed local colors into a global coloring.

## Exhibit 03 - Schnorr Identification (Real Arithmetic)

- Completeness: With secret x, the prover computes s = r + c*x (mod p-1), so verification g^s == R*y^c (mod p) passes.
- Soundness: A prover without x cannot answer fresh random challenges consistently except with small chance.
- Honest-verifier zero-knowledge: Transcript structure can be simulated for random c, s in the idealized model, showing no x leakage.

## Exhibit 04 - Commit-Reveal with SHA-256 (Real Hash)

- Binding: After publishing hash(bid || nonce), changing bid or nonce changes hash and is detected. For a hash commitment this is the strong half — breaking it means finding a SHA-256 collision.
- Hiding: Computational, and supplied by the nonce rather than by the hash. Bids are drawn from $100-$999, a 900-value space, so hash(bid) with no nonce would hide nothing: enumerate all 900 candidates and read the bid off the table. The fresh 32-byte nonce is what puts the preimage beyond search. Even then the guarantee rests on SHA-256 being hard to invert. A Pedersen commitment inverts the tradeoff: perfect hiding (even against an unbounded adversary), computational binding.
- Caveat: under `?seed=...` the nonce comes from a deterministic RNG seeded from the URL, so in preset-replay mode it is not secret and hiding does not hold.
- Verification: During reveal, anyone recomputes SHA-256 and checks exact digest equality.

## Real vs Simulated Labeling

This lab labels each exhibit honestly:

- "Conceptual" means protocol behavior is demonstrated faithfully but cryptographic commitments may be simplified for teaching clarity.
- "Real" means the cryptographic primitive is actually executed in the browser (BigInt modular exponentiation, Web Crypto SHA-256).

This distinction prevents overclaiming and helps learners separate protocol intuition from production-grade parameter sizes.
