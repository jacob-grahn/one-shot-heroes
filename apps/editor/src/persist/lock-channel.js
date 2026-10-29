/** Editor lock: the BroadcastChannel every editing tab answers on (mixed into EditorLock). */

const isHello = (d, id) => d === 'hello' || (typeof d === 'string' && d.startsWith('hello:') && d !== 'hello:' + id); // 'hello:<id>': a post-gap echo (MN3); not our own
const isBye = (d, id) => d === 'bye' || (typeof d === 'string' && d.startsWith('bye:') && d !== 'bye:' + id);

/** Mixin: `this` is the composed host object. @type {Record<string, any>} */
export const channelMethods = {
  /** Every editing tab answers "here" on the BroadcastChannel, whichever way it got ownership, so the fallback check also sees lock holders. */
  listen() {
    if (typeof BroadcastChannel !== 'function') return;
    const ch = new BroadcastChannel('osh-pixel-editor');
    ch.onmessage = e => this.onChannel(e.data, ch);
    window.addEventListener('pagehide', () => { if (this.owner) { this.clearBeat(); ch.postMessage('bye:' + this.id); } });
    this.ch = ch;
  },
  onChannel(d, ch) {
    if (isHello(d, this.id) && this.owner) { this.answerHello(ch); return; }
    // R9-MN1 (OSH-37): note a 'bye' even once this tab owns the lock: Web Locks can grant it before the old editor's 'bye'
    // arrives, and takeOver's awaitBye grace wait reads byeAt after becomeOwner() (step-down and awaitBye clear it)
    if (isBye(d, this.id)) { this.byeAt = Date.now(); if (this.watching && !this.owner) this.probe(); return; } // N-b: the editing tab is going away
    if (this.owner) return;
    if (typeof d === 'string' && d.startsWith('owner:')) this.byeAt = 0; // OSH-37: a new editor took over, so an earlier 'bye' no longer describes the current one
  },
  /** R7-MJ2: a hello reaching us proves this tab runs: answer even during the post-gap hold, but beat only when writes are allowed. */
  answerHello(ch) {
    const w = this.writeCheck(); if (w === 'gone') return;
    // R7b-MN2: while verifying, answer 'here-v:<id>': a paused tab still sees an editor (and won't take over), but another
    // verifying owner ignores it, so two owners waking together don't both step down; the end-of-hold heartbeat
    // check keeps exactly one (the tab whose heartbeat is the stored one)
    ch.postMessage((w === 'ok' ? 'here:' : 'here-v:') + this.id); if (w === 'ok') this.beat();
  },
};
