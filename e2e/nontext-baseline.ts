/**
 * Known WCAG 1.4.11 / generated-content findings in this lab, captured through
 * the gate's own path so the baseline and the check cannot disagree.
 *
 * THIS FILE IS A TO-DO LIST, NOT A SET OF EXEMPTIONS. A finding not listed here
 * fails the run; a listed finding that gets WORSE fails; and a listed finding
 * that no longer appears ALSO fails, so a fixed entry must be deleted and the
 * file can only shrink toward empty.
 *
 * It has shrunk from 27 entries to 1. `--bord-ctl` gave every secondary button,
 * danger button, textarea and select a boundary that clears 3:1, so those 25
 * entries were fixed rather than excused. The `.theme-toggle` at 1.17:1 went
 * with the toggle itself, deleted along with the theme machinery that drew it.
 * The one left is the shared header's `.cl-btn` at 2.45:1, whose CSS lives in
 * the header block every lab carries.
 */
export const NONTEXT_BASELINE: Record<
  string,
  { ratio: number; required: number; unverified: boolean }
> = {
  "control-boundary|a.cl-btn": { ratio: 2.45, required: 3.0, unverified: false }
};
