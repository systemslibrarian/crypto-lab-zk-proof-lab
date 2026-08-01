import {
  addLog,
  celebrate,
  copyTextToClipboard,
  createSeededRng,
  flashFail,
  modpow,
  readAutoFromUrl,
  readModeFromUrl,
  rInt,
  readSeedFromUrl,
  recoverSchnorrSecret,
  schnorrVerify,
  seededInt,
  setConf,
  sleep
} from './shared.js';

let schnorrN = 0;
let schnorrBusy = false;
let lastSchnorrTranscript = null;
let stepRun = null;
// The prover's private view of the last run, kept in memory only so the
// "Leak the nonce" lesson has an r to leak. It is never persisted or copied.
let lastRun = null;
let secretX = 17;
let pubY = 375;

const DEFAULT_NARRATION = 'Press <strong>Run Protocol</strong> for the full flow, or <strong>Step ▷</strong> to walk through one phase at a time.';
const NARRATION = {
  1: 'The prover picks a secret random <strong>r</strong> and sends only <strong>R = gʳ mod p</strong>. R commits to r without revealing the secret x.',
  2: 'The verifier replies with a fresh random challenge <strong>c</strong> — unpredictable, so the prover cannot have prepared an answer in advance.',
  3: 'The prover responds <strong>s = (r + c·x) mod (p−1)</strong>, blending the secret x with the random r so x never appears in the open.',
  4: 'The verifier checks <strong>gˢ ≡ R·yᶜ (mod p)</strong>. It balances only if the prover truly knew x — yet x was never sent.'
};

function setNarration(html) {
  const element = document.getElementById('s-narration');
  if (element) {
    element.innerHTML = html;
  }
}

// Let the visitor change the secret and watch the public key recompute, so the
// relationship y = g^x mod p becomes tangible rather than a fixed constant.
function schnorrSetSecret() {
  secretX = parseInt(document.getElementById('s-x-select').value, 10);
  pubY = modpow(5, secretX, 2053);
  document.getElementById('s-x-val').textContent = secretX;
  document.getElementById('s-y-val').textContent = pubY;
  document.getElementById('s-prover-x').textContent = secretX;
  document.getElementById('s-x-f').textContent = secretX;
  schnorrReset();
}
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

function hideLeakPanel() {
  const panel = document.getElementById('s-leak');
  if (panel) {
    panel.style.display = 'none';
    panel.innerHTML = '';
  }
}

function schnorrSetControls() {
  document.getElementById('s-btn').disabled = schnorrBusy;
  document.getElementById('s-step-btn').disabled = schnorrBusy;
  document.getElementById('s-cheat-btn').disabled = schnorrBusy;
  document.getElementById('s-reset-btn').disabled = schnorrBusy;
  document.getElementById('s-copy-btn').disabled = schnorrBusy || !lastSchnorrTranscript;
  document.getElementById('s-replay-btn').disabled = schnorrBusy || !lastSchnorrTranscript;
  document.getElementById('s-leak-btn').disabled = schnorrBusy || !lastRun;
}

function updateStepButton() {
  const phase = stepRun ? stepRun.phase : 0;
  document.getElementById('s-step-btn').textContent = phase >= 4 ? 'Step ▷ (restart)' : `Step ▷ (${phase}/4)`;
}

