# ZK Protocol Lab

[![Deploy GitHub Pages](https://github.com/systemslibrarian/zk-proof-lab/actions/workflows/pages.yml/badge.svg)](https://github.com/systemslibrarian/zk-proof-lab/actions/workflows/pages.yml)
[Live Demo](https://systemslibrarian.github.io/zk-proof-lab/)

An interactive, static-first lab for understanding zero-knowledge proofs through four exhibits, from the Ali Baba cave thought experiment to real browser-side Schnorr verification and SHA-256 commitments.

This project is built to teach the intuition fast, stay honest about what is conceptual versus cryptographically real, and show production-minded engineering in a framework-free codebase.

## Why This Matters

Zero-knowledge proofs sit at the center of modern privacy-preserving systems: authentication, blockchains, signatures, identity, and any workflow where something must be verified without exposing the underlying secret.

Most explanations either stay too abstract or jump straight into algebra. This project bridges that gap. A learner starts with the cave, understands the idea in plain English, then graduates into actual arithmetic and real hashing in the browser.

## What This Demonstrates

- Applied cryptography: BigInt modular exponentiation, challenge-response protocols, and Web Crypto SHA-256.
- Product thinking: concept-first learning flow, honest labeling, and interactive confidence-building UI.
- Frontend engineering: pure static HTML/CSS/JS, no build step, no runtime dependencies, GitHub Pages deployment.
- Systems judgment: deliberate separation between conceptual models and real cryptographic primitives.
- Accessibility and UX: keyboard focus states, mobile-friendly layout, reduced-motion support, and live-region updates for dynamic protocol state.

## Use Cases

- Teaching zero-knowledge proofs to students, teams, or interview candidates.
- Demoing why verification without disclosure matters in privacy-preserving systems.
- Showing recruiters and interviewers a project that combines cryptography, frontend execution, and clear technical communication.
- Serving as a static foundation for a larger education product or protocol visualization platform.

## Exhibits

| Exhibit | Protocol | Real vs Simulated | What the user learns in plain English |
|---|---|---|---|
| 01 | Ali Baba Cave | Conceptual | Prove you know the secret door word without saying the word |
| 02 | Graph 3-Coloring ZKP | Commitments Simplified | Prove a map is colored correctly without revealing the whole answer |
| 03 | Schnorr Identification | Real modular arithmetic | Prove you know a secret number without revealing the number |
| 04 | Hash Commit-Reveal | Real SHA-256 | Lock in a hidden choice now and prove later that you did not change it |

## Architecture

The site is intentionally simple at runtime and explicit in structure.

```text
zk-proof-lab/
├── index.html                  # museum lobby / entry point
├── exhibits/
│   ├── cave.html              # conceptual ZKP thought experiment
│   ├── graph-coloring.html    # selective reveal + simplified commitments
│   ├── schnorr.html           # real browser-side modular arithmetic
│   └── commit-reveal.html     # real browser-side SHA-256 commitment flow
├── css/
│   └── style.css              # shared visual system, mobile, accessibility
├── js/
│   ├── cave.js                # animation, soundness tracking, bluff mode
│   ├── graph.js               # challenge flow, permutations, commitment table
│   ├── schnorr.js             # BigInt modpow and transcript verification
│   └── commit.js              # Web Crypto SHA-256 and commit/reveal logic
└── docs/
    └── zkp-primer.md          # protocol property mapping and accuracy notes
```

Design choices:

- Static-first: instant load, no build pipeline, easy GitHub Pages hosting, easy offline use.
- Shared styling, isolated exhibit logic: each protocol is independently understandable and debuggable.
- Honest cryptographic boundaries: conceptual exhibits are labeled as such; real primitives are explicitly called out.

## Quick Start

No install. No framework. No build.

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

Or use the live deployment: [https://systemslibrarian.github.io/zk-proof-lab/](https://systemslibrarian.github.io/zk-proof-lab/)

## Example Results

- Cave: after 10 successful rounds, a bluffer's pass probability falls to $0.5^{10} = 0.0977\%$.
- Graph coloring: after 10 rounds, undetected cheating falls to $(5/6)^{10} \approx 16.15\%$.
- Schnorr: the verifier checks that $g^s \bmod p = R \cdot y^c \bmod p$ using real BigInt arithmetic in the browser.
- Commit-reveal: changing Bidder A's bid after committing produces a different 64-character SHA-256 digest and fails verification immediately.

## Technical Depth

### 1. Real browser-side arithmetic where it matters

The Schnorr exhibit does not fake the algebra. It uses BigInt modular exponentiation and verifies the actual identification equation in the browser. The parameters are intentionally small for readability, but the protocol mechanics are real.

### 2. Real hashing where it matters

The commit-reveal exhibit uses `window.crypto.subtle.digest('SHA-256', ...)` and cryptographically secure randomness from `crypto.getRandomValues`. This is not a toy string hash.

### 3. Deliberate honesty in protocol presentation

The cave and graph exhibits are labeled conceptual or simplified because they teach proof structure, not production commitment schemes. That honesty matters. It shows protocol understanding rather than cargo-cult crypto branding.

### 4. Reviewer-friendly engineering choices

- No framework overhead for a site that does not need it.
- Small, isolated modules per exhibit.
- Explicit control locking to avoid race conditions during async interactions.
- Accessibility improvements for dynamic state changes and keyboard navigation.

## Why Exhibit 1 Is The Cave

The Ali Baba cave is the canonical ZKP thought experiment from Jean-Jacques Quisquater and Louis Guillou's 1989 paper, "How to Explain Zero-Knowledge Protocols to Your Children."

It remains the best first explanation because it makes the three core properties intuitive without math:

- Completeness: if you know the secret word, you always come out the requested side.
- Soundness: if you are bluffing, you fail half the time.
- Zero-knowledge: the verifier never sees which path you took.

That is why this project starts with the cave before moving into Schnorr. The learner gets the mental model first, then the algebra.

## Interview Hooks

- Why keep the whole project static instead of reaching for React or a backend?
- Why explicitly label some exhibits conceptual and others real?
- What would change if Schnorr parameters were upgraded to production-grade curves?
- How would you turn this from an educational demo into a reusable protocol playground?
- What are the tradeoffs between teaching clarity and cryptographic completeness?

## Limitations

- The Schnorr parameters are intentionally tiny and educational, not secure for production use.
- The graph coloring commitments are simplified for pedagogy, not a full commitment construction.
- This is an educational frontend, not a cryptographic library or formal verifier.
- Browser execution is convenient and inspectable, but it is not a substitute for audited production systems.

## Future Improvements

- Add transcript export and replay so proofs can be compared side by side.
- Add a fifth exhibit for zk-SNARK or Fiat-Shamir transformation to connect the intuition to modern systems.
- Add automated accessibility checks and visual regression coverage.
- Add side-by-side “toy parameters vs production parameters” views for protocol realism.

## Deployment

GitHub Pages is configured through `.github/workflows/pages.yml` and deploys automatically on pushes to `main`.

## Attribution

systemslibrarian · 1 Corinthians 10:31