import {
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
} from './shared.js';

let cs = { phase: 'idle', bidA: 0, bidB: 0, nA: '', nB: '', hA: '', hB: '' };
let commitBusy = false;
let lastCommitTranscript = null;
const scenarioSeed = readSeedFromUrl();
const scenarioMode = readModeFromUrl();
const autoScenario = readAutoFromUrl();
const seededRng = scenarioSeed ? createSeededRng(`commit:${scenarioSeed}`) : null;

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

function commitSetControls() {
  document.getElementById('c-btn-commit').disabled = commitBusy || cs.phase !== 'idle';
  document.getElementById('c-btn-reveal').disabled = commitBusy || cs.phase !== 'committed';
  document.getElementById('c-btn-cheat').disabled = commitBusy || cs.phase !== 'committed';
  document.getElementById('c-btn-copy').disabled = commitBusy || !lastCommitTranscript;
  document.getElementById('c-btn-replay').disabled = commitBusy || !lastCommitTranscript;
  document.getElementById('c-btn-reset').disabled = commitBusy;
}

function buildCommitTranscript(extra = {}) {
  return {
    protocol: 'Hash Commit-Reveal',
    educationalScenario: 'sealed-bid auction',
    seed: scenarioSeed,
    phase: cs.phase,
    bidderA: { hash: cs.hA },
    bidderB: { hash: cs.hB },
    ...extra
  };
}

function persistCommitTranscript(transcript) {
  localStorage.setItem('zkpl:last:commit', JSON.stringify(transcript));
}

export async function commitPhase() {
  if (commitBusy || cs.phase !== 'idle') {
    return;
  }
  commitBusy = true;
  commitSetControls();
  try {
    cs.bidA = nextInt(100, 999);
    cs.bidB = nextInt(100, 999);
    cs.nA = nextHex(32);
    cs.nB = nextHex(32);
    document.getElementById('ca-bid').textContent = '*** (hidden)';
    document.getElementById('cb-bid').textContent = '*** (hidden)';
    document.getElementById('ca-nonce').textContent = 'Withheld until opening';
    document.getElementById('cb-nonce').textContent = 'Withheld until opening';
    document.getElementById('ca-hash').textContent = 'Computing SHA-256…';
    document.getElementById('cb-hash').textContent = 'Computing SHA-256…';
    document.getElementById('ca-verify').textContent = '';
    document.getElementById('cb-verify').textContent = '';
    cs.hA = await sha256hex(`$${cs.bidA}|${cs.nA}`);
    cs.hB = await sha256hex(`$${cs.bidB}|${cs.nB}`);
    document.getElementById('ca-hash').textContent = cs.hA;
    document.getElementById('cb-hash').textContent = cs.hB;
    document.getElementById('commit-result').innerHTML = '<strong style="color:var(--ok)">Both commitments published.</strong> Each bidder’s public record contains only a digest.';
    cs.phase = 'committed';
    narrate('commit-narration', 'Each bidder keeps the bid and nonce until opening. The public transcript now contains the two SHA-256 commitments.');
    lastCommitTranscript = buildCommitTranscript();
    persistCommitTranscript(lastCommitTranscript);
    if (scenarioSeed) {
      // The seed comes from ?seed= in the URL, so it is attacker-supplied: CodeQL
      // flagged this as js/xss (reflected). Built with DOM APIs rather than escaped
      // into a template, because the markup here is fixed and the value is not.
      const result = document.getElementById('commit-result');
      const seedLine = document.createElement('span');
      seedLine.style.color = 'var(--acc2)';
      seedLine.textContent = `Seeded run: ${scenarioSeed}. This public seed reproduces both openings.`;
      result.append(' ', document.createElement('br'), seedLine);
    }
  } finally {
    commitBusy = false;
    commitSetControls();
  }
}

export async function revealPhase() {
  if (commitBusy || cs.phase !== 'committed') {
    return;
  }
  commitBusy = true;
  commitSetControls();
  try {
    cs.phase = 'revealed';
    document.getElementById('ca-bid').textContent = `$${cs.bidA}`;
    document.getElementById('cb-bid').textContent = `$${cs.bidB}`;
    document.getElementById('ca-nonce').textContent = cs.nA;
    document.getElementById('cb-nonce').textContent = cs.nB;
    const vA = await sha256hex(`$${cs.bidA}|${cs.nA}`);
    const vB = await sha256hex(`$${cs.bidB}|${cs.nB}`);
    const okA = vA === cs.hA;
    const okB = vB === cs.hB;
    document.getElementById('ca-verify').innerHTML = `SHA-256 recomputed: <span style="color:${okA ? 'var(--ok)' : 'var(--err)'}">${okA ? '✓ matches commitment' : '✗ MISMATCH'}</span>`;
    document.getElementById('cb-verify').innerHTML = `SHA-256 recomputed: <span style="color:${okB ? 'var(--ok)' : 'var(--err)'}">${okB ? '✓ matches commitment' : '✗ MISMATCH'}</span>`;
    let winner = null;
    if (okA && okB) {
      winner = cs.bidA > cs.bidB ? 'A' : cs.bidB > cs.bidA ? 'B' : 'TIE';
      document.getElementById('commit-result').innerHTML = winner === 'TIE'
        ? `<strong style="color:var(--warn)">Tie — $${cs.bidA} = $${cs.bidB}.</strong> Both commitments verified.`
        : `<strong style="color:var(--ok)">Bidder ${winner} wins</strong> — $${winner === 'A' ? cs.bidA : cs.bidB} vs $${winner === 'A' ? cs.bidB : cs.bidA}. Both bids cryptographically verified.`;
      narrate('commit-narration', 'Both openings match the commitments published before the bids were revealed.');
      celebrate('commit-result');
    } else {
      document.getElementById('commit-result').textContent = 'Opening rejected. No winner can be declared.';
      narrate('commit-narration', 'At least one opening failed to match its published commitment.');
      flashFail('commit-result');
    }
    lastCommitTranscript = buildCommitTranscript({
      bidderA: { hash: cs.hA, bid: cs.bidA, nonce: cs.nA },
      bidderB: { hash: cs.hB, bid: cs.bidB, nonce: cs.nB },
      verification: { bidderA: okA, bidderB: okB },
      winner
    });
    persistCommitTranscript(lastCommitTranscript);
  } finally {
    commitBusy = false;
    commitSetControls();
  }
}

