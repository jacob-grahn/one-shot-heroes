/** Editor lock, fallback mode: the localStorage heartbeat and the write check (mixed into EditorLock). */
import { CLAIM_KEY, CLAIM_WAIT_MS, HEARTBEAT_KEY, HEARTBEAT_MS, HEARTBEAT_STALE_MS } from './keys.js';

/** A claim by another tab that is still recent enough to win. */
export const foreignClaim = (c, id) => !!c && c.id !== id && Math.abs(Date.now() - c.t) < CLAIM_WAIT_MS * 8;

/** Mixin: `this` is the composed host object. @type {Record<string, any>} */
export const heartbeatMethods = {
  /* F1: localStorage heartbeat. The editing tab writes {id, t} every second; a paused fallback tab takes over only when the
     heartbeat is stale (> 6 s, far above any long task), no tab answers "here", and it wins an atomic-enough claim
     (write the claim, wait, re-read it: the last writer wins, everyone else stays paused). */
  id: Math.random().toString(36).slice(2) + Date.now().toString(36), beatTimer: 0,
  readKey(k) { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v && typeof v.id === 'string' && typeof v.t === 'number' ? v : null; } catch (e) { return null; } },
  beat() { if (!this.owner) return; const t = Date.now(); try { localStorage.setItem(HEARTBEAT_KEY, JSON.stringify({ id: this.id, t })); this.beatStored = true; } catch (e) { this.beatStored = false; /* storage off: BroadcastChannel only */ } this.lastBeat = t; },
  lastBeat: 0, beatStored: false, verifying: false, echoed: false, vseq: 0, vch: null,
  clearClaim() { const c = this.readKey(CLAIM_KEY); if (c && c.id === this.id) try { localStorage.removeItem(CLAIM_KEY); } catch (e) { /* ignore */ } }, // the heartbeat now speaks for us
  clearBeat() { const h = this.readKey(HEARTBEAT_KEY); if (h && h.id === this.id) try { localStorage.removeItem(HEARTBEAT_KEY); } catch (e) { /* ignore */ } },
  heartbeatFresh() { const h = this.readKey(HEARTBEAT_KEY); return !!h && h.id !== this.id && Math.abs(Date.now() - h.t) < HEARTBEAT_STALE_MS; },
  becomeOwner() { const was = this.owner; this.owner = true; this.watching = false; this.beat(); this.clearClaim(); if (!was && this.ch) try { this.ch.postMessage('owner:' + this.id); } catch (e) { /* ignore */ } if (!this.beatTimer) this.beatTimer = setInterval(() => this.tickBeat(), HEARTBEAT_MS); },
  /** Heartbeat tick. In fallback mode, if another tab's fresh heartbeat replaced ours (this tab was frozen or suspended for
   *  longer than the stale threshold and another tab legitimately took over), step down instead of editing alongside it. */
  tickBeat() {
    if (!this.owner) return;
    if (this.writeCheck() === 'ok') this.beat();
  },
  /** N1 (fallback mode): may this tab still write as the editor?
   *  'ok'   : yes.
   *  'gone' : another tab's heartbeat is fresh (this tab was frozen past the stale threshold and that tab legitimately took
   *           over): step down; never beat, save or journal over it.
   *  'wait' : right after a gap long enough that another tab could have taken over. Everything is held while a
   *           'hello:<id>' echo goes out on the BroadcastChannel (R7-MN3: BroadcastChannel isn't cached, unlike the
   *           renderer's view of localStorage right after a freeze); any newer editor answers 'here' and we step down.
   *  'held' : no answer within ECHO_MS: journal writes are allowed again (R7-MN2), autosave and heartbeat stay held until
   *           the re-read after VERIFY_MS also shows our own heartbeat unchanged and no fresh foreign heartbeat or claim. */
  writeCheck() {
    if (this.mode !== 'fallback' || !this.owner) return 'ok';
    if (this.heartbeatFresh()) { this.stepDown(); return 'gone'; }
    if (this.verifying) return this.echoed ? 'held' : 'wait';
    if (Date.now() - this.lastBeat <= HEARTBEAT_STALE_MS - HEARTBEAT_MS) return 'ok'; // nobody can have seen us as stale yet
    this.verify();
    return 'wait';
  },
};
