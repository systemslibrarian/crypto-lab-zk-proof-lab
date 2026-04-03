import {
  addLog,
  cheatProbabilityPercent,
  createSeededRng,
  readAutoFromUrl,
  rHex,
  rInt,
  readSeedFromUrl,
  seededHex,
  seededInt,
  setConf,
  sleep
} from './utils.js';

const TRUTH = ['A', 'B', 'C', 'B', 'C'];
const EDGES = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [0, 2]];
const EIDS = ['e01', 'e12', 'e23', 'e34', 'e40', 'e02'];
const COLORS = {
  A: { fill: '#4a1515', stroke: '#ef4444', label: 'RED' },
  B: { fill: '#0f2456', stroke: '#3b82f6', label: 'BLUE' },
  C: { fill: '#0d3320', stroke: '#22c55e', label: 'GRN' }
};

let gState = { n: 0, phase: 'idle', perm: null, commits: null, auto: false };
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
  const busy = gState.auto;
  document.getElementById('g-btn-r').disabled = busy || gState.phase === 'committed';
  document.getElementById('g-btn-c').disabled = busy || gState.phase !== 'committed';
  document.getElementById('g-btn-a').disabled = busy;
  document.getElementById('g-btn-x').disabled = busy;
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

function simCommit(color, nonce) {
  return `${btoa(`${color}|${nonce}`).substring(0, 8)}…`;
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
    hashCell.textContent = gState.commits[i].hash;
    tr.appendChild(nodeCell);
    tr.appendChild(hashCell);
    tbody.appendChild(tr);
  }
}

export function graphRound() {
  if (gState.auto || gState.phase === 'committed') {
    return;
  }
  const perm = shuffleColors();
  gState.phase = 'committed';
  gState.perm = perm;
  gState.commits = TRUTH.map(color => {
    const permuted = perm['ABC'.indexOf(color)];
    const nonce = nextHex(4);
    return { color: permuted, nonce, hash: simCommit(permuted, nonce) };
  });
  graphResetViz();
  for (let i = 0; i < 5; i += 1) {
    document.getElementById(`l${i}`).textContent = gState.commits[i].hash;
  }
  renderCommitTable();
  document.getElementById('g-round-info').textContent = `Round ${gState.n + 1}: prover re-colored and committed. Hashes published.`;
  document.getElementById('g-challenge').textContent = '';
  if (scenarioSeed && !seedAnnounced) {
    addLog('g-log', `Seeded run: ${scenarioSeed}`, 'lacc');
    seedAnnounced = true;
  }
  graphSetControls();
}

export function graphChallenge() {
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
  const ok = gState.commits[a].color !== gState.commits[b].color;
  gState.n += 1;
  if (ok) {
    addLog('g-log', `R${gState.n}: edge ${a}–${b} → ${COLORS[gState.commits[a].color].label} ≠ ${COLORS[gState.commits[b].color].label} ✓`, 'lok');
  } else {
    addLog('g-log', `R${gState.n}: FAIL — same color ✗`, 'lerr');
  }
  setConf('g-fill', 'g-pct', gState.n, 5 / 6);
  document.getElementById('g-n').textContent = gState.n;
  document.getElementById('g-cp').textContent = `${cheatProbabilityPercent(gState.n, 5 / 6).toFixed(2)}%`;
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
      graphRound();
      await sleep(300);
      graphChallenge();
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
  document.getElementById('g-challenge').textContent = '';
  document.getElementById('g-fill').style.width = '0%';
  document.getElementById('g-pct').textContent = '0.00%';
  document.getElementById('g-n').textContent = '0';
  document.getElementById('g-cp').textContent = '100%';
  document.getElementById('g-log').innerHTML = '<span class="le">— protocol log —</span>';
  document.getElementById('g-commit-table').innerHTML = '<tr><td>0</td><td>0x…</td></tr><tr><td>1</td><td>0x…</td></tr><tr><td>2</td><td>0x…</td></tr><tr><td>3</td><td>0x…</td></tr><tr><td>4</td><td>0x…</td></tr>';
  seedAnnounced = false;
  graphSetControls();
}

document.getElementById('g-btn-r').addEventListener('click', graphRound);
document.getElementById('g-btn-c').addEventListener('click', graphChallenge);
document.getElementById('g-btn-a').addEventListener('click', graphAuto);
document.getElementById('g-btn-x').addEventListener('click', graphReset);

if (autoScenario) {
  setTimeout(() => {
    graphAuto();
  }, 0);
}
