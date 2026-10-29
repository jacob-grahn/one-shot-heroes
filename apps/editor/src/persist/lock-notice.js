/** Editor lock notices: the "another tab is editing" banner (mixed into EditorLock). */
import { $, el } from '../ui/dom.js';
import { placeNotice } from '../ui/notice.js';

/** Mixin: `this` is the composed host object. @type {Record<string, any>} */
export const noticeMethods = {
  showNotice() {
    const n = el('div', 'tab-notice'); n.id = 'tabNotice'; n.setAttribute('role', 'alert');
    n.append(el('span', 'msg', 'Another tab is editing this document. Autosave is paused here so it won\u2019t overwrite that tab\u2019s work; use Save (Ctrl+S) to keep changes made in this tab.'));
    const x = el('button', '', '&times;'); x.setAttribute('aria-label', 'Dismiss'); x.onclick = () => n.remove(); n.append(x);
    document.body.prepend(n); placeNotice();
  },
  /** OSH-36: say "use Save" once, when a stepped-down tab has edits that are saved nowhere. */
  noteUnsaved() {
    if (!$('#tabNotice') || $('#tabNotice .unsaved')) return;
    const m = $('#tabNotice .msg'); if (m) m.textContent = 'Another tab is editing this document, so autosave is paused here.';
    const u = el('strong', 'unsaved', ' This tab has edits that are not saved anywhere: use Save (Ctrl+S) to keep them.'); $('#tabNotice').insertBefore(u, $('#tabNotice button'));
  },
};
