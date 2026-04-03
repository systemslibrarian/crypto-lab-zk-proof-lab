import {
  addLog,
  copyTextToClipboard,
  createSeededRng,
  readAutoFromUrl,
  readModeFromUrl,
  rInt,
  readSeedFromUrl,
  schnorrVerify,
  seededInt,
  setConf,
  sleep
} from './utils.js';

let schnorrN = 0;
let schnorrBusy = false;
let lastSchnorrTranscript = null;
const scenarioSeed = readSeedFromUrl();
const scenarioMode = readModeFromUrl();
const autoScenario = readAutoFromUrl();
const seededRng = scenarioSeed ? createSeededRng(`schnorr:${scenarioSeed}`) : null;

function nextInt(min, max) {
  if (seededRng) {
    return seededInt(seededRng, min, max);
  }
  return rInt(min, max);
}

function schnorrSetControls() {
  document.getElementById('s-btn').disabled = schnorrBusy;
  document.getElementById('s-cheat-btn').disabled = schnorrBusy;
  document.getElementById('s-reset-btn').disabled = schnorrBusy;
  document.getElementById('s-copy-btn').disabled = schnorrBusy || !lastSchnorrTranscript;
  document.getElementById('s-replay-btn').disabled = schnorrBusy || !lastSchnorrTranscript;
}

function buildTranscript({ cheat, r, R, c, s, lhs, rhs, ok }) {
  return {
    protocol: 'Schnorr Identification',
    mode: cheat ? 'cheat-simulation' : 'honest-proof',
    educationalParameters: true,
    parameters: { p: 2053, g: 5, y: 375 },
    seed: scenarioSeed,
    transcript: { r, R, c, s, lhs, rhs, verified: ok },
    note: 'Real browser-side modular arithmetic with intentionally tiny educational parameters.'
  };
}

function persistTranscript(transcript) {
  localStorage.setItem('zkpl:last:schnorr', JSON.stringify(transcript));
}

export async function schnorrRun(cheat) {
  if (schnorrBusy) {
    return;
  }
  schnorrBusy = true;
  schnorrSetControls();
  try {
    ['s2', 's3', 's4'].forEach(id => {
      document.getElementById(id).style.opacity = '.3';
    });
    document.getElementById('s-result').textContent = '';
    const r = nextInt(1, 2051);
    const R = schnorrVerify({ g: 5, p: 2053, y: 1, R: 1, c: 0, s: r }).lhs;
    document.getElementById('s-r').textContent = r;
    document.getElementById('s-r2').textContent = r;
    document.getElementById('s-R').textContent = R;
    document.getElementById('s-r3').textContent = r;
    await sleep(350);
    const c = nextInt(1, 50);
    document.getElementById('s-c').textContent = c;
    document.getElementById('s-c2').textContent = c;
    document.getElementById('s2').style.opacity = '1';
    await sleep(350);
    const s = cheat ? nextInt(1, 2051) : ((r + c * 17) % 2052 + 2052) % 2052;
    document.getElementById('s-s').textContent = s;
    document.getElementById('s3').style.opacity = '1';
    await sleep(350);
    const { lhs, rhs, ok } = schnorrVerify({ g: 5, p: 2053, y: 375, R, c, s });
    document.getElementById('s-lhs').textContent = lhs;
    document.getElementById('s-rhs').textContent = rhs;
    document.getElementById('s4').style.opacity = '1';
    const result = document.getElementById('s-result');
    if (ok) {
      result.innerHTML = '<span style="color:var(--ok)">✓ VERIFIED — values match</span>';
      if (!cheat) {
        schnorrN += 1;
        setConf('s-fill', 's-pct', schnorrN, 1 / 50);
      }
      addLog('s-log', `g^${s} mod p = ${lhs} = R·y^c ✓`, 'lok');
    } else {
      result.innerHTML = `<span style="color:var(--err)">✗ FAILED — ${lhs} ≠ ${rhs}</span>`;
      addLog('s-log', `CHEAT: g^s=${lhs} ≠ R·y^c=${rhs} → CAUGHT`, 'lerr');
    }
    lastSchnorrTranscript = buildTranscript({ cheat, r, R, c, s, lhs, rhs, ok });
    persistTranscript(lastSchnorrTranscript);
    if (scenarioSeed) {
      addLog('s-log', `Seeded run: ${scenarioSeed}`, 'lacc');
    }
  } finally {
    schnorrBusy = false;
    schnorrSetControls();
  }
}

export function schnorrReset() {
  if (schnorrBusy) {
    return;
  }
  schnorrN = 0;
  lastSchnorrTranscript = null;
  ['s-r', 's-r2', 's-R', 's-r3', 's-c', 's-c2', 's-s', 's-lhs', 's-rhs'].forEach(id => {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = '?';
    }
  });
  document.getElementById('s-result').textContent = '';
  ['s2', 's3', 's4'].forEach(id => {
    document.getElementById(id).style.opacity = '.3';
  });
  document.getElementById('s-fill').style.width = '0%';
  document.getElementById('s-pct').textContent = '0.00%';
  document.getElementById('s-log').innerHTML = '<span class="le">— protocol log —</span>';
  schnorrSetControls();
}

export async function schnorrCopyTranscript() {
  if (!lastSchnorrTranscript) {
    return;
  }
  await copyTextToClipboard(JSON.stringify(lastSchnorrTranscript, null, 2));
  addLog('s-log', 'Transcript copied to clipboard', 'lacc');
}

export function schnorrReplayInLab() {
  if (!lastSchnorrTranscript) {
    return;
  }
  localStorage.setItem('zkpl:replay:left', JSON.stringify(lastSchnorrTranscript));
  window.location.href = 'transcript-lab.html';
}

document.getElementById('s-btn').addEventListener('click', () => schnorrRun(false));
document.getElementById('s-cheat-btn').addEventListener('click', () => schnorrRun(true));
document.getElementById('s-copy-btn').addEventListener('click', schnorrCopyTranscript);
document.getElementById('s-replay-btn').addEventListener('click', schnorrReplayInLab);
document.getElementById('s-reset-btn').addEventListener('click', schnorrReset);

if (autoScenario) {
  setTimeout(() => {
    schnorrRun(scenarioMode === 'cheat');
  }, 0);
}
