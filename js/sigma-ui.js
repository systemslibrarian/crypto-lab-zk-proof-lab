// @ts-check

import { modpowBig } from './shared.js';
import {
  TOY_OKAMOTO_PARAMS,
  dlogFromTwoReps,
  enumerateTranscripts,
  gqCheatAttempt,
  gqExtract,
  gqKeygen,
  gqProve,
  gqVerify,
  isPrimeOrderMember,
  okamotoExtract,
  okamotoParams,
  okamotoProve,
  okamotoVerify,
  randomBelow,
  randomUnit,
  transcriptMultisetsEqual,
} from './sigma.js';

/** @typedef {{ alpha: bigint, beta: bigint }} Witness */
/** @typedef {{ u: bigint, uT: bigint, c: bigint, zAlpha: bigint, zBeta: bigint }} OkTranscript */
/** @typedef {{ y: bigint, yT: bigint, c: bigint, xZ: bigint }} GqTranscript */
/**
 * @typedef {Object} OkamotoUiState
 * @property {Witness} witness
 * @property {Witness} nonce
 * @property {OkTranscript} first
 */
/**
 * @typedef {Object} GqUiState
 * @property {bigint} N
 * @property {bigint} e
 * @property {bigint} x
 * @property {bigint} nonce
 * @property {GqTranscript} first
 * @property {string} generationPath
 */

/** @param {string} id */
function element(id) {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found;
}

/** @param {string} id */
function button(id) {
  return /** @type {HTMLButtonElement} */ (element(id));
}

/** @param {string} id */
function select(id) {
  return /** @type {HTMLSelectElement} */ (element(id));
}

/** @param {string} id @param {string | number | bigint} value */
function setRaw(id, value) {
  const target = element(id);
  const full = String(value);
  target.textContent = full;
  target.dataset.value = full;
}

/** @param {string} id @param {bigint} value */
function setBig(id, value) {
  const target = element(id);
  const full = value.toString();
  target.dataset.value = full;
  target.textContent = full.length > 38 ? `${full.slice(0, 20)}…${full.slice(-14)}` : full;
  target.setAttribute('title', full);
  const copy = document.querySelector(`button[data-copy-target="${id}"]`);
  if (copy instanceof HTMLButtonElement) copy.disabled = false;
}

/** @param {string[]} ids */
function clearValues(ids) {
  for (const id of ids) {
    const target = element(id);
    target.textContent = '—';
    target.dataset.value = '';
    target.removeAttribute('title');
    const copy = document.querySelector(`button[data-copy-target="${id}"]`);
    if (copy instanceof HTMLButtonElement) copy.disabled = true;
  }
}

/**
 * @param {string} id
 * @param {'pending' | 'busy' | 'pass' | 'alarm' | 'fail'} state
 * @param {string} text
 */
function setVerdict(id, state, text) {
  const target = element(id);
  target.dataset.state = state;
  target.textContent = text;
}

function installCopyButtons() {
  document.querySelectorAll('.copy-value').forEach((node) => {
    const copyButton = /** @type {HTMLButtonElement} */ (node);
    copyButton.addEventListener('click', async () => {
      const targetId = copyButton.dataset.copyTarget;
      if (!targetId) return;
      const value = element(targetId).dataset.value;
      if (!value) return;
      const original = copyButton.textContent ?? 'Copy';
      try {
        await navigator.clipboard.writeText(value);
        copyButton.textContent = 'Copied';
      } catch {
        copyButton.textContent = 'Copy failed';
      }
      window.setTimeout(() => {
        copyButton.textContent = original;
      }, 1200);
    });
  });
}

let okParams = /** @type {(Awaited<ReturnType<typeof okamotoParams>>) | null} */ (null);
let okState = /** @type {OkamotoUiState | null} */ (null);

