/** Render scheduler: coalesce redraw requests into one animation frame; marching ants tick while a selection exists. */
import { draw } from './draw.js';
import { Sel } from './state/selection.js';

export let renderQueued = false;
export function render() { if (!renderQueued) { renderQueued = true; requestAnimationFrame(() => { renderQueued = false; draw(); }); } }
setInterval(() => { if (Sel.sel || Sel.floating) render(); }, 120);
