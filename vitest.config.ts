import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node environment: the crypto core (modpow, schnorrVerify, sha256hex)
    // depends only on globalThis.crypto, which Node provides. The e2e/
    // Playwright accessibility suite and the legacy Playwright quality gate
    // are intentionally excluded so `npm test` is the fast, deterministic
    // crypto-correctness gate.
    include: ['tests/unit/**/*.test.ts'],
    exclude: ['e2e/**', 'tests/browser-quality.mjs', 'node_modules/**', 'dist/**'],
  },
});
