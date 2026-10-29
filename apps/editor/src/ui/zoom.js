/** Canvas view math: screen to pixel, zoom and pan. */
import { view } from './canvases.js';
import { $ } from './dom.js';
import { render } from './render-queue.js';
import { doc } from './state/context.js';
import { Vp } from './state/viewport.js';

/* ---------- view math ---------- */
export function screenToPx(cx, cy) {
  const r = view.getBoundingClientRect();
  return [Math.floor((cx - r.left - Vp.panX) / Vp.zoom), Math.floor((cy - r.top - Vp.panY) / Vp.zoom)];
}
export function setZoom(z, cx, cy) {
  z = Math.max(1, Math.min(64, Math.round(z)));
  const r = view.getBoundingClientRect();
  if (cx === undefined) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
  const mx = cx - r.left, my = cy - r.top, wx = (mx - Vp.panX) / Vp.zoom, wy = (my - Vp.panY) / Vp.zoom;
  Vp.zoom = z; Vp.panX = Math.round(mx - wx * z); Vp.panY = Math.round(my - wy * z);
  $('#zoomLbl').textContent = z * 100 + '%'; render();
}
export function zoomStep(dir) { const steps = [1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64]; let i = steps.findIndex(s => s >= Vp.zoom); if (i < 0) i = steps.length - 1; if (steps[i] !== Vp.zoom && dir < 0) i++; i = Math.max(0, Math.min(steps.length - 1, i + dir)); return steps[i]; }
export function fitView() {
  const r = view.getBoundingClientRect(), d = doc();
  const z = Math.max(1, Math.floor(Math.min((r.width - 40) / d.width, (r.height - 60) / d.height)));
  Vp.zoom = Math.min(z, 40); Vp.panX = Math.round((r.width - d.width * Vp.zoom) / 2); Vp.panY = Math.round((r.height - 22 - d.height * Vp.zoom) / 2);
  $('#zoomLbl').textContent = Vp.zoom * 100 + '%'; render();
}
