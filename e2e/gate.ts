import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { auditContrast, formatContrastFailures } from './contrast';
import { auditNonText } from './nontext';
import { NONTEXT_BASELINE } from './nontext-baseline';

export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** The two viewports the gate runs at: desktop, and phone width for WCAG 1.4.10. */
export const WIDE = { width: 1280, height: 900 };
export const NARROW = { width: 380, height: 800 };

/**
 * Shared machinery for the WCAG gate.
 *
 * Four rules govern everything here:
 *
 *  1. NOTHING IS INJECTED INTO THE PAGE BEFORE A SCAN. The gate this replaced
 *     pushed `*{…opacity:1!important}` through `addStyleTag` three times per
 *     page. On this site that is not a neutral convenience: `.cl-hero-sub`
 *     renders at `opacity: .85`, `.bp:disabled` at `.4`, and the whole
 *     `.step-card` / `.log>*` entrance choreography animates from
 *     `opacity: 0`. Forcing all of it opaque handed axe foreground colours the
 *     page never paints. It then ran a `revealAll()` that stripped `[hidden]`,
 *     forced every `<details>` open, and added `.active` to every `.panel` —
 *     which on the Schnorr exhibit meant all four `display:none` step cards
 *     were on screen simultaneously, a document no visitor can reach.
 *
 *  2. IT DROVE EVERY DEMO AND SCANNED ONCE, AT THE END. That is a distinct
 *     failure from never driving at all, and it is worth naming: the old drive
 *     clicked every `.bp` and `.bd` button on the page in DOM order inside
 *     `.catch(() => {})`, stepped the Schnorr walkthrough six times, ran the
 *     transcript comparison — and then handed axe the single final frame. Every
 *     accepted proof, every caught cheat, every rejected opening was built and
 *     thrown away unmeasured, and the swallowed rejections meant a click that
 *     never landed was indistinguishable from one that did. This gate scans
 *     after every single step and lets a failed click fail.
 *
 *  3. EVERY SCAN ASSERTS ITS CONTENT IS PRESENT FIRST, and there are scans well
 *     past first paint. axe over a placeholder passes having checked nothing.
 *     At first paint every exhibit shows `—` in its value boxes, "— protocol
 *     log —" in its log, and 0.00% confidence. The `.lerr` red log line, the
 *     caught bluff, the rejected commitment opening, the leaked-nonce panel and
 *     the failed verification — the states this lab exists to teach — are
 *     reachable only by driving, and each replaces the one before it.
 *
 *  4. `violations` IS NOT THE WHOLE ORACLE. See `scan`.
 */

/**
 * Wait for every running animation and transition to drain.
 *
 * Transitions drain in waves, not in one batch, so a poll for "nothing running
 * right now" can exit through a gap between waves. Require quiescence to hold
 * for several consecutive frames instead.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __quietFrames?: number };
      const running = document.getAnimations().filter((a) => a.playState === 'running');
      w.__quietFrames = running.length === 0 ? (w.__quietFrames ?? 0) + 1 : 0;
      return w.__quietFrames >= 6;
    },
    undefined,
    { timeout: 20_000, polling: 'raf' }
  );
}

/**
 * Assert that reduced motion left the page visible, not merely un-animated.
 *
 * This is the assertion that earns the right not to inject `opacity: 1`. The
 * failure mode it guards against is an element whose only route to its visible
 * state is an animation, in a stylesheet whose reduced-motion block cancels
 * that animation without restoring its end state — the element then renders at
 * `opacity: 0` for every reader with the preference set.
 *
 * This site is a live example of the shape and gets it right. `.step-card`
 * animates `stepIn` from `opacity: 0`, `.log > *` animates `logIn` from
 * `opacity: 0`, and the reduced-motion block cancels both with
 * `animation: none !important`. A cancelled animation loses its end state — but
 * these elements declare no `opacity` of their own, so the base style they fall
 * back to is already 1. Asserting it beats reasoning about it.
 *
 * `aria-hidden` subtrees are excluded. The cost of that exclusion is stated
 * plainly: text removed from the accessibility tree AND painted at zero opacity
 * is not checked here — which is why `expectNoLiveTextAriaHidden` exists.
 */
