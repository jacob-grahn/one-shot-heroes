/** Global keyboard shortcuts. */
import { act } from './actions.js';
import { announce } from './announce.js';
import { view } from './canvases.js';
import { doOp } from './do-op.js';
import { $ } from './dom.js';
import { gotoFrame } from './frames.js';
import { focusKind, kcApply, kcEndRun, kcMove, nudge } from './kbd-cursor.js';
import { closeModal, modalIsOpen } from './modal.js';
import { colourName, presetSel, renderPalette } from './palette-panel.js';
import { togglePlay } from './preview.js';
import { transform, uiRedo, uiUndo } from './recover.js';
import { render } from './render-queue.js';
import { cancelFloating, commitFloating, copyRegion, copyTags } from './selection.js';
import { Cur, doc } from './state/context.js';
import { KC } from './state/key-cursor.js';
import { Opts } from './state/options.js';
import { Paint } from './state/paint.js';
import { Sel } from './state/selection.js';
import { Tool } from './state/tool.js';
import { Vp } from './state/viewport.js';
import { toast } from './toast.js';
import { setTool, syncOptions } from './tools-panel.js';
import { fitView, setZoom, zoomStep } from './zoom.js';

export const NAV_KEY = /^(Arrow|Home$|End$|Page)/;
/** Returned by a Ctrl handler to end keydown handling without preventDefault. */
const STOP = 'stop';

/** Dialogs own the keyboard: Esc cancels; Enter submits from a text field or a (closed) select; buttons behave natively (OSH-02/03). */
function modalKeys(e, c) {
  const { k, ctrl } = c;
  if (k === 'Escape') { e.preventDefault(); closeModal(); }
  else if (k === 'Tab' && !$('#modal').contains(document.activeElement)) { e.preventDefault(); $('#mCancel').focus(); }
  else if (k === 'Enter' && (fieldSubmits(e, c) || (ctrl && e.target.tagName === 'TEXTAREA'))) { e.preventDefault(); $('#mOk').click(); }
}
const fieldSubmits = (e, c) => (c.kind === 'text' || c.kind === 'select') && e.target.tagName !== 'TEXTAREA' && !e.isComposing && !$('#mOk').classList.contains('hidden');
/** Document-level chords work from anywhere, text fields included (OSH-07). Returns true when handled. */
function documentChord(e, c) {
  const name = chordName(e, c);
  if (!name) return false;
  e.preventDefault(); act[name](); return true;
}
function chordName(e, { ctrl, lk }) {
  if (!ctrl) return null;
  if (!e.altKey && !e.shiftKey && (lk === 's' || lk === 'o')) return lk === 's' ? 'save' : 'open';
  return e.altKey && lk === 'n' ? 'new' : null;
}
/** Keys that stay with the focused control. Returns true when keydown handling should end here. */
function nativeKey(e, c) {
  const { k, ctrl, kind } = c;
  if (kind === 'text') return true;                                                // typing: no shortcuts, native text undo
  if (e.target === presetSel && !e.altKey && !ctrl && NAV_KEY.test(k)) { e.preventDefault(); return true; } // OSH-24: arrows on the closed Preset list must not swap the palette (Space / Alt+Down opens it)
  return controlOwnsKey(kind, k);
}
function controlOwnsKey(kind, k) {
  if ((kind === 'range' || kind === 'select') && (NAV_KEY.test(k) || k === ' ' || k === 'Enter' || k === 'Tab')) return true; // OSH-10: slider / dropdown keys stay native
  return (kind === 'button' || kind === 'toggle') && (k === 'Enter' || k === ' '); // OSH-01: native activation
}

function copyCut(lk) {
  const r = Sel.floating || Sel.sel; if (!r) return STOP;
  Sel.clipboard = { w: r.w, h: r.h, data: Sel.floating ? Sel.floating.data.slice() : copyRegion(r), tags: Sel.floating ? (Sel.floating.tags || []).slice() : copyTags(r) }; // per-pixel AI tags travel with the pixels, across documents too
  if (lk === 'x') { if (Sel.floating) { const src = Sel.floating.src; Sel.floating = null; if (src) doOp({ op: 'clear_rect', ...src }); } else doOp({ op: 'clear_rect', ...Sel.sel }); }
  toast(lk === 'c' ? 'Copied' : 'Cut');
}
function paste() {
  if (!Sel.clipboard) return STOP;
  commitFloating(); const p = Sel.sel || { x: 0, y: 0 };
  Sel.floating = { x: p.x, y: p.y, w: Sel.clipboard.w, h: Sel.clipboard.h, data: Sel.clipboard.data.slice(), src: null, tags: Sel.clipboard.tags.slice() }; Sel.sel = null; setTool('select');
}
/** Ctrl / Cmd shortcuts by lower-cased key. A handler may return STOP. */
const CTRL_KEYS = {
  z: e => { if (e.shiftKey) uiRedo(); else uiUndo(); },
  y: () => { uiRedo(); },
  a: () => { commitFloating(); Sel.sel = { x: 0, y: 0, w: doc().width, h: doc().height }; setTool('select'); },
  d: () => { commitFloating(); Sel.sel = null; render(); },
  c: () => copyCut('c'),
  x: () => copyCut('x'),
  v: paste,
  "'": () => { Opts.grid = !Opts.grid; syncOptions(); },
};

