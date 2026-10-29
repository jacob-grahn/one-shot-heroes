/** Apply wrapper for UI-originated ops, and the hidden-layer guard for drawing tools. */
import { Core } from '../core/editor-core.js';
import { modalErr, modalIsOpen } from './modal.js';
import { Cur, doc } from './state/context.js';
import { toast } from './toast.js';

/* ---------- apply wrapper for UI-originated ops ---------- */
export function doOp(op) {
  doOp.failed = false;
  try { return Core.apply(op, 'user'); }  // UI edits are by the human user
  catch (err) { doOp.failed = true; toast(err.message); if (modalIsOpen()) modalErr(err.message); console.warn(err.message); return null; }
}
/** Set by every doOp() call: true when the op was rejected. @type {boolean | undefined} */
doOp.failed;
/** U7: drawing tools refuse to paint on a hidden layer (as Aseprite does) instead of writing pixels nobody can see. */
export function layerHiddenBlock() {
  const l = doc().layers[Core.layerIndex(Cur.layer)];
  if (l && !l.visible) { toast('Layer "' + l.name + '" is hidden. Show it (eye button in Layers) to draw on it.'); return true; }
  return false;
}
