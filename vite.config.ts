/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The iPhone app draws edge to edge (around the notch); the website leaves that to the browser,
// since newer Safari otherwise puts the page under its toolbar.
const viewport: Plugin = {
  name: 'viewport',
  transformIndexHtml: (html) =>
    process.env.VITE_NATIVE ? html : html.replace(', viewport-fit=cover', ''),
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
