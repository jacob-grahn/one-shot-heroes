# one-shot-heroes

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

## Notes

- Minification is off in the build: the autosave worker is created from `Function.prototype.toString()` of shared helpers
  (`src/persist/worker-source.js`), and the readable output keeps the built file reviewable.
- `src/main.js` keeps side-effect imports in the order the original single script ran, so module initialisation order
  (event listeners, timers) is unchanged.
