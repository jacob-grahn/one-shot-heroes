/** Editor lock, fallback mode: re-checking ownership after a gap, and stepping down (mixed into EditorLock). */
import { $ } from '../ui/dom.js';
import { Autosave } from './autosave.js';
import { CLAIM_KEY, ECHO_MS, HEARTBEAT_KEY, VERIFY_MS } from './keys.js';
import { foreignClaim } from './lock-heartbeat.js';

/** R7-MN1: never leave flushAutosave() pending. */
function releaseWaiters() {
  const w = Autosave.waiters; Autosave.waiters = []; Autosave.again = false; w.forEach(f => f({ ok: false, error: 'another tab is editing this document' }));
}

/** Mixin: `this` is the composed host object. @type {Record<string, any>} */
export const verifyMethods = {
  verify() {
    const seq = ++this.vseq; this.verifying = true; this.echoed = false;
    if (typeof BroadcastChannel === 'function') {
      try { const ch = new BroadcastChannel('osh-pixel-editor'); this.vch = ch;
        ch.onmessage = e => { const d = e.data; if (seq === this.vseq && this.verifying && typeof d === 'string' && (d === 'here' || (d.startsWith('here:') && d !== 'here:' + this.id))) this.stepDown(); };
        ch.postMessage('hello:' + this.id); } catch (e) { this.vch = null; }
    }
    setTimeout(() => {
      if (seq !== this.vseq || !this.verifying) return; this.echoed = true;
      if (Autosave.deferJournal) { Autosave.deferJournal = false; Autosave.journal(); }
    }, ECHO_MS);
    setTimeout(() => this.finishVerify(seq), VERIFY_MS);
  },
  finishVerify(seq) {
    if (seq !== this.vseq || !this.verifying) return;
    if (this.lostDuringGap()) { this.stepDown(); return; }
    this.endVerify(); this.beat();
    const j = Autosave.deferJournal, r = Autosave.deferRun; Autosave.deferJournal = Autosave.deferRun = false;
    if (j) Autosave.journal(); if (r) Autosave.run();
  },
  /** Did another tab take over while this one was frozen (fresh foreign heartbeat, our heartbeat replaced, or a live claim)? */
  lostDuringGap() {
    const c = this.readKey(CLAIM_KEY), h = this.readKey(HEARTBEAT_KEY);
    const moved = this.beatStored && (!h || h.id !== this.id || h.t !== this.lastBeat); // R7-MN3: someone else wrote (or removed) the heartbeat since our last beat
    return this.heartbeatFresh() || moved || foreignClaim(c, this.id);
  },
  endVerify() { this.verifying = false; this.echoed = false; this.vseq++; if (this.vch) { try { this.vch.close(); } catch (e) { /* ignore */ } this.vch = null; } },
  stepDown() {
    if (!this.owner && Autosave.paused) return;
    const dirty = Autosave.isDirty(); // R7-MJ1: held / unsaved edits stay on screen, so takeover must ask before loading over them
    this.owner = false; this.byeAt = 0; this.endVerify(); Autosave.deferJournal = Autosave.deferRun = false; if (dirty) Autosave.pausedEdits = true;
    releaseWaiters();
    Autosave.paused = true; clearInterval(this.beatTimer); this.beatTimer = 0; clearTimeout(Autosave.timer); Autosave.timer = 0; Autosave.journalQueued = false;
    Autosave.pausedShown = true; Autosave.setStatus('error', 'Another tab is editing; autosave paused here'); if (!$('#tabNotice')) this.showNotice(); this.watch();
    if (dirty) this.noteUnsaved();
  },
};
