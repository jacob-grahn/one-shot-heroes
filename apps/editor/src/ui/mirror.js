/** Mirror-drawing helpers. */
import { doc } from './state/context.js';
import { Opts } from './state/options.js';

/* ---------- mirror helpers ---------- */
export function mirrorXY(x, y) {
  const d = doc(), out = [[x, y]];
  if (Opts.mirH) out.push([d.width - 1 - x, y]);
  if (Opts.mirV) out.push([x, d.height - 1 - y]);
  if (Opts.mirH && Opts.mirV) out.push([d.width - 1 - x, d.height - 1 - y]);
  return out;
}
export function mirrorShapeOps(op) {
  const d = doc(), W = d.width - 1, H = d.height - 1, ops = [op];
  const off = op.op === 'line' && op.size === 2 ? 1 : 0; // a size-2 stamp covers x..x+1, so its mirror starts one pixel further left/up
  const fx = o => o.op === 'fill' ? { ...o, x: W - o.x } : { ...o, x0: W - o.x0 - off, x1: W - o.x1 - off };
  const fy = o => o.op === 'fill' ? { ...o, y: H - o.y } : { ...o, y0: H - o.y0 - off, y1: H - o.y1 - off };
  if (Opts.mirH) ops.push(fx(op));
  if (Opts.mirV) ops.push(fy(op));
  if (Opts.mirH && Opts.mirV) ops.push(fy(fx(op)));
  return ops.length === 1 ? op : { op: 'batch', ops };
}
