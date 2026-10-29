/** Current-frame navigation and the selected frame range. */
import { hooks } from './hooks.js';
import { commitFloating } from './selection.js';
import { Cur, doc } from './state/context.js';
import { syncCtx } from './sync-ctx.js';

export function gotoFrame(i) { commitFloating(); Cur.frame = Math.max(0, Math.min(doc().frames.length - 1, i)); Cur.range = null; syncCtx(); hooks.refresh(); }
export function selectedFrames() { if (!Cur.range) return [Cur.frame]; const [a, b] = [Math.min(...Cur.range), Math.max(...Cur.range)]; const o = []; for (let i = a; i <= b; i++) o.push(i); return o; }