async function initializeOkamoto() {
  try {
    okParams = await okamotoParams();
    setBig('ok-p', okParams.p);
    setBig('ok-q', okParams.q);
    setBig('ok-h', okParams.h);
    setRaw('ok-g', okParams.g);
    element('ok-seed').textContent = okParams.seed;
    element('ok-bits').textContent = `p: ${okParams.p.toString(2).length} bits · q: ${okParams.q.toString(2).length} bits`;
    const gMember = isPrimeOrderMember(okParams.g, okParams.p, okParams.q) && okParams.g !== 1n;
    const hMember = isPrimeOrderMember(okParams.h, okParams.p, okParams.q) && okParams.h !== 1n;
    element('ok-param-status').textContent = gMember && hMember
      ? '✓ g and h are non-identity members of the order-q subgroup (z^q mod p = 1).'
      : '✗ Parameter membership check failed; proofs are disabled.';
    button('ok-run').disabled = !(gMember && hMember);
  } catch (error) {
    element('ok-param-status').textContent = `Could not derive the Okamoto parameters: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function clearOkamotoExtraction() {
  clearValues(['ok-c2', 'ok-za2', 'ok-zb2', 'ok-alpha-hat', 'ok-beta-hat', 'ok-reconstructed']);
  setVerdict('ok-extract-verdict', 'pending', 'A second challenge will expose the witness.');
  button('ok-rewind').disabled = true;
}

function runOkamoto() {
  if (!okParams) return;
  const witness = { alpha: randomBelow(okParams.q), beta: randomBelow(okParams.q) };
  const nonce = { alpha: randomBelow(okParams.q), beta: randomBelow(okParams.q) };
  const challenge = randomBelow(okParams.q);
  const first = okamotoProve(okParams, witness, nonce, challenge);
  const verified = okamotoVerify(okParams, first);
  okState = { witness, nonce, first };

  setBig('ok-u', first.u);
  setBig('ok-ut', first.uT);
  setBig('ok-c', first.c);
  setBig('ok-za', first.zAlpha);
  setBig('ok-zb', first.zBeta);
  setBig('ok-lhs', verified.lhs);
  setBig('ok-rhs', verified.rhs);
  setVerdict(
    'ok-verdict',
    verified.ok ? 'pass' : 'fail',
    verified.ok
      ? `✓ PROOF ACCEPTED — both ${verified.lhs.toString().length}-digit sides are equal.`
      : `✗ PROOF REJECTED — ${verified.reason}.`,
  );
  clearOkamotoExtraction();
  button('ok-rewind').disabled = !verified.ok;
}

function rewindOkamoto() {
  if (!okParams || !okState) return;
  const offset = randomBelow(okParams.q - 1n) + 1n;
  const secondChallenge = (okState.first.c + offset) % okParams.q;
  const second = okamotoProve(okParams, okState.witness, okState.nonce, secondChallenge);
  const secondCheck = okamotoVerify(okParams, second);
  try {
    const extracted = okamotoExtract(okParams, okState.first, second);
    const exact = extracted.alpha === okState.witness.alpha && extracted.beta === okState.witness.beta;
    setBig('ok-c2', second.c);
    setBig('ok-za2', second.zAlpha);
    setBig('ok-zb2', second.zBeta);
    setBig('ok-alpha-hat', extracted.alpha);
    setBig('ok-beta-hat', extracted.beta);
    setBig('ok-reconstructed', extracted.reconstructed);
    const succeeded = secondCheck.ok && extracted.ok && exact;
    setVerdict(
      'ok-extract-verdict',
      succeeded ? 'alarm' : 'fail',
      succeeded
        ? '⚠ WITNESS EXTRACTED — α̂ and β̂ equal the prover’s pair and reconstruct u. This is the protocol working as designed: special soundness.'
        : '✗ Extraction failed one of its computed checks.',
    );
  } catch (error) {
    setVerdict('ok-extract-verdict', 'fail', `✗ Extraction refused: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const toyRegistered = { alpha: 5n, beta: 7n };
const toySecond = { alpha: 9n, beta: 8n };

function initializeToy() {
  const first = okamotoProve(TOY_OKAMOTO_PARAMS, toyRegistered, { alpha: 3n, beta: 8n }, 11n);
  const second = okamotoProve(TOY_OKAMOTO_PARAMS, toySecond, { alpha: 3n, beta: 8n }, 11n);
  const secondCheck = okamotoVerify(TOY_OKAMOTO_PARAMS, second);
  const dlog = dlogFromTwoReps(toyRegistered, toySecond, TOY_OKAMOTO_PARAMS.q);
  setRaw('toy-u', first.u);
  setRaw('toy-dlog', dlog);
  setRaw('toy-dlog-check', modpowBig(TOY_OKAMOTO_PARAMS.g, dlog, TOY_OKAMOTO_PARAMS.p));
  setRaw('toy-second-lhs', secondCheck.lhs);
  setRaw('toy-second-rhs', secondCheck.rhs);
}

function retireToyEnumeration() {
  for (const id of ['toy-nonces-a', 'toy-challenges-a', 'toy-count-a', 'toy-nonces-b', 'toy-challenges-b', 'toy-count-b']) {
    element(id).textContent = '—';
  }
  setVerdict('toy-equality-verdict', 'pending', 'Verifier strategy changed; enumerate again so no stale equality remains.');
}

function enumerateToy() {
  const adaptive = /** @type {HTMLInputElement} */ (element('toy-adaptive')).checked;
  const strategy = adaptive ? 'adaptive' : 'random';
  setVerdict('toy-equality-verdict', 'busy', 'Enumerating the complete toy transcript support…');
  const registered = enumerateTranscripts(toyRegistered, strategy);
  const alternate = enumerateTranscripts(toySecond, strategy);
  const fixedRegistered = enumerateTranscripts(toyRegistered, 'fixed-nonce');
  const fixedAlternate = enumerateTranscripts(toySecond, 'fixed-nonce');
  const equal = transcriptMultisetsEqual(registered, alternate);
  const controlDiffers = !transcriptMultisetsEqual(fixedRegistered, fixedAlternate);
  const noncePairs = 23 * 23;
  const challenges = adaptive ? 1 : 23;
  for (const suffix of ['a', 'b']) {
    element(`toy-nonces-${suffix}`).textContent = String(noncePairs);
    element(`toy-challenges-${suffix}`).textContent = String(challenges);
  }
  element('toy-count-a').textContent = String(registered.length);
  element('toy-count-b').textContent = String(alternate.length);
  setVerdict(
    'toy-equality-verdict',
    equal && controlDiffers ? 'pass' : 'fail',
    equal && controlDiffers
      ? `✓ IDENTICAL MULTISETS — ${registered.length.toLocaleString()} transcripts per witness under the ${adaptive ? 'adaptive' : 'random'} verifier; the fixed-nonce control is unequal.`
      : '✗ Multiset comparison failed, or the fixed-nonce control did not detect inequality.',
  );
}

let selectedE = BigInt(select('gq-e').value);
let gqState = /** @type {GqUiState | null} */ (null);
let gqBusy = false;

const gqValueIds = [
  'gq-n', 'gq-y', 'gq-yt', 'gq-c', 'gq-xz', 'gq-lhs', 'gq-rhs',
  'gq-c2', 'gq-dc', 'gq-s', 'gq-t', 'gq-root', 'gq-root-check',
  'gq-cheat-yt', 'gq-cheat-xz', 'gq-cheat-lhs', 'gq-cheat-rhs',
];

function updateGqModeCopy() {
  const broken = selectedE === 3n;
  element('gq-broken-warning').hidden = !broken;
  button('gq-cheat').textContent = broken ? 'Run cheater until accepted' : 'Run the cheater 1,000×';
}

/** @param {string} reason */
function retireGq(reason) {
  gqState = null;
  clearValues(gqValueIds);
  for (const id of ['gq-cheat-attempts', 'gq-cheat-accepts', 'gq-cheat-guess', 'gq-cheat-c']) {
    element(id).textContent = '—';
  }
  element('gq-cheat-checks').textContent = 'Verifier equation: not run · group membership: not run.';
  element('gq-key-status').textContent = 'Waiting for WebCrypto key generation.';
  element('gq-retired').textContent = reason;
  setVerdict('gq-verdict', 'pending', 'Retired — run a fresh proof for the selected exponent.');
  setVerdict('gq-extract-verdict', 'pending', 'Retired — a fresh commitment needs its own rewind.');
  setVerdict('gq-cheat-verdict', 'pending', 'Retired — the cheater must target the current public statement.');
  button('gq-rewind').disabled = true;
  button('gq-cheat').disabled = true;
}

/** @param {boolean} busy */
function setGqBusy(busy) {
  gqBusy = busy;
  button('gq-run').disabled = busy;
  select('gq-e').disabled = busy;
  button('gq-rewind').disabled = busy || !gqState;
  button('gq-cheat').disabled = busy || !gqState;
}

async function runGq() {
  if (gqBusy) return;
  if (gqState) retireGq('The previous modulus and every verdict were retired before regeneration.');
  setGqBusy(true);
  element('gq-key-status').textContent = `WebCrypto is generating a 2048-bit RSA modulus for e = ${selectedE}…`;
  setVerdict('gq-verdict', 'busy', 'Generating N, then computing a real GQ transcript…');
  try {
    const generated = await gqKeygen(selectedE);
    const x = randomUnit(generated.N);
    const nonce = randomUnit(generated.N);
    const challenge = randomBelow(selectedE);
    const first = gqProve(generated, x, challenge, nonce);
    const verified = gqVerify(generated, first);
    gqState = { ...generated, x, nonce, first };
    setBig('gq-n', generated.N);
    setBig('gq-y', first.y);
    setBig('gq-yt', first.yT);
    setBig('gq-c', first.c);
    setBig('gq-xz', first.xZ);
    setBig('gq-lhs', verified.lhs);
    setBig('gq-rhs', verified.rhs);
    element('gq-key-status').textContent = `✓ ${generated.generationPath}. N is ${generated.N.toString(2).length} bits; only N was retained by the protocol.`;
    element('gq-retired').textContent = 'Fresh modulus active; no prior verdict remains in force.';
    setVerdict(
      'gq-verdict',
      verified.ok ? 'pass' : 'fail',
      verified.ok
        ? `✓ PROOF ACCEPTED — x_z^e and y_t·y^c are the same ${verified.lhs.toString().length}-digit residue.`
        : `✗ PROOF REJECTED — ${verified.reason}.`,
    );
    setVerdict('gq-extract-verdict', 'pending', 'A second challenge will expose the RSA root.');
    setVerdict('gq-cheat-verdict', 'pending', selectedE === 3n
      ? 'Ready: run until the public-data-only cheater is accepted.'
      : 'Ready: run 1,000 public-data-only cheating attempts.');
  } catch (error) {
    gqState = null;
    const message = error instanceof Error ? error.message : String(error);
    element('gq-key-status').textContent = `WebCrypto RSA key generation failed: ${message}. No toy modulus was substituted.`;
    setVerdict('gq-verdict', 'fail', '✗ No proof was run because real key generation failed.');
  } finally {
    setGqBusy(false);
  }
}

function rewindGq() {
  if (!gqState) return;
  const secondChallenge = (gqState.first.c + 1n) % gqState.e;
  const second = gqProve(gqState, gqState.x, secondChallenge, gqState.nonce);
  const secondVerified = gqVerify(gqState, second);
  try {
    const extracted = gqExtract(gqState, gqState.first, second);
    setBig('gq-c2', second.c);
    setRaw('gq-dc', extracted.deltaC);
    setRaw('gq-s', extracted.s);
    setRaw('gq-t', extracted.t);
    setBig('gq-root', extracted.root);
    setBig('gq-root-check', extracted.check);
    const exact = extracted.root === gqState.x;
    const succeeded = secondVerified.ok && extracted.ok && exact;
    setVerdict(
      'gq-extract-verdict',
      succeeded ? 'alarm' : 'fail',
      succeeded
        ? '⚠ RSA ROOT EXTRACTED — root^e = y and the root equals x. This is the protocol working as designed: special soundness.'
        : '✗ Shamir’s-trick extraction failed one of its computed checks.',
    );
  } catch (error) {
    setVerdict('gq-extract-verdict', 'fail', `✗ Extraction refused: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runGqCheater() {
  if (!gqState || gqBusy) return;
  setGqBusy(true);
  setVerdict('gq-cheat-verdict', 'busy', selectedE === 3n
    ? 'Trying fresh public-data-only commitments until the real verifier accepts…'
    : 'Running 1,000 public-data-only commitments through the real verifier…');
  // Let the busy state paint before the synchronous BigInt loop begins.
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  try {
    let attempts = 0;
    let acceptances = 0;
    /** @type {ReturnType<typeof gqCheatAttempt> | null} */
    let shown = null;
    const limit = selectedE === 3n ? 100000 : 1000;
    while (attempts < limit) {
      const attempt = gqCheatAttempt(gqState.first.y, gqState.e, gqState.N);
      attempts += 1;
      if (attempt.accepted) {
        acceptances += 1;
        shown = attempt;
        if (selectedE === 3n) break;
      } else if (!shown) {
        shown = attempt;
      }
    }
    if (selectedE === 3n && acceptances === 0) {
      throw new Error('no accepting challenge appeared within 100,000 attempts');
    }
    if (!shown) throw new Error('cheater produced no transcript');
    setRaw('gq-cheat-attempts', attempts);
    setRaw('gq-cheat-accepts', acceptances);
    setRaw('gq-cheat-guess', shown.guessedChallenge);
    setRaw('gq-cheat-c', shown.verifierChallenge);
    setBig('gq-cheat-yt', shown.transcript.yT);
    setBig('gq-cheat-xz', shown.transcript.xZ);
    setBig('gq-cheat-lhs', shown.verification.lhs);
    setBig('gq-cheat-rhs', shown.verification.rhs);
    element('gq-cheat-checks').textContent = shown.verification.ok
      ? 'Verifier equation: holds · group membership: all public values are well-formed in Z*_N.'
      : `Verifier equation: rejected · ${shown.verification.reason}.`;
    if (selectedE === 3n) {
      setVerdict('gq-cheat-verdict', 'alarm', '⚠ PROOF ACCEPTED — AND THE PROVER HOLDS NO ROOT');
    } else {
      setVerdict(
        'gq-cheat-verdict',
        acceptances > 0 ? 'alarm' : 'pass',
        `${acceptances} of 1,000 cheating attempts accepted; the measured expectation is about 1,000/65,537.`,
      );
    }
  } catch (error) {
    setVerdict('gq-cheat-verdict', 'fail', `✗ Cheater run failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    setGqBusy(false);
  }
}

button('ok-run').addEventListener('click', runOkamoto);
button('ok-rewind').addEventListener('click', rewindOkamoto);
button('toy-enumerate').addEventListener('click', enumerateToy);
element('toy-adaptive').addEventListener('change', retireToyEnumeration);
button('gq-run').addEventListener('click', runGq);
button('gq-rewind').addEventListener('click', rewindGq);
button('gq-cheat').addEventListener('click', runGqCheater);
select('gq-e').addEventListener('change', () => {
  const next = BigInt(select('gq-e').value);
  if (next === selectedE) return;
  selectedE = next;
  updateGqModeCopy();
  retireGq(`Exponent changed to ${selectedE}; the modulus and every prior GQ verdict were retired.`);
});

installCopyButtons();
initializeToy();
updateGqModeCopy();
void initializeOkamoto();