async function expectNotBlank(page: Page, label: string): Promise<void> {
  const invisible = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!own) continue;
      // Deliberately hidden subtrees are not "blank", they are closed.
      if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      let effective = 1;
      let node: Element | null = el;
      while (node) {
        effective *= parseFloat(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      if (effective === 0) {
        out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}`);
      }
    }
    return Array.from(new Set(out));
  });
  expect(invisible, `no visible text may render at opacity 0 in state: ${label}`).toEqual([]);
}

/**
 * `aria-hidden` must cover decoration only, never words.
 *
 * Both contrast oracles this gate runs skip `aria-hidden` text — axe's
 * `color-contrast` rule by design, and `auditContrast` deliberately, to match
 * it. That shared blind spot means a single misplaced `aria-hidden` removes a
 * region from the accessibility tree AND from every contrast measurement at
 * once, and both halves of the gate go green on content nobody can read either
 * way.
 *
 * The rule enforced here is narrow enough to be objective: a hidden subtree may
 * hold glyphs (arrows, check marks, geometric marks — decoration that carries
 * no meaning a screen-reader user is missing), but not letters or digits.
 */
export async function expectNoLiveTextAriaHidden(page: Page, label: string): Promise<void> {
  const hidden = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('[aria-hidden="true"]'))) {
      // Only the outermost hidden ancestor matters; nested ones repeat it.
      if (el.parentElement?.closest('[aria-hidden="true"]')) continue;
      const text = (el.textContent ?? '').trim();
      if (!/[A-Za-z0-9]/.test(text)) continue;
      out.push(
        `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}` +
          `${el.getAttribute('class') ? '.' + el.getAttribute('class')!.trim().split(/\s+/).join('.') : ''}` +
          ` — "${text.slice(0, 60)}"`
      );
    }
    return out;
  });
  expect(
    Array.from(new Set(hidden)),
    `aria-hidden may cover glyphs, not words, in state: ${label}`
  ).toEqual([]);
}

/**
 * Assert the page does not require horizontal scrolling.
 *
 * WCAG 1.4.10 (Reflow, AA). axe has no rule for this at all, and this site is a
 * plausible offender at 380px: the lobby is a two-column card grid, every
 * exhibit is a two-column `.demo-grid`, the graph exhibit lays out two
 * six-column extractor tables, and the guided tour drops a fixed-position bar
 * across the viewport.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth) return null;

    // Only elements that actually push the DOCUMENT sideways are culprits. A
    // wide box inside an `overflow-x: auto` wrapper has a huge bounding rect
    // but is clipped by its scroller and contributes nothing to the document's
    // scroll width — naming it sends you off fixing the wrong element. That
    // cost a run elsewhere in this fleet, and this site has the same decoy:
    // `.commit-table` is given `min-width: 420px` at phone width specifically
    // so it can scroll inside its `.table-scroll` wrapper.
    const clipped = (el: Element): boolean => {
      let n = el.parentElement;
      while (n && n !== doc) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
        n = n.parentElement;
      }
      return false;
    };

    const over = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.right > doc.clientWidth + 1)
      .sort((a, b) => b.r.right - a.r.right);
    // Prefer an unclipped culprit; fall back to the widest clipped one rather
    // than reporting nothing, so the message always names something to look at.
    const widest = over.filter((x) => !clipped(x.el))[0] ?? over[0];
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest: widest
        ? `${clipped(widest.el) ? '[clipped] ' : ''}${widest.el.tagName.toLowerCase()}${widest.el.id ? '#' + widest.el.id : ''}` +
          `${widest.el.getAttribute('class') ? '.' + widest.el.getAttribute('class')!.trim().split(/\s+/).join('.') : ''}` +
          ` @${Math.round(widest.r.width)}px right=${Math.round(widest.r.right)}`
        : '(none identified)',
    };
  });
  expect(overflow, `page must not scroll horizontally in state: ${label}`).toBeNull();
}

/**
 * Every scrolling container must be operable from the keyboard (WCAG 2.1.1).
 * If it holds no focusable content it needs `tabindex="0"`, so it becomes a
 * focus target arrow keys can then scroll.
 *
 * This is the assertion the old gate could not have made, because it never
 * produced a scrolling region: every `.log` on this site is a fixed-height
 * `overflow-y: auto` box holding nothing focusable, and it only starts to
 * scroll once a run has appended enough protocol lines to overflow it. The
 * drives below run each exhibit long enough to get there.
 */
export async function expectScrollersReachable(page: Page, label: string): Promise<void> {
  const unreachable = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .filter((el) => {
        const cs = getComputedStyle(el);
        return (
          ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY)
        );
      })
      .filter((el) => el.tabIndex < 0 && !el.querySelector(FOCUSABLE))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${(el.getAttribute('class') ?? '').trim()}` +
          ` (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`
      );
  });
  expect(
    Array.from(new Set(unreachable)),
    `scrolling regions with no keyboard route in state: ${label}`
  ).toEqual([]);
}

/**
 * Scan the page as it currently stands.
 *
 * Six assertions, because axe's `violations` array alone is not a complete
 * oracle:
 *
 *  - `violations` — the usual WCAG A/AA rule failures.
 *  - `incomplete` — axe's "could not decide" bucket, which never reaches the
 *    violations array. The one rule id allowed to remain incomplete is
 *    `color-contrast`, and only because the next assertion computes those
 *    ratios arithmetically. That exemption is doing more work on this site than
 *    on most: almost every control and surface here is a gradient or a
 *    translucent tint, which is exactly what axe declines to resolve.
 *    Everything else in that bucket is a real result axe simply could not
 *    finish — including `aria-prohibited-attr`, which is where an `aria-label`
 *    on a role-less div hides, a defect that never reaches the violations array
 *    at all.
 *  - arithmetic contrast — composite-aware WCAG 1.4.3 over every text node.
 *  - `aria-hidden` covering words rather than glyphs — the one gap both
 *    contrast oracles share.
 *  - keyboard reachability of scrolling regions — WCAG 2.1.1.
 *  - reflow — WCAG 1.4.10, which axe has no rule for at all.
 */

