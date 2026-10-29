/** Editor core: document, op log, history (DOM-free). */
import { execMethods } from './core-exec.js';
import { fileMethods } from './core-file.js';
import { historyMethods } from './core-history.js';
import { resolveMethods } from './core-resolve.js';
import { dirtyOf } from './op-kinds.js';
import { encodeDoc } from '@osh/format/document';
import { LIMITS } from '@osh/format/limits';
import { deepFreeze } from '@osh/palette';

/* ---------- Editor core: document + op log ---------- */
export const Core = Object.assign(/** @type {Record<string, any>} */ ({
  doc: null, base: null, log: [], cursor: 0, seq: 0, baseUnknown: false,
  folded: 0, // total ops folded into base since the last reset/load (lets the UI journal re-base its indexes)
  maxOps: /** @type {number} */ (LIMITS.maxOps), onFold: /** @type {null | ((n: number) => void)} */ (null), // history cap; lowered only by the ?testMaxOps= hook in tests
  internal: [], external: [],
  ctx: { layer: 'L1', frame: 0 },  // default target for ops without layer/frame (set by UI)

  reset(doc) { this.doc = doc; this.base = encodeDoc(doc); this.log = []; this.cursor = 0; this.seq = 0; this.folded = 0; this.baseUnknown = false; this.emit('reset', null); },
  emit(type, op) {
    const dirty = op ? dirtyOf(op) : 'all';
    for (const fn of this.internal) try { fn({ type, op, dirty }); } catch (err) { console.error(err); }
    if (this.external.length) { const ev = deepFreeze({ type, op: op ? JSON.parse(JSON.stringify(op)) : null }); for (const fn of this.external) try { fn(ev); } catch (err) { console.error(err); } }
  },
}), resolveMethods, execMethods, historyMethods, fileMethods);
