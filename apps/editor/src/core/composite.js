/** Frame compositing to RGBA. */
import { hexToRgb } from '@osh/format/validate';

/** Index c at (x, y) with the floating selection fl applied: its source rectangle is lifted (0), its pixels drawn on top. */
function withFloating(fl, x, y, c) {
  const s = fl.src;
  if (s && x >= s.x && y >= s.y && x < s.x + s.w && y < s.y + s.h) c = 0;
  const fx = x - fl.x, fy = y - fl.y;
  if (fx >= 0 && fy >= 0 && fx < fl.w && fy < fl.h) { const v = fl.data[fy * fl.w + fx]; if (v) c = v; }
  return c;
}
/** Palette index of pixel i of one layer: the cel, then the floating selection, then the overlay. */
function layerIndexAt(src, i) {
  let c = src.cel[i];
  if (src.fl) c = withFloating(src.fl, i % src.w, (i / src.w) | 0, c);
  if (src.ov && src.ov[i] >= 0) c = src.ov[i];
  return c;
}
/** "Over" blend of rgb at alpha a into out at byte offset o. */
function blendOver(out, o, rgb, a) {
  const da = out[o + 3] / 255, na = a + da * (1 - a);
  for (let k = 0; k < 3; k++) out[o + k] = (rgb[k] * a + out[o + k] * da * (1 - a)) / na;
  out[o + 3] = na * 255;
}
function layerSource(doc, l, f, opts) {
  return {
    w: doc.width, cel: doc.cels[l.id + ':' + f.id], a: opts.onlyLayer ? 1 : l.opacity,
    ov: opts.overlay && opts.overlay.layer === l.id ? opts.overlay.data : null,
    fl: opts.floating && opts.floating.layer === l.id ? opts.floating : null,
  };
}

/** Composite a frame to RGBA. opts: {overlay:{layer,data:Int16Array(-1=none)}, floating:{layer,x,y,w,h,data,src}, layerFilter} */
export function compositeRGBA(doc, frameIdx, opts = {}) {
  const w = doc.width, h = doc.height, out = new Uint8ClampedArray(w * h * 4), f = doc.frames[frameIdx];
  const pal = doc.palette.map(c => c ? hexToRgb(c) : null);
  for (const l of doc.layers) {
    if (opts.onlyLayer ? l.id !== opts.onlyLayer : !l.visible) continue;
    const src = layerSource(doc, l, f, opts);
    for (let i = 0; i < w * h; i++) {
      const c = layerIndexAt(src, i);
      if (!c || !pal[c]) continue;
      blendOver(out, i * 4, pal[c], src.a);
    }
  }
  return out;
}
