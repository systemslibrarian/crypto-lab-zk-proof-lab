import { defineConfig } from '@playwright/test';

/**
 * E2E accessibility gate. Tests run against the production build served by
 * `vite preview`, so what passes here is what actually ships to Pages.
 * The build is part of the webServer command below — see the note there.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  webServer: {
    // Build here rather than relying on the caller having run it. `vite preview`
    // only serves whatever is already in dist/, so a failed build would leave the
    // last good bundle on disk and let this gate pass green against source that
    // no longer builds. Note `build` is a bare `vite build`: it catches build
    // breakage, not type errors — `npm run typecheck` remains the type gate.
    command: 'npm run build && npm run preview -- --port 4342 --strictPort',
    url: 'http://localhost:4342/crypto-lab-zk-proof-lab/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { channel: undefined } }],
  use: {
    baseURL: 'http://localhost:4342/crypto-lab-zk-proof-lab/',
    colorScheme: 'dark',
  },
});
