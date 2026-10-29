// Lint = correctness rules (eslint:recommended, browser globals) + Ultron's size gate, used unmodified from the
// verbatim copy in tools/gate/size-gate.eslint.mjs (the reviewer's ultron-tools size-gate config).
// The gate also runs standalone in `npm run lint:gate`, exactly as its header documents.
import js from '@eslint/js';
import globals from 'globals';
import sizeGate from './tools/gate/size-gate.eslint.mjs';

export default [
  { ignores: ['**/dist/**', '**/node_modules/**'] },
  js.configs.recommended,
  {
    files: ['apps/**/*.js', 'packages/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser } },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }], 'no-empty': ['error', { allowEmptyCatch: true }] },
  },
  {
    // tests and tooling (CommonJS, Node + browser globals)
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
  },
  {
    // browser suite (CommonJS under apps/editor/test/package.json); page.evaluate callbacks run in the page
    files: ['apps/editor/test/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser, pixelEditor: 'readonly' } },
  },
  {
    // build / lint config modules and Node tooling
    files: ['**/*.config.js', '**/*.mjs'],
    languageOptions: { sourceType: 'module', globals: { ...globals.node } },
  },
  {
    // node tests for the sync engine (the size gate already exempts these paths)
    files: ['packages/**/test/**/*.js'],
    languageOptions: { sourceType: 'module', globals: { ...globals.node } },
  },
  ...sizeGate,
];
