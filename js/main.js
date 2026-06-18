function initThemeToggle() {
  const root = document.documentElement;
  const header = document.querySelector('.site-header');
  if (!header) {
    return;
  }

  const button = document.createElement('button');
  button.className = 'theme-toggle';
  button.type = 'button';

  function applyButtonState() {
    const current = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const isDark = current === 'dark';
    button.textContent = isDark ? '🌙' : '☀️';
    button.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    button.setAttribute('aria-pressed', String(!isDark));
  }

  button.addEventListener('click', () => {
    const current = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    applyButtonState();
  });

  header.appendChild(button);
  applyButtonState();
}

// Inject a "skip to main content" link as the first focusable element so
// keyboard and screen-reader users can bypass the nav on every page.
function initSkipLink() {
  const main = document.querySelector('main');
  if (!main) {
    return;
  }
  if (!main.id) {
    main.id = 'main-content';
  }
  main.setAttribute('tabindex', '-1');

  if (document.querySelector('.skip-link')) {
    return;
  }
  const link = document.createElement('a');
  link.className = 'skip-link';
  link.href = `#${main.id}`;
  link.textContent = 'Skip to main content';
  document.body.insertBefore(link, document.body.firstChild);
}

// Mark the active nav link as the current page for assistive technology.
function initCurrentNav() {
  document.querySelectorAll('.nav-link.active').forEach(link => {
    link.setAttribute('aria-current', 'page');
  });
}

// Labeled SVGs should expose an image role so their aria-label is announced.
function initSvgRoles() {
  document.querySelectorAll('svg[aria-label]:not([role])').forEach(svg => {
    svg.setAttribute('role', 'img');
  });
}

// Wide data tables can overflow on small screens. Wrap each in a labeled
// scroll region that becomes keyboard-focusable only when it actually scrolls.
function initScrollableTables() {
  const tables = document.querySelectorAll('.commit-table');
  tables.forEach(table => {
    if (table.parentElement && table.parentElement.classList.contains('table-scroll')) {
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'table-scroll';
    wrap.setAttribute('role', 'region');
    const heading = table.closest('.panel') && table.closest('.panel').querySelector('.ph');
    const name = heading ? heading.textContent.trim() : 'Data table';
    wrap.setAttribute('aria-label', `${name} (scrollable)`);
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
  });

  const syncFocusability = () => {
    document.querySelectorAll('.table-scroll').forEach(wrap => {
      if (wrap.scrollWidth > wrap.clientWidth + 1) {
        wrap.setAttribute('tabindex', '0');
      } else {
        wrap.removeAttribute('tabindex');
      }
    });
  };
  syncFocusability();
  window.addEventListener('resize', syncFocusability);
}

function initEnhancements() {
  initSkipLink();
  initThemeToggle();
  initCurrentNav();
  initSvgRoles();
  initScrollableTables();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initEnhancements, { once: true });
} else {
  initEnhancements();
}
