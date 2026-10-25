// Twelve concrete, replayable patches: six own Exhibit 07's rendered verdicts
// (js/sigma.js) and six own Exhibit 08's sum-check and GKR checks (js/sumcheck.js,
// js/gkr.js). Every run proves the five §4.1c observations and restores the
// source in a finally block. Run from the repository root with
// `npm run test:mutations`, or name one mutation as the first argument.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { assertNormalExit,validateNamedRun } from './mutation-report.mjs';

const SIGMA = { source: 'js/sigma.js', spec: 'e2e/sigma-mutations.spec.ts' };
const SUMCHECK = { source: 'js/sumcheck.js', spec: 'e2e/sumcheck-mutations.spec.ts' };
const GKR = { source: 'js/gkr.js', spec: 'e2e/sumcheck-mutations.spec.ts' };

const mutations = [
  {
    ...SIGMA,
    name: 'Okamoto verifier h term',
    anchor: 'const lhs = modpowBig(params.g, transcript.zAlpha, params.p) * modpowBig(params.h, transcript.zBeta, params.p) % params.p;',
    replacement: 'const lhs = modpowBig(params.g, transcript.zAlpha, params.p) * 1n % params.p;',
    test: 'mutation oracle · Okamoto verification keeps the h term',
  },
  {
    ...SIGMA,
    name: 'Okamoto extraction challenge sign',
    anchor: 'const deltaC = modulo(first.c - second.c, params.q);',
    replacement: 'const deltaC = modulo(second.c - first.c, params.q);',
    test: 'mutation oracle · Okamoto extraction keeps delta-c sign',
  },
  {
    ...SIGMA,
    name: 'transcript multiset entries',
    anchor: 'return left.length === right.length && left.every((entry, index) => entry === right[index]);',
    replacement: 'return left.length === right.length;',
    test: 'mutation oracle · transcript multiset comparison checks entries',
  },
  {
    ...SIGMA,
    name: 'GQ verifier y-to-c term',
    anchor: 'const rhs = transcript.yT * modpowBig(transcript.y, transcript.c, params.N) % params.N;',
    replacement: 'const rhs = transcript.yT;',
    test: 'mutation oracle · GQ verification keeps y-to-c',
  },
  {
    ...SIGMA,
    name: "Shamir extraction coefficient",
    anchor: 'const root = powSigned(first.y, coefficients.x, params.N) * powSigned(deltaX, coefficients.y, params.N) % params.N;',
    replacement: 'const root = powSigned(first.y, coefficients.y, params.N) * powSigned(deltaX, coefficients.y, params.N) % params.N;',
    test: "mutation oracle · Shamir's trick uses s on y",
  },
  {
    ...SIGMA,
    name: 'GQ cheater verifier challenge',
    anchor: 'const transcript = { y, yT: forged.yT, c: verifierChallenge, xZ: forged.xZ };',
    replacement: 'const transcript = { y, yT: forged.yT, c: forged.guessedChallenge, xZ: forged.xZ };',
    test: 'mutation oracle · GQ cheater is checked against verifier c',
  },
  {
    ...SUMCHECK,
    name: 'sum-check recurrence enforcement',
    anchor: "} else if (sumAt01 !== expected) {",
    replacement: "} else if (sumAt01 !== sumAt01) {",
    test: 'mutation oracle · sum-check verifier enforces the recurrence',
  },
  {
    ...SUMCHECK,
    name: 'sum-check degree enforcement',
    anchor: 'if (degree > bound) {',
    replacement: 'if (degree > bound + 1000) {',
    test: 'mutation oracle · sum-check verifier enforces the degree bound',
  },
  {
    ...SUMCHECK,
    name: 'sum-check final evaluation',
    anchor: 'const ok = evaluated === expected;',
    replacement: 'const ok = evaluated === evaluated;',
    test: 'mutation oracle · sum-check verifier rejects a false final evaluation',
  },
  {
    ...GKR,
    name: 'GKR verifier wiring evaluation',
    anchor: 'total = field.add(total, field.mul(field.mul(chi(field, a, here, z), chi(field, in1, below, b)), chi(field, in2, below, c)));',
    replacement: 'total = field.add(total, field.mul(field.mul(chi(field, a, here, z), chi(field, in2, below, b)), chi(field, in1, below, c)));',
    test: 'mutation oracle · GKR verifier evaluates the wiring it derived itself',
  },
  {
    ...SUMCHECK,
    name: 'sum-check challenge ordering guard',
    anchor: "if (phase !== 'await-challenge') {\n        throw new Error(`protocol order: the round-${round} challenge cannot be drawn",
    replacement: "if (phase !== 'await-challenge' && phase !== 'await-message') {\n        throw new Error(`protocol order: the round-${round} challenge cannot be drawn",
    test: 'mutation oracle · a challenge cannot be drawn before its prover message',
  },
  {
    ...SUMCHECK,
    name: 'sum-check replay round count',
    anchor: 'if (rounds.length !== variables) {',
    replacement: 'if (rounds.length > variables) {',
    test: 'mutation oracle · transcript replay refuses a truncated transcript',
  },
];

