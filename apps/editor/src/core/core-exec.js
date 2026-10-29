/** Core: sanitizing, executing and reverting ops, and folding old history into the base (mixed into Core). */
import { MULTI_OPS, PIXEL_OPS, isNoop } from './op-kinds.js';
import { OPS } from './ops.js';
import { decodeDoc, encodeDoc, metaOf } from '@osh/format/document';
import { AUTHORS } from '@osh/format/limits';
import { fail, guardKeys, isPlainObj, own } from '@osh/format/validate';

/** Mixin: `this` is the composed host object. @type {Record<string, any>} */
export const execMethods = {
  /** Clean an untrusted op: structured copy, no forbidden keys, editor-owned fields (author/ts/seq/taint) overwritten. */
  sanitize(op, author, trusted) {
    if (!AUTHORS.includes(author)) fail('bad_author', 'author must be one of ' + AUTHORS.join(', '));
    let o; try { o = JSON.parse(JSON.stringify(op)); } catch (e) { fail('bad_op', 'op must be JSON-serializable'); }
    if (!isPlainObj(o) || typeof o.op !== 'string' || !own(OPS, o.op)) fail('unknown_op', 'unknown op: ' + JSON.stringify(isPlainObj(o) ? String(o.op).slice(0, 40) : o));
    guardKeys(o);
    const strip = x => { delete x.author; delete x.ts; delete x.seq; delete x.taint; x.author = author; if (x.op === 'batch') { if (!Array.isArray(x.ops) || x.ops.length > 10000) fail('bad_arg', 'batch.ops must be an array (≤10000)'); x.ops.forEach(s => { if (!isPlainObj(s) || typeof s.op !== 'string' || !own(OPS, s.op) || s.op === 'batch') fail('unknown_op', 'bad batch sub-op'); strip(s); }); } };
    strip(o);
    return o;
  },
  /** The single dispatcher. author is bound by the caller's session, never read from the op. Returns the logged op, or null for a no-op. */
  apply(op, author, trusted = false) {
    op = this.sanitize(op, author, trusted);
    const inv = this.exec(op);
    if (isNoop(inv)) return null;
    this.log.length = this.cursor;
    op.seq = ++this.seq; op.ts = Date.now();
    this.log.push({ op, inv }); this.cursor++;
    if (this.log.length > this.maxOps) this.foldIntoBase(this.log.length - Math.floor(this.maxOps * 0.9));
    this.emit('op', op);
    return op;
  },
  /** Drop the oldest n ops from history without losing their edits: replay them onto the base snapshot (pixels and tags), then trim.
   *  Done in ~10% chunks so the decode/encode cost is amortized. Only called right after a push, so cursor === log.length. */
  foldIntoBase(n) {
    if (n <= 0) return;
    const live = this.doc, b = decodeDoc(this.base);
    this.doc = b;
    try { for (let i = 0; i < n; i++) this.exec(JSON.parse(JSON.stringify(this.log[i].op))); }
    finally { this.doc = live; }
    this.base = encodeDoc(b); this.log.splice(0, n); this.cursor -= n; this.folded += n;
    if (this.onFold) this.onFold(n);
  },
  exec(op) {
    const h = OPS[op.op];
    if (op.op === 'batch') return h.call(this, op);
    if (PIXEL_OPS.has(op.op) || MULTI_OPS.has(op.op)) { op.layer = this.resolveLayer(op.layer); op.frame = this.resolveFrame(op.frame); }
    if (PIXEL_OPS.has(op.op)) {
      const key = op.layer + ':' + op.frame;
      return this.write(key, h.call(this, op, this.doc.cels[key]), op.author === 'ai' ? 1 : 0);
    }
    if (MULTI_OPS.has(op.op)) return { type: 'batch', list: h.call(this, op).map(([key, writes]) => this.write(key, writes, op.author === 'ai' ? 1 : 0)) };
    const snap = this.snapshot();
    try { h.call(this, op); } catch (err) { this.doc = this.restore(snap); throw err; }
    const cels = this.doc.cels, tg = this.doc.tags, same = Object.keys(cels).length === Object.keys(snap.cels).length && Object.keys(cels).every(k => cels[k] === snap.cels[k] && tg[k] === snap.tags[k]);
    return { type: 'snap', snap, noop: same && JSON.stringify(metaOf(this.doc)) === snap.meta };
  },
  // Snapshots share cel arrays by reference (structural ops never mutate cels in place), so they cost O(layers×frames), not O(pixels).
  snapshot() { return { meta: JSON.stringify(metaOf(this.doc)), cels: Object.assign(Object.create(null), this.doc.cels), tags: Object.assign(Object.create(null), this.doc.tags) }; },
  restore(s) { const d = JSON.parse(s.meta); d.cels = Object.assign(Object.create(null), s.cels); d.tags = Object.assign(Object.create(null), s.tags); return d; },
  /** Apply writes [[x,y,color,tag?]]. tag defaults to the op author's (1 = ai). A same-color write that changes the tag is a real change. */
  write(key, writes, authorTag) {
    const d = this.doc, cel = d.cels[key], tags = d.tags[key], idx = [], old = [], oldT = [], seen = new Set();
    for (const w of writes) {
      const x = w[0], y = w[1], c = w[2];
      if (x < 0 || y < 0 || x >= d.width || y >= d.height) continue;
      const i = y * d.width + x, t = c === 0 ? 0 : (w[3] === undefined ? authorTag : w[3]);
      if (cel[i] === c && tags[i] === t) continue;
      if (!seen.has(i)) { seen.add(i); idx.push(i); old.push(cel[i]); oldT.push(tags[i]); }
      cel[i] = c; tags[i] = t;
    }
    return { type: 'pix', key, idx, old, oldT };
  },
  revert(inv) {
    if (inv.type === 'pix') { const cel = this.doc.cels[inv.key], tags = this.doc.tags[inv.key]; for (let k = inv.idx.length - 1; k >= 0; k--) { cel[inv.idx[k]] = inv.old[k]; tags[inv.idx[k]] = inv.oldT[k]; } }
    else if (inv.type === 'snap') this.doc = this.restore(inv.snap);
    else if (inv.type === 'batch') for (let k = inv.list.length - 1; k >= 0; k--) this.revert(inv.list[k]);
  },
};
