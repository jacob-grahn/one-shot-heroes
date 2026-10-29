/** One editing tab at a time: Web Locks, or a localStorage heartbeat fallback (the parts are mixed in below). */
import { hooks } from '../ui/hooks.js';
import { CLAIM_KEY, CLAIM_WAIT_MS } from './keys.js';
import { channelMethods } from './lock-channel.js';
import { foreignClaim, heartbeatMethods } from './lock-heartbeat.js';
import { noticeMethods } from './lock-notice.js';
import { takeoverMethods } from './lock-takeover.js';
import { verifyMethods } from './lock-verify.js';

/** One editing tab at a time (N4): the first tab holds a Web Lock for its lifetime; later tabs show a notice and never overwrite the autosave. */

export const EditorLock = Object.assign(/** @type {Record<string, any>} */ ({
  async acquire() {
    if (!(navigator.locks && navigator.locks.request)) return this.claim().then(ok => { if (!ok) this.watch(); return ok; });
    for (let i = 0; i < 4; i++) {
      const got = await this.tryOnce();
      if (got === 'error') return this.claim().then(ok => { if (!ok) this.watch(); return ok; }); // R4: lock API rejected (e.g. sandboxed frame): use the BroadcastChannel check, don't fail open
      if (got) { this.becomeOwner(); return true; }
      await new Promise(r => setTimeout(r, 100)); // a reloading tab may still hold it for a moment
    }
    this.queue();
    return false;
  },
  tryOnce() {
    return new Promise(res => {
      navigator.locks.request('osh-pixel-editor:editor', { ifAvailable: true }, lock => {
        if (!lock) { res(false); return null; }
        res(true); return new Promise(() => {}); // hold until the tab closes
      }).catch(() => res('error'));
    });
  },
  /** R3: wait in line for the lock; when the other tab closes, this tab takes over. */
  queue() {
    navigator.locks.request('osh-pixel-editor:editor', () => { this.takeOver(); return new Promise(() => {}); }).catch(() => { /* stay paused */ });
  },
  owner: false, byeAt: 0, promptReturn: null,
  mode: 'locks',
  /** Claim the editor role (fallback mode only). Resolves true only for the single winner. */
  async claim() {
    this.mode = 'fallback';
    if (this.heartbeatFresh()) return false;
    if (!(await this.fallback())) return false;                 // someone answered "here"
    if (foreignClaim(this.readKey(CLAIM_KEY), this.id)) return false; // another tab is claiming
    try { localStorage.setItem(CLAIM_KEY, JSON.stringify({ id: this.id, t: Date.now() })); } catch (e) { return !this.heartbeatFresh(); }
    await new Promise(r => setTimeout(r, CLAIM_WAIT_MS));
    const c2 = this.readKey(CLAIM_KEY);
    if (!c2 || c2.id !== this.id || this.heartbeatFresh()) return false; // lost the claim, or a winner is already beating
    this.becomeOwner(); // synchronous with the check: from here on we beat and answer "here"
    return true;
  },
  ch: null, watching: false, probing: false,
  /** N-b: a tab paused by the BroadcastChannel fallback (no usable Web Locks) polls for the editing tab and takes over when it's gone. */
  watch() {
    if (this.watching || typeof BroadcastChannel !== 'function') return;
    this.watching = true;
    const tick = () => { if (!this.watching) return; this.probe(); setTimeout(tick, 1000); };
    setTimeout(tick, 1000);
  },
  async probe() {
    if (this.probing || !this.watching || this.heartbeatFresh()) return; this.probing = true; // fresh heartbeat: the editor is alive (maybe busy)
    try {
      await new Promise(r => setTimeout(r, Math.random() * 150)); // spread simultaneous probes (the claim decides anyway)
      if (this.watching && await this.claim()) this.takeOver();
    } finally { this.probing = false; }
  },
  fallback() { // BroadcastChannel: ask whether another tab is already editing
    if (typeof BroadcastChannel !== 'function') return Promise.resolve(true); // nothing to coordinate with: degrade to editable
    const ch = new BroadcastChannel('osh-pixel-editor'); let other = false;
    // R7b-MN2: a verifying owner ('here-v:<id>') is alive too
    ch.onmessage = e => { if (typeof e.data === 'string' && (e.data === 'here' || e.data.startsWith('here:') || e.data.startsWith('here-v:'))) other = true; };
    ch.postMessage('hello');
    return new Promise(res => setTimeout(() => { ch.close(); res(!other); }, 150));
  },
}), heartbeatMethods, verifyMethods, channelMethods, takeoverMethods, noticeMethods);
hooks.editorLock = EditorLock;
