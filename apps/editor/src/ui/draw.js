/** Canvas rendering and the status bar. */
import { compositeRGBA } from '../core/composite.js';
import { Core } from '../core/editor-core.js';
import { dctx, docCanvas, octx, onionCanvas, putRGBA, vctx, view } from './canvases.js';
import { $ } from './dom.js';
import { Cur, curCel, doc } from './state/context.js';
import { Gesture } from './state/gesture.js';
import { KC } from './state/key-cursor.js';
import { Opts } from './state/options.js';
import { Sel } from './state/selection.js';
import { Tool } from './state/tool.js';
import { Vp } from './state/viewport.js';

let checkerPattern = null;
/** Copies RGBA pixels into a canvas, resizing it to size.width x size.height first if needed. */
export function tintedOnion(frameIdx, color) {
  const d = doc(); putRGBA(onionCanvas, octx, compositeRGBA(d, frameIdx), d);
  octx.globalCompositeOperation = 'source-atop'; octx.fillStyle = color; octx.globalAlpha = 0.55; octx.fillRect(0, 0, d.width, d.height);
  octx.globalCompositeOperation = 'source-over'; octx.globalAlpha = 1; return onionCanvas;
}
function sizeView(dpr) {
  const r = view.getBoundingClientRect();
  if (view.width !== Math.round(r.width * dpr) || view.height !== Math.round(r.height * dpr)) { view.width = Math.round(r.width * dpr); view.height = Math.round(r.height * dpr); }
  return r;
}
function ensureChecker(c) {
  if (checkerPattern) return;
  const t = document.createElement('canvas'); t.width = t.height = 16; const tc = t.getContext('2d'); tc.fillStyle = '#c9c9c9'; tc.fillRect(0, 0, 16, 16); tc.fillStyle = '#9a9a9a'; tc.fillRect(0, 0, 8, 8); tc.fillRect(8, 8, 8, 8); checkerPattern = c.createPattern(t, 'repeat');
}
function drawTiles({ c, W, H, ox, oy }) {
  c.globalAlpha = 0.45;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (i || j) { c.fillStyle = '#2a2d34'; c.fillRect(ox + i * W, oy + j * H, W, H); c.drawImage(docCanvas, ox + i * W, oy + j * H, W, H); }
  c.globalAlpha = 1;
}
function drawOnion({ c, d, W, H, ox, oy }) {
  c.globalAlpha = 0.5;
  if (Cur.frame > 0) c.drawImage(tintedOnion(Cur.frame - 1, '#ff3050'), ox, oy, W, H);
  if (Cur.frame < d.frames.length - 1) c.drawImage(tintedOnion(Cur.frame + 1, '#3080ff'), ox, oy, W, H);
  c.globalAlpha = 1;
}
function drawGrid({ c, d, z, W, H, ox, oy }) {
  c.beginPath(); c.strokeStyle = 'rgba(0,0,0,0.24)'; c.lineWidth = 1;
  for (let x = 1; x < d.width; x++) { if (x % 8) { c.moveTo(ox + x * z + 0.5, oy); c.lineTo(ox + x * z + 0.5, oy + H); } }
  for (let y = 1; y < d.height; y++) { if (y % 8) { c.moveTo(ox, oy + y * z + 0.5); c.lineTo(ox + W, oy + y * z + 0.5); } }
  c.stroke(); c.beginPath(); c.strokeStyle = 'rgba(0,0,0,0.38)';
  for (let x = 8; x < d.width; x += 8) { c.moveTo(ox + x * z + 0.5, oy); c.lineTo(ox + x * z + 0.5, oy + H); }
  for (let y = 8; y < d.height; y += 8) { c.moveTo(ox, oy + y * z + 0.5); c.lineTo(ox + W, oy + y * z + 0.5); }
  c.stroke();
}
function drawMirrorAxes({ c, W, H, ox, oy }) {
  c.save(); c.setLineDash([6, 4]); c.strokeStyle = '#ff5d8f'; c.beginPath();
  if (Opts.mirH) { c.moveTo(ox + W / 2 + 0.5, oy - 8); c.lineTo(ox + W / 2 + 0.5, oy + H + 8); }
  if (Opts.mirV) { c.moveTo(ox - 8, oy + H / 2 + 0.5); c.lineTo(ox + W + 8, oy + H / 2 + 0.5); }
  c.stroke(); c.restore();
}
function drawSelection({ c, z, ox, oy }, sel) {
  c.save(); c.lineWidth = 1; c.strokeStyle = '#000'; c.strokeRect(ox + sel.x * z + 0.5, oy + sel.y * z + 0.5, sel.w * z - 1, sel.h * z - 1);
  c.setLineDash([4, 4]); c.strokeStyle = '#fff'; c.lineDashOffset = (performance.now() / 60) % 8; c.strokeRect(ox + sel.x * z + 0.5, oy + sel.y * z + 0.5, sel.w * z - 1, sel.h * z - 1); c.restore();
}
/** OSH-30: black + white dashes, visible on any colour. */
function drawAnchor({ c, z, ox, oy }) {
  const [ax, ay] = KC.anchor; c.save(); c.lineWidth = 2; c.strokeStyle = '#000'; c.strokeRect(ox + ax * z + 1, oy + ay * z + 1, z - 2, z - 2); c.setLineDash([3, 3]); c.strokeStyle = '#fff'; c.strokeRect(ox + ax * z + 1, oy + ay * z + 1, z - 2, z - 2); c.restore();
}
const HOVER_TOOLS = ['pencil', 'eraser', 'line', 'rect', 'ellipse', 'fill', 'picker'];
const showsHover = () => Vp.hover && !Vp.drag && (KC.on || HOVER_TOOLS.includes(Tool.tool));
function drawHover({ c, z, ox, oy }) {
  const sz = ['pencil', 'eraser', 'line'].includes(Tool.tool) ? Tool.size : 1;
  const o = sz === 3 ? -1 : 0;
  c.strokeStyle = 'rgba(255,255,255,0.85)'; c.strokeRect(ox + (Vp.hover[0] + o) * z + 0.5, oy + (Vp.hover[1] + o) * z + 0.5, sz * z - 1, sz * z - 1);
  c.strokeStyle = 'rgba(0,0,0,0.6)'; c.strokeRect(ox + (Vp.hover[0] + o) * z - 0.5, oy + (Vp.hover[1] + o) * z - 0.5, sz * z + 1, sz * z + 1);
  if (KC.on) { // keyboard cursor (OSH-30): two-tone ring, a white band inside a black band, so one of them contrasts with any pixel colour
    const rx = ox + (Vp.hover[0] + o) * z, ry = oy + (Vp.hover[1] + o) * z, rw = sz * z; c.save(); c.lineWidth = 2;
    c.strokeStyle = '#000'; c.strokeRect(rx - 4, ry - 4, rw + 8, rw + 8); c.strokeStyle = '#fff'; c.strokeRect(rx - 2, ry - 2, rw + 4, rw + 4); c.restore();
  }
}
/** Sprite, tiling, checkerboard and onion skins. */
function drawSprite(g) {
  const { c, d, W, H, ox, oy } = g;
  const overlay = Gesture.stroke && Gesture.stroke.overlay ? { layer: Cur.layer, data: Gesture.stroke.overlay } : null;
  const fl = Sel.floating ? { ...Sel.floating, layer: Cur.layer } : null;
  putRGBA(docCanvas, dctx, compositeRGBA(d, Cur.frame, { overlay, floating: fl }), d);
  if (Opts.tile) drawTiles(g);
  c.save(); c.translate(ox, oy); c.fillStyle = checkerPattern; c.fillRect(0, 0, W, H); c.restore();
  if (Opts.onion && d.frames.length > 1) drawOnion(g);
  c.drawImage(docCanvas, ox, oy, W, H);
}
/** Grid, mirror axes, border, selection, keyboard anchor and hover cursor. */
function drawGuides(g) {
  const { c, z, W, H, ox, oy } = g;
  if (Opts.grid && z >= 4) drawGrid(g);
  if (Opts.mirH || Opts.mirV) drawMirrorAxes(g);
  c.strokeStyle = '#4a5263'; c.strokeRect(ox - 0.5, oy - 0.5, W + 1, H + 1);
  const sel = Sel.floating ? Sel.floating : Sel.sel;
  if (sel) drawSelection(g, sel);
  if (KC.anchor) drawAnchor(g);
  if (showsHover()) drawHover(g);
}
export function draw() {
  if (!Core.doc) return; // async boot: nothing to draw until the document is restored
  const d = doc(), dpr = window.devicePixelRatio || 1, r = sizeView(dpr);
  const c = vctx; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.imageSmoothingEnabled = false;
  c.fillStyle = '#111317'; c.fillRect(0, 0, r.width, r.height);
  const z = Vp.zoom, g = { c, d, z, W: d.width * z, H: d.height * z, ox: Vp.panX, oy: Vp.panY };
  ensureChecker(c);
  drawSprite(g);
  drawGuides(g);
  updateStatus();
}
export function updateStatus() {
  const d = doc(), h = Vp.hover, cel = curCel();
  let s = `${d.width}×${d.height}  zoom ${Vp.zoom}x  frame ${Cur.frame + 1}/${d.frames.length}  layer "${d.layers[Core.layerIndex(Cur.layer)].name}"`;
  if (h && h[0] >= 0 && h[1] >= 0 && h[0] < d.width && h[1] < d.height) s = `x ${h[0]} y ${h[1]}  idx ${cel[h[1] * d.width + h[0]]}   ` + s;
  const sel = Sel.floating || Sel.sel; if (sel) s += `  sel ${sel.w}×${sel.h} @${sel.x},${sel.y}`;
  s += `   ops ${Core.cursor}/${Core.log.length}`;
  $('#status').textContent = s;
}

/* ---------- pointer / tools ---------- */
