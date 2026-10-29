/** Pixel op handlers: return writes [[x,y,idx(,tag)]] for the (layer, frame) cel. Mixed into OPS (`this` is Core). */
import { clippedLinePts, ellipsePts, rectPts, stamp } from './raster.js';
import { LIMITS } from '@osh/format/limits';
import { coord, fail, intArg } from '@osh/format/validate';

/** {x0, y0, x1, y1} of a shape op, validated in that order. */
const segOf = op => ({ x0: coord(op.x0, 'x0'), y0: coord(op.y0, 'y0'), x1: coord(op.x1, 'x1'), y1: coord(op.y1, 'y1') });
/** Non-contiguous fill: every pixel of the target index. */
function fillAll(cel, target, w, color) {
  const out = [];
  for (let i = 0; i < cel.length; i++) if (cel[i] === target) out.push([i % w, (i / w) | 0, color]);
  return out;
}
/** Contiguous (4-way) flood fill from pixel start. */
function floodFrom(cel, start, size, color) {
  const { width: w, height: h } = size, target = cel[start], out = [];
  const seen = new Uint8Array(w * h), stack = [start];
  while (stack.length) {
    const i = stack.pop(); if (seen[i] || cel[i] !== target) continue; seen[i] = 1;
    const px = i % w, py = (i / w) | 0; out.push([px, py, color]);
    if (px > 0) stack.push(i - 1); if (px < w - 1) stack.push(i + 1); if (py > 0) stack.push(i - w); if (py < h - 1) stack.push(i + w);
  }
  return out;
}
/** Validated paste geometry {x, y, w, h} (core checks the colours). */
function pasteArgs(core, op) {
  const x = coord(op.x, 'x'), y = coord(op.y, 'y'), w = intArg(op.w, 'w', 1, LIMITS.maxSize), h = intArg(op.h, 'h', 1, LIMITS.maxSize);
  if (!Array.isArray(op.data) || op.data.length !== w * h) fail('bad_arg', `paste.data must have exactly w*h = ${w * h} entries`);
  for (const c of op.data) core.checkColor(c);
  if (op.tags !== undefined && (!Array.isArray(op.tags) || op.tags.length !== w * h || !op.tags.every(t => t === 0 || t === 1))) fail('bad_arg', 'paste.tags must be w*h entries of 0/1');
  return { x, y, w, h };
}

/** Mixin: `this` is the composed host object. @type {Record<string, any>} */
export const pixelOps = {
  // --- pixel ops: return writes [[x,y,idx]] for the (layer, frame) cel ---
  set_pixels(op) {
    if (!Array.isArray(op.pixels) || op.pixels.length > LIMITS.maxPixelsPerOp) fail('bad_arg', 'pixels must be an array of [x,y,color] (≤' + LIMITS.maxPixelsPerOp + ')');
    return op.pixels.map((p, i) => { if (!Array.isArray(p) || p.length !== 3) fail('bad_arg', 'pixels[' + i + '] must be [x,y,color]'); this.checkColor(p[2]); return [coord(p[0], 'x'), coord(p[1], 'y'), p[2]]; });
  },
  line(op) {
    this.checkColor(op.color); const d = this.doc;
    const size = op.size === undefined ? 1 : Math.max(1, Math.min(3, Math.round(coord(op.size, 'size'))));
    if (op.size !== undefined) op.size = size; // log the clamped value
    const pts = clippedLinePts(segOf(op), d);
    const out = []; for (const [x, y] of pts) for (const p of stamp(x, y, size)) out.push([p[0], p[1], op.color]);
    return out;
  },
  rect(op) { this.checkColor(op.color); const d = this.doc; return rectPts(segOf(op), !!op.filled, d).map(p => [p[0], p[1], op.color]); },
  ellipse(op) { this.checkColor(op.color); const d = this.doc; return ellipsePts(segOf(op), !!op.filled, d).map(p => [p[0], p[1], op.color]); },
  fill(op, cel) {
    this.checkColor(op.color);
    const { width: w, height: h } = this.doc, x = coord(op.x, 'x'), y = coord(op.y, 'y');
    if (op.contiguous !== undefined && typeof op.contiguous !== 'boolean') fail('bad_arg', 'contiguous must be boolean');
    if (x < 0 || y < 0 || x >= w || y >= h) return [];
    if (op.contiguous === false) return fillAll(cel, cel[y * w + x], w, op.color);
    return floodFrom(cel, y * w + x, this.doc, op.color);
  },
  clear(op, cel) { const w = this.doc.width, out = []; for (let i = 0; i < cel.length; i++) if (cel[i]) out.push([i % w, (i / w) | 0, 0]); return out; },
  clear_rect(op) {
    const d = this.doc, x = coord(op.x, 'x'), y = coord(op.y, 'y'), w = coord(op.w, 'w'), h = coord(op.h, 'h');
    if (w < 1 || h < 1) fail('bad_arg', 'w and h must be ≥ 1');
    return rectPts({ x0: x, y0: y, x1: x + w - 1, y1: y + h - 1 }, true, d).map(p => [p[0], p[1], 0]);
  },
  paste(op) {
    const d = this.doc, { x, y, w, h } = pasteArgs(this, op);
    const tg = op.tags, at = op.author === 'ai' ? 1 : 0; // source tags survive the paste; an AI paste is AI regardless
    const out = [];
    for (let j = Math.max(0, -y); j < h && y + j < d.height; j++) for (let i = Math.max(0, -x); i < w && x + i < d.width; i++) {
      const c = op.data[j * w + i]; if (c === 0 && op.transparent !== false) continue; out.push(tg ? [x + i, y + j, c, tg[j * w + i] | at] : [x + i, y + j, c]);
    }
    return out;
  },
};
