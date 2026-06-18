export function addLog(id, msg, cls = 'le') {
  const log = document.getElementById(id);
  const line = document.createElement('div');
  line.className = cls;
  line.textContent = msg;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function confidencePercent(rounds, cheatProb) {
  return (1 - Math.pow(cheatProb, rounds)) * 100;
}

export function cheatProbabilityPercent(rounds, cheatProb) {
  return Math.pow(cheatProb, rounds) * 100;
}

export function setConf(fillId, pctId, rounds, cheatProb) {
  const confidence = confidencePercent(rounds, cheatProb);
  document.getElementById(fillId).style.width = `${Math.min(confidence, 100)}%`;
  document.getElementById(pctId).textContent = `${confidence.toFixed(2)}%`;
}

export function rInt(min, max) {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return min + (values[0] % (max - min + 1));
}

export function rHex(bytes) {
  const values = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(values);
  return Array.from(values).map(value => value.toString(16).padStart(2, '0')).join('');
}

export function readSeedFromUrl() {
  try {
    const seed = new URLSearchParams(window.location.search).get('seed');
    if (!seed) {
      return null;
    }
    const trimmed = seed.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

export function readModeFromUrl() {
  try {
    const mode = new URLSearchParams(window.location.search).get('mode');
    if (!mode) {
      return null;
    }
    const normalized = mode.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
  } catch {
    return null;
  }
}

export function readAutoFromUrl() {
  try {
    const value = new URLSearchParams(window.location.search).get('auto');
    return value === '1' || value === 'true';
  } catch {
    return false;
  }
}

export function createSeededRng(seedText) {
  let state = 2166136261 >>> 0;
  for (const char of seedText) {
    state ^= char.charCodeAt(0);
    state = Math.imul(state, 16777619) >>> 0;
  }
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function seededInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

export function seededHex(rng, bytes) {
  let out = '';
  for (let i = 0; i < bytes; i += 1) {
    const value = Math.floor(rng() * 256);
    out += value.toString(16).padStart(2, '0');
  }
  return out;
}

export function modpow(base, exp, mod) {
  let result = 1n;
  let currentBase = BigInt(base) % BigInt(mod);
  let currentExp = BigInt(exp);
  const modulus = BigInt(mod);
  while (currentExp > 0n) {
    if (currentExp & 1n) {
      result = result * currentBase % modulus;
    }
    currentExp >>= 1n;
    currentBase = currentBase * currentBase % modulus;
  }
  return Number(result);
}

export function schnorrVerify({ g, p, y, R, c, s }) {
  const lhs = modpow(g, s, p);
  const rhs = (modpow(y, c, p) * R) % p;
  return { lhs, rhs, ok: lhs === rhs };
}

export async function sha256hex(msg) {
  const buffer = new TextEncoder().encode(msg);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash)).map(value => value.toString(16).padStart(2, '0')).join('');
}

export function prefersReducedMotion() {
  return Boolean(globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function resolveElement(target) {
  return typeof target === 'string' ? document.getElementById(target) : target;
}

// Update an exhibit's guided-narration caption (plain-English explanation of
// the current protocol phase). No-op if the element is absent.
export function narrate(id, html) {
  const element = document.getElementById(id);
  if (element) {
    element.innerHTML = html;
  }
}

// Celebrate a successful verification: a brief "pop" on the result element plus
// a lightweight confetti burst. Motion is skipped for reduced-motion users; the
// result text/colour still conveys the outcome, so no meaning is lost.
export function celebrate(target, options = {}) {
  const element = resolveElement(target);
  if (element) {
    element.classList.remove('celebrate-pop');
    void element.offsetWidth;
    element.classList.add('celebrate-pop');
  }
  if (prefersReducedMotion() || options.confetti === false) {
    return;
  }
  spawnConfetti(element);
}

// Signal a failed/caught outcome with a short shake on the result element.
export function flashFail(target) {
  const element = resolveElement(target);
  if (!element || prefersReducedMotion()) {
    return;
  }
  element.classList.remove('flash-fail');
  void element.offsetWidth;
  element.classList.add('flash-fail');
}

function spawnConfetti(anchor) {
  const layer = document.createElement('div');
  layer.className = 'confetti-layer';
  layer.setAttribute('aria-hidden', 'true');
  const rect = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
  const originX = rect ? rect.left + rect.width / 2 : globalThis.innerWidth / 2;
  const originY = rect && rect.height ? rect.top + rect.height / 2 : globalThis.innerHeight / 3;
  const palette = ['#3565d8', '#7fa3ff', '#34d399', '#fbbf24', '#f4f8ff'];
  const count = 20;
  for (let i = 0; i < count; i += 1) {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
    const distance = 70 + Math.random() * 80;
    piece.style.left = `${originX}px`;
    piece.style.top = `${originY}px`;
    piece.style.background = palette[i % palette.length];
    piece.style.setProperty('--dx', `${(Math.cos(angle) * distance).toFixed(1)}px`);
    piece.style.setProperty('--dy', `${(Math.sin(angle) * distance - 40).toFixed(1)}px`);
    piece.style.setProperty('--rot', `${(Math.random() * 600 - 300).toFixed(0)}deg`);
    piece.style.animationDelay = `${(Math.random() * 80).toFixed(0)}ms`;
    layer.appendChild(piece);
  }
  document.body.appendChild(layer);
  globalThis.setTimeout(() => layer.remove(), 1200);
}

export async function copyTextToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'absolute';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  return copied;
}
