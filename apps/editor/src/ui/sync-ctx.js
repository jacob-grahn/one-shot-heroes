/** Clamp the editing context to the current document and hand it to the core as the default op target. */
import { Core } from '../core/editor-core.js';
import { Cur, doc } from './state/context.js';
import { Paint } from './state/paint.js';
import { PvS } from './state/preview.js';

export function syncCtx() {
  const d = doc();
  if (Core.layerIndex(Cur.layer) < 0) Cur.layer = d.layers[d.layers.length - 1].id;
  Cur.frame = Math.max(0, Math.min(d.frames.length - 1, Cur.frame));
  if (Cur.range) Cur.range = Cur.range.map(v => Math.min(v, d.frames.length - 1));
  if (Paint.primary >= d.palette.length) Paint.primary = d.palette.length - 1;
  if (Paint.secondary >= d.palette.length) Paint.secondary = 0;
  if (PvS.pvAnim && !d.animations.some(a => a.name === PvS.pvAnim)) PvS.pvAnim = '';
  Core.ctx.layer = Cur.layer; Core.ctx.frame = Cur.frame;
}
