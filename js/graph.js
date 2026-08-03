import {
  bruteForceOpenings,
  consistentAfterOpening,
  consistentColorings,
  properColorings
} from './extractor.js';
import {
  addLog,
  celebrate,
  cheatProbabilityPercent,
  createSeededRng,
  flashFail,
  narrate,
  readAutoFromUrl,
  rHex,
  rInt,
  readSeedFromUrl,
  seededHex,
  seededInt,
  setConf,
  sha256hex,
  sleep
} from './shared.js';

const TRUTH = ['A', 'B', 'C', 'B', 'C'];
const EDGES = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [0, 2]];
const EIDS = ['e01', 'e12', 'e23', 'e34', 'e40', 'e02'];
const COLORS = {
  A: { fill: '#4a1515', stroke: '#ef4444', label: 'RED' },
  B: { fill: '#0f2456', stroke: '#3b82f6', label: 'BLUE' },
  C: { fill: '#0d3320', stroke: '#22c55e', label: 'GRN' }
};

let gState = { n: 0, phase: 'idle', perm: null, commits: null, auto: false };

// Everything the verifier legitimately saw: which edge it challenged and which
// two (permuted) colours were opened. The extractor bench below is given this
// and nothing else — it never reads TRUTH or gState.commits[i].color.
/** @type {{edge: [number, number], revealed: [string, string]}[]} */
let revealTranscript = [];
// Permuted colouring recovered by the weak-nonce control, once that attack has
// actually succeeded. Null until then; never assumed.
/** @type {string[] | null} */
let brokenOpening = null;
let benchBusy = false;
// Real SHA-256 invocations the 16-byte attack is allowed. Sized so the attack
// finishes in well under a second in a browser; the point is the ratio between
// this and the keyspace, which the bench prints.
const ATTACK_BUDGET = 199998;

const scenarioSeed = readSeedFromUrl();
const autoScenario = readAutoFromUrl();
const seededRng = scenarioSeed ? createSeededRng(`graph:${scenarioSeed}`) : null;
let seedAnnounced = false;

function nextInt(min, max) {
  if (seededRng) {
    return seededInt(seededRng, min, max);
  }
  return rInt(min, max);
}

function nextHex(bytes) {
  if (seededRng) {
    return seededHex(seededRng, bytes);
  }
  return rHex(bytes);
}

function graphSetControls() {
  const busy = gState.auto || benchBusy;
  document.getElementById('g-btn-r').disabled = busy || gState.phase === 'committed';
  document.getElementById('g-btn-c').disabled = busy || gState.phase !== 'committed';
  document.getElementById('g-btn-t').disabled = busy || gState.phase !== 'committed';
  document.getElementById('g-btn-a').disabled = busy;
  document.getElementById('g-btn-x').disabled = busy;
  document.getElementById('x-btn-brute').disabled = busy;
  document.getElementById('x-btn-recon').disabled = busy;
  document.getElementById('x-btn-reset').disabled = busy;
}

function graphResetViz() {
  for (let i = 0; i < 5; i += 1) {
    document.getElementById(`n${i}`).setAttribute('fill', '#131c2e');
    document.getElementById(`n${i}`).setAttribute('stroke', '#1c2540');
    const label = document.getElementById(`l${i}`);
    label.setAttribute('fill', '#3a4a68');
    label.textContent = '0x…';
  }
  EIDS.forEach(id => {
    document.getElementById(id).setAttribute('stroke', '#1c2540');
    document.getElementById(id).setAttribute('stroke-width', '2');
  });
}

// Real binding+hiding commitment: SHA-256 over the region colour and a fresh
// per-round nonce. The verifier only ever sees this digest until reveal, and
// re-hashing on reveal is what catches a prover who tries to swap colours.
export async function graphCommit(color, nonce) {
  return sha256hex(`${color}|${nonce}`);
}

// Short, monospace-friendly form of a commitment for the SVG node labels and
// the commitment table. The full digest is retained in state for verification.
function shortHash(hash) {
  return `${hash.slice(0, 8)}…`;
}

