// Headless regression test: node test/test.js
// Needs playwright-core (looked up in ../../.tools/node_modules, then $PLAYWRIGHT_CORE, then require path) and google-chrome.
const path = require('path'), fs = require('fs');
function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT_CORE, 'playwright-core', path.resolve(__dirname, '../../../../.tools/node_modules/playwright-core')].filter(Boolean);
  for (const t of tries) { try { return require(t); } catch (e) { /* next */ } }
  console.error('playwright-core not found. Run npm install in ws/, or set PLAYWRIGHT_CORE=/path/to/playwright-core'); process.exit(2);
}
const { chromium } = loadPlaywright();
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
// The suite runs against the built dist/ served over http by test/run.js (OSH_URL is set there).
const BASE = process.env.OSH_URL || 'http://127.0.0.1:4180/';
const FILE = BASE + 'index.html';
const SHOTS = path.resolve(__dirname, 'screenshots');
const EVIL = path.resolve(__dirname, 'fixtures/evil.osh.json'); // copy of Ultron's stored-XSS repro file (B1)
// Source files scanned by the source-level checks (OSH-22 / R7-NT1 hidden-code scan, R7-NT2): every module of the app and its packages.
const WS_ROOT = path.resolve(__dirname, '../../..');
const walkJs = d => fs.readdirSync(path.join(WS_ROOT, d), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walkJs(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []);
const SRC_FILES = ['apps/editor/src', ...fs.readdirSync(path.join(WS_ROOT, 'packages')).map(p => 'packages/' + p + '/src')].flatMap(walkJs).sort();
let passed = 0;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); passed++; console.log('  ok -', m); };
const section = s => console.log('\n' + s);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--enable-precise-memory-info'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => { errors.push('DIALOG: ' + d.message()); d.dismiss(); });
  const E = (fn, arg) => page.evaluate(fn, arg);
  const boot = async () => { await page.waitForFunction(() => window.pixelEditor); await E(() => pixelEditor.ready); };
  await page.goto(FILE); await boot(); await E(() => pixelEditor.clearAutosave()); await E(() => localStorage.clear()); await page.reload(); await boot();
  const px = (x, y) => E(([x, y]) => pixelEditor.getPixel(x, y), [x, y]);
  const toScreen = async (x, y) => { const s = await E(() => pixelEditor.getState()); const r = await page.locator('#view').boundingBox(); return [r.x + s.panX + (x + 0.5) * s.zoom, r.y + s.panY + (y + 0.5) * s.zoom]; };
  const drag = async (a, b, steps = 4) => { const [sx, sy] = await toScreen(...a), [ex, ey] = await toScreen(...b); await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(ex, ey, { steps }); await page.mouse.up(); };
  const timed = (fn, arg) => E(async ([src, arg]) => { const f = eval('(' + src + ')'); const t = performance.now(); let res; try { res = f(arg); res = res === null ? 'null' : (res && res.op) || 'ok'; } catch (e) { res = 'throws ' + e.message; } return { ms: performance.now() - t, res }; }, [fn.toString(), arg]);

  section('mouse drawing');
  await E(() => pixelEditor.newDocument(32, 32));
  await drag([2, 2], [10, 2], 8);
  assert(await px(2, 2) === 1 && await px(10, 2) === 1 && await px(6, 2) === 1, 'pencil stroke drew a row of primary color');
  assert((await E(() => pixelEditor.getLog().length)) === 1, 'one stroke = one op');
  await page.keyboard.press('g'); let [sx, sy] = await toScreen(20, 20); await page.mouse.click(sx, sy, { button: 'right' });
  assert(await px(20, 20) === 0 && (await E(() => pixelEditor.getLog().length)) === 1, 'm4: right-click fill with transparent on empty is a no-op and is NOT logged');
  await E(() => { document.querySelector('#palette .sw[data-idx="10"]').dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true })); });
  await page.mouse.click(sx, sy);
  assert(await px(31, 31) === 10 && await px(5, 5) === 10 && await px(6, 2) === 1, 'flood fill filled background around the stroke');
  await E(() => { document.querySelector('#palette .sw[data-idx="3"]').dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true })); });
  await page.keyboard.press('l'); await drag([0, 10], [31, 10]);
  assert(await px(15, 10) === 3 && (await E(() => pixelEditor.getLog().length)) === 3, 'line tool works');

  section('undo / redo');
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
  assert(await px(31, 31) === 0 && await px(6, 2) === 1, 'Ctrl+Z twice undid line + fill');
  await page.keyboard.press('Control+Shift+z'); assert(await px(31, 31) === 10, 'Ctrl+Shift+Z redid fill');
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+y'); assert(await px(31, 31) === 10, 'Ctrl+Y redid fill');

  section('API sessions + named animations');
  const r = await E(() => {
    const api = pixelEditor, ai = api.createSession('ai'), me = api.createSession('user'); api.newDocument(16, 16);
    ai.apply({ op: 'rect', x0: 1, y0: 1, x1: 6, y1: 6, color: 3 });
    me.apply({ op: 'add_frame', copyOf: 0 }); me.apply({ op: 'add_frame', copyOf: 0 }); me.apply({ op: 'add_frame' });
    me.apply({ op: 'set_pixels', frame: 3, pixels: [[0, 0, 5]] });
    const ids = api.getMeta().frames.map(f => f.id);
    me.apply({ op: 'add_animation', name: 'walk', frames: ids, mode: 'loop' });
    me.apply({ op: 'add_animation', name: 'idle', frames: [ids[0], ids[1]], mode: 'pingpong' });
    me.apply({ op: 'set_animation', name: 'idle', newName: 'breathe' });
    const d = api.getMeta(); api.undo(); const undone = api.getMeta().animations.map(a => a.name); api.redo();
    let threw = ''; try { me.apply({ op: 'add_animation', name: 'walk' }); } catch (e) { threw = e.code; }
    return { frames: d.frames.length, anims: d.animations.map(a => a.name + ':' + a.frames.length + ':' + a.mode), undone, prov: api.provenance(), threw,
      png: api.renderPNG({ scale: 8, grid: true }).length, pngLabels: api.renderPNG({ scale: 16, labels: true }).length, grid: api.renderTextGrid({ frame: 3 }).split('\n')[0],
      cel: api.getCel(0, 3).pixels.length, hasTopApply: 'apply' in api };
  });
  assert(r.frames === 4, '4 frames'); assert(r.anims.join() === 'walk:4:loop,breathe:2:pingpong', 'named animations created + renamed');
  assert(r.undone.includes('idle'), 'undo reverts rename'); assert(r.threw === 'duplicate' || r.threw.length > 0, 'duplicate animation name rejected (' + r.threw + ')');
  assert(r.prov.label === 'ai' && r.prov.ai && r.prov.counts.ai === 1, 'provenance: AI rect makes the document AI');
  assert(r.png > 200 && r.pngLabels > r.png && r.grid[0] === '5' && r.cel === 256, 'renderPNG (grid + coordinate labels), renderTextGrid, getMeta/getCel (nit)');
  assert(!r.hasTopApply, 'M1: no author-taking top-level apply; writes go through createSession(author)');

  section('B1: stored XSS via author / names');
  const b1 = await E(() => {
    window.__pwned = 0; pixelEditor.newDocument(8, 8); const out = {};
    // Ultron's repro, adapted to sessions: the author field in the op must be ignored, not rendered
    out.logged = pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[0, 0, 1]], author: '<img src=x onerror="window.__pwned++">' }).author;
    try { pixelEditor.createSession('<img src=x onerror="window.__pwned++">'); out.badSession = 'accepted'; } catch (e) { out.badSession = e.code; }
    const s = pixelEditor.createSession('user');
    s.apply({ op: 'add_layer', name: '<img src=x onerror="window.__pwned++">' });
    s.apply({ op: 'add_animation', name: '<img src=x onerror="window.__pwned++">', frames: [0] });
    pixelEditor.preview.select('<img src=x onerror="window.__pwned++">');
    return out;
  });
  await page.waitForTimeout(300);
  const b1dom = await E(() => ({ pwned: window.__pwned, imgs: document.querySelectorAll('#prov img, #layers img, #tlgrid img, #pvAnim img, #mbody img').length, layerText: [...document.querySelectorAll('#layers .name, #layers span')].some(e => e.textContent.includes('<img')), opt: [...document.querySelectorAll('#pvAnim option')].some(o => o.textContent.includes('<img')) }));
  assert(b1.logged === 'user' && b1.badSession === 'bad_author', 'author in op ignored; non-whitelisted session author rejected');
  assert(b1dom.pwned === 0 && b1dom.imgs === 0 && b1dom.opt, 'layer/animation names with HTML render as text (no element injected) ' + JSON.stringify(b1dom));
  // Ultron's evil.osh.json through the real Open (Ctrl+O) file picker, then reload (autosave)
  await E(() => { window.__pwned2 = 0; pixelEditor.newDocument(8, 8); });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]);
  await chooser.setFiles(EVIL); await page.waitForTimeout(400);
  const ev = await E(() => ({ pwned: window.__pwned2 || 0, imgs: document.querySelectorAll('#prov img').length, prov: pixelEditor.provenance(), provText: document.querySelector('#prov').textContent, px: pixelEditor.getPixel(0, 0) }));
  assert(ev.pwned === 0 && ev.imgs === 0, 'evil.osh.json: payload does not fire on Open');
  assert(ev.prov.label === 'unknown' && /unknown provenance/.test(ev.provText) && ev.px === 1, 'evil.osh.json: bad author fails replay → snapshot shown, labelled "unknown provenance"');
  await E(() => pixelEditor.flushAutosave()); await page.reload(); await boot(); await page.waitForTimeout(300);
  const ev2 = await E(() => ({ pwned: window.__pwned2 || 0, imgs: document.querySelectorAll('#prov img').length, label: pixelEditor.provenance().label }));
  assert(ev2.pwned === 0 && ev2.imgs === 0 && ev2.label === 'unknown', 'evil.osh.json: nothing fires after reload; still "unknown" after autosave restore');

  section('M1: provenance forgery');
  const m1 = await E(() => {
    const api = pixelEditor, ai = api.createSession('ai'), out = {}; api.newDocument(16, 16);
    const r1 = ai.apply({ op: 'rect', x0: 0, y0: 0, x1: 7, y1: 7, color: 3, filled: true, author: 'user', ts: 1, seq: 99 });
    out.fieldBeatsSession = r1.author; out.ts = r1.ts > Date.now() - 60000; out.frozenReturn = Object.isFrozen(r1);
    r1.author = 'user'; api.getLog()[0].author = 'user'; try { api.getLog().push({ op: 'x' }); } catch (e) { /* frozen */ }
    out.afterMutation = api.provenance().label;
    let seen = null; const off = api.on(e => { seen = e; }); ai.apply({ op: 'set_pixels', pixels: [[9, 9, 2]] }); off();
    out.listenerFrozen = !!seen && Object.isFrozen(seen) && Object.isFrozen(seen.op);
    out.batch = ai.applyAll([{ op: 'set_pixels', pixels: [[10, 10, 2]], author: 'user' }, { op: 'line', x0: 0, y0: 15, x1: 15, y1: 15, color: 4, author: 'user' }]).ops.map(o => o.author);
    out.counts = api.provenance().counts;
    out.coreGlobal = typeof Core; out.coreOnWindow = 'Core' in window; out.sGlobal = typeof S;
    out.apiFrozen = Object.isFrozen(api); const orig = api.provenance; api.provenance = () => ({ label: 'human' }); try { delete window.pixelEditor; } catch (e) { /* non-configurable */ }
    out.provReplaced = window.pixelEditor.provenance !== orig; try { window.pixelEditor = {}; } catch (e) { /* */ } out.windowReplaced = !window.pixelEditor.createSession;
    return out;
  });
  assert(m1.fieldBeatsSession === 'ai' && m1.ts && m1.frozenReturn, 'op.author/ts/seq overwritten by the session; returned op frozen');
  assert(m1.afterMutation === 'ai', 'mutating returned op / getLog() cannot flip the label');
  assert(m1.listenerFrozen, 'on() listeners receive frozen copies');
  assert(m1.batch.every(a => a === 'ai') && m1.counts.ai === 4, 'batch sub-op authors forced to the session and counted (' + JSON.stringify(m1.counts) + ')');
  assert(m1.coreGlobal === 'undefined' && !m1.coreOnWindow && m1.sGlobal === 'undefined', 'Core/S are private (IIFE)');
  assert(m1.apiFrozen && !m1.provReplaced && !m1.windowReplaced, 'pixelEditor frozen, non-writable, non-configurable');
  const m1load = await E(() => {
    const api = pixelEditor, out = {}; api.newDocument(8, 8); api.createSession('ai').apply({ op: 'set_pixels', pixels: [[1, 1, 3]] });
    const good = api.save();
    const broken = JSON.parse(JSON.stringify(good)); broken.ops = [{ op: 'bogus' }]; out.broken = api.load(broken); out.brokenLabel = api.provenance().label;
    const baseSwap = JSON.parse(JSON.stringify(good)); baseSwap.base = baseSwap.document; baseSwap.ops = []; baseSwap.cursor = 0; api.load(baseSwap); out.baseSwapLabel = api.provenance().label;
    const relabel = JSON.parse(JSON.stringify(good)); relabel.ops[0].author = 'AI-agent'; api.load(relabel); out.oddAuthorLabel = api.provenance().label;
    api.load(good); out.goodLabel = api.provenance().label;
    return out;
  });
  assert(m1load.broken.replayed === false && m1load.brokenLabel === 'ai', 'broken op log on load → falls back to the snapshot, whose saved pixel tags still say AI');
  assert(m1load.baseSwapLabel === 'ai' && m1load.oddAuthorLabel === 'ai' && m1load.goodLabel === 'ai', 'pixel tags travel in base/document, so every load path keeps the AI mark');
  // UI clipboard laundering (Ultron): AI art → Ctrl+A, Ctrl+C → New → Ctrl+V → Enter
  await E(() => { pixelEditor.newDocument(16, 16); pixelEditor.createSession('ai').apply({ op: 'rect', x0: 0, y0: 0, x1: 7, y1: 7, color: 3, filled: true }); });
  await page.locator('#view').focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
  await E(() => pixelEditor.newDocument(16, 16));
  await page.keyboard.press('Control+v'); await page.keyboard.press('Enter');
  const laund = await E(() => ({ prov: pixelEditor.provenance(), px: pixelEditor.getPixel(2, 2), tag: pixelEditor.getPixelTag(2, 2) }));
  assert(laund.px === 3 && laund.tag === 1 && laund.prov.label === 'ai' && laund.prov.aiPixelCount === 64, 'AI art copied → New → pasted is still AI (tags travel with the clipboard)');

  section('M2: failed op rolls back');
  const m2 = await E(() => {
    const api = pixelEditor, s = api.createSession('user'), out = {}; api.newDocument(8, 8); s.apply({ op: 'add_frame' });
    s.apply({ op: 'add_animation', name: 'walk', frames: [0, 1] }); const n = api.getLog().length;
    try { s.apply({ op: 'set_animation', name: 'walk', newName: 'run', frames: ['NOPE'] }); out.threw = false; } catch (e) { out.threw = true; out.msg = e.message; }
    out.name = api.getMeta().animations[0].name; out.logSame = api.getLog().length === n;
    const before = JSON.stringify(api.getMeta());
    for (const bad of [{ op: 'set_layer', opacity: 'abc' }, { op: 'add_layer', index: -1 }, { op: 'move_layer', layer: 0, index: 5 }, { op: 'resize', width: 4, height: 4, anchor: 'nowhere' }, { op: 'add_animation', name: 'x', mode: 'bounce' }, { op: 'remove_color', index: 999 }])
      try { s.apply(bad); out.accepted = (out.accepted || []).concat(bad.op); } catch (e) { /* expected */ }
    out.unchanged = JSON.stringify(api.getMeta()) === before;
    api.load(api.save()); out.afterReload = api.getMeta().animations[0].name;
    return out;
  });
  assert(m2.threw && m2.name === 'walk' && m2.logSame && m2.afterReload === 'walk', 'Ultron repro: failed set_animation leaves name "walk" (live and after save/load)');
  assert(!m2.accepted && m2.unchanged, 'invalid structural ops throw and leave the document unchanged');

  section('M3: unbounded rasterization');
  const cases = {
    'line to x1=1e8': () => pixelEditor.createSession('ai').apply({ op: 'line', x0: 0, y0: 0, x1: 1e8, y1: 5, color: 2 }),
    'filled rect 20000²': () => pixelEditor.createSession('ai').apply({ op: 'rect', x0: -10000, y0: -10000, x1: 10000, y1: 10000, color: 2, filled: true }),
    'ellipse 1e7': () => pixelEditor.createSession('ai').apply({ op: 'ellipse', x0: -1e7, y0: -1e7, x1: 1e7, y1: 1e7, color: 2 }),
    'line size 3000': () => pixelEditor.createSession('ai').apply({ op: 'line', x0: 0, y0: 0, x1: 15, y1: 15, size: 3000, color: 2 }),
    'paste w/h huge, short data': () => pixelEditor.createSession('ai').apply({ op: 'paste', x: 0, y: 0, w: 1e6, h: 1e6, data: [1] }),
    'paste data length mismatch': () => pixelEditor.createSession('ai').apply({ op: 'paste', x: 0, y: 0, w: 4, h: 4, data: [1, 2, 3] }),
    'clear_rect huge': () => pixelEditor.createSession('ai').apply({ op: 'clear_rect', x: -1e9, y: -1e9, w: 2e9, h: 2e9 }),
    'coordinate NaN/Infinity': () => pixelEditor.createSession('ai').apply({ op: 'line', x0: 0, y0: 0, x1: Infinity, y1: NaN, color: 2 }),
  };
  for (const [name, fn] of Object.entries(cases)) {
    await E(() => pixelEditor.newDocument(16, 16));
    const t = await timed(fn); console.log('    ', name, '→', t.res, t.ms.toFixed(1) + ' ms');
    assert(t.ms < 250, name + ' finishes fast (clamped or rejected)');
  }
  const m3 = await E(() => { pixelEditor.renderTextGrid(); pixelEditor.newDocument(16, 16); const r = pixelEditor.createSession('ai').apply({ op: 'line', x0: 0, y0: 0, x1: 15, y1: 0, size: 3000, color: 2 }); return { size: r.size, row2: pixelEditor.renderTextGrid().split('\n')[3] }; });
  assert(m3.size === 3 && m3.row2 === '................', 'brush size clamped to 3');

  section('M4: autosave');
  const big = await E(async () => {
    const api = pixelEditor, s = api.createSession('user'); api.newDocument(192, 108);
    for (let i = 1; i < 4; i++) s.apply({ op: 'add_layer' }); for (let i = 1; i < 24; i++) s.apply({ op: 'add_frame', copyOf: 0 });
    for (let f = 0; f < 24; f++) s.apply({ op: 'ellipse', layer: 0, frame: f, x0: 10 + f, y0: 10, x1: 80 + f, y1: 90, color: 1 + (f % 15), filled: true });
    const first = await api.flushAutosave();
    const longs = []; const po = new PerformanceObserver(l => l.getEntries().forEach(e => longs.push(Math.round(e.duration)))); po.observe({ entryTypes: ['longtask'] });
    api.preview.play(); const k0 = api.preview.stats().ticks, t0 = performance.now();
    for (let i = 0; i < 10; i++) { s.apply({ op: 'set_pixels', pixels: [[i, i, 2]] }); await new Promise(r => setTimeout(r, 600)); }
    const fps = (api.preview.stats().ticks - k0) / ((performance.now() - t0) / 1000); po.disconnect();
    const last = await api.flushAutosave();
    const tApply = performance.now(); for (let i = 0; i < 50; i++) s.apply({ op: 'set_pixels', pixels: [[i, 0, 3]] }); const perOp = (performance.now() - tApply) / 50;
    await new Promise(r => setTimeout(r, 100));
    return { first, last, fps, longs, perOp, status: api.autosaveStatus().state };
  });
  console.log('    ', JSON.stringify({ bytes: big.last.bytes, workerMs: Math.round(big.last.ms), fps: big.fps.toFixed(2), longTasks: big.longs, perOpMs: big.perOp.toFixed(2) }));
  assert(big.first.ok && big.last.ok, 'autosave succeeds at 192×108 ×4 layers ×24 frames (IndexedDB)');
  assert(big.last.bytes < 400000, 'stored compactly (RLE+base64, one copy): ' + Math.round(big.last.bytes / 1024) + ' KB (v1 was ~4 MB)');
  assert(big.fps > 14 && Math.max(0, ...big.longs) < 100, 'preview stays ~15 fps while editing; no autosave long tasks (serialized in a worker)');
  assert(big.perOp < 5, 'm2: 1-px apply at 24 frames costs ' + big.perOp.toFixed(2) + ' ms (refresh coalesced, thumbnails cached)');
  await page.reload(); await boot();
  assert((await E(() => pixelEditor.getMeta().frames.length + 'x' + pixelEditor.getMeta().width)) === '24x192', 'reload restores the autosave from IndexedDB');
  // failure path: no Worker, no IndexedDB, localStorage full
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const p2 = await ctx2.newPage(); const err2 = [];
  p2.on('pageerror', e => err2.push(e.message));
  await p2.addInitScript(() => { window.Worker = undefined; Object.defineProperty(window, 'indexedDB', { get() { return undefined; } }); Storage.prototype.setItem = function () { throw new DOMException('quota exceeded', 'QuotaExceededError'); }; });
  await p2.goto(FILE); await p2.waitForFunction(() => window.pixelEditor); await p2.evaluate(() => pixelEditor.ready);
  const fail = await p2.evaluate(async () => { pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[0, 0, 1]] }); const r = await pixelEditor.flushAutosave(); await new Promise(r => setTimeout(r, 50));
    const b = document.querySelector('#saveStatus'); return { r, state: b.dataset.state, text: b.textContent, visible: b.offsetParent !== null && b.getBoundingClientRect().width > 0, toast: (document.querySelector('#toast') || {}).textContent || '' }; });
  assert(!fail.r.ok && fail.state === 'error' && fail.visible && /Autosave failed/.test(fail.text) && /Autosave failed/.test(fail.toast), 'autosave failure shows a visible badge + toast: "' + fail.text + '"');
  await p2.screenshot({ path: SHOTS + '/05-autosave-failed.png', clip: { x: 0, y: 0, width: 1280, height: 120 } });
  assert(err2.length === 0, 'no page errors with storage disabled'); await ctx2.close();

  section('M5: untrusted load / newDocument validation');
  const m5 = await E(() => {
    const api = pixelEditor, out = {}; api.newDocument(8, 8); api.createSession('user').apply({ op: 'set_pixels', pixels: [[0, 0, 4]] });
    const good = api.save(); const keep = JSON.stringify(api.getMeta());
    const variant = f => { const o = JSON.parse(JSON.stringify(good)); f(o); return o; };
    const tryLoad = (name, o) => { const t = performance.now(); try { api.load(o); out[name] = 'accepted'; } catch (e) { out[name] = e.code || 'threw'; } out[name + 'Ms'] = performance.now() - t; };
    tryLoad('big3000', variant(o => { o.document.width = o.document.height = 3000; o.base.width = o.base.height = 3000; }));
    tryLoad('badPalette', variant(o => { o.document.palette[1] = 'red);background:url(//x'; o.base.palette[1] = 'red);background:url(//x'; }));
    tryLoad('missingCel', variant(o => { delete o.document.cels['L1:F1']; delete o.base.cels['L1:F1']; }));
    tryLoad('protoKey', JSON.stringify(good).replace(/"L1:F1"/g, '"__proto__"'));
    tryLoad('ctorKey', JSON.stringify(good).replace('"nextId"', '"constructor":{"prototype":{"x":1}},"nextId"'));
    tryLoad('notJson', '{nope');
    tryLoad('hugeOps', variant(o => { o.ops = { length: 1e9 }; }));
    out.unchanged = JSON.stringify(api.getMeta()) === keep && api.getPixel(0, 0) === 4; out.polluted = ({}).x === 1;
    for (const [w, h] of [[4096, 4096], [0, 8], [8.5, 8], ['32', 32], [257, 1]]) { try { api.newDocument(w, h); out['new' + w] = 'accepted'; } catch (e) { out['new' + w] = e.code; } }
    out.stillUnchanged = api.getPixel(0, 0) === 4; api.newDocument(256, 256); out.max = api.getMeta().width; api.newDocument(1, 1); out.min = api.getMeta().width;
    return out;
  });
  console.log('    ', JSON.stringify(m5));
  assert(['big3000', 'badPalette', 'missingCel', 'protoKey', 'ctorKey', 'notJson', 'hugeOps'].every(k => m5[k] !== 'accepted'), 'bad files rejected (size, palette, missing cel, __proto__/constructor keys, bad JSON, ops)');
  assert(m5.big3000Ms < 100 && m5.unchanged && !m5.polluted, 'rejected fast; current doc untouched; no prototype pollution');
  assert(['new4096', 'new0', 'new8.5', 'new32', 'new257'].every(k => m5[k] !== 'accepted') && m5.stillUnchanged && m5.max === 256 && m5.min === 1, 'newDocument validated (1..256 integers)');

  section('minor items');
  const m1mem = await E(() => {
    const api = pixelEditor, s = api.createSession('user'); api.newDocument(192, 108); for (let i = 1; i < 4; i++) s.apply({ op: 'add_layer' }); for (let i = 1; i < 24; i++) s.apply({ op: 'add_frame', copyOf: 0 });
    const h0 = performance.memory.usedJSHeapSize; for (let i = 0; i < 30; i++) s.apply({ op: 'set_layer', layer: i % 4, opacity: (i % 10) / 10 + 0.05 }); const h1 = performance.memory.usedJSHeapSize;
    return (h1 - h0) / 1e6;
  });
  assert(m1mem < 8, 'm1: 30 structural ops at 192×108×4×24 grow heap by ' + m1mem.toFixed(1) + ' MB (v1: ~2 MB per op)');
  // m3: mirror + size-2 line at x=1 on 16 wide (Ultron's repro) → cols 1-2 and 13-14
  await E(() => { pixelEditor.newDocument(16, 8); document.querySelector('#optMirH').click(); const s = document.querySelector('#optSize'); s.value = 2; s.dispatchEvent(new Event('change')); pixelEditor.setTool('line'); });
  await drag([1, 1], [1, 4]);
  const mir = await E(() => pixelEditor.renderTextGrid().split('\n')[2]);
  await E(() => { document.querySelector('#optMirH').click(); const s = document.querySelector('#optSize'); s.value = 1; s.dispatchEvent(new Event('change')); });
  assert(mir === '.11..........11.', 'm3: mirrored size-2 line is symmetric: ' + mir);
  const m4 = await E(() => { const api = pixelEditor, s = api.createSession('user'); api.newDocument(8, 8); const a = s.apply({ op: 'fill', x: 50, y: 50, color: 2 }); const b = s.apply({ op: 'fill', x: 0, y: 0, color: 0 }); const c = s.apply({ op: 'set_layer', layer: 0, name: 'Layer 1' }); return [a, b, c, api.getLog().length, api.canUndo()]; });
  assert(m4[0] === null && m4[1] === null && m4[2] === null && m4[3] === 0 && !m4[4], 'm4: no-op ops return null and are not logged');
  const m5b = await E(() => {
    const api = pixelEditor, s = api.createSession('user'), out = {}; api.newDocument(8, 8);
    const t = op => { try { s.apply(op); return 'accepted'; } catch (e) { return e.message; } };
    out.opacity = t({ op: 'set_layer', opacity: 'abc' }); out.layerIdx = t({ op: 'add_layer', index: -1 }); out.frameIdx = t({ op: 'add_frame', index: 99 });
    out.mode = t({ op: 'add_animation', name: 'a', mode: 'bounce' }); out.idName = t({ op: 'add_layer', name: 'L1' }); out.unknown = t({ op: 'explode' }); out.badColor = t({ op: 'set_pixels', pixels: [[0, 0, 99]] });
    return out;
  });
  console.log('    ', JSON.stringify(m5b));
  assert(Object.values(m5b).every(v => v !== 'accepted' && v.length > 5), 'm5: bad args throw clear errors');
  // m6: Ctrl+Y while floating commits first; Ctrl+Alt+N opens New
  await E(() => { const api = pixelEditor, s = api.createSession('user'); api.newDocument(16, 16); s.apply({ op: 'rect', x0: 0, y0: 0, x1: 3, y1: 3, color: 7, filled: true }); s.apply({ op: 'set_pixels', pixels: [[15, 15, 2]] }); api.undo(); api.setTool('select'); });
  await drag([0, 0], [3, 3], 3); await drag([1, 1], [6, 6], 3);
  await page.keyboard.press('Control+y');
  const m6 = await E(() => ({ moved: pixelEditor.getPixel(5, 5), orig: pixelEditor.getPixel(0, 0), log: pixelEditor.getLog().map(o => o.op), floating: pixelEditor.getState().selection }));
  assert(m6.moved === 7 && m6.orig === 0 && m6.log.join() === 'rect,batch', 'm6: Ctrl+Y with a floating selection commits it first (redo branch discarded, no hidden redo)');
  await page.keyboard.press('Control+Alt+n');
  const newOpen = await E(() => !document.querySelector('#modal').classList.contains('hidden') && [...document.querySelectorAll('#nSize option')].map(o => o.value));
  assert(newOpen && newOpen.includes('192x108'), 'm6/m7: Ctrl+Alt+N opens New; 192×108 preset offered');
  await page.selectOption('#nSize', '192x108'); await page.click('#mOk'); await page.waitForTimeout(300);
  const m7 = await E(() => { const box = document.querySelector('#pvBox'), side = box.parentElement; return { w: pixelEditor.getMeta().width, h: pixelEditor.getMeta().height, over: box.scrollWidth > box.clientWidth + 1 || box.getBoundingClientRect().right > side.getBoundingClientRect().right + 1, pageOver: document.documentElement.scrollWidth > innerWidth }; });
  assert(m7.w === 192 && m7.h === 108 && !m7.over && !m7.pageOver, 'm7: 192×108 created from the preset; preview does not overflow');
  await page.screenshot({ path: SHOTS + '/04-192x108.png' });
  // m9 a11y
  const a11y = await E(() => ({
    tools: [...document.querySelectorAll('#tools button')].every(b => b.getAttribute('aria-label') && b.hasAttribute('aria-pressed')),
    labels: ['#pvScale', '#pvBg', '#pvAnim', '#palPreset', '#docName', '#xfScope'].every(s => document.querySelector(s).getAttribute('aria-label')),
    dialog: document.querySelector('#modal .mbox').getAttribute('role') === 'dialog' && document.querySelector('#modal .mbox').getAttribute('aria-modal') === 'true',
    canvas: document.querySelector('#view').tabIndex === 0 && !!document.querySelector('#view').getAttribute('aria-label'),
    live: document.querySelector('#saveStatus').getAttribute('aria-live') === 'polite',
  }));
  assert(Object.values(a11y).every(Boolean), 'm9: aria labels on tools/selects, dialog role, focusable canvas, live status ' + JSON.stringify(a11y));
  await page.keyboard.press('?'); await page.waitForTimeout(100);
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
  const trapped = await E(() => document.querySelector('#modal').contains(document.activeElement)); await page.keyboard.press('Escape');
  assert(trapped, 'm9: focus stays inside the modal (focus trap)');

  section('flip / rotate');
  const fr = await E(() => {
    const api = pixelEditor, s = api.createSession('user'), out = {}; api.newDocument(4, 4);
    s.apply({ op: 'set_pixels', pixels: [[0, 0, 1], [1, 0, 2], [0, 1, 3]] }); const g0 = api.renderTextGrid();
    s.apply({ op: 'flip', axis: 'h' }); out.flipH = api.renderTextGrid().split('\n')[0];
    s.apply({ op: 'flip', axis: 'v' }); out.flipV = api.renderTextGrid().split('\n')[3];
    api.undo(); api.undo(); out.undo = api.renderTextGrid() === g0;
    s.apply({ op: 'rotate', dir: 'cw' }); out.rotCW = api.renderTextGrid().split('\n').map(r => r[3]).join('');
    s.apply({ op: 'rotate', dir: 'ccw' }); out.rotBack = api.renderTextGrid() === g0;
    s.apply({ op: 'add_frame', copyOf: 0 }); s.apply({ op: 'flip', axis: 'h', scope: 'layer' }); out.layerScope = [api.getPixel(3, 0, 0, 0), api.getPixel(3, 0, 0, 1)].join();
    try { api.newDocument(4, 2); s.apply({ op: 'rotate', dir: 'cw' }); out.nonSquare = 'accepted'; } catch (e) { out.nonSquare = e.code; }
    s.apply({ op: 'set_pixels', pixels: [[0, 0, 5], [1, 0, 6]] }); s.apply({ op: 'rotate', dir: 'cw', rect: { x: 0, y: 0, w: 2, h: 2 } }); out.rect = api.renderTextGrid();
    return out;
  });
  console.log('    ', JSON.stringify(fr));
  assert(fr.flipH === '..21' && fr.flipV === '..21' && fr.undo, 'flip h/v ops + undo');
  assert(fr.rotCW === '12..' && fr.rotBack, 'rotate 90° cw/ccw on a square cel');
  assert(fr.layerScope === '1,1' && fr.nonSquare !== 'accepted' && fr.rect === '.5..\n.6..', 'layer scope flips all frames; whole non-square rotate rejected; rect rotate works');
  await E(() => { pixelEditor.newDocument(8, 8); pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[0, 0, 4]] }); });
  await page.locator('#view').focus(); await page.keyboard.press('Shift+H'); assert(await px(7, 0) === 4, 'Shift+H flips the cel from the keyboard');
  await page.click('#xfRotCW'); assert(await px(7, 7) === 4, 'rotate button rotates the cel');

  section('per-pixel AI tags');
  const tg = await E(() => {
    const api = pixelEditor, ai = api.createSession('ai'), me = api.createSession('user'), out = {}, P = () => api.provenance();
    api.newDocument(8, 8); ai.apply({ op: 'rect', x0: 0, y0: 0, x1: 1, y1: 1, color: 3, filled: true });
    out.aiCount = P().aiPixelCount; out.cel = api.getCel(0, 0).tags.slice(0, 2).join('');
    // user redraws every AI pixel with the SAME color: logged (tag change is a change), label clears
    const r = me.apply({ op: 'set_pixels', pixels: [[0, 0, 3], [1, 0, 3], [0, 1, 3], [1, 1, 3]] }); out.redrawLogged = !!r; out.afterRedraw = P().label + ':' + P().aiPixelCount;
    out.sameAgain = me.apply({ op: 'set_pixels', pixels: [[0, 0, 3]] }); // human over human, same color: true no-op
    api.undo(); out.undoBack = P().label + ':' + P().aiPixelCount; api.redo();
    // user fill over AI pixels (same and different color) clears tags
    ai.apply({ op: 'rect', x0: 4, y0: 4, x1: 7, y1: 7, color: 5, filled: true }); me.apply({ op: 'fill', x: 5, y: 5, color: 5 }); out.fillSame = P().aiPixelCount;
    ai.apply({ op: 'rect', x0: 4, y0: 4, x1: 7, y1: 7, color: 5, filled: true }); me.apply({ op: 'fill', x: 5, y: 5, color: 6 }); out.fillDiff = P().aiPixelCount;
    // AI fill tags the filled pixels; user erase clears them
    ai.apply({ op: 'fill', x: 3, y: 3, color: 7 }); out.aiFill = P().aiPixelCount > 0; me.apply({ op: 'clear' }); out.afterClear = P().label;
    // flip / rotate carry tags with the pixels
    api.newDocument(4, 4); ai.apply({ op: 'set_pixels', pixels: [[0, 0, 2]] }); me.apply({ op: 'set_pixels', pixels: [[1, 0, 3]] });
    me.apply({ op: 'flip', axis: 'h' }); out.flipTags = [api.getPixelTag(3, 0), api.getPixelTag(2, 0)].join('');
    me.apply({ op: 'rotate', dir: 'cw' }); out.rotTags = [api.getPixelTag(3, 3), api.getPixelTag(3, 2), P().aiPixelCount].join('');
    // duplicate frame copies tags; hidden layer still counts; layer delete removes them
    me.apply({ op: 'add_frame', copyOf: 0 }); out.dupFrame = P().aiPixelCount;
    me.apply({ op: 'add_layer', name: 'Hidden' }); ai.apply({ op: 'set_pixels', layer: 'Hidden', pixels: [[0, 0, 4]] }); me.apply({ op: 'set_layer', layer: 'Hidden', visible: false });
    out.hidden = P().aiPixelCount; me.apply({ op: 'remove_layer', layer: 'Hidden' }); out.afterLayerDel = P().aiPixelCount;
    // palette removal remaps; removed color's pixels lose their tag
    me.apply({ op: 'remove_color', index: 2 }); out.afterRemoveColor = P().aiPixelCount;
    // save / load round trip keeps tags; bad tag values are rejected
    api.newDocument(8, 8); ai.apply({ op: 'line', x0: 0, y0: 0, x1: 7, y1: 0, color: 4 }); me.apply({ op: 'set_pixels', pixels: [[0, 1, 4]] });
    const saved = api.save(); out.fileHasTags = Object.keys(saved.document.tags).length === 1;
    api.newDocument(8, 8); api.load(JSON.stringify(saved)); out.loaded = P().aiPixelCount + ':' + api.getPixelTag(0, 1);
    const flat = JSON.parse(JSON.stringify(saved)); flat.ops = []; flat.base = flat.document; api.load(flat); out.snapLoaded = P().aiPixelCount;
    const bad = JSON.parse(JSON.stringify(saved)); bad.ops = []; bad.base = bad.document; bad.base.tags['L1:F1'] = 'r:' + btoa(String.fromCharCode(63, 2)); try { api.load(bad); out.badTags = 'accepted'; } catch (e) { out.badTags = e.code; }
    // resize moves tags with pixels
    api.load(flat); me.apply({ op: 'resize', width: 10, height: 10, anchor: 'topleft' }); out.resized = P().aiPixelCount + ':' + api.getPixelTag(7, 0);
    return out;
  });
  console.log('    ', JSON.stringify(tg));
  assert(tg.aiCount === 4 && tg.cel === '11', 'AI rect tags its 4 pixels (getCel returns tags)');
  assert(tg.redrawLogged && tg.afterRedraw === 'human:0' && tg.sameAgain === null, 'user redrawing every AI pixel in the same color is logged and clears the label; human-over-human same color is a no-op');
  assert(tg.undoBack === 'ai:4', 'undo restores tags');
  assert(tg.fillSame === 0 && tg.fillDiff === 0 && tg.aiFill && tg.afterClear === 'human', 'user fill (same or new color) and erase clear tags; AI fill tags');
  assert(tg.flipTags === '10' && tg.rotTags === '101', 'flip/rotate move tags with their pixels');
  assert(tg.dupFrame === 2 && tg.hidden === 3 && tg.afterLayerDel === 2 && tg.afterRemoveColor === 0, 'duplicate frame copies tags; hidden layers count; layer delete and palette color removal drop tags');
  assert(tg.fileHasTags && tg.loaded === '8:0' && tg.snapLoaded === 8 && tg.badTags === 'bad_doc' && tg.resized === '8:1', 'save/load (replay and snapshot) keep tags; invalid tags rejected; resize keeps tags');
  // UI selection move keeps AI tags on the moved pixels
  await E(() => { pixelEditor.newDocument(16, 16); pixelEditor.createSession('ai').apply({ op: 'rect', x0: 0, y0: 0, x1: 3, y1: 3, color: 7, filled: true }); pixelEditor.setTool('select'); });
  await drag([0, 0], [3, 3], 3); await drag([1, 1], [9, 9]); await page.keyboard.press('Enter');
  const mv = await E(() => [pixelEditor.getPixelTag(8, 8), pixelEditor.getPixel(0, 0), pixelEditor.provenance().aiPixelCount].join(':'));
  assert(mv === '1:0:16', 'selection move by the user keeps AI tags on the moved pixels: ' + mv);

  section('save / load round-trip + autosave restore');
  const rt = await E(() => { const api = pixelEditor, s = api.createSession('ai'); api.newDocument(16, 16); s.apply({ op: 'rect', x0: 1, y0: 1, x1: 5, y1: 5, color: 3 }); s.apply({ op: 'add_animation', name: 'a', frames: [0] }); const txt = JSON.stringify(api.save()); api.newDocument(8, 8); const r = api.load(txt);
    return { r, anims: api.getMeta().animations.length, n: api.getLog().length, w: api.getMeta().width, undo: api.undo(), redo: api.redo(), label: api.provenance().label, size: txt.length }; });
  assert(rt.r.replayed && rt.anims === 1 && rt.w === 16 && rt.n === 2 && rt.undo && rt.redo && rt.label === 'ai', 'loaded doc with replayable op log ' + JSON.stringify(rt));
  await E(() => pixelEditor.flushAutosave()); await page.reload(); await boot();
  assert((await E(() => pixelEditor.getMeta().animations.length + ':' + pixelEditor.provenance().label)) === '1:ai', 'autosave restored with provenance');

  section('preview timing');
  await E(() => { pixelEditor.loadExample(); pixelEditor.preview.select('walk'); pixelEditor.preview.play(); });
  const t0 = await E(() => pixelEditor.preview.stats().ticks); await page.waitForTimeout(3000);
  const st = await E(() => pixelEditor.preview.stats()); const fps = (st.ticks - t0) / 3; console.log('    measured', fps.toFixed(2), 'fps');
  assert(Math.abs(fps - 15) < 1.0 && Math.abs(st.avgIntervalMs - 66.67) < 6, 'preview runs at ~15 fps');

  section('selection move + pixel-perfect + ellipse');
  await E(() => { pixelEditor.newDocument(16, 16); pixelEditor.createSession('user').apply({ op: 'rect', x0: 0, y0: 0, x1: 3, y1: 3, color: 7, filled: true }); pixelEditor.setTool('select'); });
  await drag([0, 0], [3, 3], 3); await drag([1, 1], [9, 9]); await page.keyboard.press('Enter');
  assert(await px(0, 0) === 0 && await px(8, 8) === 7 && await px(11, 11) === 7, 'selection dragged by (8,8)');
  await page.keyboard.press('Delete'); assert(await px(8, 8) === 0, 'Delete clears selection');
  await E(() => { pixelEditor.newDocument(16, 16); pixelEditor.setTool('pencil'); document.querySelector('#optMirH').click(); });
  [sx, sy] = await toScreen(2, 5); await page.mouse.click(sx, sy);
  assert(await px(2, 5) === 1 && await px(13, 5) === 1, 'horizontal mirror drew both sides');
  await E(() => document.querySelector('#optMirH').click());
  { const [ax, ay] = await toScreen(0, 10), [bx, by] = await toScreen(1, 10), [cx, cy] = await toScreen(1, 11); await page.mouse.move(ax, ay); await page.mouse.down(); await page.mouse.move(bx, by); await page.mouse.move(cx, cy); await page.mouse.up(); }
  assert(await px(1, 10) === 0 && await px(1, 11) === 1, 'pixel-perfect removed the L corner');
  const ell = await E(() => { pixelEditor.createSession('user').apply({ op: 'ellipse', x0: 4, y0: 4, x1: 11, y1: 11, color: 3 }); return pixelEditor.renderTextGrid(); });
  assert(ell.includes('3'), 'ellipse op rasterized');

  section('round 2: N1 history cap folds into base');
  await page.goto(FILE + '?testMaxOps=50'); await boot();
  const n1 = await E(() => {
    const api = pixelEditor, ai = api.createSession('ai'), me = api.createSession('user'), out = {};
    api.newDocument(8, 8);
    ai.apply({ op: 'set_pixels', pixels: [[7, 7, 9]] }); me.apply({ op: 'set_pixels', pixels: [[6, 7, 5]] });
    for (let i = 0; i < 230; i++) (i % 3 ? me : ai).apply({ op: 'set_pixels', pixels: [[i % 6, (i >> 3) % 7, 1 + (i % 7)]] });
    const grid = () => api.getCel(0, 0), live = grid(); out.logLen = api.getLog().length;
    const r = api.load(api.save()); const after = grid();
    out.replayed = r.replayed; out.same = JSON.stringify(after) === JSON.stringify(live);
    out.p77 = api.getPixel(7, 7) + ':' + api.getPixelTag(7, 7); out.p67 = api.getPixel(6, 7) + ':' + api.getPixelTag(6, 7); out.label = api.provenance().label;
    while (api.undo()); out.undoAll = api.getPixel(7, 7) + ':' + api.getPixelTag(7, 7) + ':' + api.getPixel(6, 7);
    while (api.redo()); out.redoAll = JSON.stringify(grid()) === JSON.stringify(live);
    return out;
  });
  console.log('    ', JSON.stringify(n1));
  assert(n1.logLen <= 50 && n1.replayed && n1.same && n1.p77 === '9:1' && n1.p67 === '5:0' && n1.label === 'ai', 'N1: 232 ops with a 50-op cap → save/load keeps every pixel and tag (oldest edits folded into base)');
  assert(n1.undoAll === '9:1:5' && n1.redoAll, 'N1: undo-all stops at the folded base (edits kept), redo-all returns to live');
  await E(() => pixelEditor.flushAutosave()); await page.reload(); await boot();
  assert((await E(() => pixelEditor.getPixel(7, 7) + ':' + pixelEditor.getPixelTag(7, 7) + ':' + pixelEditor.getLog().length)).startsWith('9:1:'), 'N1: autosave restore after folding keeps the folded edits');
  const n1b = await E(() => { pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[0, 7, 8]] }); const d = JSON.parse(JSON.stringify(pixelEditor.save())); d.ops.pop(); d.cursor = d.ops.length; return pixelEditor.load(d); }); // log no longer reproduces the document
  assert(n1b.replayed === false && /reproduce/.test(n1b.warning), 'N1 safety net: a log that does not reproduce the saved document falls back to the document with a warning');
  await page.goto(FILE); await boot();

  section('round 2: N2 rotate a non-square selection');
  const n2 = await E(() => {
    const api = pixelEditor, me = api.createSession('user'), ai = api.createSession('ai');
    api.newDocument(8, 8); me.apply({ op: 'rect', x0: 0, y0: 0, x1: 7, y1: 7, color: 4, filled: true });
    me.apply({ op: 'clear_rect', x: 3, y: 1, w: 2, h: 6 }); ai.apply({ op: 'set_pixels', pixels: [[3, 2, 9]] });
    const before = api.getPixels(0, 0);
    me.apply({ op: 'rotate', dir: 'cw', rect: { x: 3, y: 1, w: 2, h: 6 } });
    const now = api.getPixels(0, 0), inHole = i => { const x = i % 8, y = i >> 3; return x >= 3 && x <= 4 && y >= 1 && y <= 6; };
    let changedOutside = 0, nines = [], at9 = -1;
    now.forEach((c, i) => { if (c === 9) { nines.push(i); at9 = i; } if (!inHole(i) && c !== before[i]) changedOutside++; });
    const tag9 = at9 >= 0 ? api.getPixelTag(at9 % 8, at9 >> 3) : -1;
    api.undo(); const undone = JSON.stringify(api.getPixels(0, 0)) === JSON.stringify(before);
    // whole 2x6 hole rotated: rotated block lands at x 1..6, y 3..4; only the 9 may cover a neighbour
    return { changedOutside, nines: nines.length, tag9, undone, rows: [3, 4].map(y => now.slice(y * 8, y * 8 + 8).map(c => c || '.').join('')) };
  });
  console.log('    ', JSON.stringify(n2));
  assert(n2.nines === 1 && n2.changedOutside <= 1 && n2.tag9 === 1 && n2.undone, 'N2: rotating a 2×6 selection keeps every neighbour except where rotated content lands (' + n2.rows.join(' / ') + ')');
  // UI: Shift+R on a 2×12 selection inside a filled area
  await E(() => { const api = pixelEditor; api.newDocument(16, 16); api.createSession('user').apply({ op: 'rect', x0: 0, y0: 0, x1: 15, y1: 15, color: 2, filled: true }); api.createSession('user').apply({ op: 'clear_rect', x: 7, y: 2, w: 2, h: 12 }); api.setTool('select'); });
  await drag([7, 2], [8, 13], 4); await page.keyboard.press('Shift+R'); await page.keyboard.press('Enter');
  const n2ui = await E(() => pixelEditor.getPixels(0, 0).filter(c => c === 2).length);
  assert(n2ui === 256 - 24, 'N2 (UI): Shift+R on an empty 2×12 selection inside a filled area leaves all ' + n2ui + ' surrounding pixels');

  section('round 2: N5 clipped lines keep their stair-step');
  const n5 = await E(() => {
    const api = pixelEditor, me = api.createSession('user'); let bad = 0, n = 0;
    for (let t = 0; t < 40; t++) {
      const y0 = (t * 7) % 32, y1 = (t * 13 + 5) % 32, x0 = -40 - (t % 9) * 3, x1 = 50 + (t % 5);
      api.newDocument(64, 32); me.apply({ op: 'line', x0, y0, x1, y1, color: 3 }); const a = api.getPixels(0, 0);
      api.newDocument(192, 32); me.apply({ op: 'line', x0: x0 + 100, y0, x1: x1 + 100, y1, color: 3 }); const b = api.getPixels(0, 0);
      let same = true; for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) if (a[y * 64 + x] !== b[y * 192 + x + 100]) same = false;
      n++; if (!same) bad++;
    }
    api.newDocument(64, 32); const t0 = performance.now(); me.apply({ op: 'line', x0: -1e9, y0: -999999990, x1: 1e9, y1: 1e9 - 3, color: 3 }); const ms = performance.now() - t0;
    return { bad, n, ms, drawn: api.getPixels(0, 0).filter(c => c).length };
  });
  console.log('    ', JSON.stringify(n5));
  assert(n5.bad === 0 && n5.n === 40, 'N5: 40 lines starting 40+ px off-canvas match the unclipped line pixel-for-pixel');
  assert(n5.ms < 50 && n5.drawn > 0, 'N5: ±1e9 line still clipped cheaply (' + n5.ms.toFixed(1) + ' ms)');

  section('round 2: N3 last edits survive an immediate reload');
  for (const wait of [0, 300]) {
    await E(() => { pixelEditor.newDocument(16, 16); return pixelEditor.flushAutosave(); });
    await E(() => pixelEditor.createSession('ai').apply({ op: 'set_pixels', pixels: [[4, 4, 6]] }));
    if (wait) await page.waitForTimeout(wait);
    await page.reload(); await boot();
    const got = await E(() => pixelEditor.getPixel(4, 4) + ':' + pixelEditor.getPixelTag(4, 4) + ':' + pixelEditor.getMeta().width);
    assert(got === '6:1:16', `N3: edit then reload after ${wait} ms keeps the pixel and its tag (${got})`);
  }
  await E(() => { const me = pixelEditor.createSession('user'); me.apply({ op: 'set_pixels', pixels: [[1, 1, 2]] }); return pixelEditor.flushAutosave(); });
  await E(() => { pixelEditor.undo(); pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[2, 2, 3]] }); });
  await page.reload(); await boot();
  assert((await E(() => [pixelEditor.getPixel(1, 1), pixelEditor.getPixel(2, 2), pixelEditor.getPixel(4, 4)].join(''))) === '036', 'N3: undo + new edit after the last autosave are replayed from the journal');
  const vis = await E(async () => {
    pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[5, 5, 7]] });
    const st = () => document.querySelector('#saveStatus').dataset.state, before = st();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange'));
    const during = st(); delete document.visibilityState; await pixelEditor.flushAutosave(); return before + '→' + during;
  });
  assert(vis === 'pending→saving', 'N3: visibilitychange→hidden starts the save immediately (' + vis + ')');

  section('round 2: N4 second tab');
  const tab2 = await ctx.newPage(); const err4 = []; tab2.on('pageerror', e => err4.push(e.message)); tab2.on('console', m => { if (m.type() === 'error') err4.push(m.text()); });
  await tab2.goto(FILE); await tab2.waitForFunction(() => window.pixelEditor); await tab2.evaluate(() => pixelEditor.ready);
  const n4 = await tab2.evaluate(async () => {
    const notice = document.querySelector('#tabNotice'); const paused = pixelEditor.isAutosavePaused();
    pixelEditor.newDocument(20, 20); const f = await pixelEditor.flushAutosave();
    return { paused, notice: notice ? notice.textContent : '', flushOk: f.ok, status: document.querySelector('#saveStatus').textContent };
  });
  const mainPaused = await E(() => pixelEditor.isAutosavePaused());
  await tab2.close(); await page.reload(); await boot();
  const n4w = await E(() => pixelEditor.getMeta().width);
  console.log('    ', JSON.stringify(n4), mainPaused, n4w);
  assert(n4.paused && /Another tab is editing/.test(n4.notice) && !n4.flushOk && /paused/.test(n4.status) && !mainPaused, 'N4: a second tab shows "another tab is editing" and pauses its autosave; the first tab keeps saving');
  assert(n4w === 16 && err4.length === 0, 'N4: the second tab did not overwrite the first tab\'s autosave (width ' + n4w + ')');

  section('round 2: m9 / nits');
  await E(() => pixelEditor.newDocument(24, 12)); await page.waitForTimeout(50);
  const nits = await E(() => {
    const lab = ['#colorInput', '#fileInput', '#palFileInput'].map(id => document.querySelector(id).getAttribute('aria-label'));
    return { lab, untyped: document.querySelectorAll('button:not([type])').length, total: document.querySelectorAll('button').length, rotDisabled: document.querySelector('#xfRotCW').disabled, title: document.querySelector('#xfRotCW').title };
  });
  const before = await E(() => JSON.stringify(pixelEditor.getPixels(0, 0)) + pixelEditor.getLog().length);
  await page.keyboard.press('Shift+R'); await page.waitForTimeout(50);
  const afterR = await E(() => ({ same: JSON.stringify(pixelEditor.getPixels(0, 0)) + pixelEditor.getLog().length, toast: (document.querySelector('.toast, #toast') || {}).textContent || '' }));
  assert(nits.lab.every(Boolean), 'm9: hidden #colorInput/#fileInput/#palFileInput have aria-labels');
  assert(nits.untyped === 0 && nits.total > 30, 'nit: every button has type="button" (' + nits.total + ')');
  assert(nits.rotDisabled && /square/.test(nits.title) && afterR.same === before && /square/.test(afterR.toast), 'nit: Shift+R / rotate buttons on a full non-square canvas are disabled with a clear hint');
  await E(() => pixelEditor.newDocument(32, 32));

  section('round 3: R1 replay check is order-insensitive');
  const r1 = await E(() => {
    const api = pixelEditor, me = api.createSession('user'), out = {};
    api.newDocument(16, 16); me.apply({ op: 'add_layer' }); me.apply({ op: 'add_frame' }); me.apply({ op: 'set_pixels', pixels: [[1, 1, 3]] });
    const a = api.load(JSON.stringify(api.save())); out.layersFirst = a.replayed && !a.warning && api.getLog().length === 3 && api.provenance().label === 'human';
    out.canUndo = api.undo() && api.redo();
    const keys = Object.keys(api.save().document.cels); out.canonical = keys.join(',');
    api.loadExample(); const b = api.load(JSON.stringify(api.save())); out.example = b.replayed && !b.warning && api.provenance().label !== 'unknown';
    api.newDocument(192, 108); for (let i = 0; i < 3; i++) me.apply({ op: 'add_layer' }); for (let i = 0; i < 23; i++) me.apply({ op: 'add_frame' });
    const c = api.load(api.save()); out.big = c.replayed && !c.warning;
    return out;
  });
  console.log('    ', JSON.stringify(r1));
  assert(r1.layersFirst && r1.canUndo, 'R1: + Layer then + Frame → save/load replays (replayed, no warning, history kept, hand-drawn)');
  assert(r1.canonical === 'L1:F1,L1:F3,L2:F1,L2:F3', 'R1: encodeDoc writes cels in canonical layer×frame order (' + r1.canonical + ')');
  assert(r1.example && r1.big, 'R1: built-in example and a 4-layer × 24-frame doc (layers added first) replay on load');
  // UI: + Layer, + Frame, draw, reload → no "op log was invalid"; Open of the saved file too
  await E(() => pixelEditor.newDocument(16, 16));
  await E(() => { pixelEditor.createSession('user').apply({ op: 'add_layer' }); pixelEditor.createSession('user').apply({ op: 'add_frame' }); pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[2, 2, 4]] }); return pixelEditor.flushAutosave(); });
  await page.reload(); await boot(); await page.waitForTimeout(100);
  const r1ui = await E(() => ({ log: pixelEditor.getLog().length, prov: document.querySelector('#prov').textContent, toast: (document.querySelector('#toast') || {}).textContent || '' }));
  assert(r1ui.log === 3 && !/unknown/.test(r1ui.prov) && !/invalid/.test(r1ui.toast), 'R1 (UI): reload after + Layer, + Frame keeps history and provenance (' + r1ui.prov + ')');
  const savedFile = path.join(require('os').tmpdir(), 'osh-r1-' + process.pid + '.json');
  fs.writeFileSync(savedFile, JSON.stringify(await E(() => pixelEditor.save())));
  await E(() => pixelEditor.newDocument(8, 8));
  const [ch3] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]);
  await ch3.setFiles(savedFile); await page.waitForTimeout(300); fs.unlinkSync(savedFile);
  const r1open = await E(() => ({ log: pixelEditor.getLog().length, px: pixelEditor.getPixel(2, 2), prov: pixelEditor.provenance().label }));
  assert(r1open.log === 3 && r1open.px === 4 && r1open.prov === 'human', 'R1 (UI): Open of a saved layers-first file replays its history');

  section('round 3: R1 fuzz (live = replay = load(save), undo-all = base) at caps default / 50 / 10');
  for (const cap of [0, 50, 10]) {
    await page.goto(FILE + (cap ? '?testMaxOps=' + cap : '')); await boot();
    const fz = await E((cap) => {
      const api = pixelEditor, ai = api.createSession('ai'), me = api.createSession('user'); let seed = 777 + cap; const R = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
      const S = o => JSON.stringify(o, (k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(x => [x, v[x]])) : v), canon = () => S(api.getDocument());
      api.newDocument(20, 12); const fails = []; let applied = 0, loads = 0;
      for (let step = 0; step < 400; step++) {
        const d = api.getMeta(), F = d.frames.map(f => f.id), L = d.layers.map(l => l.id), c = 1 + R(d.palette.length - 1), W = d.width, H = d.height;
        const ops = [
          () => ({ op: 'set_pixels', layer: L[R(L.length)], frame: F[R(F.length)], pixels: [[R(W), R(H), c]] }),
          () => ({ op: 'line', x0: R(40) - 10, y0: R(30) - 9, x1: R(40) - 10, y1: R(30) - 9, color: c }),
          () => ({ op: 'rect', x0: R(W), y0: R(H), x1: R(W), y1: R(H), color: c, filled: !!R(2) }),
          () => ({ op: 'fill', x: R(W), y: R(H), color: c }),
          () => ({ op: 'flip', axis: R(2) ? 'h' : 'v', scope: ['cel', 'frame', 'layer'][R(3)] }),
          () => ({ op: 'rotate', dir: ['cw', 'ccw', '180'][R(3)], rect: { x: R(W) - 2, y: R(H) - 2, w: 1 + R(6), h: 1 + R(6) } }),
          () => ({ op: 'add_frame', ...(R(2) ? { copyOf: F[R(F.length)] } : {}) }), () => ({ op: 'add_layer' }),
          () => ({ op: 'add_frame' }), () => ({ op: 'add_layer' }),
          () => ({ op: 'remove_frame', frame: F[R(F.length)] }), () => ({ op: 'remove_layer', layer: L[R(L.length)] }),
          () => ({ op: 'move_layer', layer: L[R(L.length)], index: R(L.length) }), () => ({ op: 'move_frame', frame: F[R(F.length)], index: R(F.length) }),
          () => ({ op: 'resize', width: 12 + R(12), height: 8 + R(8) }),
        ];
        const k = R(10);
        try { if (k < 7) { if ((R(2) ? ai : me).apply(ops[R(ops.length)]())) applied++; } else if (k < 9) api.undo(); else api.redo(); } catch (e) { /* invalid random op: fine */ }
        if (step % 40 === 39) {
          const live = canon(), saved = api.save(); loads++;
          const r = api.load(JSON.parse(JSON.stringify(saved))); if (!r.replayed || r.warning) fails.push({ step, what: 'not replayed: ' + r.warning }); if (canon() !== live) fails.push({ step, what: 'live != load(save)' });
          const n = api.getCursor(); while (api.undo()); const b = api.getDocument();
          if (S(b.cels) !== S(saved.base.cels) || S(b.tags || {}) !== S(saved.base.tags || {})) fails.push({ step, what: 'undo-all != base' });
          for (let q = 0; q < n; q++) api.redo(); if (canon() !== live) fails.push({ step, what: 'redo != live' });
        }
      }
      return { applied, loads, logLen: api.getLog().length, nFails: fails.length, fails: fails.slice(0, 3) };
    }, cap);
    console.log('    cap ' + (cap || 'default'), JSON.stringify(fz));
    assert(fz.nFails === 0 && fz.loads === 10 && fz.applied > 150 && (!cap || fz.logLen <= cap), `R1 fuzz cap ${cap || 'default'}: ${fz.loads} save/load checkpoints all replay and match (${fz.applied} ops)`);
  }

  section('round 3: R2 edits right after a history fold survive an immediate reload');
  await page.goto(FILE + '?testMaxOps=50'); await boot();
  await E(async () => { pixelEditor.newDocument(16, 16); await pixelEditor.flushAutosave(); const me = pixelEditor.createSession('user'); for (let i = 0; i < 49; i++) me.apply({ op: 'set_pixels', pixels: [[i % 16, i >> 4, 1 + (i % 5)]] }); await pixelEditor.flushAutosave(); });
  await E(() => { const ai = pixelEditor.createSession('ai'); for (let i = 0; i < 3; i++) ai.apply({ op: 'set_pixels', pixels: [[i, 12, 9]] }); });
  await page.reload(); await boot();
  const r2 = await E(() => [0, 1, 2].map(i => pixelEditor.getPixel(i, 12) + '' + pixelEditor.getPixelTag(i, 12)).join(',') + '|' + pixelEditor.getPixel(0, 0) + '|' + pixelEditor.getPixel(0, 3));
  assert(r2 === '91,91,91|1|4', 'R2: save, 49 edits, save, 3 edits crossing the 50-op cap, instant reload → all edits present (' + r2 + ')');
  await E(async () => { const me = pixelEditor.createSession('user'); for (let i = 0; i < 60; i++) me.apply({ op: 'set_pixels', pixels: [[i % 16, 14, 1 + (i % 6)]] }); return 'ok'; });
  await page.reload(); await boot();
  const r2c = await E(() => pixelEditor.getPixel(11, 14) + ':' + pixelEditor.getPixel(0, 12));
  assert(r2c === '6:9', 'R2: 60 unsaved edits spanning several folds then instant reload → kept via the self-contained journal (' + r2c + ')');
  await page.goto(FILE); await boot();

  section('round 3: R3 a paused tab takes over when the editing tab closes');
  await E(async () => { pixelEditor.newDocument(16, 16); pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[3, 3, 5]] }); await pixelEditor.flushAutosave(); });
  const tab3 = await ctx.newPage(); const err5 = []; tab3.on('pageerror', e => err5.push(e.message)); tab3.on('console', m => { if (m.type() === 'error') err5.push(m.text()); });
  await tab3.goto(FILE); await tab3.waitForFunction(() => window.pixelEditor); await tab3.evaluate(() => pixelEditor.ready);
  assert(await tab3.evaluate(() => pixelEditor.isAutosavePaused()), 'R3: second tab starts paused');
  await E(() => pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[4, 4, 6]] })); // last edit, only in the journal
  await page.goto('about:blank');
  await tab3.waitForFunction(() => !pixelEditor.isAutosavePaused(), null, { timeout: 5000 });
  const t3 = await tab3.evaluate(async () => ({ px: pixelEditor.getPixel(3, 3) + ':' + pixelEditor.getPixel(4, 4), notice: !!document.querySelector('#tabNotice'), flush: (await pixelEditor.flushAutosave()).ok }));
  assert(t3.px === '5:6' && !t3.notice && t3.flush, 'R3: when the first tab closes, the idle second tab loads the latest autosave + journal and takes over (' + t3.px + ')');
  await tab3.evaluate(async () => { pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[6, 6, 7]] }); await pixelEditor.flushAutosave(); });
  await page.goto(FILE); await boot();
  assert(await E(() => pixelEditor.isAutosavePaused()), 'R3: the reopened first tab is now the paused one');
  await E(() => pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[9, 9, 2]] })); // an edit while paused
  await tab3.close();
  await page.waitForSelector('#takeoverLoad', { timeout: 5000 });
  assert(await E(() => pixelEditor.isAutosavePaused() && pixelEditor.getPixel(9, 9) === 2), 'R3: a paused tab with its own edits asks before discarding anything');
  await page.bringToFront(); await page.click('#takeoverLoad'); // R9-MN2: tab3 was opened later, so page is a background tab
  const t3b = await E(() => ({ paused: pixelEditor.isAutosavePaused(), px: pixelEditor.getPixel(6, 6) + ':' + pixelEditor.getPixel(9, 9), notice: !!document.querySelector('#tabNotice') }));
  assert(!t3b.paused && t3b.px === '7:0' && !t3b.notice && err5.length === 0, 'R3: "Load latest autosave" loads the other tab\'s final work and unpauses (' + t3b.px + ')');
  await page.reload(); await boot();
  assert(!(await E(() => pixelEditor.isAutosavePaused())) && (await px(6, 6)) === 7, 'R3: after takeover the tab owns the autosave across reloads');

  section('round 3: R4 lock API failure falls back to BroadcastChannel');
  const tab4 = await ctx.newPage(); const err6 = []; tab4.on('pageerror', e => err6.push(e.message));
  await tab4.addInitScript(() => { navigator.locks.request = () => Promise.reject(new DOMException('sandboxed', 'SecurityError')); });
  await tab4.goto(FILE); await tab4.waitForFunction(() => window.pixelEditor); await tab4.evaluate(() => pixelEditor.ready);
  const r4 = await tab4.evaluate(() => ({ paused: pixelEditor.isAutosavePaused(), notice: !!document.querySelector('#tabNotice') }));
  await tab4.close();
  assert(r4.paused && r4.notice && err6.length === 0 && !(await E(() => pixelEditor.isAutosavePaused())), 'R4: when the lock API rejects, the BroadcastChannel check still sees the editing tab → paused, not fail-open');

  section('round 4: R7 edits right after New / Example / Open survive reload and crash');
  const setOld = async () => { await E(async () => { pixelEditor.newDocument(8, 8); pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[1, 1, 3]] }); await pixelEditor.flushAutosave(); }); };
  for (const d of [0, 100, 300]) {
    await setOld();
    await E(() => { pixelEditor.newDocument(20, 20); pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[15, 15, 4]] }); });
    if (d) await page.waitForTimeout(d);
    await page.reload(); await boot();
    const r = await E(() => pixelEditor.getMeta().width + ':' + pixelEditor.getPixel(15, 15));
    assert(r === '20:4', `R7: New 20×20 + 1 edit, reload after ${d} ms → new doc and edit kept (${r})`);
  }
  await setOld();
  await E(() => { pixelEditor.loadExample(); pixelEditor.createSession('ai').apply({ op: 'set_pixels', layer: 0, frame: 0, pixels: [[0, 0, 5]] }); });
  await page.reload(); await boot();
  const r7ex = await E(() => pixelEditor.getMeta().width + ':' + pixelEditor.getPixel(0, 0, 0, 0) + ':' + pixelEditor.getPixelTag(0, 0, 0, 0) + ':' + pixelEditor.getMeta().frames.length);
  assert(r7ex === '32:5:1:' + (await E(() => { pixelEditor.loadExample(); return pixelEditor.getMeta().frames.length; })), 'R7: Load Example + 1 AI edit, instant reload → example and edit kept (' + r7ex + ')');
  { // Open (via the toolbar file chooser) + edit + instant reload
    await setOld();
    const openFile = path.join(require('os').tmpdir(), 'osh-r7-open.osh.json');
    fs.writeFileSync(openFile, await E(() => { pixelEditor.newDocument(12, 10); pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[2, 2, 6]] }); return JSON.stringify(pixelEditor.save()); }));
    await setOld();
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('button[data-act="open"]')]);
    await fc.setFiles(openFile); await page.waitForFunction(() => pixelEditor.getMeta().width === 12);
    await E(() => pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[3, 3, 7]] }));
    await page.reload(); await boot();
    const r7o = await E(() => pixelEditor.getMeta().width + ':' + pixelEditor.getPixel(2, 2) + ':' + pixelEditor.getPixel(3, 3));
    assert(r7o === '12:6:7', 'R7: Open a file + 1 edit, instant reload → opened doc and edit kept (' + r7o + ')');
    fs.unlinkSync(openFile);
  }
  const ctxC = await browser.newContext(); // own renderer + storage: Page.crash can take sibling file:// tabs down with it
  const crashTab = async (fn, wait) => { // run fn in a tab that is then crashed (no pagehide/unload), then reopen in a fresh tab
    const t = await ctxC.newPage(); await t.goto(FILE); await t.waitForFunction(() => window.pixelEditor); await t.evaluate(() => pixelEditor.ready);
    const extra = await t.evaluate(fn);
    if (wait) await t.waitForTimeout(wait);
    const crashed = new Promise(r => t.once('crash', r)); const cdp = await ctxC.newCDPSession(t);
    cdp.send('Page.crash').catch(() => {}); await crashed; // the CDP call never resolves; wait for the crash event (crashed tab is left as is)
    const t2 = await ctxC.newPage(); const errC = []; t2.on('pageerror', e => errC.push(e.message));
    await t2.goto(FILE); await t2.waitForFunction(() => window.pixelEditor); await t2.evaluate(() => pixelEditor.ready);
    const res = await t2.evaluate(() => pixelEditor.getMeta().width + ':' + [10, 11, 12].map(x => pixelEditor.getPixel(x, 10)).join('') + ':' + pixelEditor.getPixel(3, 5) + ':' + pixelEditor.isAutosavePaused());
    await t2.close(); return { extra, res, errC };
  };
  for (const w of [0, 200]) {
    const c = await crashTab(async () => { pixelEditor.newDocument(8, 8); pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[1, 1, 3]] }); await pixelEditor.flushAutosave();
      pixelEditor.newDocument(20, 20); const me = pixelEditor.createSession('user'); for (let i = 0; i < 3; i++) me.apply({ op: 'set_pixels', pixels: [[10 + i, 10, 2 + i]] }); }, w);
    assert(c.res.startsWith('20:234:') && c.res.endsWith(':false') && c.errC.length === 0, `R7: New + 3 edits, renderer crash after ${w} ms (no pagehide) → all kept (${c.res})`);
  }
  const c7 = await crashTab(async () => {
    pixelEditor.newDocument(8, 8); await pixelEditor.flushAutosave();
    pixelEditor.newDocument(24, 24); await pixelEditor.flushAutosave(); // the reset's own save has landed; from here only the debounce saves
    const me = pixelEditor.createSession('user'), seen = [];
    for (let i = 0; i < 9; i++) { me.apply({ op: 'set_pixels', pixels: [[i, 5, 1 + (i % 7)]] }); await new Promise(r => setTimeout(r, 600)); seen.push(pixelEditor.autosaveStatus().state); }
    localStorage.removeItem('osh-pixel-editor:journal:v1'); // prove the record itself was saved during steady editing
    return seen;
  });
  assert(c7.res.startsWith('24:') && c7.res.split(':')[2] === '4' && c7.extra.includes('ok'), 'R7: editing every 600 ms for ~5 s still autosaves (3 s max wait); crash with no journal → new doc and edits kept (' + c7.res + ' ' + c7.extra.join(',') + ')');
  await ctxC.close();

  section('round 4: nits — takeover "keep" writes now, labels, BroadcastChannel takeover');
  await E(async () => { pixelEditor.newDocument(128, 128); const me = pixelEditor.createSession('user'); const px = []; for (let i = 0; i < 128 * 128; i += 3) px.push([i % 128, i >> 7, 1 + (i % 15)]); me.apply({ op: 'set_pixels', pixels: px }); for (let f = 0; f < 15; f++) me.apply({ op: 'add_frame' }); await pixelEditor.flushAutosave(); });
  const tabK = await ctx.newPage(); const errK = []; tabK.on('pageerror', e => errK.push(e.message));
  await tabK.goto(FILE); await tabK.waitForFunction(() => window.pixelEditor); await tabK.evaluate(() => pixelEditor.ready);
  await tabK.evaluate(() => pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[0, 0, 9]] })); // paused tab's own edit
  await page.goto('about:blank');
  await tabK.waitForSelector('#takeoverKeep', { timeout: 5000 });
  const labels = await tabK.evaluate(() => [document.querySelector('#takeoverLoad').textContent, document.querySelector('#takeoverKeep').textContent]);
  assert(/discard this tab/.test(labels[0]) && /replace the saved/.test(labels[1]), 'N-c: takeover buttons say which version is discarded (' + labels.join(' / ') + ')');
  await tabK.bringToFront(); await tabK.click('#takeoverKeep'); await tabK.reload(); await tabK.waitForFunction(() => window.pixelEditor); await tabK.evaluate(() => pixelEditor.ready);
  const rk = await tabK.evaluate(() => pixelEditor.getPixel(0, 0) + ':' + pixelEditor.isAutosavePaused());
  assert(rk === '9:false' && errK.length === 0, 'N-a: "Keep this tab\'s version" then an instant reload (128² × 16 frames) keeps this tab\'s version (' + rk + ')');
  await tabK.close();
  const noLocks = () => { navigator.locks.request = () => Promise.reject(new DOMException('sandboxed', 'SecurityError')); };
  const tabA = await ctx.newPage(), tabB = await ctx.newPage(); const errB = []; tabB.on('pageerror', e => errB.push(e.message));
  await tabA.addInitScript(noLocks); await tabB.addInitScript(noLocks);
  await tabA.goto(FILE); await tabA.waitForFunction(() => window.pixelEditor); await tabA.evaluate(() => pixelEditor.ready);
  await tabB.goto(FILE); await tabB.waitForFunction(() => window.pixelEditor); await tabB.evaluate(() => pixelEditor.ready);
  assert(!(await tabA.evaluate(() => pixelEditor.isAutosavePaused())) && await tabB.evaluate(() => pixelEditor.isAutosavePaused()), 'N-b: without usable Web Locks the second tab is paused by the BroadcastChannel check');
  await tabA.evaluate(() => pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[5, 5, 11]] }));
  await tabA.close({ runBeforeUnload: false });
  await tabB.waitForFunction(() => !pixelEditor.isAutosavePaused(), null, { timeout: 5000 });
  const rb = await tabB.evaluate(() => pixelEditor.getPixel(5, 5));
  assert(rb === 11 && errB.length === 0, 'N-b: when the editing tab goes away, the fallback-paused tab takes over with its latest work (' + rb + ')');
  await tabB.close(); await page.goto(FILE); await boot();

  section('Ultron round 5: F1 fallback lock heartbeat, F2 journal bursts');
  { // F1: own context (own storage), every tab without usable Web Locks
    const ctxF = await browser.newContext(); const errF = [];
    const openF = async () => { const p = await ctxF.newPage(); p.on('pageerror', e => errF.push(e.message)); await p.addInitScript(noLocks); await p.goto(FILE); await p.waitForFunction(() => window.pixelEditor); await p.evaluate(() => pixelEditor.ready); return p; };
    const pausedF = p => p.evaluate(() => pixelEditor.isAutosavePaused());
    const trials = [];
    for (let t = 0; t < 10; t++) {
      const A = await openF(), B = await openF(), C = await openF();
      const start = [await pausedF(A), await pausedF(B), await pausedF(C)].join();
      const t0 = Date.now(); await A.close({ runBeforeUnload: false });
      let ms = -1; for (let i = 0; i < 160 && ms < 0; i++) { if (!(await pausedF(B)) || !(await pausedF(C))) ms = Date.now() - t0; else await new Promise(r => setTimeout(r, 50)); }
      await new Promise(r => setTimeout(r, 1500)); // give a second (wrong) takeover time to happen
      trials.push({ start, ms, editors: [!(await pausedF(B)), !(await pausedF(C))].filter(Boolean).length });
      await B.close(); await C.close();
    }
    const okT = trials.filter(r => r.start === 'false,true,true' && r.editors === 1 && r.ms >= 0).length;
    const tk = trials.map(r => r.ms).sort((a, b) => a - b);
    assert(okT === 10 && errF.length === 0, 'F1: 3 tabs without Web Locks, close the editor: exactly 1 editor results, 10/10 trials (takeover ' + tk[0] + '–' + tk[tk.length - 1] + ' ms) ' + (okT === 10 ? '' : JSON.stringify(trials)));
    const A = await openF(), B = await openF();
    await A.evaluate(() => { const t = Date.now(); while (Date.now() - t < 1800); }); await A.evaluate(() => { const t = Date.now(); while (Date.now() - t < 1500); });
    await new Promise(r => setTimeout(r, 2200));
    const busy = [await pausedF(A), await pausedF(B)].join();
    assert(busy === 'false,true', 'F1: a busy editor (1.8 s + 1.5 s long tasks) is not taken over by a paused tab (' + busy + ')');
    await A.evaluate(() => pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[1, 1, 7]] }));
    await A.close({ runBeforeUnload: false }); await B.waitForFunction(() => !pixelEditor.isAutosavePaused(), null, { timeout: 5000 });
    assert(await B.evaluate(() => pixelEditor.getPixel(1, 1)) === 7, 'F1: after the busy editor closes, the paused tab takes over with its latest work');
    // a stale heartbeat (editor crashed without "bye") is taken over; a fresh foreign heartbeat makes a fallback editor step down
    await B.evaluate(() => { const w = () => localStorage.setItem('osh-pixel-editor:owner:v1', JSON.stringify({ id: 'other-tab', t: Date.now() })); w(); window.__hb = setInterval(w, 500); });
    await B.waitForFunction(() => pixelEditor.isAutosavePaused() && !!document.querySelector('#tabNotice'), null, { timeout: 4000 });
    assert(true, 'F1: an editor whose heartbeat was superseded by another tab (it was suspended past the stale threshold) steps down to paused');
    const t1 = Date.now(); await B.evaluate(() => clearInterval(window.__hb));
    await B.waitForFunction(() => !pixelEditor.isAutosavePaused(), null, { timeout: 12000 });
    const staleMs = Date.now() - t1;
    assert(staleMs >= 4000 && errF.length === 0, 'F1: a silent (crashed) editor is taken over only after its heartbeat goes stale (' + staleMs + ' ms, threshold 6 s)');
    await ctxF.close();
  }
  { // F2: 20k synchronous API ops after New: no crash, flat per-op cost, journal stays small, autosave covers the burst
    const r = await E(async () => {
      const api = pixelEditor, me = api.createSession('ai'); api.newDocument(192, 108);
      for (let i = 0; i < 3; i++) api.createSession('user').apply({ op: 'add_layer' }); for (let i = 0; i < 23; i++) api.createSession('user').apply({ op: 'add_frame' });
      const out = {};
      for (const N of [1000, 5000, 20000]) {
        if (N > 1000) api.newDocument(192, 108);
        const t0 = performance.now(); let worst = 0;
        for (let i = 0; i < N; i++) { const t = performance.now(); me.apply({ op: 'set_pixels', pixels: [[i % 192, ((i / 192) | 0) % 108, 1 + i % 9]] }); worst = Math.max(worst, performance.now() - t); }
        await new Promise(r => setTimeout(r, 0));
        out[N] = { usPerOp: Math.round((performance.now() - t0) / N * 1000), worstMs: Math.round(worst), journalKB: Math.round((localStorage.getItem('osh-pixel-editor:journal:v1') || '').length / 1024) };
      }
      const fl = await api.flushAutosave(); out.flush = !!(fl && (fl.ok !== false)); out.last = api.getPixel(19999 % 192, ((19999 / 192) | 0) % 108);
      return out;
    });
    assert(r[20000].usPerOp < 100 && r[20000].worstMs < 50 && r[20000].journalKB < 64 && r[1000].usPerOp < 200, 'F2: 1k / 5k / 20k API ops after New: ' + [1000, 5000, 20000].map(n => r[n].usPerOp + ' µs/op (worst ' + r[n].worstMs + ' ms, journal ' + r[n].journalKB + ' KB)').join(' / '));
    await page.reload(); await boot();
    const after = await E(() => pixelEditor.getPixel(19999 % 192, ((19999 / 192) | 0) % 108) + ':' + pixelEditor.getLog().length);
    assert(after === r.last + ':20000', 'F2: the 20k-op burst skipped the journal but the immediate autosave restores all of it after reload (' + after + ')');
    // R7 still holds for normal edits: one op then an instant reload keeps it via the journal
    await E(() => { pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[3, 3, 5]] }); }); await page.reload(); await boot();
    assert(await px(3, 3) === 5, 'F2/R7: a single edit right before an instant reload is still journaled');
    // Ultron's maxOps fold scenario: 200k synchronous ops after New, then save/load round-trip
    const big = await E(() => {
      const api = pixelEditor, me = api.createSession('user'); api.newDocument(8, 8); const t = performance.now();
      for (let i = 0; i < 200050; i++) me.apply({ op: 'set_pixels', pixels: [[i % 8, (i >> 3) % 8, 1 + (i % 5)]] });
      const ms = Math.round(performance.now() - t), live = JSON.stringify(api.getDocument().cels), s = api.save(); api.load(JSON.stringify(s));
      return { ms, logLen: api.getLog().length, same: JSON.stringify(api.getDocument().cels) === live };
    });
    assert(big.same && errors.length === 0, 'F2: 200k synchronous ops after New (history folding) then save/load: no crash, ' + big.ms + ' ms, log ' + big.logLen + ', round-trip identical');
    await E(() => pixelEditor.newDocument(32, 32)); await page.waitForTimeout(100);
  }

  section('Ultron round 6: N1..N4');
  { // N1: a tab frozen past the stale threshold must not win the editor back from the tab that took over
    const ctxN = await browser.newContext(); const errN = [];
    const openN = async (q = '') => { const p = await ctxN.newPage(); p.on('pageerror', e => errN.push(e.message)); await p.addInitScript(noLocks); await p.goto(FILE + q); await p.waitForFunction(() => window.pixelEditor); await p.evaluate(() => pixelEditor.ready); return p; };
    const pausedN = p => p.evaluate(() => pixelEditor.isAutosavePaused());
    const out = [];
    for (let t = 0; t < 6; t++) {
      const A = await openN(), B = await openN();
      await A.evaluate(async () => { pixelEditor.newDocument(16, 16); await pixelEditor.flushAutosave(); pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[2, 2, 3]] }); }); // unsaved edit (journaled)
      await A.waitForTimeout(50);
      // A freezes for 11 s. B's takeover needs the stale threshold (6 s from A's last beat), up to one 1 s watch tick, up to
      // 150 ms probe spread, the 150 ms hello window and the 250 ms claim wait: about 7.6 s at worst. An 8 s freeze left
      // under 0.5 s of slack, so under load A sometimes resumed first, answered B's hello and (correctly) kept the editor role.
      await A.evaluate(() => { setTimeout(() => { const t0 = Date.now(); while (Date.now() - t0 < 11000); }, 0); });
      await B.waitForFunction(() => !pixelEditor.isAutosavePaused(), null, { timeout: 20000 });
      await B.evaluate(async () => { pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[8, 8, 5]] }); await pixelEditor.flushAutosave(); });
      await A.evaluate(() => 0); await A.waitForTimeout(2500); // A has resumed: its queued hello / timers / autosave run now
      const st = [await pausedN(A), await pausedN(B), await A.evaluate(() => !!document.querySelector('#tabNotice'))].join();
      await A.close(); await B.close();
      const C = await openN(); const r = await C.evaluate(() => pixelEditor.getPixel(8, 8) + ':' + pixelEditor.getPixel(2, 2) + ':' + pixelEditor.isAutosavePaused()); await C.close();
      out.push(st + '|' + r);
    }
    assert(out.every(x => x === 'true,false,true|5:3:false') && errN.length === 0, 'R6-N1: editor frozen 11 s while another tab takes over, then resumes: the old tab steps down and the newer save survives, 6/6 (' + [...new Set(out)].join(' ; ') + ')');
    { // a lone editor frozen just as long (nobody to take over) keeps editing and saving after a short re-check
      const S = await openN(); await S.evaluate(async () => { pixelEditor.newDocument(16, 16); await pixelEditor.flushAutosave(); });
      await S.evaluate(() => { setTimeout(() => { const t0 = Date.now(); while (Date.now() - t0 < 7000); }, 0); }); await S.waitForTimeout(100);
      await S.evaluate(() => pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[4, 4, 6]] })); await S.waitForTimeout(1500);
      await S.evaluate(() => pixelEditor.flushAutosave()); const s1 = await S.evaluate(() => pixelEditor.isAutosavePaused() + ':' + !!document.querySelector('#tabNotice'));
      await S.close(); const C = await openN(); const s2 = await C.evaluate(() => pixelEditor.getPixel(4, 4)); await C.close();
      assert(s1 === 'false:false' && s2 === 6, 'R6-N1: a lone fallback editor frozen 7 s keeps the editor role and its next edit is saved (' + s1 + ', ' + s2 + ')');
    }
    // N3: the undo floor follows history folding (?testMaxOps=50)
    const P = await openN('?testMaxOps=50');
    await P.evaluate(() => { pixelEditor.newDocument(10, 10); pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[1, 1, 2]] }); });
    await P.click('[data-act="example"]'); await P.waitForTimeout(60); await P.click('#mOk'); await P.waitForTimeout(60);
    const ex = await P.evaluate(() => ({ w: pixelEditor.getMeta().width, cur: pixelEditor.getCursor() }));
    await P.evaluate(() => { const me = pixelEditor.createSession('user'); for (let i = 0; i < 60; i++) me.apply({ op: 'set_pixels', pixels: [[i % 16, 20, 1 + (i % 5)]] }); });
    const top = await P.evaluate(() => pixelEditor.getCursor()); let swapAt = -1, clicks = 0;
    for (; clicks < 200; clicks++) { const before = await P.evaluate(() => pixelEditor.getCursor()); await P.click('[data-act="undo"]'); if (await P.evaluate(() => pixelEditor.getMeta().width) !== ex.w) { swapAt = before; break; } }
    assert(ex.w !== 10 && top < ex.cur + 60 && swapAt === 0 && clicks === top, `R6-N3: after history folds (cap 50), Undo walks every remaining step of the example before swapping back to the previous sprite (cursor ${top} → swap at ${swapAt} after ${clicks} undos)`);
    await P.close(); await ctxN.close();
  }
  { // N2: unsaved edits right before a >2000-op burst survive a crash before the burst's save lands
    const ctxB = await browser.newContext(); const res = [];
    for (let t = 0; t < 3; t++) {
      const p = await ctxB.newPage(); await p.goto(FILE); await p.waitForFunction(() => window.pixelEditor); await p.evaluate(() => pixelEditor.ready);
      await p.evaluate(async () => { const me = pixelEditor.createSession('user'); pixelEditor.newDocument(96, 96); for (let i = 1; i < 4; i++) me.apply({ op: 'add_layer' }); for (let i = 1; i < 64; i++) me.apply({ op: 'add_frame' }); await pixelEditor.flushAutosave();
        for (let i = 0; i < 3; i++) me.apply({ op: 'set_pixels', pixels: [[10 + i, 10, 2 + i]] }); await new Promise(r => setTimeout(r, 30));
        const ai = pixelEditor.createSession('ai'); for (let i = 0; i < 2001; i++) ai.apply({ op: 'set_pixels', pixels: [[i % 96, 40 + ((i / 96) | 0), 1 + (i % 9)]] }); });
      const crashed = new Promise(r => p.once('crash', r)); const cdp = await ctxB.newCDPSession(p); cdp.send('Page.crash').catch(() => {}); await crashed;
      const q = await ctxB.newPage(); await q.goto(FILE); await q.waitForFunction(() => window.pixelEditor); await q.evaluate(() => pixelEditor.ready);
      res.push(await q.evaluate(() => pixelEditor.getMeta().width + ':' + [10, 11, 12].map(x => pixelEditor.getPixel(x, 10)).join(''))); await q.close();
    }
    assert(res.every(r => r === '96:234'), 'R6-N2: 3 edits, then a 2001-op burst, then an immediate renderer crash: the earlier edits survive (' + res.join(' ') + ')');
    await ctxB.close();
  }
  { // N4: renderSheet obeys the 8192 px cap with a clear error
    const r = await E(() => { pixelEditor.newDocument(256, 16); const me = pixelEditor.createSession('user'); for (let i = 1; i < 5; i++) me.apply({ op: 'add_frame' });
      const t = performance.now(); let err = ''; try { pixelEditor.renderSheet({ scale: 8 }); } catch (e) { err = e.code + ': ' + e.message; } const ms = performance.now() - t;
      const ok = pixelEditor.renderSheet({ scale: 6 }).meta.size; return { err, ms: Math.round(ms), ok: ok.w + 'x' + ok.h }; });
    assert(/^too_big: .*10240×128.*8192/.test(r.err) && r.ms < 50 && r.ok === '7680x96', 'R6-N4: renderSheet({scale: 8}) on a 5-frame 256-wide sprite fails fast (' + r.ms + ' ms) with "' + r.err + '"; scale 6 still renders ' + r.ok);
    await E(() => pixelEditor.newDocument(32, 32));
  }

  section('QA round 1 (Mystique): OSH-01..21 + UX');
  const fresh = (w = 16, h = 16) => E(([w, h]) => { pixelEditor.newDocument(w, h); }, [w, h]);
  const settle = () => page.waitForTimeout(60);
  const isOpen = () => E(() => !document.querySelector('#modal').classList.contains('hidden'));
  const nz = () => E(() => pixelEditor.getPixels().filter(v => v > 0).length);
  const toastText = () => E(() => (document.querySelector('#toast') || {}).textContent || '');
  const blurAll = () => E(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
  await fresh(); await settle();
  // OSH-01: Enter / Space activate focused native controls
  { const n0 = await E(() => pixelEditor.getMeta().layers.length);
    await page.focus('#layAdd'); await page.keyboard.press('Enter'); await settle(); await page.focus('#layAdd'); await page.keyboard.press(' '); await settle();
    const n1 = await E(() => pixelEditor.getMeta().layers.length);
    await page.focus('#tools button[data-tool="eraser"]'); await page.keyboard.press('Enter'); const t1 = await E(() => pixelEditor.getState().tool);
    const g0 = await page.isChecked('#optGrid'); await page.focus('#optGrid'); await page.keyboard.press(' '); const g1 = await page.isChecked('#optGrid'); await page.keyboard.press(' ');
    await page.focus('[data-act="new"]'); await page.keyboard.press('Enter'); await settle(); const nw = await isOpen(); await page.keyboard.press('Escape');
    assert(n1 === n0 + 2 && t1 === 'eraser' && g1 === !g0 && nw && !(await isOpen()), `OSH-01: Enter/Space activate focused buttons and checkboxes (layers ${n0}→${n1}, tool ${t1}, grid ${g0}→${g1}, New opens ${nw})`); }
  // OSH-02: Enter on a focused Cancel cancels; the art is kept
  await fresh(); await E(() => pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[3, 3, 5]] }));
  await page.focus('[data-act="new"]'); await page.keyboard.press('Enter'); await settle(); await page.focus('#mCancel'); await page.keyboard.press('Enter'); await settle();
  assert(!(await isOpen()) && await px(3, 3) === 5 && (await E(() => pixelEditor.getMeta().width)) === 16, 'OSH-02: Enter on the New dialog\'s Cancel button cancels and keeps the art');
  // OSH-03: confirming with Enter does not re-open the dialog
  { const a0 = await E(() => pixelEditor.getMeta().animations.length);
    await page.click('#anAdd'); await page.fill('#askIn', 'qa-anim'); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
    const a1 = await E(() => pixelEditor.getMeta().animations.length);
    await page.focus('[data-act="new"]'); await page.keyboard.press('Enter'); await settle(); await page.keyboard.press('Enter'); await page.waitForTimeout(150); const reopened = await isOpen();
    assert(a1 === a0 + 1 && !reopened, `OSH-03: Enter in + Animation / New dialogs submits once and the dialog stays closed (anims ${a0}→${a1}, New reopened: ${reopened})`); }
  // OSH-04 / U3: Load example with unsaved work asks first, and Ctrl+Z brings the sprite back (New too)
  await fresh(); await E(() => pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[2, 2, 7], [3, 2, 7]] }));
  await page.click('[data-act="example"]'); await settle();
  const exAsk = await isOpen() && /Replace your sprite/.test(await E(() => document.querySelector('#mbody').innerText));
  await page.click('#mOk'); await settle(); const exW = await E(() => pixelEditor.getMeta().width);
  const undoEnabled = await E(() => !document.querySelector('[data-act="undo"]').disabled);
  await blurAll(); await page.keyboard.press('Control+z'); await settle();
  const back = await E(() => pixelEditor.getMeta().width + ':' + pixelEditor.getPixel(2, 2) + ':' + pixelEditor.getPixel(3, 2));
  await page.keyboard.press('Control+y'); await settle(); const fwd = await E(() => pixelEditor.getMeta().width);
  assert(exAsk && exW === 32 && undoEnabled && back === '16:7:7' && fwd === 32, `OSH-04: Load example asks when dirty; Ctrl+Z restores the previous sprite (${back}), Ctrl+Y goes forward again (${fwd})`);
  await page.keyboard.press('Control+z'); await settle(); await E(() => pixelEditor.flushAutosave()); await page.reload(); await boot();
  assert((await E(() => pixelEditor.getMeta().width + ':' + pixelEditor.getPixel(2, 2))) === '16:7', 'OSH-04: the restored sprite is what autosave keeps (reload)');
  await page.click('[data-act="example"]'); await settle(); await page.click('#mCancel'); await settle();
  assert((await E(() => pixelEditor.getMeta().width)) === 16, 'OSH-04: Cancel on the Load-example confirm keeps the sprite');
  await page.focus('[data-act="new"]'); await page.keyboard.press('Enter'); await settle();
  const nDirty = await E(() => !document.querySelector('#nDirty').classList.contains('hidden'));
  await page.selectOption('#nSize', '8x8'); await page.click('#mOk'); await settle();
  await page.click('[data-act="undo"]'); await settle();
  assert(nDirty && (await E(() => pixelEditor.getMeta().width + ':' + pixelEditor.getPixel(2, 2))) === '16:7', 'OSH-04: New warns about unsaved changes, and the Undo button brings the old sprite back');
  { await fresh(); await page.click('[data-act="example"]'); await settle(); const asked = await isOpen();
    await page.keyboard.press('Escape'); await E(() => pixelEditor.loadExample());
    assert(!asked, 'OSH-04: an empty / clean sprite is replaced without a confirm'); }
  // OSH-05 / U8: letters typed while a select has focus run the shortcut and do not type-ahead
  await fresh(); await page.selectOption('#palPreset', 'PICO-8'); await page.focus('#palPreset');
  { const pal0 = await E(() => pixelEditor.getMeta().palette.join()); await page.keyboard.press('e'); await settle();
    const r = await E(() => pixelEditor.getState().tool), pal1 = await E(() => pixelEditor.getMeta().palette.join());
    await page.focus('#optSize'); await page.keyboard.press('g'); const r2 = await E(() => pixelEditor.getState().tool);
    await E(() => pixelEditor.setTool('pencil')); await page.focus('#optSize'); const sz0 = await page.inputValue('#optSize'); await page.keyboard.press('ArrowDown'); const sz1 = await page.inputValue('#optSize');
    assert(r === 'eraser' && pal1 === pal0 && r2 === 'fill' && sz1 !== sz0, `OSH-05: in a focused select, E/G select tools without changing the palette, arrows still change the value (${r}, ${r2}, size ${sz0}→${sz1})`); }
  // OSH-06: a burst of 5000 separate ops and 5000 undos is fast and keeps durability
  await fresh(64, 64);
  { const r = await E(async () => { const me = pixelEditor.createSession('ai'); const t0 = performance.now(); for (let i = 0; i < 5000; i++) me.apply({ op: 'set_pixels', layer: 0, frame: 0, pixels: [[i % 64, (i >> 6) % 64, 1 + (i % 15)]] });
      const t1 = performance.now(); const j1 = (localStorage.getItem('osh-pixel-editor:journal:v1') || '').length; for (let i = 0; i < 5000 && pixelEditor.canUndo(); i++) pixelEditor.undo(); const t2 = performance.now();
      return { apply: t1 - t0, undo: t2 - t1, j1, cursor: pixelEditor.getLog().length }; });
    assert(r.apply < 1000 && r.undo < 1500, `OSH-06: 5000 API ops in ${r.apply.toFixed(0)} ms, 5000 undos in ${r.undo.toFixed(0)} ms (journal ${Math.round(r.j1 / 1024)} KB)`);
    await E(() => { pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[1, 1, 9]] }); });
    await page.reload(); await boot();
    assert((await E(() => pixelEditor.getMeta().width + ':' + pixelEditor.getPixel(1, 1))) === '64:9', 'OSH-06: an edit right after the burst still survives an instant reload (journal written before the task ends)'); }
  // OSH-07: Ctrl+S in the document-name box saves
  await page.focus('#docName');
  { const dl = await Promise.all([page.waitForEvent('download', { timeout: 3000 }), page.keyboard.press('Control+s')]).then(([d]) => d.suggestedFilename()).catch(e => 'none: ' + e.message);
    assert(/\.osh\.json$/.test(dl), 'OSH-07: Ctrl+S while the name box has focus downloads the sprite (' + dl + ')'); }
  // OSH-08 / OSH-11 / U4: small viewports scroll instead of clipping; 1024×600 shows everything
  { const keys = ['[data-act=help]', '[data-act=exportSheet]', '#expScale', '#saveStatus', '#prov', '#anAdd', '#layOpacity', '#palExport', '#tools button[data-tool=select]', '#pvPlay', '#zoomFit', '#xfScope'];
    const probe = () => E(keys => keys.map(s => { const e = document.querySelector(s); e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = e.getBoundingClientRect(); const ok = r.width > 0 && r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; window.scrollTo(0, 0); return ok ? '' : s; }).filter(Boolean), keys);
    await page.setViewportSize({ width: 640, height: 400 }); await page.waitForTimeout(200);
    const bad640 = await probe(); const wide = await E(() => document.documentElement.scrollWidth <= innerWidth + 1);
    await page.setViewportSize({ width: 512, height: 300 }); await page.waitForTimeout(200); const bad512 = await probe();
    await page.setViewportSize({ width: 1024, height: 600 }); await page.waitForTimeout(200);
    const vis1024 = await E(keys => keys.filter(s => { const r = document.querySelector(s).getBoundingClientRect(); return !(r.width > 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1); }), keys);
    const dbg = await E(() => ['#layOpacity', '#side', '#topbar', '#optbar', '#pvBox', '#palette', '#layers'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return s + ':' + Math.round(r.top) + '-' + Math.round(r.bottom); }).join(' ') + ' scrollY ' + scrollY + ' side.scrollTop ' + document.querySelector('#side').scrollTop);
    const trunc = await E(() => ['#saveStatus', '#prov'].filter(s => { const e = document.querySelector(s); return e.scrollWidth > e.clientWidth + 1; }));
    await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(200);
    assert(!bad640.length && !bad512.length && wide, `OSH-08: at 640×400 and 512×300 every key control is reachable by scrolling, no horizontal overflow (${bad640.concat(bad512).join(',') || 'all ok'})`);
    assert(!vis1024.length && !trunc.length, `OSH-11: at 1024×600 all key controls are on screen and the badges are not truncated (${vis1024.concat(trunc).join(',') || 'all ok'}) ${vis1024.length ? dbg : ''}`);
    const fonts = await E(() => [...document.querySelectorAll('#app *')].filter(e => e.offsetParent && e.childNodes.length && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())).map(e => parseFloat(getComputedStyle(e).fontSize)).reduce((a, b) => Math.min(a, b), 99));
    assert(fonts >= 12, 'U4: smallest visible text is ' + fonts + ' px (≥ 12)'); }
  // OSH-09: palette swatches, layer rows, eye toggles, frame and animation cells are keyboard operable
  await E(() => { pixelEditor.newDocument(16, 16); const me = pixelEditor.createSession('user'); me.apply({ op: 'add_frame' }); me.apply({ op: 'add_frame' }); me.apply({ op: 'add_layer' }); }); await settle();
  { const tabbable = await E(() => ({ sw: [...document.querySelectorAll('#palette .sw')].filter(e => e.tabIndex === 0).length, lay: [...document.querySelectorAll('#layers .lsel')].filter(e => e.tabIndex === 0).length, eye: [...document.querySelectorAll('#layers .eye')].every(e => e.tagName === 'BUTTON' && /Hide layer|Show layer/.test(e.getAttribute('aria-label'))), fr: [...document.querySelectorAll('#tlgrid .cell.rv')].filter(e => e.tabIndex === 0).length }));
    await E(() => document.querySelector('#palette .sw.rv[tabindex="0"]').focus()); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
    const prim = await E(() => [pixelEditor.getState().primary, document.activeElement.dataset.fk]); await page.keyboard.press('Shift+Enter'); const sec = await E(() => pixelEditor.getState().secondary);
    await E(() => document.querySelector('#layers .lsel[tabindex="0"]').focus()); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await settle();
    const layer = await E(() => [pixelEditor.getState().layer, pixelEditor.getMeta().layers[0].id]);
    await E(() => document.querySelector('#layers .eye').focus()); await page.keyboard.press('Enter'); await settle(); const hid = await E(() => pixelEditor.getMeta().layers.filter(l => !l.visible).length);
    await page.keyboard.press(' '); await settle(); const hid2 = await E(() => pixelEditor.getMeta().layers.filter(l => !l.visible).length);
    await E(() => document.querySelector('#tlgrid .frames .cell.rv[tabindex="0"]').focus()); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); await settle();
    const fr = await E(() => pixelEditor.getState().frame);
    assert(tabbable.sw === 1 && tabbable.lay === 1 && tabbable.eye && tabbable.fr === 1, 'OSH-09: palette, layers and timeline are each one Tab stop with a roving tabindex; eye toggles are labelled buttons ' + JSON.stringify(tabbable));
    assert(prim[0] === 3 && sec === 3 && layer[0] === layer[1] && hid === 1 && hid2 === 0 && fr === 2, `OSH-09: arrows + Enter pick colours (primary ${prim[0]}, Shift+Enter secondary ${sec}), select a layer, toggle visibility (${hid}/${hid2}) and pick a frame (${fr})`);
    await E(() => pixelEditor.createSession('user').apply({ op: 'add_animation', name: 'kb', frames: [pixelEditor.getMeta().frames[0].id] })); await settle();
    await E(() => document.querySelector('#tlgrid .frames .cell.rv[tabindex="0"]').focus()); await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); await settle();
    const an = await E(() => pixelEditor.getMeta().animations.find(a => a.name === 'kb').frames.length);
    assert(an === 2, 'OSH-09: arrows reach the animation row and Enter toggles a frame into it (' + an + ' frames)'); }
  // OSH-10: opacity slider takes arrow keys (frames do not change)
  { const f0 = await E(() => pixelEditor.getState().frame); await page.focus('#layOpacity'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await settle();
    const r = await E(() => [document.querySelector('#layOpacity').value, pixelEditor.getState().frame]);
    assert(r[0] === '98' && r[1] === f0, `OSH-10: arrows move the opacity slider (${r[0]}), frame unchanged`); }
  // OSH-12 / U11: dialogs stay open with a message when validation fails; names are capped at 64
  await fresh(); await settle();
  { await page.dblclick('#layers .lay .nm'); await page.fill('#askIn', ''); await page.keyboard.type('N'.repeat(80)); const len = (await page.inputValue('#askIn')).length; await page.keyboard.press('Enter'); await settle();
    const nm = await E(() => pixelEditor.getMeta().layers[0].name.length);
    await page.click('#palImport'); await settle(); await page.fill('#palText', ''); await page.click('#mOk'); await settle();
    const imp = await E(() => [!document.querySelector('#modal').classList.contains('hidden'), document.querySelector('#mErr').textContent]); await page.keyboard.press('Escape');
    await E(() => { const me = pixelEditor.createSession('user'); me.apply({ op: 'add_animation', name: 'walk', frames: [pixelEditor.getMeta().frames[0].id] }); me.apply({ op: 'add_animation', name: 'idle', frames: [pixelEditor.getMeta().frames[0].id] }); }); await settle();
    await page.dblclick('#tlgrid .anim .an >> nth=1'); await page.fill('#askIn', 'walk'); await page.click('#mOk'); await settle();
    const ren = await E(() => [!document.querySelector('#modal').classList.contains('hidden'), document.querySelector('#askIn') && document.querySelector('#askIn').value, document.querySelector('#mErr').textContent]); await page.keyboard.press('Escape');
    assert(len === 64 && nm === 64, `OSH-12: name inputs are capped at 64 characters (${len}, layer name ${nm})`);
    assert(imp[0] && /colou?r/i.test(imp[1]), 'OSH-12: empty palette import keeps the dialog open with a message (' + imp[1] + ')');
    assert(ren[0] && ren[1] === 'walk' && /exist/i.test(ren[2]), 'OSH-12: a refused rename keeps the dialog and the typed text, with the reason (' + ren[2] + ')'); }
  // OSH-13: every dialog has an accessible name
  { const names = [];
    for (const open of [() => page.click('[data-act="new"]'), () => page.click('#palImport'), () => page.click('[data-act="help"]'), () => page.click('[data-act="resize"]'), () => page.click('#anAdd'), () => page.dblclick('#layers .lay .nm')]) {
      await open(); await settle(); names.push(await E(() => { const id = document.querySelector('.mbox').getAttribute('aria-labelledby'); const h = document.getElementById(id); return h && document.querySelector('.mbox').contains(h) ? h.textContent.trim() : ''; })); await page.keyboard.press('Escape'); await settle(); }
    assert(names.every(Boolean), 'OSH-13: New / Import / Help / Resize / + Animation / Rename dialogs are all named: ' + names.join(' | ')); }
  // OSH-14: primary button contrast ≥ 4.5:1
  { await page.click('[data-act="new"]'); await settle();
    const cr = await E(() => { const lum = c => { const [r, g, b] = c.match(/\d+/g).slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const s = getComputedStyle(document.querySelector('#mOk')); const a = lum(s.backgroundColor), b = lum(s.color); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); });
    await page.keyboard.press('Escape'); assert(cr >= 4.5, 'OSH-14: dialog OK button contrast ' + cr.toFixed(2) + ':1'); }
  // OSH-15: animation row buttons ≥ 24×24
  { const small = await E(() => [...document.querySelectorAll('#tlgrid .lbl button, #tlgrid .lbl .an, #layers .eye')].map(b => b.getBoundingClientRect()).filter(r => r.width < 24 || r.height < 24).length);
    assert(small === 0, 'OSH-15: animation-row buttons and eye toggles are at least 24×24 (' + small + ' too small)'); }
  // OSH-16: "__proto__" animation survives into the sheet JSON
  { const r = await E(() => { pixelEditor.createSession('user').apply({ op: 'add_animation', name: '__proto__', frames: [pixelEditor.getMeta().frames[0].id] }); const m = pixelEditor.renderSheet().meta; return [Object.prototype.hasOwnProperty.call(m.animations, '__proto__'), JSON.parse(JSON.stringify(m)).animations.__proto__ !== undefined, Object.keys(JSON.parse(JSON.stringify(m)).animations).join()]; });
    assert(r[0] && /__proto__/.test(r[2]), 'OSH-16: animation "__proto__" is in the sheet JSON (' + r[2] + ')'); }
  // OSH-17 / U16: current colours are exposed to assistive tech; status is announced
  { const lab = await E(() => [document.querySelector('#ccPrimary').getAttribute('role'), document.querySelector('#ccPrimary').getAttribute('aria-label'), document.querySelector('#ccSecondary').getAttribute('aria-label')]);
    assert(lab[0] === 'img' && /#[0-9a-f]{6}/i.test(lab[1]) && /#[0-9a-f]{6}|transparent/i.test(lab[2]), 'OSH-17: primary/secondary colour boxes are named with the colour (' + lab[1] + ' / ' + lab[2] + ')'); }
  // OSH-18: undo / redo buttons reflect availability
  { await fresh(); await settle(); const s0 = await E(() => [document.querySelector('[data-act="undo"]').disabled, document.querySelector('[data-act="redo"]').disabled, document.querySelector('[data-act="undo"]').getAttribute('aria-disabled')]);
    await E(() => pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[0, 0, 2]] })); await settle(); const s1 = await E(() => document.querySelector('[data-act="undo"]').disabled);
    const s2 = await E(() => { pixelEditor.undo(); return [document.querySelector('[data-act="undo"]').disabled, document.querySelector('[data-act="redo"]').disabled]; });
    assert(s0[0] && s0[1] && s0[2] === 'true' && !s1 && s2[0] && !s2[1], 'OSH-18: undo/redo buttons are disabled (and aria-disabled) when there is nothing to undo/redo, synchronously after API undo'); }
  // OSH-19: big document edit→paint and autosave off the critical path
  { await E(async () => { pixelEditor.newDocument(256, 256); const me = pixelEditor.createSession('user'); for (let l = 0; l < 3; l++) me.apply({ op: 'add_layer' }); for (let f = 0; f < 63; f++) me.apply({ op: 'add_frame' }); await pixelEditor.flushAutosave(); });
    await page.waitForTimeout(300);
    const t = await E(async () => { const out = []; for (let i = 0; i < 5; i++) { const t0 = performance.now(); pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[i, i, 3]] }); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); out.push(performance.now() - t0); } return out.sort((a, b) => a - b)[2]; });
    assert(t < 100, 'OSH-19: 256² × 4 layers × 64 frames: median edit→paint ' + t.toFixed(0) + ' ms (< 100)'); await E(() => pixelEditor.flushAutosave()); }
  // OSH-20: getPixels() right after a synchronous undo-all
  { const r = await E(() => { pixelEditor.newDocument(8, 8); const me = pixelEditor.createSession('user'); const op = me.apply({ op: 'add_layer' }); pixelEditor.setLayer(op.id); me.apply({ op: 'set_pixels', pixels: [[1, 1, 2]] }); while (pixelEditor.canUndo()) pixelEditor.undo(); try { return pixelEditor.getPixels().length + ':' + pixelEditor.getState().layer; } catch (e) { return 'throws ' + e.message; } });
    assert(/^64:/.test(r), 'OSH-20: getPixels() works right after a synchronous undo-all (' + r + ')'); }
  // OSH-21: load error wording; export file names
  { const msgs = await E(() => [JSON.stringify({ format: 'osh-pixel', junk: 'x'.repeat(1000) }), JSON.stringify({ hello: 1 }), JSON.stringify({ format: 'aseprite' }), '[]'].map(t => { try { pixelEditor.load(t); return 'loaded'; } catch (e) { return e.message; } }));
    assert(/no document data/.test(msgs[0]) && /format missing/.test(msgs[1]) && /format "aseprite"/.test(msgs[2]) && /Not a One Shot Heroes sprite/.test(msgs[3]), 'OSH-21: load errors say what is wrong: ' + msgs.join(' | '));
    await fresh(); await page.fill('#docName', 'qa hero'); await settle();
    const n1 = await Promise.all([page.waitForEvent('download'), page.click('[data-act="exportPng"]')]).then(([d]) => d.suggestedFilename()); const t1 = await toastText();
    await E(() => pixelEditor.createSession('user').apply({ op: 'add_frame' })); await settle();
    const n2 = await Promise.all([page.waitForEvent('download'), page.click('[data-act="exportPng"]')]).then(([d]) => d.suggestedFilename()); const t2 = await toastText();
    assert(n1 === 'qa_hero.png' && /sprite/.test(t1) && /^qa_hero-f\d\.png$/.test(n2) && /frame \d of 2/.test(t2), `OSH-21 / U19: export names: 1 frame → ${n1}; 2 frames → ${n2} (toast "${t2}")`); }
  // U5: export scale
  { await page.selectOption('#expScale', '4');
    const dl = await Promise.all([page.waitForEvent('download'), page.click('[data-act="exportPng"]')]).then(([d]) => d);
    const buf = fs.readFileSync(await dl.path()); const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    const lab = await E(() => document.querySelector('#topbar').innerText);
    assert(w === 64 && h === 64 && /-4x\.png$/.test(dl.suggestedFilename()) && /Scale/.test(lab), `U5: Export PNG at 4× → ${w}×${h} ${dl.suggestedFilename()}`);
    const sh = await E(() => { const m = pixelEditor.renderSheet({ scale: 8 }).meta; return [m.frameSize.w, m.scale, m.frames[1].frame.x]; });
    assert(sh[0] === 128 && sh[1] === 8 && sh[2] === 128, 'U5: renderSheet({scale: 8}) scales frames and coordinates ' + JSON.stringify(sh));
    await page.selectOption('#expScale', '1'); }
  // U6: Aseprite-compatible JSON alongside the osh fields
  { const m = await E(() => { pixelEditor.loadExample(); return pixelEditor.renderSheet().meta; });
    const f = m.frames[0], tags = m.meta && m.meta.frameTags;
    assert(f.frame && f.duration > 0 && f.sourceSize && f.x === 0 && m.animations.walk && Array.isArray(tags) && tags.some(t => t.name === 'walk' && t.from >= 0 && t.to >= t.from && t.direction) && m.meta.size && m.meta.image, 'U6: sheet JSON has Aseprite frames[].frame/duration + meta.frameTags (' + tags.map(t => t.name + ' ' + t.from + '-' + t.to + ' ' + t.direction).join(', ') + '), and keeps the osh fields'); }
  // U1: keyboard pixel cursor (Sam)
  await fresh(); await settle(); await E(() => pixelEditor.setTool('pencil'));
  { await page.focus('#view'); const c0 = await nz();
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); const c1 = await nz();
    await page.keyboard.down(' '); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.up(' '); const c2 = await nz();
    await page.keyboard.press('Backspace'); const c3 = await nz();
    await page.waitForTimeout(80); const st = await E(() => document.querySelector('#srStatus').textContent);
    assert(c0 === 0 && c1 === 1 && c2 === 3 && c3 === 2, `U1: keyboard cursor draws: arrow + Enter paints one pixel (${c1}), Space held + arrows paints a line (${c2}), Backspace erases (${c3})`);
    assert(/x \d+, y \d+/.test(st), 'U16: cursor position is announced in a live region (' + st + ')');
    await page.keyboard.press('l'); await page.keyboard.press('Enter'); for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Enter'); const c4 = await nz();
    assert(c4 >= 6, 'U1: line tool by keyboard: Enter sets the start, Enter again draws (' + c4 + ' px)'); }
  { await page.focus('#view'); await page.mouse.move(5, 5); await E(() => pixelEditor.getState().frame);
    await E(() => pixelEditor.createSession('user').apply({ op: 'add_frame' })); await E(() => pixelEditor.setFrame(0)); await settle();
    const [mx, my] = await toScreen(4, 4); await page.mouse.click(mx, my); await page.keyboard.press('ArrowRight'); const f1 = await E(() => pixelEditor.getState().frame);
    assert(f1 === 1, 'U1: after a mouse click on the canvas, arrows keep changing frames (mouse users unaffected)'); }
  // U14: arrows nudge a selection (one op per nudge)
  await fresh(); await E(() => pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[2, 2, 8]] })); await settle();
  { await page.keyboard.press('m'); await drag([1, 1], [3, 3]); await settle(); const l0 = await E(() => pixelEditor.getLog().length);
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown'); await settle();
    const r = await E(() => [pixelEditor.getPixel(2, 2), pixelEditor.getPixel(3, 3), pixelEditor.getLog().length]);
    assert(r[0] === 0 && r[1] === 8 && r[2] === l0 + 2, `U14: arrows nudge the selection by 1 px, committed immediately (${JSON.stringify(r)})`);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await blurAll();
    await E(() => { pixelEditor.createSession('user').apply({ op: 'add_frame' }); pixelEditor.createSession('user').apply({ op: 'add_frame' }); pixelEditor.setFrame(1); }); await settle();
    await page.keyboard.press('End'); const fe = await E(() => pixelEditor.getState().frame); await page.keyboard.press('Home'); const fh = await E(() => pixelEditor.getState().frame);
    assert(fe === 2 && fh === 0, 'U14: Home / End jump to the first / last frame'); }
  // U7: drawing on a hidden layer is blocked with a message
  await fresh(); await settle();
  { await page.keyboard.press('b'); await E(() => document.querySelector('#layers .eye').click()); await settle();
    await drag([2, 2], [8, 2]); const r = await E(() => pixelEditor.getPixels().filter(v => v).length); const t = await toastText();
    await E(() => document.querySelector('#layers .eye').click()); await settle();
    assert(r === 0 && /hidden/i.test(t), 'U7: drawing on a hidden layer writes nothing and says why ("' + t + '")'); }
  // U9: eyedropper on an empty pixel says so
  { await page.keyboard.press('i'); const [ex, ey] = await toScreen(10, 10); await page.mouse.click(ex, ey); const t = await toastText(); const p = await E(() => pixelEditor.getState().primary);
    assert(p === 0 && /transparent/i.test(t), 'U9: eyedropper on an empty pixel picks transparent and says so ("' + t + '")'); await page.keyboard.press('b'); }
  // U3: palette Remove asks when the colour is in use; Cancel keeps it
  { await E(() => { pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[5, 5, 4]] }); document.querySelector('#palette .sw[data-idx="4"]').dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true })); }); await settle();
    const n0 = await E(() => pixelEditor.getMeta().palette.length); await page.click('#palDel'); await settle(); const ask = await isOpen() && /1 pixel/.test(await E(() => document.querySelector('#mbody').innerText));
    await page.click('#mCancel'); await settle(); const n1 = await E(() => pixelEditor.getMeta().palette.length + ':' + pixelEditor.getPixel(5, 5));
    await page.click('#palDel'); await settle(); await page.click('#mOk'); await settle(); const n2 = await E(() => pixelEditor.getMeta().palette.length);
    assert(ask && n1 === n0 + ':4' && n2 === n0 - 1, `U3: Remove on an in-use colour asks (pixel count shown); Cancel keeps it (${n1}), OK removes it (${n2})`); }
  // Canvas size dialog
  { const stray = await isOpen() ? await E(() => document.querySelector('#modal').innerText.slice(0, 160)) : '';
    assert(!stray, 'no dialog left open before the Canvas size test (' + stray + ')');
    await page.click('[data-act="resize"]'); await settle(); await page.fill('#rzW', '24'); await page.fill('#rzH', '8'); await page.selectOption('#rzA', 'topleft'); await page.click('#mOk'); await settle();
    const r = await E(() => pixelEditor.getMeta().width + 'x' + pixelEditor.getMeta().height + ':' + pixelEditor.getPixel(5, 5));
    if (await isOpen()) throw new Error('resize dialog still open: ' + r + ' err=' + await E(() => document.querySelector('#mErr').textContent + ' toast=' + ((document.querySelector('#toast') || {}).textContent) + ' w=' + document.querySelector('#rzW').value + ' h=' + document.querySelector('#rzH').value));
    await page.click('[data-act="resize"]'); await settle(); await page.fill('#rzW', '999'); await page.click('#mOk'); await settle(); const stays = await isOpen(); await page.keyboard.press('Escape');
    assert(r === '24x8:0' && stays, 'Canvas size dialog resizes with an anchor (' + r + '), and invalid sizes keep it open'); }
  // Sam end to end: keyboard only at 200% (640×400 CSS)
  { await page.setViewportSize({ width: 640, height: 400 }); await E(() => pixelEditor.newDocument(32, 32)); await settle(); await blurAll();
    await page.focus('[data-act="new"]'); await page.keyboard.press('Enter'); await settle(); await page.selectOption('#nSize', '16x16'); await page.focus('#mOk'); await page.keyboard.press('Enter'); await settle();
    await page.focus('#view'); await page.keyboard.press('ArrowRight'); await page.keyboard.press(' '); await page.keyboard.press('Enter');
    const drew = await nz(); await page.focus('#layAdd'); await page.keyboard.press('Enter'); await settle();
    await page.focus('[data-act="exportPng"]'); const name = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]).then(([d]) => d.suggestedFilename());
    const w = await E(() => pixelEditor.getMeta().width + ':' + pixelEditor.getMeta().layers.length);
    await page.setViewportSize({ width: 1280, height: 800 });
    assert(w === '16:2' && drew >= 1 && /\.png$/.test(name), `Sam (keyboard only, 640×400): New 16×16, draw (${drew} px), add layer, export ${name}`); }
  // Help: ? on a focused button opens help; Esc returns focus
  { await page.focus('[data-act="help"]'); await page.keyboard.press('?'); await settle(); const o = await isOpen(); await page.keyboard.press('Escape'); const f = await E(() => document.activeElement.dataset.act);
    assert(o && f === 'help', 'Help opens with ? and Esc returns focus to the opener'); }
  // Fill re-tag behaviour unchanged (policy): a same-colour user fill re-tags AI pixels as human
  { const r = await E(() => { pixelEditor.newDocument(4, 4); pixelEditor.createSession('ai').apply({ op: 'set_pixels', pixels: [[0, 0, 3]] }); pixelEditor.createSession('user').apply({ op: 'fill', x: 0, y: 0, color: 3 }); return pixelEditor.getPixelTag(0, 0) + ':' + pixelEditor.provenance().aiPixelCount; });
    assert(r === '0:0', 'policy unchanged: a same-colour user fill still re-tags the AI pixel as human (' + r + ')'); }
  await E(() => pixelEditor.newDocument(32, 32));

  section('QA round 2 (Mystique): OSH-22..30 + UX');
  // OSH-22 / R7-NT1: no statement may hide behind a same-line // comment (acorn-based scan of every src file, test/hidden-scan.js)
  { const { hiddenCode, scanSource } = require('./hidden-scan'); const hidden = [];
    for (const f of SRC_FILES) for (const h of scanSource(fs.readFileSync(path.join(WS_ROOT, f), 'utf8'))) hidden.push(f + ':' + h.line + ' ' + h.code.slice(0, 60));
    assert(hidden.length === 0, 'OSH-22 / R7-NT1: no code hidden after a same-line // comment in src/*.js (acorn scan)' + (hidden.length ? ': ' + hidden.join(' | ') : ''));
    const shapes = { original: " name nm.textContent = a.name; nm.title = 'x'; nm.dataset.fk = 'an:' + ai;", plainCall: ' keep the row in sync render(); refresh();', plainAssign: ' cache it total = 0; count = 1;',
      ifStmt: ' guard if (x) return;', singleMember: ' also nm.textContent = a.name', callNoSemi: ' then syncCtx(); renderLayers()', doOp: " and doOp({ op: 'x' });", awaitCall: ' later await save();', forLoop: ' for (const l of ls) draw(l);' };
    const prose = [' autosave (N3)', ' frames (inclusive)', ' e.g. 8 frames per row, or more (up to 8192 / frame width)', ' natively (OSH-02/03)', " OSH-16: an animation may be called \"__proto__\"", ' live index i == record index i + off', ' see stepDown()', ' return early when paused'];
    const missed = Object.entries(shapes).filter(([, t]) => !hiddenCode(t)).map(([k]) => k), flagged = prose.filter(t => hiddenCode(t));
    assert(missed.length === 0 && flagged.length === 0, `R7-NT1: the scanner catches all ${Object.keys(shapes).length} hidden-statement shapes (Ultron's 7 + await + for) and flags none of ${prose.length} prose comments` + (missed.length ? '; missed ' + missed : '') + (flagged.length ? '; false hits ' + flagged : ''));
    { // R7b-NT: Ultron's two scanner edge cases (plus neighbours), as their own assertion
      const more = { deleteStmt: ' delete o.x;', deleteMid: ' then delete cache[k]; done = true;', ternaryStmt: ' x ? a() : b();', newCall: ' new Foo();', optCall: ' a?.b();', bracketAssign: " o['k'] = 1", throwStmt: ' throw new Error("x");', codeAfterUrl: ' docs at http://a.test/c?d=1; then x.y = 2;' };
      const urls = [' see https://example.com/a?b=c;', ' ref: https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API;', ' (see file:///tmp/a?x=1;y=2;)', ' mirror at http://x.test/p?q=1&r=s;'];
      const m2 = Object.entries(more).filter(([, t]) => !hiddenCode(t)).map(([k]) => k), f2 = urls.filter(t => hiddenCode(t));
      assert(m2.length === 0 && f2.length === 0, `R7b-NT: the scanner now catches \`delete o.x;\` (and ${Object.keys(more).length - 1} more statement shapes, incl. code after a URL) and flags none of ${urls.length} comments ending in a URL with ';'` + (m2.length ? '; missed ' + m2 : '') + (f2.length ? '; false hits ' + f2 : '')); }
    { // R8-NT1: tails glued to punctuation (Ultron round 8: the R7b start rule missed these); prose and URL comments stay unflagged
      const glued = { colon: ' R7-MN1:Autosave.paused = true;', paren: ' (OSH-22)nm.textContent = a.name;', comma: ' keep,render();', commaNoSpace: '//keep,render();'.slice(2), dash: ' fix\u2014nm.title = t;', oshColon: ' OSH-22:render(); ', oshColonNoSpace: 'OSH-22:render();', urlTouching: ' see https://x.test/a;render(); refresh();' };
      const prose8 = [' N3: autosave (N3) on every change', ' e.g. 8\u219211\u00d79 gives (+1,0)', " don't do this; it breaks (OSH-22)", ' R7-MN1: never leave flushAutosave() pending', ' TODO: maybe(later)', ' x = width / 2 roughly', ' ratio is a ? b : c roughly', ' file:///tmp/x.osh.json;', ' see https://example.com/a?b=c;'];
      const m3 = Object.entries(glued).filter(([, t]) => !hiddenCode(t)).map(([k]) => k), f3 = prose8.filter(t => hiddenCode(t));
      assert(m3.length === 0 && f3.length === 0, `R8-NT1: the scanner catches ${Object.keys(glued).length} statement tails glued to punctuation (\`//keep,render();\`, \`//OSH-22:render();\`, …) and flags none of ${prose8.length} prose / URL comments` + (m3.length ? '; missed ' + m3 : '') + (f3.length ? '; false hits ' + f3 : '')); }
    { // R9-NT1: a commented-out ES-module import/export (parsed as a module when the script parse fails); prose about imports isn't flagged
      const mods = { importDefault: ' import x from "y";', importSide: " import './ui/stroke.js';", importNamed: " old: import { a } from './b.js';", exportDefault: ' export default draw;' };
      const prose9 = [' import order matters here', ' side-effect imports run first', ' export as PNG (1x / 2x)', ' imported from the old build'];
      const m4 = Object.entries(mods).filter(([, t]) => !hiddenCode(t)).map(([k]) => k), f4 = prose9.filter(t => hiddenCode(t));
      assert(m4.length === 0 && f4.length === 0, `R9-NT1: the scanner catches ${Object.keys(mods).length} commented-out import / export shapes (\`// import x from "y";\`) and flags none of ${prose9.length} prose comments about imports` + (m4.length ? '; missed ' + m4 : '') + (f4.length ? '; false hits ' + f4 : '')); }
    const srcAll = SRC_FILES.map(f => fs.readFileSync(path.join(WS_ROOT, f), 'utf8')).join('\n');
    assert(!/superseded\s*\(/.test(srcAll), 'R7-NT2: the unused EditorLock.superseded() is gone (no definition or call left in src)');
  }
  // OSH-22: animation names are visible, have a tooltip, and Enter / F2 keep focus on the name
  { await E(() => pixelEditor.loadExample()); await page.waitForTimeout(150);
    const names = await E(() => [...document.querySelectorAll('#tlgrid .an')].map(n => n.textContent + '|' + !!n.title + '|' + n.dataset.fk));
    assert(names.length >= 2 && names.every(n => /^[^|]+\|true\|an:\d+$/.test(n)), 'OSH-22: every animation row shows its name with a tooltip and a focus key (' + names.join(', ') + ')');
    await page.focus('#tlgrid .an'); await page.keyboard.press('Enter'); await settle();
    const f1 = await E(() => document.activeElement.className + ':' + document.activeElement.textContent);
    await page.keyboard.press('F2'); await settle(); await page.fill('#askIn', 'stand'); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
    const f2 = await E(() => document.activeElement.tagName + ':' + document.activeElement.textContent + ':' + pixelEditor.getMeta().animations.map(a => a.name).join(','));
    assert(/^an sel:/.test(f1) && /^SPAN:stand:/.test(f2) && /stand/.test(f2), `OSH-22: Enter on a name previews it and keeps focus (${f1}); F2 → rename "stand" → focus returns to the renamed name (${f2})`); }
  // OSH-23: the keyboard cursor keeps its place when the canvas loses and regains focus
  { await fresh(16, 16); await settle(); await E(() => pixelEditor.setTool('pencil')); await blurAll();
    const at = async () => { await page.waitForTimeout(80); return (await E(() => document.querySelector('#srStatus').textContent)).match(/x (\d+), y (\d+)/).slice(1).join(','); };
    await page.focus('#view'); const a0 = await at();
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight'); for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown'); const a1 = await at();
    await page.focus('#palette [tabindex="0"]'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); await settle(); // pick a colour
    await page.focus('#view'); const a2 = await at();
    await page.keyboard.press('Enter'); const p = await px(12, 11);
    await blurAll(); await fresh(10, 10); await page.focus('#view'); const a3 = await at();
    assert(a0 === '8,8' && a1 === '12,11' && a2 === '12,11' && p > 1 && a3 === '5,5', `OSH-23: cursor centred the first time (${a0}), moved to (${a1}), still there after a palette pick (${a2}) and paints there with the new colour (${p}); New centres it again (${a3})`); }
  // UX-N1: a Space-held keyboard stroke is one undo step
  { await fresh(16, 16); await settle(); await blurAll(); await page.focus('#view'); const n0 = await E(() => pixelEditor.getLog().length);
    await page.keyboard.down(' '); for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight'); await page.keyboard.up(' ');
    const r = await E(() => pixelEditor.getLog().length) - n0, c = await nz();
    await page.keyboard.press('Control+z'); const c2 = await nz();
    await page.keyboard.press('Control+y'); const c3 = await nz();
    assert(r === 1 && c === 5 && c2 === 0 && c3 === 5, `UX-N1: a Space-held run of 5 px is 1 op (${r}); one Ctrl+Z removes it all (${c}→${c2}), Ctrl+Y brings it back (${c3})`); }
  // OSH-24: non-shortcut letters and arrows in the focused Preset select never swap the palette
  { await fresh(); await settle(); const pal0 = await E(() => JSON.stringify(pixelEditor.getMeta().palette)); const n0 = await E(() => pixelEditor.getLog().length);
    await page.focus('#palPreset'); for (const k of ['s', 'a', 'z', 'ArrowDown', 'ArrowUp', 'End', 'PageDown', '1']) await page.keyboard.press(k); await settle();
    const pal1 = await E(() => JSON.stringify(pixelEditor.getMeta().palette)), n1 = await E(() => pixelEditor.getLog().length), v = await E(() => document.querySelector('#palPreset').value);
    await page.keyboard.press('e'); const tool = await E(() => pixelEditor.getState().tool);
    await page.selectOption('#palPreset', 'PICO-8'); await settle(); const pal2 = await E(() => JSON.stringify(pixelEditor.getMeta().palette));
    assert(pal1 === pal0 && n1 === n0 && v === '' && tool === 'eraser' && pal2 !== pal0, `OSH-24: S, A, Z, 1, arrows, End, PageDown in the Preset select leave the palette alone (${n1 - n0} ops); E still picks the eraser; choosing from the list still applies a preset`);
    await page.keyboard.press('Control+z'); await blurAll(); }
  // OSH-25 + OSH-28: sheet file names carry the scale, the JSON names the same image, and a capped scale is explained
  { const sheet = async () => { const got = []; const h = d => got.push(d); page.on('download', h); await page.click('[data-act=exportSheet]'); for (let i = 0; i < 40 && got.length < 2; i++) await page.waitForTimeout(50); page.off('download', h);
      const json = JSON.parse(fs.readFileSync(await got[1].path(), 'utf8')); return { png: got[0].suggestedFilename(), json: got[1].suggestedFilename(), image: json.image, aimage: json.meta.image, scale: json.meta.scale, toast: await E(() => document.querySelector('#toast').textContent) }; };
    await E(() => { pixelEditor.newDocument(8, 8); }); await page.fill('#docName', 'hero'); await page.selectOption('#expScale', '4'); const s4 = await sheet();
    await page.selectOption('#expScale', '1'); const s1 = await sheet();
    assert(s4.png === 'hero-4x.png' && s4.json === 'hero-4x.json' && s4.image === s4.png && s4.aimage === s4.png && s1.png === 'hero.png' && s1.json === 'hero.json' && s1.aimage === 'hero.png', `OSH-25: sheet names carry the scale (${s4.png} + ${s4.json}; 1×: ${s1.png} + ${s1.json}) and meta.image matches the PNG (${s4.aimage})`);
    await E(() => { pixelEditor.newDocument(256, 16); const me = pixelEditor.createSession('user'); for (let i = 1; i < 8; i++) me.apply({ op: 'add_frame' }); }); await page.fill('#docName', 'hero');
    await page.selectOption('#expScale', '8'); const sc = await sheet(); await page.selectOption('#expScale', '1');
    assert(sc.png === 'hero-4x.png' && sc.scale === '4' && /8× would be 16384×128 px, over the 8192 px limit, so it was exported at 4×/.test(sc.toast), `OSH-28: an 8× sheet that would exceed 8192 px says so: "${sc.toast}" (${sc.png})`);
    await page.fill('#docName', 'untitled'); }
  // OSH-26: centre-anchor resize round trips are exact
  { const r = await E(() => { const me = pixelEditor.createSession('user'), out = [];
      for (const [w0, w1] of [[8, 11], [8, 5], [9, 4], [7, 10], [16, 2], [11, 8]]) { pixelEditor.newDocument(w0, w0); const c = w0 >> 1; me.apply({ op: 'set_pixels', pixels: [[c, c, 2], [c - 1 < 0 ? c : c - 1, c, 3]] });
        const before = JSON.stringify(pixelEditor.getPixels()); me.apply({ op: 'resize', width: w1, height: w1, anchor: 'center' }); const mid = pixelEditor.getPixel(w1 >> 1, w1 >> 1); me.apply({ op: 'resize', width: w0, height: w0, anchor: 'center' });
        out.push(w0 + '→' + w1 + '→' + w0 + ':' + (JSON.stringify(pixelEditor.getPixels()) === before ? 'same' : 'moved') + ':' + mid); }
      pixelEditor.newDocument(8, 8); me.apply({ op: 'set_pixels', pixels: [[0, 0, 1], [7, 7, 2]] }); me.apply({ op: 'resize', width: 11, height: 9, anchor: 'center' }); const g = [pixelEditor.getPixel(1, 0), pixelEditor.getPixel(8, 7)];
      return { out, g }; });
    assert(r.out.every(x => /:same:2$/.test(x)) && r.g.join() === '1,2', 'OSH-26: centre resize keeps the centre pixel in the centre and every round trip returns the art to its place (' + r.out.join(' ') + '); 8→11×9 still offsets (+1,0)'); }
  // OSH-27: Backspace / Delete / arrows on a focused toolbar button leave the selection alone
  { await fresh(16, 16); await E(() => { pixelEditor.createSession('user').apply({ op: 'fill', x: 0, y: 0, color: 3 }); }); await settle();
    await page.focus('#view'); await page.keyboard.press('Control+a'); const c0 = await nz(), n0 = await E(() => pixelEditor.getLog().length);
    for (const b of ['#layAdd', '[data-act=undo]', '#zoomFit', '#frAdd']) { await page.focus(b); for (const k of ['Backspace', 'Delete', 'ArrowRight', 'ArrowDown']) await page.keyboard.press(k); }
    const c1 = await nz(), n1 = await E(() => pixelEditor.getLog().length);
    await page.focus('#view'); await page.keyboard.press('Delete'); const c2 = await nz();
    assert(c0 === 256 && c1 === 256 && n1 === n0 && c2 === 0, `OSH-27: Backspace/Delete/arrows on focused buttons don't erase or nudge the selection (${c0}→${c1}, ${n1 - n0} ops); Delete on the canvas still clears it (${c2})`);
    await page.keyboard.press('Escape'); }
  // OSH-30: the keyboard cursor ring is black + white, visible on #ffcd75 (or any) pixels
  { await E(() => { pixelEditor.newDocument(16, 16); const i = pixelEditor.getMeta().palette.findIndex(c => c && /ffcd75/i.test(c)); pixelEditor.createSession('user').apply({ op: 'fill', x: 0, y: 0, color: i }); }); await settle(); const skin = await E(() => pixelEditor.getMeta().palette[pixelEditor.getPixel(0, 0)]); await blurAll(); await page.focus('#view'); await page.waitForTimeout(100);
    const ring = await E(() => { const v = document.querySelector('#view'), s = pixelEditor.getState(), dpr = window.devicePixelRatio || 1, z = s.zoom;
      const cx = Math.round((s.panX + 8 * z) * dpr), cy = Math.round((s.panY + 8.5 * z) * dpr), d = v.getContext('2d').getImageData(cx - 8 * dpr, cy, 8 * dpr, 1).data, seen = new Set();
      for (let i = 0; i < d.length; i += 4) seen.add(d[i] < 30 && d[i + 1] < 30 && d[i + 2] < 30 ? 'black' : d[i] > 225 && d[i + 1] > 225 && d[i + 2] > 225 ? 'white' : d[i] === 255 && d[i + 1] === 205 && d[i + 2] === 117 ? 'skin' : 'other');
      return [...seen].sort().join(','); });
    assert(/^#?ffcd75$/i.test(skin) && /black/.test(ring) && /white/.test(ring), 'OSH-30: the keyboard cursor ring on a ' + skin + ' (Sweetie 16 skin) canvas has both a black and a white band (' + ring + ')'); }
  // UX-N2: skip links are the first Tab stops and land on the canvas / palette (fresh page at 640×400 = 200%)
  { const cS = await browser.newContext({ viewport: { width: 640, height: 400 } }); const q = await cS.newPage(); const qe = []; q.on('pageerror', e => qe.push(e.message));
    const load = async () => { await q.goto(FILE); await q.waitForFunction(() => window.pixelEditor); await q.evaluate(() => pixelEditor.ready); };
    await load(); await q.keyboard.press('Tab'); const t1 = await q.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); return document.activeElement.id + ':' + (r.left >= 0 && r.top >= 0 && r.width > 0); });
    await q.keyboard.press('Enter'); await q.waitForTimeout(100); const t2 = await q.evaluate(() => document.activeElement.id + ':' + /x \d+, y \d+/.test(document.querySelector('#srStatus').textContent));
    await q.keyboard.press('ArrowRight'); await q.keyboard.press('Enter'); const drew = await q.evaluate(() => pixelEditor.getPixels().filter(v => v > 0).length);
    await load(); await q.keyboard.press('Tab'); await q.keyboard.press('Tab'); await q.keyboard.press('Enter'); const t3 = await q.evaluate(() => document.activeElement.parentElement.id);
    await cS.close();
    assert(t1 === 'skipCanvas:true' && t2 === 'view:true' && drew === 1 && t3 === 'palette' && qe.length === 0, `UX-N2: first Tab = visible "Skip to canvas" (${t1}); Enter focuses the canvas with the keyboard cursor on (${t2}) and it draws (${drew}); "Skip to palette" lands on a swatch (${t3})`); }
  // OSH-29: named tools nav, heading order h1 → h2, file inputs inside a landmark
  { const r = await E(() => ({ nav: document.querySelector('#tools').getAttribute('aria-label'), hs: [...document.querySelectorAll('#app h1, #app h2, #app h3, #app h4')].map(h => h.tagName).join(','), inMain: ['#fileInput', '#palFileInput'].every(s => !!document.querySelector(s).closest('main')) }));
    assert(r.nav === 'Tools' && r.hs === 'H1,H2,H2,H2' && r.inMain, `OSH-29: tools nav is named "${r.nav}", headings ${r.hs}, file inputs inside <main>`); }
  // the file inputs still work after the move
  { const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]); assert(!!fc, 'OSH-29: Ctrl+O still opens the file chooser with the moved #fileInput'); await page.keyboard.press('Escape'); }
  await E(() => pixelEditor.newDocument(32, 32));

  section('QA round 3 (Mystique): OSH-31..36 + Keep-first prompt');
  // beforeunload probe: try to close the tab; a warning is dismissed (the tab stays open). Chrome only shows the warning after
  // a user gesture in the page, so callers click once first (activate) unless the page already had trusted input.
  const unloadWarns = async (P, activate = true) => { let warned = false; const h = d => { if (d.type() === 'beforeunload') warned = true; d.dismiss().catch(() => {}); };
    P.on('dialog', h); if (activate) await P.click('h1.brand', { force: true }); await P.close({ runBeforeUnload: true }); await new Promise(r => setTimeout(r, 500)); P.off('dialog', h); return warned && !P.isClosed(); };
  // OSH-32: undo / redo of a size change while the canvas has focus keeps the keyboard cursor on the canvas
  { await fresh(24, 24); await E(() => { pixelEditor.setTool('pencil'); pixelEditor.createSession('user').apply({ op: 'resize', width: 8, height: 8, anchor: 'center' }); }); await settle(); await blurAll();
    const at = async () => { await page.waitForTimeout(80); return (await E(() => document.querySelector('#srStatus').textContent)).match(/x (\d+), y (\d+)/).slice(1).join(','); };
    await page.focus('#view'); await page.keyboard.press('Control+z'); await settle(); const w1 = await E(() => pixelEditor.getMeta().width);
    for (const k of ['Shift+ArrowRight', 'Shift+ArrowRight', 'Shift+ArrowDown', 'Shift+ArrowDown']) await page.keyboard.press(k); const p1 = await at();
    await page.keyboard.press('Control+y'); await settle(); const w2 = await E(() => pixelEditor.getMeta().width), p2 = await at();
    await page.keyboard.press('Enter'); const painted = await px(7, 7);
    await blurAll(); await E(() => pixelEditor.createSession('user').apply({ op: 'resize', width: 12, height: 12, anchor: 'center' })); await page.focus('#view'); const p3 = await at();
    assert(w1 === 24 && p1.split(',').every(v => +v > 7) && w2 === 8 && p2 === '7,7' && painted > 0 && p3 === '6,6', `OSH-32: after Ctrl+Y shrinks the canvas back to 8×8 under the cursor at (${p1}), the cursor is clamped to (${p2}), announced, and Enter paints there (${painted}); a resize while the canvas isn\u2019t focused still re-centres it (OSH-23: ${p3})`); }
  // OSH-35: Space + Shift+Arrow paints the whole 8 px run, still one undo step
  { await fresh(32, 16); await E(() => pixelEditor.setTool('pencil')); await settle(); await blurAll(); await page.focus('#view'); const n0 = await E(() => pixelEditor.getLog().length);
    await page.keyboard.down(' '); await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('Shift+ArrowDown'); await page.keyboard.up(' ');
    const row = await E(() => { const r = []; for (let x = 0; x < 32; x++) r.push(pixelEditor.getPixel(x, 8) ? 1 : 0); return r.join(''); }), col = await E(() => { let n = 0; for (let y = 8; y < 16; y++) n += pixelEditor.getPixel(24, y) ? 1 : 0; return n; });
    const ops = await E(() => pixelEditor.getLog().length) - n0; await page.keyboard.press('Control+z'); const left = await nz();
    assert(row === '0'.repeat(16) + '1'.repeat(9) + '0'.repeat(7) && col === 8 && ops === 1 && left === 0, `OSH-35: Space + Shift+Arrow paints every pixel of the jump (row 8: ${row}; down run ${col}/8), as one undo step (${ops} op, ${left} px left after Ctrl+Z)`); }
  // OSH-34: double-click rename, then Escape (and Enter), returns focus to the animation name
  { await E(() => { pixelEditor.newDocument(16, 16); const me = pixelEditor.createSession('user'); me.apply({ op: 'add_frame' }); const ids = pixelEditor.getMeta().frames.map(f => f.id); me.apply({ op: 'add_animation', name: 'idle', frames: ids, mode: 'loop' }); me.apply({ op: 'add_animation', name: 'walk', frames: ids, mode: 'loop' }); });
    await settle(); await blurAll(); const act = () => E(() => { const a = document.activeElement; return a === document.body ? 'BODY' : a.className + ':' + a.textContent.slice(0, 12); });
    await page.dblclick('#tlgrid .anim .an >> nth=1'); await page.waitForTimeout(80); const inDlg = await E(() => document.activeElement.id); await page.keyboard.press('Escape'); await settle(); const a1 = await act();
    await page.dblclick('#tlgrid .anim .an >> nth=0'); await page.waitForTimeout(80); await page.keyboard.press('Control+a'); await page.keyboard.type('stand'); await page.keyboard.press('Enter'); await settle(); const a2 = await act();
    assert(inDlg === 'askIn' && /\ban\b.*walk/.test(a1) && /\ban\b.*stand/.test(a2), `OSH-34: after a double-click rename, Escape returns focus to the name (${a1}) and so does Enter after renaming (${a2})`); }
  // OSH-31 / OSH-33 / OSH-36 / UX: a paused tab with its own edits, the hand-over prompt, then Keep
  { const c = await browser.newContext({ viewport: { width: 1024, height: 576 } }); const er = []; const op = async () => { const P = await c.newPage(); P.on('pageerror', e => er.push(e.message)); await P.goto(FILE); await P.waitForFunction(() => window.pixelEditor); await P.evaluate(() => pixelEditor.ready); return P; };
    const A = await op(); await A.evaluate(async () => { pixelEditor.newDocument(16, 16); await pixelEditor.flushAutosave(); });
    const B = await op(); await B.waitForFunction(() => pixelEditor.isAutosavePaused());
    await B.click('h1.brand', { force: true }); await B.evaluate(() => pixelEditor.setTool('pencil')); await B.focus('#view'); await B.keyboard.press('Enter'); // a paused tab's own edit
    const warnPaused = await unloadWarns(B, false);
    await A.focus('#view'); await A.keyboard.press('ArrowLeft'); await A.keyboard.press('Enter'); await A.waitForTimeout(100); // owner's edit: journaled at once
    const warnOwner = await unloadWarns(A, false); // no warning, so A really closes and B takes over
    await B.waitForSelector('#takeoverKeep', { timeout: 8000 }); await B.waitForTimeout(100);
    const pr = await B.evaluate(() => { const n = document.querySelector('#tabNotice'), m = n.querySelector('.msg'), r = m.getBoundingClientRect(), btns = [...n.querySelectorAll('button')].map(b => b.id);
      return { focus: document.activeElement.id, order: btns.join(','), role: n.getAttribute('role'), msgW: Math.round(r.width), msgH: Math.round(r.height), lineH: parseFloat(getComputedStyle(m).lineHeight), status: document.querySelector('#saveStatus').textContent, text: m.textContent }; });
    const warnPrompt = await unloadWarns(B, false);
    await B.keyboard.press('Enter'); await B.waitForTimeout(150); const after = await B.evaluate(async () => { const f = document.activeElement.id; const r = await pixelEditor.flushAutosave(); return { f, ok: r.ok, paused: pixelEditor.isAutosavePaused(), status: document.querySelector('#saveStatus').textContent }; });
    const warnAfterKeep = await unloadWarns(B, false); const bPx = await (await op()).evaluate(() => pixelEditor.getPixels().filter(v => v).length); await c.close();
    assert(warnPaused && !warnOwner && warnPrompt && !warnAfterKeep, `OSH-31: closing warns only when edits are saved nowhere: a paused tab with its own edit ${warnPaused ? 'warns' : 'does NOT warn'}, the editing tab whose edit is journaled ${warnOwner ? 'WARNS' : 'doesn\u2019t'}, a pending keep/load prompt ${warnPrompt ? 'warns' : 'does NOT warn'}, after Keep + autosave ${warnAfterKeep ? 'STILL WARNS' : 'no warning'}`);
    assert(pr.focus === 'takeoverKeep' && pr.role === 'alertdialog' && after.f === 'view', `OSH-33: the keep/load prompt takes focus (${pr.focus}, role ${pr.role}) and answering it returns focus to where the user was (${after.f})`);
    assert(pr.order === 'takeoverKeep,takeoverLoad' && !after.paused && after.ok && bPx === 1, `UX: Keep is the first button and the default (Enter keeps this tab\u2019s edit: autosaved ${after.ok}, a fresh tab shows ${bPx} px)`);
    assert(pr.msgW >= 400 && pr.msgH <= pr.lineH * 3 + 1 && !/Another tab is editing/.test(pr.status) && /choose Keep or Load/.test(pr.status) && !/Another tab is editing/.test(after.status), `OSH-36: at 1024×576 the prompt text is one readable block (${pr.msgW}×${pr.msgH} px, not a word-per-line column) and the status no longer says another tab is editing ("${pr.status}" → "${after.status}")`);
    assert(er.length === 0, 'QA3: no page errors in the tab tests' + (er.length ? ': ' + er.join(' | ') : '')); }
  // OSH-31 / OSH-36: autosave failing with no journal either: warn on close; readable failure text (no raw error, no "..")
  { const c = await browser.newContext(); const P = await c.newPage();
    await P.addInitScript(() => { window.Worker = undefined; Object.defineProperty(window, 'indexedDB', { get() { return undefined; } }); Storage.prototype.setItem = function () { throw new DOMException('The user denied permission to access the database.', 'SecurityError'); }; });
    await P.goto(FILE); await P.waitForFunction(() => window.pixelEditor); await P.evaluate(() => pixelEditor.ready);
    const st = await P.evaluate(async () => { pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[0, 0, 1]] }); await pixelEditor.flushAutosave(); await new Promise(r => setTimeout(r, 50)); const b = document.querySelector('#saveStatus'); return { text: b.textContent, title: b.title, toast: (document.querySelector('#toast') || {}).textContent || '' }; });
    const warn = await unloadWarns(P); await c.close();
    assert(warn, 'OSH-31: with autosave failing and nothing journaled, closing the tab warns before discarding the edits');
    assert(/^Autosave failed: [a-z].*[^.]\. Use Save \(Ctrl\+S\) to keep your work\.$/.test(st.text) && !/\.\./.test(st.text + st.toast) && !/DOMException|Error:/.test(st.text), `OSH-36: autosave failure reads "${st.text}" (raw detail in the tooltip: "${st.title.slice(0, 80)}")`); }
  await page.bringToFront(); await fresh(32, 32);

  section('Ultron round 7: fallback write-hold (MJ1, MJ2, MN1-MN3) + sheet rule (MN4)');
  { // every page here: no Web Locks, every storage write / autosave post recorded, optional timer throttling (window.__thr ms wake-ups)
    const rec = () => { window.__w = []; const si = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { window.__w.push([Date.now(), k]); return si.call(this, k, v); };
      const pm = Worker.prototype.postMessage; Worker.prototype.postMessage = function (m) { if (m && m.payload) window.__w.push([Date.now(), 'autosave']); return pm.apply(this, arguments); };
      const st = window.setTimeout, ct = window.clearTimeout, ci = window.clearInterval, iv = new Map(); let nid = 1e7; window.__thr = 0;
      const delay = d => { const T = window.__thr; if (!T) return d; const now = Date.now(); return Math.ceil((now + (d || 0)) / T) * T - now; };
      window.setTimeout = (f, d, ...a) => st(f, delay(d), ...a);
      window.setInterval = (f, d, ...a) => { const id = ++nid; const tick = () => { if (!iv.has(id)) return; iv.set(id, st(tick, delay(d))); f(...a); }; iv.set(id, st(tick, delay(d))); return id; };
      window.clearInterval = id => { if (iv.has(id)) { ct(iv.get(id)); iv.delete(id); } else ci(id); }; };
    const err7 = [];
    const open7 = async (c) => { const p = await c.newPage(); p.on('pageerror', e => err7.push(e.message)); await p.addInitScript(noLocks); await p.addInitScript(rec); await p.goto(FILE); await p.waitForFunction(() => window.pixelEditor); await p.evaluate(() => pixelEditor.ready); return p; };
    const editing = p => p.evaluate(() => !pixelEditor.isAutosavePaused());
    const fresh7 = async (c, pts) => { const C = await open7(c); const r = await C.evaluate(pts => pts.map(([x, y]) => pixelEditor.getPixel(x, y)), pts); await C.close(); return r; };

    let byeText = ''; // R7b-MN2: the prompt's wording when the other tab closed with a 'bye'
    // MJ1 + MN1 (+ MN3 echo, no "both editing"): an edit and flushAutosave() in the same task as an 8 s stall; B takes over meanwhile
    { const res = [];
      for (let t = 0; t < 2; t++) { const c = await browser.newContext(); const A = await open7(c);
        await A.evaluate(async () => { pixelEditor.newDocument(10, 10); await pixelEditor.flushAutosave(); }); const B = await open7(c); await A.waitForTimeout(1500);
        await A.evaluate(() => { setTimeout(() => { const t = performance.now(); while (performance.now() - t < 8000); window.__resumed = Date.now(); pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[2, 2, 6]] }); window.__fl = 'pending'; pixelEditor.flushAutosave().then(r => { window.__fl = JSON.stringify(r); }); }, 0); });
        await B.waitForFunction(() => !pixelEditor.isAutosavePaused(), null, { timeout: 12000 }); const tB = await B.evaluate(() => Date.now());
        await A.evaluate(() => 0); const samples = []; for (let i = 0; i < 12; i++) { samples.push(String(await editing(A))[0] + String(await editing(B))[0]); await A.waitForTimeout(100); }
        const a = await A.evaluate(tB => ({ fl: window.__fl, px: pixelEditor.getPixel(2, 2), notice: (document.querySelector('#tabNotice') || {}).textContent || '', writes: window.__w.filter(w => w[0] >= Math.max(tB, window.__resumed) && /owner|journal|autosave/.test(w[1])).map(w => w[1]) }), tB);
        await B.close({ runBeforeUnload: true });
        const keep = await A.waitForSelector('#takeoverKeep', { timeout: 8000 }).then(() => true).catch(() => false); const pxShown = await A.evaluate(() => pixelEditor.getPixel(2, 2));
        if (keep && !byeText) byeText = await A.evaluate(() => document.querySelector('#tabNotice').textContent);
        if (keep) { await A.bringToFront(); await A.click('#takeoverKeep'); await A.evaluate(() => pixelEditor.flushAutosave()); } // R9-MN2: A was opened before B
        await A.close(); const fin = await fresh7(c, [[2, 2]]); await c.close();
        res.push({ tt: samples.includes('tt'), last: samples[samples.length - 1], fl: a.fl, px: a.px, unsavedNote: /not saved anywhere/.test(a.notice), aWrites: a.writes.length, keep, pxShown, fin: fin[0] }); }
      const ok = r => !r.tt && r.last === 'ft' && /"ok":false/.test(r.fl) && r.px === 6 && r.unsavedNote && r.aWrites === 0 && r.keep && r.pxShown === 6 && r.fin === 6;
      assert(res.every(ok), 'R7-MN1/MN3: after an 8 s stall with an edit + flushAutosave() in the same task, A steps down with no "both editing" sample and no heartbeat / journal / autosave write after B took over; the pending flush resolves {ok:false} (' + res.map(r => `tt:${r.tt} ${r.last} flush ${r.fl} writes ${r.aWrites}`).join(' ; ') + ')');
      assert(res.every(ok), 'R7-MJ1: the held edit stays on screen, the notice says it is not saved anywhere, and when B closes A asks (keep / load) instead of silently loading over it; "keep" saves it, 2/2 (' + res.map(r => `px ${r.px}, keep button ${r.keep}, after keep ${r.fin}`).join(' ; ') + ')');
    }

    // MJ2: a live editor whose timers are throttled (8 s wake-ups) keeps the role while a visible paused tab probes; its background edit is kept
    { const c = await browser.newContext(); const A = await open7(c); await A.evaluate(async () => { pixelEditor.newDocument(10, 10); await pixelEditor.flushAutosave(); }); const B = await open7(c); await A.waitForTimeout(1500);
      await A.evaluate(() => { window.__thr = 8000; }); const seen = new Set(); const t0 = Date.now(); let edited = false;
      while (Date.now() - t0 < 18000) { seen.add(String(await editing(A))[0] + String(await editing(B))[0]); if (!edited && Date.now() - t0 > 5000) { await A.evaluate(() => pixelEditor.createSession('ai').apply({ op: 'set_pixels', pixels: [[6, 6, 3]] })); edited = true; } await A.waitForTimeout(500); }
      const beats = await A.evaluate(t0 => window.__w.filter(w => w[0] > t0 && /owner/.test(w[1])).length, t0);
      await A.evaluate(() => { window.__thr = 0; }); await B.close(); await A.close({ runBeforeUnload: true }); const fin = await fresh7(c, [[6, 6]]); await c.close();
      assert([...seen].join() === 'tf' && fin[0] === 3, `R7-MJ2: a throttled hidden editor answers "here" during its post-gap hold, so the visible paused tab never takes over (owners seen: ${[...seen].join(' ')}; ${beats} heartbeats in 18 s) and its background edit is kept (${fin[0]})`);
    }

    // MN2: a lone tab after a 7 s stall: edit, then crash / reload / close 50 ms later; the edit survives
    { const res = {};
      for (const how of ['crash', 'reload', 'close']) { const c = await browser.newContext(); const A = await open7(c);
        await A.evaluate(async () => { pixelEditor.newDocument(10, 10); await pixelEditor.flushAutosave(); });
        await A.evaluate(() => { const t = performance.now(); while (performance.now() - t < 7000); });
        await A.evaluate(() => pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[3, 3, 7]] })); await A.waitForTimeout(50);
        if (how === 'crash') { const crashed = new Promise(r => A.once('crash', r)); const cdp = await c.newCDPSession(A); cdp.send('Page.crash').catch(() => {}); await crashed; }
        else if (how === 'close') await A.close({ runBeforeUnload: true });
        else { await A.reload(); await A.waitForFunction(() => window.pixelEditor); await A.evaluate(() => pixelEditor.ready); }
        res[how] = how === 'reload' ? await A.evaluate(() => pixelEditor.getPixel(3, 3)) : (await fresh7(c, [[3, 3]]))[0]; await c.close(); }
      assert(Object.values(res).every(v => v === 7), 'R7-MN2: a lone fallback tab keeps an edit made right after a 7 s stall through a crash / reload / close 50 ms later (' + JSON.stringify(res) + ')');
    }

    // MN3a: the stored heartbeat changed while this tab was stalled (another tab wrote it, now stale): step down instead of beating over it
    { const c = await browser.newContext(); const A = await open7(c); await A.evaluate(async () => { pixelEditor.newDocument(10, 10); await pixelEditor.flushAutosave(); });
      await A.evaluate(() => { setTimeout(() => { const t = performance.now(); while (performance.now() - t < 7000); localStorage.setItem('osh-pixel-editor:owner:v1', JSON.stringify({ id: 'other-tab', t: Date.now() - 6500 })); window.__resumed = Date.now(); }, 0); });
      await A.evaluate(() => 0); const down = await A.waitForFunction(() => pixelEditor.isAutosavePaused(), null, { timeout: 3000 }).then(() => true).catch(() => false);
      const beats = await A.evaluate(() => window.__w.filter(w => w[0] > window.__resumed && /owner/.test(w[1])).length); await c.close();
      assert(down && beats === 0, `R7-MN3: after a stall, a heartbeat that someone else rewrote (even a stale one) makes the tab step down at the re-check, with no beat over it (stepped down ${down}, beats ${beats})`);
    }

    // MN3b: storage still shows our own heartbeat (a frozen renderer's stale view), but a newer editor answers the BroadcastChannel echo
    { const c = await browser.newContext(); const A = await open7(c); await A.evaluate(async () => { pixelEditor.newDocument(10, 10); await pixelEditor.flushAutosave(); });
      const R = await c.newPage(); await R.goto(BASE + 'blank.html');
      await R.evaluate(() => { const ch = new BroadcastChannel('osh-pixel-editor'); window.__heard = []; ch.onmessage = e => { window.__heard.push(e.data); if (typeof e.data === 'string' && e.data.startsWith('hello:')) ch.postMessage('here:newer-editor'); }; });
      await A.evaluate(() => { setTimeout(() => { const t = performance.now(); while (performance.now() - t < 7000); window.__resumed = Date.now(); pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[4, 4, 2]] }); }, 0); });
      await A.evaluate(() => 0); const down = await A.waitForFunction(() => pixelEditor.isAutosavePaused(), null, { timeout: 2000 }).then(() => true).catch(() => false);
      const r = await A.evaluate(() => ({ ms: Date.now() - window.__resumed, writes: window.__w.filter(w => w[0] >= window.__resumed && /owner|journal|autosave/.test(w[1])).map(w => w[1]) })); const heard = await R.evaluate(() => window.__heard.filter(m => /^hello:/.test(m)).length);
      await c.close();
      assert(down && heard >= 1 && r.writes.length === 0, `R7-MN3: with its own heartbeat still in storage, a resumed tab asks over BroadcastChannel ('hello:<id>', ${heard} sent) and a newer editor's 'here' makes it step down before any heartbeat / journal / autosave write (${r.writes.length} writes)`);
    }
    // R7b-MN1 (Ultron's n1c collide repro): B takes over from a frozen A and paints; both freeze; A wakes first and paints;
    // B crashes. A's held journal write must keep B's entry (same snapshot token, written by B while A was stalled).
    { const res = [];
      for (const mode of ['crashB', 'settle']) { const c = await browser.newContext(); const A = await open7(c);
        await A.evaluate(async () => { pixelEditor.newDocument(10, 10); await pixelEditor.flushAutosave(); pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[1, 1, 5]] }); await pixelEditor.flushAutosave(); });
        const B = await open7(c); await A.waitForTimeout(1500);
        const t0 = Date.now(); await A.evaluate(() => { setTimeout(() => { const t = performance.now(); while (performance.now() - t < 14000); pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[2, 2, 6]] }); }, 0); });
        await B.waitForFunction(() => !pixelEditor.isAutosavePaused(), null, { timeout: 9000 });
        const bId = await B.evaluate(() => JSON.parse(localStorage.getItem('osh-pixel-editor:owner:v1')).id); // B's heartbeat names its tab id
        await B.evaluate(() => { pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[8, 8, 4]] }); setTimeout(() => { const t = performance.now(); while (performance.now() - t < 9000); }, 30); });
        while (Date.now() - t0 < 14400) await A.waitForTimeout(30);
        const j = await A.evaluate(() => { const j = JSON.parse(localStorage.getItem('osh-pixel-editor:journal:v1') || 'null'); return j ? j.entries.map(e => e.tab) : []; });
        if (mode === 'crashB') { const s = await c.newCDPSession(B); s.send('Page.crash').catch(() => {}); await A.waitForTimeout(1500); }
        else await A.waitForTimeout(12000);
        const ed = mode === 'settle' ? String(await editing(A))[0] + String(await editing(B))[0] : '-';
        for (const p of c.pages()) await p.close().catch(() => {});
        const fin = await fresh7(c, [[1, 1], [2, 2], [8, 8]]); await c.close();
        res.push({ mode, journalTabs: j.map(t => t === bId ? 'B' : 'A').join(), ed, fin: fin.join() }); }
      assert(res[0].fin === '5,0,4' && res[0].journalTabs === 'B' && res[1].fin === '5,0,4' && res[1].ed === 'ft',
        'R7b-MN1: after B took over and painted, both froze and A woke first, A\u2019s held journal write keeps B\u2019s entry for the shared token, so B crashing keeps B\u2019s edit and doesn\u2019t replay A\u2019s stale one (' + res.map(r => `${r.mode}: journal by ${r.journalTabs}, fresh ${r.fin}${r.ed !== '-' ? ', editors ' + r.ed : ''}`).join(' ; ') + ')');
    }
    // R7b-MN1 guard: a reloaded lone tab (new tab id, same snapshot token as its previous page load) still replaces the old entry
    { const c = await browser.newContext(); const A = await open7(c);
      await A.evaluate(async () => { pixelEditor.newDocument(10, 10); await pixelEditor.flushAutosave(); pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[1, 1, 5]] }); });
      await A.reload(); await A.waitForFunction(() => window.pixelEditor); await A.evaluate(() => pixelEditor.ready); await A.waitForTimeout(300);
      await A.evaluate(() => { const t = performance.now(); while (performance.now() - t < 7000); });
      await A.evaluate(() => pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[3, 3, 7]] })); await A.waitForTimeout(50);
      const crashed = new Promise(r => A.once('crash', r)); const cdp = await c.newCDPSession(A); cdp.send('Page.crash').catch(() => {}); await crashed;
      const fin = await fresh7(c, [[1, 1], [3, 3]]); await c.close();
      assert(fin.join() === '5,7', `R7b-MN1: a reloaded lone tab's held write still replaces the entry its previous page load left for the same token, so a crash right after a 7 s stall keeps the edit (${fin.join()})`);
    }

    // R7b-MN2: two owners finishing a gap together (B took over from a frozen A, then both froze): exactly one keeps editing
    { const res = [];
      for (let t = 0; t < 2; t++) { const c = await browser.newContext(); const A = await open7(c); await A.evaluate(async () => { pixelEditor.newDocument(10, 10); await pixelEditor.flushAutosave(); });
        const B = await open7(c); await A.waitForTimeout(1500); const t0 = Date.now();
        A.evaluate(() => { const t = performance.now(); while (performance.now() - t < 13000); }).catch(() => {});
        await B.waitForFunction(() => !pixelEditor.isAutosavePaused(), null, { timeout: 7000 });
        await B.evaluate(() => pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[8, 8, 4]] }));
        B.evaluate(ms => { const t = performance.now(); while (performance.now() - t < ms); }, 13000 - (Date.now() - t0)).catch(() => {});
        while (Date.now() - t0 < 13100) await A.waitForTimeout(50);
        const tl = []; const s0 = Date.now();
        while (Date.now() - s0 < 4000) { const k = String(await editing(A))[0] + String(await editing(B))[0] + ((await A.evaluate(() => !!document.querySelector('#takeoverKeep'))) || (await B.evaluate(() => !!document.querySelector('#takeoverKeep'))) ? '+prompt' : '');
          if (!tl.length || tl[tl.length - 1] !== k) tl.push(k); await A.waitForTimeout(50); }
        const bPx = await B.evaluate(() => pixelEditor.getPixel(8, 8)); await c.close();
        res.push({ tl: tl.join('>'), bPx }); }
      assert(res.every(r => !/ff|prompt/.test(r.tl) && /(^|>)ft$/.test(r.tl) && r.bPx === 4), 'R7b-MN2: two owners waking from a shared suspend answer each other with here-v, the end-of-hold heartbeat check keeps exactly one (B, whose heartbeat is stored), never no editor and no prompt (' + res.map(r => r.tl + ', B (8,8)=' + r.bPx).join(' ; ') + ')');
    }
    // R7b-MN2 wording: a takeover after a step-down with no 'bye' (the other tab crashed) doesn't claim it closed; a 'bye' one does
    { const c = await browser.newContext(); const A = await open7(c); await A.evaluate(async () => { pixelEditor.newDocument(10, 10); await pixelEditor.flushAutosave(); });
      const B = await open7(c); await A.waitForTimeout(1500);
      await A.evaluate(() => { setTimeout(() => { const t = performance.now(); while (performance.now() - t < 8000); pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[2, 2, 6]] }); }, 0); });
      await B.waitForFunction(() => !pixelEditor.isAutosavePaused(), null, { timeout: 12000 }); await A.evaluate(() => 0);
      await A.waitForFunction(() => pixelEditor.isAutosavePaused(), null, { timeout: 3000 });
      const stepNote = await A.evaluate(() => document.querySelector('#tabNotice').textContent); const warnStepped = await unloadWarns(A); // OSH-31: stepped-down edits are saved nowhere
      assert(warnStepped && (stepNote.match(/Save \(Ctrl\+S\)/g) || []).length === 1 && /not saved anywhere/.test(stepNote), `OSH-31 / OSH-36: a stepped-down tab with edits saved nowhere warns on close (${warnStepped}), and its notice says "use Save" once ("${stepNote.slice(0, 150)}")`);
      const s = await c.newCDPSession(B); s.send('Page.crash').catch(() => {});
      await A.waitForSelector('#takeoverKeep', { timeout: 15000 }); const text = await A.evaluate(() => document.querySelector('#tabNotice').textContent); await c.close();
      assert(/^No tab is editing this document right now\. This tab has its own unsaved edits[.:]/.test(text) && /^The other tab closed\. This tab has its own unsaved edits[.:]/.test(byeText),
        `R7b-MN2: the keep/load prompt says "${text.slice(0, 60)}…" after the other tab crashed, and "${byeText.slice(0, 40)}…" when it closed (sent 'bye')`);
    }
    section('Ultron round 8: MN1-MN3 + NT1-NT3');
    const noStore = () => { window.Worker = undefined; Object.defineProperty(window, 'indexedDB', { get() { return undefined; } }); Storage.prototype.setItem = function () { throw new DOMException('The user denied permission to access the database.', 'SecurityError'); }; };
    const op8 = async (c, init) => { const P = await c.newPage(); P.on('pageerror', e => err7.push(e.message)); if (init) await P.addInitScript(init); await P.goto(FILE); await P.waitForFunction(() => window.pixelEditor); await P.evaluate(() => pixelEditor.ready); return P; };
    // R8-MN1: OSH-31 warns from the first edit when storage can't be used, and after a failure even while the next save is pending
    { const res = {};
      for (const [k, init, flushFirst] of [['U2', noStore, false], ['U3', noStore, true], ['healthy', null, false]]) { const c = await browser.newContext(); const P = await op8(c, init);
        await P.evaluate(async f => { const me = pixelEditor.createSession('user'); if (f) { me.apply({ op: 'set_pixels', pixels: [[0, 0, 1]] }); await pixelEditor.flushAutosave(); } me.apply({ op: 'set_pixels', pixels: [[1, 1, 1]] }); }, flushFirst);
        const st = await P.evaluate(() => document.querySelector('#saveStatus').dataset.state); res[k] = (await unloadWarns(P)) + '/' + st; await c.close(); }
      assert(/^true/.test(res.U2) && /^true/.test(res.U3) && /^false/.test(res.healthy), `R8-MN1: closing at once warns on a first edit when storage is unusable (U2: ${res.U2}) and on a new edit after "Autosave failed" (U3: ${res.U3}); a healthy tab's first edit (journaled) doesn't (${res.healthy})`); }
    // R8-MN2: a paused tab whose own edits were saved with Ctrl+S doesn't warn, and its keep/load prompt says the edits are in a file
    { const r = {};
      for (const mode of ['paused', 'prompt']) { const c = await browser.newContext({ acceptDownloads: true }); const A = await op8(c); await A.evaluate(async () => { pixelEditor.newDocument(16, 16); await pixelEditor.flushAutosave(); });
        const B = await op8(c); await B.waitForFunction(() => pixelEditor.isAutosavePaused());
        await B.click('h1.brand', { force: true }); await B.evaluate(() => pixelEditor.setTool('pencil')); await B.focus('#view'); await B.keyboard.press('Enter');
        const dl = B.waitForEvent('download', { timeout: 5000 }).then(d => d.suggestedFilename()).catch(() => ''); await B.keyboard.press('Control+s'); r.file = await dl; await B.waitForTimeout(100);
        if (mode === 'prompt') { await A.close({ runBeforeUnload: false }); await B.waitForSelector('#takeoverKeep', { timeout: 8000 }); r.text = await B.evaluate(() => document.querySelector('#tabNotice').textContent); }
        r[mode] = await unloadWarns(B, false); await c.close(); }
      assert(/\.osh\.json$/.test(r.file) && !r.paused && !r.prompt && /saved to a file, not autosaved/.test(r.text) && !/unsaved edits/.test(r.text),
        `R8-MN2: after Ctrl+S (${r.file}) a paused tab's edits are not "unsaved": closing doesn't warn (paused ${r.paused}, with the keep/load prompt ${r.prompt}) and the prompt says "${r.text.slice(0, 110)}…"`); }
    // R8-NT2: the tab notice and the keep/load prompt sit below the header, never over Save, the name or the save status
    { const res = [];
      for (const [w, h] of [[390, 844], [1024, 576], [1280, 800]]) { const c = await browser.newContext({ viewport: { width: w, height: h } }); const A = await op8(c); await A.evaluate(async () => { pixelEditor.newDocument(16, 16); await pixelEditor.flushAutosave(); });
        const B = await op8(c); await B.waitForFunction(() => pixelEditor.isAutosavePaused()); await B.waitForSelector('#tabNotice');
        await B.evaluate(() => pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[1, 1, 1]] }));
        const hits = () => B.evaluate(() => { const n = document.querySelector('#tabNotice').getBoundingClientRect(); const out = [];
          for (const e of document.querySelectorAll('#topbar button, #topbar input, #topbar select, #saveStatus')) { const r = e.getBoundingClientRect(); if (!r.width) continue;
            if (r.left < n.right && n.left < r.right && r.top < n.bottom && n.top < r.bottom) out.push(e.id || e.dataset.act || e.tagName); }
          return { out, inView: n.left >= 0 && n.right <= innerWidth + 0.5 }; });
        const n1 = await hits(); await A.close({ runBeforeUnload: false }); await B.waitForSelector('#takeoverKeep', { timeout: 8000 }); const n2 = await hits();
        res.push(`${w}: notice over [${n1.out}]${n1.inView ? '' : ' OFF-SCREEN'}, prompt over [${n2.out}]${n2.inView ? '' : ' OFF-SCREEN'}`); await c.close(); }
      assert(res.every(r => /notice over \[\], prompt over \[\]$/.test(r)), 'R8-NT2: ' + res.join(' ; ')); }
    // R8-NT3: the prompt doesn't take focus from a text field being typed in; it is announced, and Keep gets focus when the user leaves the field
    { const c = await browser.newContext({ viewport: { width: 1024, height: 576 } }); const A = await op8(c); await A.evaluate(async () => { pixelEditor.newDocument(16, 16); await pixelEditor.flushAutosave(); });
      const B = await op8(c); await B.waitForFunction(() => pixelEditor.isAutosavePaused());
      await B.evaluate(() => pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[1, 1, 1]] }));
      await B.click('#docName'); await B.keyboard.press('Control+a'); await B.keyboard.type('hero');
      await A.close({ runBeforeUnload: false }); await B.waitForSelector('#takeoverKeep', { timeout: 8000 }); await B.keyboard.type('-walk'); await B.waitForTimeout(100);
      const during = await B.evaluate(() => ({ f: document.activeElement.id, v: document.querySelector('#docName').value, sr: document.querySelector('#srStatus').textContent }));
      await B.click('h1.brand', { force: true }); await B.waitForTimeout(80); const afterBlur = await B.evaluate(() => document.activeElement.id);
      await B.keyboard.press('Enter'); await B.waitForTimeout(150); const fin = await B.evaluate(() => ({ prompt: !!document.querySelector('#takeoverKeep'), paused: pixelEditor.isAutosavePaused() })); await c.close();
      assert(during.f === 'docName' && during.v === 'hero-walk' && /Another tab question: .*Keep/.test(during.sr) && afterBlur === 'takeoverKeep' && !fin.prompt && !fin.paused,
        `R8-NT3: typing in the name field keeps focus there when the prompt appears (${during.f}, "${during.v}"), the prompt is announced ("${during.sr.slice(0, 60)}…"), leaving the field focuses Keep (${afterBlur}) and Enter keeps (prompt gone ${!fin.prompt}, editing ${!fin.paused})`); }
    // R8-MN3 (Ultron's n1d crashBothIn): both owners wake together, the loser (A) and B paint in the ~480 ms window, both crash ~130 ms in:
    // the loser never writes its stale merge of B's entry, so B's in-window edit survives
    { const res = [];
      for (let t = 0; t < 2; t++) { const c = await browser.newContext(); const A = await open7(c); await A.evaluate(async () => { pixelEditor.newDocument(10, 10); await pixelEditor.flushAutosave(); });
        const B = await open7(c); await A.waitForTimeout(1500); const sA = await c.newCDPSession(A), sB = await c.newCDPSession(B); const t0 = Date.now(), wake = t0 + 13000;
        A.evaluate(w => { const t = performance.now() + (w - Date.now()); window.__wake = w; while (performance.now() < t); pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[2, 2, 6]] }); }, wake).catch(() => {});
        await B.waitForFunction(() => !pixelEditor.isAutosavePaused(), null, { timeout: 7000 });
        await B.evaluate(() => pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[8, 8, 4]] })); await B.waitForTimeout(100);
        B.evaluate(w => { const t = performance.now() + (w - Date.now()); while (performance.now() < t); pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[3, 3, 7]] }); }, wake).catch(() => {});
        while (Date.now() < wake + 130) await new Promise(r => setTimeout(r, 5));
        const aw = await A.evaluate(() => window.__w.filter(w => w[0] >= window.__wake && /journal/.test(w[1])).length).catch(() => -1);
        const crashed = Promise.all([A, B].map(p => new Promise(r => p.once('crash', r)))); sA.send('Page.crash').catch(() => {}); sB.send('Page.crash').catch(() => {}); await crashed;
        const fin = await fresh7(c, [[2, 2], [8, 8], [3, 3]]); await c.close(); res.push({ fin: fin.join(), aw }); }
      assert(res.every(r => r.fin === '0,4,7' && r.aw === 0), `R8-MN3: after a shared wake, a crash of both tabs inside the dual-owner window keeps the winner's in-window edit and none of the loser's (${res.map(r => `fresh (2,2),(8,8),(3,3) = ${r.fin}, loser journal writes ${r.aw}`).join(' ; ')})`); }
    // OSH-37 (Mystique round 4): with Web Locks, a crashed editor's tab is not announced as "closed"; a real close (bye) is, and a
    // 'bye' from an earlier editor doesn't carry over to a later one that crashes (3 tabs: A closes, B takes over, B crashes, C asks)
    { const c = await browser.newContext(); const errL = [];
      const openL = async () => { const P = await c.newPage(); P.on('pageerror', e => errL.push(e.message)); await P.goto(FILE); await P.waitForFunction(() => window.pixelEditor); await P.evaluate(() => pixelEditor.ready); return P; };
      const crash = async P => { const crashed = new Promise(r => P.once('crash', r)); const s = await c.newCDPSession(P); s.send('Page.crash').catch(() => {}); await crashed; };
      const ownEdit = (P, x) => P.evaluate(x => pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[x, x, 5]] }), x);
      const ask = async P => { await P.waitForSelector('#takeoverKeep', { timeout: 8000 }); return P.evaluate(() => ({ msg: document.querySelector('#tabNoticeMsg').textContent, status: document.querySelector('#saveStatus').textContent, mode: pixelEditor.isAutosavePaused() })); };
      const A = await openL(); await A.evaluate(async () => { pixelEditor.newDocument(10, 10); await pixelEditor.flushAutosave(); });
      const B = await openL(); const C = await openL(); const locks = await B.evaluate(() => !!(navigator.locks && navigator.locks.request) && pixelEditor.isAutosavePaused());
      await ownEdit(B, 2); await ownEdit(C, 3);
      await A.close({ runBeforeUnload: true }); const qB = await ask(B); await B.bringToFront(); await B.click('#takeoverKeep'); await B.waitForTimeout(300); // R9-MN2: B is a background tab (C opened last); Chrome throttles its animation frames, which Playwright's click waits on
      await crash(B); const qC = await ask(C);
      const D = await openL(); await ownEdit(D, 4); await crash(C); const qD = await ask(D);
      await c.close();
      const closedRe = /^The other tab closed\. This tab has its own unsaved edits/, crashRe = /^No tab is editing this document right now\. This tab has its own unsaved edits/;
      assert(locks && closedRe.test(qB.msg) && /Other tab closed: choose Keep or Load/.test(qB.status) && crashRe.test(qC.msg) && /No tab is editing: choose Keep or Load/.test(qC.status) && crashRe.test(qD.msg) && errL.length === 0,
        `OSH-37: in Web Locks mode (${locks}) a close says "${qB.msg.slice(0, 24)}…" / "${qB.status.slice(0, 18)}…", a crash after an earlier close says "${qC.msg.slice(0, 26)}…" / "${qC.status.slice(0, 20)}…", and a plain crash says "${qD.msg.slice(0, 26)}…"` + (errL.length ? '; page errors: ' + errL.join(' | ') : '')); }
    section('Ultron round 9: MN1, NT3, nit 8');
    // R9-MN1 (OSH-37): Web Locks can grant the lock before the old editor's 'bye' arrives; a 'bye' that lands a few ms after
    // this tab became owner (inside the 300 ms grace wait) still makes the prompt say the other tab closed
    { const c = await browser.newContext(); const A = await op8(c); await A.evaluate(async () => { pixelEditor.newDocument(10, 10); await pixelEditor.flushAutosave(); });
      const B = await op8(c); await B.waitForFunction(() => pixelEditor.isAutosavePaused()); const locks = await B.evaluate(() => !!(navigator.locks && navigator.locks.request));
      await B.evaluate(() => pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[1, 1, 1]] }));
      const R = await c.newPage(); await R.goto(BASE + 'blank.html');
      await R.evaluate(() => { const ch = new BroadcastChannel('osh-pixel-editor'); window.__late = null;
        ch.onmessage = e => { if (window.__late === null && typeof e.data === 'string' && e.data.startsWith('owner:')) { window.__late = 'pending'; setTimeout(() => { ch.postMessage('bye:x'); window.__late = 'sent'; }, 5); } }; });
      const crashed = new Promise(r => A.once('crash', r)); const sA = await c.newCDPSession(A); sA.send('Page.crash').catch(() => {}); await crashed; // no 'bye' from A itself
      await B.waitForSelector('#takeoverKeep', { timeout: 8000 }); const late = await R.evaluate(() => window.__late);
      const msg = await B.evaluate(() => document.querySelector('#tabNoticeMsg').textContent + ' | ' + document.querySelector('#saveStatus').textContent); await c.close();
      assert(locks && late === 'sent' && /^The other tab closed\. /.test(msg) && /Other tab closed: choose Keep or Load/.test(msg),
        `R9-MN1: a 'bye' arriving ~5 ms after the Web Locks grant (helper ${late}) is still seen by the grace wait: "${msg.slice(0, 40)}…"`); }
    // R9-NT3: leaving the name field by Tab or by clicking the canvas keeps focus where the user put it (Keep only gets focus
    // when focus would fall to <body>, which the R8-NT3 test covers); a later Enter doesn't answer the prompt
    { const res = {};
      for (const how of ['tab', 'canvas']) { const c = await browser.newContext({ viewport: { width: 1024, height: 576 } }); const A = await op8(c); await A.evaluate(async () => { pixelEditor.newDocument(16, 16); await pixelEditor.flushAutosave(); });
        const B = await op8(c); await B.waitForFunction(() => pixelEditor.isAutosavePaused());
        await B.evaluate(() => pixelEditor.createSession('user').apply({ op: 'set_pixels', pixels: [[1, 1, 1]] }));
        await B.bringToFront(); await B.click('#docName'); await B.keyboard.type('x');
        await A.close({ runBeforeUnload: false }); await B.waitForSelector('#takeoverKeep', { timeout: 8000 }); await B.bringToFront();
        if (how === 'tab') await B.keyboard.press('Tab'); else await B.click('#view');
        await B.waitForTimeout(80); const f = await B.evaluate(() => document.activeElement.id || document.activeElement.tagName);
        if (how === 'canvas') { await B.keyboard.press('Enter'); await B.waitForTimeout(150); }
        const prompt = await B.evaluate(() => !!document.querySelector('#takeoverKeep')); res[how] = { f, prompt }; await c.close(); }
      assert(!['takeoverKeep', 'docName', 'BODY'].includes(res.tab.f) && res.tab.prompt && res.canvas.f === 'view' && res.canvas.prompt,
        `R9-NT3: leaving the name field doesn't pull focus to Keep: Tab → ${res.tab.f}, canvas click → ${res.canvas.f}, and a later Enter leaves the prompt open (${res.canvas.prompt})`); }
    // R9 (Ultron nit 8): at 1280×800 the #view backing store matches its box after boot (was 952×551 in a 952×522 box until a resize)
    { const c = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const P = await op8(c); await P.waitForTimeout(1500);
      const v = await P.evaluate(() => { const e = document.querySelector('#view'), r = e.getBoundingClientRect(), dpr = devicePixelRatio || 1; return { bw: e.width, bh: e.height, w: Math.round(r.width * dpr), h: Math.round(r.height * dpr) }; }); await c.close();
      assert(v.bw === v.w && v.bh === v.h, `R9-nit8: after boot the canvas backing ${v.bw}×${v.bh} matches its box ${v.w}×${v.h} (width and height)`); }
    assert(err7.length === 0, 'R7: no page errors in the fallback-lock tests' + (err7.length ? ': ' + err7.slice(0, 3).join(' | ') : ''));
  }
  { // MN4: one sheet rule for Export Sheet and renderSheet: wrap to more columns before refusing; scales are the 1× sheet scaled
    await E(() => { pixelEditor.newDocument(256, 256); const me = pixelEditor.createSession('user'); for (let i = 1; i < 260; i++) me.apply({ op: 'add_frame' }); });
    const api = await E(() => { const r = pixelEditor.renderSheet({ scale: 1 }); let e2 = ''; try { pixelEditor.renderSheet({ scale: 2 }); } catch (e) { e2 = e.code + ': ' + e.message; }
      return { size: r.meta.size.w + 'x' + r.meta.size.h, f259: r.meta.frames[259].x + ',' + r.meta.frames[259].y, e2 }; });
    const ui = async sc => { await page.selectOption('#expScale', String(sc)); const got = await Promise.all([page.waitForEvent('download'), page.waitForEvent('download', { predicate: d => /\.json$/.test(d.suggestedFilename()) }), page.click('[data-act="exportSheet"]')]);
      const m = JSON.parse(fs.readFileSync(await got[1].path(), 'utf8')); return { png: got[0].suggestedFilename(), size: m.meta.size.w + 'x' + m.meta.size.h, f259: m.frames[259].frame.x + ',' + m.frames[259].frame.y, toast: await E(() => document.querySelector('#toast').textContent) }; };
    await E(() => { document.querySelector('#docName').value = 'tall'; });
    const u1 = await ui(1), u2 = await ui(2); await page.selectOption('#expScale', '1');
    assert(api.size === '8192x2304' && u1.size === api.size && u1.f259 === api.f259 && u1.png === 'tall.png', `R7-MN4: 260 frames of 256×256 wrap to 32 columns in both the UI and the API (renderSheet ${api.size}, Export Sheet ${u1.size}; frame 259 at ${api.f259} / ${u1.f259})`);
    assert(/^too_big: sprite sheet would be 16384×4608 px at scale 2; the limit is 8192 px per side \(the largest scale that fits is 1\)$/.test(api.e2) && u2.png === 'tall.png' && u2.size === api.size && /2× would be 16384×4608 px, over the 8192 px limit, so it was exported at 1×/.test(u2.toast),
      `R7-MN4: at 2× the API refuses with a followable message ("${api.e2}") and the UI exports at 1× and says so ("${u2.toast.slice(0, 120)}")`);
    await E(() => pixelEditor.newDocument(32, 32));
  }
  section('screenshots');
  await E(() => pixelEditor.loadExample()); await page.waitForTimeout(400);
  await page.screenshot({ path: SHOTS + '/01-editor-walk.png' });
  await E(() => { document.querySelector('#optOnion').click(); pixelEditor.setFrame(1); pixelEditor.setTool('pencil'); });
  const [hx, hy] = await toScreen(14, 22); await page.mouse.move(hx, hy); await page.waitForTimeout(300);
  await page.screenshot({ path: SHOTS + '/02-onion-skin.png' });
  await page.keyboard.press('?'); await page.waitForTimeout(200);
  await page.screenshot({ path: SHOTS + '/03-shortcuts.png' }); await page.keyboard.press('Escape');

  assert(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await E(() => pixelEditor.clearAutosave());
  await browser.close(); console.log(`\nALL PASSED (${passed} assertions)`);
})().catch(e => { console.error(e); process.exit(1); });