/**
 * WCAG 1.4.11 and generated content, ratcheted against a per-repo baseline.
 *
 * Neither class has ANY other oracle: axe has no rule for non-text contrast,
 * and the arithmetic text walk cannot reach a control's boundary or a
 * `::before` glyph, because a pseudo-element is not an element and owns no text
 * node. Both were being found by hand-sampling screenshot pixels, which does
 * not regress-test.
 *
 * The backlog is real, so this does not block on it — but a check that merely
 * logs is not a gate, and this sweep has spent its whole length deleting checks
 * that could not fail. So it ratchets instead: anything NOT in the baseline
 * fails, anything in the baseline that got WORSE fails, and anything in the
 * baseline that has been FIXED fails until its entry is deleted. That last rule
 * is what stops the allowlist becoming a permanent exemption.
 */
const nonTextSeen = new Set<string>();

export async function expectNoNewNonTextFailures(page: Page, label: string): Promise<void> {
  const found = await auditNonText(page);
  // Capture mode: emit every finding and assert nothing, so a baseline can be
  // generated by the SAME path that checks it. Opt-in via env, and the run is
  // deliberately left failing at the end by `expectBaselineNotStale` so a
  // capture pass can never be mistaken for a passing gate.
  if (process.env.NT_BASELINE_CAPTURE) {
    for (const f of found) {
      console.log(`NTCAP|${f.kind}|${f.selector}|${f.ratio}|${f.required}|${/POSITIONED/.test(f.detail)}`);
    }
    return;
  }
  const problems: string[] = [];
  for (const f of found) {
    const key = `${f.kind}|${f.selector}`;
    nonTextSeen.add(key);
    const base = NONTEXT_BASELINE[key];
    if (!base) {
      problems.push(`NEW ${f.ratio}:1 (needs ${f.required}:1) [${f.kind}] ${f.selector} — ${f.detail}`);
    } else if (f.ratio < base.ratio - 0.01) {
      problems.push(
        `WORSE ${f.selector}: ${f.ratio}:1, baseline recorded ${base.ratio}:1`
      );
    }
  }
  expect(problems, `new or worsened non-text contrast in state: ${label}`).toEqual([]);
}

/**
 * Fail if a baselined finding never appeared during the whole drive.
 *
 * It has either been fixed — in which case delete the entry, which is the point
 * — or the drive stopped reaching the state that shows it, which is a coverage
 * regression worth knowing about. Call once, after `driveAllStates`.
 */
export function expectBaselineNotStale(): void {
  const unseen = Object.keys(NONTEXT_BASELINE).filter((k) => !nonTextSeen.has(k));
  expect(
    unseen,
    'baselined non-text findings that no longer appear — delete them from nontext-baseline.ts (or restore the drive state that showed them)'
  ).toEqual([]);
}

export async function scan(page: Page, label: string): Promise<void> {
  await settle(page);
  await expectNotBlank(page, label);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();

  const violations = results.violations.map((v) => ({
    state: label,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
  }));
  expect(violations, `axe violations in state: ${label}`).toEqual([]);

  const unexplainedIncomplete = results.incomplete
    .filter((v) => v.id !== 'color-contrast')
    .map((v) => ({
      state: label,
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
    }));
  expect(unexplainedIncomplete, `axe incomplete results in state: ${label}`).toEqual([]);

  const contrast = Array.from(new Set(formatContrastFailures(await auditContrast(page))));
  expect(contrast, `measured contrast failures in state: ${label}`).toEqual([]);

  await expectNoLiveTextAriaHidden(page, label);
  await expectNoNewNonTextFailures(page, label);
  await expectScrollersReachable(page, label);
  await expectNoHorizontalOverflow(page, label);
}

/**
 * One page of the site, with the presence assertions that prove it really
 * loaded and the drive that walks it through its states.
 */
export interface PageSpec {
  /** URL relative to the configured baseURL. */
  path: string;
  /** Short name used in every state label. */
  label: string;
  /** Assert the page's first paint really is its first paint, not a driven one. */
  firstPaint: (page: Page) => Promise<void>;
  /** Click through the page's real states, scanning after each. */
  drive: (page: Page, at: (state: string) => string) => Promise<void>;
}

/**
 * Load one page in a known theme and viewport with reduced motion actually in
 * effect, and assert the content every scan relies on is really on the page.
 *
 * `test.use({ reducedMotion })` silently does nothing on Playwright 1.61.1, so
 * the emulation is applied imperatively BEFORE the navigation and then
 * *asserted* from inside the page: an emulation that silently did nothing would
 * leave the gate certifying a different rendering than the one it claims to.
 * It matters more here than usual — the reduced-motion branch is not just a
 * stylesheet block, it is a runtime branch too. `shared.js` reads the same
 * media query to decide whether to spawn the confetti layer and whether to
 * shake a failed result, so an emulation that quietly failed would be scanning
 * a genuinely different page.
 *
 * The theme is seeded through `localStorage` under the key each page's own
 * anti-flash script reads — `theme` — so the requested theme is on the first
 * painted frame. Without it those scripts fall back to `prefers-color-scheme`,
 * which is why `colorScheme` is emulated to match rather than left at the
 * project default.
 */
export async function boot(
  page: Page,
  spec: PageSpec,
  theme: 'dark' | 'light',
  viewport: { width: number; height: number }
): Promise<void> {
  // A click on a control that never becomes actionable otherwise burns the
  // whole test timeout and reports nothing useful. 20s turns that silent hang
  // into a named failure naming the locator.
  page.setDefaultTimeout(20_000);
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
  await page.goto(spec.path);
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'reduced-motion emulation must actually be in effect'
  ).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.locator('main')).toBeVisible();
  await spec.firstPaint(page);
  await settle(page);
}

