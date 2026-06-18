// Lobby guided tour: an in-page, keyboard-accessible walkthrough that
// spotlights each exhibit card in turn with a one-line explanation.
const STOPS = [
  { sel: 'a[href="exhibits/cave.html"]', title: 'Exhibit 01 — Ali Baba Cave', body: 'The core intuition: prove you know a secret by always exiting the side the verifier names — without ever saying the word.' },
  { sel: 'a[href="exhibits/graph-coloring.html"]', title: 'Exhibit 02 — Graph 3-Coloring', body: 'Commit to a coloring, then reveal only one border at a time. The full map stays hidden.' },
  { sel: 'a[href="exhibits/schnorr.html"]', title: 'Exhibit 03 — Schnorr', body: 'Real modular arithmetic. Step through each phase, change the secret x, and watch the proof balance.' },
  { sel: 'a[href="exhibits/commit-reveal.html"]', title: 'Exhibit 04 — Commit-Reveal', body: 'Lock a hidden bid as a real SHA-256 hash, then reveal it — any tampering is caught.' },
  { sel: 'a[href="exhibits/fiat-shamir.html"]', title: 'Exhibit 05 — Fiat-Shamir', body: 'Make a proof non-interactive by deriving the challenge from a hash of the transcript.' },
  { sel: 'a[href="exhibits/snark.html"]', title: 'Exhibit 06 — zk-SNARK', body: 'See setup, proving, and verification with public/private input separation in one toy pipeline.' }
];

function prefersReducedMotion() {
  return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function initTour() {
  const launch = document.getElementById('tour-btn');
  if (!launch) {
    return;
  }
  const stops = STOPS
    .map(stop => ({ ...stop, el: document.querySelector(`.lobby-grid ${stop.sel}`) }))
    .filter(stop => stop.el);
  if (!stops.length) {
    return;
  }

  let index = 0;
  let bar = null;

  function highlight(i) {
    stops.forEach((stop, j) => stop.el.classList.toggle('tour-active', i === j));
    stops[i].el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
  }

  function render() {
    const stop = stops[index];
    bar.querySelector('.tour-counter').textContent = `Stop ${index + 1} of ${stops.length}`;
    bar.querySelector('.tour-title').textContent = stop.title;
    bar.querySelector('.tour-body').textContent = stop.body;
    const prev = bar.querySelector('.tour-prev');
    const next = bar.querySelector('.tour-next');
    prev.disabled = index === 0;
    next.textContent = index === stops.length - 1 ? 'Finish' : 'Next ▷';
    highlight(index);
    next.focus();
  }

  function close() {
    if (!bar) {
      return;
    }
    stops.forEach(stop => stop.el.classList.remove('tour-active'));
    bar.remove();
    bar = null;
    launch.setAttribute('aria-expanded', 'false');
    launch.focus();
  }

  function open() {
    if (bar) {
      return;
    }
    bar = document.createElement('div');
    bar.className = 'tour-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Guided tour of the exhibits');
    bar.innerHTML =
      '<div class="tour-content" aria-live="polite" aria-atomic="true">' +
      '<div class="tour-counter"></div>' +
      '<div class="tour-title"></div>' +
      '<div class="tour-body"></div>' +
      '</div>' +
      '<div class="tour-actions">' +
      '<button type="button" class="bs tour-prev">◁ Back</button>' +
      '<button type="button" class="bp tour-next">Next ▷</button>' +
      '<button type="button" class="bs tour-close" aria-label="End tour">✕</button>' +
      '</div>';
    document.body.appendChild(bar);
    bar.querySelector('.tour-prev').addEventListener('click', () => {
      if (index > 0) {
        index -= 1;
        render();
      }
    });
    bar.querySelector('.tour-next').addEventListener('click', () => {
      if (index < stops.length - 1) {
        index += 1;
        render();
      } else {
        close();
      }
    });
    bar.querySelector('.tour-close').addEventListener('click', close);
    bar.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        close();
      }
    });
    launch.setAttribute('aria-expanded', 'true');
    index = 0;
    render();
  }

  launch.addEventListener('click', open);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTour, { once: true });
} else {
  initTour();
}
