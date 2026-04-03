# ZK Protocol Lab

[Live Demo](https://systemslibrarian.github.io/zk-proof-lab/)

ZK Protocol Lab is a pure static HTML/CSS/JS educational site that demonstrates four zero-knowledge protocol exhibits with interactive rounds, logs, confidence meters, and honest real-vs-conceptual labeling.

ZK stands for zero-knowledge. A zero-knowledge proof lets one party prove a statement is true or that they know a secret without revealing the secret itself. These protocols are used in modern cryptography for identity systems, privacy-preserving authentication, blockchains, digital signatures, and any setting where verification matters but disclosure is undesirable.

The project is protocol-first, framework-free, and designed for instant loading and GitHub Pages deployment.

The opening cave exhibit uses the classic hidden-door secret phrase thought experiment: the prover convinces the verifier that they know the phrase that opens the door without ever revealing the phrase itself.

It is the canonical ZKP thought experiment from the foundational 1989 paper by Jean-Jacques Quisquater and Louis Guillou, "How to Explain Zero-Knowledge Protocols to Your Children." They framed the proof as a cave with a magic door, named the characters Ali Baba and Morg, and established the analogy that became the standard entry point for learners seeing zero-knowledge for the first time.

The reason it has remained the go-to introduction for decades is that it makes the three core properties intuitive without requiring any cryptographic background:

- Completeness: if you know the word, you always exit the requested side.
- Soundness: if you are bluffing, you fail half the time, every time.
- Zero-knowledge: the verifier outside never sees which path you took.

This project uses the cave as Exhibit 1 for exactly that reason: it gives the intuition before the math. A learner can understand the shape of a zero-knowledge proof in the cave first, then carry that mental model into the more algebraic Schnorr exhibit later in the sequence.

## Educational Purpose

This lab teaches how a verifier can gain confidence in a claim without learning the underlying secret.

Each exhibit follows a concept-to-protocol-to-interaction path and ends with what the verifier actually learns.

## Exhibits

| Exhibit | Protocol | Real vs Simulated | Key Concept |
|---|---|---|---|
| 01 | Ali Baba Cave | Conceptual | Show you know the secret door word without saying the word out loud |
| 02 | Graph 3-Coloring ZKP | Commitments Simplified | Show the map is colored correctly without revealing every color |
| 03 | Schnorr Identification | Real modular arithmetic | Show you know a secret number without revealing the number |
| 04 | Hash Commit-Reveal | Real SHA-256 via window.crypto.subtle | Lock in a hidden choice now and prove later that you did not change it |

## Project Structure

- index.html
- exhibits/cave.html
- exhibits/graph-coloring.html
- exhibits/schnorr.html
- exhibits/commit-reveal.html
- css/style.css
- js/cave.js
- js/graph.js
- js/schnorr.js
- js/commit.js
- docs/zkp-primer.md

## Local Development

No build step is required.

1. From repository root, run:
	python -m http.server 8000
2. Open in browser:
	http://localhost:8000

Because the site is static, it also works offline and with direct file navigation.

## GitHub Pages Deployment

Repository target: github.com/systemslibrarian/zk-protocol-lab

This repository now includes a GitHub Actions workflow at `.github/workflows/pages.yml` for Pages deployment.

1. Push the repository to GitHub.
2. In repository Settings -> Pages:
	- Source: GitHub Actions
3. Confirm the workflow has permission to deploy Pages if your org enforces workflow approval.
4. Push to `main` or run the workflow manually from the Actions tab.
5. Visit the generated Pages URL shown in the Pages settings panel after deployment completes.

## Accuracy Notes

- Cave and Graph are labeled conceptual/simplified where appropriate.
- Schnorr uses real modular arithmetic with BigInt-based modular exponentiation.
- Commit-Reveal uses real SHA-256 with window.crypto.subtle.digest and nonces from crypto.getRandomValues.

See docs/zkp-primer.md for protocol property mapping.

## Attribution

systemslibrarian · 1 Corinthians 10:31