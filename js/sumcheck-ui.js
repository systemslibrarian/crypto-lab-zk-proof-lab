// @ts-check
// Exhibit 08 page logic. Everything rendered here is read back out of the run the
// visitor triggered: the sum-check session's events, the replay result, the census
// tallies and the GKR transcript. Nothing is derived from a strategy label.

import { readSeedFromUrl } from './shared.js';
import { MAX_ENUMERABLE_MODULUS, createField, freshChallengeSource, seededChallengeSource } from './field.js';
import { evaluatePolynomial, formatPolynomial, formatUnivariate, hypercubeSum, parsePolynomial, partialSumUnivariate, univariateDegree, variableDegrees } from './polynomial.js';
import {
  MAX_CENSUS_TRANSCRIPTS,
  createSumcheckProver,
  createSumcheckSession,
  liePolynomialUnit,
  parseTranscript,
  replaySumcheckTranscript,
  serializeTranscript,
  soundnessBound,
  sumcheckCensus,
  univariateAgreement,
} from './sumcheck.js';
import { DEMO_CIRCUIT, createGkrProver, evaluateCircuit, gkrSoundnessBound, runGkr, wiringTriples } from './gkr.js';

/** @typedef {import('./field.js').PrimeField} PrimeField */
/** @typedef {import('./polynomial.js').Polynomial} Polynomial */
/** @typedef {import('./sumcheck.js').ProverStrategy} ProverStrategy */
/** @typedef {import('./sumcheck.js').RoundCheck} RoundCheck */
/** @typedef {import('./gkr.js').GkrProverStrategy} GkrProverStrategy */

/** @param {string} id */
function element(id) {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found;
}
/** @param {string} id */
const button = (id) => /** @type {HTMLButtonElement} */ (element(id));
/** @param {string} id */
const select = (id) => /** @type {HTMLSelectElement} */ (element(id));
/** @param {string} id */
const input = (id) => /** @type {HTMLInputElement} */ (element(id));
/** @param {string} id */
const textarea = (id) => /** @type {HTMLTextAreaElement} */ (element(id));

/** @param {string} id @param {string} text @param {string} [value] */
function setValue(id, text, value = text) {
  const target = element(id);
  target.textContent = text;
  target.dataset.value = value;
}

/** @param {string} id @param {'pending' | 'busy' | 'pass' | 'alarm' | 'fail'} state @param {string} text */
function setVerdict(id, state, text) {
  const target = element(id);
  target.dataset.state = state;
  target.textContent = text;
}

/** @param {string} message */
function showInputError(message) {
  const target = element('sc-input-error');
  target.textContent = message;
  target.hidden = false;
}
function clearInputError() {
  const target = element('sc-input-error');
  target.textContent = '';
  target.hidden = true;
}

/** The rounds table must always hold a data row, or axe cannot tell whether its headers describe anything. */
function placeholderRow() {
  const row = document.createElement('tr');
  row.className = 'sc-placeholder';
  const cell = document.createElement('td');
  cell.colSpan = 7;
  cell.textContent = 'No rounds yet — run or step the protocol.';
  row.appendChild(cell);
  return row;
}

/** @param {bigint[]} values */
const list = (values) => values.map(String).join(', ');
/** @param {bigint[]} values */
const dataList = (values) => values.map(String).join(',');
/** @param {number} degree */
const degreeText = (degree) => degree < 0 ? '−∞ (zero polynomial)' : String(degree);

// ---------------------------------------------------------------------------
// Statement: field, polynomial, randomness.
// ---------------------------------------------------------------------------

let field = createField(2147483647n);
/** @type {Polynomial} */
let polynomial = parsePolynomial(field, '2*x1^3 + x1*x3 + x2*x3');
/** @type {'fresh' | 'seeded'} */
let randomness = 'fresh';
let seed = 'lesson-1';

function challengeSource() {
  return randomness === 'seeded' ? seededChallengeSource(field, seed) : freshChallengeSource(field);
}

function renderStatement() {
  const degrees = variableDegrees(polynomial);
  const bound = soundnessBound(field, degrees);
  const sum = hypercubeSum(field, polynomial);
  setValue('sc-p', field.p.toString());
  setValue('sc-v', String(polynomial.variables));
  setValue('sc-degrees', degrees.join(', '), degrees.join(','));
  setValue('sc-points', String(1 << polynomial.variables));
  setValue('sc-sum', sum.toString());
  setValue(
    'sc-bound',
    `${bound.numerator} / ${bound.denominator} ≈ ${bound.value.toExponential(2)}${bound.vacuous ? ' (≥ 1: vacuous)' : ''}${randomness === 'seeded' ? ' · theorem not applicable to predictable seeded challenges' : ' · fresh independent uniform challenges, unpredictable until each message is fixed'}`,
    `${bound.numerator}/${bound.denominator}`,
  );
  element('sc-bound').dataset.assumptions = randomness;
  element('sc-randomness-label').textContent = `Randomness: ${challengeSource().label}.`;
  const census = field.p <= MAX_ENUMERABLE_MODULUS && field.p ** BigInt(polynomial.variables) <= BigInt(MAX_CENSUS_TRANSCRIPTS);
  button('sc-census').disabled = !census;
  element('sc-census-hint').textContent = census
    ? `p = ${field.p} and v = ${polynomial.variables}: ${field.p ** BigInt(polynomial.variables)} challenge vectors will be run through the real verifier.`
    : 'Select p = 13, 7 or 5 above to enable the census.';
  renderStrategyHint();
}

/** Parse the textarea; on failure keep the previous statement and announce the error. */
function applyPolynomial() {
  const text = textarea('sc-custom').value;
  try {
    const parsed = parsePolynomial(field, text);
    polynomial = parsed;
    clearInputError();
    const canonical = formatPolynomial(parsed);
    const preset = select('sc-preset');
    const matching = [...preset.options].find((option) => option.value === canonical);
    preset.value = matching ? matching.value : 'custom';
    retireSumcheck(`The statement changed to g = ${canonical} over F_${field.p}; the previous transcript was retired.`);
    renderStatement();
  } catch (error) {
    showInputError(`Polynomial not applied: ${error instanceof Error ? error.message : String(error)}. The previous statement stays in force.`);
  }
}

