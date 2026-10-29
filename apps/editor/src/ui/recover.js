/** Document replacement with recovery, clean state, undo/redo across replacements, transforms. */
import { Clean, hasContent, markClean } from '../core/clean-state.js';
import { makeDoc } from '../core/document.js';
import { Core } from '../core/editor-core.js';
import { Autosave } from '../persist/autosave.js';
import { doOp } from './do-op.js';
import { $ } from './dom.js';
import { hooks } from './hooks.js';
import { commitFloating } from './selection.js';
import { Cur, curFrameId, doc } from './state/context.js';
import { Gesture } from './state/gesture.js';
import { Paint } from './state/paint.js';
import { PvS } from './state/preview.js';
import { Sel } from './state/selection.js';
import { Tool } from './state/tool.js';
import { syncCtx } from './sync-ctx.js';
import { toast } from './toast.js';
import { fitView } from './zoom.js';
import { DEFAULT_PALETTE } from '@osh/palette';

/* ---------- OSH-04: replacing the document is recoverable; Undo past the start brings the previous sprite back ---------- */
export const Recover = { prev: null, next: null, swapping: false, floor: 0 }; // floor: log position the replacement started at (the example's own build ops are not separate undo steps)
export function snapshotDoc() { return { data: Core.save(), name: $('#docName').value, clean: Clean.mark && { ...Clean.mark }, floor: Recover.floor }; }
export function replaceDocument(fn, label, opts = {}) {
  const prev = hasContent() ? snapshotDoc() : null;
  fn(); // throws (nothing changed) on invalid input
  Recover.prev = prev; Recover.next = null; Recover.floor = opts.floor ? Core.cursor : 0; markClean(); syncUndoButtons();
  if (prev && label) toast(label + '. Ctrl+Z brings back your previous sprite.');
}
export function swapRecover(dir) {
  const target = Recover[dir]; if (!target) return false;
  const cur = snapshotDoc();
  Recover.swapping = true;
  try { Core.load(target.data); } finally { Recover.swapping = false; }
  $('#docName').value = target.name; Clean.mark = target.clean; Recover.floor = target.floor || 0;
  if (dir === 'prev') { Recover.prev = null; Recover.next = cur; } else { Recover.next = null; Recover.prev = cur; }
  Sel.sel = Sel.floating = Gesture.stroke = null; Cur.range = null; syncCtx(); fitView(); hooks.refreshNow(); syncUndoButtons();
  Autosave.onReset(); // the restored document is the one to keep
  toast(dir === 'prev' ? 'Previous sprite restored (Ctrl+Y to go forward again)' : 'Replacement sprite restored');
  return true;
}
export const atFloor = () => !!Recover.prev && Core.cursor <= Recover.floor;
export const canUiUndo = () => (Core.cursor > 0 && !atFloor()) || !!Recover.prev;
export const canUiRedo = () => Core.cursor < Core.log.length || !!Recover.next;
export function uiUndo() { commitFloating(); if (Core.cursor > 0 && !atFloor()) return Core.undo(); return swapRecover('prev'); }
export function uiRedo() { commitFloating(); if (Core.cursor < Core.log.length) return Core.redo(); return swapRecover('next'); }
/** OSH-18: the buttons show whether there is anything to undo / redo (updated synchronously on every change). */
export function syncUndoButtons() {
  const u = $('[data-act=undo]'), r = $('[data-act=redo]'); if (!u || !Core.doc) return;
  const cu = canUiUndo(), cr = canUiRedo();
  if (u.disabled !== !cu) { u.disabled = !cu; u.setAttribute('aria-disabled', String(!cu)); }
  if (r.disabled !== !cr) { r.disabled = !cr; r.setAttribute('aria-disabled', String(!cr)); }
}

export function newDocument(w = 32, h = 32, pal = DEFAULT_PALETTE) {
  const d = makeDoc(w, h, pal); // validates (throws on bad input) before touching state
  $('#docName').value = 'untitled';
  Sel.sel = Sel.floating = Gesture.stroke = null; Cur.layer = 'L1'; Cur.frame = 0; Cur.range = null; PvS.pvAnim = ''; Paint.primary = 1; Paint.secondary = 0; Gesture.lastPt = null;
  Core.reset(d); syncCtx(); fitView(); hooks.refreshNow(); markClean();
}

/* ---------- transforms (flip / rotate) ---------- */
export const canRotate90 = () => !!(Sel.sel || Sel.floating) || doc().width === doc().height;
export const ROT_HINT = 'Rotating 90° needs a square canvas. Select an area first (M), then rotate it.';
export function syncRotateButtons() {
  if (!Core.doc) return; const ok = canRotate90();
  for (const [id, t] of [['#xfRotCW', 'Rotate 90° clockwise (Shift+R)'], ['#xfRotCCW', 'Rotate 90° counter-clockwise']]) { const b = $(id); if (!b) continue; b.disabled = !ok; b.title = ok ? t : ROT_HINT; }
}
export function transform(kind, arg) {
  if (kind === 'rotate' && arg !== '180' && !canRotate90()) { toast(ROT_HINT); return; }
  commitFloating();
  const scope = Sel.sel ? 'cel' : Tool.xformScope, op = { op: kind, layer: Cur.layer, frame: curFrameId(), scope };
  if (kind === 'flip') op.axis = arg; else op.dir = arg;
  if (Sel.sel) op.rect = { ...Sel.sel };
  if (doOp(op) && Sel.sel && kind === 'rotate' && arg !== '180') { const r = Sel.sel, W = r.h, H = r.w; Sel.sel = { x: r.x + Math.floor((r.w - W) / 2), y: r.y + Math.floor((r.h - H) / 2), w: W, h: H }; }
}
$('#xfFlipH').onclick = () => transform('flip', 'h');
$('#xfFlipV').onclick = () => transform('flip', 'v');
$('#xfRotCW').onclick = () => transform('rotate', 'cw');
$('#xfRotCCW').onclick = () => transform('rotate', 'ccw');
$('#xfScope').onchange = e => { Tool.xformScope = e.target.value; };

/* ---------- thumbnails (cached per frame, redrawn only when dirty) ---------- */
