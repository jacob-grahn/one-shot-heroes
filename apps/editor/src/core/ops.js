/** Op handlers (validate everything before mutating), by kind; `this` is Core. */
import { docOps } from './ops-doc.js';
import { frameOps } from './ops-frames.js';
import { pixelOps } from './ops-pixel.js';
import { transformOps } from './ops-transform.js';

export const OPS = Object.freeze(Object.assign(Object.create(null), pixelOps, transformOps, docOps, frameOps));