function applyField() {
  const chosen = BigInt(select('sc-field').value);
  /** @type {PrimeField} */
  let nextField;
  /** @type {Polynomial} */
  let nextPolynomial;
  try {
    nextField = createField(chosen);
    // Parse against the candidate field before committing either piece of
    // state. A previously refused textarea must not leave a new field paired
    // with the old polynomial and old rendered evidence.
    nextPolynomial = parsePolynomial(nextField, textarea('sc-custom').value);
    clearInputError();
  } catch (error) {
    select('sc-field').value = field.p.toString();
    showInputError(`Field not applied: ${error instanceof Error ? error.message : String(error)}. The previous field and statement stay in force.`);
    return;
  }
  field = nextField;
  polynomial = nextPolynomial;
  retireSumcheck(`The field changed to F_${field.p}; the previous transcript was retired.`);
  retireGkr(`The field changed to F_${field.p}; the previous walk was retired.`);
  renderStatement();
  evaluateGkrInputs();
}

function applyRandomness() {
  randomness = input('sc-random-seeded').checked ? 'seeded' : 'fresh';
  const text = input('sc-seed').value.trim();
  if (randomness === 'seeded' && text === '') {
    showInputError('A deterministic run needs a non-empty seed; fresh randomness stays in force.');
    randomness = 'fresh';
    input('sc-random-fresh').checked = true;
  } else {
    clearInputError();
    seed = text || seed;
  }
  retireSumcheck('The verifier randomness changed; the previous transcript was retired.');
  retireGkr('The verifier randomness changed; the previous walk was retired.');
  renderStatement();
  renderGkrBound();
}

// ---------------------------------------------------------------------------
// Act A: the sum-check session.
// ---------------------------------------------------------------------------

const STRATEGY_HINTS = {
  honest: 'The honest prover sends s_j exactly as the recurrence demands.',
  'wrong-sum-naive': 'The prover claims H + δ but sends the honest s_1, so s_1(0) + s_1(1) = H and round 1\'s recurrence fails at once.',
  'wrong-sum-carried': 'The prover claims H + δ and hides the debt in a polynomial with explicitly counted roots (up to the degree and field limit), so every recurrence holds and only the final evaluation — or a challenge landing on a root — decides.',
  'inconsistent-round': 'The prover is honest except at round j, where it adds δ to the constant term; that shifts s_j(0) + s_j(1) by 2δ, so the recurrence against s_{j−1}(r_{j−1}) fails.',
  'excessive-degree': 'At round j the prover adds X^d·X·(X − 1): the recurrence still holds, but the message has degree d + 2 and the degree check refuses it.',
  'lagrange-degree-attack': 'The prover claims H + δ and sends, for s_1, the full-field interpolant of degree at most p − 1 that agrees with the honest s_1 everywhere except at 0. It is a degree-bound attack only when its computed degree exceeds the public X1 bound. Tiny fields only.',
};

function renderStrategyHint() {
  const kind = select('sc-strategy').value;
  let hint = STRATEGY_HINTS[/** @type {keyof typeof STRATEGY_HINTS} */ (kind)] ?? '';
  const needsRound = kind === 'inconsistent-round' || kind === 'excessive-degree';
  const needsOffset = kind === 'wrong-sum-naive' || kind === 'wrong-sum-carried' || kind === 'inconsistent-round' || kind === 'lagrange-degree-attack';
  input('sc-strategy-round').disabled = !needsRound;
  input('sc-strategy-offset').disabled = !needsOffset;
  input('sc-strategy-round').max = String(polynomial.variables);
  const enumerable = field.p <= MAX_ENUMERABLE_MODULUS;
  const attackOption = [...select('sc-strategy').options].find((option) => option.value === 'lagrange-degree-attack');
  if (attackOption) attackOption.disabled = !enumerable;
  if (kind === 'lagrange-degree-attack') {
    if (!enumerable) {
      hint = `${hint} Select a tiny field to run it.`;
    } else {
      const firstBound = variableDegrees(polynomial)[0];
      hint += field.p - 1n > BigInt(firstBound)
        ? ` Here p − 1 = ${field.p - 1n} exceeds the X1 bound ${firstBound}, so the verifier refuses it on degree before drawing r1.`
        : ` Here p − 1 = ${field.p - 1n} is within the X1 bound ${firstBound}; this is not a degree-bound violation and can pass when r1 ≠ 0. Choose a lower-degree X1 polynomial to demonstrate the guard.`;
    }
  }
  element('sc-strategy-hint').textContent = hint;
}

/** @returns {ProverStrategy} */
function readStrategy() {
  const kind = select('sc-strategy').value;
  const roundText = input('sc-strategy-round').value.trim();
  const offsetText = input('sc-strategy-offset').value.trim();
  const round = Number(roundText);
  if (!/^\d+$/.test(offsetText)) throw new RangeError('the offset δ must be a non-negative integer');
  const offset = field.normalize(BigInt(offsetText));
  switch (kind) {
    case 'honest':
      return { kind: 'honest' };
    case 'wrong-sum-naive':
    case 'wrong-sum-carried':
    case 'lagrange-degree-attack':
      if (offset === 0n) throw new RangeError(`the offset δ reduces to 0 modulo ${field.p}; a lie needs a non-zero offset`);
      if (kind === 'lagrange-degree-attack' && field.p > MAX_ENUMERABLE_MODULUS) throw new RangeError('the full-field interpolant needs a tiny field');
      return { kind, offset };
    case 'inconsistent-round':
      if (!Number.isInteger(round) || round < 1 || round > polynomial.variables) throw new RangeError(`round j must lie in 1..${polynomial.variables}`);
      if (offset === 0n) throw new RangeError(`the offset δ reduces to 0 modulo ${field.p}; an inconsistent round needs a non-zero offset`);
      return { kind, round, offset };
    case 'excessive-degree':
      if (!Number.isInteger(round) || round < 1 || round > polynomial.variables) throw new RangeError(`round j must lie in 1..${polynomial.variables}`);
      return { kind, round };
    default:
      throw new RangeError('unknown prover strategy');
  }
}

