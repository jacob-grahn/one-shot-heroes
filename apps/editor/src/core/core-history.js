/** Core: undo/redo and provenance (mixed into Core). */

/** Mixin: `this` is the composed host object. @type {Record<string, any>} */
export const historyMethods = {
  undo() { if (this.cursor === 0) return false; const e = this.log[--this.cursor]; this.revert(e.inv); this.emit('undo', e.op); return true; },
  redo() { if (this.cursor >= this.log.length) return false; const e = this.log[this.cursor]; e.inv = this.exec(e.op); this.cursor++; this.emit('redo', e.op); return true; },
  activeOps() { return this.log.slice(0, this.cursor).map(e => e.op); },

  /** Per-pixel provenance: the document is AI if any non-transparent pixel in any layer (visible or hidden) of any frame is AI-tagged.
   *  Browser-only bookkeeping; not tamper-proof. */
  provenance() {
    const counts = { user: 0, ai: 0 };
    const walk = o => { if (o.op === 'batch') o.ops.forEach(walk); else counts[o.author]++; };
    this.activeOps().forEach(walk);
    let aiPixelCount = 0, pixelCount = 0;
    for (const k in this.doc.cels) { const a = this.doc.cels[k], t = this.doc.tags[k]; for (let i = 0; i < a.length; i++) if (a[i]) { pixelCount++; aiPixelCount += t[i]; } }
    const ai = aiPixelCount > 0, label = ai ? 'ai' : this.baseUnknown ? 'unknown' : 'human';
    return { ai, aiPixelCount, pixelCount, label, counts, unknownBase: this.baseUnknown };
  },
};
