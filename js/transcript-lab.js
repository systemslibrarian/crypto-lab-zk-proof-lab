function readJson(id) {
  const raw = document.getElementById(id).value.trim();
  if (!raw) {
    return null;
  }
  return JSON.parse(raw);
}

function formatView(transcript) {
  if (!transcript) {
    return 'No transcript loaded.';
  }
  const protocol = transcript.protocol || 'Unknown protocol';
  const mode = transcript.mode || transcript.phase || 'n/a';
  const verified = transcript.transcript && typeof transcript.transcript.verified === 'boolean'
    ? transcript.transcript.verified
    : transcript.verification && transcript.verification.bidderA !== undefined
      ? transcript.verification.bidderA && transcript.verification.bidderB
      : null;
  return [
    `Protocol: ${protocol}`,
    `Mode/Phase: ${mode}`,
    `Verified: ${verified === null ? 'n/a' : verified ? 'true' : 'false'}`,
    transcript.note ? `Note: ${transcript.note}` : null
  ].filter(Boolean).join('\n');
}

async function deriveChallengeFromDigestInput(R, y, message) {
  const input = `${R}|${y}|${message}`;
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest)).map(v => v.toString(16).padStart(2, '0')).join('');
  const c = parseInt(hex.slice(0, 8), 16) % 50 + 1;
  return { hex, c };
}

function semanticDiffLines(left, right) {
  const checks = [];
  const leftProtocol = left.protocol || 'Unknown';
  const rightProtocol = right.protocol || 'Unknown';
  checks.push(`<strong>Protocol:</strong> ${leftProtocol} vs ${rightProtocol}`);

  const leftMode = left.mode || left.phase || 'n/a';
  const rightMode = right.mode || right.phase || 'n/a';
  checks.push(`<strong>Mode/Phase:</strong> ${leftMode} vs ${rightMode}`);

  const leftVerified = left.transcript && typeof left.transcript.verified === 'boolean'
    ? left.transcript.verified
    : left.verification && left.verification.bidderA !== undefined
      ? left.verification.bidderA && left.verification.bidderB
      : 'n/a';
  const rightVerified = right.transcript && typeof right.transcript.verified === 'boolean'
    ? right.transcript.verified
    : right.verification && right.verification.bidderA !== undefined
      ? right.verification.bidderA && right.verification.bidderB
      : 'n/a';
  checks.push(`<strong>Verification outcome:</strong> ${leftVerified} vs ${rightVerified}`);

  if (left.transcript && right.transcript) {
    const fields = ['R', 'c', 's', 'lhs', 'rhs'];
    for (const field of fields) {
      if (left.transcript[field] !== undefined || right.transcript[field] !== undefined) {
        const lv = left.transcript[field] ?? 'n/a';
        const rv = right.transcript[field] ?? 'n/a';
        checks.push(`<strong>${field}:</strong> ${lv} vs ${rv}`);
      }
    }
  }

  return checks;
}

async function challengeRederivationLine(transcript, label) {
  if (!transcript || !transcript.protocol || !String(transcript.protocol).includes('Fiat-Shamir')) {
    return `<strong>${label} challenge re-derivation:</strong> n/a`;
  }
  if (!transcript.transcript || transcript.transcript.R === undefined || transcript.parameters?.y === undefined || transcript.message === undefined) {
    return `<strong>${label} challenge re-derivation:</strong> insufficient fields`;
  }
  const { c } = await deriveChallengeFromDigestInput(transcript.transcript.R, transcript.parameters.y, transcript.message);
  const matches = c === transcript.transcript.c;
  return `<strong>${label} challenge re-derivation:</strong> computed ${c}, transcript ${transcript.transcript.c} (${matches ? 'match' : 'mismatch'})`;
}

function tamperTimelineLines(transcript, label) {
  if (!transcript) {
    return [`<strong>${label} tamper timeline:</strong> n/a`];
  }
  const out = [];
  if (transcript.cheatAttempt) {
    out.push(`<strong>${label} tamper timeline:</strong> commitment tamper attempt detected (${transcript.cheatAttempt.detected ? 'detected' : 'undetected'})`);
  } else if (transcript.mode === 'cheat-simulation') {
    out.push(`<strong>${label} tamper timeline:</strong> Schnorr cheat simulation present`);
  } else if (transcript.note && String(transcript.note).toLowerCase().includes('tamper')) {
    out.push(`<strong>${label} tamper timeline:</strong> note includes tamper path`);
  } else {
    out.push(`<strong>${label} tamper timeline:</strong> no tamper events recorded`);
  }
  return out;
}

function render(side, transcript) {
  document.getElementById(`${side}-view`).textContent = formatView(transcript);
}

function flattenObject(value, prefix = '', out = {}) {
  if (value === null || typeof value !== 'object') {
    out[prefix || 'root'] = value;
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const key = prefix ? `${prefix}[${index}]` : `[${index}]`;
      flattenObject(item, key, out);
    });
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    const next = prefix ? `${prefix}.${key}` : key;
    flattenObject(child, next, out);
  }
  return out;
}