// Advance the protocol one step per click so the four phases can be read at
// the user's own pace. A completed run restarts with fresh randomness.
export function schnorrStep() {
  if (schnorrBusy) {
    return;
  }
  if (!stepRun || stepRun.phase >= 4) {
    const r = nextInt(1, 2051);
    const R = schnorrVerify({ g: 5, p: 2053, y: 1, R: 1, c: 0, s: r }).lhs;
    const c = nextInt(1, 50);
    const s = ((r + c * secretX) % 2052 + 2052) % 2052;
    const { lhs, rhs, ok } = schnorrVerify({ g: 5, p: 2053, y: pubY, R, c, s });
    stepRun = { r, R, c, s, lhs, rhs, ok, phase: 0 };
    ['s2', 's3', 's4'].forEach(id => {
      document.getElementById(id).style.display = 'none';
    });
    hideLeakPanel();
    document.getElementById('s-result').textContent = '';
  }
  stepRun.phase += 1;
  setNarration(NARRATION[stepRun.phase]);
  if (stepRun.phase === 1) {
    document.getElementById('s-r').textContent = stepRun.r;
    document.getElementById('s-r2').textContent = stepRun.r;
    document.getElementById('s-R').textContent = stepRun.R;
    document.getElementById('s-r3').textContent = stepRun.r;
    addLog('s-log', `Step 1 — commitment R = g^r mod p = ${stepRun.R}`, 'le');
  } else if (stepRun.phase === 2) {
    document.getElementById('s-c').textContent = stepRun.c;
    document.getElementById('s-c2').textContent = stepRun.c;
    document.getElementById('s2').style.display = '';
    addLog('s-log', `Step 2 — verifier challenge c = ${stepRun.c}`, 'le');
  } else if (stepRun.phase === 3) {
    document.getElementById('s-s').textContent = stepRun.s;
    document.getElementById('s3').style.display = '';
    addLog('s-log', `Step 3 — response s = (r + c·x) mod (p−1) = ${stepRun.s}`, 'le');
  } else if (stepRun.phase === 4) {
    document.getElementById('s-lhs').textContent = stepRun.lhs;
    document.getElementById('s-rhs').textContent = stepRun.rhs;
    document.getElementById('s4').style.display = '';
    // The verdict is read off the verifier's own comparison of lhs and rhs, so
    // a broken response would show FAILED here rather than a canned success.
    if (stepRun.ok) {
      document.getElementById('s-result').innerHTML = `<span style="color:var(--ok)">✓ VERIFIED — ${stepRun.lhs} = ${stepRun.rhs}</span>`;
      schnorrN += 1;
      setConf('s-fill', 's-pct', schnorrN, 1 / 50);
      addLog('s-log', `Step 4 — g^s mod p = ${stepRun.lhs} = R·y^c ✓`, 'lok');
      celebrate('s-result');
    } else {
      document.getElementById('s-result').innerHTML = `<span style="color:var(--err)">✗ FAILED — ${stepRun.lhs} ≠ ${stepRun.rhs}</span>`;
      addLog('s-log', `Step 4 — g^s mod p = ${stepRun.lhs} ≠ R·y^c = ${stepRun.rhs} ✗`, 'lerr');
      flashFail('s-result');
    }
    lastSchnorrTranscript = buildTranscript({ cheat: false, ...stepRun });
    persistTranscript(lastSchnorrTranscript);
  }
  updateStepButton();
  schnorrSetControls();
}

// A real Schnorr transcript is exactly (R, c, s). The nonce r is the prover's
// private scratch value and never crosses the wire: publishing it next to s
// hands over the private key, because s = (r + c·x) mod (p−1) then solves for
// x. So r is deliberately absent from everything that is stored, copied, or
// replayed here — what leaves this exhibit is what a verifier actually sees.
// The "Leak the nonce" control below adds it back on purpose to show the
// recovery happening, and that path is the only one that ever exposes r.
function buildTranscript({ cheat, r, R, c, s, lhs, rhs, ok }) {
  lastRun = { cheat, r, R, c, s, ok };
  return {
    protocol: 'Schnorr Identification',
    mode: cheat ? 'cheat-simulation' : 'honest-proof',
    educationalParameters: true,
    parameters: { p: 2053, g: 5, y: pubY },
    seed: scenarioSeed,
    transcript: { R, c, s, lhs, rhs, verified: ok },
    note: 'Real browser-side modular arithmetic with intentionally tiny educational parameters. The prover nonce r is intentionally omitted: a verifier never sees it, and anyone holding it could recover the private key from s.'
  };
}

// The lesson behind the omission: put r back into the transcript and the
// "zero-knowledge" property collapses on the spot. Everything shown here is
// computed from the run's own (r, c, s) — nothing is asserted.
export function schnorrLeakNonce() {
  if (schnorrBusy || !lastRun) {
    return;
  }
  const { r, R, c, s } = lastRun;
  const leaked = {
    warning: 'NOT A REAL SCHNORR TRANSCRIPT — the prover nonce r must never be published.',
    parameters: { p: 2053, g: 5, y: pubY },
    transcript: { R, c, s, r }
  };
  const recovered = recoverSchnorrSecret({ r, c, s, y: pubY });
  const panel = document.getElementById('s-leak');
  const congruence = `c·x ≡ (s − r) (mod p−1) → ${c}·x ≡ (${s} − ${r}) ≡ ${(((s - r) % 2052) + 2052) % 2052} (mod 2052)`;
  const outcome = recovered.length > 0
    ? `<div style="color:var(--err);margin-top:6px"><strong>Private key recovered: x = ${recovered.join(' or ')}.</strong> Compare it with the secret x in the parameter box above — the proof just stopped being zero-knowledge.</div>`
    : '<div style="color:var(--warn);margin-top:6px"><strong>No x satisfies the congruence.</strong> This was a cheat run: the prover guessed s rather than deriving it, so there is no private key to recover — and no valid proof either.</div>';
  panel.innerHTML = `<strong>Nonce leaked on purpose.</strong> A transcript that carries r looks like this:<pre style="white-space:pre-wrap;word-break:break-all;margin:6px 0;font-size:11px">${JSON.stringify(leaked, null, 2)}</pre><div><code>${congruence}</code></div>${outcome}<div style="margin-top:6px">This is why the transcript this exhibit stores, copies, and replays contains only <code>(R, c, s)</code>.</div>`;
  panel.style.display = '';
  addLog('s-log', recovered.length > 0 ? `LEAKED r=${r} → recovered x=${recovered.join('/')}` : `LEAKED r=${r} → no x satisfies the congruence (cheat run)`, 'lerr');
  flashFail('s-leak');
}

