/** Multi-cel transform op handlers (flip, rotate): return [[key, writes], ...]. Mixed into OPS (`this` is Core). */
import { LIMITS } from '@osh/format/limits';
import { coord, fail, intArg, isPlainObj } from '@osh/format/validate';

/* ---------- op handlers (validate everything before mutating) ---------- */
export function targetRect(op, d) {
  if (op.rect === undefined) return { x: 0, y: 0, w: d.width, h: d.height };
  const r = op.rect; if (!isPlainObj(r)) fail('bad_arg', 'rect must be {x,y,w,h}');
  const x = coord(r.x, 'rect.x'), y = coord(r.y, 'rect.y'), w = intArg(r.w, 'rect.w', 1, LIMITS.maxSize), h = intArg(r.h, 'rect.h', 1, LIMITS.maxSize);
  return { x, y, w, h };
}
export function scopeKeys(op, d) {
  const scope = op.scope === undefined ? 'cel' : op.scope;
  if (scope === 'cel') return [op.layer + ':' + op.frame];
  if (scope === 'frame') return d.layers.map(l => l.id + ':' + op.frame);
  if (scope === 'layer') return d.frames.map(f => op.layer + ':' + f.id);
  fail('bad_arg', 'scope must be cel, frame or layer');
}
export function clampRect(r, d) { const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y), x1 = Math.min(d.width, r.x + r.w), y1 = Math.min(d.height, r.y + r.h); return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null; }

const ROTATE_DIRS = ['cw', 'ccw', '180'];
/** Source index for rotated-block pixel (i, j) of rectangle r. */
function rotSource(dir, r, d, ij) {
  const [i, j] = ij, src = (a, b) => (r.y + b) * d.width + r.x + a;
  if (dir === 'cw') return src(j, r.h - 1 - i);
  if (dir === 'ccw') return src(r.w - 1 - j, i);
  return src(r.w - 1 - i, r.h - 1 - j);
}
/** Writes for one cel: clear the selection, then stamp the rotated block (size W×H at nx, ny) clipped to the canvas.
 *  Outside the selection, transparent pixels of the rotated block are skipped, so neighbours are only covered by actual
 *  rotated content (N2). */
function rotateCel(rot, key) {
  const { d, r, dir, W, H, nx, ny } = rot, cel = d.cels[key], tags = d.tags[key], out = [];
  const inSel = (x, y) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
  for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) out.push([r.x + i, r.y + j, 0]);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = nx + i, y = ny + j; if (x < 0 || y < 0 || x >= d.width || y >= d.height) continue;
    const si = rotSource(dir, r, d, [i, j]);
    if (cel[si] === 0 && !inSel(x, y)) continue;
    out.push([x, y, cel[si], tags[si]]);
  }
  return [key, out];
}

/** Mixin: `this` is the composed host object. @type {Record<string, any>} */
export const transformOps = {
  // --- multi-cel transforms: return [[key, writes], ...] ---
  flip(op) {
    const d = this.doc; if (op.axis !== 'h' && op.axis !== 'v') fail('bad_arg', 'axis must be "h" or "v"');
    const r = clampRect(targetRect(op, d), d); if (!r) return [];
    return scopeKeys(op, d).map(key => { const cel = d.cels[key], tags = d.tags[key], out = [];
      for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) { const sx = op.axis === 'h' ? r.w - 1 - i : i, sy = op.axis === 'v' ? r.h - 1 - j : j, si = (r.y + sy) * d.width + r.x + sx; out.push([r.x + i, r.y + j, cel[si], tags[si]]); }
      return [key, out]; });
  },
  rotate(op) {
    const d = this.doc, dir = op.dir === undefined ? 'cw' : op.dir; if (!ROTATE_DIRS.includes(dir)) fail('bad_arg', 'dir must be cw, ccw or 180');
    const r = clampRect(targetRect(op, d), d); if (!r) return [];
    if (dir !== '180' && op.rect === undefined && d.width !== d.height) fail('not_square', 'rotating a whole non-square canvas by 90° needs a square selection (use rect)');
    const W = dir === '180' ? r.w : r.h, H = dir === '180' ? r.h : r.w, nx = r.x + Math.floor((r.w - W) / 2), ny = r.y + Math.floor((r.h - H) / 2);
    const rot = { d, r, dir, W, H, nx, ny };
    return scopeKeys(op, d).map(key => rotateCel(rot, key));
  },
};
