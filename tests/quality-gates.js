const pages = [
  '../index.html',
  '../exhibits/cave.html',
  '../exhibits/graph-coloring.html',
  '../exhibits/schnorr.html',
  '../exhibits/commit-reveal.html',
  '../exhibits/fiat-shamir.html',
  '../exhibits/transcript-lab.html'
];

function addLine(text, cls = 'le') {
  const line = document.createElement('div');
  line.className = cls;
  line.textContent = text;
  document.getElementById('qg-log').appendChild(line);
}

function gate(ok, label) {
  addLine(`${ok ? 'PASS' : 'FAIL'}: ${label}`, ok ? 'lok' : 'lerr');
  return ok;
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function runChecks() {
  document.getElementById('qg-log').innerHTML = '<span class="le">— quality log —</span>';
  let passed = 0;
  let total = 0;

  const cssText = await fetch('../css/style.css').then(r => r.text());
  total += 1;
  if (gate(cssText.includes(':focus-visible') && cssText.includes('.trust-banner') && cssText.includes('.resource-link'), 'Visual token baseline selectors exist')) {
    passed += 1;
  }

  const cssHash = await sha256(cssText);
  addLine(`INFO: css/style.css sha256 = ${cssHash.slice(0, 24)}...`, 'lacc');

  for (const page of pages) {
    const html = await fetch(page).then(r => r.text());
    total += 1;
    if (gate(html.includes('<title>') && html.includes('meta name="viewport"'), `${page} has title + viewport`)) {
      passed += 1;
    }

    total += 1;
    if (gate(html.includes('aria-label="') || html.includes('role="log"'), `${page} has basic accessibility annotations`)) {
      passed += 1;
    }

    total += 1;
    if (gate(html.includes('trust-banner') || page.endsWith('quality-gates.html'), `${page} has trust messaging or is a test utility page`)) {
      passed += 1;
    }
  }

  const ok = passed === total;
  document.getElementById('qg-result').innerHTML = ok
    ? `<strong style="color:var(--ok)">Quality gates passed.</strong> ${passed}/${total} checks succeeded.`
    : `<strong style="color:var(--err)">Quality gates found issues.</strong> ${passed}/${total} checks succeeded.`;
}

document.getElementById('run-qg-btn').addEventListener('click', runChecks);
