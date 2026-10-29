/** DOM helpers. */

/** Query one element. Typed loosely: callers know which element kind each selector returns.
 * @type {(s: string) => any} */
export const $ = s => document.querySelector(s);
/** @type {(tag: string, cls?: string, html?: string) => any} */
export const el = (tag, cls, html) => { const e = /** @type {any} */ (document.createElement(tag)); if (tag === 'button') e.type = 'button'; if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
/** R8-NT3: an element the user types text into (text-like input, textarea, contenteditable). */
export function isTextEntry(e) { if (!e || e === document.body) return false; if (e.isContentEditable || e.tagName === 'TEXTAREA') return true;
  return e.tagName === 'INPUT' && /^(text|search|email|url|tel|password|number|)$/i.test(e.getAttribute('type') || ''); }
