import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// dist/index.html is fully self-contained (script and CSS inlined), like the earlier single-file builds.
// Minification is off: the autosave worker is built from Function.prototype.toString() of shared helpers,
// and readable output keeps the built file reviewable.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { target: 'es2022', modulePreload: { polyfill: false }, minify: false, cssMinify: false, outDir: 'dist', emptyOutDir: true },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
