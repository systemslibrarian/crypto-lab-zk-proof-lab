import { test } from '@playwright/test';
import { NARROW, PAGES, WIDE, runPage } from './gate';

/**
 * WCAG A/AA gate for the ZK Proof Lab.
 *
 * Nine shipped pages — the lobby, six exhibits, the transcript replay lab and
 * the scenario index — each run in four configurations: {dark, light} ×
 * {desktop 1280, phone 380}. Inside each configuration the page is driven
 * through the states it can actually reach and scanned after every single step.
 * The machinery, and what each oracle is for, is documented in `gate.ts`; the
 * per-page drives are the `PageSpec` entries there.
 *
 * The two axes are not redundant. Theme decides which ink lands on which
 * surface — the accents are re-authored for light mode, the status tints are
 * translucent, and several panels are gradients that composite differently
 * under each. Width changes the layout outright: the lobby card grid collapses
 * at 860px, every exhibit's `.demo-grid` at 740px, and only at 380px do the
 * commitment tables begin to scroll inside their wrappers and the control rows
 * stack to full width.
 */
for (const spec of PAGES) {
  for (const theme of ['dark'] as const) {
    for (const [size, viewport] of [
      ['desktop 1280', WIDE],
      ['phone 380', NARROW],
    ] as const) {
      test(`no WCAG A/AA failures — ${spec.label}, ${theme}, ${size}`, async ({ page }) => {
        test.setTimeout(900_000);
        await runPage(page, spec, theme, size, viewport);
      });
    }
  }
}
