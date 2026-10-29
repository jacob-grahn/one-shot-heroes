/** Placement of the fixed tab notice below the header. */
import { $ } from './dom.js';

/** R8-NT2: the fixed tab notice sits just below the header (never over New / Open / Save / the save status), following it
 *  when the header wraps (phones) or scrolls away. */
export let noticeRO = null;
export function placeNotice() { const n = $('#tabNotice'), tb = $('#topbar'); if (!n || !tb) return;
  if (!noticeRO && typeof ResizeObserver === 'function') { noticeRO = new ResizeObserver(placeNotice); noticeRO.observe(tb); } // the header grows when the status text wraps
  n.style.top = Math.max(8, Math.round(tb.getBoundingClientRect().bottom) + 6) + 'px'; }
window.addEventListener('resize', placeNotice); window.addEventListener('scroll', placeNotice, { passive: true });
