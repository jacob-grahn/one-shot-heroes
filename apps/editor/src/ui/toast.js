/** Transient toast messages. */
import { $, el } from './dom.js';

export let toastT = 0;
export function toast(msg) { let t = $('#toast'); if (!t) { t = el('div'); t.id = 'toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); document.body.appendChild(t); } t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200); }
