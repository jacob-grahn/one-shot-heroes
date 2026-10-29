/** Dependency rules for the One Shot Heroes workspace (npm run deps). */
module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', comment: 'No import cycles.', from: {}, to: { circular: true } },
    {
      name: 'no-orphans', severity: 'error', comment: 'Every module is reachable (imported or an entry point).',
      from: { orphan: true, pathNot: ['(^|/)\\.[^/]+\\.(c|m)?js$', '\\.config\\.(c|m)?js$', '(^|/)test/', '(^|/)dist/', '^apps/editor/src/main\\.js$', '^packages/[^/]+/src/index\\.js$'] },
      to: {},
    },
    {
      name: 'core-not-ui', severity: 'error', comment: 'The DOM-free core must not import UI, persistence or API modules.',
      from: { path: '^apps/editor/src/core/' }, to: { path: '^apps/editor/src/(ui|persist|api)/|^apps/editor/src/main\\.js$' },
    },
    {
      name: 'persist-not-ui-panels', severity: 'error', comment: 'Persistence uses only the UI shell services (dom, state, notify, notice, hooks, canvases), never panels or tools.',
      from: { path: '^apps/editor/src/persist/' },
      to: { path: '^apps/editor/src/(ui|api)/', pathNot: '^apps/editor/src/ui/(dom|state/[a-z-]+|toast|announce|notice|hooks|canvases)\\.js$' },
    },
    { name: 'packages-not-apps', severity: 'error', comment: 'Shared packages never import an app.', from: { path: '^packages/' }, to: { path: '^apps/' } },
    {
      name: 'runtime-not-editor', severity: 'error', comment: 'Placeholder for the future game runtime / sandbox: it may use packages/*, never the editor.',
      from: { path: '^(packages/runtime|apps/sandbox)/' }, to: { path: '^apps/editor/' },
    },
    {
      name: 'fan-in-limit', severity: 'error',
      comment: 'No module has more than 10 importers unless it is a deliberate shared module (listed in restructure/NOTES-for-reviewers.md).',
      from: {},
      module: {
        numberOfDependentsMoreThan: 10,
        pathNot: '^apps/editor/src/(ui/dom|ui/state/context|core/editor-core)\\.js$|^packages/format/src/(validate|limits)\\.js$',
      },
    },
    {
      name: 'net-core-not-mediator', severity: 'error',
      comment: 'The in-game library must not import the host-page mediator. The game can tamper with the in-game library.',
      from: { path: '^packages/net-core/src/' }, to: { path: '^packages/net-mediator/' },
    },
    {
      name: 'net-core-not-sim', severity: 'error',
      comment: 'net-core is transport-agnostic. The simulated transport, and later WebRTC, is injected.',
      from: { path: '^packages/net-core/src/' }, to: { path: '^packages/net-sim/' },
    },
    {
      name: 'net-mediator-not-core', severity: 'error',
      comment: 'The mediator parses the wire format itself so a tampered in-game library cannot raise its caps.',
      from: { path: '^packages/net-mediator/' }, to: { path: '^packages/net-core/' },
    },
    {
      name: 'net-wire-pure', severity: 'error',
      comment: 'The wire codec has no session, transport, mediator, or editor dependency.',
      from: { path: '^packages/net-wire/' }, to: { path: '^packages/(net-core|net-sim|net-mediator)/|^apps/' },
    },
    {
      name: 'net-sim-transport-only', severity: 'error',
      comment: 'The simulated transport moves bytes. It does not import the game library, the wire codec, or the mediator.',
      from: { path: '^packages/net-sim/' }, to: { path: '^packages/(net-core|net-wire|net-mediator)/|^apps/' },
    },
    { name: 'no-dev-deps-in-src', severity: 'error', from: { path: '^(apps|packages)/[^/]+/src/' }, to: { dependencyTypes: ['npm-dev'] } },
    { name: 'not-to-unresolvable', severity: 'error', from: {}, to: { couldNotResolve: true } },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(node_modules|dist)/' },
    includeOnly: '^(apps|packages)/',
    moduleSystems: ['es6', 'cjs'],
    tsPreCompilationDeps: false,
    combinedDependencies: true,
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'default'], mainFields: ['module', 'main'] },
  },
};