function persistTranscript(transcript) {
  localStorage.setItem('zkpl:last:schnorr', JSON.stringify(transcript));
}

export async function schnorrRun(cheat) {
  if (schnorrBusy) {
    return;
  }
  schnorrBusy = true;
  stepRun = null;
  updateStepButton();
  schnorrSetControls();
  try {
    ['s2', 's3', 's4'].forEach(id => {
      document.getElementById(id).style.display = 'none';
    });
    hideLeakPanel();
    document.getElementById('s-result').textContent = '';
    const r = nextInt(1, 2051);
    const R = schnorrVerify({ g: 5, p: 2053, y: 1, R: 1, c: 0, s: r }).lhs;
    document.getElementById('s-r').textContent = r;
    document.getElementById('s-r2').textContent = r;
    document.getElementById('s-R').textContent = R;
    document.getElementById('s-r3').textContent = r;
    setNarration(NARRATION[1]);
    await sleep(350);
    const c = nextInt(1, 50);
    document.getElementById('s-c').textContent = c;
    document.getElementById('s-c2').textContent = c;
    document.getElementById('s2').style.display = '';
    setNarration(NARRATION[2]);
    await sleep(350);
    const s = cheat ? nextInt(1, 2051) : ((r + c * secretX) % 2052 + 2052) % 2052;
    document.getElementById('s-s').textContent = s;
    document.getElementById('s3').style.display = '';
    setNarration(cheat ? 'A cheating prover has no valid x, so it must guess a response <strong>s</strong> and hope the equation balances.' : NARRATION[3]);
    await sleep(350);
    const { lhs, rhs, ok } = schnorrVerify({ g: 5, p: 2053, y: pubY, R, c, s });
    document.getElementById('s-lhs').textContent = lhs;
    document.getElementById('s-rhs').textContent = rhs;
    document.getElementById('s4').style.display = '';
    const result = document.getElementById('s-result');
    if (ok) {
      result.innerHTML = '<span style="color:var(--ok)">✓ VERIFIED — values match</span>';
      if (!cheat) {
        schnorrN += 1;
        setConf('s-fill', 's-pct', schnorrN, 1 / 50);
        celebrate('s-result');
      }
      addLog('s-log', `g^${s} mod p = ${lhs} = R·y^c ✓`, 'lok');
      setNarration(NARRATION[4]);
    } else {
      result.innerHTML = `<span style="color:var(--err)">✗ FAILED — ${lhs} ≠ ${rhs}</span>`;
      addLog('s-log', `CHEAT: g^s=${lhs} ≠ R·y^c=${rhs} → CAUGHT`, 'lerr');
      flashFail('s-result');
      setNarration('Rejected: <strong>gˢ ≠ R·yᶜ</strong>. Without the real secret x the response cannot satisfy the verifier — soundness holds.');
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
  stepRun = null;
  lastRun = null;
  hideLeakPanel();
  updateStepButton();
  ['s-r', 's-r2', 's-R', 's-r3', 's-c', 's-c2', 's-s', 's-lhs', 's-rhs'].forEach(id => {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = '?';
    }
  });
  document.getElementById('s-result').textContent = '';
  ['s2', 's3', 's4'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  document.getElementById('s-fill').style.width = '0%';
  document.getElementById('s-pct').textContent = '0.00%';
  document.getElementById('s-log').innerHTML = '<span class="le">— protocol log —</span>';
  setNarration(DEFAULT_NARRATION);
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
document.getElementById('s-step-btn').addEventListener('click', schnorrStep);
document.getElementById('s-cheat-btn').addEventListener('click', () => schnorrRun(true));
document.getElementById('s-copy-btn').addEventListener('click', schnorrCopyTranscript);
document.getElementById('s-replay-btn').addEventListener('click', schnorrReplayInLab);
document.getElementById('s-leak-btn').addEventListener('click', schnorrLeakNonce);
document.getElementById('s-reset-btn').addEventListener('click', schnorrReset);
document.getElementById('s-x-select').addEventListener('change', schnorrSetSecret);

if (autoScenario) {
  setTimeout(() => {
    schnorrRun(scenarioMode === 'cheat');
  }, 0);
}
