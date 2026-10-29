/** Autosave: IndexedDB, compact RLE cels, serialized in a worker; synchronous journal. */
import { isDirty } from '../core/clean-state.js';
import { Core } from '../core/editor-core.js';
import { $ } from '../ui/dom.js';
import { hooks } from '../ui/hooks.js';
import { doc } from '../ui/state/context.js';
import { toast } from '../ui/toast.js';
import { journalMethods } from './journal.js';
import { LEGACY_AUTOSAVE_KEY } from './keys.js';
import { replayMethods } from './replay.js';
import { WORKER_SOURCE, buildAutosaveRecord, idbOpen, idbReq } from './worker-source.js';
import { celKeys, metaOf } from '@osh/format/document';
import { FORMAT, FORMAT_VERSION } from '@osh/format/limits';
import { FPS } from '@osh/timing';

/* ---------- autosave: IndexedDB, compact RLE cels, serialized in a worker ---------- */
export const Autosave = Object.assign(/** @type {Record<string, any>} */ ({
  worker: null, timer: 0, busy: false, again: false, reqId: 0, waiters: [], failedOnce: false, last: null,
  paused: false,                         // another tab holds the editor lock (N4): never write autosave or journal
  pausedEdits: false,                    // the user changed something while paused (R3 takeover asks before discarding it)
  saved: { token: '', refs: [], foldedAt: 0, keep: 0 }, // the committed autosave: token, the log entries it contains, Core.folded then,
                                         // and how much of its log prefix is still identical in the live log
  pending: null,                         // the same, for the save in flight (it may commit even if this page unloads before hearing back)
  init() {
    // R8-MN1: can this page store anything at all? (OSH-31 must warn on the very first edit when it can't)
    try { const k = 'osh-pixel-editor:probe'; localStorage.setItem(k, '1'); localStorage.removeItem(k); this.lsOk = true; } catch (e) { this.lsOk = false; }
    this.idbDown = typeof indexedDB === 'undefined' || !indexedDB;
    if (!this.idbDown) { try { idbOpen().then(db => db.close(), () => { this.idbDown = true; }); } catch (e) { this.idbDown = true; } }
    try { const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' })); this.worker = new Worker(url); this.worker.onmessage = e => this.done(e.data); this.worker.onerror = e => { e.preventDefault(); this.worker = null; this.done({ ok: false, error: 'worker failed: ' + (e.message || 'error'), retry: true }); }; }
    catch (err) { this.worker = null; }
  },
  schedule() { if (this.paused) { if (!this.restoring) this.pausedEdits = true; if (!this.pausedShown) { this.pausedShown = true; this.setStatus('error', 'Another tab is editing; autosave paused here'); } return; } this.journalSoon();
    const now = Date.now(); if (!this.firstChange) this.firstChange = now; // R7: 700 ms debounce, but never more than 3 s after the first unsaved change
    const due = now + Math.max(0, Math.min(700, this.firstChange + 3000 - now));
    if (this.timer && this.due === due) return; // same deadline (burst within one ms): keep the timer
    clearTimeout(this.timer); this.due = due;
    this.timer = setTimeout(() => { this.timer = 0; this.run(); }, due - now); if (this.statusKind !== 'pending') this.setStatus('pending', 'Unsaved changes'); },
  due: 0, pausedShown: false, statusKind: '',
  firstChange: 0,
  payload() {
    const d = doc(), meta = metaOf(d);
    return { format: FORMAT, version: FORMAT_VERSION, fps: FPS, name: $('#docName').value.slice(0, 64), provenanceUnknown: Core.baseUnknown,
      meta, cels: celKeys(d).map(k => [k, d.cels[k]]), base: Core.base, ops: Core.log.map(e => e.op), cursor: Core.cursor, tags: celKeys(d).map(k => [k, d.tags[k]]) };
  },
  run() {
    if (this.paused) return;
    { const w = hooks.editorLock.writeCheck(); if (w !== 'ok') { if (w !== 'gone') this.deferRun = true; return; } } // N1: a newer editor may own the record
    if (this.busy) { this.again = true; return; }
    this.busy = true; this.firstChange = 0; clearTimeout(this.timer); this.timer = 0; this.setStatus('saving', 'Saving…');
    const p = this.payload(), id = ++this.reqId;
    p.journalToken = Math.random().toString(36).slice(2) + Date.now().toString(36); this.pending = { id, token: p.journalToken, refs: Core.log.slice(), foldedAt: Core.folded, keep: Core.log.length, cursor: Core.cursor, name: p.name }; this.journal();
    if (this.worker) { try { this.worker.postMessage({ id, payload: p }); return; } catch (err) { this.worker = null; } }
    // no worker: serialize when idle on the main thread, then IndexedDB, then localStorage
    (window.requestIdleCallback || (f => setTimeout(f, 0)))(async () => {
      const t0 = performance.now();
      try { const json = buildAutosaveRecord(p); try { await idbReq('readwrite', st => st.put(json, 'autosave')); } catch (e) { localStorage.setItem(LEGACY_AUTOSAVE_KEY, json); } this.done({ id, ok: true, bytes: json.length, ms: performance.now() - t0 }); }
      catch (err) { this.done({ id, ok: false, error: String(err && err.message || err) }); }
    });
  },
  done(r) {
    this.busy = false; this.last = r;
    if (this.pending && r.id === this.pending.id) { if (r.ok) this.saved = this.pending; this.pending = null; this.journal(); }
    if (r.ok) this.reportOk(r);
    else if (this.reportFailure(r)) return;
    if (this.again) { this.again = false; this.run(); return; }
    const w = this.waiters; this.waiters = []; w.forEach(f => f(r));
  },
  reportOk(r) {
    this.setStatus('ok', 'Autosaved ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' · ' + Math.max(1, Math.round(r.bytes / 1024)) + ' KB'); this.failedOnce = false;
  },
  /** Show a failed save; returns true when it retried (done() must stop there). */
  reportFailure(r) {
    const why = saveErrorText(r.error); this.setStatus('error', 'Autosave failed: ' + why + '. Use Save (Ctrl+S) to keep your work.'); const st = $('#saveStatus'); if (st) st.title = 'Autosave failed (' + String(r.error || 'unknown error').replace(/[.\s]+$/, '') + '). Use Save (Ctrl+S) to keep your work.';
    if (!this.failedOnce) toast('Autosave failed: ' + why + '. Use Save (Ctrl+S) to keep your work.'); this.failedOnce = true;
    if (r.retry) { this.run(); return true; }
    return false;
  },
  /** OSH-31: should closing this tab warn? Only when edits on screen are in neither the autosave nor the journal:
   *  paused / stepped-down edits (a pending keep/load prompt included), or a failed autosave the journal doesn't cover. */
  unloadRisk() {
    // R8-MN2: a paused tab's edits are safe once the user saved them to a file (Save / Ctrl+S, as the notice asks): the
    // file-level isDirty() is reset by markClean() on Save
    if (this.pausedEdits && (this.paused || $('#takeoverKeep'))) return isDirty();
    if (this.paused) return false;
    // R8-MN1: gate on "autosave has failed since the last good save" (or storage is unusable), not on the status text: the
    // next edit flips the status to 'pending' / 'saving' long before the retry fails again
    return (this.failedOnce || this.statusKind === 'error' || this.storageDown()) && this.isDirty() && !(this.journalOk && this.saved && this.saved.token);
  },
  lsOk: true, idbDown: false,
  /** R8-MN1: no autosave can land: IndexedDB is unusable and there is no localStorage fallback (the worker path has none). */
  storageDown() { return this.idbDown && (!this.lsOk || !!this.worker); },
  journalOk: false,
  /** R7-MJ1: does this tab show anything its committed autosave doesn't have (held, queued, in-flight or unsaved edits)? */
  isDirty() {
    if (this.inFlight()) return true;
    const sn = this.saved; if (!sn || sn.whole) return true;
    if (!sn.token) return Core.log.length > 0;
    const e = this.entry(sn); if (!e || e.rebase || e.ops.length) return true;
    return this.movedSince(sn, e);
  },
  /** Held, queued or in-flight work (journal or autosave). */
  inFlight() {
    return !!(this.deferJournal || this.deferRun || this.journalQueued || this.timer || this.busy || this.pending || this.bigKick);
  },
  /** Cursor or name changed since snapshot sn (whose journal entry e has no ops). */
  movedSince(sn, e) {
    if (typeof sn.cursor === 'number' && e.cursor !== sn.cursor) return true;
    return typeof sn.name === 'string' && sn.name !== $('#docName').value.slice(0, 64);
  },
  flush() { clearTimeout(this.timer); if (this.paused) return Promise.resolve({ ok: false, error: 'another tab is editing this document' }); return new Promise(res => { this.waiters.push(res); if (!this.busy) this.run(); else this.again = true; }); },
  setStatus(kind, text) { this.statusKind = kind; if (kind !== 'error') this.pausedShown = false; const e = $('#saveStatus'); if (!e) return; e.textContent = text; e.dataset.state = kind; e.title = text; },
  async restore() {
    let rec = null;
    try { rec = await idbReq('readonly', st => st.get('autosave')); } catch (err) { console.warn('IndexedDB unavailable:', err.message); }
    if (!rec) { try { rec = localStorage.getItem(LEGACY_AUTOSAVE_KEY); } catch (e) { rec = null; } }
    return rec;
  },
  async clear() { this.invalidateJournal(); try { await idbReq('readwrite', st => st.delete('autosave')); } catch (e) { /* ignore */ } try { localStorage.removeItem(LEGACY_AUTOSAVE_KEY); } catch (e) { /* ignore */ } },
}), journalMethods, replayMethods);
// Save when the tab is hidden or closed. run() is async and may not finish on reload, so the journal (already written
// synchronously on every change) is what guarantees the last edits survive.
export const flushOnHide = () => { if (Autosave.paused) return; Autosave.journal(true); if (Autosave.timer) { clearTimeout(Autosave.timer); Autosave.timer = 0; Autosave.run(); } };
window.addEventListener('pagehide', flushOnHide);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushOnHide(); });
/** One editing tab at a time (N4): the first tab holds a Web Lock for its lifetime; later tabs show a notice and never overwrite the autosave. */
/** OSH-36: a readable reason for a failed autosave (the raw browser text goes in the tooltip). */
export function saveErrorText(err) {
  const raw = String(err || '').replace(/[.\s]+$/, '');
  if (/denied|SecurityError|insecure|not allowed|access/i.test(raw)) return 'this page isn\u2019t allowed to use browser storage';
  if (/quota|QuotaExceeded|space/i.test(raw)) return 'browser storage is full';
  if (/worker failed/i.test(raw)) return 'the background saver stopped';
  return raw ? raw.charAt(0).toLowerCase() + raw.slice(1) : 'unknown error';
}
// OSH-31: warn before closing only when edits on screen are saved nowhere (not when the autosave or journal has them)
window.addEventListener('beforeunload', e => { if (Autosave.unloadRisk()) { e.preventDefault(); e.returnValue = ''; } });
$('#docName').onchange = () => Autosave.schedule();
$('#docName').oninput = () => Autosave.journalSoon();