/** @type {ReturnType<typeof createSumcheckSession> | null} */
let session = null;
/** @type {ReturnType<typeof createSumcheckProver> | null} */
let sessionProver = null;

/** @param {string} reason */
function retireSumcheck(reason) {
  session = null;
  sessionProver = null;
  element('sc-rounds-body').replaceChildren(placeholderRow());
  element('sc-claim-line').textContent = 'Claimed sum: —';
  const finalLine = element('sc-final-line');
  finalLine.textContent = 'Final evaluation: not reached.';
  delete finalLine.dataset.claimed;
  delete finalLine.dataset.evaluated;
  delete finalLine.dataset.point;
  setVerdict('sc-verdict', 'pending', 'Run the protocol to compute a verdict.');
  element('sc-omniscient').innerHTML = '<strong>Prover-side narration</strong> (the verifier never reads this): no run yet.';
  element('sc-narration').textContent = reason;
  textarea('sc-transcript-json').value = '';
  setVerdict('sc-replay-verdict', 'pending', 'No transcript replayed yet.');
  for (const row of ['honest', 'lie', 'attack']) {
    for (const column of ['accepted', 'degree', 'recurrence', 'final', 'total']) element(`census-${row}-${column}`).textContent = '—';
  }
  element('census-readout').innerHTML = '<strong>Readout:</strong> no census yet. The carried lie succeeds exactly when some r<sub>j</sub> lands on one of that round\'s explicitly constructed roots, so its accepted count is p<sup>v</sup> − Π<sub>j</sub>(p − roots<sub>j</sub>). The v·d / |F| theorem uses degree bounds, not an assumed root count. The interpolant agrees with the honest s<sub>1</sub> on p − 1 field points; it is refused on degree only when p − 1 exceeds the public X1 bound.';
  setVerdict('sc-census-verdict', 'pending', 'Run the census to compare the counts with the bound.');
}

function startSession() {
  const strategy = readStrategy();
  sessionProver = createSumcheckProver({ field, polynomial, strategy });
  session = createSumcheckSession({ field, polynomial, prover: sessionProver, challengeSource: challengeSource() });
  clearInputError();
}

/**
 * Append one row per accepted or refused message; challenges fill in afterwards.
 * @param {HTMLElement} body
 * @param {RoundCheck} check
 */
function appendRoundRow(body, check) {
  const row = document.createElement('tr');
  row.dataset.round = String(check.round);
  const cells = [
    { className: 'sc-round', text: String(check.round), data: { value: String(check.round) } },
    { className: 'sc-poly', text: check.failedCheck === 'shape' ? '(malformed message)' : formatUnivariate(check.polynomial, `X${check.round}`), data: { value: dataList(check.polynomial) } },
    { className: 'sc-degree', text: `${degreeText(check.degree)} ≤ ${check.bound}${check.degree > check.bound ? ' ✗' : ' ✓'}`, data: { degree: String(check.degree), bound: String(check.bound) } },
    { className: 'sc-sum01', text: check.sumAt01.toString(), data: { value: check.sumAt01.toString() } },
    { className: 'sc-expected', text: check.expected.toString(), data: { value: check.expected.toString() } },
    { className: 'sc-check', text: check.ok ? `✓ ${check.failedCheck === null ? 'degree and recurrence hold' : ''}`.trim() : `✗ ${check.failedCheck}: ${check.reason}`, data: { ok: String(check.ok), failed: check.failedCheck ?? '' } },
    { className: 'sc-challenge', text: check.ok ? 'pending (drawn after the check)' : 'never drawn: the message was refused', data: { value: '' } },
  ];
  for (const cell of cells) {
    const td = document.createElement('td');
    const code = document.createElement('code');
    code.className = cell.className;
    code.textContent = cell.text;
    for (const [key, value] of Object.entries(cell.data)) code.dataset[key] = value;
    td.appendChild(code);
    row.appendChild(td);
  }
  body.appendChild(row);
}

function renderSession() {
  if (!session || !sessionProver) return;
  const body = element('sc-rounds-body');
  body.replaceChildren();
  element('sc-claim-line').textContent = `Claimed sum: ${session.claimedSum}`;
  element('sc-claim-line').dataset.value = session.claimedSum.toString();
  let narration = `The prover announced the claim H = ${session.claimedSum}.`;
  for (const event of session.events) {
    if (event.kind === 'message') {
      appendRoundRow(body, event.check);
      narration = event.check.ok
        ? `Round ${event.check.round}: the verifier accepted s${event.check.round} (degree ${degreeText(event.check.degree)} ≤ ${event.check.bound}, s${event.check.round}(0) + s${event.check.round}(1) = ${event.check.expected}) and may now draw r${event.check.round}.`
        : `Round ${event.check.round}: the verifier refused the message — ${event.check.reason}.`;
    } else if (event.kind === 'challenge') {
      const cell = body.querySelector(`tr[data-round="${event.round}"] .sc-challenge`);
      if (cell instanceof HTMLElement) {
        cell.textContent = event.value.toString();
        cell.dataset.value = event.value.toString();
      }
      narration = `Round ${event.round}: with s${event.round} fixed, the verifier drew r${event.round} = ${event.value}; the next message must satisfy s${event.round + 1}(0) + s${event.round + 1}(1) = s${event.round}(r${event.round}) = ${session.verifier.expected}.`;
    } else if (event.kind === 'final') {
      const finalLine = element('sc-final-line');
      finalLine.textContent = `Final evaluation at r = (${list(event.check.point)}): s${polynomial.variables}(r${polynomial.variables}) = ${event.check.claimed} · g(r) = ${event.check.evaluated}.`;
      finalLine.dataset.claimed = event.check.claimed.toString();
      finalLine.dataset.evaluated = event.check.evaluated.toString();
      finalLine.dataset.point = dataList(event.check.point);
      narration = event.check.ok
        ? 'The verifier evaluated g once at the full challenge point and it matched the last message.'
        : 'The verifier evaluated g once at the full challenge point and it did not match the last message.';
    }
  }
  if (body.children.length === 0) body.appendChild(placeholderRow());
  element('sc-narration').textContent = narration;
  renderOmniscient();
  if (session.done) {
    const verdict = session.verdict();
    const lying = session.claimedSum !== sessionProver.trueSum;
    if (verdict.accepted) {
      setVerdict('sc-verdict', lying ? 'alarm' : 'pass', lying
        ? `⚠ ACCEPTED — ${verdict.reason}; but the claim ${session.claimedSum} is false (the true sum is ${sessionProver.trueSum}). The challenge landed on a root of the lie${randomness === 'seeded' ? '; seeded mode is predictable, so this is not a theorem-backed probability experiment' : '; this is an event counted by the v·d/|F| soundness bound'}.`
        : `✓ ACCEPTED — ${verdict.reason}.`);
    } else {
      setVerdict('sc-verdict', 'fail', `✗ REJECTED — ${verdict.reason}.`);
    }
    textarea('sc-transcript-json').value = serializeTranscript(session.verifier.transcript());
    setVerdict('sc-replay-verdict', 'pending', 'Transcript recorded. Replay it, or damage it first.');
  } else {
    setVerdict('sc-verdict', 'busy', `In progress: ${session.events.length - 1} of ${2 * polynomial.variables + 1} steps taken. Press Next step or Run.`);
  }
}

