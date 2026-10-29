/** Cached per-frame thumbnail canvases for the timeline. */
import { compositeRGBA } from '../core/composite.js';
import { el } from './dom.js';
import { doc } from './state/context.js';

export const thumbCache = new Map();
export function frameThumb(fid, i) {
  let t = thumbCache.get(fid); const d = doc();
  if (!t || t.width !== d.width || t.height !== d.height) {
    t = el('canvas', 'checker'); t.width = d.width; t.height = d.height; t.setAttribute('aria-hidden', 'true');
    t.getContext('2d').putImageData(new ImageData(compositeRGBA(d, i), d.width, d.height), 0, 0); thumbCache.set(fid, t);
  }
  return t;
}
export function markDirty(dirty) { if (dirty === 'all') thumbCache.clear(); else for (const f of dirty) thumbCache.delete(f); }
