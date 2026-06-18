import { addLog, modpow, sha256hex, schnorrVerify, confidencePercent, cheatProbabilityPercent } from '../js/utils.js';

async function run() {
  const tests = [
    ['modpow computes 5^17 mod 2053', () => modpow(5, 17, 2053) === 375],
    ['Schnorr honest verification passes', () => {
      const r = 123;
      const c = 9;
      const s = (r + c * 17) % 2052;
      const R = modpow(5, r, 2053);
      return schnorrVerify({ g: 5, p: 2053, y: 375, R, c, s }).ok;
    }],
    ['Schnorr cheat verification fails', () => {
      const R = modpow(5, 123, 2053);
      return !schnorrVerify({ g: 5, p: 2053, y: 375, R, c: 9, s: 222 }).ok;
    }],
    ['Confidence math matches cave formula', () => confidencePercent(10, 0.5).toFixed(2) === '99.90'],
    ['Cheat probability matches graph formula', () => cheatProbabilityPercent(10, 5 / 6).toFixed(2) === '16.15'],
    ['SHA-256 matches known hash for abc', async () => (await sha256hex('abc')) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad']
  ];

  if (typeof document !== 'undefined') {
    document.getElementById('test-log').innerHTML = '<span class="le">— protocol test log —</span>';
  } else {
    console.log('— protocol test log —');
  }

  let passed = 0;
  for (const [name, testFn] of tests) {
    try {
      const ok = await testFn();
      if (!ok) {
        throw new Error('assertion failed');
      }
      passed += 1;
      if (typeof document !== 'undefined') {
        addLog('test-log', `PASS: ${name}`, 'lok');
      } else {
        console.log(`PASS: ${name}`);
      }
    } catch (error) {
      if (typeof document !== 'undefined') {
        addLog('test-log', `FAIL: ${name} (${error.message})`, 'lerr');
      } else {
        console.error(`FAIL: ${name} (${error.message})`);
      }
    }
  }

  if (typeof document !== 'undefined') {
    addLog('test-log', `${passed}/${tests.length} tests passed`, passed === tests.length ? 'lok' : 'lacc');
  } else {
    console.log(`${passed}/${tests.length} tests passed`);
    if (passed !== tests.length && typeof process !== 'undefined') process.exit(1);
  }
}

run();
