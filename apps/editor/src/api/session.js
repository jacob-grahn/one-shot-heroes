/** Author-bound op sessions and frozen copies for API results. */
import { Core } from '../core/editor-core.js';
import { AUTHORS } from '@osh/format/limits';
import { fail } from '@osh/format/validate';
import { deepFreeze } from '@osh/palette';

export const clone = v => JSON.parse(JSON.stringify(v));
export const frozen = v => deepFreeze(clone(v));

/** A session binds an author. Ops applied through it are logged with that author; callers cannot set author/ts/seq. */
export function Session(author) {
  if (!AUTHORS.includes(author)) fail('bad_author', 'author must be one of ' + AUTHORS.join(', '));
  return Object.freeze({
    author,
    /** Apply one op. Returns a frozen copy of the logged op, or null if it changed nothing. Throws OpError on invalid input (nothing is changed). */
    apply(op) { const r = Core.apply(op, author); return r ? frozen(r) : null; },
    applyAll(ops) { const r = Core.apply({ op: 'batch', ops }, author); return r ? frozen(r) : null; },
  });
}
