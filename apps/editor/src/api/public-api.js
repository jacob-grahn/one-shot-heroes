/** Public API for scripts and the AI pixel-art agent (window.pixelEditor). */
import { Core } from '../core/editor-core.js';
import { Autosave } from '../persist/autosave.js';
import { ready } from '../ready.js';
import { TOOLS } from '../ui/defs.js';
import { $ } from '../ui/dom.js';
import { buildSheet, frameCanvas, sheetLimitMsg } from '../ui/export.js';
import { gotoFrame } from '../ui/frames.js';
import { PV, resetPreview, togglePlay } from '../ui/preview.js';
import { newDocument } from '../ui/recover.js';
import { refresh, refreshNow } from '../ui/refresh.js';
import { Cur } from '../ui/state/context.js';
import { Paint } from '../ui/state/paint.js';
import { PvS } from '../ui/state/preview.js';
import { Sel } from '../ui/state/selection.js';
import { Tool } from '../ui/state/tool.js';
import { Vp } from '../ui/state/viewport.js';
import { setTool } from '../ui/tools-panel.js';
import { fitView } from '../ui/zoom.js';
import { loadExample } from './example.js';
import { Session, frozen } from './session.js';
import { encodeDoc, metaOf } from '@osh/format/document';
import { FORMAT_VERSION, LIMITS } from '@osh/format/limits';
import { fail, intArg } from '@osh/format/validate';
import { PALETTES, deepFreeze } from '@osh/palette';
import { FPS, FRAME_MS } from '@osh/timing';

/* ===== Public API for scripts and the AI pixel-art agent ===== */
/** opts.frame / opts.scale of renderPNG, validated. */
function pngOptions(opts) {
  if (opts === null || typeof opts !== 'object') fail('bad_arg', 'opts must be an object');
  const d = Core.doc, fi = opts.frame === undefined ? Cur.frame : Core.frameIndex(Core.resolveFrame(opts.frame));
  const scale = opts.scale === undefined ? 1 : intArg(opts.scale, 'scale', 1, 32);
  if (d.width * scale > 8192 || d.height * scale > 8192) fail('too_big', 'scale too large for this sprite');
  return { d, fi, scale };
}
function pngGrid(x, g) {
  const { d, scale, pad, out } = g;
  x.strokeStyle = 'rgba(128,128,128,0.5)'; x.beginPath();
  for (let i = 1; i < d.width; i++) { x.moveTo(pad + i * scale + 0.5, pad); x.lineTo(pad + i * scale + 0.5, out.height); }
  for (let j = 1; j < d.height; j++) { x.moveTo(pad, pad + j * scale + 0.5); x.lineTo(out.width, pad + j * scale + 0.5); }
  x.stroke();
}
/** Coordinate labels every pixel (or every 2/4/8 if crowded) for vision models. */
function pngLabels(x, g) {
  const { d, scale, pad } = g;
  x.fillStyle = '#f4f4f4'; x.font = '9px monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
  const step = [1, 2, 4, 8, 16].find(s => s * scale >= 14) || 16;
  for (let i = 0; i < d.width; i += step) x.fillText(String(i), pad + i * scale + scale / 2, pad / 2);
  for (let j = 0; j < d.height; j += step) x.fillText(String(j), pad / 2, pad + j * scale + scale / 2);
}
export function renderPNG(opts = {}) {
  const { d, fi, scale } = pngOptions(opts);
  const labels = !!opts.labels && scale >= 8, pad = labels ? 14 : 0, c = frameCanvas(fi, scale);
  if (!(opts.grid || labels) || scale < 4) return c.toDataURL('image/png');
  const out = document.createElement('canvas'); out.width = c.width + pad; out.height = c.height + pad;
  const x = out.getContext('2d'); if (labels) { x.fillStyle = '#1a1c2c'; x.fillRect(0, 0, out.width, out.height); }
  x.drawImage(c, pad, pad);
  const g = { d, scale, pad, out };
  pngGrid(x, g);
  if (labels) pngLabels(x, g);
  return out.toDataURL('image/png');
}
/** Topmost visible palette index at (x, y) of frame f (0 = transparent). */
function topIndex(d, f, i) {
  for (let k = d.layers.length - 1; k >= 0; k--) { const l = d.layers[k]; if (!l.visible) continue; const v = d.cels[l.id + ':' + f][i]; if (v) return v; }
  return 0;
}
const gridChar = c => c ? (c < 36 ? c.toString(36) : '#') : '.';
export function renderTextGrid(opts = {}) {
  const d = Core.doc, f = Core.resolveFrame(opts && opts.frame), rows = [];
  for (let y = 0; y < d.height; y++) { let s = ''; for (let x = 0; x < d.width; x++) s += gridChar(topIndex(d, f, y * d.width + x)); rows.push(s); }
  return rows.join('\n');
}