function renderOmniscient() {
  if (!session || !sessionProver) return;
  const strategy = sessionProver.strategy;
  const parts = [`<strong>Prover-side narration</strong> (the verifier never reads this): strategy <code>${strategy.kind}</code>; true sum H = ${sessionProver.trueSum}; claimed ${session.claimedSum}.`];
  if (strategy.kind === 'wrong-sum-carried') {
    for (const correction of sessionProver.corrections()) {
      parts.push(correction.debt === 0n
        ? `Round ${correction.round}: the debt reached 0 — an earlier challenge hit a root — so the prover continued honestly.`
        : `Round ${correction.round}: owed ${correction.debt}; hid it in a polynomial with root${correction.roots.length === 1 ? '' : 's'} {${list(correction.roots)}} (a challenge there would zero the debt).`);
    }
  } else if (strategy.kind === 'lagrange-degree-attack') {
    const honest = partialSumUnivariate(field, polynomial, [], 1);
    const attack = sessionProver.message(1, []);
    parts.push(`The interpolant has degree ${degreeText(univariateDegree(attack))} and agrees with the honest s1 on ${univariateAgreement(field, attack, honest)} of ${field.p} field points.`);
  } else if (strategy.kind === 'inconsistent-round' || strategy.kind === 'excessive-degree') {
    parts.push(`The prover's claim is true; the defect is in round ${strategy.round}'s message.`);
  }
  element('sc-omniscient').innerHTML = parts.join(' ');
}

