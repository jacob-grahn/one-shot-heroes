/** Panel refresh, frame thumbnails and core event wiring. */
import { Core } from '../core/editor-core.js';
import { Autosave } from '../persist/autosave.js';
import { $, el } from './dom.js';
import { draw } from './draw.js';
import { hooks } from './hooks.js';
import { kcClamp } from './kbd-cursor.js';
import { renderLayers } from './layers-panel.js';
import { renderPalette } from './palette-panel.js';
import { drawPreview, renderPvSelect } from './preview.js';
import { Recover, syncRotateButtons, syncUndoButtons } from './recover.js';
import { KC } from './state/key-cursor.js';
import { syncCtx } from './sync-ctx.js';
import { markDirty } from './thumbs.js';
import { renderTimeline } from './timeline.js';

hooks.refresh = refresh; hooks.refreshNow = refreshNow;

/* ---------- refresh (coalesced to one per animation frame) ---------- */
export let refreshQueued = false;
export function refresh() { if (!refreshQueued) { refreshQueued = true; requestAnimationFrame(() => { refreshQueued = false; refreshNow(); }); } }
export function refreshNow() { if (!Core.doc) return; syncRotateButtons(); syncCtx(); renderPalette(); renderLayers(); renderTimeline(); renderPvSelect(); drawPreview(); renderProv(); draw(); }
export function renderProv() {
  const p = Core.provenance(), box = $('#prov'), b = el('b');
  box.replaceChildren(); box.append(p.ai ? `${p.aiPixelCount} of ${p.pixelCount} px AI-tagged · ` : '');
  b.textContent = { human: 'hand-drawn', ai: 'AI', unknown: 'unknown provenance' }[p.label];
  if (p.label === 'human') box.append(b.textContent); else box.append(b);
}
/** A reset or undo past a replacement clears recovery and keyboard-cursor state. */
function onCoreReset(e) {
  if (e.type === 'reset' && !Recover.swapping) { Recover.prev = Recover.next = null; Recover.floor = 0; KC.anchor = null; KC.pos = null; }
}
function scheduleAutosave(e) {
  if (e.type === 'reset' && !Autosave.paused && !Autosave.restoring && !Recover.swapping) Autosave.onReset(); else if (e.type !== 'reset' || !Recover.swapping) Autosave.schedule();
}
Core.internal.push(e => {
  if (e.type === 'undo' || e.type === 'redo' || e.type === 'reset') syncCtx(); // OSH-20: default layer/frame valid right away, not at the next frame
  if (e.type === 'op') Recover.next = null;                                      // a new edit ends the forward (redo) path
  onCoreReset(e);
  kcClamp(); // OSH-32: any size change (undo / redo of a resize, a document swap) keeps the keyboard cursor on the canvas
  markDirty(e.dirty); refresh(); syncUndoButtons();
  scheduleAutosave(e);
});
Core.onFold = n => { Recover.floor = Math.max(0, Recover.floor - n); /* N3: the floor is a log position; folding shifts it */ Autosave.journal(); if (!Autosave.paused) { clearTimeout(Autosave.timer); Autosave.timer = 0; Autosave.run(); } }; // R2: journal re-based via Core.folded; save the folded base right away

