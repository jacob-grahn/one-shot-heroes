/** Screen-reader announcement (visually hidden live region): cursor position, colour, layer and frame changes. */
import { $ } from './dom.js';

export let announceT = 0;
export function announce(msg) { const r = $('#srStatus'); if (!r) return; clearTimeout(announceT); announceT = setTimeout(() => { r.textContent = msg; }, 30); }
