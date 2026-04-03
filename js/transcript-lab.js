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

function render(side, transcript) {
  document.getElementById(`${side}-view`).textContent = formatView(transcript);
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

function compareTranscripts() {
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
    return;
  }

  const leftProtocol = left.protocol || 'Unknown';
  const rightProtocol = right.protocol || 'Unknown';
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

  const sameProtocol = leftProtocol === rightProtocol;
  document.getElementById('compare-result').innerHTML = [
    `<strong>Protocol A:</strong> ${leftProtocol}`,
    `<strong>Protocol B:</strong> ${rightProtocol}`,
    `<strong>Same protocol family:</strong> ${sameProtocol ? 'Yes' : 'No'}`,
    `<strong>Verification outcome A:</strong> ${leftVerified}`,
    `<strong>Verification outcome B:</strong> ${rightVerified}`,
    '<strong>Tip:</strong> compare challenge generation, response structure, and whether verification still holds after tampering.'
  ].join('<br>');
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
}

document.getElementById('left-load-schnorr').addEventListener('click', () => loadStored('zkpl:last:schnorr', 'left-input', 'left'));
document.getElementById('left-load-commit').addEventListener('click', () => loadStored('zkpl:last:commit', 'left-input', 'left'));
document.getElementById('left-load-fs').addEventListener('click', () => loadStored('zkpl:last:fiat-shamir', 'left-input', 'left'));
document.getElementById('right-load-schnorr').addEventListener('click', () => loadStored('zkpl:last:schnorr', 'right-input', 'right'));
document.getElementById('right-load-commit').addEventListener('click', () => loadStored('zkpl:last:commit', 'right-input', 'right'));
document.getElementById('right-load-fs').addEventListener('click', () => loadStored('zkpl:last:fiat-shamir', 'right-input', 'right'));
document.getElementById('compare-btn').addEventListener('click', compareTranscripts);
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