function renderDelta(left, right) {
  if (!left || !right) {
    document.getElementById('delta-view').textContent = 'Delta output will appear here after comparison.';
    return;
  }
  const leftFlat = flattenObject(left);
  const rightFlat = flattenObject(right);
  const keys = Array.from(new Set([...Object.keys(leftFlat), ...Object.keys(rightFlat)])).sort();
  const diffs = [];
  for (const key of keys) {
    const l = leftFlat[key];
    const r = rightFlat[key];
    if (JSON.stringify(l) !== JSON.stringify(r)) {
      diffs.push(`${key}\n  L: ${JSON.stringify(l)}\n  R: ${JSON.stringify(r)}`);
    }
  }
  document.getElementById('delta-view').textContent = diffs.length > 0
    ? diffs.join('\n\n')
    : 'No field-level differences detected.';
}

function loadStored(key, targetId, side) {
  const raw = localStorage.getItem(key);
  if (!raw) {
    document.getElementById(`${side}-view`).textContent = `No transcript found at ${key}`;
    return;
  }
  document.getElementById(targetId).value = raw;
  try {
    render(side, JSON.parse(raw));
  } catch {
    document.getElementById(`${side}-view`).textContent = 'Stored transcript is not valid JSON.';
  }
}

async function compareTranscripts() {
  let left;
  let right;
  try {
    left = readJson('left-input');
    right = readJson('right-input');
  } catch {
    document.getElementById('compare-result').innerHTML = '<strong style="color:var(--err)">Invalid JSON.</strong> Ensure both transcripts are valid before comparing.';
    return;
  }
  render('left', left);
  render('right', right);
  if (!left || !right) {
    document.getElementById('compare-result').innerHTML = '<strong style="color:var(--warn)">Comparison incomplete.</strong> Load both left and right transcripts.';
    renderDelta(left, right);
    return;
  }

  const lines = semanticDiffLines(left, right);
  lines.push(await challengeRederivationLine(left, 'Left'));
  lines.push(await challengeRederivationLine(right, 'Right'));
  lines.push(...tamperTimelineLines(left, 'Left'));
  lines.push(...tamperTimelineLines(right, 'Right'));
  lines.push('<strong>Tip:</strong> for Fiat-Shamir transcripts, challenge mismatches usually indicate message or commitment tampering.');
  document.getElementById('compare-result').innerHTML = lines.join('<br>');
  renderDelta(left, right);
}

function swapSides() {
  const left = document.getElementById('left-input').value;
  const right = document.getElementById('right-input').value;
  document.getElementById('left-input').value = right;
  document.getElementById('right-input').value = left;
  try {
    render('left', right ? JSON.parse(right) : null);
  } catch {
    document.getElementById('left-view').textContent = 'Right JSON could not be parsed after swap.';
  }
  try {
    render('right', left ? JSON.parse(left) : null);
  } catch {
    document.getElementById('right-view').textContent = 'Left JSON could not be parsed after swap.';
  }
}

function clearAll() {
  document.getElementById('left-input').value = '';
  document.getElementById('right-input').value = '';
  document.getElementById('left-view').textContent = 'No transcript loaded.';
  document.getElementById('right-view').textContent = 'No transcript loaded.';
  document.getElementById('compare-result').textContent = 'Comparison output will appear here.';
  document.getElementById('delta-view').textContent = 'Delta output will appear here after comparison.';
}

async function copyReport() {
  const text = document.getElementById('compare-result').textContent.trim();
  if (!text || text === 'Comparison output will appear here.') {
    return;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    document.getElementById('compare-result').innerHTML += '<br><strong>Report copied to clipboard.</strong>';
  }
}

document.getElementById('left-load-schnorr').addEventListener('click', () => loadStored('zkpl:last:schnorr', 'left-input', 'left'));
document.getElementById('left-load-commit').addEventListener('click', () => loadStored('zkpl:last:commit', 'left-input', 'left'));
document.getElementById('left-load-fs').addEventListener('click', () => loadStored('zkpl:last:fiat-shamir', 'left-input', 'left'));
document.getElementById('left-load-snark').addEventListener('click', () => loadStored('zkpl:last:snark', 'left-input', 'left'));
document.getElementById('right-load-schnorr').addEventListener('click', () => loadStored('zkpl:last:schnorr', 'right-input', 'right'));
document.getElementById('right-load-commit').addEventListener('click', () => loadStored('zkpl:last:commit', 'right-input', 'right'));
document.getElementById('right-load-fs').addEventListener('click', () => loadStored('zkpl:last:fiat-shamir', 'right-input', 'right'));
document.getElementById('right-load-snark').addEventListener('click', () => loadStored('zkpl:last:snark', 'right-input', 'right'));
document.getElementById('compare-btn').addEventListener('click', compareTranscripts);
document.getElementById('copy-report-btn').addEventListener('click', copyReport);
document.getElementById('swap-btn').addEventListener('click', swapSides);
document.getElementById('clear-btn').addEventListener('click', clearAll);

const prefillLeft = localStorage.getItem('zkpl:replay:left');
if (prefillLeft) {
  document.getElementById('left-input').value = prefillLeft;
  try {
    render('left', JSON.parse(prefillLeft));
  } catch {
    document.getElementById('left-view').textContent = 'Prefilled transcript is invalid JSON.';
  }
  localStorage.removeItem('zkpl:replay:left');
}
