/** Op classification: pixel ops, multi-cel ops, no-op inverses, dirty frames. */

export const PIXEL_OPS = new Set(['set_pixels', 'line', 'rect', 'ellipse', 'fill', 'clear', 'clear_rect', 'paste']);
export const MULTI_OPS = new Set(['flip', 'rotate']);
export const isNoop = inv => inv.type === 'pix' ? inv.idx.length === 0 : inv.type === 'batch' ? inv.list.every(isNoop) : !!inv.noop;
export function dirtyOf(op) {
  if (op.op === 'batch') { const s = new Set(); for (const o of op.ops) { const d = dirtyOf(o); if (d === 'all') return 'all'; d.forEach(x => s.add(x)); } return s; }
  if (PIXEL_OPS.has(op.op)) return new Set([op.frame]);
  if (MULTI_OPS.has(op.op)) return op.scope === 'layer' ? 'all' : new Set([op.frame]);
  return 'all';
}
