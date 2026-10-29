/** Editor lock: taking over when the editing tab is gone (mixed into EditorLock). */
import { isDirty } from '../core/clean-state.js';
import { Core } from '../core/editor-core.js';
import { ready } from '../ready.js';
import { announce } from '../ui/announce.js';
import { view } from '../ui/canvases.js';
import { $, el, isTextEntry } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { Autosave } from './autosave.js';
import { BYE_GRACE_MS, BYE_WINDOW_MS } from './keys.js';

/** The stored autosave record (JSON text), or null. */
async function latestRecord() {
  try { return await Autosave.restore(); } catch (e) { return null; }
}
function recordToken(rec) {
  try { const t = rec && JSON.parse(rec).journalToken; if (typeof t === 'string') return t; } catch (e) { /* unreadable record */ }
  return '';
}
/** Load the latest autosave (and its journal) over this tab's document. */
function loadLatest(rec) {
  if (!rec) return false;
  Autosave.restoring = true;
  try {
    const o = JSON.parse(rec); Core.load(o); if (typeof o.name === 'string') $('#docName').value = o.name.slice(0, 64);
    if (typeof o.journalToken === 'string' && o.journalToken) { Autosave.saved = { token: o.journalToken, refs: Core.log.slice(), foldedAt: Core.folded, keep: Core.log.length, cursor: Core.cursor, name: $('#docName').value.slice(0, 64) }; Autosave.replayJournal(o.journalToken); }
    return true;
  } catch (err) { console.warn('takeover: could not load latest autosave:', err.message); return false; }
  finally { Autosave.restoring = false; }
}
/** R8-NT3: never take focus from a text field the user is typing in: announce the prompt, and move focus to Keep only
 *  once they leave the field (OSH-33 still applies everywhere else: the prompt takes focus).
 *  R9-NT3: only when focus would otherwise fall to <body>; a Tab or a click on the canvas or a control keeps focus there. */
function focusKeepLater(ae, msg) {
  announce('Another tab question: ' + msg.textContent + ' Leave this field to answer (Keep this tab\u2019s version is the default).');
  const later = () => {
    ae.removeEventListener('blur', later);
    setTimeout(() => {
      const k = $('#takeoverKeep'), now = document.activeElement;
      if (k && k.isConnected && (!now || now === document.body)) k.focus();
    }, 0);
  };
  ae.addEventListener('blur', later);
}
function keepLoadMessage(closed) {
  // R8-MN2: after a Save (Ctrl+S) the edits are in a file, so say so instead of calling them unsaved
  const own = isDirty() ? 'This tab has its own unsaved edits: keep them, or load the latest autosave instead?' : 'This tab has its own edits (saved to a file, not autosaved): keep them here, or load the latest autosave instead?';
  const msg = el('span', 'msg', (closed ? 'The other tab closed. ' : 'No tab is editing this document right now. ') + own); msg.id = 'tabNoticeMsg';
  return msg;
}

/** Mixin: `this` is the composed host object. @type {Record<string, any>} */
export const takeoverMethods = {
  async takeOver() {
    const t0 = Date.now(); // OSH-37: a 'bye' counts only if it came just before this takeover
    this.becomeOwner(); // F1: answer "here" and heartbeat BEFORE the async restore, so no other paused tab can also take over
    await ready; // never race the boot-time restore
    const rec = await latestRecord();
    const take = { rec, recToken: recordToken(rec) };
    const closed = await this.awaitBye(t0);
    if (!Autosave.pausedEdits) { const ok = loadLatest(rec); this.unpause(!ok, take.recToken); toast((closed ? 'The other tab closed' : 'No other tab is editing') + '; this tab is now editing' + (ok ? ' (latest autosave loaded)' : '')); return; }
    this.askKeepOrLoad(closed, take);
  },
  /** R7b-MN2 + OSH-37: in every mode, say the other tab closed only when it said goodbye (its pagehide 'bye'); a Web Locks
   *  hand-over also happens when the holder crashed, and a fallback takeover after a crash or a shared suspend has no 'bye'.
   *  Web Locks can grant the lock before the 'bye' message arrives, so wait for it briefly there. */
  async awaitBye(t0) {
    const byeSeen = () => this.byeAt > 0 && this.byeAt >= t0 - BYE_WINDOW_MS;
    if (this.mode !== 'fallback' && !byeSeen()) for (let w = 0; w < BYE_GRACE_MS && !byeSeen(); w += 25) await new Promise(r => setTimeout(r, 25));
    const closed = byeSeen(); this.byeAt = 0;
    return closed;
  },
  unpause(keepOwn, recToken) {
    const n = $('#tabNotice'), hadFocus = n && n.contains(document.activeElement); if (n) n.remove();
    Autosave.paused = false; Autosave.pausedEdits = false; this.owner = true;
    if (hadFocus) { const r = this.promptReturn; this.promptReturn = null; (r && r.isConnected && r !== document.body && r.offsetParent !== null ? r : view).focus(); } // OSH-33: back where the user was, else the canvas
    if (keepOwn) Autosave.onReset(recToken); // N-a: this tab's version becomes the autosave; journaled against the other tab's record right away
    else Autosave.setStatus('idle', 'Now editing here (latest autosave loaded)');
  },
  /** This tab has its own edits: let the user choose rather than silently discarding either version. */
  askKeepOrLoad(closed, take) {
    const n = $('#tabNotice') || (this.showNotice(), $('#tabNotice'));
    n.classList.add('ask'); n.setAttribute('role', 'alertdialog'); n.setAttribute('aria-labelledby', 'tabNoticeMsg');
    const msg = keepLoadMessage(closed);
    // UX: Keep (the safe choice) comes first and is the default, so a quick click or Enter never discards this tab's edits
    const b = el('button', 'primary', 'Keep this tab\u2019s version (replace the saved one)'); b.id = 'takeoverKeep'; b.onclick = () => this.unpause(true, take.recToken);
    const a = el('button', '', 'Load latest autosave (discard this tab\u2019s edits)'); a.id = 'takeoverLoad'; a.onclick = () => { loadLatest(take.rec); this.unpause(false, take.recToken); };
    n.replaceChildren(msg, b, a);
    Autosave.pausedShown = true; Autosave.setStatus('error', closed ? 'Other tab closed: choose Keep or Load (autosave paused)' : 'No tab is editing: choose Keep or Load (autosave paused)'); // OSH-36
    const ae = document.activeElement; this.promptReturn = ae && !n.contains(ae) ? ae : this.promptReturn;
    if (isTextEntry(ae)) focusKeepLater(ae, msg);
    else b.focus(); // OSH-33: the prompt takes focus
  },
};