/** Run a page's whole gate: boot it, then drive and scan every state. */
export async function runPage(
  page: Page,
  spec: PageSpec,
  theme: 'dark' | 'light',
  size: string,
  viewport: { width: number; height: number }
): Promise<void> {
  await boot(page, spec, theme, viewport);
  const at = (state: string): string => `${spec.label} · ${theme} ${size} / ${state}`;
  await scan(page, at('first paint'));

  // Every page gets a `.skip-link` injected by `js/main.js` as the first
  // focusable element. It parks at `top: -48px` and slides in only on focus, so
  // the focused rendering is the only one that paints — and it is the first
  // thing a keyboard user meets on any page of the site.
  await page.locator('a.skip-link').focus();
  await scan(page, at('skip link focused'));

  await spec.drive(page, at);
}

// =====================================================================
// Per-page drives
// =====================================================================

/**
 * The lobby.
 *
 * The only page carrying the shared Crypto Lab header, so it is the only place
 * `.cl-skip-link` and the theme toggle can be measured, and the only page with
 * the guided tour — which builds a `position: fixed` `.tour-bar` over the
 * content and moves a `.tour-active` outline from card to card. Every one of
 * its six stops is a separate rendering (the Back button is disabled on the
 * first, the Next button reads "Finish" on the last), so each is scanned.
 */
const LOBBY: PageSpec = {
  path: '.',
  label: 'lobby',
  firstPaint: async (page) => {
    await expect(page.locator('.cl-topbar')).toBeVisible();
    await expect(page.locator('.cl-hero-title')).toHaveText('ZK Proof Lab');
    await expect(page.locator('.lobby-grid .card')).toHaveCount(6);
    await expect(page.locator('#tour-btn')).toHaveAttribute('aria-expanded', 'false');
    // The tour bar is built on demand and is genuinely absent here.
    await expect(page.locator('.tour-bar')).toHaveCount(0);
    await expect(page.locator('.tour-active')).toHaveCount(0);
  },
  drive: async (page, at) => {
    // The lobby carries a SECOND skip link, the shared Crypto Lab header's,
    // which parks at `top: -3rem` and lands on a different colour pair from the
    // lab's own. Both are focused and measured.
    await page.locator('a.cl-skip-link').focus();
    await scan(page, at('shared-header skip link focused'));

    await page.locator('#tour-btn').click();
    await expect(page.locator('.tour-bar')).toBeVisible();
    await expect(page.locator('#tour-btn')).toHaveAttribute('aria-expanded', 'true');
    for (let stop = 1; stop <= 6; stop++) {
      await expect(page.locator('.tour-counter')).toHaveText(`Stop ${stop} of 6`);
      await expect(page.locator('.tour-active')).toHaveCount(1);
      // First stop has Back disabled; last reads "Finish" rather than "Next".
      if (stop === 1) await expect(page.locator('.tour-prev')).toBeDisabled();
      else await expect(page.locator('.tour-prev')).toBeEnabled();
      await expect(page.locator('.tour-next')).toHaveText(stop === 6 ? 'Finish' : 'Next ▷');
      await scan(page, at(`guided tour, stop ${stop} of 6`));
      if (stop < 6) await page.locator('.tour-next').click();
    }

    // "Finish" on the last stop closes the tour and returns focus to the launcher.
    await page.locator('.tour-next').click();
    await expect(page.locator('.tour-bar')).toHaveCount(0);
    await expect(page.locator('.tour-active')).toHaveCount(0);
    await expect(page.locator('#tour-btn')).toHaveAttribute('aria-expanded', 'false');
    await scan(page, at('guided tour finished'));

    // Reopen and close with the ✕ button — a different exit path.
    await page.locator('#tour-btn').click();
    await expect(page.locator('.tour-bar')).toBeVisible();
    await page.locator('.tour-close').click();
    await expect(page.locator('.tour-bar')).toHaveCount(0);
    await scan(page, at('guided tour dismissed'));
  },
};

/**
 * Exhibit 01 — the Ali Baba cave.
 *
 * Two branches that paint differently and one that only exists after a lot of
 * clicking:
 *
 *  - HONEST: the prover marker turns green (`#34d399`), the log gets a `.lok`
 *    line, confidence climbs off 0.00%.
 *  - BLUFFING: the marker turns red (`#f87171`), the log gets a `.lerr` line
 *    and the status reads "CAUGHT bluffing". This is the entire soundness
 *    lesson of the exhibit and it is unreachable without flipping the toggle.
 *  - A SCROLLING LOG: `.log` is `max-height: 180px; overflow-y: auto` with
 *    nothing focusable inside it, so whether it is keyboard-operable is only a
 *    question once about eight rounds have been logged. "Run 10 Rounds" gets
 *    there.
 *
 * The page is loaded with `?seed=…`, which every exhibit here supports and
 * advertises through its own preset links. It swaps `Math.random` for a seeded
 * LCG, so which rounds a bluffer survives is fixed rather than a coin flip the
 * gate would flake on. Each round is a real ~3.5s rAF animation that reduced
 * motion does not shorten, so waits are on the controls re-enabling.
 */
