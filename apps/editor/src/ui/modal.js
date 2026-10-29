/** Modal dialog and prompts. */
import { $ } from './dom.js';

/* ---------- modal / toast / files ---------- */
export let modalOk = null;
export let modalReturnFocus = null, modalReturnKey = null, lastDbl = { fk: null, t: 0 };
// OSH-34: a double-click (rename) re-renders its row, so remember the opener's data-fk key too and refocus by key
document.addEventListener('dblclick', /** @param {any} e */ e => { const t = e.target.closest && e.target.closest('[data-fk]'); lastDbl = { fk: t ? t.dataset.fk : null, t: Date.now() }; }, true);
// html must be a static template; anything data-derived is filled in afterwards with textContent.
export const modalIsOpen = () => !$('#modal').classList.contains('hidden');
/** Inline, announced validation message inside the open dialog (OSH-12 / U11). */
export function modalErr(msg) { const e = $('#mErr'); if (e) { e.textContent = msg || ''; e.classList.toggle('hidden', !msg); } }
function rememberReturnFocus() {
  const ae = /** @type {HTMLElement | null} */ (document.activeElement); modalReturnFocus = ae;
  modalReturnKey = (ae && ae !== document.body && ae.dataset && ae.dataset.fk) || (Date.now() - lastDbl.t < 1000 ? lastDbl.fk : null);
}
function focusFirstField(onOk) {
  const f = $('#mbody input,#mbody textarea,#mbody select'); if (f) { f.focus(); f.select && f.select(); } else (onOk ? $('#mOk') : $('#mCancel')).focus();
}
export function modal(html, onOk, okLabel = 'OK') {
  if (!modalIsOpen()) rememberReturnFocus();
  $('#mbody').innerHTML = html; modalErr(''); modalOk = onOk;
  const h = $('#mbody h2'); if (h && !h.id) h.id = 'mTitle'; /* OSH-13: every dialog is named by its heading */
  $('#mOk').textContent = okLabel; $('#mOk').classList.toggle('hidden', !onOk); $('#mCancel').textContent = onOk ? 'Cancel' : 'Close'; $('#modal').classList.remove('hidden');
  focusFirstField(onOk);
}
export function closeModal() {
  $('#modal').classList.add('hidden'); modalOk = null;
  let t = modalReturnFocus && modalReturnFocus.isConnected && modalReturnFocus !== document.body ? modalReturnFocus : null;
  if (!t && modalReturnKey) t = [.../** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-fk]'))].find(x => x.dataset.fk === modalReturnKey && x.tabIndex >= -1 && x.offsetParent !== null) || null;
  if (t && t.focus) t.focus(); else if (modalReturnFocus && modalReturnFocus.focus) modalReturnFocus.focus();
}
$('#modal').addEventListener('keydown', e => { // focus trap
  if (e.key !== 'Tab') return;
  const f = [...$('#modal').querySelectorAll('button:not(.hidden),input,select,textarea')].filter(x => x.offsetParent !== null); if (!f.length) return;
  const i = f.indexOf(document.activeElement);
  if (e.shiftKey && i <= 0) { f[f.length - 1].focus(); e.preventDefault(); } else if (!e.shiftKey && i === f.length - 1) { f[0].focus(); e.preventDefault(); }
});
$('#mCancel').onclick = closeModal;
$('#mOk').onclick = () => { if (modalOk && modalOk() === false) return; closeModal(); };
$('#modal').onmousedown = e => { if (e.target.id === 'modal') closeModal(); };
export function ask(title, def, cb) {
  modal('<h2 id="mTitle"></h2><input type="text" id="askIn" spellcheck="false" maxlength="64" aria-labelledby="mTitle" aria-describedby="mErr">', () => {
    const v = $('#askIn').value.trim(); if (!v) { modalErr('Enter a name (1–64 characters).'); return false; }
    if (cb(v) === false) return false; // OSH-12: keep the dialog (and the text) when the op is rejected
  });
  $('#askIn').value = (def || '').slice(0, 64); $('#mTitle').textContent = title; $('#askIn').select();
}