export async function cheatPhase() {
  if (commitBusy || cs.phase !== 'committed') {
    return;
  }
  commitBusy = true;
  commitSetControls();
  try {
    const fake = cs.bidA + 100;
    document.getElementById('ca-bid').textContent = `$${fake} ← changed!`;
    document.getElementById('ca-nonce').textContent = cs.nA;
    const fakeHash = await sha256hex(`$${fake}|${cs.nA}`);
    // The verdict is the verifier's own comparison, not a foregone conclusion:
    // the tamper is "caught" precisely when the recomputed digest differs from
    // the digest published at commit time. A collision would show as NOT CAUGHT.
    const detected = fakeHash !== cs.hA;
    document.getElementById('ca-verify').innerHTML = detected
      ? `SHA-256($${fake} ‖ nonce) =<br><span style="color:var(--err);font-size:10px;word-break:break-all">${fakeHash}</span><br><strong style="color:var(--err)">✗ CAUGHT — recomputed hash ≠ published commitment</strong>`
      : `SHA-256($${fake} ‖ nonce) =<br><span style="color:var(--warn);font-size:10px;word-break:break-all">${fakeHash}</span><br><strong style="color:var(--warn)">⚠ NOT CAUGHT — recomputed hash equals the published commitment</strong>`;
    document.getElementById('commit-result').innerHTML = detected
      ? `<strong style="color:var(--err)">Binding property holds.</strong> Bidder A's revised bid hashes to <code>${fakeHash.slice(0, 16)}…</code>, which does not equal the published <code>${cs.hA.slice(0, 16)}…</code>. Finding any (bid, nonce) pair that produces the same hash is computationally infeasible.`
      : '<strong style="color:var(--warn)">Binding broken.</strong> The revised bid hashed to the published commitment — a SHA-256 collision. If you are reading this, something is very wrong with the browser\'s hash implementation.';
    narrate('commit-narration', detected
      ? 'Bidder A tries to change their bid — but the new value hashes to something completely different, so the tamper is caught.'
      : 'Bidder A changed their bid and the hash still matched, which is what a broken commitment scheme looks like.');
    cs.phase = 'cheated';
    lastCommitTranscript = buildCommitTranscript({ cheatAttempt: { fakeBid: fake, nonce: cs.nA, fakeHash, publishedHash: cs.hA, detected } });
    persistCommitTranscript(lastCommitTranscript);
    flashFail('commit-result');
  } finally {
    commitBusy = false;
    commitSetControls();
  }
}

export function commitReset() {
  if (commitBusy) {
    return;
  }
  cs = { phase: 'idle', bidA: 0, bidB: 0, nA: '', nB: '', hA: '', hB: '' };
  lastCommitTranscript = null;
  ['ca-bid', 'cb-bid', 'ca-nonce', 'cb-nonce', 'ca-hash', 'cb-hash', 'ca-verify', 'cb-verify'].forEach(id => {
    document.getElementById(id).textContent = '—';
  });
  document.getElementById('commit-result').textContent = 'Submit both bids to publish their commitments.';
  narrate('commit-narration', 'Two bidders lock in hidden bids as SHA-256 hashes, then reveal them later. The hash binds each bid so it cannot be changed after the fact.');
  commitSetControls();
}

export async function commitCopyTranscript() {
  if (!lastCommitTranscript) {
    return;
  }
  await copyTextToClipboard(JSON.stringify(lastCommitTranscript, null, 2));
  document.getElementById('commit-result').innerHTML = '<strong style="color:var(--acc2)">Transcript copied.</strong> You can paste the proof trace into notes, docs, or an interview walkthrough.';
}

export function commitReplayInLab() {
  if (!lastCommitTranscript) {
    return;
  }
  localStorage.setItem('zkpl:replay:left', JSON.stringify(lastCommitTranscript));
  window.location.href = 'transcript-lab.html';
}

document.getElementById('c-btn-commit').addEventListener('click', commitPhase);
document.getElementById('c-btn-reveal').addEventListener('click', revealPhase);
document.getElementById('c-btn-cheat').addEventListener('click', cheatPhase);
document.getElementById('c-btn-copy').addEventListener('click', commitCopyTranscript);
document.getElementById('c-btn-replay').addEventListener('click', commitReplayInLab);
document.getElementById('c-btn-reset').addEventListener('click', commitReset);

if (autoScenario) {
  setTimeout(async () => {
    await commitPhase();
    if (scenarioMode === 'reveal') {
      await revealPhase();
    }
    if (scenarioMode === 'cheat') {
      await cheatPhase();
    }
  }, 0);
}
