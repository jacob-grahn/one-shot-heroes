/** Replaying a stored journal on top of the restored autosave. */
import { Core } from '../core/editor-core.js';
import { $ } from '../ui/dom.js';
import { readJournal } from './journal.js';
import { FORMAT, FORMAT_VERSION } from '@osh/format/limits';

/** Mixin: `this` is the composed host object. @type {Record<string, any>} */
export const replayMethods = {
  /** Apply a stored journal on top of the just-restored autosave. Returns the number of ops replayed, or -1 if it doesn't match. */
  replayJournal(token) {
    const j = journalEntryFor(token);
    if (!j) return -1;
    if (j.rebase) { // self-contained journal (R2): replaces the autosave's document entirely
      Core.load({ format: FORMAT, version: FORMAT_VERSION, base: j.rebase, ops: j.ops, cursor: j.cursor, provenanceUnknown: !!j.provenanceUnknown });
      this.saved.whole = true; // the record still holds a different document: keep journaling self-contained until the next save commits
      restoreName(j);
      return Math.max(1, j.ops.length);
    }
    replayOps(j);
    restoreName(j);
    return j.ops.length;
  },
};

/** The stored journal entry for token (with the journal-level name as fallback), or null when none applies. */
function journalEntryFor(token) {
  const all = readJournal();
  const name = all && typeof all.name === 'string' ? all.name : null;
  const j = all && Array.isArray(all.entries) ? all.entries.find(e => e && e.token === token) : null;
  if (!j || !Array.isArray(j.ops)) return null;
  if (typeof j.name !== 'string' && name !== null) j.name = name; // R7: entries carry their own tab's name
  return j;
}
function restoreName(j) {
  if (typeof j.name === 'string') $('#docName').value = j.name.slice(0, 64);
}
/** Rewind to the entry's base, apply its ops, then move to its cursor. */
function replayOps(j) {
  const keep = Math.max(0, Math.min(j.keep | 0, Core.log.length)), f0 = Core.folded;
    while (Core.cursor > keep) Core.undo();
    if (j.ops.length) { while (Core.cursor < keep) Core.redo(); for (const op of j.ops) Core.apply(op, op.author); }
    const target = (j.cursor | 0) - (Core.folded - f0); // replaying may fold history again, shifting indexes
    while (Core.cursor > target && Core.undo());
    while (Core.cursor < target && Core.redo());
}
