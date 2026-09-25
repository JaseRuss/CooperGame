import { defineConfig } from 'vite';

export default defineConfig({
  // Relative paths, so the built game works from any folder: locally, and on GitHub Pages
  // where it's served from /CooperGame/.
  base: './',
});
