/** Selection copy, floating paste, commit and cancel. */
import { doOp } from './do-op.js';
import { render } from './render-queue.js';
import { Cur, curCel, curFrameId, doc } from './state/context.js';
import { Sel } from './state/selection.js';

export function inRect(r, x, y) { return r && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h; }
export function copyTags(r) { const d = doc(), t = d.tags[Cur.layer + ':' + curFrameId()], out = []; for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) { const x = r.x + i, y = r.y + j; out.push(x >= 0 && y >= 0 && x < d.width && y < d.height ? t[y * d.width + x] : 0); } return out; }
export function copyRegion(r) { const d = doc(), cel = curCel(), data = []; for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) { const x = r.x + i, y = r.y + j; data.push(x >= 0 && y >= 0 && x < d.width && y < d.height ? cel[y * d.width + x] : 0); } return data; }
export function commitFloating() {
  const f = Sel.floating; if (!f) return; Sel.floating = null;
  const ops = [];
  if (f.src) ops.push({ op: 'clear_rect', layer: Cur.layer, frame: curFrameId(), ...f.src });
  ops.push({ op: 'paste', layer: Cur.layer, frame: curFrameId(), x: f.x, y: f.y, w: f.w, h: f.h, data: f.data, ...(f.tags && f.tags.some(v => v) ? { tags: f.tags } : {}) });
  const moved = !f.src || f.src.x !== f.x || f.src.y !== f.y;
  if (moved) doOp(ops.length === 1 ? ops[0] : { op: 'batch', ops });
  Sel.sel = { x: f.x, y: f.y, w: f.w, h: f.h }; render();
}
export function cancelFloating() { if (Sel.floating) { const f = Sel.floating; Sel.floating = null; Sel.sel = f.src ? { ...f.src } : null; render(); } }

