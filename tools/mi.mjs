// Maintainability index per module, computed the same way as the reviewer's size gate:
// fta-cli per-file Halstead volume (V), cyclomatic (G) and line count (L), then
// MI = max(0, (171 - 5.2 ln V - 0.23 G - 16.2 ln L) * 100 / 171). 0-100; >=20 good, 10-19 moderate, <10 hard.
// Usage: node tools/mi.mjs [--json]   (report only)
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FTA = path.join(WS, 'node_modules/.bin/fta');
const CONF = path.join(WS, 'tools/gate/fta.json');
const DIRS = [
  'apps/editor/src', 'packages/format/src', 'packages/palette/src', 'packages/timing/src',
  'packages/net-wire/src', 'packages/net-core/src', 'packages/net-sim/src', 'packages/net-mediator/src', 'packages/net-examples/src',
];
const mi = (V, G, L) => Math.max(0, (171 - 5.2 * Math.log(Math.max(V, 1)) - 0.23 * G - 16.2 * Math.log(Math.max(L, 1))) * 100 / 171);

const rows = DIRS.flatMap(dir => {
  const r = spawnSync(FTA, [path.join(WS, dir), '-c', CONF, '--json'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error('fta failed for ' + dir + ': ' + r.stderr);
  return JSON.parse(r.stdout).map(x => ({
    file: path.join(dir, x.file_name.replace(/^\.?\//, '')), lines: x.line_count, cyclo: x.cyclo,
    volume: Math.round(x.halstead.volume), mi: +mi(x.halstead.volume, x.cyclo, x.line_count).toFixed(1), fta: +x.fta_score.toFixed(1),
  }));
}).sort((a, b) => a.mi - b.mi);

if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 1));
else {
  console.log('MI     FTA    lines cyclo  file');
  for (const r of rows) console.log(`${r.mi.toFixed(1).padStart(5)}  ${r.fta.toFixed(1).padStart(5)}  ${String(r.lines).padStart(5)} ${String(r.cyclo).padStart(5)}  ${r.file}`);
  const low = rows.filter(r => r.mi < 10);
  console.log(`${rows.length} modules; min MI ${rows[0].mi}; ${low.length} below 10`);
}
