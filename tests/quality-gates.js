const pages = [
  '../index.html',
  '../exhibits/cave.html',
  '../exhibits/graph-coloring.html',
  '../exhibits/schnorr.html',
  '../exhibits/commit-reveal.html',
  '../exhibits/fiat-shamir.html',
  '../exhibits/snark.html',
  '../exhibits/transcript-lab.html',
  '../exhibits/scenario-presets.html'
];

function addLine(text, cls = 'le') {
  if (typeof document !== 'undefined') {
    const line = document.createElement('div');
    line.className = cls;
    line.textContent = text;
    document.getElementById('qg-log').appendChild(line);
  } else {
    console.log(text);
  }
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
  if (typeof document !== 'undefined') {
    document.getElementById('qg-log').innerHTML = '<span class="le">— quality log —</span>';
  } else {
    console.log('— quality log —');
  }
  let passed = 0;
  let total = 0;

  const fs = typeof window === 'undefined' ? await import('fs') : null;
  const path = typeof window === 'undefined' ? await import('path') : null;

  async function fetchText(p) {
    if (typeof fetch !== 'undefined' && typeof window !== 'undefined') {
      return await fetch(p).then(r => r.text());
    } else {
      let resolvedPath = p.replace('../', '');
      return fs.readFileSync(path.resolve(process.cwd(), resolvedPath), 'utf8');
    }
  }

  const cssText = await fetchText('../css/style.css');
  total += 1;
  if (gate(cssText.includes(':focus-visible') && cssText.includes('.trust-banner') && cssText.includes('.resource-link'), 'Visual token baseline selectors exist')) {
    passed += 1;
  }

  const cssHash = await sha256(cssText);
  addLine(`INFO: css/style.css sha256 = ${cssHash.slice(0, 24)}...`, 'lacc');

  for (const page of pages) {
    const html = await fetchText(page);
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
  if (typeof document !== 'undefined') {
    document.getElementById('qg-result').innerHTML = ok
      ? `<strong style="color:var(--ok)">Quality gates passed.</strong> ${passed}/${total} checks succeeded.`
      : `<strong style="color:var(--err)">Quality gates found issues.</strong> ${passed}/${total} checks succeeded.`;
  } else {
    console.log(ok ? `Quality gates passed. ${passed}/${total} checks succeeded.` : `Quality gates found issues. ${passed}/${total} checks succeeded.`);
    if (!ok && typeof process !== 'undefined') process.exit(1);
  }
}

if (typeof document !== 'undefined') {
  document.getElementById('run-qg-btn').addEventListener('click', runChecks);
} else {
  runChecks().catch(console.error);
}
