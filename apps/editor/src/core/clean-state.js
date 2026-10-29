/** Clean / unsaved tracking: has the document changed since the last Save, Open or New. */
import { Core } from './editor-core.js';

export const hasContent = () => Core.log.length > 0 || Core.provenance().pixelCount > 0;
/** Unsaved = edited since the last Save / Open / New (a restored autosave counts as unsaved). */
export const Clean = { /** @type {{ base: any, top: any } | null} */ mark: null };
export function markClean() { Clean.mark = { base: Core.base, top: Core.cursor ? Core.log[Core.cursor - 1] : null }; }
export function isDirty() { if (!hasContent()) return false; if (!Clean.mark) return true; return Clean.mark.base !== Core.base || Clean.mark.top !== (Core.cursor ? Core.log[Core.cursor - 1] : null); }
