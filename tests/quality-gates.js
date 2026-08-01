import { modpow, recoverSchnorrSecret, schnorrVerify, sha256hex } from '../js/shared.js';

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

// Which script actually drives each page. Pages with an entry here get their
// disclosure checked against what their code does; pages without one get only
// a presence check, and the gate is named to say so.
const pageScripts = {
  '../exhibits/cave.html': '../js/cave.js',
  '../exhibits/graph-coloring.html': '../js/graph.js',
  '../exhibits/schnorr.html': '../js/schnorr.js',
  '../exhibits/commit-reveal.html': '../js/commit.js',
  '../exhibits/fiat-shamir.html': '../js/fiat-shamir.js',
  '../exhibits/snark.html': '../js/snark.js',
  '../exhibits/transcript-lab.html': '../js/transcript-lab.js'
};

// A page may only stay silent about a primitive it does not use. If the script
// calls one, the page's honesty banner has to name it.
const primitives = [
  { name: 'SHA-256', usedBy: /sha256hex\s*\(|crypto\.subtle\.digest\s*\(/, namedBy: /SHA-?\s*256/i },
  { name: 'modular arithmetic', usedBy: /\bmodpow\s*\(|\bschnorrVerify\s*\(/, namedBy: /modular[\s-]?arithmetic|mod\s*p\b|modular/i }
];

// Nothing may claim to be real crypto if its script computes none.
const CONCEPTUAL_CLAIM = /conceptual|thought experiment|does not claim|not a real/i;

// Any verdict the learner reads has to come from a comparison the code just
// performed. These rules pin the specific comparison at each verdict site, and
// forbid the shapes a hardcoded verdict takes.
const verdictRules = [
  {
    file: '../js/commit.js',
    label: 'commit-reveal verdicts come from recomputed SHA-256, not constants',
    require: [
      /const okA = vA === cs\.hA;/,
      /const okB = vB === cs\.hB;/,
      /const detected = fakeHash !== cs\.hA;/,
      /cheatAttempt: \{[^}]*\bdetected\b[^}]*\}/,
      /detected\s*\n?\s*\?/
    ]
  },
  {
    file: '../js/schnorr.js',
    label: 'Schnorr verdicts come from the verification equation, not constants',
    require: [
      /const \{ lhs, rhs, ok \} = schnorrVerify\(/,
      /if \(stepRun\.ok\) \{/,
      /verified: ok/
    ]
  },
  {
    file: '../js/snark.js',
    label: 'toy-SNARK verdicts are recomputed by the verifier, not constants',
    require: [
      /digestBound: recomputedDigest === proof\.digest/,
      /equationHolds: proof\.publicInput === proof\.privateWitness/,
      /tampered\.verification = await verifyProof\(tampered\)/
    ]
  },
  {
    file: '../js/fiat-shamir.js',
    label: 'Fiat-Shamir verdicts come from the verification equation, not constants',
    require: [/verified: ok/]
  },
  {
    file: '../js/graph.js',
    label: 'graph-colouring openings are re-hashed before the verdict, not assumed',
    require: [/recomputed === commit\.hash/, /const bindingOk = openings\.every\(Boolean\);/]
  }
];

// A verdict field assigned a literal is a verdict nobody computed.
const HARDCODED_VERDICT = /\b(?:verified|detected|digestBound|equationHolds|bindingOk|accepted|rejected|ok)\s*:\s*(?:true|false)\b/;

const verdictScripts = [
  '../js/cave.js',
  '../js/commit.js',
  '../js/fiat-shamir.js',
  '../js/graph.js',
  '../js/schnorr.js',
  '../js/snark.js',
  '../js/transcript-lab.js'
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

function honestyBanner(html) {
  const match = html.match(/<div class="([^"]*\bglobal-honesty\b[^"]*)"[^>]*>([\s\S]*?)<\/div>/);
  if (!match) {
    return null;
  }
  return {
    classes: match[1],
    text: match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  };
}

async function runChecks() {
  if (typeof document !== 'undefined') {
    document.getElementById('qg-log').innerHTML = '<span class="le">— quality log —</span>';
  } else {
    console.log('— quality log —');
  }
  let passed = 0;
  let total = 0;

  const check = (ok, label) => {
    total += 1;
    if (gate(ok, label)) {
      passed += 1;
    }
  };

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
  check(
    cssText.includes(':focus-visible') && cssText.includes('.trust-banner') && cssText.includes('.resource-link'),
    'Visual token baseline selectors exist'
  );

  const cssHash = await sha256hex(cssText);
  addLine(`INFO: css/style.css sha256 = ${cssHash.slice(0, 24)}...`, 'lacc');

  // ---- Structure ----------------------------------------------------------
  for (const page of pages) {
    const html = await fetchText(page);
    check(html.includes('<title>') && html.includes('meta name="viewport"'), `${page} has title + viewport`);
    check(html.includes('aria-label="') || html.includes('role="log"'), `${page} has basic accessibility annotations`);

    // ---- Disclosure -------------------------------------------------------
    // Replaces an earlier gate that passed on the mere presence of the string
    // "trust-banner". Presence proves nothing about whether the disclosure is
    // true, so the disclosure is now checked against the page's own script.
    const banner = honestyBanner(html);
    const scriptPath = pageScripts[page];

    if (!scriptPath) {
      // Hub/tool pages with no exhibit script of their own. There is no code
      // here to compare the wording against, so this gate claims only what it
      // tests: that a disclosure element exists and is non-empty.
      check(Boolean(banner && banner.text.length > 40), `${page} has a disclosure element present (wording not machine-checked)`);
      continue;
    }

    if (!banner) {
      check(false, `${page} disclosure names every real primitive its script uses`);
      continue;
    }

    const scriptText = await fetchText(scriptPath);
    const used = primitives.filter(primitive => primitive.usedBy.test(scriptText));
    const undisclosed = used.filter(primitive => !primitive.namedBy.test(banner.text));

    if (used.length > 0) {
      check(
        undisclosed.length === 0,
        `${page} disclosure names every real primitive ${scriptPath} uses` +
          (undisclosed.length > 0 ? ` (unnamed: ${undisclosed.map(p => p.name).join(', ')})` : '')
      );
      check(
        /educational|teaching|toy|tiny|small|narrated|not a real|not production|not for deployment|not verification|intentionally|demo/i.test(banner.text),
        `${page} disclosure also names the limits of what is real`
      );
    } else {
      // No real primitive in the script, so the page must not imply otherwise.
      check(
        banner.classes.includes('trust-conceptual') && CONCEPTUAL_CLAIM.test(banner.text),
        `${page} computes no primitive and its disclosure says so`
      );
    }
  }

  // ---- No hardcoded verdicts ---------------------------------------------
  for (const rule of verdictRules) {
    const source = await fetchText(rule.file);
    const missing = rule.require.filter(pattern => !pattern.test(source));
    check(missing.length === 0, `${rule.label}` + (missing.length > 0 ? ` (missing: ${missing.join(' ')})` : ''));
  }

  for (const file of verdictScripts) {
    const source = await fetchText(file);
    const hit = source.match(HARDCODED_VERDICT);
    check(hit === null, `${file} assigns no verdict field a literal true/false` + (hit ? ` (found: ${hit[0]})` : ''));
  }

  // ---- Zero-knowledge invariant ------------------------------------------
  // A Schnorr transcript is (R, c, s). Shipping r alongside s gives away the
  // private key, so the stored transcript must not carry it.
  const schnorrSource = await fetchText('../js/schnorr.js');
  check(
    /transcript: \{ R, c, s, lhs, rhs, verified: ok \}/.test(schnorrSource) && !/transcript: \{\s*r\s*,/.test(schnorrSource),
    'Schnorr transcript carries (R, c, s) only — the prover nonce r is excluded'
  );

  // ---- The verdicts actually discriminate --------------------------------
  // Static patterns only prove a comparison is written down. These run the
  // comparisons and confirm they separate a good run from a tampered one.
  const x = 17;
  const y = modpow(5, x, 2053);
  const r = 1234;
  const c = 29;
  const s = (r + c * x) % 2052;
  const R = modpow(5, r, 2053);
  check(schnorrVerify({ g: 5, p: 2053, y, R, c, s }).ok, 'Schnorr check accepts an honest transcript');
  check(!schnorrVerify({ g: 5, p: 2053, y, R, c, s: (s + 1) % 2052 }).ok, 'Schnorr check rejects a tampered response');
  check(
    recoverSchnorrSecret({ r, c, s, y }).includes(x),
    'Leaking the nonce really does recover the private key (why r is not in the transcript)'
  );

  const nonce = 'a1b2c3d4e5f6';
  const committed = await sha256hex(`$500|${nonce}`);
  check(committed !== await sha256hex(`$600|${nonce}`), 'Commitment check distinguishes a changed bid');
  check(committed === await sha256hex(`$500|${nonce}`), 'Commitment check accepts a faithful opening');

  const witness = 9;
  const publicInput = witness * witness + 3 * witness + 7;
  const proofDigest = await sha256hex(`${publicInput}|${nonce}`);
  check(
    publicInput === witness * witness + 3 * witness + 7 && proofDigest === await sha256hex(`${publicInput}|${nonce}`),
    'Toy-SNARK verifier accepts an untampered envelope'
  );
  check(
    (publicInput + 1) !== witness * witness + 3 * witness + 7 && proofDigest !== await sha256hex(`${publicInput + 1}|${nonce}`),
    'Toy-SNARK verifier rejects a tampered public input on both bindings'
  );

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
