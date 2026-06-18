import {
  addLog,
  celebrate,
  copyTextToClipboard,
  createSeededRng,
  flashFail,
  modpow,
  narrate,
  readAutoFromUrl,
  readModeFromUrl,
  rHex,
  rInt,
  readSeedFromUrl,
  schnorrVerify,
  seededHex,
  seededInt,
  sha256hex
} from './utils.js';

const fsParams = { p: 2053, g: 5, x: 17, y: 375 };
let lastFiatShamirTranscript = null;
let fsBusy = false;
const scenarioSeed = readSeedFromUrl();
const scenarioMode = readModeFromUrl();
const autoScenario = readAutoFromUrl();
const seededRng = scenarioSeed ? createSeededRng(`fiat-shamir:${scenarioSeed}`) : null;

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

function setFsControls() {
  document.getElementById('fs-run-btn').disabled = fsBusy;
  document.getElementById('fs-tamper-btn').disabled = fsBusy || !lastFiatShamirTranscript;
  document.getElementById('fs-copy-btn').disabled = fsBusy || !lastFiatShamirTranscript;
  document.getElementById('fs-replay-btn').disabled = fsBusy || !lastFiatShamirTranscript;
  document.getElementById('fs-reset-btn').disabled = fsBusy;
}

async function deriveChallenge({ R, y, message }) {
  const digest = await sha256hex(`${R}|${y}|${message}`);
  const numeric = parseInt(digest.slice(0, 8), 16);
  return { digest, c: numeric % 50 + 1 };
}

function persistTranscript(transcript) {
  localStorage.setItem('zkpl:last:fiat-shamir', JSON.stringify(transcript));
}

function renderTranscript(transcript) {
  document.getElementById('fs-msg').textContent = transcript.message;
  document.getElementById('fs-R').textContent = String(transcript.transcript.R);
  document.getElementById('fs-c').textContent = `${transcript.transcript.c} (hash ${transcript.challengeDigest.slice(0, 16)}...)`;
  document.getElementById('fs-s').textContent = String(transcript.transcript.s);
  document.getElementById('fs-lhs').textContent = String(transcript.transcript.lhs);
  document.getElementById('fs-rhs').textContent = String(transcript.transcript.rhs);
  document.getElementById('fs-result').innerHTML = transcript.transcript.verified
    ? '<span style="color:var(--ok)">✓ VERIFIED — hash-derived challenge binds this proof transcript.</span>'
    : '<span style="color:var(--err)">✗ FAILED — transcript no longer verifies.</span>';
  if (transcript.transcript.verified) {
    celebrate('fs-result');
  } else {
    flashFail('fs-result');
  }
}

async function generateProof() {
  if (fsBusy) {
    return;
  }
  fsBusy = true;
  setFsControls();
  try {
    const r = nextInt(1, 2051);
    const R = modpow(fsParams.g, r, fsParams.p);
    const message = `proof-note:${nextHex(8)}`;
    const { digest, c } = await deriveChallenge({ R, y: fsParams.y, message });
    const s = ((r + c * fsParams.x) % 2052 + 2052) % 2052;
    const { lhs, rhs, ok } = schnorrVerify({ g: fsParams.g, p: fsParams.p, y: fsParams.y, R, c, s });
    lastFiatShamirTranscript = {
      protocol: 'Fiat-Shamir (Schnorr-style)',
      educationalParameters: true,
      seed: scenarioSeed,
      parameters: { p: fsParams.p, g: fsParams.g, y: fsParams.y },
      message,
      challengeDigest: digest,
      transcript: { R, c, s, lhs, rhs, verified: ok },
      note: 'Challenge is derived via SHA-256 over transcript inputs for non-interactive verification.'
    };
    persistTranscript(lastFiatShamirTranscript);
    renderTranscript(lastFiatShamirTranscript);
    addLog('fs-log', `Generated proof with c = H(R||y||m) = ${c}`, 'lok');
    if (scenarioSeed) {
      addLog('fs-log', `Seeded run: ${scenarioSeed}`, 'lacc');
    }
    narrate('fs-narration', 'No live verifier needed: the challenge c is derived by hashing the transcript itself (c = H(R‖y‖m)), turning the interactive proof into a single self-contained one.');
  } finally {
    fsBusy = false;
    setFsControls();
  }
}

async function tamperMessage() {
  if (fsBusy || !lastFiatShamirTranscript) {
    return;
  }
  fsBusy = true;
  setFsControls();
  try {
    const alteredMessage = `${lastFiatShamirTranscript.message}-tampered`;
    const { c } = await deriveChallenge({ R: lastFiatShamirTranscript.transcript.R, y: fsParams.y, message: alteredMessage });
    const { lhs, rhs, ok } = schnorrVerify({
      g: fsParams.g,
      p: fsParams.p,
      y: fsParams.y,
      R: lastFiatShamirTranscript.transcript.R,
      c,
      s: lastFiatShamirTranscript.transcript.s
    });
    document.getElementById('fs-result').innerHTML = ok
      ? '<span style="color:var(--warn)">Unexpected pass after tamper; regenerate and inspect transcript.</span>'
      : '<span style="color:var(--err)">✗ Tamper detected — changing message changes challenge and breaks verification.</span>';
    if (!ok) {
      flashFail('fs-result');
    }
    document.getElementById('fs-lhs').textContent = String(lhs);
    document.getElementById('fs-rhs').textContent = String(rhs);
    addLog('fs-log', `Tamper check with altered message produced c=${c}: verification failed as expected`, 'lerr');
    narrate('fs-narration', 'Altering the message changes the hash-derived challenge, so the original response no longer satisfies the equation — tampering is detected.');
  } finally {
    fsBusy = false;
    setFsControls();
  }
}

async function copyTranscript() {
  if (!lastFiatShamirTranscript) {
    return;
  }
  await copyTextToClipboard(JSON.stringify(lastFiatShamirTranscript, null, 2));
  addLog('fs-log', 'Transcript copied to clipboard', 'lacc');
}

function replayInLab() {
  if (!lastFiatShamirTranscript) {
    return;
  }
  localStorage.setItem('zkpl:replay:left', JSON.stringify(lastFiatShamirTranscript));
  window.location.href = 'transcript-lab.html';
}

function resetFiatShamir() {
  if (fsBusy) {
    return;
  }
  lastFiatShamirTranscript = null;
  ['fs-msg', 'fs-R', 'fs-c', 'fs-s', 'fs-lhs', 'fs-rhs'].forEach(id => {
    document.getElementById(id).textContent = '—';
  });
  document.getElementById('fs-result').textContent = 'Ready.';
  narrate('fs-narration', 'Fiat-Shamir removes the live verifier: the challenge is derived by hashing the transcript itself, turning an interactive proof into a single non-interactive one.');
  document.getElementById('fs-log').innerHTML = '<span class="le">— protocol log —</span>';
  setFsControls();
}

document.getElementById('fs-run-btn').addEventListener('click', generateProof);
document.getElementById('fs-tamper-btn').addEventListener('click', tamperMessage);
document.getElementById('fs-copy-btn').addEventListener('click', copyTranscript);
document.getElementById('fs-replay-btn').addEventListener('click', replayInLab);
document.getElementById('fs-reset-btn').addEventListener('click', resetFiatShamir);
setFsControls();

if (autoScenario) {
  setTimeout(async () => {
    await generateProof();
    if (scenarioMode === 'tamper') {
      await tamperMessage();
    }
  }, 0);
}
