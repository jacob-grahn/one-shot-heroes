/** Keyboard pixel cursor and tool switching. */
import { Core } from '../core/editor-core.js';
import { stamp } from '../core/raster.js';
import { announce } from './announce.js';
import { view } from './canvases.js';
import { DRAW_TOOLS } from './defs.js';
import { doOp, layerHiddenBlock } from './do-op.js';
import { $ } from './dom.js';
import { mirrorShapeOps, mirrorXY } from './mirror.js';
import { render } from './render-queue.js';
import { commitFloating, copyRegion, copyTags } from './selection.js';
import { Cur, curCel, curFrameId, doc } from './state/context.js';
import { Gesture } from './state/gesture.js';
import { KC, clampPx } from './state/key-cursor.js';
import { Paint } from './state/paint.js';
import { Sel } from './state/selection.js';
import { Tool } from './state/tool.js';
import { Vp } from './state/viewport.js';
import { pickAt, shapeOp } from './stroke.js';

/* ---------- keyboard ---------- */
export const KEYMAP = [
  ['B', 'Pencil'], ['E', 'Eraser'], ['G', 'Fill (Shift+G: toggle contiguous)'], ['I', 'Eyedropper (or Alt+click)'], ['L', 'Line'], ['U', 'Rectangle'], ['Shift+U', 'Ellipse'], ['M', 'Rectangular selection'],
  ['Shift+click', 'Straight line from last point'], ['Shift (drag)', 'Snap 45° / square'], ['[ / ]', 'Brush size'], ['X', 'Swap colors'], ['Right click', 'Draw with secondary'],
  ['Ctrl+Z', 'Undo (also brings back a sprite replaced by New / Open / Load example)'], ['Ctrl+Shift+Z / Ctrl+Y', 'Redo'], ['Ctrl+A / Ctrl+D', 'Select all / deselect'], ['Ctrl+C / X / V', 'Copy / cut / paste'], ['Delete', 'Clear selection'], ['Alt+drag selection', 'Move a copy'], ['Enter / Esc', 'Drop / cancel floating selection'],
  ['Arrows (with a selection)', 'Nudge the selection 1 px (Shift: 8 px)'],
  ['Tab to the canvas, then arrows', 'Move the keyboard pixel cursor (Shift: 8 px)'], ['Enter / Space (canvas focused)', 'Use the current tool at the cursor; hold Space while moving to paint'], ['Backspace (canvas focused)', 'Erase at the cursor'],
  ['Space+drag / Middle drag', 'Pan'], ['Wheel / + / -', 'Zoom'], ['0', 'Fit to view'], ["Ctrl+'", 'Toggle grid'], ['F3', 'Onion skin'], ['T', 'Tile preview'], ['H', 'Toggle horizontal mirror drawing'], ['Shift+H / Shift+V', 'Flip horizontal / vertical'], ['Shift+R', 'Rotate 90° clockwise'], ['Ctrl+Alt+N', 'New sprite'],
  ['Alt+N', 'Duplicate frame'], ['Shift+N', 'New layer'], ['← → or , .', 'Previous / next frame'], ['Home / End', 'First / last frame'], ['P', 'Play / pause preview'], ['Ctrl+S / Ctrl+O', 'Save / open JSON (also from text fields)'], ['?', 'This help'],
  ['In palette, layers, timeline', 'Arrows move, Enter/Space pick (Shift+Enter: secondary colour / frame range), F2 renames'],
];
view.addEventListener('focus', () => { KC.kbdFocus = !KC.viaPointer; KC.viaPointer = false; if (KC.kbdFocus) kcActivate(); });
view.addEventListener('blur', () => { KC.kbdFocus = false; KC.spaceHeld = false; kcEndRun(); if (KC.on) { KC.on = false; KC.anchor = null; Vp.hover = null; render(); } });
view.addEventListener('pointermove', () => { if (KC.on && !KC.spaceHeld) { KC.on = false; KC.anchor = null; } }, true);
export function kcActivate() {
  const d = doc(); if (!d) return; KC.on = true;
  const inside = p => p && p[0] >= 0 && p[1] >= 0 && p[0] < d.width && p[1] < d.height, dims = d.width + 'x' + d.height;
  if (inside(KC.pos) && KC.posDims === dims) Vp.hover = KC.pos.slice(); // OSH-23: back where the keyboard left it (cleared by New / Open / a resize)
  else if (!inside(Vp.hover)) Vp.hover = [d.width >> 1, d.height >> 1];  // first time: centre (or where the mouse is)
  kcRemember(); kcAnnounce(); render();
}
/** UX-N2: skip links (first Tab stops) jump straight to the canvas (keyboard cursor on) or the current palette swatch. */
$('#skipCanvas').onclick = e => { e.preventDefault(); view.focus(); view.scrollIntoView({ block: 'nearest' }); };
$('#skipPalette').onclick = e => { e.preventDefault(); const sw = $('#palette [tabindex="0"]') || $('#palette [tabindex]'); if (sw) { sw.focus(); sw.scrollIntoView({ block: 'nearest' }); } };
/** OSH-32: after the document size changes, keep the keyboard cursor (and its remembered spot / line anchor) on the canvas. */
export function kcClamp() {
  const d = doc(); if (!d) return; const dims = d.width + 'x' + d.height, cl = p => [clampPx(p[0], d.width), clampPx(p[1], d.height)];
  const out = p => p && (p[0] >= d.width || p[1] >= d.height || p[0] < 0 || p[1] < 0);
  // only while the canvas has keyboard focus: otherwise a size change re-centres the cursor on the next focus (OSH-23)
  if (KC.on && KC.pos && KC.posDims !== dims) { KC.pos = cl(KC.pos); KC.posDims = dims; }
  if (KC.anchor && out(KC.anchor)) KC.anchor = cl(KC.anchor);
  if (KC.on && out(Vp.hover)) { Vp.hover = cl(Vp.hover); kcRemember(); kcAnnounce(); }
}
export function kcRemember() { const d = doc(); KC.pos = Vp.hover.slice(); KC.posDims = d.width + 'x' + d.height; }
/** UX-N1: a Space-held keyboard stroke is one undo step, like a mouse stroke. Its ops are applied live (so the canvas,
 *  thumbnails and announcements stay exact); when Space is released they are merged into a single set_pixels op, if they
 *  are still the newest entries in the log (nothing else, e.g. an AI op, came in between). */
