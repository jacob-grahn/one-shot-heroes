/** Tool buttons and the options bar. */
import { TOOLS } from './defs.js';
import { $, el } from './dom.js';
import { render } from './render-queue.js';
import { commitFloating } from './selection.js';
import { KC } from './state/key-cursor.js';
import { Opts } from './state/options.js';
import { Tool } from './state/tool.js';
import { fitView, setZoom, zoomStep } from './zoom.js';

/* ---------- options bar & tools ---------- */
export function renderTools() {
  const nav = $('#tools'); nav.innerHTML = '';
  for (const [id, title, svg] of TOOLS) {
    if (id === 'sep') { nav.appendChild(el('div', 'tsep')); continue; }
    const b = el('button', Tool.tool === id ? 'on' : '', `<svg viewBox="0 0 24 24" aria-hidden="true">${svg}</svg>`); b.title = title; b.dataset.tool = id;
    b.setAttribute('aria-label', title); b.setAttribute('aria-pressed', String(Tool.tool === id));
    b.onclick = () => setTool(id); nav.appendChild(b);
  }
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#optbar .opt')).forEach(o => { if (o.dataset.for) o.style.display = o.dataset.for.split(',').includes(Tool.tool) ? '' : 'none'; });
}
export function syncOptions() {
  $('#optSize').value = Tool.size; $('#optPP').checked = Tool.pixelPerfect; $('#optFilled').checked = Tool.filled; $('#optContig').checked = Tool.contiguous;
  $('#optMirH').checked = Opts.mirH; $('#optMirV').checked = Opts.mirV; $('#optGrid').checked = Opts.grid; $('#optTile').checked = Opts.tile; $('#optOnion').checked = Opts.onion; render();
}
$('#optSize').onchange = e => { Tool.size = +e.target.value; render(); };
$('#optPP').onchange = e => Tool.pixelPerfect = e.target.checked;
$('#optFilled').onchange = e => Tool.filled = e.target.checked;
$('#optContig').onchange = e => Tool.contiguous = e.target.checked;
[['#optMirH', 'mirH'], ['#optMirV', 'mirV'], ['#optGrid', 'grid'], ['#optTile', 'tile'], ['#optOnion', 'onion']].forEach(([s, k]) => $(s).onchange = e => { Opts[k] = e.target.checked; render(); });
$('#zoomIn').onclick = () => setZoom(zoomStep(1)); $('#zoomOut').onclick = () => setZoom(zoomStep(-1)); $('#zoomFit').onclick = fitView;
export function setTool(t) { if (t !== 'select') commitFloating(); if (t !== Tool.tool) KC.anchor = null; Tool.tool = t; renderTools(); render(); }
