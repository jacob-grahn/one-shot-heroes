/** Autosave journal: the synchronous localStorage record of ops since the last committed autosave (N2/N3/R7). */
import { Core } from '../core/editor-core.js';
import { $ } from '../ui/dom.js';
import { hooks } from '../ui/hooks.js';
import { JOURNAL_KEY, JOURNAL_MAX, JOURNAL_MAX_OPS } from './keys.js';

/** Unsaved ops a journal entry for snapshot sn would carry. */
export const unsavedOps = sn => sn.whole ? Core.log.length : Core.log.length + (Core.folded - sn.foldedAt) - Math.min(sn.keep, Core.log.length + Core.folded - sn.foldedAt);
/** The stored journal, or null when missing or unreadable. */
export function readJournal() {
  try { return JSON.parse(localStorage.getItem(JOURNAL_KEY) || 'null'); } catch (e) { return null; }
}
/** An entry another tab wrote after this tab's last heartbeat (that tab is alive and newer). */
const isLiveEntry = e => e && typeof e.tab === 'string' && e.tab !== hooks.editorLock.id && typeof e.at === 'number' && e.at > hooks.editorLock.lastBeat;
const hasLiveEntry = j => !!(j && Array.isArray(j.entries) && j.entries.some(isLiveEntry));

/** Journal methods of Autosave (mixed into it; `this` is Autosave). */
/** Mixin: `this` is the composed host object. @type {Record<string, any>} */
export const journalMethods = {
  /** Journal entry relative to one autosave snapshot. Indexes are in that record's terms: live index i == record index i + off,
   *  where off = ops folded into base since that save (R2). If ops newer than the save were folded away, the entry is
   *  self-contained instead (folded base + whole live log). */
  entry(sn) {
    const refs = sn.refs, log = Core.log, off = Core.folded - sn.foldedAt;
    if (sn.whole) return { token: sn.token, rebase: Core.base, provenanceUnknown: Core.baseUnknown, ops: log.map(e => e.op), cursor: Core.cursor }; // R7: doc replaced since that save
    if (off < 0) return null;
    if (sn.keep > log.length + off) sn.keep = log.length + off;
    while (sn.keep > off && log[sn.keep - off - 1] !== refs[sn.keep - 1]) sn.keep--; // log only changes at its tail
    if (sn.keep < off) return { token: sn.token, rebase: Core.base, provenanceUnknown: Core.baseUnknown, ops: log.map(e => e.op), cursor: Core.cursor };
    return { token: sn.token, keep: sn.keep, ops: log.slice(sn.keep - off).map(e => e.op), cursor: Core.cursor + off };
  },
  /** OSH-06: edits mark the journal stale; it is rewritten once at the end of the current task (microtask), so a burst of
   *  N synchronous ops / undos costs one write instead of N ever-growing ones. A reload, crash or pagehide can only happen
   *  between tasks, so the N3 / R7 guarantee (the last edit is journaled before anything else runs) still holds. */
  journalSoon() {
    if (this.paused || this.journalQueued) return;
    this.journalQueued = true;
    queueMicrotask(() => { if (this.journalQueued) this.journal(); });
  },
  journalQueued: false,
  /** Write the journal now: ops applied since the committed (and the in-flight) autosave, so a reload right after an edit keeps it (N3). */
  journal(final = false) {
    this.journalQueued = false;
    if (this.paused) return;
    // F2: cheap size check before serialising anything (a scripted burst can leave tens of thousands of unsaved ops).
    // Oversized entries are dropped and an immediate autosave covers those ops; if none is left, the last (older but
    // consistent) journal stays as it is.
    const snaps = [this.saved, this.pending].filter(sn => sn && sn.token), small = snaps.filter(sn => unsavedOps(sn) <= JOURNAL_MAX_OPS);
    // N1 / R7-MN2: never journal over a newer editor ('gone'). During the post-gap hold the journal is still written once no
    // newer editor answered the BroadcastChannel echo ('held'), or right away when the page is going away (final): entries
    // carry the writing tab and time (R7b-MN1), and other tabs' entries are kept, so a held write can't clobber anyone.
    const w = hooks.editorLock.writeCheck(); if (w === 'gone') return;
    if (w === 'wait' && !final) { this.deferJournal = true; return; }
    const held = w !== 'ok', name = $('#docName').value.slice(0, 64);
    const entries = this.journalEntries(small, name);
    if (!entries.length) { this.journalOk = false; if (small.length < snaps.length) this.bigBurst(); return; }
    if (small.length < snaps.length) this.keepSkipped(snaps, small, entries);
    if (held && this.mergeHeld(entries)) return;
    this.writeJournal({ entries, name }, small.length === snaps.length);
  },
  journalEntries(small, name) {
    const entries = small.map(sn => this.entry(sn)).filter(Boolean); const at = Date.now(); entries.forEach(e => { e.name = name; e.tab = hooks.editorLock.id; e.at = at; });
    return entries;
  },
  /** N2: keep the stored (older, consistent) entry of each skipped snapshot until its replacement save commits. */
  keepSkipped(snaps, small, entries) {
    const old = this.storedEntries();
    for (const sn of snaps) if (!small.includes(sn) && old.has(sn.token)) entries.push(old.get(sn.token));
    this.bigBurst();
  },
  /** A held write (post-gap, not yet verified): merge other tabs' entries. Returns true when storage must be left alone. */
  mergeHeld(entries) {
    const old = readJournal();
    // R7b-MN1: after a takeover both tabs journal against the same token (the new owner adopted our last record). An entry
    // for one of our tokens that another tab wrote while we were stalled (after our last heartbeat) is newer than ours:
    // keep it. Our edits stay on screen (stepDown marks them unsaved and the takeover asks), and if the re-check still
    // finds us the editor, the deferred journal rewrites ours. A lone tab's own entry, or one left by a closed tab
    // before this tab's last beat (e.g. its previous page load), is still replaced, so MN2's crash cover holds.
    if (old && Array.isArray(old.entries)) for (const e of old.entries) this.mergeEntry(entries, e);
    // R8-MN3: a tab that hasn't finished verifying ownership never writes back other tabs' entries. If another tab wrote
    // to the journal after our last heartbeat it is alive and newer: our read-modify-write could land over a fresher write
    // of its own (the same millisecond, in the ~480 ms both-owners window), so leave storage alone; the post-verify
    // journal() writes ours if we turn out to be the editor. (A lone or reloaded tab finds only its own or older entries.)
    if (hasLiveEntry(old) || hasLiveEntry(readJournal())) { this.deferJournal = true; this.journalOk = false; this.stored = null; return true; }
    return false;
  },
  mergeEntry(entries, e) {
    if (!e || typeof e.token !== 'string') return;
    const i = entries.findIndex(x => x.token === e.token);
    if (i < 0) entries.push(e);
    else if (isLiveEntry(e)) { entries[i] = e; this.deferJournal = true; }
  },
  writeJournal(j, complete) {
    this.journalOk = false; // OSH-31: true only while the stored journal holds every unsaved op
    try { const txt = JSON.stringify(j); if (txt.length > JOURNAL_MAX) { localStorage.removeItem(JOURNAL_KEY); this.stored = new Map(); } else { localStorage.setItem(JOURNAL_KEY, txt); this.stored = new Map(j.entries.map(e => [e.token, e])); this.journalOk = complete; } } catch (e) { /* quota: autosave still covers us */ }
  },
  stored: null, // N2: token -> the journal entry last written for it (null: not known yet, read from storage on demand)
  storedEntries() {
    if (!this.stored) { this.stored = new Map(); const j = readJournal(); if (j && Array.isArray(j.entries)) for (const e of j.entries) if (e && typeof e.token === 'string') this.stored.set(e.token, e); }
    return this.stored;
  },
  /** F2: too many unsaved ops to journal cheaply: save the record now (once per burst) instead. */
  bigBurst() {
    if (this.bigKick || this.restoring) return; this.bigKick = true;
    setTimeout(() => { this.bigKick = false; if (this.paused) return; if (this.busy) this.again = true; else this.run(); }, 0);
  },
  bigKick: false,
  restoring: false,
  /** R7: the document was replaced (New / Open / Example / takeover "keep"). The committed record (and any save in flight)
   *  still holds the old document, so journal self-contained entries against them right away, and save the new document now
   *  instead of after the debounce. */
  onReset(token) {
    if (this.paused || this.restoring) return;
    if (typeof token === 'string' && token) this.saved = { token, refs: [], foldedAt: 0, keep: 0, whole: true };
    for (const sn of [this.saved, this.pending]) if (sn) sn.whole = true;
    this.journal();
    clearTimeout(this.timer); this.firstChange = 0;
    this.setStatus('pending', 'Unsaved changes');
    this.timer = setTimeout(() => { this.timer = 0; this.journal(); this.run(); }, 0); // next task: callers set the doc name after the reset
  },
  invalidateJournal() { if (this.paused || this.restoring) return; this.saved = { token: '', refs: [], foldedAt: 0, keep: 0 }; this.pending = null; this.stored = new Map(); try { localStorage.removeItem(JOURNAL_KEY); } catch (e) { /* ignore */ } },
};