function run(command, args, timeout = 300_000) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
    maxBuffer: 16 * 1024 * 1024,
    timeout,
  });
  assertNormalExit(result, command);
  return {
    ...result,
    code: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

function build() {
  const result = run('npm', ['run', 'build'], 120_000);
  if (result.code !== 0) throw new Error(`Build failed:\n${result.output}`);
}

function bundleHash() {
  const files = readdirSync('dist/assets').filter((file) => file.endsWith('.js')).sort();
  if (files.length === 0) throw new Error('Build produced no JavaScript bundles.');
  const hash = createHash('sha256');
  for (const file of files) hash.update(file).update(readFileSync(`dist/assets/${file}`));
  return hash.digest('hex');
}

function namedTest(spec, testName, shouldPass) {
  const result = run('npx', [
    'playwright',
    'test',
    spec,
    '--grep',
    testName,
    '--retries=0',
    '--workers=1',
    '--reporter=json',
  ]);
  validateNamedRun(result, testName, shouldPass, spec.replace(/^e2e\//, ''));
  return result;
}

function sourceDiff(source) {
  return run('git', ['diff', '--no-ext-diff', '--', source], 30_000);
}

const selectedName = process.argv[2];
const selected = selectedName ? mutations.filter(({ name }) => name === selectedName) : mutations;
if (selected.length === 0) throw new Error(`Unknown mutation: ${selectedName}`);

if (run('git',['status','--porcelain']).output.trim()) throw Error('Commit source changes before replaying mutations');
const records = [];
for (const mutation of selected) {
  const source = readFileSync(mutation.source, 'utf8');
  if (source.split(mutation.anchor).length !== 2) {
    throw new Error(`${mutation.name}: source anchor must occur exactly once.`);
  }

  build();
  const baselineHash = bundleHash();
  const baseline = namedTest(mutation.spec, mutation.test, true);
  if (baseline.code !== 0) throw new Error(`${mutation.name}: baseline failed.\n${baseline.output}`);
  console.log(`[${mutation.name}] 1/5 baseline passes: ${mutation.test}`);

  let mutatedHash;
  try {
    const changed = source.replace(mutation.anchor, mutation.replacement);
    if (changed === source) throw new Error(`${mutation.name}: mutation was empty.`);
    writeFileSync(mutation.source, changed);

    const diff = sourceDiff(mutation.source);
    if (diff.code !== 0 || diff.output.trim() === '') {
      throw new Error(`${mutation.name}: source diff was empty.\n${diff.output}`);
    }
    console.log(`[${mutation.name}] 2/5 source diff NON-EMPTY`);

    build();
    mutatedHash = bundleHash();
    if (mutatedHash === baselineHash) throw new Error(`${mutation.name}: bundle hash did not move.`);
    console.log(`[${mutation.name}] 3/5 bundle hash MOVED: ${baselineHash} -> ${mutatedHash}`);

    const observed = namedTest(mutation.spec, mutation.test, false);
    if (observed.code === 0) throw new Error(`${mutation.name}: mutation survived.`);
    if (!observed.output.includes(mutation.test)) {
      throw new Error(`${mutation.name}: red output did not name its owning test.\n${observed.output}`);
    }
    if (/Process from config\.webServer|ERR_CONNECTION_REFUSED|Cannot find module|No tests found/.test(observed.output)) {
      throw new Error(`${mutation.name}: infrastructure failure is not a kill.\n${observed.output}`);
    }
    console.log(`[${mutation.name}] 4/5 NAMED test red: ${mutation.test}`);
  } finally {
    writeFileSync(mutation.source, source);
    build();
  }

  if (bundleHash() !== baselineHash) throw new Error(`${mutation.name}: restored bundle differs.`);
  const restored = namedTest(mutation.spec, mutation.test, true);
  if (restored.code !== 0) throw new Error(`${mutation.name}: restored control failed.\n${restored.output}`);
  console.log(`[${mutation.name}] 5/5 restored and green`);
  records.push({ ...mutation, baselineHash, mutatedHash, killed: true, restored: true });
}

console.log(`${records.length} of ${selected.length} concrete mutations killed, with passing controls.`);
