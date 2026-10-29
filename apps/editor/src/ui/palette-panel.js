/** Palette panel. */
import { announce } from './announce.js';
import { doOp } from './do-op.js';
import { $, el } from './dom.js';
import { download } from './export.js';
import { modal, modalErr } from './modal.js';
import { rebuildKeepingFocus, rovingKeys } from './roving.js';
import { doc } from './state/context.js';
import { Paint } from './state/paint.js';
import { toast } from './toast.js';
import { normHex } from '@osh/format/validate';
import { PALETTES } from '@osh/palette';

/* ---------- palette ---------- */
export function swatchStyle(e, c) { if (c) { e.style.background = c; e.classList.remove('checker', 't'); } else { e.style.background = ''; e.classList.add('checker', 't'); } }
export const colourName = i => i === 0 ? '0, transparent' : i + ', ' + doc().palette[i];
export function renderPalette() {
  const d = doc(), box = $('#palette');
  rebuildKeepingFocus(box, () => {
    box.innerHTML = '';
    d.palette.forEach((c, i) => {
      const s = el('div', 'sw rv' + (i === Paint.primary ? ' p' : '') + (i === Paint.secondary ? ' s' : '')); swatchStyle(s, c);
      s.title = i === 0 ? '0: transparent' : `${i}: ${c}`; s.dataset.idx = i; s.dataset.fk = 'sw' + i; s.setAttribute('role', 'button');
      s.setAttribute('aria-label', 'Color ' + s.title + (i === Paint.secondary ? ' (secondary)' : '')); s.setAttribute('aria-pressed', String(i === Paint.primary));
      s.onmousedown = e => { if (e.button === 2) Paint.secondary = i; else Paint.primary = i; renderPalette(); };
      s.activate = e => { if (e.shiftKey) Paint.secondary = i; else Paint.primary = i; renderPalette(); announce((e.shiftKey ? 'Secondary' : 'Primary') + ' colour ' + colourName(i)); }; // OSH-09
      s.oncontextmenu = e => e.preventDefault();
      s.ondblclick = () => { if (i > 0) editColor(i); };
      box.appendChild(s);
    });
  }, 'sw' + Paint.primary);
  swatchStyle($('#ccPrimary'), d.palette[Paint.primary]); swatchStyle($('#ccSecondary'), d.palette[Paint.secondary]);
  $('#ccPrimary').setAttribute('aria-label', 'Primary colour: ' + colourName(Paint.primary)); $('#ccPrimary').title = 'Primary (left click): ' + colourName(Paint.primary); // OSH-17
  $('#ccSecondary').setAttribute('aria-label', 'Secondary colour: ' + colourName(Paint.secondary)); $('#ccSecondary').title = 'Secondary (right click): ' + colourName(Paint.secondary);
  $('#palInfo').textContent = `${d.palette.length - 1} colors · ${Paint.primary}/${Paint.secondary}`;
}
rovingKeys($('#palette'), { cols: () => Math.max(1, getComputedStyle($('#palette')).gridTemplateColumns.split(' ').length) });
export function editColor(i) {
  const inp = $('#colorInput'); inp.value = doc().palette[i];
  inp.onchange = () => { doOp({ op: 'set_color', index: i, color: inp.value }); };
  inp.click();
}
export const presetSel = $('#palPreset');
presetSel.innerHTML = '<option value="">Preset…</option>' + Object.keys(PALETTES).map(n => `<option>${n}</option>`).join('');
presetSel.onchange = () => { const p = PALETTES[presetSel.value]; if (p) { doOp({ op: 'set_palette', colors: p.colors }); toast(p.credit + ' (Ctrl+Z to undo)'); } presetSel.value = ''; };
$('#swapColors').onclick = () => { [Paint.primary, Paint.secondary] = [Paint.secondary, Paint.primary]; renderPalette(); announce('Primary colour ' + colourName(Paint.primary)); };
$('#palAdd').onclick = () => { const base = doc().palette[Paint.primary] || '#ffffff'; if (doOp({ op: 'add_color', color: base })) { Paint.primary = doc().palette.length - 1; renderPalette(); editColor(Paint.primary); } };
$('#palEdit').onclick = () => { if (Paint.primary > 0) editColor(Paint.primary); else toast('Index 0 is always transparent'); };
$('#palDel').onclick = () => { // U3: confirm when pixels use the colour
  const i = Paint.primary; if (i <= 0) { toast('Index 0 is always transparent'); return; }
  let n = 0; for (const k in doc().cels) { const a = doc().cels[k]; for (let p = 0; p < a.length; p++) if (a[p] === i) n++; }
  if (!n) { doOp({ op: 'remove_color', index: i }); return; }
  modal('<h2 id="mTitle">Remove colour?</h2><p id="palDelMsg"></p>', () => { doOp({ op: 'remove_color', index: i }); }, 'Remove colour');
  $('#palDelMsg').textContent = `${n} pixel${n > 1 ? 's' : ''} use colour ${colourName(i)}. Removing it makes them transparent and shifts higher colour numbers down by one. You can undo this with Ctrl+Z.`;
};
$('#palExport').onclick = () => download((($('#docName').value || 'palette')) + '.hex', doc().palette.slice(1).map(c => c.slice(1)).join('\n') + '\n', 'text/plain');
$('#palImport').onclick = () => {
  modal('<h2 id="mTitle">Import palette</h2><label for="palText">Hex colors, one per line or comma-separated (Lospec .hex). Index 0 stays transparent.</label><textarea id="palText"></textarea><div class="row"><button type="button" id="palFile">Load .hex file…</button></div>', () => {
    const cols = $('#palText').value.split(/[\s,;]+/).filter(Boolean);
    try { cols.forEach(normHex); } catch (err) { toast(err.message); modalErr(err.message); return false; }
    if (!cols.length) { modalErr('Paste at least one colour (hex like ff0044), one per line.'); return false; } // OSH-12
    doOp({ op: 'set_palette', colors: cols }); if (doOp.failed) return false;
  }, 'Import');
  $('#palText').value = doc().palette.slice(1).map(c => c.slice(1)).join('\n');
  $('#palFile').onclick = () => { const fi = $('#palFileInput'); fi.value = ''; fi.onchange = async () => { $('#palText').value = await fi.files[0].text(); }; fi.click(); };
};

