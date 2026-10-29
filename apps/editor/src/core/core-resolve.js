/** Core: id lookups, layer/frame resolution and argument checks (mixed into Core; `this` is Core). */
import { fail, isInt } from '@osh/format/validate';

/** Mixin: `this` is the composed host object. @type {Record<string, any>} */
export const resolveMethods = {
  layerIndex(id) { return this.doc.layers.findIndex(l => l.id === id); },
  frameIndex(id) { return this.doc.frames.findIndex(f => f.id === id); },
  resolveLayer(v) {
    const d = this.doc;
    if (v === undefined || v === null) v = this.ctx.layer;
    if (typeof v === 'number') { if (!isInt(v) || !d.layers[v]) fail('no_layer', 'no layer at index ' + v); return d.layers[v].id; }
    if (typeof v !== 'string') fail('bad_arg', 'layer must be an id, name, or index');
    if (this.layerIndex(v) >= 0) return v;
    const byName = d.layers.find(l => l.name === v); if (byName) return byName.id;
    fail('no_layer', 'no layer ' + JSON.stringify(v.slice(0, 40)));
  },
  resolveFrame(v) {
    const d = this.doc;
    if (v === undefined || v === null) v = this.ctx.frame;
    if (typeof v === 'number') { if (!isInt(v) || !d.frames[v]) fail('no_frame', 'no frame at index ' + v); return d.frames[v].id; }
    if (typeof v !== 'string' || this.frameIndex(v) < 0) fail('no_frame', 'no frame ' + JSON.stringify(String(v).slice(0, 40)));
    return v;
  },
  newId(prefix) { return prefix + (this.doc.nextId++); },
  claimId(id, re, prefix) {
    if (id === undefined) return this.newId(prefix);
    if (typeof id !== 'string' || !re.test(id)) fail('bad_arg', 'bad id');
    if (this.layerIndex(id) >= 0 || this.frameIndex(id) >= 0) fail('bad_arg', 'id in use: ' + id);
    this.doc.nextId = Math.max(this.doc.nextId, +id.slice(1) + 1); return id;
  },
  checkColor(c) { if (!isInt(c) || c < 0 || c >= this.doc.palette.length) fail('bad_color', 'color index must be an integer 0..' + (this.doc.palette.length - 1) + ' (got ' + JSON.stringify(c) + ')'); },
};
