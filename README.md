# crypto-lab-zk-proof-lab

## What It Is

ZK Proof Lab is an interactive educational demo for zero-knowledge proof workflows. Five of the seven exhibits use cryptographically real primitives in the browser: the `Graph 3-Coloring ZKP` commits every region with real Web Crypto SHA-256; `Schnorr Identification`, `Fiat-Shamir`, and `Beyond Schnorr` run exact modular arithmetic; and `Hash Commit-Reveal` uses real SHA-256 commitments. `Beyond Schnorr` adds Okamoto representation proofs in the RFC 3526 2048-bit group and GQ RSA-root proofs over fresh 2048-bit WebCrypto moduli, alongside a clearly labelled p = 47 exhaustive model. The remaining two exhibits (`Ali Baba Cave`, `zk-SNARK intuition`) are clearly-labelled conceptual models. The lab addresses proving knowledge or correctness without disclosing the secret witness. It is teaching code, not an audited or constant-time cryptographic library.

The zero-knowledge property itself is exhibited rather than asserted. The Graph 3-Coloring page carries an **extractor bench** that lets you attack the hiding claim and watch what the attack actually returns. Attack 1 is a bounded brute-force preimage search that hashes ~200,000 candidate `(colour, nonce)` openings with real Web Crypto SHA-256 against the digests the page just published; it recovers nothing, and reports the fraction of the keyspace that budget covered (~2e-34) alongside the average cost of a real break (~5e38 hashes), so the failure reads as a measurement of scale rather than a claim. The identical attacker function is then re-run against the same colours committed under a deliberately weakened 8-bit nonce, where it recovers every opening in 768 hashes — the only variable is the nonce space. Attack 2 is the extractor a verifier could run offline: given only the challenged edges and the opened colour pairs, it enumerates all 3^5 = 243 colourings and keeps every one no round rules out. Because the palette is re-permuted each round, the candidate set converges on the 18 proper colourings of this graph — which is exactly the statement being proved — and never on a single one, while folding in the broken commitments from Attack 1 collapses it to 6.

There are no published known-answer vectors for the interactive Okamoto or GQ protocols. Their tests instead pin the exact RFC 3526 group-14 prime, independently establish that p and q = (p − 1)/2 are prime, recompute the deterministic h derivation, and verify every protocol and extraction equation with independent arithmetic.

## Exhibits

1. **Ali Baba Cave** — conceptual proof-of-knowledge intuition.
2. **Graph 3-Coloring ZKP** — real SHA-256 commitments plus two extractor attacks.
3. **Schnorr Identification Protocol** — real modular verification and nonce-leak recovery over readable parameters.
4. **Hash Commit-Reveal** — real Web Crypto SHA-256 binding and tamper detection.
5. **Fiat-Shamir (Non-Interactive)** — a hash-derived challenge with an explicit toy-domain collision.
6. **zk-SNARK Intuition** — a clearly labelled conceptual proving pipeline.
7. **Beyond Schnorr: representations and RSA roots** — real 2048-bit Okamoto and GQ proofs, two rewind extractors, exhaustive witness independence at toy size, and a deliberately broken e = 3 GQ challenge space.

## When to Use It

- Use it for onboarding engineers to zero-knowledge protocol flow because the exhibits show the full transcript lifecycle (commitment, challenge, response, verification) with inspectable values.
- Use it in interviews or classroom demos when you need concrete Schnorr and commit-reveal mechanics in a browser, since the implementation uses real BigInt modular arithmetic and Web Crypto SHA-256.
- Use it to teach *why* a protocol is zero-knowledge rather than to assert that it is, because the graph-coloring extractor bench runs two real attacks against the page's own digests and transcript and prints only what they returned.
- Use it for replayable protocol walkthroughs when deterministic scenarios matter, because the scenario preset and transcript lab pages let teams compare runs and reason about verifier outcomes.
- Use it to explain why Fiat-Shamir removes interactivity, because the dedicated exhibit derives the challenge from hashing transcript inputs and verifies the resulting non-interactive proof.
- Use it to compare Sigma protocols beyond Schnorr: Okamoto proves knowledge of a representation, GQ proves knowledge of an RSA root, and both reveal their witness under a same-commitment rewind.
- Do NOT use it for production security decisions, because the project explicitly uses toy parameters and small-scale models (and two clearly-labelled conceptual exhibits, cave and snark intuition) rather than deployment-grade cryptographic hardening.

## Live Demo

