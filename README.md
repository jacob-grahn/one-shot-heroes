# one-shot-heroes

[![CI](https://github.com/jacob-grahn/one-shot-heroes/actions/workflows/ci.yml/badge.svg)](https://github.com/jacob-grahn/one-shot-heroes/actions/workflows/ci.yml)

One-Shot Heroes pixel editor workspace.

npm workspaces (private, nothing is published). The editor is a Vite app of plain ES modules; the sprite format,
default palette and animation timing are separate packages.

```
apps/editor/            the editor app
  index.html            page markup (Vite entry)
  src/main.js           boot: imports every module in the original script order, restores autosave
  src/core/             document model, ops, history, file load/save (no DOM)
  src/persist/          autosave worker + journal, editor lock (one editing tab), notices
  src/ui/               canvas, panels, keyboard and pointer input, dialogs
  src/ui/state/         UI state stores (editing context, tool, paint, viewport, selection, ...)
  src/api/              window.pixelEditor public API and the example document
  src/styles/           CSS (its own file)
  test/                 browser suite (test.js), hidden-code scanner, static server runner (run.js)
packages/format/        @osh/format: limits, validation, cel codec, document (de)serialization (subpath exports)
packages/palette/       @osh/palette: the default palette (first colour #1a1c2c)
packages/timing/        @osh/timing: animation timing (15 fps)
packages/net-wire/      @osh/net-wire: sync protocol, manifest, quantization (no transport)
packages/net-core/      @osh/net-core: in-game realtime sync (host tick, deltas, interpolation)
packages/net-sim/       @osh/net-sim: transport interface and the in-process simulated network
packages/net-mediator/  @osh/net-mediator: host-page byte and entity caps (not imported by net-core)
packages/net-examples/  dots arena and a vote-driven text adventure on the sim
tools/gate/             verbatim copies of the reviewer's gate configs (size gate, structure rules, fta)
tools/mi.mjs            maintainability index per module (report only)
```

## Commands (run from this folder)

| command | what it does |
|---|---|
| `npm install` | install dev dependencies (local only) |
| `npm run dev` | Vite dev server on http://127.0.0.1:5173 |
| `npm run build` | static build to `apps/editor/dist/` (one self-contained `index.html`, script and CSS inlined) |
| `npm run preview` | serve the build on port 4173 |
| `npm test` | build, then run the browser suite against `dist/` over a local static http server (`apps/editor/test/run.js`) |
| `npm run test:net` | node tests for the sync engine (wire, sim, mediator, examples) |
| `npm run bench:net` | encode-time benchmark at 8 players and 500 entities |
| `npm run typecheck` | `tsc` with `checkJs` over app and package sources (JSDoc types, `jsconfig.json`) |
| `npm run lint` | eslint correctness rules plus the size gate, then the size gate standalone with the reviewer's config |
| `npm run deps` | dependency-cruiser: the reviewer's structure rules (`deps:gate`) and this repo's own rules (`deps:local`) |
| `npm run mi` | maintainability index per module (fta-cli, same formula as the reviewer's size gate) |
| `npm run check` | typecheck + lint + deps |

The browser suite needs Chrome (`CHROME`, default `/usr/bin/google-chrome`) and uses the `playwright-core` dev dependency
(or `PLAYWRIGHT_CORE=/path`). It takes about 7 to 8 minutes; it includes two multi-tab freeze tests of about 11 s each.

## Rules the gates enforce

- Size: files ≤ 400 lines, functions ≤ 60 lines, ≤ 25 statements, cyclomatic ≤ 12, cognitive ≤ 15, nesting ≤ 4, ≤ 4 params
  (tests and generated files exempt).
- Structure: no cycles, no orphans, core does not import UI or DOM packages, packages do not import apps, no unresolvable
  imports, production code does not import tests, fan-in ≤ 10 except the allow-listed shared modules
  (`STRUCTURE_SHARED` in the `deps:gate` script; reasons in `../restructure/NOTES-for-reviewers.md`).
  `@osh/net-core` does not import the mediator or the sim. The mediator does not import `@osh/net-core`.

## CI

Pushes to `main` and pull requests run [`.github/workflows/ci.yml`](.github/workflows/ci.yml). Each check is its own job: typecheck, lint (`eslint .`, size and complexity gate, format-based size gate), dependency structure, maintainability index, build (the built `dist/index.html` is uploaded), the browser suite on its own runner, the sync-engine tests and encode benchmark (`npm run test:net`, `npm run bench:net`), gitleaks over the full history, `npm audit --audit-level=high`, dependency review on pull requests, and actionlint. `npm run mi` reports scores and does not fail when a module is under 10. Dependency review runs only after [Dependency graph](https://github.com/jacob-grahn/one-shot-heroes/settings/security_analysis) is enabled; until then that job skips with a note.

The sync engine's defaults and the transport split are in [DESIGN.md](DESIGN.md). The editor is unchanged.

## Notes

- Minification is off in the build: the autosave worker is created from `Function.prototype.toString()` of shared helpers
  (`src/persist/worker-source.js`), and the readable output keeps the built file reviewable.
- `src/main.js` keeps side-effect imports in the order the original single script ran, so module initialisation order
  (event listeners, timers) is unchanged.
