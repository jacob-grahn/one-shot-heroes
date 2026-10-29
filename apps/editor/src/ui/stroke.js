/** Stroke building, shape previews and the eyedropper. */
import { Core } from '../core/editor-core.js';
import { OPS } from '../core/ops.js';
import { linePts, snap45, squareEnd, stamp } from '../core/raster.js';
import { announce } from './announce.js';
import { mirrorShapeOps, mirrorXY } from './mirror.js';
import { colourName, renderPalette } from './palette-panel.js';
import { render } from './render-queue.js';
import { Cur, curCel, curFrameId, doc } from './state/context.js';
import { Gesture } from './state/gesture.js';
import { Paint } from './state/paint.js';
import { Tool } from './state/tool.js';
import { toast } from './toast.js';

export function rebuildStrokeOverlay() {
  const d = doc(), st = Gesture.stroke, ov = new Int16Array(d.width * d.height).fill(-1);
  for (const [x, y, c] of strokePixels()) if (x >= 0 && y >= 0 && x < d.width && y < d.height) ov[y * d.width + x] = c;
  st.overlay = ov; render();
}
function freePixels(st) {
  const out = [];
  for (const [x, y] of st.pts) for (const p of stamp(x, y, st.size)) for (const m of mirrorXY(p[0], p[1])) out.push([m[0], m[1], st.color]);
  return out;
}
function shapePixels() {
  const out = [], op = shapeOp(); const flat = op.op === 'batch' ? op.ops : [op];
  for (const o of flat) { const fn = OPS[o.op]; out.push(...fn.call(Core, o)); }
  return out;
}
export function strokePixels() {
  const st = Gesture.stroke;
  return st.kind === 'free' ? freePixels(st) : shapePixels();
}
export function shapeOp() {
  const st = Gesture.stroke; let [x1, y1] = st.end;
  if (st.shift) [x1, y1] = st.kind === 'line' ? snap45(st.start[0], st.start[1], x1, y1) : squareEnd(st.start[0], st.start[1], x1, y1);
  const base = { op: st.kind, layer: Cur.layer, frame: curFrameId(), x0: st.start[0], y0: st.start[1], x1, y1, color: st.color };
  if (st.kind === 'line') base.size = Tool.size; else base.filled = Tool.filled;
  return mirrorShapeOps(base);
}
export function addFreePoint(x, y) {
  const pts = Gesture.stroke.pts, last = pts[pts.length - 1];
  const seg = last ? linePts(last[0], last[1], x, y).slice(1) : [[x, y]];
  for (const p of seg) {
    pts.push(p);
    if (Tool.pixelPerfect && Gesture.stroke.size === 1 && pts.length >= 3) { // remove L-corners
      const a = pts[pts.length - 3], b = pts[pts.length - 2], c = pts[pts.length - 1];
      if ((a[0] === b[0] || a[1] === b[1]) && (c[0] === b[0] || c[1] === b[1]) && a[0] !== c[0] && a[1] !== c[1]) pts.splice(pts.length - 2, 1);
    }
  }
}
/** Colour index under (x, y): the current cel, else the topmost visible layer that has a pixel there. */
function colourAt(d, x, y) {
  const c = curCel()[y * d.width + x];
  if (c) return c;
  for (let i = d.layers.length - 1; i >= 0; i--) { const l = d.layers[i]; if (!l.visible) continue; const v = d.cels[l.id + ':' + curFrameId()][y * d.width + x]; if (v) return v; }
  return c;
}
export function pickAt(x, y, button, notify) {
  const d = doc(); if (x < 0 || y < 0 || x >= d.width || y >= d.height) return;
  const c = colourAt(d, x, y), secondary = button === 2;
  const before = secondary ? Paint.secondary : Paint.primary;
  if (secondary) Paint.secondary = c; else Paint.primary = c; renderPalette();
  pickFeedback(c, before, secondary, notify);
}
function pickFeedback(c, before, secondary, notify) {
  if (c === 0 && (notify || before !== 0)) toast('Picked transparent (index 0)' + (secondary ? ' as secondary' : ': the pencil now erases') + '. Pick a colour from the palette to draw again.'); // U9
  else if (notify) announce((secondary ? 'Secondary' : 'Primary') + ' colour ' + colourName(c));
}