**[systemslibrarian.github.io/crypto-lab-zk-proof-lab](https://systemslibrarian.github.io/crypto-lab-zk-proof-lab/)**

The demo lets users run seven exhibits, execute protocol rounds, simulate cheating behavior, and inspect verification outcomes and logs. It includes real `Run Protocol`, `Simulate Cheat`, `Submit Bids`, `Reveal Bids`, rewind, replay, and reset controls, plus explicit toy-vs-real parameter boundaries. The project does not provide encryption/decryption flows; it focuses on identification proofs, commitment verification, and transcript-based verification.

## What Can Go Wrong

- Reusing Schnorr nonces (`r`) can leak the secret (`x`) from two transcripts, which breaks the core secrecy guarantee of identification proofs.
- Using small or weak group parameters makes discrete-log attacks practical, so a verifier equation that passes in the toy demo would not imply real-world security.
- Omitting transcript/domain separation details in Fiat-Shamir challenge derivation can enable replay or malleability across contexts, undermining non-interactive soundness assumptions.
- The Fiat-Shamir exhibit deliberately reduces its SHA-256 digest to a challenge in `1..50`. With `?seed=3`, the original and altered messages have different full digests but the same challenge `26`, and verification passes. This is a toy challenge-domain collision, not a SHA-256 collision. All verdict text follows the actual equation and shows original/altered challenges; an unavailable hash produces no tamper verdict. Copy/Replay preserve the original proof. See [RFC 8235 §2.3](https://www.rfc-editor.org/rfc/rfc8235.html#section-2.3) for production-sized challenge and context requirements; this small-parameter exhibit is not an RFC-conforming implementation.
- Reusing or biasing commit-reveal nonces weakens hiding and can leak bid information before reveal, defeating fairness of the commit phase.
- Failing to enforce reveal windows in commit-reveal protocols allows strategic non-reveal (griefing), which is a protocol-level failure even when hash checks are correct.
- Reusing an Okamoto or GQ commitment across two different challenges exposes the representation or RSA root; the rewind panels compute that extraction rather than merely warning about it.
- Choosing a tiny GQ exponent also creates a tiny challenge space. The deliberately broken e = 3 mode shows a prover with only public y passing about one time in three; e = 65537 is the default.

## Real-World Usage

- Bitcoin Taproot (BIP340): uses Schnorr signatures over secp256k1 for key-path spends and signature aggregation-friendly design.
- MuSig2 and related multisignature constructions: build threshold/co-signing workflows on Schnorr-style signing equations and nonce commitments.
- Zcash Sapling/Orchard proving systems: use Fiat-Shamir style transcripts to make zk proofs non-interactive in the random-oracle model.
- PLONK-family proving systems (including Halo2-style transcript designs): derive verifier challenges via Fiat-Shamir hashing of commitments and transcript state.
- Commit-reveal workflows in blockchain applications (sealed-bid auctions, name-registration schemes): use hash commitments first and delayed reveal to prevent premature disclosure and last-moment changes.

## How to Run Locally

```bash
git clone https://github.com/systemslibrarian/crypto-lab-zk-proof-lab
cd crypto-lab-zk-proof-lab
npm install
npm run dev
```

## Related Demos

- [crypto-lab-zk-arena](https://systemslibrarian.github.io/crypto-lab-zk-arena/) — side-by-side comparison of zk-SNARK and zk-STARK proof-system tradeoffs.
- [crypto-lab-snark-arena](https://systemslibrarian.github.io/crypto-lab-snark-arena/) — compares zk-SNARK constructions (Groth16, PLONK) and their trusted setup.
- [crypto-lab-stark-tower](https://systemslibrarian.github.io/crypto-lab-stark-tower/) — transparent, post-quantum zk-STARKs built on AIR constraints and FRI.
- [crypto-lab-commit-gate](https://systemslibrarian.github.io/crypto-lab-commit-gate/) — hash and Pedersen commitments demonstrating the binding and hiding properties.
- [crypto-lab-bulletproofs](https://systemslibrarian.github.io/crypto-lab-bulletproofs/) — short range proofs with no trusted setup via the inner-product argument.
- [crypto-lab-schnorr-forge](https://systemslibrarian.github.io/crypto-lab-schnorr-forge/) — same-commitment nonce reuse turned into Schnorr key recovery.
- [crypto-lab-threshold-decrypt](https://systemslibrarian.github.io/crypto-lab-threshold-decrypt/) — Chaum–Pedersen proofs for threshold partial decryptions.
- [crypto-lab-credential-veil](https://systemslibrarian.github.io/crypto-lab-credential-veil/) — a Chaum–Pedersen OR proof inside a hidden age predicate.
- [crypto-lab-rsa-forge](https://systemslibrarian.github.io/crypto-lab-rsa-forge/) — interactive RSA failure modes and attacks.

---

*Part of the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*

### GQ input verification correction

The prover now rejects inputs outside the canonical unit range before computing a
transcript. Rewinding preserves named membership errors and reports a nontrivial gcd
as a discovered factor, rather than hiding it behind a generic transcript rejection.
Retiring a result also disables its copy controls. The deploy gate replays all six
source mutations with structured reports; crashes, missing tests, and setup failures
cannot count as kills.
