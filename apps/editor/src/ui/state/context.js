/** Editing context: the current document and the current layer, frame and frame range. */
import { Core } from '../../core/editor-core.js';

export const Cur = { layer: 'L1', frame: 0, range: null }; // range = [a,b] selected frames (inclusive)
export const doc = () => Core.doc;
export const curFrameId = () => doc().frames[Cur.frame].id;
export const curCel = () => doc().cels[Cur.layer + ':' + curFrameId()];