const toggleOption = name => () => { Opts[name] = !Opts[name]; syncOptions(); };
function deleteKey(e, c) {
  if (!c.free) return false; // OSH-27: never erase the selection from a focused button
  if (Sel.floating) { const src = Sel.floating.src; Sel.floating = null; Sel.sel = null; if (src) doOp({ op: 'clear_rect', ...src }); render(); }
  else if (Sel.sel) doOp({ op: 'clear_rect', ...Sel.sel });
  else if (c.onView && KC.kbdFocus) kcApply(true);
  else return false;
  return true;
}
function spaceKey(e, c) {
  if (c.onView && KC.kbdFocus) { if (!e.repeat) { KC.spaceHeld = true; KC.run = { entries: [] }; kcApply(); } }
  else if (!Vp.spaceDown) { Vp.spaceDown = true; view.style.cursor = 'grab'; }
}
function arrowKey(e, c) {
  const { k } = c, n = e.shiftKey ? 8 : 1;
  const dx = k === 'ArrowLeft' ? -n : k === 'ArrowRight' ? n : 0, dy = k === 'ArrowUp' ? -n : k === 'ArrowDown' ? n : 0;
  if ((Sel.floating || Sel.sel) && c.free) nudge(dx, dy);       // U14 (OSH-27: only when the canvas / page has focus)
  else if (c.onView && KC.kbdFocus) kcMove(dx, dy);        // U1
  else if (dx) gotoFrame(Cur.frame + Math.sign(dx));
  else return false;
  return true;
}
/** Plain (no Ctrl / Cmd) shortcuts by lower-cased key. A handler returning false leaves the key unhandled. */
const PLAIN_KEYS = {
  Delete: deleteKey,
  Backspace: deleteKey,
  Enter: (e, c) => { if (Sel.floating) commitFloating(); else if (c.onView && KC.kbdFocus) kcApply(); else togglePlay(); },
  Escape: () => { if (KC.anchor) { KC.anchor = null; announce('Cancelled'); render(); } else if (Sel.floating) cancelFloating(); else { Sel.sel = null; render(); } },
  ' ': spaceKey,
  ArrowLeft: arrowKey, ArrowRight: arrowKey, ArrowUp: arrowKey, ArrowDown: arrowKey,
  Home: () => { gotoFrame(0); },
  End: () => { gotoFrame(doc().frames.length - 1); },
  b: () => { setTool('pencil'); },
  e: () => { setTool('eraser'); },
  g: e => { if (e.shiftKey) { Tool.contiguous = !Tool.contiguous; syncOptions(); } setTool('fill'); },
  i: () => { setTool('picker'); },
  l: () => { setTool('line'); },
  u: e => { setTool(e.shiftKey ? 'ellipse' : 'rect'); },
  m: () => { setTool('select'); },
  x: () => { [Paint.primary, Paint.secondary] = [Paint.secondary, Paint.primary]; renderPalette(); announce('Primary colour ' + colourName(Paint.primary)); },
  '[': () => { Tool.size = Math.max(1, Tool.size - 1); syncOptions(); },
  ']': () => { Tool.size = Math.min(3, Tool.size + 1); syncOptions(); },
  '+': () => { setZoom(zoomStep(1)); }, '=': () => { setZoom(zoomStep(1)); },
  '-': () => { setZoom(zoomStep(-1)); }, _: () => { setZoom(zoomStep(-1)); },
  0: () => { fitView(); },
  F3: toggleOption('onion'),
  t: toggleOption('tile'),
  h: e => { if (e.shiftKey) transform('flip', 'h'); else { Opts.mirH = !Opts.mirH; syncOptions(); } },
  v: e => { if (!e.shiftKey) return false; transform('flip', 'v'); },
  r: e => { if (!e.shiftKey) return false; transform('rotate', 'cw'); },
  n: e => { if (e.altKey) act.frDup(); else if (e.shiftKey) act.layAdd(); else return false; },
  ',': () => { gotoFrame(Cur.frame - 1); },
  '.': () => { gotoFrame(Cur.frame + 1); },
  p: () => { togglePlay(); },
  '?': () => { act.help(); }, F1: () => { act.help(); },
};
/** OSH-27: keys aimed at the canvas or the page, not at a focused control. */
const isFree = (e, c) => c.onView || c.kind === 'none' || e.target === document.body || e.target === document.documentElement;
const lookup = (table, key) => (Object.hasOwn(table, key) ? table[key] : null);
/** OSH-24: no type-ahead palette swap on the Preset list either. */
const blocksTypeAhead = (e, c) => e.target === presetSel && c.k.length === 1 && !c.ctrl && !e.altKey;
/** Runs the shortcut for this key: true = handled, false = not a shortcut here, STOP = end without preventDefault. */
function shortcut(e, c) {
  const h = lookup(c.ctrl ? CTRL_KEYS : PLAIN_KEYS, c.lk);
  if (!h) return false;
  const r = h(e, c);
  return r === STOP ? STOP : r !== false;
}

window.addEventListener('keydown', e => {
  if (e.defaultPrevented) return; // a widget (palette / layer / timeline group) already handled it
  const k = e.key, ctrl = e.ctrlKey || e.metaKey, kind = focusKind(e.target), onView = e.target === view;
  const c = { k, ctrl, kind, onView, lk: k.length === 1 ? k.toLowerCase() : k, free: false };
  if (modalIsOpen()) { modalKeys(e, c); return; }
  if (documentChord(e, c) || nativeKey(e, c)) return;
  c.free = isFree(e, c);
  const handled = shortcut(e, c);
  if (handled === STOP) return;
  if (handled || blocksTypeAhead(e, c)) e.preventDefault(); // in a select this also stops the letter from type-ahead-changing it (OSH-05)
});
window.addEventListener('keyup', e => { if (e.key === ' ') { KC.spaceHeld = false; kcEndRun(); Vp.spaceDown = false; if (!Vp.drag) view.style.cursor = 'crosshair'; } });
