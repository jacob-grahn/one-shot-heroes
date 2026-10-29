/** Top bar actions. */
import { loadExample } from '../api/example.js';
import { isDirty, markClean } from '../core/clean-state.js';
import { Core } from '../core/editor-core.js';
import { doOp } from './do-op.js';
import { $, el } from './dom.js';
import { buildSheet, capNote, dataURLtoBlob, download, exportScale, fname, frameCanvas, scaledName, sheetLayout, sheetLimitMsg } from './export.js';
import { gotoFrame } from './frames.js';
import { hooks } from './hooks.js';
import { KEYMAP } from './kbd-cursor.js';
import { modal, modalErr } from './modal.js';
import { Recover, newDocument, replaceDocument, uiRedo, uiUndo } from './recover.js';
import { commitFloating } from './selection.js';
import { Cur, curFrameId, doc } from './state/context.js';
import { Sel } from './state/selection.js';
import { syncCtx } from './sync-ctx.js';
import { toast } from './toast.js';
import { fitView } from './zoom.js';
import { PALETTES } from '@osh/palette';

/* ---------- actions ---------- */
export const act = {
  new() {
    modal(`<h2 id="mTitle">New sprite</h2>
      <label for="nSize">Size</label><div class="row"><select id="nSize">${[8, 16, 24, 32, 48, 64].map(n => `<option value="${n}x${n}" ${n === 32 ? 'selected' : ''}>${n}×${n}</option>`).join('')}<option value="192x108">192×108 (full game screen)</option><option value="custom">Custom…</option></select>
      <input type="number" id="nW" min="1" max="256" value="32" style="width:60px" aria-label="Width"> × <input type="number" id="nH" min="1" max="256" value="32" style="width:60px" aria-label="Height"></div>
      <label for="nPal">Palette</label><select id="nPal">${Object.keys(PALETTES).map(n => `<option>${n}</option>`).join('')}</select>
      <p class="small">Sizes 1–256. The game screen is 192×108; entities are usually up to 32×32. This replaces the current sprite; Ctrl+Z (or Undo) brings it back.</p><p class="small warn hidden" id="nDirty">Your current sprite has changes that are not saved to a file.</p>`, () => {
      const w = +$('#nW').value, h = +$('#nH').value;
      if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 256 || h > 256) { toast('Width and height must be whole numbers 1–256'); modalErr('Width and height must be whole numbers 1–256'); return false; }
      replaceDocument(() => newDocument(w, h, $('#nPal').value), 'New sprite');
    }, 'Create');
    $('#nDirty').classList.toggle('hidden', !isDirty());
    $('#nSize').onchange = e => { if (e.target.value !== 'custom') { const [w, h] = e.target.value.split('x'); $('#nW').value = w; $('#nH').value = h; } };
  },
  open() { const fi = $('#fileInput'); fi.value = ''; fi.onchange = async () => { try { const txt = await fi.files[0].text(); let r = /** @type {any} */ (null); replaceDocument(() => { r = Core.load(txt); }, 'Opened file'); $('#docName').value = fi.files[0].name.replace(/\.json$/i, '').replace(/\.osh$/i, '').slice(0, 64); markClean(); Sel.sel = Sel.floating = null; fitView(); toast((r.replayed ? 'Opened' : 'Opened, but the op log was invalid: provenance unknown') + (Recover.prev ? ' (Ctrl+Z brings back the previous sprite)' : '')); } catch (err) { toast('Open failed: ' + err.message); } }; fi.click(); },
  save() { const o = Core.save(); o.name = $('#docName').value; download(fname() + '.osh.json', JSON.stringify(o), 'application/json'); markClean(); toast('Saved ' + fname() + '.osh.json'); },
  exportPng() { // U5 scale; U19 explained file name (no frame suffix for a 1-frame sprite)
    const d = doc(), sc = exportScale(d.width, d.height), multi = d.frames.length > 1;
    const name = fname() + (multi ? '-f' + (Cur.frame + 1) : '') + (sc > 1 ? '-' + sc + 'x' : '') + '.png';
    download(name, dataURLtoBlob(frameCanvas(Cur.frame, sc).toDataURL('image/png')));
    toast('Exported ' + (multi ? 'frame ' + (Cur.frame + 1) + ' of ' + d.frames.length : 'the sprite') + (sc > 1 ? ' at ' + sc + '×' : '') + ' as ' + name + capNote(sc, d.width, d.height));
  },
  exportSheet() { const d = doc(), n = d.frames.length, L = sheetLayout(), sw = L.cols * d.width, sh = L.rows * d.height;
    if (L.maxScale < 1) { toast('Can\u2019t export: ' + sheetLimitMsg(1)); return; } // R7-MN4: same rule as renderSheet
    const sc = exportScale(sw, sh), base = scaledName(sc); const { canvas, meta } = buildSheet(sc); download(base + '.png', dataURLtoBlob(canvas.toDataURL('image/png'))); setTimeout(() => download(base + '.json', JSON.stringify(meta, null, 2), 'application/json'), 300); toast('Exported sheet ' + base + '.png + .json (' + n + ' frame' + (n > 1 ? 's' : '') + (sc > 1 ? ', ' + sc + '×' : '') + ', Aseprite-compatible JSON' + capNote(sc, sw, sh) + ')'); },
  undo() { uiUndo(); }, redo() { uiRedo(); },
  example() { // OSH-04 / U3: confirm when the current sprite has unsaved changes; either way Ctrl+Z brings it back
    if (!isDirty()) { replaceDocument(loadExample, 'Example loaded', { floor: true }); return; }
    modal('<h2 id="mTitle">Replace your sprite with the example?</h2><p class="small">Your current sprite has changes that are not saved to a file. Loading the example replaces it; you can bring it back with Ctrl+Z (Undo).</p>', () => { replaceDocument(loadExample, 'Example loaded', { floor: true }); }, 'Load example');
  },
  resize() { // canvas size dialog (the "resize" op existed only in the API)
    const d = doc();
    modal(`<h2 id="mTitle">Resize canvas</h2><div class="row"><label for="rzW">Width</label><input type="number" id="rzW" min="1" max="256" style="width:70px"><label for="rzH">Height</label><input type="number" id="rzH" min="1" max="256" style="width:70px"></div>
      <label for="rzA">Anchor (where the existing art stays)</label><select id="rzA"><option value="topleft">Top left</option><option value="center" selected>Center</option></select>
      <p class="small">Applies to every layer and frame. Pixels outside the new size are cropped; Ctrl+Z undoes it.</p>`, () => {
      const w = +$('#rzW').value, h = +$('#rzH').value;
      if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 256 || h > 256) { modalErr('Width and height must be whole numbers 1–256'); return false; }
      commitFloating(); Sel.sel = null; doOp({ op: 'resize', width: w, height: h, anchor: $('#rzA').value }); if (doOp.failed) return false; fitView();
    }, 'Resize');
    $('#rzW').value = d.width; $('#rzH').value = d.height; $('#rzW').select();
  },
  help() {
    modal('<h2 id="mTitle">Keyboard shortcuts</h2><div class="keys"></div><p class="small">Animations play at a fixed 15 fps. Every edit is an op in the log; see <code>window.pixelEditor</code> for the scripting/AI API.</p>');
    const box = $('#mbody .keys'); for (const [k, v] of KEYMAP) { const r = el('div'), a = el('span'), b = el('kbd'); a.textContent = v; b.textContent = k; r.append(a, b); box.appendChild(r); }
  },
  frAdd() { const op = doOp({ op: 'add_frame', index: Cur.frame + 1 }); if (op) gotoFrame(Cur.frame + 1); },
  frDup() { const op = doOp({ op: 'add_frame', index: Cur.frame + 1, copyOf: curFrameId() }); if (op) gotoFrame(Cur.frame + 1); },
  layAdd() { const op = doOp({ op: 'add_layer', index: Core.layerIndex(Cur.layer) + 1 }); if (op) { Cur.layer = op.id; syncCtx(); hooks.refresh(); } },
};
/** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#topbar [data-act]')).forEach(b => b.onclick = () => act[b.dataset.act]());

