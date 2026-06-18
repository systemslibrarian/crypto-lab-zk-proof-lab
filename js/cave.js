import {
  addLog,
  celebrate,
  cheatProbabilityPercent,
  createSeededRng,
  flashFail,
  narrate,
  readAutoFromUrl,
  readModeFromUrl,
  readSeedFromUrl,
  seededInt,
  setConf,
  sleep
} from './utils.js';

let caveState = { n: 0, running: false, auto: false };
let cavePos = { x: 100, y: 20 };
const scenarioSeed = readSeedFromUrl();
const scenarioMode = readModeFromUrl();
const autoScenario = readAutoFromUrl();
const seededRng = scenarioSeed ? createSeededRng(`cave:${scenarioSeed}`) : null;
let seedAnnounced = false;

function nextBool() {
  if (seededRng) {
    return seededInt(seededRng, 0, 1) === 1;
  }
  return Math.random() < 0.5;
}

function caveSetControls() {
  const locked = caveState.running || caveState.auto;
  document.getElementById('cave-btn').disabled = locked;
  document.getElementById('cave-auto-btn').disabled = locked;
  document.getElementById('cave-reset-btn').disabled = locked;
  document.getElementById('bluff-tog').disabled = locked;
}

function caveAnim(toX, toY, ms) {
  return new Promise(resolve => {
    const group = document.getElementById('cave-prover-g');
    const from = { ...cavePos };
    const start = performance.now();
    function tick(now) {
      const t = Math.min((now - start) / ms, 1);
      const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      const x = from.x + (toX - from.x) * eased;
      const y = from.y + (toY - from.y) * eased;
      group.setAttribute('transform', `translate(${x},${y})`);
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        cavePos = { x: toX, y: toY };
        resolve();
      }
    }
    requestAnimationFrame(tick);
  });
}

function setProverColor(color) {
  document.querySelector('#cave-prover-g circle').setAttribute('fill', color);
}

function updateCaveProbability() {
  document.getElementById('cave-cp').textContent = `${cheatProbabilityPercent(caveState.n, 0.5).toFixed(4)}%`;
}

async function runCaveRound(celebrateWin = false) {
  const bluffing = document.getElementById('bluff-tog').checked;
  const wentLeft = nextBool();
  setProverColor('#4f7bff');
  document.getElementById('cave-challenge').textContent = '';
  document.getElementById('cave-status').textContent = 'Prover enters cave…';
  narrate('cave-narration', 'The prover enters and secretly picks a tunnel — the verifier never sees which one.');
  await caveAnim(100, 20, 400);
  await caveAnim(100, 85, 500);
  document.getElementById('cave-status').textContent = `Prover reaches fork — goes ${wentLeft ? 'LEFT' : 'RIGHT'} (unseen by verifier)`;
  await caveAnim(wentLeft ? 58 : 142, 170, 500);
  await sleep(500);
  const challengeLeft = nextBool();
  document.getElementById('cave-challenge').textContent = `→ CHALLENGE: "Come out the ${challengeLeft ? 'LEFT' : 'RIGHT'} side!"`;
  narrate('cave-narration', `The verifier demands the ${challengeLeft ? 'LEFT' : 'RIGHT'} exit. A knower opens the secret door and complies; a bluffer is trapped if they guessed wrong.`);
  await sleep(400);
  const success = bluffing ? wentLeft === challengeLeft : true;
  if (success) {
    const targetX = challengeLeft ? 58 : 142;
    await caveAnim(targetX, 170, 400);
    setProverColor('#34d399');
    document.getElementById('cave-status').textContent = '✓ Exited correct side';
    narrate('cave-narration', 'Correct exit. Each honest round halves a cheater\'s odds, so the verifier\'s confidence climbs toward certainty.');
    caveState.n += 1;
    addLog('cave-log', `R${caveState.n}: challenge=${challengeLeft ? 'L' : 'R'}${bluffing ? ' [BLUFF]' : ''} → ✓ PASS`, 'lok');
    setConf('cave-fill', 'cave-pct', caveState.n, 0.5);
    document.getElementById('cave-n').textContent = caveState.n;
    updateCaveProbability();
    if (scenarioSeed && !seedAnnounced) {
      addLog('cave-log', `Seeded run: ${scenarioSeed}`, 'lacc');
      seedAnnounced = true;
    }
    if (celebrateWin) {
      celebrate('cave-status');
    }
  } else {
    setProverColor('#f87171');
    document.getElementById('cave-status').textContent = '✗ Wrong exit — CAUGHT bluffing!';
    narrate('cave-narration', 'Wrong side — the bluff is exposed. A cheater gets caught about half the time per round.');
    addLog('cave-log', `R${caveState.n + 1}: challenge=${challengeLeft ? 'L' : 'R'} [BLUFF] → ✗ CAUGHT`, 'lerr');
    flashFail('cave-status');
  }
  await sleep(700);
  setProverColor('#4f7bff');
  await caveAnim(100, 20, 500);
}

export async function caveRound() {
  if (caveState.running || caveState.auto) {
    return;
  }
  caveState.running = true;
  caveSetControls();
  try {
    await runCaveRound(true);
  } finally {
    caveState.running = false;
    caveSetControls();
  }
}

export async function caveAuto() {
  if (caveState.running || caveState.auto) {
    return;
  }
  caveState.auto = true;
  caveSetControls();
  try {
    for (let i = 0; i < 10; i += 1) {
      caveState.running = true;
      caveSetControls();
      try {
        await runCaveRound(i === 9);
      } finally {
        caveState.running = false;
        caveSetControls();
      }
      await sleep(100);
    }
  } finally {
    caveState.auto = false;
    caveSetControls();
  }
}

export function caveReset() {
  if (caveState.running || caveState.auto) {
    return;
  }
  caveState = { n: 0, running: false, auto: false };
  cavePos = { x: 100, y: 20 };
  document.getElementById('cave-prover-g').setAttribute('transform', 'translate(100,20)');
  setProverColor('#4f7bff');
  document.getElementById('cave-status').textContent = 'Ready.';
  narrate('cave-narration', 'In each round the prover secretly takes one tunnel, then must exit the side the verifier names. Only someone who knows the secret word can always comply.');
  document.getElementById('cave-challenge').textContent = '';
  document.getElementById('cave-fill').style.width = '0%';
  document.getElementById('cave-pct').textContent = '0.00%';
  document.getElementById('cave-n').textContent = '0';
  document.getElementById('cave-cp').textContent = '100%';
  document.getElementById('cave-log').innerHTML = '<span class="le">— protocol log —</span>';
  seedAnnounced = false;
  caveSetControls();
}

document.getElementById('cave-btn').addEventListener('click', caveRound);
document.getElementById('cave-auto-btn').addEventListener('click', caveAuto);
document.getElementById('cave-reset-btn').addEventListener('click', caveReset);
document.getElementById('bluff-tog').addEventListener('change', caveReset);

if (scenarioMode === 'bluff') {
  document.getElementById('bluff-tog').checked = true;
}
if (autoScenario) {
  setTimeout(() => {
    if (scenarioMode === 'bluff') {
      caveRound();
    } else {
      caveAuto();
    }
  }, 0);
}
