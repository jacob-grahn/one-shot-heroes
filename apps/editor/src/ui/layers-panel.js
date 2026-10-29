/** Layers panel. */
import { compositeRGBA } from '../core/composite.js';
import { Core } from '../core/editor-core.js';
import { announce } from './announce.js';
import { doOp } from './do-op.js';
import { $, el } from './dom.js';
import { ask } from './modal.js';
import { render } from './render-queue.js';
import { rebuildKeepingFocus, rovingKeys } from './roving.js';
import { commitFloating } from './selection.js';
import { Cur, doc } from './state/context.js';
import { syncCtx } from './sync-ctx.js';

/* ---------- layers ---------- */
function layerSelect(l) {
  const sel = el('span', 'lsel rv'); sel.dataset.fk = 'lay:' + l.id; sel.setAttribute('role', 'button'); sel.setAttribute('aria-pressed', String(l.id === Cur.layer));
  sel.setAttribute('aria-label', `Layer ${l.name}${l.visible ? '' : ' (hidden)'}${l.opacity < 1 ? ', opacity ' + Math.round(l.opacity * 100) + '%' : ''}. Enter selects, F2 renames`);
  return sel;
}
function layerEye(l) {
  const eye = el('button', 'eye' + (l.visible ? ' vis' : ''), l.visible ? '&#x25C9;' : '&#x25CB;'); eye.title = (l.visible ? 'Hide' : 'Show') + ' layer'; eye.dataset.fk = 'eye:' + l.id;
  eye.setAttribute('aria-label', (l.visible ? 'Hide layer ' : 'Show layer ') + l.name); eye.setAttribute('aria-pressed', String(!l.visible));
  eye.onclick = ev => { ev.stopPropagation(); doOp({ op: 'set_layer', layer: l.id, visible: !l.visible }); };
  return eye;
}
function layerThumb(d, l) {
  const th = el('canvas'); th.width = d.width; th.height = d.height; th.setAttribute('aria-hidden', 'true');
  th.getContext('2d').putImageData(new ImageData(compositeRGBA(d, Cur.frame, { onlyLayer: l.id }), d.width, d.height), 0, 0);
  return th;
}
function layerRow(d, l) {
  const row = el('div', 'lay' + (l.id === Cur.layer ? ' on' : ''));
  // the focusable "select this layer" control is a sibling of the eye button, not its parent (no nested interactive controls)
  const sel = layerSelect(l);
  const eye = layerEye(l);
  const th = layerThumb(d, l);
  const nm = el('span', 'nm'); nm.textContent = l.name; nm.title = 'Double-click (or F2) to rename';
  const rename = () => ask('Rename layer', l.name, v => { doOp({ op: 'set_layer', layer: l.id, name: v }); if (doOp.failed) return false; });
  nm.ondblclick = rename; sel.rename = rename;
  const op = el('span', 'op', l.opacity < 1 ? Math.round(l.opacity * 100) + '%' : '');
  sel.append(th, nm, op); row.append(eye, sel);
  row.onclick = () => { commitFloating(); Cur.layer = l.id; syncCtx(); renderLayers(); render(); };
  sel.activate = () => { row.onclick(); announce('Layer ' + l.name + ' selected'); };
  return row;
}
export function renderLayers() {
  const d = doc(), box = $('#layers');
  rebuildKeepingFocus(box, () => {
    box.innerHTML = '';
    for (let i = d.layers.length - 1; i >= 0; i--) box.appendChild(layerRow(d, d.layers[i]));
  }, 'lay:' + Cur.layer);
  $('#layOpacity').value = Math.round(d.layers[Core.layerIndex(Cur.layer)].opacity * 100);
}
rovingKeys($('#layers'));
$('#layOpacity').onchange = e => doOp({ op: 'set_layer', layer: Cur.layer, opacity: e.target.value / 100 });
$('#layOpacity').oninput = e => { $('#layOpacity').setAttribute('aria-valuetext', e.target.value + '%'); };

