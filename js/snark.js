import {
  addLog,
  celebrate,
  copyTextToClipboard,
  createSeededRng,
  flashFail,
  narrate,
  readAutoFromUrl,
  readModeFromUrl,
  rHex,
  rInt,
  readSeedFromUrl,
  seededHex,
  seededInt,
  sha256hex
} from './utils.js';

let snarkBusy = false;
let lastSnarkTranscript = null;
const scenarioSeed = readSeedFromUrl();
const scenarioMode = readModeFromUrl();
const autoScenario = readAutoFromUrl();
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
  const accepted = transcript.verification.equationHolds && transcript.verification.digestBound;
  document.getElementById('snark-result').innerHTML = accepted
    ? '<span style="color:var(--ok)">✓ Toy proof accepted by verifier pipeline.</span>'
    : '<span style="color:var(--err)">✗ Toy proof rejected.</span>';
  if (accepted) {
    celebrate('snark-result');
  } else {
    flashFail('snark-result');
  }
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
    narrate('snark-narration', 'A private witness w is checked against the public output y = w²+3w+7, with a digest binding the proof. The verifier accepts without ever seeing w.');
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
    narrate('snark-narration', 'Changing the public input after proving breaks the bound relation, so the verifier rejects the toy proof.');
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
  narrate('snark-narration', 'A toy SNARK pipeline: a private witness is reduced to a public output and a binding digest, so the verifier can accept the proof without ever seeing the witness.');
  document.getElementById('snark-log').innerHTML = '<span class="le">— protocol log —</span>';
  setControls();
}

document.getElementById('snark-run-btn').addEventListener('click', runPipeline);
document.getElementById('snark-tamper-btn').addEventListener('click', tamperPublicInput);
document.getElementById('snark-copy-btn').addEventListener('click', copyTranscript);
document.getElementById('snark-replay-btn').addEventListener('click', replayInLab);
document.getElementById('snark-reset-btn').addEventListener('click', reset);
setControls();

if (autoScenario) {
  setTimeout(async () => {
    await runPipeline();
    if (scenarioMode === 'tamper') {
      await tamperPublicInput();
    }
  }, 0);
}
