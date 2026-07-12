# crypto-lab-zk-proof-lab

## What It Is

ZK Proof Lab is an interactive educational demo for zero-knowledge proof workflows. Four of the six exhibits use cryptographically real primitives in the browser: the `Graph 3-Coloring ZKP` commits every region with a real `window.crypto.subtle.digest('SHA-256', color ‖ nonce)` and re-hashes each opening on reveal; the `Schnorr Identification Protocol` and `Fiat-Shamir (Non-Interactive)` run real BigInt modular arithmetic; and `Hash Commit-Reveal` uses real SHA-256 commitments. The remaining two exhibits (`Ali Baba Cave`, `zk-SNARK intuition`) are clearly-labelled conceptual models. It addresses the problem of proving knowledge or correctness without disclosing the secret witness. The security model shown in code is primarily honest-verifier ZK for the interactive proofs, plus hash-based binding/hiding for commitments, with explicit notes where the exhibit is pedagogical rather than production hardened. It is a teaching lab, not an audited cryptographic library. Parameters are intentionally small in the real-math exhibits for traceability and UI clarity.

## When to Use It

- Use it for onboarding engineers to zero-knowledge protocol flow because the exhibits show the full transcript lifecycle (commitment, challenge, response, verification) with inspectable values.
- Use it in interviews or classroom demos when you need concrete Schnorr and commit-reveal mechanics in a browser, since the implementation uses real BigInt modular arithmetic and Web Crypto SHA-256.
- Use it for replayable protocol walkthroughs when deterministic scenarios matter, because the scenario preset and transcript lab pages let teams compare runs and reason about verifier outcomes.
- Use it to explain why Fiat-Shamir removes interactivity, because the dedicated exhibit derives the challenge from hashing transcript inputs and verifies the resulting non-interactive proof.
- Do NOT use it for production security decisions, because the project explicitly uses toy parameters and small-scale models (and two clearly-labelled conceptual exhibits, cave and snark intuition) rather than deployment-grade cryptographic hardening.

## Live Demo

**[systemslibrarian.github.io/crypto-lab-zk-proof-lab](https://systemslibrarian.github.io/crypto-lab-zk-proof-lab/)**

The demo lets users run six exhibits, execute protocol rounds, simulate cheating behavior, and inspect verification outcomes and logs. It includes real `Run Protocol`, `Simulate Cheat`, `Submit Bids`, `Reveal Bids`, replay, and reset controls, plus explicit toy-vs-production parameter tables (for example `p = 2053`, `g = 5`, and challenge range in the Schnorr exhibit). The project does not provide encryption/decryption flows; it focuses on identification proofs, commitment verification, and transcript-based verification.

## What Can Go Wrong

- Reusing Schnorr nonces (`r`) can leak the secret (`x`) from two transcripts, which breaks the core secrecy guarantee of identification proofs.
- Using small or weak group parameters makes discrete-log attacks practical, so a verifier equation that passes in the toy demo would not imply real-world security.
- Omitting transcript/domain separation details in Fiat-Shamir challenge derivation can enable replay or malleability across contexts, undermining non-interactive soundness assumptions.
- Reusing or biasing commit-reveal nonces weakens hiding and can leak bid information before reveal, defeating fairness of the commit phase.
- Failing to enforce reveal windows in commit-reveal protocols allows strategic non-reveal (griefing), which is a protocol-level failure even when hash checks are correct.

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

---

*One of 120+ browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
