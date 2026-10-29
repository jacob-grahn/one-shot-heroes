/** Entry point: boot. */
// Side-effect modules (event wiring). Listeners on each target (element / window / document, per event type) are registered
// in the single-file build's order; the order across different targets changed (ES modules evaluate dependencies first),
// which doesn't affect dispatch because those listeners are independent.
import './ui/render-queue.js';
import './ui/stroke.js';
import './ui/selection.js';
import './ui/pointer.js';
import './ui/kbd-cursor.js';
import './ui/keyboard.js';
import './ui/tools-panel.js';
import './ui/palette-panel.js';
import './ui/layers-panel.js';
import './ui/timeline.js';
import './ui/preview.js';
import './ui/modal.js';
import './ui/export.js';
import './ui/actions.js';
import './ui/notice.js';
import './ui/recover.js';
import './ui/refresh.js';
import './persist/autosave.js';
import './persist/editor-lock.js';
import './api/public-api.js';
import { makeDoc } from './core/document.js';
import { Core } from './core/editor-core.js';
import { Autosave } from './persist/autosave.js';
import { EditorLock } from './persist/editor-lock.js';
import { readyResolve } from './ready.js';
import { $ } from './ui/dom.js';
import { pvLoop, resetPreview, togglePlay } from './ui/preview.js';
import { syncUndoButtons } from './ui/recover.js';
import { refreshNow } from './ui/refresh.js';
import { toast } from './ui/toast.js';
import { renderTools, syncOptions } from './ui/tools-panel.js';
import { fitView } from './ui/zoom.js';
import { DEFAULT_PALETTE } from '@osh/palette';

/** Restore the autosave (and replay its journal). restored: '' (nothing), 'ok', or 'partial' (op log invalid). */
async function restoreAutosave() {
  /** @type {'' | 'ok' | 'partial'} */
  let restored = '', journalOps = -1;
  Autosave.restoring = true; // Core.load's reset must not discard the journal we are about to replay
  try {
    const rec = await Autosave.restore();
    if (rec) {
      const o = JSON.parse(rec); const r = Core.load(o); if (typeof o.name === 'string') $('#docName').value = o.name.slice(0, 64); restored = r.replayed ? 'ok' : 'partial';
      if (typeof o.journalToken === 'string' && o.journalToken) journalOps = replaySaved(o.journalToken);
    }
  } catch (err) { console.warn('autosave restore failed:', err.message); toast('Could not restore autosave: ' + err.message); }
  Autosave.restoring = false;
  return { restored, journalOps };
}
function replaySaved(token) {
  Autosave.saved = { token, refs: Core.log.slice(), foldedAt: Core.folded, keep: Core.log.length, cursor: Core.cursor, name: $('#docName').value.slice(0, 64) };
  try { return Autosave.replayJournal(token); } catch (err) { console.warn('journal replay failed:', err.message); }
  return -1;
}
function restoredText(restored, journalOps) {
  if (!restored) return '';
  return 'Restored autosave' + (journalOps > 0 ? ' + ' + journalOps + ' recent edit' + (journalOps > 1 ? 's' : '') : '');
}
function announceRestore(restored) {
  if (restored === 'ok') toast('Restored autosave'); else if (restored === 'partial') toast('Restored autosave; op log was invalid, provenance unknown');
}
async function takeLock() {
  EditorLock.listen();
  Autosave.paused = !(await EditorLock.acquire()); if (!Autosave.paused) EditorLock.becomeOwner();
  if (Autosave.paused) { EditorLock.showNotice(); }
}

/* ===== boot ===== */
(async function boot() {
  Autosave.init();
  const testMaxOps = Number(new URLSearchParams(location.search).get('testMaxOps')); // test hook: lower the history cap (N1 test)
  if (Number.isInteger(testMaxOps) && testMaxOps >= 10) Core.maxOps = testMaxOps;
  renderTools(); syncOptions();
  await takeLock();
  const { restored, journalOps } = await restoreAutosave();
  if (!restored) Core.reset(makeDoc(32, 32, DEFAULT_PALETTE));
  refreshNow(); fitView(); syncUndoButtons(); togglePlay(); togglePlay(); resetPreview(); requestAnimationFrame(pvLoop);
  Autosave.setStatus(Autosave.paused ? 'error' : 'idle', Autosave.paused ? 'Another tab is editing; autosave paused here' : restoredText(restored, journalOps));
  if (journalOps > 0 && !Autosave.paused) Autosave.schedule();
  announceRestore(restored);
  Autosave.pausedEdits = false; // boot's own restore/reset is not a user edit
  readyResolve(true);
})();
