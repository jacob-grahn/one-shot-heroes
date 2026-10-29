/** Document op handlers: batch, palette, layers. Mixed into OPS (`this` is Core). */
import { celBudget, maskTags } from '@osh/format/document';
import { ID_FRAME, ID_LAYER, LIMITS } from '@osh/format/limits';
import { fail, intArg, nameArg, normHex } from '@osh/format/validate';

/** Validated layer properties of a set_layer op; returns the new name (or undefined). */
function layerProps(op) {
  const name = op.name === undefined ? undefined : nameArg(op.name, 'layer name');
  if (name !== undefined && (ID_LAYER.test(name) || ID_FRAME.test(name))) fail('bad_arg', 'layer name must not look like an id (L1, F2...)');
  if (op.visible !== undefined && typeof op.visible !== 'boolean') fail('bad_arg', 'visible must be boolean');
  if (op.opacity !== undefined && (typeof op.opacity !== 'number' || !(op.opacity >= 0 && op.opacity <= 1))) fail('bad_arg', 'opacity must be a number 0..1');
  return name;
}

/** Mixin: `this` is the composed host object. @type {Record<string, any>} */
export const docOps = {
  // --- composite ---
  batch(op) {
    const list = [];
    try { for (const sub of op.ops) list.push(this.exec(sub)); }
    catch (err) { for (let k = list.length - 1; k >= 0; k--) this.revert(list[k]); throw err; }
    return { type: 'batch', list };
  },
  // --- palette (copy-on-write for cels) ---
  set_palette(op) {
    if (!Array.isArray(op.colors) || op.colors.length < 1 || op.colors.length > LIMITS.maxColors - 1) fail('bad_arg', 'colors must be 1..255 hex strings');
    const pal = [null, ...op.colors.map(normHex)], n = pal.length;
    for (const k in this.doc.cels) { const a = this.doc.cels[k]; if (a.some(v => v >= n)) { this.doc.cels[k] = a.map(v => v >= n ? 0 : v); this.doc.tags[k] = maskTags(this.doc.tags[k], this.doc.cels[k]); } }
    this.doc.palette = pal;
  },
  set_color(op) { const color = normHex(op.color); intArg(op.index, 'index', 1, this.doc.palette.length - 1); this.doc.palette[op.index] = color; },
  add_color(op) { const color = normHex(op.color); if (this.doc.palette.length >= LIMITS.maxColors) fail('palette_full', 'palette full'); this.doc.palette.push(color); },
  remove_color(op) {
    const r = intArg(op.index, 'index', 1, this.doc.palette.length - 1);
    for (const k in this.doc.cels) { const a = this.doc.cels[k]; if (a.some(v => v >= r)) { this.doc.cels[k] = a.map(v => v === r ? 0 : v > r ? v - 1 : v); this.doc.tags[k] = maskTags(this.doc.tags[k], this.doc.cels[k]); } }
    this.doc.palette.splice(r, 1);
  },
  // --- layers ---
  add_layer(op) {
    const d = this.doc; if (d.layers.length >= LIMITS.maxLayers) fail('too_many', 'max ' + LIMITS.maxLayers + ' layers');
    celBudget(d.width, d.height, d.layers.length + 1, d.frames.length);
    const name = op.name === undefined ? 'Layer ' + (d.layers.length + 1) : nameArg(op.name, 'layer name');
    if (ID_LAYER.test(name) || ID_FRAME.test(name)) fail('bad_arg', 'layer name must not look like an id (L1, F2...)');
    const idx = op.index === undefined ? d.layers.length : intArg(op.index, 'index', 0, d.layers.length);
    op.id = this.claimId(op.id, ID_LAYER, 'L'); op.name = name;
    d.layers.splice(idx, 0, { id: op.id, name, visible: true, opacity: 1 });
    for (const f of d.frames) { d.cels[op.id + ':' + f.id] = new Uint8Array(d.width * d.height); d.tags[op.id + ':' + f.id] = new Uint8Array(d.width * d.height); }
  },
  remove_layer(op) {
    const d = this.doc; op.layer = this.resolveLayer(op.layer);
    if (d.layers.length <= 1) fail('last_layer', 'cannot remove the last layer');
    d.layers.splice(this.layerIndex(op.layer), 1);
    for (const f of d.frames) { delete d.cels[op.layer + ':' + f.id]; delete d.tags[op.layer + ':' + f.id]; }
  },
  move_layer(op) {
    const d = this.doc; op.layer = this.resolveLayer(op.layer);
    const to = intArg(op.index, 'index', 0, d.layers.length - 1), i = this.layerIndex(op.layer);
    const [l] = d.layers.splice(i, 1); d.layers.splice(to, 0, l);
  },
  set_layer(op) {
    op.layer = this.resolveLayer(op.layer); const l = this.doc.layers[this.layerIndex(op.layer)];
    const name = layerProps(op);
    if (name !== undefined) l.name = name; if (op.visible !== undefined) l.visible = op.visible; if (op.opacity !== undefined) l.opacity = op.opacity;
  },
};