function runProtocol() {
  try {
    if (!session || session.done) startSession();
    /** @type {NonNullable<typeof session>} */ (session).run();
    renderSession();
  } catch (error) {
    showInputError(`Run refused: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function stepProtocol() {
  try {
    if (!session) {
      startSession();
      renderSession();
      return;
    }
    if (session.done) {
      element('sc-narration').textContent = 'This run is finished. Reset the transcript or press Run to start another.';
      return;
    }
    session.step();
    renderSession();
  } catch (error) {
    showInputError(`Step refused: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ---------------------------------------------------------------------------
// Replay and transcript mutations.
// ---------------------------------------------------------------------------

function replayTranscript() {
  const json = textarea('sc-transcript-json').value;
  if (json.trim() === '') {
    setVerdict('sc-replay-verdict', 'pending', 'Run the protocol first so there is a transcript to replay.');
    return;
  }
  /** @type {unknown} */
  let parsed;
  try {
    parsed = parseTranscript(json);
  } catch (error) {
    setVerdict('sc-replay-verdict', 'fail', `✗ REPLAY REFUSED — malformed transcript: invalid JSON (${error instanceof Error ? error.message : String(error)}).`);
    return;
  }
  const result = replaySumcheckTranscript({
    field,
    transcript: parsed,
    oracle: (point) => evaluatePolynomial(field, polynomial, point),
    expectedDegreeBounds: variableDegrees(polynomial),
  });
  setVerdict('sc-replay-verdict', result.ok ? 'pass' : 'fail', result.ok
    ? `✓ REPLAY ACCEPTED — ${result.checks.length} rounds re-checked; ${result.reason}.`
    : `✗ REPLAY REFUSED — ${result.reason}.`);
}

/** @param {(transcript: any) => string | null} mutate returns a note, or null when the transcript cannot be mutated */
function mutateTranscript(mutate) {
  const json = textarea('sc-transcript-json').value;
  if (json.trim() === '') {
    setVerdict('sc-replay-verdict', 'pending', 'Run the protocol first so there is a transcript to damage.');
    return;
  }
  /** @type {any} */
  let record;
  try {
    record = JSON.parse(json);
  } catch {
    setVerdict('sc-replay-verdict', 'fail', '✗ The transcript box no longer holds valid JSON; reset or run again.');
    return;
  }
  const note = mutate(record);
  if (note === null) {
    setVerdict('sc-replay-verdict', 'pending', 'That mutation does not apply to this transcript.');
    return;
  }
  textarea('sc-transcript-json').value = JSON.stringify(record, null, 2);
  replayTranscript();
  const verdict = element('sc-replay-verdict');
  verdict.textContent = `${note} ${verdict.textContent}`;
}

const MUTATIONS = {
  'sc-mutate-truncate': (/** @type {any} */ record) => {
    if (!Array.isArray(record.rounds) || record.rounds.length === 0) return null;
    record.rounds.pop();
    return 'Dropped the last round.';
  },
  'sc-mutate-swap': (/** @type {any} */ record) => {
    if (!Array.isArray(record.rounds) || record.rounds.length < 2) return null;
    [record.rounds[0], record.rounds[1]] = [record.rounds[1], record.rounds[0]];
    return 'Swapped rounds 1 and 2.';
  },
  'sc-mutate-coefficient': (/** @type {any} */ record) => {
    const first = record.rounds?.[0];
    if (!first || !Array.isArray(first.polynomial) || first.polynomial.length < 2) return null;
    // Add 2X − 1: zero on {0,1} as a sum, so round 1's own recurrence still holds and
    // only the next round, which expects s1(r1), can notice the edit.
    first.polynomial[0] = field.sub(BigInt(first.polynomial[0]), 1n).toString();
    first.polynomial[1] = field.add(BigInt(first.polynomial[1]), 2n).toString();
    return 'Changed s1 after r1 had been drawn, keeping s1(0) + s1(1).';
  },
  'sc-mutate-noncanonical': (/** @type {any} */ record) => {
    const first = record.rounds?.[0];
    if (!first || !Array.isArray(first.polynomial) || first.polynomial.length === 0) return null;
    first.polynomial[0] = field.p.toString();
    return `Set a coefficient of s1 to p = ${field.p}.`;
  },
  'sc-mutate-challenge-first': (/** @type {any} */ record) => {
    const first = record.rounds?.[0];
    if (!first) return null;
    record.rounds[0] = { round: 1, polynomial: [], challenge: first.challenge };
    return 'Removed round 1\'s message while retaining its challenge.';
  },
  'sc-mutate-bounds': (/** @type {any} */ record) => {
    if (!Array.isArray(record.degreeBounds)) return null;
    record.degreeBounds = record.degreeBounds.map((/** @type {number} */ bound) => bound + 2);
    return 'Loosened every degree bound by 2.';
  },
};

// ---------------------------------------------------------------------------
// Tiny-field census.
// ---------------------------------------------------------------------------

/** @param {string} prefix @param {ReturnType<typeof sumcheckCensus>} result */
function fillCensusRow(prefix, result) {
  element(`census-${prefix}-accepted`).textContent = String(result.accepted);
  element(`census-${prefix}-degree`).textContent = String(result.degree);
  element(`census-${prefix}-recurrence`).textContent = String(result.recurrence);
  element(`census-${prefix}-final`).textContent = String(result.final);
  element(`census-${prefix}-total`).textContent = String(result.total);
}

async function runCensus() {
  const degrees = variableDegrees(polynomial);
  setVerdict('sc-census-verdict', 'busy', 'Running every challenge vector through the real verifier three times…');
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  try {
    const offset = 1n;
    const honest = sumcheckCensus({ field, polynomial, makeProver: () => createSumcheckProver({ field, polynomial }) });
    const lie = sumcheckCensus({ field, polynomial, makeProver: () => createSumcheckProver({ field, polynomial, strategy: { kind: 'wrong-sum-carried', offset } }) });
    const attack = sumcheckCensus({ field, polynomial, makeProver: () => createSumcheckProver({ field, polynomial, strategy: { kind: 'lagrange-degree-attack', offset } }) });
    fillCensusRow('honest', honest);
    fillCensusRow('lie', lie);
    fillCensusRow('attack', attack);
    const total = BigInt(honest.total);
    const rootCounts = degrees.map((degree) => liePolynomialUnit(field, degree).roots.length);
    const expectedLie = total - rootCounts.reduce((product, roots) => product * (field.p - BigInt(roots)), 1n);
    const bound = soundnessBound(field, degrees);
    const boundCount = bound.vacuous ? total : (bound.numerator * total) / field.p;
    const interpolant = createSumcheckProver({ field, polynomial, strategy: { kind: 'lagrange-degree-attack', offset } }).message(1, []);
    const interpolantDegree = univariateDegree(interpolant);
    const attackAboveBound = interpolantDegree > degrees[0];
    const expectedAttackAccepted = attackAboveBound ? 0n : (field.p - 1n) * (field.p ** BigInt(polynomial.variables - 1));
    const agreement = univariateAgreement(field, interpolant, partialSumUnivariate(field, polynomial, [], 1));
    const attackReadout = attackAboveBound
      ? `Interpolant: degree ${interpolantDegree}, agrees with the honest s<sub>1</sub> on ${agreement} of ${field.p} points, rejected on the degree bound ${attack.degree} of ${attack.total} times.`
      : `Interpolant: degree ${interpolantDegree} is within the public X<sub>1</sub> bound ${degrees[0]}, so this is not a degree-bound violation for this statement. It agrees on ${agreement} of ${field.p} points and accepted ${attack.accepted} of ${attack.total} transcripts (expected ${expectedAttackAccepted}); choose deg<sub>1</sub>(g) &lt; p − 1 to test the degree guard.`;
    element('census-readout').innerHTML = [
      '<strong>Readout:</strong>',
      `honest accepted ${honest.accepted} of ${honest.total}.`,
      `Carried lie accepted ${lie.accepted}; its constructed root counts are [${rootCounts.join(', ')}], so the closed form p<sup>v</sup> − Π<sub>j</sub>(p − roots<sub>j</sub>) = ${field.p}<sup>${polynomial.variables}</sup> − ${rootCounts.map((roots) => `(${field.p} − ${roots})`).join('·')} = ${expectedLie}. The degree-based bound v·d / |F| = ${bound.numerator}/${bound.denominator} allows at most ${bound.vacuous ? `${total} (vacuous: the bound is ≥ 1)` : `${boundCount}`} of ${total}.`,
      attackReadout,
    ].join(' ');
    const consistent = honest.accepted === honest.total
      && BigInt(lie.accepted) === expectedLie
      && BigInt(lie.accepted) <= boundCount
      && lie.degree === 0 && lie.recurrence === 0
      && (attackAboveBound
        ? attack.accepted === 0 && attack.degree === attack.total
        : BigInt(attack.accepted) === expectedAttackAccepted && attack.degree === 0);
    const attackVerdict = attackAboveBound
      ? `interpolant 0 accepted, ${attack.degree} refused on degree`
      : `interpolant ${attack.accepted} accepted (= ${expectedAttackAccepted}); not a degree violation at bound ${degrees[0]}`;
    setVerdict('sc-census-verdict', consistent ? 'pass' : 'fail', consistent
      ? `✓ CENSUS COMPLETE — ${honest.total} vectors each: honest ${honest.accepted} accepted; carried lie ${lie.accepted} accepted (= ${expectedLie}, within the bound's ${bound.vacuous ? 'vacuous ' : ''}${boundCount}); ${attackVerdict}.`
      : `✗ CENSUS DISAGREES — honest ${honest.accepted}/${honest.total}, lie ${lie.accepted} vs root-count formula ${expectedLie} and bound ${boundCount}, interpolant ${attack.accepted} vs expected ${expectedAttackAccepted}.`);
  } catch (error) {
    setVerdict('sc-census-verdict', 'fail', `✗ Census failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ---------------------------------------------------------------------------
// Act B: the GKR walk.
// ---------------------------------------------------------------------------

/** @type {bigint[]} */
let gkrInputs = [3n, 2n, 3n, 1n];

const GKR_HINTS = {
  honest: 'The honest prover evaluates the circuit, sends its outputs, and answers every sum-check from the true tables.',
  'wrong-output': 'The prover reports y0 + 1. The false output compression survives only if r0 hits the difference polynomial’s root (r0 = 1 here); otherwise the first layer-0 recurrence fails. That endpoint is the 1/|F| output-compression error event.',
  'corrupt-gate': 'The prover adds 1 to gate (0,1) of layer 1 and recomputes the outputs from that table. Layer 0 is self-consistent with the lie. At layer 1 the public inputs usually expose it in the first recurrence, but a sampled root event can hide the changed gate and accept; the displayed verdict comes from this run.',
  'corrupt-wiring': 'The prover\'s private circuit copy rewires gate (0,1) of layer 1. Its messages are consistent with that private wiring, while the verifier evaluates the public wiring at the sampled point. Those values usually disagree, but a root event can make them equal and accept; the displayed verdict comes from this run.',
  'invalid-line-degree': 'At layer 0 the prover sends q(t) of degree 3; W̃1 on a line has degree at most 2, so the degree check refuses it.',
  'invalid-line-value': 'At layer 0 the prover sends q + t(t − 1): q(0) and q(1) are right. If r* is 0 or 1 the edit vanishes and this reduction accepts; at any other r* the wrong carried claim makes layer 1’s first recurrence fail.',
  'invalid-line-last': 'At layer 1 the prover sends q + t(t − 1). If r* is 0 or 1 the edit vanishes and the terminal check accepts; at any other r* the verifier’s own evaluation of W̃2 catches the wrong carried claim.',
};

/** @returns {GkrProverStrategy} */
function readGkrStrategy() {
  switch (select('gkr-strategy').value) {
    case 'honest': return { kind: 'honest' };
    case 'wrong-output': return { kind: 'wrong-output', gate: 0, offset: 1n };
    case 'corrupt-gate': return { kind: 'corrupt-gate', layer: 1, gate: 1, offset: 1n };
    case 'corrupt-wiring': return { kind: 'corrupt-wiring', layer: 1, gate: 1, in1: 1, in2: 3 };
    case 'invalid-line-degree': return { kind: 'invalid-line', layer: 0, mode: 'degree' };
    case 'invalid-line-value': return { kind: 'invalid-line', layer: 0, mode: 'value', offset: 1n };
    case 'invalid-line-last': return { kind: 'invalid-line', layer: 1, mode: 'value', offset: 1n };
    default: throw new RangeError('unknown GKR prover strategy');
  }
}

function renderGkrStrategyHint() {
  const kind = /** @type {keyof typeof GKR_HINTS} */ (select('gkr-strategy').value);
  element('gkr-strategy-hint').textContent = GKR_HINTS[kind] ?? '';
}

function evaluateGkrInputs() {
  const raw = [0, 1, 2, 3].map((index) => input(`gkr-x${index}`).value.trim());
  if (!raw.every((text) => /^\d+$/.test(text))) {
    showInputError('Circuit inputs must be non-negative integers; the previous inputs stay in force.');
    return;
  }
  clearInputError();
  gkrInputs = raw.map((text) => field.normalize(BigInt(text)));
  const values = evaluateCircuit(field, DEMO_CIRCUIT, gkrInputs);
  setValue('gkr-val-2', list(values[2]), dataList(values[2]));
  values[1].forEach((value, index) => setValue(`gkr-val-1-${index}`, value.toString()));
  values[0].forEach((value, index) => setValue(`gkr-val-0-${index}`, value.toString()));
  const describe = (/** @type {number} */ layer, /** @type {'add' | 'mult'} */ op) =>
    `${op}_${layer} = {${wiringTriples(DEMO_CIRCUIT, layer, op).map(([a, b, c]) => `(${a},${b},${c})`).join(', ')}}`;
  element('gkr-wiring').textContent = [describe(0, 'add'), describe(0, 'mult'), describe(1, 'add'), describe(1, 'mult')].join(' · ');
  renderGkrBound();
  retireGkr('The circuit inputs were evaluated; run the walk to prove them.');
}

function renderGkrBound() {
  const bound = gkrSoundnessBound(field, DEMO_CIRCUIT);
  const boundLine = element('gkr-bound');
  const notes = [];
  if (bound.vacuous) notes.push('The raw union sum is at least 1, so the probability bound is only ≤ 1 and is vacuous.');
  if (randomness === 'seeded') {
    notes.push('The deterministic teaching seed is predictable, so this theorem-based probability guarantee does not apply in seeded mode.');
  } else if (!bound.vacuous) {
    notes.push(`With fresh independent uniform challenges that remain unpredictable until each owning prover message is fixed, the soundness error is at most ${bound.numerator}/${bound.denominator}.`);
  }
  boundLine.textContent = `Raw union sum for this walk: ${bound.terms.map((term) => `${term.numerator} (${term.label})`).join(' + ')} = ${bound.numerator} / ${bound.denominator} ≈ ${bound.rawValue.toExponential(2)}. ${notes.join(' ')}`;
  boundLine.dataset.value = `${bound.numerator}/${bound.denominator}`;
  boundLine.dataset.probabilityBound = bound.vacuous ? '1' : `${bound.numerator}/${bound.denominator}`;
  boundLine.dataset.assumptions = randomness;
}

/** @param {string} reason */
function retireGkr(reason) {
  element('gkr-trace').replaceChildren();
  element('gkr-narration').textContent = reason;
  setVerdict('gkr-verdict', 'pending', 'Run the walk to compute a verdict.');
}

/**
 * @param {string} title
 * @param {Array<[string, string, string | undefined]>} rows label, text, data-value
 */
function traceBlock(title, rows) {
  const block = document.createElement('div');
  block.className = 'vl';
  const heading = document.createElement('strong');
  heading.textContent = title;
  block.appendChild(heading);
  const dl = document.createElement('dl');
  dl.className = 'gkr-facts';
  for (const [label, text, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    const code = document.createElement('code');
    code.textContent = text;
    if (value !== undefined) code.dataset.value = value;
    dd.appendChild(code);
    dl.appendChild(dt);
    dl.appendChild(dd);
  }
  block.appendChild(dl);
  return block;
}

/** @param {HTMLElement} container @param {number} layer @param {RoundCheck[]} checks @param {Array<{ round: number, challenge: bigint | null }>} rounds */
function appendLayerRounds(container, layer, checks, rounds) {
  const wrap = document.createElement('div');
  wrap.className = 'table-scroll';
  wrap.tabIndex = 0;
  const table = document.createElement('table');
  table.className = 'commit-table';
  table.setAttribute('aria-label', `Layer ${layer} sum-check transcript`);
  table.innerHTML = '<thead><tr><th>Round</th><th>Prover sends s<sub>j</sub></th><th>Degree ≤ bound</th><th>s<sub>j</sub>(0)+s<sub>j</sub>(1)</th><th>Expected</th><th>Verifier check</th><th>Challenge</th></tr></thead>';
  const body = document.createElement('tbody');
  body.id = `gkr-layer-${layer}-rounds-body`;
  for (const check of checks) {
    appendRoundRow(body, check);
    const entry = rounds.find((round) => round.round === check.round);
    if (entry && entry.challenge !== null) {
      const cell = body.querySelector(`tr[data-round="${check.round}"] .sc-challenge`);
      if (cell instanceof HTMLElement) {
        cell.textContent = entry.challenge.toString();
        cell.dataset.value = entry.challenge.toString();
      }
    }
  }
  table.appendChild(body);
  wrap.appendChild(table);
  container.appendChild(wrap);
}

function runGkrWalk() {
  let strategy;
  try {
    strategy = readGkrStrategy();
  } catch (error) {
    showInputError(error instanceof Error ? error.message : String(error));
    return;
  }
  clearInputError();
  const prover = createGkrProver({ field, circuit: DEMO_CIRCUIT, inputs: gkrInputs, strategy });
  const run = runGkr({ field, circuit: DEMO_CIRCUIT, inputs: gkrInputs, prover, challengeSource: challengeSource() });
  const trace = element('gkr-trace');
  trace.replaceChildren();
  const { transcript } = run;
  if (transcript.outputs) {
    const block = traceBlock('Output claim', [
      ['prover claims D = W0', `[${list(transcript.outputs.claimed)}]`, dataList(transcript.outputs.claimed)],
      ['verifier draws r0', `[${list(transcript.outputs.r0)}]`, dataList(transcript.outputs.r0)],
      ['m0 = D̃(r0), computed by the verifier', transcript.outputs.m0.toString(), transcript.outputs.m0.toString()],
    ]);
    block.id = 'gkr-outputs';
    trace.appendChild(block);
  }
  for (const record of transcript.layers) {
    const section = document.createElement('div');
    section.id = `gkr-layer-${record.layer}`;
    section.className = 'gkr-layer';
    const header = document.createElement('h3');
    header.textContent = `Layer ${record.layer} → ${record.layer + 1}: claim W̃${record.layer}(${list(record.point)}) = ${record.claim}`;
    header.dataset.point = dataList(record.point);
    header.dataset.claim = record.claim.toString();
    section.appendChild(header);
    const lead = document.createElement('p');
    lead.className = 'hint';
    lead.textContent = `Sum-check over (b, c) ∈ {0,1}^${record.degreeBounds.length} with degree bound ${record.degreeBounds[0]} in every variable; the claimed sum is m${record.layer} = ${record.claim}.`;
    section.appendChild(lead);
    appendLayerRounds(section, record.layer, record.checks, record.sumcheck.rounds);
    if (record.line) {
      const line = record.line;
      const rows = /** @type {Array<[string, string, string | undefined]>} */ ([
        ['b*', `[${list(line.bStar)}]`, dataList(line.bStar)],
        ['c*', `[${list(line.cStar)}]`, dataList(line.cStar)],
        ['prover sends q(t) = W̃ on ℓ(t) = b* + t·(c* − b*)', formatUnivariate(line.polynomial, 't'), dataList(line.polynomial)],
        ['degree ≤ bound', `${degreeText(line.degree)} ≤ ${line.bound}${line.degree > line.bound ? ' ✗' : ' ✓'}`, `${line.degree}/${line.bound}`],
      ]);
      if (record.final) {
        rows.push(
          ['q(0), q(1) stand in for W̃(b*), W̃(c*)', `${line.q0}, ${line.q1}`, `${line.q0},${line.q1}`],
          ['verifier\'s own add̃(z, b*, c*)', line.addTilde.toString(), line.addTilde.toString()],
          ['verifier\'s own mult̃(z, b*, c*)', line.multTilde.toString(), line.multTilde.toString()],
          ['add̃·(q0 + q1) + mult̃·q0·q1', line.oracleValue.toString(), line.oracleValue.toString()],
          ['last message at its challenge', record.final.claimed.toString(), record.final.claimed.toString()],
          ['final sum-check check', record.final.ok ? '✓ equal' : `✗ ${record.final.reason}`, String(record.final.ok)],
        );
      }
      if (record.rStar !== null && record.nextPoint && record.nextClaim !== null) {
        rows.push(
          ['verifier draws r*', record.rStar.toString(), record.rStar.toString()],
          [`next point z${record.layer + 1} = ℓ(r*)`, `[${list(record.nextPoint)}]`, dataList(record.nextPoint)],
          [`next claim m${record.layer + 1} = q(r*)`, record.nextClaim.toString(), record.nextClaim.toString()],
        );
      }
      const block = traceBlock('Line reduction', rows);
      block.id = `gkr-layer-${record.layer}-line`;
      section.appendChild(block);
    }
    const status = document.createElement('p');
    status.className = 'hint';
    status.id = `gkr-layer-${record.layer}-status`;
    status.dataset.ok = String(record.ok);
    status.textContent = record.ok ? `✓ ${record.reason}` : `✗ ${record.reason}`;
    section.appendChild(status);
    trace.appendChild(section);
  }
  if (transcript.terminal) {
    const block = traceBlock('Terminal check by the verifier alone', [
      ['point z2', `[${list(transcript.terminal.point)}]`, dataList(transcript.terminal.point)],
      ['carried claim m2', transcript.terminal.claim.toString(), transcript.terminal.claim.toString()],
      ['W̃2(z2) from the public inputs', transcript.terminal.evaluated.toString(), transcript.terminal.evaluated.toString()],
      ['verdict', transcript.terminal.ok ? '✓ equal' : '✗ different', String(transcript.terminal.ok)],
    ]);
    block.id = 'gkr-terminal';
    trace.appendChild(block);
  }
  const honestOutputs = evaluateCircuit(field, DEMO_CIRCUIT, gkrInputs)[0];
  const claimedOutputs = transcript.outputs ? transcript.outputs.claimed : [];
  const outputsTrue = claimedOutputs.length === honestOutputs.length && claimedOutputs.every((value, index) => value === honestOutputs[index]);
  if (run.accepted) {
    setVerdict('gkr-verdict', outputsTrue ? 'pass' : 'alarm', outputsTrue
      ? `✓ ACCEPTED — ${run.reason}.`
      : `⚠ ACCEPTED — ${run.reason}; but the claimed outputs [${list(claimedOutputs)}] differ from the direct evaluation [${list(honestOutputs)}]. The challenges hit a root event represented in the raw ${run.bound.numerator}/${run.bound.denominator} union calculation${randomness === 'seeded' ? '; seeded mode is predictable, so this is not a theorem-backed probability experiment' : ''}.`);
    element('gkr-narration').textContent = `The walk reduced the output claim through ${transcript.layers.length} layers to a single evaluation of W̃2 that the verifier made from the public inputs.`;
  } else {
    const where = run.failedAt ? `${run.failedAt.stage}${run.failedAt.round ? ` (round ${run.failedAt.round})` : ''} at layer ${run.failedAt.layer}` : 'an unknown stage';
    setVerdict('gkr-verdict', 'fail', `✗ REJECTED at ${where} — ${run.reason}.`);
    element('gkr-narration').textContent = `The verifier stopped at ${where}. On this sampled transcript, a recurrence, degree, wiring, or public-input check exposed the difference. Root events that accept a false claim are counted by the soundness analysis.`;
  }
}

// ---------------------------------------------------------------------------
// Wiring.
// ---------------------------------------------------------------------------

select('sc-field').addEventListener('change', applyField);
select('sc-preset').addEventListener('change', () => {
  const value = select('sc-preset').value;
  if (value !== 'custom') textarea('sc-custom').value = value;
  applyPolynomial();
});
button('sc-parse').addEventListener('click', applyPolynomial);
textarea('sc-custom').addEventListener('change', applyPolynomial);
input('sc-random-fresh').addEventListener('change', applyRandomness);
input('sc-random-seeded').addEventListener('change', applyRandomness);
input('sc-seed').addEventListener('change', () => {
  if (input('sc-random-seeded').checked) applyRandomness();
});
select('sc-strategy').addEventListener('change', () => {
  renderStrategyHint();
  retireSumcheck('The prover strategy changed; the previous transcript was retired.');
});
for (const id of ['sc-strategy-round', 'sc-strategy-offset']) {
  input(id).addEventListener('change', () => retireSumcheck('The prover strategy parameters changed; the previous transcript was retired.'));
}
button('sc-run').addEventListener('click', runProtocol);
button('sc-step').addEventListener('click', stepProtocol);
button('sc-reset').addEventListener('click', () => retireSumcheck('Transcript reset. The prover will announce a fresh claim on the next run.'));
button('sc-replay').addEventListener('click', replayTranscript);
for (const [id, mutate] of Object.entries(MUTATIONS)) {
  button(id).addEventListener('click', () => mutateTranscript(mutate));
}
button('sc-census').addEventListener('click', () => { void runCensus(); });

button('gkr-evaluate').addEventListener('click', evaluateGkrInputs);
for (const index of [0, 1, 2, 3]) {
  input(`gkr-x${index}`).addEventListener('change', evaluateGkrInputs);
}
select('gkr-strategy').addEventListener('change', () => {
  renderGkrStrategyHint();
  retireGkr('The prover strategy changed; the previous walk was retired.');
});
button('gkr-run').addEventListener('click', runGkrWalk);

const urlSeed = readSeedFromUrl();
if (urlSeed) {
  input('sc-seed').value = urlSeed;
  input('sc-random-seeded').checked = true;
  randomness = 'seeded';
  seed = urlSeed;
}
renderStatement();
renderGkrStrategyHint();
evaluateGkrInputs();
retireSumcheck('No protocol run yet. The prover will first announce its claimed sum.');
