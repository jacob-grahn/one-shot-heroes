/** Pointer input on the canvas. */
import { view } from './canvases.js';
import { DRAW_TOOLS } from './defs.js';
import { doOp, layerHiddenBlock } from './do-op.js';
import { mirrorShapeOps } from './mirror.js';
import { drawPreview } from './preview.js';
import { render } from './render-queue.js';
import { commitFloating, copyRegion, copyTags, inRect } from './selection.js';
import { Cur, curFrameId, doc } from './state/context.js';
import { Gesture } from './state/gesture.js';
import { KC } from './state/key-cursor.js';
import { Paint } from './state/paint.js';
import { Sel } from './state/selection.js';
import { Tool } from './state/tool.js';
import { Vp } from './state/viewport.js';
import { addFreePoint, pickAt, rebuildStrokeOverlay, shapeOp, strokePixels } from './stroke.js';
import { screenToPx, setZoom, zoomStep } from './zoom.js';

view.addEventListener('contextmenu', e => e.preventDefault());
const SHAPE_TOOLS = ['pencil', 'eraser', 'fill', 'line', 'rect', 'ellipse'];
function startFree(e, p) {
  Gesture.stroke = { kind: 'free', pts: [], color: p.tool === 'eraser' ? 0 : p.color, size: Tool.size };
  if (e.shiftKey && Gesture.lastPt) { Gesture.stroke.pts = [Gesture.lastPt.slice()]; addFreePoint(p.x, p.y); } else addFreePoint(p.x, p.y);
  rebuildStrokeOverlay();
}
function startShape(e, p) { Gesture.stroke = { kind: p.tool, start: [p.x, p.y], end: [p.x, p.y], color: p.color, shift: e.shiftKey }; rebuildStrokeOverlay(); }
function startFill(e, { x, y, color }) {
  const d = doc(); if (x < 0 || y < 0 || x >= d.width || y >= d.height) return;
  doOp(mirrorShapeOps({ op: 'fill', layer: Cur.layer, frame: curFrameId(), x, y, color, contiguous: Tool.contiguous })); Vp.drag = null;
}
function startPick(e, { x, y }) { pickAt(x, y, e.button, true); Vp.drag.button = e.button; }
function startSelect(e, { x, y }) {
  if (Sel.floating && inRect(Sel.floating, x, y)) { Vp.drag = { kind: 'movefloat', sx: x, sy: y, fx: Sel.floating.x, fy: Sel.floating.y }; return; }
  if (Sel.sel && inRect(Sel.sel, x, y)) {
    Sel.floating = { ...Sel.sel, data: copyRegion(Sel.sel), src: e.altKey ? null : { ...Sel.sel }, tags: copyTags(Sel.sel) };
    Vp.drag = { kind: 'movefloat', sx: x, sy: y, fx: Sel.sel.x, fy: Sel.sel.y }; return;
  }
  commitFloating(); Sel.sel = null; Vp.drag = { kind: 'select', sx: x, sy: y };
}
/** What a press does with each tool. */
const START = { pencil: startFree, eraser: startFree, line: startShape, rect: startShape, ellipse: startShape, fill: startFill, picker: startPick, select: startSelect };
function startTool(e, p) {
  if (DRAW_TOOLS.includes(p.tool) && layerHiddenBlock()) { Vp.drag = null; render(); return; }
  Vp.drag = { kind: p.tool };
  if (p.tool !== 'select' && Sel.floating) commitFloating();
  if (Object.hasOwn(START, p.tool)) START[p.tool](e, p);
  render();
}
view.addEventListener('pointerdown', e => {
  KC.viaPointer = document.activeElement !== view; KC.kbdFocus = false; if (KC.on) { KC.on = false; KC.anchor = null; } // a click hands arrows back to frame navigation until the next keyboard focus
  view.setPointerCapture(e.pointerId);
  const [x, y] = screenToPx(e.clientX, e.clientY);
  if (e.button === 1 || Vp.spaceDown) { Vp.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, px: Vp.panX, py: Vp.panY }; view.style.cursor = 'grabbing'; e.preventDefault(); return; }
  if (e.button !== 0 && e.button !== 2) return;
  const color = e.button === 2 ? Paint.secondary : Paint.primary;
  const tool = e.altKey && SHAPE_TOOLS.includes(Tool.tool) ? 'picker' : Tool.tool;
  startTool(e, { x, y, color, tool });
});
function dragSelect(dr, x, y) {
  const d = doc(), ax = Math.max(0, Math.min(dr.sx, x)), ay = Math.max(0, Math.min(dr.sy, y)), bx = Math.min(d.width - 1, Math.max(dr.sx, x)), by = Math.min(d.height - 1, Math.max(dr.sy, y));
  Sel.sel = bx >= ax && by >= ay ? { x: ax, y: ay, w: bx - ax + 1, h: by - ay + 1 } : null; render();
}
function dragStroke(e, x, y) {
  if (Gesture.stroke.kind === 'free') addFreePoint(x, y); else { Gesture.stroke.end = [x, y]; Gesture.stroke.shift = e.shiftKey; }
  rebuildStrokeOverlay();
}
function dragOther(dr, x, y) {
  if (dr.kind === 'picker') pickAt(x, y, dr.button);
  else if (dr.kind === 'select') dragSelect(dr, x, y);
  else if (dr.kind === 'movefloat') { Sel.floating.x = dr.fx + x - dr.sx; Sel.floating.y = dr.fy + y - dr.sy; render(); }
}
view.addEventListener('pointermove', e => {
  const [x, y] = screenToPx(e.clientX, e.clientY); Vp.hover = [x, y];
  const dr = Vp.drag;
  if (!dr) render();
  else if (dr.kind === 'pan') { Vp.panX = dr.px + e.clientX - dr.sx; Vp.panY = dr.py + e.clientY - dr.sy; render(); }
  else if (Gesture.stroke) dragStroke(e, x, y);
  else dragOther(dr, x, y);
});
function commitFreeStroke(st) {
  const d = doc(), seen = new Map();
  Gesture.stroke = st;
  for (const [x, y, c] of strokePixels()) if (x >= 0 && y >= 0 && x < d.width && y < d.height) seen.set(y * d.width + x, [x, y, c]);
  Gesture.stroke = null;
  if (seen.size) doOp({ op: 'set_pixels', layer: Cur.layer, frame: curFrameId(), pixels: [...seen.values()] });
  Gesture.lastPt = st.pts[st.pts.length - 1];
}
export function endDrag() {
  const dr = Vp.drag; Vp.drag = null; view.style.cursor = Vp.spaceDown ? 'grab' : 'crosshair';
  if (!dr) return;
  const st = Gesture.stroke; Gesture.stroke = null;
  if (st && st.kind === 'free') commitFreeStroke(st);
  else if (st) { Gesture.stroke = st; const op = shapeOp(); Gesture.stroke = null; doOp(op); Gesture.lastPt = st.end; }
  render();
}
view.addEventListener('pointerup', endDrag);
view.addEventListener('pointercancel', endDrag);
view.addEventListener('pointerleave', () => { if (!KC.on) { Vp.hover = null; render(); } });
view.addEventListener('wheel', e => { e.preventDefault(); setZoom(zoomStep(e.deltaY < 0 ? 1 : -1), e.clientX, e.clientY); }, { passive: false });
window.addEventListener('resize', () => { render(); drawPreview(); });
// R9 (Ultron nit 8): the #view box can settle after the first render at boot (a 952x551 backing in a 952x522 box at
// 1280x800 until a window resize), so re-render whenever its box changes; draw() sizes the backing from the box.
if (typeof ResizeObserver === 'function') new ResizeObserver(() => render()).observe(view);

