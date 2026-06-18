import fs from 'node:fs/promises';
import path from 'node:path';
import axe from 'axe-core';
import { chromium } from 'playwright';

const baseUrl = process.env.ZKPL_BASE_URL || 'http://127.0.0.1:8000';
const pages = [
  '/',
  '/exhibits/cave.html',
  '/exhibits/graph-coloring.html',
  '/exhibits/schnorr.html',
  '/exhibits/commit-reveal.html',
  '/exhibits/fiat-shamir.html',
  '/exhibits/snark.html',
  '/exhibits/transcript-lab.html',
  '/exhibits/scenario-presets.html'
];

const reportDir = path.resolve(process.cwd(), 'artifacts');
await fs.mkdir(reportDir, { recursive: true });

const browser = await chromium.launch({ headless: true });

// Audit every page in both color schemes (mobile + desktop) so neither theme
// nor breakpoint can regress accessibility silently.
const viewports = [
  { label: 'desktop', width: 1366, height: 900 },
  { label: 'mobile', width: 375, height: 812 }
];
const colorSchemes = ['light', 'dark'];

const summary = [];
let totalViolations = 0;

for (const colorScheme of colorSchemes) {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      colorScheme
    });
    const page = await context.newPage();

    for (const route of pages) {
      await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' });
      await page.addScriptTag({ content: axe.source });
      const result = await page.evaluate(async () => {
        return window.axe.run(document, {
          runOnly: {
            type: 'tag',
            values: ['wcag2a', 'wcag2aa']
          }
        });
      });

      const violations = result.violations.map(v => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.map(n => ({ target: n.target, failureSummary: n.failureSummary }))
      }));

      const label = `${route} [${colorScheme}/${viewport.label}]`;
      totalViolations += violations.length;
      summary.push({ route, colorScheme, viewport: viewport.label, violationCount: violations.length, violations });

      if (violations.length === 0) {
        console.log(`PASS: ${label} accessibility audit`);
      } else {
        console.error(`FAIL: ${label} accessibility audit (${violations.length} issues)`);
      }
    }

    await context.close();
  }
}

await browser.close();

const outputPath = path.join(reportDir, 'accessibility-report.json');
await fs.writeFile(outputPath, JSON.stringify({ baseUrl, totalViolations, summary }, null, 2));
console.log(`Wrote accessibility report: ${outputPath}`);

if (totalViolations > 0) {
  console.error(`Accessibility audit found ${totalViolations} violations.`);
  process.exit(1);
}

console.log('Accessibility audit passed with zero violations.');