export function kcRunOp() { const r = KC.run; if (!r) return; const e = Core.log[Core.cursor - 1]; if (e && !r.entries.includes(e)) r.entries.push(e); }
export function kcEndRun() {
  const r = KC.run; KC.run = null; if (!r || r.entries.length < 2) return;
  const n = r.entries.length, tail = Core.log.slice(Core.cursor - n, Core.cursor);
  if (Core.cursor !== Core.log.length || tail.length !== n || tail.some((e, i) => e !== r.entries[i])) return;
  const ops = r.entries.map(e => e.op);
  if (ops.some(o => o.op !== 'set_pixels' || o.layer !== ops[0].layer || o.frame !== ops[0].frame)) return;
  const d = doc(), px = new Map(); for (const o of ops) for (const p of o.pixels) px.set(p[1] * d.width + p[0], [p[0], p[1], p[2]]);
  for (let i = 0; i < n; i++) Core.undo();
  doOp({ op: 'set_pixels', layer: ops[0].layer, frame: ops[0].frame, pixels: [...px.values()] });
}
export function kcAnnounce(extra) {
  const d = doc(), [x, y] = Vp.hover, v = curCel()[y * d.width + x];
  announce(`x ${x}, y ${y}: ${v ? 'colour ' + v : 'empty'}` + (KC.anchor ? `; start point ${KC.anchor[0]}, ${KC.anchor[1]}` : '') + (extra ? '. ' + extra : ''));
}
export function kcMove(dx, dy) {
  const d = doc(); if (!KC.on) kcActivate();
  const from = Vp.hover.slice(), to = [clampPx(from[0] + dx, d.width), clampPx(from[1] + dy, d.height)];
  if (KC.spaceHeld && ['pencil', 'eraser'].includes(Tool.tool)) { // OSH-35: a Shift jump (8 px) paints every pixel on the way, like a mouse drag
    const n = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
    for (let i = 1; i <= n; i++) { Vp.hover = [from[0] + Math.sign(to[0] - from[0]) * Math.min(i, Math.abs(to[0] - from[0])), from[1] + Math.sign(to[1] - from[1]) * Math.min(i, Math.abs(to[1] - from[1]))]; kcApply(false, true); }
    Vp.hover = to; kcRemember(); if (!n) kcAnnounce(); else kcAnnounce('Painted');
  } else { Vp.hover = to; kcRemember(); kcAnnounce(); }
  render();
}
function kcPaint(p) {
  const { d, x, y, tool } = p, c = tool === 'eraser' ? 0 : Paint.primary, px = new Map();
  for (const pt of stamp(x, y, Tool.size)) for (const [mx, my] of mirrorXY(pt[0], pt[1])) if (mx >= 0 && my >= 0 && mx < d.width && my < d.height) px.set(my * d.width + mx, [mx, my, c]);
  if (px.size) { doOp({ op: 'set_pixels', layer: Cur.layer, frame: p.fr, pixels: [...px.values()] }); if (KC.spaceHeld) kcRunOp(); }
  Gesture.lastPt = [x, y]; if (!p.quiet) kcAnnounce(tool === 'eraser' ? 'Erased' : 'Painted');
}
function kcFill({ x, y, fr }) { doOp(mirrorShapeOps({ op: 'fill', layer: Cur.layer, frame: fr, x, y, color: Paint.primary, contiguous: Tool.contiguous })); kcAnnounce('Filled'); }
function kcPick({ x, y }) { pickAt(x, y, 0, true); }
function kcShape({ x, y, tool }) {
  if (!KC.anchor) { KC.anchor = [x, y]; kcAnnounce('Start point set. Move, then press Enter again to draw; Esc cancels'); return; }
  Gesture.stroke = { kind: tool, start: KC.anchor, end: [x, y], color: Paint.primary, shift: false }; const op = shapeOp(); Gesture.stroke = null; KC.anchor = null; doOp(op); Gesture.lastPt = [x, y]; kcAnnounce('Drawn');
}
function kcSelect({ x, y }) {
  if (!KC.anchor) { commitFloating(); Sel.sel = null; KC.anchor = [x, y]; kcAnnounce('Selection corner set. Move, then press Enter again'); return; }
  const [ax, ay] = KC.anchor; KC.anchor = null; Sel.sel = { x: Math.min(ax, x), y: Math.min(ay, y), w: Math.abs(x - ax) + 1, h: Math.abs(y - ay) + 1 }; announce(`Selected ${Sel.sel.w}×${Sel.sel.h} at ${Sel.sel.x}, ${Sel.sel.y}. Arrows move it, Delete clears it, Esc deselects`);
}
/** What Enter / Space does at the keyboard cursor with each tool. */
const KC_ACTIONS = { pencil: kcPaint, eraser: kcPaint, fill: kcFill, picker: kcPick, line: kcShape, rect: kcShape, ellipse: kcShape, select: kcSelect };
export function kcApply(erase, quiet) {
  if (!KC.on) kcActivate();
  const d = doc(), [x, y] = Vp.hover, tool = erase ? 'eraser' : Tool.tool, fr = curFrameId();
  if (DRAW_TOOLS.includes(tool) && layerHiddenBlock()) return;
  if (Object.hasOwn(KC_ACTIONS, tool)) KC_ACTIONS[tool]({ d, x, y, tool, fr, quiet });
  render();
}
/** U14: arrows nudge the selection (or floating paste); each nudge is one undoable op. */
export function nudge(dx, dy) {
  if (!Sel.floating) { const r = Sel.sel; Sel.floating = { ...r, data: copyRegion(r), src: { ...r }, tags: copyTags(r) }; }
  Sel.floating.x += dx; Sel.floating.y += dy; commitFloating();
  announce(`Selection moved to ${Sel.sel.x}, ${Sel.sel.y}`);
}

/** What kind of control has focus decides which keys belong to it (OSH-01/05/07/10). */
const BUTTON_ROLES = ['button', 'gridcell'];
export function focusKind(t) {
  if (!t || !t.tagName) return 'none';
  if (t.isContentEditable || t.tagName === 'TEXTAREA') return 'text';
  if (t.tagName === 'INPUT') return inputKind(t.type);
  if (t.tagName === 'SELECT') return 'select';
  if (t.tagName === 'BUTTON' || t.tagName === 'A' || BUTTON_ROLES.includes(t.getAttribute('role'))) return 'button';
  return 'other';
}
const inputKind = ty => (ty === 'checkbox' || ty === 'radio' ? 'toggle' : ty === 'range' ? 'range' : 'text');
