/** The visible canvas and the offscreen document / onion-skin canvases. */
import { $ } from './dom.js';

export const view = $('#view'), vctx = view.getContext('2d');
export const docCanvas = document.createElement('canvas'), dctx = docCanvas.getContext('2d');
export const onionCanvas = document.createElement('canvas'), octx = onionCanvas.getContext('2d');
export function putRGBA(canvas, ctx, rgba, size) { const w = size.width, h = size.height; if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; } ctx.putImageData(new ImageData(rgba, w, h), 0, 0); }