const CAVE: PageSpec = {
  path: 'exhibits/cave.html?seed=zk-gate',
  label: 'cave',
  firstPaint: async (page) => {
    await expect(page.locator('#cave-status')).toHaveText('Ready.');
    await expect(page.locator('#cave-challenge')).toBeEmpty();
    await expect(page.locator('#cave-pct')).toHaveText('0.00%');
    await expect(page.locator('#cave-log .lok')).toHaveCount(0);
    await expect(page.locator('#cave-log .lerr')).toHaveCount(0);
    await expect(page.locator('#bluff-tog')).not.toBeChecked();
  },
  drive: async (page, at) => {
    await page.locator('#cave-btn').click();
    await expect(page.locator('#cave-btn')).toBeEnabled({ timeout: 60_000 });
    await expect(page.locator('#cave-status')).toContainText('✓ Exited correct side');
    await expect(page.locator('#cave-log .lok')).toHaveCount(1);
    await scan(page, at('honest round passed'));

    // Bluffing. The seeded RNG makes the outcome sequence deterministic, so the
    // caught round arrives at a fixed point rather than by luck.
    // The checkbox itself is `opacity: 0; width: 0` behind the styled `.tog-sl`
    // track, so a visitor clicks the label. Driving the label rather than
    // forcing the input is what actually proves the control is operable.
    await page.locator('label.tog').click();
    await expect(page.locator('#bluff-tog')).toBeChecked();
    await scan(page, at('bluff mode armed'));

    let caught = 0;
    for (let round = 1; round <= 6 && caught === 0; round++) {
      await page.locator('#cave-btn').click();
      await expect(page.locator('#cave-btn')).toBeEnabled({ timeout: 60_000 });
      caught = await page.locator('#cave-log .lerr').count();
      await scan(page, at(`bluff round ${round}${caught ? ' — CAUGHT' : ' — survived'}`));
    }
    expect(caught, 'the bluffing prover must actually be caught at least once').toBeGreaterThan(0);
    await expect(page.locator('#cave-status')).toContainText('CAUGHT bluffing');

    // Ten more rounds: the only way the protocol log overflows its own box.
    await page.locator('#cave-auto-btn').click();
    await expect(page.locator('#cave-auto-btn')).toBeEnabled({ timeout: 180_000 });
    const scrolls = await page.locator('#cave-log').evaluate(
      (el) => el.scrollHeight > el.clientHeight + 1
    );
    expect(scrolls, 'ten rounds must overflow the protocol log').toBe(true);
    await scan(page, at('ten rounds run, protocol log scrolling'));

    await page.locator('#cave-reset-btn').click();
    await expect(page.locator('#cave-pct')).toHaveText('0.00%');
    await expect(page.locator('#cave-log .lok')).toHaveCount(0);
    await scan(page, at('reset'));
  },
};

/**
 * Exhibit 02 — graph 3-colouring, plus the extractor bench.
 *
 * Three separate machines on one page:
 *
 *  - THE PROTOCOL. New Round commits five SHA-256 digests and prints them into
 *    the SVG nodes and the commitment table; Challenge Edge opens two of them
 *    and re-hashes; Tamper Opening publishes an opening that does not match its
 *    digest and the verifier rejects it. Only the tamper path paints `.lerr`,
 *    and it is gated behind a committed round — the button ships disabled.
 *  - RUN 10, which is what pushes the protocol log past its scroll box.
 *  - THE EXTRACTOR BENCH, two real attacks with their own log and two result
 *    tables that read `—` until they are run. The brute-force attack is a
 *    genuine bounded SHA-256 preimage search (199,998 digests), so it is slow
 *    and the wait is on its button re-enabling, never a timeout.
 */
