/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The iPhone app draws edge to edge (around the notch); the website leaves that to the browser,
// since newer Safari otherwise puts the page under its toolbar.
const viewport: Plugin = {
  name: 'viewport',
  transformIndexHtml: (html) => {
    const out = process.env.VITE_NATIVE ? html : html.replace(', viewport-fit=cover', '');
    // Link previews (og:url, og:image) point at wherever this copy of the game lives.
    const site = process.env.VITE_GAME_URL;
    return site ? out.replaceAll('https://onthedcl.github.io/word-game-/', site) : out;
  },
};

export default defineConfig({
  // GitHub Pages serves project sites from /<repo>/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss(), viewport],
  worker: { format: 'es' },
  test: {
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    testTimeout: 30000,
  },
});
