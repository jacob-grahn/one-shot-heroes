/** Serialized sprite document: encode, canonical JSON, and schema-validated decode. */
import { decodeCel, encodeCel } from './cel-codec.js';
import { ID_FRAME, ID_LAYER, LIMITS } from './limits.js';
import { fail, guardKeys, intArg, isInt, isPlainObj, nameArg, normHex, own } from './validate.js';

/* ---------- document ---------- */
export const metaOf = d => ({ width: d.width, height: d.height, palette: d.palette.slice(), layers: d.layers.map(l => ({ ...l })), frames: d.frames.map(f => ({ id: f.id })), animations: d.animations.map(a => ({ name: a.name, frames: a.frames.slice(), mode: a.mode })), nextId: d.nextId });
// Per-pixel provenance tags: d.tags[key] parallels d.cels[key]; 0 = hand-drawn, 1 = AI. Transparent pixels are always 0.
// Only cels with at least one AI pixel are written to files.
/** Cel keys in canonical layer×frame order (live docs keep creation order, which depends on whether layers or frames came first). */
export const celKeys = d => { const out = []; for (const l of d.layers) for (const f of d.frames) out.push(l.id + ':' + f.id); return out; };
/** Order-insensitive JSON: object keys sorted at every level (arrays keep their order). */
export const canonJSON = o => JSON.stringify(o, (k, v) => v && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v) ? Object.fromEntries(Object.keys(v).sort().map(x => [x, v[x]])) : v);
export function encodeDoc(d) { const o = metaOf(d); o.cels = {}; o.tags = {}; for (const k of celKeys(d)) { o.cels[k] = encodeCel(d.cels[k]); if (d.tags[k].some(v => v)) o.tags[k] = encodeCel(d.tags[k]); } return o; }
/** Copy of tag array t with tags cleared wherever pixel array a is transparent. */
export const maskTags = (t, a) => { const o = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) o[i] = a[i] ? t[i] : 0; return o; };
export function celBudget(w, h, nl, nf) { if (w * h * nl * nf > LIMITS.maxCelBytes) fail('too_big', `document too large (${w}×${h}×${nl} layers×${nf} frames)`); }
function decodePalette(o) {
  if (!Array.isArray(o.palette) || o.palette.length < 1 || o.palette.length > LIMITS.maxColors || o.palette[0] !== null) fail('bad_doc', 'palette must be [null, ...hex] with ≤256 entries');
  return [null, ...o.palette.slice(1).map(normHex)];
}
/** ids: {seen: Set, max: number} shared by layers and frames (ids are unique across both). */
function claimDocId(ids, id) { ids.seen.add(id); ids.max = Math.max(ids.max, +id.slice(1)); }
function decodeLayer(l, ids) {
  if (!isPlainObj(l) || typeof l.id !== 'string' || !ID_LAYER.test(l.id) || ids.seen.has(l.id)) fail('bad_doc', 'bad or duplicate layer id');
  claimDocId(ids, l.id);
  const name = nameArg(l.name, 'layer name');
  if (typeof l.visible !== 'boolean') fail('bad_doc', 'layer.visible must be boolean');
  if (typeof l.opacity !== 'number' || !(l.opacity >= 0 && l.opacity <= 1)) fail('bad_doc', 'layer.opacity must be 0..1');
  return { id: l.id, name, visible: l.visible, opacity: l.opacity };
}
function decodeFrame(f, ids) {
  if (!isPlainObj(f) || typeof f.id !== 'string' || !ID_FRAME.test(f.id) || ids.seen.has(f.id)) fail('bad_doc', 'bad or duplicate frame id');
  claimDocId(ids, f.id);
  return { id: f.id };
}
function decodeAnimations(o, frames) {
  const fids = new Set(frames.map(f => f.id)), anames = new Set();
  if (!Array.isArray(o.animations || []) || (o.animations || []).length > LIMITS.maxAnimations) fail('bad_doc', 'bad animations');
  return (o.animations || []).map(a => {
    if (!isPlainObj(a)) fail('bad_doc', 'bad animation');
    const name = nameArg(a.name, 'animation name'); if (anames.has(name)) fail('bad_doc', 'duplicate animation ' + name); anames.add(name);
    if (!Array.isArray(a.frames) || !a.frames.every(f => fids.has(f))) fail('bad_doc', 'animation frames must reference frame ids');
    if (a.mode !== 'loop' && a.mode !== 'pingpong') fail('bad_doc', 'animation mode must be loop or pingpong');
    return { name, frames: [...new Set(a.frames)], mode: a.mode };
  });
}
function rejectUnexpected(keys, want, what) {
  for (const k of keys) if (!want.has(k)) fail('bad_doc', 'unexpected ' + what + ' key ' + JSON.stringify(k.slice(0, 30)));
}
/** geo: {w, h, palette}. */
function decodeCels(o, want, geo) {
  if (!isPlainObj(o.cels)) fail('bad_doc', 'cels must be an object');
  rejectUnexpected(Object.keys(o.cels), want, 'cel');
  const cels = Object.create(null);
  for (const k of want) {
    if (!own(o.cels, k)) fail('bad_doc', 'missing cel ' + k);
    const a = decodeCel(o.cels[k], geo.w * geo.h, geo.w);
    for (let i = 0; i < a.length; i++) if (a[i] >= geo.palette.length) fail('bad_doc', 'cel ' + k + ' uses a color index outside the palette');
    cels[k] = a;
  }
  return cels;
}
function decodeTags(o, want, cels, geo) {
  if (o.tags !== undefined && !isPlainObj(o.tags)) fail('bad_doc', 'tags must be an object');
  const tags = Object.create(null), inTags = o.tags || {};
  rejectUnexpected(Object.keys(inTags), want, 'tag');
  for (const k of want) {
    if (!own(inTags, k)) { tags[k] = new Uint8Array(geo.w * geo.h); continue; }
    const t = decodeCel(inTags[k], geo.w * geo.h, geo.w);
    for (let i = 0; i < t.length; i++) if (t[i] > 1) fail('bad_doc', 'tags for ' + k + ' must be 0 or 1');
    tags[k] = maskTags(t, cels[k]);
  }
  return tags;
}
function checkCounts(o, w, h) {
  if (!Array.isArray(o.layers) || o.layers.length < 1 || o.layers.length > LIMITS.maxLayers) fail('bad_doc', `layers must be 1..${LIMITS.maxLayers}`);
  if (!Array.isArray(o.frames) || o.frames.length < 1 || o.frames.length > LIMITS.maxFrames) fail('bad_doc', `frames must be 1..${LIMITS.maxFrames}`);
  celBudget(w, h, o.layers.length, o.frames.length);
}
/** Schema-validate an untrusted serialized document and decode it. Never trusts keys or sizes. */
export function decodeDoc(o) {
  if (!isPlainObj(o)) fail('bad_doc', 'document must be an object');
  guardKeys(o);
  const w = intArg(o.width, 'width', LIMITS.minSize, LIMITS.maxSize), h = intArg(o.height, 'height', LIMITS.minSize, LIMITS.maxSize);
  const palette = decodePalette(o);
  checkCounts(o, w, h);
  const ids = { seen: new Set(), max: 0 };
  const layers = o.layers.map(l => decodeLayer(l, ids));
  const frames = o.frames.map(f => decodeFrame(f, ids));
  const animations = decodeAnimations(o, frames);
  const want = new Set(); for (const l of layers) for (const f of frames) want.add(l.id + ':' + f.id);
  const geo = { w, h, palette }, cels = decodeCels(o, want, geo), tags = decodeTags(o, want, cels, geo);
  const nextId = Math.max(isInt(o.nextId) && o.nextId > 0 && o.nextId < 1e7 ? o.nextId : 1, ids.max + 1);
  return { width: w, height: h, palette, layers, frames, animations, cels, tags, nextId };
}

/* ---------- rasterizers: pure; iterate only the visible part of the canvas ---------- */