const GRAPH: PageSpec = {
  path: 'exhibits/graph-coloring.html',
  label: 'graph',
  firstPaint: async (page) => {
    await expect(page.locator('#g-round-info')).toContainText('Press "New Round" to commit');
    await expect(page.locator('#g-btn-c')).toBeDisabled();
    await expect(page.locator('#g-btn-t')).toBeDisabled();
    await expect(page.locator('#g-pct')).toHaveText('0.00%');
    // The commitment table ships five placeholder rows reading `0x…`.
    await expect(page.locator('#g-commit-table tr')).toHaveCount(5);
    await expect(page.locator('#g-commit-table tr td:nth-child(2)').first()).toHaveText('0x…');
    await expect(page.locator('#x-attack-verdict')).toHaveText('Not run yet.');
    await expect(page.locator('#x-strong-hashes')).toHaveText('—');
    await expect(page.locator('#x-recon-count')).toHaveText('—');
  },
  drive: async (page, at) => {
    await page.locator('#g-btn-r').click();
    await expect(page.locator('#g-btn-c')).toBeEnabled({ timeout: 60_000 });
    await expect(page.locator('#g-commit-table tr td:nth-child(2)').first()).not.toHaveText('0x…');
    await scan(page, at('round committed'));

    await page.locator('#g-btn-c').click();
    await expect(page.locator('#g-btn-r')).toBeEnabled({ timeout: 60_000 });
    await expect(page.locator('#g-log .lok').first()).toBeVisible();
    await scan(page, at('edge challenged, openings verified'));

    // The rejection path: commit again, then publish a bad opening.
    await page.locator('#g-btn-r').click();
    await expect(page.locator('#g-btn-t')).toBeEnabled({ timeout: 60_000 });
    await page.locator('#g-btn-t').click();
    await expect(page.locator('#g-log .lerr').first()).toBeVisible({ timeout: 60_000 });
    await scan(page, at('tampered opening rejected'));

    await page.locator('#g-btn-a').click();
    await expect(page.locator('#g-btn-a')).toBeEnabled({ timeout: 180_000 });
    const scrolls = await page.locator('#g-log').evaluate(
      (el) => el.scrollHeight > el.clientHeight + 1
    );
    expect(scrolls, 'ten rounds must overflow the protocol log').toBe(true);
    await scan(page, at('ten rounds run, protocol log scrolling'));

    // The extractor bench.
    await page.locator('#x-btn-brute').click();
    await expect(page.locator('#x-btn-brute')).toBeEnabled({ timeout: 300_000 });
    await expect(page.locator('#x-strong-hashes')).not.toHaveText('—');
    await expect(page.locator('#x-weak-recovered')).not.toHaveText('—');
    await expect(page.locator('#x-attack-verdict')).not.toHaveText('Not run yet.');
    await scan(page, at('brute-force attack on the commitments finished'));

    await page.locator('#x-btn-recon').click();
    await expect(page.locator('#x-btn-recon')).toBeEnabled({ timeout: 180_000 });
    await expect(page.locator('#x-recon-count')).not.toHaveText('—');
    await expect(page.locator('#x-broken-count')).not.toHaveText('—');
    await scan(page, at('transcript extractor finished'));

    await page.locator('#x-btn-reset').click();
    await expect(page.locator('#x-attack-verdict')).toHaveText('Not run yet.');
    await scan(page, at('extractor bench reset'));

    await page.locator('#g-btn-x').click();
    await expect(page.locator('#g-pct')).toHaveText('0.00%');
    await expect(page.locator('#g-btn-c')).toBeDisabled();
    await scan(page, at('protocol reset'));
  },
};

/**
 * Exhibit 03 — Schnorr identification.
 *
 * The one page with `display: none` step cards, revealed one phase at a time by
 * the Step button. The old gate's `revealAll()` forced all four on screen
 * simultaneously; here each is reached by pressing Step, and the partially
 * revealed page is scanned at every phase, because that is what a visitor
 * walking the protocol actually looks at.
 *
 * Three further states exist nowhere else: the cheat simulation (a failing
 * verification), the leaked-nonce panel (`#s-leak`, ships `display: none` and
 * unlocks only after a completed run), and a re-run under a different secret x
 * chosen from the `<select>`.
 */
const SCHNORR: PageSpec = {
  path: 'exhibits/schnorr.html',
  label: 'schnorr',
  firstPaint: async (page) => {
    await expect(page.locator('#s-step-btn')).toHaveText('Step ▷ (0/4)');
    await expect(page.locator('#s-leak-btn')).toBeDisabled();
    await expect(page.locator('#s-copy-btn')).toBeDisabled();
    await expect(page.locator('#s-leak')).toBeHidden();
    for (const id of ['#s2', '#s3', '#s4']) await expect(page.locator(id)).toBeHidden();
    await expect(page.locator('#s-R')).toHaveText('?');
    await expect(page.locator('#s-pct')).toHaveText('0.00%');
  },
  drive: async (page, at) => {
    for (let step = 1; step <= 4; step++) {
      await page.locator('#s-step-btn').click();
      // The label counts phases up to 4 and then offers a restart.
      await expect(page.locator('#s-step-btn')).toHaveText(
        step === 4 ? 'Step ▷ (restart)' : `Step ▷ (${step}/4)`,
        { timeout: 60_000 }
      );
      await scan(page, at(`stepped through phase ${step} of 4`));
    }
    await expect(page.locator('#s-result')).not.toBeEmpty();

    await page.locator('#s-reset-btn').click();
    await expect(page.locator('#s-step-btn')).toHaveText('Step ▷ (0/4)');
    await expect(page.locator('#s4')).toBeHidden();
    await scan(page, at('reset back to phase 0'));

    await page.locator('#s-btn').click();
    await expect(page.locator('#s-leak-btn')).toBeEnabled({ timeout: 60_000 });
    await expect(page.locator('#s-result')).not.toBeEmpty();
    await scan(page, at('full protocol run, proof accepted'));

    // The nonce leak: the panel that shows the private key falling out of a
    // transcript that carries one field too many.
    await page.locator('#s-leak-btn').click();
    await expect(page.locator('#s-leak')).toBeVisible();
    await scan(page, at('nonce leaked, secret x recovered'));

    await page.locator('#s-cheat-btn').click();
    await expect(page.locator('#s-btn')).toBeEnabled({ timeout: 60_000 });
    await expect(page.locator('#s-log .lerr').first()).toBeVisible();
    await scan(page, at('cheat simulated, verification fails'));

    // A different secret from the select re-runs the whole protocol.
    await page.locator('#s-x-select').selectOption('42');
    await expect(page.locator('#s-x-val')).toHaveText('42');
    await scan(page, at('secret x changed from the select'));

    await page.locator('#s-reset-btn').click();
    await expect(page.locator('#s-pct')).toHaveText('0.00%');
    await scan(page, at('reset'));
  },
};