function shuffleColors() {
  const perm = ['A', 'B', 'C'];
  for (let i = perm.length - 1; i > 0; i -= 1) {
    const j = nextInt(0, i);
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  return perm;
}

function renderCommitTable() {
  if (!gState.commits) {
    return;
  }
  const tbody = document.getElementById('g-commit-table');
  tbody.innerHTML = '';
  for (let i = 0; i < 5; i += 1) {
    const tr = document.createElement('tr');
    const nodeCell = document.createElement('td');
    const hashCell = document.createElement('td');
    nodeCell.textContent = String(i);
    hashCell.textContent = gState.commits[i].display;
    tr.appendChild(nodeCell);
    tr.appendChild(hashCell);
    tbody.appendChild(tr);
  }
}

export async function graphRound() {
  if (gState.auto || gState.phase === 'committed') {
    return;
  }
  const perm = shuffleColors();
  gState.phase = 'committed';
  gState.perm = perm;
  gState.commits = await Promise.all(TRUTH.map(async color => {
    const permuted = perm['ABC'.indexOf(color)];
    const nonce = nextHex(16);
    const hash = await graphCommit(permuted, nonce);
    return { color: permuted, nonce, hash, display: shortHash(hash) };
  }));
  graphResetViz();
  for (let i = 0; i < 5; i += 1) {
    document.getElementById(`l${i}`).textContent = gState.commits[i].display;
  }
  renderCommitTable();
  document.getElementById('g-round-info').textContent = `Round ${gState.n + 1}: prover re-colored and committed. Hashes published.`;
  narrate('graph-narration', 'The prover secretly re-colors the map with a fresh random permutation, then publishes a locked hash commitment for every region.');
  document.getElementById('g-challenge').textContent = '';
  if (scenarioSeed && !seedAnnounced) {
    addLog('g-log', `Seeded run: ${scenarioSeed}`, 'lacc');
    seedAnnounced = true;
  }
  graphSetControls();
}

export async function graphChallenge() {
  if (gState.auto || gState.phase !== 'committed') {
    return;
  }
  gState.phase = 'revealed';
  const edgeIndex = nextInt(0, 5);
  const [a, b] = EDGES[edgeIndex];
  document.getElementById('g-challenge').textContent = `→ CHALLENGE: reveal edge ${a}–${b}`;
  document.getElementById(EIDS[edgeIndex]).setAttribute('stroke', '#fbbf24');
  document.getElementById(EIDS[edgeIndex]).setAttribute('stroke-width', '3');
  [a, b].forEach(nodeIndex => {
    const commit = gState.commits[nodeIndex];
    const colorDef = COLORS[commit.color];
    document.getElementById(`n${nodeIndex}`).setAttribute('fill', colorDef.fill);
    document.getElementById(`n${nodeIndex}`).setAttribute('stroke', colorDef.stroke);
    const label = document.getElementById(`l${nodeIndex}`);
    label.setAttribute('fill', colorDef.stroke);
    label.textContent = colorDef.label;
  });
  // Re-open the two revealed commitments and confirm each opening re-hashes to
  // the digest published at commit time. Binding is enforced here, not assumed.
  const openings = await Promise.all([a, b].map(async nodeIndex => {
    const commit = gState.commits[nodeIndex];
    const recomputed = await graphCommit(commit.color, commit.nonce);
    return recomputed === commit.hash;
  }));
  const bindingOk = openings.every(Boolean);
  const ok = bindingOk && gState.commits[a].color !== gState.commits[b].color;
  // The exponent under P(cheat) = (5/6)^n counts rounds the prover SURVIVED.
  // A round the verifier rejected is not one of them, so a rejected round is
  // numbered in the log but never advances n — otherwise catching a tamper
  // would raise the verifier's confidence, which is backwards. The cave
  // exhibit already models it this way, and the extractor bench below likewise
  // reports only "accepted rounds".
  const roundNumber = gState.n + 1;
  if (ok) {
    gState.n = roundNumber;
  }
  if (!bindingOk) {
    addLog('g-log', `R${roundNumber}: edge ${a}–${b} → ✗ commitment opening did not re-hash to published digest`, 'lerr');
    narrate('graph-narration', 'A revealed colour+nonce that does not re-hash to its published commitment is rejected — the SHA-256 binding caught a swapped colour.');
    flashFail('g-challenge');
  } else if (ok) {
    // The verifier accepted this round, so this is a line of transcript it is
    // entitled to keep. Everything the extractor bench knows comes from here.
    revealTranscript.push({ edge: [a, b], revealed: [gState.commits[a].color, gState.commits[b].color] });
    addLog('g-log', `R${roundNumber}: edge ${a}–${b} → ${COLORS[gState.commits[a].color].label} ≠ ${COLORS[gState.commits[b].color].label} ✓ (openings verified)`, 'lok');
    narrate('graph-narration', 'The verifier opens one border. The two regions show different colors, so this edge is valid — and the rest of the coloring stays hidden.');
    if (!gState.auto) {
      celebrate('g-challenge', { confetti: gState.n % 5 === 0 });
    }
  } else {
    addLog('g-log', `R${roundNumber}: FAIL — same color ✗`, 'lerr');
    narrate('graph-narration', 'A border showing the same color on both sides would expose an invalid coloring — that is exactly what the verifier is checking for.');
    flashFail('g-challenge');
  }
  setConf('g-fill', 'g-pct', gState.n, 5 / 6);
  document.getElementById('g-n').textContent = gState.n;
  document.getElementById('g-cp').textContent = `${cheatProbabilityPercent(gState.n, 5 / 6).toFixed(2)}%`;
  graphSetControls();
}

export function graphTamper() {
  if (gState.auto || gState.phase !== 'committed') {
    return;
  }
  gState.commits.forEach(commit => {
    commit.color = commit.color === 'A' ? 'B' : 'A';
  });
  document.getElementById('g-round-info').textContent = 'Tamper injected: the openings were changed after their digests were published.';
  narrate('graph-narration', 'The prover changed the colours after committing. Challenge any edge to see the published digests reject those altered openings.');
  addLog('g-log', 'Tamper injected: colours changed without changing their published digests', 'lerr');
  graphSetControls();
}

export async function graphAuto() {
  if (gState.auto) {
    return;
  }
  gState.auto = true;
  graphSetControls();
  try {
    for (let i = 0; i < 10; i += 1) {
      await graphRound();
      await sleep(300);
      await graphChallenge();
      await sleep(300);
    }
  } finally {
    gState.auto = false;
    graphSetControls();
  }
}

export function graphReset() {
  if (gState.auto) {
    return;
  }
  gState = { n: 0, phase: 'idle', perm: null, commits: null, auto: false };
  graphResetViz();
  document.getElementById('g-round-info').textContent = 'Press "New Round" to commit.';
  narrate('graph-narration', 'The prover commits to a random re-coloring of the map, then reveals just the two regions on a border the verifier picks. Valid borders never share a color.');
  document.getElementById('g-challenge').textContent = '';
  document.getElementById('g-fill').style.width = '0%';
  document.getElementById('g-pct').textContent = '0.00%';
  document.getElementById('g-n').textContent = '0';
  document.getElementById('g-cp').textContent = '100%';
  document.getElementById('g-log').innerHTML = '<span class="le">— protocol log —</span>';
  document.getElementById('g-commit-table').innerHTML = '<tr><td>0</td><td>0x…</td></tr><tr><td>1</td><td>0x…</td></tr><tr><td>2</td><td>0x…</td></tr><tr><td>3</td><td>0x…</td></tr><tr><td>4</td><td>0x…</td></tr>';
  seedAnnounced = false;
  benchReset();
  graphSetControls();
}

/* ---------------------------------------------------------------------------
 * Extractor bench
 *
 * Two attacks the learner can actually run. Neither is narrated: the panel
 * prints what the attack returned. The commitment attack does real SHA-256
 * work against the digests this page published, and the transcript extractor
 * enumerates all 3^5 colourings against the transcript this page produced.
 * ------------------------------------------------------------------------ */

/**
 * @param {number} value
 * @returns {string}
 */
function formatCount(value) {
  return value.toLocaleString('en-US');
}

/**
 * @param {number} value
 * @returns {string}
 */
function formatBig(value) {
  return value >= 1e6 ? value.toExponential(2) : formatCount(Math.round(value));
}

/**
 * @param {number} value
 * @returns {string}
 */
function formatFraction(value) {
  if (value >= 1) {
    return '100%';
  }
  return value >= 0.0001 ? `${(value * 100).toFixed(4)}%` : value.toExponential(2);
}

/**
 * @param {number} count
 * @returns {string}
 */
function guessPercent(count) {
  return count > 0 ? `${(100 / count).toFixed(2)}%` : 'n/a';
}

/**
 * @param {string} prefix
 * @param {import('./extractor.js').AttackResult} result
 */
function renderAttackRow(prefix, result) {
  document.getElementById(`${prefix}-keyspace`).textContent = formatBig(result.keyspace);
  document.getElementById(`${prefix}-hashes`).textContent = formatCount(result.hashesTried);
  document.getElementById(`${prefix}-recovered`).textContent = `${result.recoveredCount} of ${result.recovered.length}`;
  document.getElementById(`${prefix}-fraction`).textContent = result.exhausted
    ? `${formatFraction(result.fractionSearched)} (exhausted)`
    : formatFraction(result.fractionSearched);
  document.getElementById(`${prefix}-expected`).textContent = `${formatBig(result.expectedHashesToBreak)} hashes`;
}

// Attack 1. Brute-force the published commitments at the exhibit's real nonce
// width, then re-run the identical attacker against the same colours committed
// under an 8-bit nonce. Only the keyspace differs between the two runs.
async function runBruteForce() {
  if (benchBusy || gState.auto) {
    return;
  }
  if (!gState.commits) {
    await graphRound();
  }
  benchBusy = true;
  graphSetControls();
  try {
    const commits = gState.commits;
    const strong = await bruteForceOpenings(commits.map(commit => commit.hash), {
      nonceBytes: 16,
      budget: ATTACK_BUDGET,
      hash: sha256hex
    });
    renderAttackRow('x-strong', strong);
    addLog('x-log', `16-byte nonce: ${formatCount(strong.hashesTried)} real SHA-256 hashes → ${strong.recoveredCount} openings recovered`, strong.recoveredCount === 0 ? 'lok' : 'lerr');

    // Weakened control: same five colours, same commitment scheme, 8-bit nonce.
    const weakCommits = await Promise.all(commits.map(commit => graphCommit(commit.color, nextHex(1))));
    const weak = await bruteForceOpenings(weakCommits, {
      nonceBytes: 1,
      budget: 3 * 256,
      hash: sha256hex
    });
    renderAttackRow('x-weak', weak);
    addLog('x-log', `1-byte nonce: ${formatCount(weak.hashesTried)} real SHA-256 hashes → ${weak.recoveredCount} openings recovered`, weak.recoveredCount === 0 ? 'lok' : 'lerr');

    brokenOpening = weak.recoveredCount === weak.recovered.length
      ? weak.recovered.map(color => String(color))
      : null;
    if (brokenOpening) {
      addLog('x-log', 'Broken commitments folded in: the attacker now knows the colouring up to a relabelling', 'lerr');
    }

    const verdict = document.getElementById('x-attack-verdict');
    if (strong.recoveredCount === 0 && brokenOpening) {
      verdict.innerHTML = `<span style="color:var(--ok)">✓ Nothing recovered at 16 bytes</span> — ${formatCount(strong.hashesTried)} real hashes covered a ${formatFraction(strong.fractionSearched)} fraction of the keyspace, and an average break costs ${formatBig(strong.expectedHashesToBreak)} hashes, so this failure is a measurement of scale rather than an exhaustive search. <span style="color:var(--err)">✗ The same attacker recovered every colour at 1 byte</span> in ${formatCount(weak.hashesTried)} hashes. Hiding is a property of the nonce space, not of the word "commitment".`;
      celebrate('x-attack-verdict', { confetti: false });
    } else if (strong.recoveredCount === 0) {
      verdict.innerHTML = `<span style="color:var(--ok)">✓ Nothing recovered at 16 bytes</span> after ${formatCount(strong.hashesTried)} real hashes (a ${formatFraction(strong.fractionSearched)} fraction of the keyspace). The 8-bit control recovered ${weak.recoveredCount} of ${weak.recovered.length}.`;
    } else {
      verdict.innerHTML = `<span style="color:var(--err)">✗ Recovered ${strong.recoveredCount} opening(s) at 16 bytes.</span> That should be infeasible — treat this run as a bug report, not a lesson.`;
      flashFail('x-attack-verdict');
    }
    renderReconstruction();
  } finally {
    benchBusy = false;
    graphSetControls();
  }
}

// Attack 2. Enumerate every colouring the transcript cannot rule out. The
// numbers printed are set sizes returned by the extractor, not commentary.
function renderReconstruction() {
  const candidates = consistentColorings(TRUTH.length, revealTranscript);
  const floor = properColorings(TRUTH.length, EDGES);
  const truthSurvives = candidates.some(candidate => candidate.every((color, node) => color === TRUTH[node]));
  document.getElementById('x-recon-count').textContent = `${formatCount(candidates.length)} of 243`;
  document.getElementById('x-recon-guess').textContent = guessPercent(candidates.length);

  if (brokenOpening) {
    const broken = consistentAfterOpening(TRUTH.length, revealTranscript, brokenOpening);
    document.getElementById('x-broken-count').textContent = `${formatCount(broken.length)} of 243`;
    document.getElementById('x-broken-guess').textContent = guessPercent(broken.length);
  }

  const verdict = document.getElementById('x-recon-verdict');
  if (revealTranscript.length === 0) {
    verdict.textContent = 'No accepted rounds yet — the extractor has nothing to work from.';
    return;
  }
  const truthNote = truthSurvives
    ? 'the true colouring is still in that set (the extractor is complete)'
    : 'the true colouring was excluded — that would be an extractor bug';
  verdict.innerHTML = `After ${revealTranscript.length} accepted round(s) the transcript leaves <strong>${formatCount(candidates.length)}</strong> colourings possible, ${truthNote}. It cannot fall below the ${formatCount(floor.length)} colourings that are proper on all ${EDGES.length} edges — that set <em>is</em> the statement being proved, so reaching it leaks nothing beyond it.`;
}

async function runReconstruction() {
  if (benchBusy || gState.auto) {
    return;
  }
  if (revealTranscript.length === 0) {
    await graphRound();
    await graphChallenge();
  }
  renderReconstruction();
  addLog('x-log', `Transcript extractor run over ${revealTranscript.length} accepted round(s)`, 'lacc');
}

function benchReset() {
  revealTranscript = [];
  brokenOpening = null;
  ['x-strong-keyspace', 'x-strong-hashes', 'x-strong-recovered', 'x-strong-fraction', 'x-strong-expected',
    'x-weak-keyspace', 'x-weak-hashes', 'x-weak-recovered', 'x-weak-fraction', 'x-weak-expected',
    'x-recon-count', 'x-recon-guess', 'x-broken-count', 'x-broken-guess'].forEach(id => {
    document.getElementById(id).textContent = '—';
  });
  document.getElementById('x-attack-verdict').textContent = 'Not run yet.';
  document.getElementById('x-recon-verdict').textContent = 'Challenge at least one edge, then run the extractor.';
  document.getElementById('x-log').innerHTML = '<span class="le">— extractor log —</span>';
  // The prior is the whole space: the extractor with an empty transcript.
  const prior = consistentColorings(TRUTH.length, []);
  document.getElementById('x-prior-count').textContent = formatCount(prior.length);
  document.getElementById('x-prior-guess').textContent = guessPercent(prior.length);
}

function benchResetClick() {
  if (benchBusy || gState.auto) {
    return;
  }
  benchReset();
}

document.getElementById('g-btn-r').addEventListener('click', graphRound);
document.getElementById('g-btn-c').addEventListener('click', graphChallenge);
document.getElementById('g-btn-t').addEventListener('click', graphTamper);
document.getElementById('g-btn-a').addEventListener('click', graphAuto);
document.getElementById('g-btn-x').addEventListener('click', graphReset);
document.getElementById('x-btn-brute').addEventListener('click', runBruteForce);
document.getElementById('x-btn-recon').addEventListener('click', runReconstruction);
document.getElementById('x-btn-reset').addEventListener('click', benchResetClick);
benchReset();

if (autoScenario) {
  setTimeout(() => {
    graphAuto();
  }, 0);
}
