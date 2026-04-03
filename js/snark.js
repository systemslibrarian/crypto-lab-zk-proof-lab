import {
  addLog,
  copyTextToClipboard,
  createSeededRng,
  rHex,
  rInt,
  readSeedFromUrl,
  seededHex,
  seededInt,
  sha256hex
} from './shared.js';

let snarkBusy = false;
let lastSnarkTranscript = null;
const scenarioSeed = readSeedFromUrl();
const seededRng = scenarioSeed ? createSeededRng(`snark:${scenarioSeed}`) : null;

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

function setControls() {
  document.getElementById('snark-run-btn').disabled = snarkBusy;
  document.getElementById('snark-tamper-btn').disabled = snarkBusy || !lastSnarkTranscript;
  document.getElementById('snark-copy-btn').disabled = snarkBusy || !lastSnarkTranscript;
  document.getElementById('snark-replay-btn').disabled = snarkBusy || !lastSnarkTranscript;
  document.getElementById('snark-reset-btn').disabled = snarkBusy;
}

async function buildProofTranscript() {
  const witness = nextInt(2, 40);
  const publicInput = witness * witness + 3 * witness + 7;
  const provingNonce = nextHex(12);
  const digest = await sha256hex(`${publicInput}|${provingNonce}`);
  return {
    protocol: 'zk-SNARK Intuition Model',
    mode: 'toy-pipeline',
    educationalParameters: true,
    seed: scenarioSeed,
    publicInput,
    privateWitness: witness,
    provingNonce,
    digest,
    relation: 'y = w^2 + 3w + 7',
    verification: {
      equationHolds: publicInput === witness * witness + 3 * witness + 7,
      digestBound: true
    },
    note: 'Pedagogical SNARK pipeline only; not a real SNARK cryptosystem.'
  };
}

function persist(transcript) {
  localStorage.setItem('zkpl:last:snark', JSON.stringify(transcript));
}

function render(transcript) {
  document.getElementById('snark-w').textContent = String(transcript.privateWitness);
  document.getElementById('snark-y').textContent = String(transcript.publicInput);
  document.getElementById('snark-digest').textContent = transcript.digest;
  document.getElementById('snark-eq').textContent = transcript.verification.equationHolds
    ? 'witness relation holds for public input'
    : 'relation does not hold';
  document.getElementById('snark-consistency').textContent = transcript.verification.digestBound
    ? 'digest binds public input to proof envelope'
    : 'digest mismatch';
  document.getElementById('snark-result').innerHTML = transcript.verification.equationHolds && transcript.verification.digestBound
    ? '<span style="color:var(--ok)">✓ Toy proof accepted by verifier pipeline.</span>'
    : '<span style="color:var(--err)">✗ Toy proof rejected.</span>';
}

async function runPipeline() {
  if (snarkBusy) {
    return;
  }
  snarkBusy = true;
  setControls();
  try {
    lastSnarkTranscript = await buildProofTranscript();
    render(lastSnarkTranscript);
    persist(lastSnarkTranscript);
    addLog('snark-log', 'Setup keypair assumed; proof generated for toy relation', 'lok');
    if (scenarioSeed) {
      addLog('snark-log', `Seeded run: ${scenarioSeed}`, 'lacc');
    }
  } finally {
    snarkBusy = false;
    setControls();
  }
}

async function tamperPublicInput() {
  if (snarkBusy || !lastSnarkTranscript) {
    return;
  }
  snarkBusy = true;
  setControls();
  try {
    const tampered = { ...lastSnarkTranscript, publicInput: lastSnarkTranscript.publicInput + 1 };
    const tamperedDigest = await sha256hex(`${tampered.publicInput}|${tampered.provingNonce}`);
    tampered.verification = {
      equationHolds: tampered.publicInput === tampered.privateWitness * tampered.privateWitness + 3 * tampered.privateWitness + 7,
      digestBound: tamperedDigest === tampered.digest
    };
    render(tampered);
    addLog('snark-log', 'Tamper attempt: public input changed after proof generation', 'lerr');
  } finally {
    snarkBusy = false;
    setControls();
  }
}

async function copyTranscript() {
  if (!lastSnarkTranscript) {
    return;
  }
  await copyTextToClipboard(JSON.stringify(lastSnarkTranscript, null, 2));
  addLog('snark-log', 'Transcript copied to clipboard', 'lacc');
}

function replayInLab() {
  if (!lastSnarkTranscript) {
    return;
  }
  localStorage.setItem('zkpl:replay:left', JSON.stringify(lastSnarkTranscript));
  window.location.href = 'transcript-lab.html';
}

function reset() {
  if (snarkBusy) {
    return;
  }
  lastSnarkTranscript = null;
  ['snark-w', 'snark-y', 'snark-digest', 'snark-eq', 'snark-consistency'].forEach(id => {
    document.getElementById(id).textContent = '—';
  });
  document.getElementById('snark-result').textContent = 'Ready.';
  document.getElementById('snark-log').innerHTML = '<span class="le">— protocol log —</span>';
  setControls();
}

document.getElementById('snark-run-btn').addEventListener('click', runPipeline);
document.getElementById('snark-tamper-btn').addEventListener('click', tamperPublicInput);
document.getElementById('snark-copy-btn').addEventListener('click', copyTranscript);
document.getElementById('snark-replay-btn').addEventListener('click', replayInLab);
document.getElementById('snark-reset-btn').addEventListener('click', reset);
setControls();
