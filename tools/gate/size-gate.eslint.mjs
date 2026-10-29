// Size & complexity gate (blocking). Reusable ESLint 9 flat-config fragment.
// Verbatim copy of the reviewer's ultron-tools size-gate config.
//
// Use in a project (eslint.config.mjs):
//   import sizeGate from "./tools/gate/size-gate.eslint.mjs";
//   export default [ /* your config */, ...sizeGate ];
// or, to keep your own parser settings, only the rules:
//   import { sizeGateRulesConfig } from "./tools/gate/size-gate.eslint.mjs";  export default [ ...yours, sizeGateRulesConfig ];
// Or alone:  eslint --no-config-lookup --config tools/gate/size-gate.eslint.mjs .
//
// Every rule is an error. Tests and generated/build output are exempt (scoped `ignores`, so this
// fragment never hides those files from the rest of a config). Add more exempt globs with
//   SIZE_GATE_EXEMPT="dist-legacy/**,public/index.html"   (comma-separated, relative to the lint cwd)
// Plugins resolve from the installing project's node_modules.
import sonarjs from "eslint-plugin-sonarjs";
import html from "eslint-plugin-html";
import tseslint from "typescript-eslint";

export const LIMITS = Object.freeze({
  maxLinesPerFile: 400, maxLinesPerFunction: 60, maxStatements: 25, complexity: 12,
  maxDepth: 4, maxParams: 4, cognitiveComplexity: 15,
});

export const TEST_GLOBS = [
  "**/test/**", "**/tests/**", "**/__tests__/**", "**/__mocks__/**", "**/e2e/**", "**/cypress/**", "**/playwright/**",
  "**/*.test.*", "**/*.spec.*", "**/*.e2e.*", "**/test-*.{js,mjs,cjs}", "**/*.stories.*",
];
export const GENERATED_GLOBS = [
  "**/node_modules/**", "**/dist/**", "**/build/**", "**/builds/**", "**/out/**", "**/coverage/**", "**/.vite/**",
  "**/.next/**", "**/.nuxt/**", "**/.svelte-kit/**", "**/storybook-static/**", "**/vendor/**", "**/generated/**",
  "**/*.min.{js,mjs,cjs}", "**/*.bundle.{js,mjs,cjs}", "**/*.generated.*", "**/*.gen.*", "**/*.d.ts",
];
const extra = (process.env.SIZE_GATE_EXEMPT || "").split(",").map(s => s.trim()).filter(Boolean);
export const EXEMPT_GLOBS = [...TEST_GLOBS, ...GENERATED_GLOBS, ...extra];
export const SOURCE_GLOBS = ["**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}", "**/*.{html,htm}"];

const L = LIMITS;
export const sizeGateRules = {
  "max-lines": ["error", { max: L.maxLinesPerFile, skipBlankLines: true, skipComments: true }],
  "max-lines-per-function": ["error", { max: L.maxLinesPerFunction, skipBlankLines: true, skipComments: true, IIFEs: false }],
  "max-statements": ["error", L.maxStatements, { ignoreTopLevelFunctions: false }],
  complexity: ["error", L.complexity],
  "max-depth": ["error", L.maxDepth],
  "max-params": ["error", L.maxParams],
  "sonarjs/cognitive-complexity": ["error", L.cognitiveComplexity],
};

// Rules-only block: append to an existing config without changing how it parses files.
// It registers no plugins; the host config must already register eslint-plugin-sonarjs as "sonarjs".
export const sizeGateRulesConfig = { name: "size-gate/rules", files: SOURCE_GLOBS, ignores: EXEMPT_GLOBS, rules: sizeGateRules };

// Standalone config (parsing + rules).
export default [
  { ...sizeGateRulesConfig, name: "size-gate/source", plugins: { sonarjs, html }, languageOptions: { ecmaVersion: "latest", sourceType: "module" } },
  // ES modules by default (plain browser scripts parse fine as modules); CommonJS for .cjs.
  { name: "size-gate/cjs", files: ["**/*.cjs"], ignores: EXEMPT_GLOBS, languageOptions: { sourceType: "commonjs" } },
  { name: "size-gate/ts", files: ["**/*.{ts,mts,cts,tsx}"], ignores: EXEMPT_GLOBS,
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } } },
  { name: "size-gate/jsx", files: ["**/*.jsx"], ignores: EXEMPT_GLOBS, languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } },
];