export const API = {
  FPS, FRAME_MS, PALETTES, LIMITS, version: FORMAT_VERSION,
  /** pixelEditor.createSession('ai') → { apply(op), applyAll(ops) } with author fixed to 'ai'. */
  createSession(author) { return Session(author); },
  undo() { return Core.undo(); }, redo() { return Core.redo(); },
  canUndo() { return Core.cursor > 0; }, canRedo() { return Core.cursor < Core.log.length; },
  /** Read-only views (frozen copies; mutating them cannot affect the editor). */
  getDocument() { return frozen(encodeDoc(Core.doc)); },
  getMeta() { return frozen(metaOf(Core.doc)); },
  /** {pixels, tags} for one cel: palette indices and per-pixel provenance tags (0 = hand-drawn, 1 = AI). */
  getCel(layer, frame) { const k = Core.resolveLayer(layer) + ':' + Core.resolveFrame(frame); return frozen({ pixels: Array.from(Core.doc.cels[k]), tags: Array.from(Core.doc.tags[k]) }); },
  getPixels(layer, frame) { const k = Core.resolveLayer(layer) + ':' + Core.resolveFrame(frame); return Array.from(Core.doc.cels[k]); },
  getTags(layer, frame) { const k = Core.resolveLayer(layer) + ':' + Core.resolveFrame(frame); return Array.from(Core.doc.tags[k]); },
  getPixelTag(x, y, layer, frame) { const d = Core.doc; intArg(x, 'x', 0, d.width - 1); intArg(y, 'y', 0, d.height - 1); return d.tags[Core.resolveLayer(layer) + ':' + Core.resolveFrame(frame)][y * d.width + x]; },
  getPixel(x, y, layer, frame) { const d = Core.doc; intArg(x, 'x', 0, d.width - 1); intArg(y, 'y', 0, d.height - 1); return d.cels[Core.resolveLayer(layer) + ':' + Core.resolveFrame(frame)][y * d.width + x]; },
  getLog() { return frozen(Core.log.map(e => e.op)); }, getCursor() { return Core.cursor; },
  /** {ai, aiPixelCount, pixelCount, label: 'ai'|'human'|'unknown', counts (ops by author), unknownBase} */
  provenance() { return frozen(Core.provenance()); },
  getProvenance() { return frozen(Core.provenance()); },
  renderPNG, renderTextGrid,
  renderSheet(opts) { const scale = opts && opts.scale !== undefined ? intArg(opts.scale, 'scale', 1, 8) : 1; const lim = sheetLimitMsg(scale); if (lim) fail('too_big', lim); /* N4, R7-MN4: the UI's rule */ const { canvas, meta } = buildSheet(scale); return frozen({ png: canvas.toDataURL('image/png'), meta }); },
  save() { return Core.save(); },
  /** Load a saved file (object or JSON string). Validated; on error nothing changes. Returns {replayed, warning?}. */
  load(data) { const r = Core.load(data); Sel.sel = Sel.floating = null; refreshNow(); fitView(); return frozen(r); },
  newDocument(w, h, palette) { newDocument(w, h, palette); },
  loadExample() { loadExample(); },
  setFrame(i) { gotoFrame(Core.frameIndex(Core.resolveFrame(i))); }, setLayer(id) { Cur.layer = Core.resolveLayer(id); refresh(); }, setTool(t) { if (!TOOLS.some(x => x[0] === t)) fail('bad_arg', 'unknown tool'); setTool(t); },
  getState() { return frozen({ tool: Tool.tool, frame: Cur.frame, layer: Cur.layer, primary: Paint.primary, secondary: Paint.secondary, zoom: Vp.zoom, panX: Vp.panX, panY: Vp.panY, previewAnim: PvS.pvAnim, playing: PvS.pvPlaying, selection: Sel.sel }); },
  preview: Object.freeze({ play() { if (!PvS.pvPlaying) togglePlay(); }, pause() { if (PvS.pvPlaying) togglePlay(); },
    select(name) { if (name && !Core.doc.animations.some(a => a.name === name)) fail('bad_arg', 'no animation ' + JSON.stringify(String(name).slice(0, 40))); PvS.pvAnim = name || ''; resetPreview(); refresh(); },
    stats() { const t = PV.tickTimes, iv = []; for (let i = 1; i < t.length; i++) iv.push(t[i] - t[i - 1]); const avg = iv.length ? iv.reduce((a, b) => a + b, 0) / iv.length : 0; return { ticks: PV.ticks, step: PV.step, avgIntervalMs: avg, fps: avg ? 1000 / avg : 0 }; } }),
  /** Subscribe to change events ({type, op}, frozen copies). Returns an unsubscribe function. */
  on(fn) { if (typeof fn !== 'function') fail('bad_arg', 'listener must be a function'); Core.external.push(fn); return () => { const i = Core.external.indexOf(fn); if (i >= 0) Core.external.splice(i, 1); }; },
  /** Autosave controls: flush now (resolves {ok, bytes|error}), status, clear. */
  flushAutosave() { return Autosave.flush().then(frozen); },
  autosaveStatus() { const e = $('#saveStatus'); return frozen({ state: e.dataset.state, text: e.textContent, last: Autosave.last }); },
  clearAutosave() { return Autosave.clear(); },
  /** True when another tab holds the editor lock and this tab will not write the autosave. */
  isAutosavePaused() { return Autosave.paused; },
};
API.ready = ready;
Object.defineProperty(window, 'pixelEditor', { value: deepFreeze(API), writable: false, configurable: false, enumerable: true });

