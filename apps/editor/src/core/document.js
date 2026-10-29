/** New blank documents. */
import { LIMITS } from '@osh/format/limits';
import { fail, intArg, normHex, own } from '@osh/format/validate';
import { DEFAULT_PALETTE, PALETTES } from '@osh/palette';

export function makeDoc(w, h, paletteName) {
  w = intArg(w, 'width', LIMITS.minSize, LIMITS.maxSize); h = intArg(h, 'height', LIMITS.minSize, LIMITS.maxSize);
  if (paletteName !== undefined && !own(PALETTES, paletteName)) fail('bad_arg', 'unknown palette ' + JSON.stringify(String(paletteName).slice(0, 40)));
  const p = PALETTES[paletteName || DEFAULT_PALETTE];
  const doc = { width: w, height: h, palette: [null, ...p.colors.map(normHex)], layers: [{ id: 'L1', name: 'Layer 1', visible: true, opacity: 1 }],
    frames: [{ id: 'F1' }], cels: Object.create(null), animations: [], nextId: 2 };
  doc.cels['L1:F1'] = new Uint8Array(w * h); doc.tags = Object.create(null); doc.tags['L1:F1'] = new Uint8Array(w * h);
  return doc;
}
