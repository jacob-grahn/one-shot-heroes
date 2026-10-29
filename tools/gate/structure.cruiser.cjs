/**
 * Module-structure gate for dependency-cruiser (blocking rules are severity "error").
 *
 * Verbatim copy of the reviewer's ultron-tools structure config.
 * Use:  depcruise --config tools/gate/structure.cruiser.cjs --output-type err-long src
 * Or extend it from a project's .dependency-cruiser.cjs:
 *   module.exports = { extends: "./tools/gate/structure.cruiser.cjs", forbidden: [ ... ] };
 *
 * Layer paths are regular expressions (matched against paths relative to the cruise cwd) and can be
 * overridden per project with environment variables, so the same ruleset fits different layouts:
 *   STRUCTURE_CORE      model / domain / pure logic        (default: (^|/)(core|model|models|domain|lib/core|engine|state|store)(/|$))
 *   STRUCTURE_UI        UI / DOM / view code               (default: (^|/)(ui|dom|view|views|components|widgets|pages|render|renderer)(/|$))
 *   STRUCTURE_SANDBOX   sandbox / runtime / worker code    (default: (^|/)(sandbox|runtime|workers?|plugin-host)(/|$))
 *   STRUCTURE_EDITOR    editor application code            (default: (^|/)(editor|app|ui)(/|$))
 *   STRUCTURE_SHARED    allow-listed shared utils (fan-in limit doesn't apply)
 *                       (default: (^|/)(utils?|shared|common|helpers|constants|types)(/|$)|(^|/)(utils?|constants|types)\.[cm]?[jt]sx?$)
 *   STRUCTURE_FAN_IN    max number of modules that may depend on one module (default 10)
 *   STRUCTURE_EXEMPT    paths never checked (default: tests, configs, generated/build output, type declarations)
 */
const env = (k, d) => (process.env[k] && process.env[k].trim()) || d;
const CORE = env("STRUCTURE_CORE", "(^|/)(core|model|models|domain|lib/core|engine|state|store)(/|$)");
const UI = env("STRUCTURE_UI", "(^|/)(ui|dom|view|views|components|widgets|pages|render|renderer)(/|$)");
const SANDBOX = env("STRUCTURE_SANDBOX", "(^|/)(sandbox|runtime|workers?|plugin-host)(/|$)");
const EDITOR = env("STRUCTURE_EDITOR", "(^|/)(editor|app|ui)(/|$)");
const SHARED = env("STRUCTURE_SHARED", "(^|/)(utils?|shared|common|helpers|constants|types)(/|$)|(^|/)(utils?|constants|types)\\.[cm]?[jt]sx?$");
const FAN_IN = Number(env("STRUCTURE_FAN_IN", "10"));
const EXEMPT = env("STRUCTURE_EXEMPT",
  "(^|/)(node_modules|dist|build|builds|out|coverage|\\.vite|vendor|generated)(/|$)|(^|/)(test|tests|__tests__|__mocks__|e2e)(/|$)|\\.(test|spec|e2e|stories)\\.[cm]?[jt]sx?$|\\.d\\.ts$|(^|/)[^/]*\\.config\\.[cm]?[jt]s$|(^|/)\\.[^/]+\\.[cm]?js$");
// DOM-only packages a core layer must not pull in either
const DOM_PACKAGES = env("STRUCTURE_DOM_PACKAGES", "^(react|react-dom|preact|vue|svelte|solid-js|lit|jquery|@testing-library/.*)(/|$)");

module.exports = {
  forbidden: [
    { name: "no-circular", severity: "error",
      comment: "Circular imports make load order fragile and modules impossible to reason about in isolation.",
      from: { pathNot: EXEMPT }, to: { circular: true } },
    { name: "no-orphans", severity: "error",
      comment: "A module nothing imports and that imports nothing is dead code, or code glued together by concatenation/globals instead of imports.",
      from: { orphan: true, pathNot: [EXEMPT, "\\.(json|css|scss|html|svg|png|md)$"] }, to: {} },
    { name: "core-not-ui", severity: "error",
      comment: "Core/model code must stay DOM-free so it can be tested headless and reused (worker, server, CLI).",
      from: { path: CORE, pathNot: EXEMPT }, to: { path: UI } },
    { name: "core-not-dom-packages", severity: "error",
      comment: "Core/model code must not depend on UI frameworks.",
      from: { path: CORE, pathNot: EXEMPT }, to: { dependencyTypes: ["npm", "npm-dev", "npm-peer", "npm-optional"], path: DOM_PACKAGES } },
    { name: "sandbox-not-editor", severity: "error",
      comment: "Sandbox/runtime code runs untrusted or isolated work; it must not import editor/app code (only shared utils and core).",
      from: { path: SANDBOX, pathNot: EXEMPT }, to: { path: EDITOR, pathNot: [SANDBOX, SHARED] } },
    { name: "max-fan-in", severity: "error",
      comment: `A module with more than ${FAN_IN} dependents is a hidden hub; split it or allow-list it as a shared util (STRUCTURE_SHARED).`,
      module: { pathNot: [EXEMPT, SHARED], numberOfDependentsMoreThan: FAN_IN }, from: { pathNot: EXEMPT } },
    { name: "not-to-unresolvable", severity: "error",
      comment: "Imports that don't resolve are broken builds waiting to happen.",
      from: { pathNot: EXEMPT }, to: { couldNotResolve: true } },
    { name: "not-to-test", severity: "error", comment: "Production code must not import test code.",
      from: { pathNot: EXEMPT }, to: { path: "(^|/)(test|tests|__tests__|__mocks__)(/|$)|\\.(test|spec)\\.[cm]?[jt]sx?$" } },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(node_modules|dist|build|builds|coverage|\\.vite|\\.git)(/|$)" },
    moduleSystems: ["es6", "cjs", "amd"],
    combinedDependencies: false,
    skipAnalysisNotInRules: false,
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "require", "node", "default", "browser"], extensions: [".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".json"] },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
