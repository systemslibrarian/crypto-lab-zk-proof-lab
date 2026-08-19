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
  initCurrentNav();
  initSvgRoles();
  initScrollableTables();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initEnhancements, { once: true });
} else {
  initEnhancements();
}
