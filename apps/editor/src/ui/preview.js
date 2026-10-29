/** Animation preview (fixed 15 fps). */
import { compositeRGBA } from '../core/composite.js';
import { putRGBA } from './canvases.js';
import { $ } from './dom.js';
import { hooks } from './hooks.js';
import { doc } from './state/context.js';
import { PvS } from './state/preview.js';
import { FRAME_MS, animSequence } from '@osh/timing';

/* ---------- preview (fixed 15 fps) ---------- */
export const pv1 = $('#pv1'), pvN = $('#pvN'), pvCanvas = document.createElement('canvas'), pvCtx = pvCanvas.getContext('2d');
export const PV = { step: 0, last: 0, ticks: 0, tickTimes: [] };
export function resetPreview() { PV.step = 0; PV.last = performance.now(); PV.tickTimes = []; drawPreview(); }
export function togglePlay() { PvS.pvPlaying = !PvS.pvPlaying; $('#pvPlay').innerHTML = PvS.pvPlaying ? '&#x275A;&#x275A;' : '&#x25B6;'; PV.last = performance.now(); }
export function renderPvSelect() {
  const s = $('#pvAnim'); s.replaceChildren(new Option('All frames', ''), ...doc().animations.map(a => new Option(a.name, a.name))); s.value = PvS.pvAnim;
}
$('#pvAnim').onchange = e => { PvS.pvAnim = e.target.value; resetPreview(); hooks.renderTimeline(); };
$('#pvPlay').onclick = togglePlay;
$('#pvScale').onchange = e => { PvS.pvScale = +e.target.value; drawPreview(); };
$('#pvBg').onchange = e => { PvS.pvBg = e.target.value; drawPreview(); };
export function paintBg(ctx, w, h, s) {
  if (PvS.pvBg === 'checker') { for (let y = 0; y < h; y += 4 * s) for (let x = 0; x < w; x += 4 * s) { ctx.fillStyle = ((x + y) / (4 * s)) % 2 ? '#9a9a9a' : '#c9c9c9'; ctx.fillRect(x, y, 4 * s, 4 * s); } return; }
  if (PvS.pvBg === 'dark') { ctx.fillStyle = '#1a1c2c'; ctx.fillRect(0, 0, w, h); return; }
  if (PvS.pvBg === 'sky') { ctx.fillStyle = '#41a6f6'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#73eff7'; ctx.fillRect(0, h * 0.6, w, h); return; }
  ctx.fillStyle = '#73eff7'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#38b764'; ctx.fillRect(0, h - 3 * s, w, 3 * s);
}
export function drawPreview() {
  const d = doc(), seq = animSequence(d, PvS.pvAnim); if (!seq.length) { $('#pvInfo').textContent = 'empty'; return; }
  const fi = seq[PV.step % seq.length], s = PvS.pvScale;
  putRGBA(pvCanvas, pvCtx, compositeRGBA(d, fi), d);
  for (const [cv, sc] of [[pv1, 1], [pvN, s]]) {
    if (cv.width !== d.width * sc || cv.height !== d.height * sc) { cv.width = d.width * sc; cv.height = d.height * sc; }
    const c = cv.getContext('2d'); c.imageSmoothingEnabled = false; paintBg(c, cv.width, cv.height, sc); c.drawImage(pvCanvas, 0, 0, cv.width, cv.height);
  }
  const maxH = innerHeight < 760 ? 112 : 232, maxW = Math.min(232, maxH * d.width / d.height), shown = Math.min(d.width * s, maxW); /* short screens: keep the layers panel on screen (OSH-11) */ pvN.style.width = shown + 'px'; pvN.style.height = (shown * d.height / d.width) + 'px';
  const n1 = Math.min(d.width, maxW); pv1.style.width = n1 + 'px'; pv1.style.height = (n1 * d.height / d.width) + 'px';
  $('#pvInfo').textContent = `${PvS.pvAnim || 'all'} ${(PV.step % seq.length) + 1}/${seq.length} · f${fi + 1}`;
}
export function pvLoop(now) {
  if (PvS.pvPlaying) {
    if (now - PV.last > 500) PV.last = now; // tab was hidden: resync instead of fast-forwarding
    let advanced = false;
    while (now - PV.last >= FRAME_MS) { PV.last += FRAME_MS; PV.step++; PV.ticks++; advanced = true; PV.tickTimes.push(now); if (PV.tickTimes.length > 120) PV.tickTimes.shift(); }
    if (advanced) drawPreview();
  }
  requestAnimationFrame(pvLoop);
}

