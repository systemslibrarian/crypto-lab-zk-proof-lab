# Extension brief — `crypto-lab-zk-proof-lab`

**2026-10-20. Extension to a live lab; no new repository.** Written against
`crypto-lab-zk-proof-lab` at `f330427c42a2` and `audits/_MASTER-TEMPLATE.md` (catalog
`20cb434d89e4`). Template §5: "Extend, never restructure." Source of the gap: Boneh–Shoup v0.6
§19.5.1 (Okamoto's protocol for representations), §19.5.5 (the GQ protocol), §19.8 and §19.8.4
(witness independence; Okamoto's identification protocol).

**Verdict: extension — a new Exhibit 07, "Beyond Schnorr: representations and RSA roots",
beside the existing Schnorr exhibit.**

**Scope cut, stated up front.** The gap analysis that commissioned this brief listed AND/OR
composition. OR-proofs are being added to `crypto-lab-threshold-decrypt` (the in-flight
disjunctive Chaum–Pedersen 0-or-1 ballot proof), and `crypto-lab-credential-veil` at
`f06bbcaefb28` already has a Chaum–Pedersen OR proof in `src/predicate/ageProof.ts:14`. This
extension does **not** re-specify OR-proofs; it cross-links both.

## What the lab has now (at `f330427c42a2`)

- **Stack:** multi-page Vite site, vanilla JS with `// @ts-check` in `js/*.js`, no crypto
  dependencies in `package.json` (WebCrypto only). Pages are registered as Rollup inputs in
  `vite.config.ts`; each exhibit page carries its own nav (e.g. `exhibits/schnorr.html:30–38`),
  and the hub lists cards at `index.html:194–229` and nav links at `index.html:153–159`.
- **Schnorr exhibit:** `exhibits/schnorr.html` + `js/schnorr.js`. Toy parameters p = 2053, g = 5,
  responses mod p − 1 = 2052 (`js/schnorr.js:227`), challenge c ∈ [1, 50] (`:99`, `:221`), a
  cheat mode (`schnorrRun(true)`, `:199`) and a nonce-leak key recovery.
- **Shared helpers:** `js/shared.js` — `modpow(base, exp, mod)` (`:188`) computes with BigInt
  but **returns a `Number`** (`return Number(result)`), so it cannot carry 2048-bit values;
  `schnorrVerify` (`:218`); `gcd` and `modInverse` (`:229`, `:247`) are Number-based and not
  exported; `recoverSchnorrSecret` (`:275`); `sha256hex` (`:302`).
- **Existing citation to keep distinct:** `exhibits/cave.html:47` cites Quisquater, Guillou &
  Berson, CRYPTO 1989 (the cave story). The GQ *protocol* is a different paper (EUROCRYPT 1988,
  below). Do not merge the two citations.
- **Tests:** Vitest over `tests/unit/**/*.test.ts` (`vitest.config.ts`); `e2e/claims.spec.ts`
  (recomputes Schnorr and Fiat–Shamir equations with its own BigInt `modpow`, `:25`);
  `e2e/tamper-collision.spec.ts`; Playwright on port 4342 `--strictPort`.
- **Mutation tooling:** none found (searched for `mutat|ledger`); perform §4.1c by hand.
- **Overlap check (grep across all lab clones for `okamoto[^-]`, `guillou`, `quisquater`,
  `representation of`, `witness.?independ`, excluding Fujisaki–Okamoto hits):** only the
  cave citation above. `crypto-lab-schnorr-forge` at `2dccfc213625` already shows
  special-soundness extraction in its Schnorr form (`src/ui/attackPanel.ts`, "Nonce Reuse → Key
  Recovery"); cross-link it — two transcripts with one commitment *is* a reused nonce.

## What to add

**The one headline mechanism:** special soundness, made general. Two accepting answers to two
challenges on the same commitment hand over the witness — for a *pair* of exponents
(Okamoto) and for an *e-th root mod N* (GQ, via Shamir's trick, Theorem 10.6) — and, for
Okamoto, a verifier cannot tell which of the q witnesses the prover holds.

**Act A — Okamoto's protocol (Fig. 19.6).** Statement u = g^α·h^β in a prime-order group.
Commit u_t = g^{α_t}·h^{β_t}; challenge c; response (α_z, β_z) = (α_t + αc, β_t + βc) mod q;
verify g^{α_z}·h^{β_z} = u_t·u^c.
- *Real-size run:* the order-q subgroup of the RFC 3526 2048-bit MODP group (group 14), q =
  (p − 1)/2, g = 4 (a square, so it lies in the order-q subgroup — verify in tests, below),
  and **h derived nothing-up-my-sleeve**: expand a published seed string with SHA-256 in counter
  mode to 2048+64 bits, reduce mod p, square. Show the seed on the page; nobody, including the
  page, knows log_g h.
- *Break-it — rewind the prover:* "Answer a second challenge on the same commitment." The page
  computes α̂ = (α_z − α′_z)/(c − c′), β̂ likewise, mod q, and checks g^α̂·h^β̂ = u and
  (α̂, β̂) = the prover's witness.
- *Witness independence, exhaustive at toy size (p = 47, q = 23, g = 4):* construct a second
  representation of the same u (possible only because q = 23 lets the page brute-force log_g h
  — say so), then enumerate every (α_t, β_t) ∈ Z_q² for every c ∈ Z_q for both witnesses and
  show the two transcript multisets are identical (23 × 529 = 12,167 transcripts each). Repeat
  with an adaptive cheating verifier, c = f(u_t) (e.g. u_t mod 23): still identical (Theorem
  19.21, special HVZK ⇒ witness independence).
- *Why two witnesses are dangerous (Fact 10.3):* from the two toy representations the page
  computes log_g h = (α − α′)/(β′ − β) mod q and checks g^{that} = h. One line of copy: at real
  size, holding two representations of u would compute log_g h — which is why Okamoto's
  identification protocol is secure against active attacks (Theorem 19.23).

**Act B — GQ (Fig. 19.10).** RSA modulus N, prime e; statement y = x^e mod N. Commit
y_t = x_t^e; challenge c ∈ {0, …, e−1}; response x_z = x_t·x^c; verify x_z^e = y_t·y^c.
- N comes from WebCrypto (`generateKey` RSA, 2048-bit, exported as JWK; only n is used by the
  protocol). e = 65537 by default.
- *Break-it — rewind:* two transcripts with the same y_t; Δx = x_z/x′_z, Δc = c − c′; extended
  Euclid gives s·e + t·Δc = 1; root = y^s·Δx^t (negative exponents via inverses mod N). Check
  root^e = y and root = x.
- *Break-it — small e:* switch to e = 3. A cheating prover who is given **only y** guesses c*,
  picks x_z, sets y_t = x_z³/y^{c*}, and passes whenever the verifier draws c = c*. The page
  runs the real verifier until it accepts and reports the attempt count; with e = 65537 the
  same strategy is run a fixed 1,000 times and its acceptance count is printed (expected about
  1,000/65,537). This is the book's own caveat in §19.5.5 ("when e is small, the challenge space
  is small"); Exercise 19.6 (enlarging the challenge space) is an extension seam.

## Why it belongs here and not in a new lab

This lab is the fleet's Sigma-protocol teaching page: its Schnorr exhibit already has the
cheat mode, the transcript log and the claims suite that recomputes verifier equations.
Okamoto and GQ are the book's two "Sigma protocols beyond Schnorr", and each reuses that
machinery. A new repo would rebuild the Schnorr scaffolding to add two equations.

## SECURITY / CORRECTNESS INVARIANTS

1. All real-size arithmetic is BigInt end to end. Add `modpowBig(base, exp, mod): bigint` and an
   exported BigInt `egcd` in `js/shared.js` beside the existing helpers; **do not change**
   `modpow`'s Number return (existing exhibits and `tests/unit/crypto-core.test.ts` depend on it).
2. Group membership is checked before use: u, u_t ∈ the order-q subgroup (z^q = 1, z ≠ 0) in
   Act A; y, y_t, x_z ∈ Z*_N (gcd with N = 1) in Act B. Non-members are refused by name.
3. Okamoto requires prime order: the existing full-group Z*_2053 parameters (order 2052) are not
   reused for Act A; say why on the page in one line.
4. h's derivation is deterministic from the shown seed and is recomputed by the tests.
5. The GQ cheating prover's function signature receives y and e only — it is structurally unable
   to see x. The page says the honest prover and the cheater run in one tab.
6. For e = 3 the page needs x ↦ x³ to be a bijection on Z*_N: generate with
   `publicExponent = 3` if the browser accepts it; otherwise generate with 65537 and retry until
   neither p − 1 nor q − 1 is divisible by 3, using the JWK's p and q for that check only and then
   discarding them. Report which path ran.
7. Every rendered verdict is computed (verify equation, extraction check, multiset equality,
   attempt count) and carries its numbers.

## ARCHITECTURE

- `js/sigma.js` (`// @ts-check`): `okamotoParams()`, `deriveH(seed)`, `okamotoProve/Verify`,
  `okamotoExtract`, `enumerateTranscripts(witness, verifierStrategy)` (toy only),
  `dlogFromTwoReps(rep1, rep2, q)`; `gqKeygen(e)`, `gqProve/Verify`, `gqExtract`,
  `gqCheatingProver(y, e, N)`.
- `exhibits/sigma-family.html` + `js/sigma-ui.js`: Act A, Act B; register the page in
  `vite.config.ts` `rollupOptions.input`.
- Nav: add "07" to the hub nav (`index.html:153–159`), a hub card in the `index.html` card grid
  with an honest badge ("REAL BIGINT ARITHMETIC · 2048-BIT"), and the "07" link in the nav block
  of **every** exhibit page (grep `class="nav-link"` across `exhibits/*.html`).
- `// [extension] point` markers: (a) Exercise 19.6 challenge-space enlargement for GQ,
  (b) Fiat–Shamir versions of both (link Exhibit 05), (c) the AND composition of Okamoto and GQ.

## UI

Plain-language intro first (2–4 sentences, no math): "Schnorr proves you know one secret
exponent. The same three-move pattern proves you know a pair of exponents, or an RSA root —
and if you can answer twice for one commitment, you hand the secret over."
Act A: Run → transcript table (u_t, c, α_z, β_z) and the verify equation with both sides
printed; "Rewind" → second row, extraction, check. Toy panel: "Enumerate both witnesses" →
two histograms/tables with the equality verdict and counts; "Adaptive verifier" toggle; Fact
10.3 readout. Act B: Run (e = 65537) → transcript and verify; "Rewind" → extraction; e toggle
65537 / 3 → "Run the cheater" → attempts until accept; at 65537, "Run the cheater 1,000×" →
acceptances. Long values are ellipsised with copy buttons; stacks below 640px.

## VISUAL SEMANTICS

Honest proof accepted: success. Extraction succeeded: **ALARM** for the prover (the secret is
out), labelled "the protocol working as designed: special soundness". Witness-independence
equality: success with counts. Cheater accepted at e = 3: **ALARM** — accepted and the prover
holds no root. Icon + text + colour everywhere.

## EDGE CASES

- c = c′ on rewind → refused ("special soundness needs two different challenges").
- Δc ≡ 0 mod e, or gcd(Δx, N) ≠ 1 → refused by name (and, for the gcd, the page reports that it
  has found a factor of N — true, and worth saying).
- Non-member input in either act → refused before any verify call.
- Toggling e or regenerating N retires every GQ verdict and says so; the 1,000× counter resets.
- WebCrypto RSA keygen rejected → error shown, no silent fallback to a toy N in the real-size act.

## Tests

- **Vitest `tests/unit/sigma.test.ts`:** p for RFC 3526 group 14 equals the RFC's hex (copied from
  the RFC text) and both p and q = (p − 1)/2 pass Node's `crypto.checkPrimeSync` (an independent
  implementation); g^q = 1 and g ≠ 1; `deriveH` matches a recomputation; Okamoto round trip,
  rejection of a wrong response, extraction equals the witness; toy enumeration equality for
  both a random and an adaptive verifier, and *inequality* for a control variant that fixes the
  nonce pair (α_t, β_t) instead of sampling it — its transcripts then differ between the two
  witnesses, which proves the equality test can fail; Fact 10.3 recovers the brute-forced log; GQ round
  trip with a Node-generated RSA key (`crypto.generateKeyPairSync`, independent of WebCrypto),
  extraction equals x, Shamir's-trick root^e = y; cheater acceptance at e = 3 over 3,000 trials
  within a binomial confidence band around 1/3.
- **KATs:** none exist for Okamoto or GQ — say so in the README. The RFC 3526 prime is the pinned
  constant; its correctness is checked by hex equality plus primality, not by memory.
- **`e2e/claims.spec.ts` additions:** recompute both verify equations from values read out of the
  DOM with the spec's own BigInt `modpow`; parse the extracted witness and check
  g^α̂·h^β̂ = u (and root^e = y); parse the enumeration counts and check 23 × 529; recompute
  log_g h from the two printed toy representations; GQ cheater: the printed attempt count is ≥ 1
  and the accepted transcript verifies; retirement on e toggle; no-op guard.
- **§4.1c mutations (five steps each):** Okamoto verify drops the h-term; extraction swaps the
  sign of Δc; enumeration compares only lengths; GQ verify omits y^c; Shamir's trick uses t for s;
  the e = 3 cheater check ignores c. Each must turn a named test red.
- **§4.1d negative claim — "With a small exponent e, an accepted GQ proof does not show the
  prover knows an e-th root: a cheater who holds only y passes about one time in e."** Evidence
  fixture: e = 3, cheater run until accepted; every verdict on screen reports success (verify
  equation holds, transcript well-formed) and the verdict reads **"PROOF ACCEPTED — AND THE
  PROVER HOLDS NO ROOT"**, with the claim text visible in that state. A second, scoped statement
  for Act A (asserted in the claims suite, not as the §4.1d claim): "Okamoto's protocol proves
  knowledge of *a* representation of u, not of the registered one" — the toy prover using the
  second witness passes every check.

## README and card follow-up

- What It Is: "Four of the six exhibits" (`README.md:5`) and "six exhibits" (`README.md:22`)
  become seven; describe Exhibit 07 as real BigInt arithmetic at 2048 bits plus a labelled toy
  group. Sweep every other count (`grep -n "six" README.md index.html exhibits/*.html`).
- Real-World Usage: add nothing about GQ deployments unless you verify a primary source for it;
  the brief deliberately names none.
- Related Demos: Schnorr Forge (nonce reuse = rewinding), Threshold Decrypt and Credential Veil
  (OR-proofs), RSA Forge.
- Handoff: candidate chips `Okamoto`, `GQ` (implemented). Concept-coverage: the zero-knowledge
  concept.

## Do not touch

`modpow`'s Number return and every existing exhibit's parameters, behaviour and tests; the cave
citation; theme, header, footer; port 4342; the deploy workflow.

## Sources

- Boneh, D., Shoup, V. *A Graduate Course in Applied Cryptography*, v0.6, Jan 2023, §19.5.1
  (Fig. 19.6, Thm 19.9), §19.5.5 (Fig. 19.10, Thm 19.13), §19.8 (Thm 19.21), §19.8.4 (Thm 19.23),
  Fact 10.3, Theorem 10.6 (Shamir's trick). https://toc.cryptobook.us/
- Okamoto, T. "Provably Secure and Practical Identification Schemes and Corresponding Signature
  Schemes." CRYPTO '92, LNCS 740, pp. 31–53. doi:10.1007/3-540-48071-4_3
- Guillou, L. C., Quisquater, J.-J. "A Practical Zero-Knowledge Protocol Fitted to Security
  Microprocessor Minimizing Both Transmission and Memory." EUROCRYPT '88, LNCS 330, pp. 123–128.
  doi:10.1007/3-540-45961-8_11
- Kivinen, T., Kojo, M. RFC 3526, "More Modular Exponential (MODP) Diffie-Hellman groups for
  Internet Key Exchange (IKE)", May 2003, §3 (2048-bit group, generator 2). The RFC text does not
  itself state that (p − 1)/2 is prime — the tests establish it.
  https://www.rfc-editor.org/rfc/rfc3526