/**
 * Exhibit 04 — SHA-256 commit / reveal.
 *
 * A three-phase state machine whose buttons gate each other: Reveal and Cheat
 * ship disabled and unlock only once bids are committed, and Cheat is the only
 * route to the mismatch rendering — the whole binding lesson. Each phase
 * rewrites the same hash boxes, so each is scanned on its own frame.
 */
const COMMIT: PageSpec = {
  path: 'exhibits/commit-reveal.html',
  label: 'commit-reveal',
  firstPaint: async (page) => {
    await expect(page.locator('#c-btn-reveal')).toBeDisabled();
    await expect(page.locator('#c-btn-cheat')).toBeDisabled();
    await expect(page.locator('#ca-hash')).toHaveText('—');
    await expect(page.locator('#cb-hash')).toHaveText('—');
    await expect(page.locator('#ca-verify')).toBeEmpty();
  },
  drive: async (page, at) => {
    await page.locator('#c-btn-commit').click();
    await expect(page.locator('#c-btn-reveal')).toBeEnabled({ timeout: 60_000 });
    await expect(page.locator('#ca-hash')).not.toHaveText('—');
    await scan(page, at('bids committed as SHA-256 digests'));

    // Submit stays disabled after a reveal — the machine is in `revealed`, not
    // `idle` — so the completion signal is the verification output appearing.
    await page.locator('#c-btn-reveal').click();
    await expect(page.locator('#ca-verify')).not.toBeEmpty({ timeout: 60_000 });
    await expect(page.locator('#cb-verify')).not.toBeEmpty();
    await scan(page, at('bids revealed, openings verified'));

    await page.locator('#c-btn-reset').click();
    await expect(page.locator('#ca-hash')).toHaveText('—');
    await scan(page, at('reset'));

    // The binding failure, which needs a fresh commitment underneath it.
    await page.locator('#c-btn-commit').click();
    await expect(page.locator('#c-btn-cheat')).toBeEnabled({ timeout: 60_000 });
    await page.locator('#c-btn-cheat').click();
    await expect(page.locator('#ca-verify')).toContainText('CAUGHT', { timeout: 60_000 });
    await scan(page, at('bidder A cheats, commitment mismatch caught'));

    await page.locator('#c-btn-reset').click();
    await expect(page.locator('#ca-hash')).toHaveText('—');
    await scan(page, at('reset after the cheat'));
  },
};

/** Exhibit 05 — Fiat-Shamir. Generate, tamper, reset. */
const FIAT_SHAMIR: PageSpec = {
  path: 'exhibits/fiat-shamir.html',
  label: 'fiat-shamir',
  firstPaint: async (page) => {
    await expect(page.locator('#fs-result')).toHaveText('Ready.');
    await expect(page.locator('#fs-c')).toHaveText('—');
    await expect(page.locator('#fs-copy-btn')).toBeDisabled();
  },
  drive: async (page, at) => {
    await page.locator('#fs-run-btn').click();
    await expect(page.locator('#fs-copy-btn')).toBeEnabled({ timeout: 60_000 });
    await expect(page.locator('#fs-c')).not.toHaveText('—');
    await expect(page.locator('#fs-log .lok').first()).toBeVisible();
    await scan(page, at('non-interactive proof generated and verified'));

    await page.locator('#fs-tamper-btn').click();
    await expect(page.locator('#fs-run-btn')).toBeEnabled({ timeout: 60_000 });
    await expect(page.locator('#fs-log .lerr').first()).toBeVisible();
    await scan(page, at('message tampered, re-derived challenge no longer matches'));

    await page.locator('#fs-reset-btn').click();
    await expect(page.locator('#fs-c')).toHaveText('—');
    await scan(page, at('reset'));
  },
};

/** Exhibit 06 — the toy SNARK pipeline. Prove, tamper the public input, reset. */
const SNARK: PageSpec = {
  path: 'exhibits/snark.html',
  label: 'snark',
  firstPaint: async (page) => {
    await expect(page.locator('#snark-result')).toHaveText('Ready.');
    await expect(page.locator('#snark-digest')).toHaveText('—');
    await expect(page.locator('#snark-tamper-btn')).toBeDisabled();
  },
  drive: async (page, at) => {
    await page.locator('#snark-run-btn').click();
    await expect(page.locator('#snark-tamper-btn')).toBeEnabled({ timeout: 60_000 });
    await expect(page.locator('#snark-digest')).not.toHaveText('—');
    await scan(page, at('toy proof generated and verified'));

    await page.locator('#snark-tamper-btn').click();
    await expect(page.locator('#snark-run-btn')).toBeEnabled({ timeout: 60_000 });
    await expect(page.locator('#snark-log .lerr').first()).toBeVisible();
    await scan(page, at('public input tampered, verification rejects'));

    await page.locator('#snark-reset-btn').click();
    await expect(page.locator('#snark-digest')).toHaveText('—');
    await scan(page, at('reset'));
  },
};

