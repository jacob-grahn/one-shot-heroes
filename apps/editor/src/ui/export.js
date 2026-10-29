/** Downloads, scaled PNG export and sprite sheets. */
import { compositeRGBA } from '../core/composite.js';
import { Core } from '../core/editor-core.js';
import { $, el } from './dom.js';
import { doc } from './state/context.js';
import { FORMAT_VERSION } from '@osh/format/limits';
import { FPS, FRAME_MS, animSequence } from '@osh/timing';

export function download(name, data, type) { const b = data instanceof Blob ? data : new Blob([data], { type }); const a = el('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
export function dataURLtoBlob(u) { const [h, b] = u.split(','); const bin = atob(b), arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); return new Blob([arr], { type: h.split(':')[1].split(';')[0] }); }
export const fname = () => ($('#docName').value || 'sprite').replace(/[^\w-]+/g, '_');
/** U5: export scale (nearest-neighbour), capped so the output stays ≤ 8192 px. */
export function exportScale(w, h) { const want = +($('#expScale') ? $('#expScale').value : 1) || 1; let sc = want; while (sc > 1 && (w * sc > 8192 || h * sc > 8192)) sc >>= 1; exportScale.want = want; return sc; }
/** Requested scale from the last exportScale() call. @type {number | undefined} */
exportScale.want;
/** OSH-28: say why the scale went down. */
export const capNote = (sc, w, h) => sc < exportScale.want ? `; ${exportScale.want}× would be ${w * exportScale.want}×${h * exportScale.want} px, over the 8192 px limit, so it was exported at ${sc}×` : '';
/** OSH-25: the scale is part of the file name (hero-4x.png), like Export PNG, so a 1× and a 4× export never collide. */
export const scaledName = sc => fname() + (sc > 1 ? '-' + sc + 'x' : '');

/* ---------- export ---------- */
export function frameCanvas(i, scale = 1) { const d = doc(), c = document.createElement('canvas'); c.width = d.width; c.height = d.height; c.getContext('2d').putImageData(new ImageData(compositeRGBA(d, i), d.width, d.height), 0, 0); if (scale === 1) return c; const s = document.createElement('canvas'); s.width = d.width * scale; s.height = d.height * scale; const x = s.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(c, 0, 0, s.width, s.height); return s; }
/** Sprite sheet + JSON. The JSON keeps the osh-sprite-sheet fields and is also an Aseprite "JSON Array" export (U6):
 *  frames[].frame / duration and meta.frameTags, which Godot / Unity / Phaser Aseprite importers read. */
/** R7-MN4: the one sprite-sheet layout rule, shared by Export Sheet and pixelEditor.renderSheet. Columns are picked at 1×:
 *  8 frames per row, or more (up to 8192 / frame width) when 8 per row would make the sheet taller than 8192 px. Every
 *  scale is then the 1× sheet scaled up, and maxScale is the largest scale (≤ 8) with both sides ≤ 8192 px; 0 means the
 *  frames can't fit even at 1× (maxFrames of this size would). */
export const SHEET_MAX = 8192;
export function sheetLayout() {
  const d = doc(), n = d.frames.length, w = d.width, h = d.height; let cols = Math.min(n, 8);
  if (Math.ceil(n / cols) * h > SHEET_MAX) cols = Math.max(cols, Math.min(n, Math.floor(SHEET_MAX / w)));
  const rows = Math.ceil(n / cols);
  return { n, w, h, cols, rows, maxScale: Math.min(8, Math.floor(SHEET_MAX / (cols * w)), Math.floor(SHEET_MAX / (rows * h))), maxFrames: Math.floor(SHEET_MAX / w) * Math.floor(SHEET_MAX / h) };
}
/** '' when the sheet fits at this scale, else the reason (same words for the UI toast and the API error). */
export function sheetLimitMsg(scale = 1) {
  const L = sheetLayout(), sw = L.cols * L.w, sh = L.rows * L.h;
  if (L.maxScale < 1) return `the sprite sheet can't fit: ${L.n} frames of ${L.w}×${L.h} px need ${sw}×${sh} px even at 1×, over the 8192 px limit per side (at most ${L.maxFrames} frames of this size fit in one sheet; export the frames as PNGs or split the animation)`;
  if (scale > L.maxScale) return `sprite sheet would be ${sw * scale}×${sh * scale} px at scale ${scale}; the limit is 8192 px per side (the largest scale that fits is ${L.maxScale})`;
  return '';
}
/** Draws every frame into the sheet canvas and returns the per-frame JSON entries (osh fields + Aseprite fields). */
function drawSheetFrames({ d, cols, scale, ctx }) {
  const fw = d.width * scale, fh = d.height * scale, name = fname(), dur = Math.round(FRAME_MS);
  return d.frames.map((f, i) => {
    const fx = (i % cols) * fw, fy = Math.floor(i / cols) * fh;
    ctx.drawImage(frameCanvas(i, scale), fx, fy);
    return {
      id: f.id, x: fx, y: fy, w: fw, h: fh, // osh fields
      filename: name + ' ' + i + '.png', frame: { x: fx, y: fy, w: fw, h: fh }, rotated: false, trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: fw, h: fh }, sourceSize: { w: fw, h: fh }, duration: dur,
    };
  });
}
/** Fills `animations` (osh) and returns the Aseprite frameTags; animations whose frames aren't a from..to range are skipped. */
function sheetAnimations(d, animations) {
  const frameTags = [], skipped = [];
  for (const a of d.animations) {
    const seq = animSequence({ ...d, animations: [{ ...a, mode: 'loop' }] }, a.name);
    Object.defineProperty(animations, a.name, { value: { frames: seq, mode: a.mode, fps: FPS }, enumerable: true, writable: true, configurable: true });
    const contiguous = seq.length > 0 && seq.every((v, k) => v === seq[0] + k); // Aseprite tags are from..to ranges
    if (contiguous) frameTags.push({ name: a.name, from: seq[0], to: seq[seq.length - 1], direction: a.mode === 'pingpong' ? 'pingpong' : 'forward', color: '#000000ff' });
    else skipped.push(a.name);
  }
  return { frameTags, skipped };
}
/** The Aseprite "meta" block (plus oshNote when some animations couldn't become frameTags). */
function asepriteMeta({ img, size, scale, tags }) {
  const m = { app: 'One Shot Heroes Pixel Editor', version: String(FORMAT_VERSION), image: img, format: 'RGBA8888', size, scale: String(scale), frameTags: tags.frameTags, layers: [], slices: [] };
  if (tags.skipped.length) m.oshNote = 'Animations with non-contiguous frames are not Aseprite frameTags (see "animations"): ' + tags.skipped.join(', ');
  return m;
}
export function buildSheet(scale = 1) {
  const d = doc(), cols = sheetLayout().cols, rows = Math.ceil(d.frames.length / cols), c = document.createElement('canvas');
  const fw = d.width * scale, fh = d.height * scale, img = scaledName(scale) + '.png';
  c.width = cols * fw; c.height = rows * fh;
  const animations = Object.create(null); // OSH-16: an animation may be called "__proto__"
  const meta = { format: 'osh-sprite-sheet', version: 1, image: img, size: { w: c.width, h: c.height }, frameSize: { w: fw, h: fh }, scale, fps: FPS, frameDurationMs: +FRAME_MS.toFixed(3), frames: [], animations, provenance: Core.provenance() };
  meta.frames = drawSheetFrames({ d, cols, scale, ctx: c.getContext('2d') });
  const tags = sheetAnimations(d, animations);
  meta.meta = asepriteMeta({ img, size: { w: c.width, h: c.height }, scale, tags });
  return { canvas: c, meta };
}

