import { defineConfig } from '@playwright/test';

/**
 * E2E accessibility gate. Tests run against the production build served by
 * `vite preview`, so what passes here is what actually ships to Pages.
 * Run `npm run build` first (CI does).
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  webServer: {
    command: 'npm run preview -- --port 4342 --strictPort',
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
