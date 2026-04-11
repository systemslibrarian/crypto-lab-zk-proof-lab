import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: '/crypto-lab-zk-proof-lab/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        cave: resolve(__dirname, 'exhibits/cave.html'),
        commitReveal: resolve(__dirname, 'exhibits/commit-reveal.html'),
        fiatShamir: resolve(__dirname, 'exhibits/fiat-shamir.html'),
        graphColoring: resolve(__dirname, 'exhibits/graph-coloring.html'),
        scenarioPresets: resolve(__dirname, 'exhibits/scenario-presets.html'),
        schnorr: resolve(__dirname, 'exhibits/schnorr.html'),
        snark: resolve(__dirname, 'exhibits/snark.html'),
        transcriptLab: resolve(__dirname, 'exhibits/transcript-lab.html'),
        logicSmoke: resolve(__dirname, 'tests/logic-smoke.html'),
        qualityGates: resolve(__dirname, 'tests/quality-gates.html'),
      },
    },
  },
});