/**
 * The transcript replay lab.
 *
 * Four states the exhibits themselves never produce: the "no transcript stored"
 * miss, an invalid-JSON parse failure, a completed comparison with its
 * field-level delta, and the swapped view. Nothing is planted in
 * `localStorage` to reach them — the miss is driven by pressing Load with an
 * empty store, exactly as a first-time visitor does, and the comparison by
 * typing transcripts into the textareas, which is what the placeholder text
 * invites.
 */
const TRANSCRIPT_LAB: PageSpec = {
  path: 'exhibits/transcript-lab.html',
  label: 'transcript-lab',
  firstPaint: async (page) => {
    await expect(page.locator('#left-view')).toHaveText('No transcript loaded.');
    await expect(page.locator('#right-view')).toHaveText('No transcript loaded.');
    await expect(page.locator('#compare-result')).toHaveText('Comparison output will appear here.');
    await expect(page.locator('#left-input')).toHaveValue('');
  },
  drive: async (page, at) => {
    // Nothing has ever been stored by this browser profile, so Load misses.
    await page.locator('#left-load-schnorr').click();
    await expect(page.locator('#left-view')).toContainText('No transcript found at');
    await scan(page, at('load from an empty transcript store'));

    // Comparing with one side empty is its own rendering.
    await page.locator('#left-input').fill(LEFT_TRANSCRIPT);
    await page.locator('#compare-btn').click();
    await expect(page.locator('#compare-result')).toContainText('Comparison incomplete');
    await scan(page, at('comparison attempted with only one side loaded'));

    await page.locator('#right-input').fill('{ not json');
    await page.locator('#compare-btn').click();
    await expect(page.locator('#compare-result')).toContainText('Invalid JSON');
    await scan(page, at('invalid JSON rejected'));

    await page.locator('#right-input').fill(RIGHT_TRANSCRIPT);
    await page.locator('#compare-btn').click();
    await expect(page.locator('#compare-result')).toContainText('Verification outcome');
    await expect(page.locator('#delta-view')).not.toContainText('will appear here');
    await scan(page, at('two transcripts compared, delta rendered'));

    await page.locator('#swap-btn').click();
    await expect(page.locator('#left-input')).toHaveValue(RIGHT_TRANSCRIPT);
    await scan(page, at('sides swapped'));

    await page.locator('#clear-btn').click();
    await expect(page.locator('#left-view')).toHaveText('No transcript loaded.');
    await expect(page.locator('#compare-result')).toHaveText('Comparison output will appear here.');
    await scan(page, at('cleared'));
  },
};

/**
 * Two transcripts in the shape the Schnorr and Fiat-Shamir exhibits emit, so
 * the comparison renders every row it has — protocol, mode, verification
 * outcome, the R/c/s field table, the Fiat-Shamir challenge re-derivation and
 * the tamper timeline. A single-protocol pair would leave half of them at
 * "n/a" and half the report unmeasured. The values are the exhibits' own
 * published parameters (g=5, p=2053), so the re-derivation line computes for
 * real rather than short-circuiting on missing fields.
 */
const LEFT_TRANSCRIPT = JSON.stringify(
  {
    protocol: 'Schnorr identification',
    mode: 'honest',
    parameters: { g: 5, p: 2053, y: 375 },
    transcript: { R: 1234, c: 27, s: 981, lhs: 1699, rhs: 1699, verified: true },
    note: 'Accepted run captured for replay.',
  },
  null,
  2
);

const RIGHT_TRANSCRIPT = JSON.stringify(
  {
    protocol: 'Fiat-Shamir (non-interactive)',
    mode: 'tampered',
    message: 'transfer 10 coins to alice',
    parameters: { g: 5, p: 2053, y: 375 },
    transcript: { R: 1234, c: 41, s: 512, lhs: 88, rhs: 1699, verified: false },
    note: 'Message edited after the challenge was derived — tamper path.',
  },
  null,
  2
);

/**
 * The scenario-presets index.
 *
 * A page of links and nothing else — no buttons, no live regions, no state to
 * drive. It is in the gate because it ships, carries the same header, nav,
 * banners and card grid as everything else, and its links are the entry points
 * to every seeded walkthrough. The one thing it has that no other page does is
 * a `.card` grid whose members are focusable links, so the focused rendering is
 * scanned.
 */
const SCENARIO_PRESETS: PageSpec = {
  path: 'exhibits/scenario-presets.html',
  label: 'scenario-presets',
  firstPaint: async (page) => {
    await expect(page.locator('.card').first()).toBeVisible();
    // The only control on the page is the theme toggle `js/main.js` injects
    // into every `.site-header`; there is nothing else here to drive.
    await expect(page.locator('button')).toHaveCount(1);
    await expect(page.locator('button.theme-toggle')).toBeVisible();
  },
  drive: async (page, at) => {
    await page.locator('.card').first().focus();
    await scan(page, at('first preset card focused'));
    await page.locator('.nav-link').first().focus();
    await scan(page, at('nav link focused'));
    await page.locator('button.theme-toggle').focus();
    await scan(page, at('theme toggle focused'));
  },
};

export const PAGES: PageSpec[] = [
  LOBBY,
  CAVE,
  GRAPH,
  SCHNORR,
  COMMIT,
  FIAT_SHAMIR,
  SNARK,
  TRANSCRIPT_LAB,
  SCENARIO_PRESETS,
];
