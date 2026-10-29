/** Timeline: frames, layers grid and animations. */
import { Core } from '../core/editor-core.js';
import { act } from './actions.js';
import { announce } from './announce.js';
import { ANIM_COLORS } from './defs.js';
import { doOp } from './do-op.js';
import { $, el } from './dom.js';
import { gotoFrame, selectedFrames } from './frames.js';
import { hooks } from './hooks.js';
import { ask } from './modal.js';
import { resetPreview } from './preview.js';
import { rebuildKeepingFocus, rovingKeys } from './roving.js';
import { Cur, curFrameId, doc } from './state/context.js';
import { PvS } from './state/preview.js';
import { syncCtx } from './sync-ctx.js';
import { frameThumb } from './thumbs.js';

/* ---------- timeline ---------- */
hooks.renderTimeline = () => renderTimeline();
export function renderTimeline() {
  const d = doc(), g = $('#tlgrid');
  rebuildKeepingFocus(g, () => buildTimeline(d, g), 'f:' + Cur.frame);
}
export function buildTimeline(d, g) {
  g.innerHTML = '';
  const sel = new Set(selectedFrames());
  const fr = el('div', 'tlrow frames'); fr.appendChild(el('div', 'lbl', '<span class="small">Frames</span>'));
  d.frames.forEach((f, i) => {
    const c = el('div', 'cell' + (i === Cur.frame ? ' cur' : '') + (sel.has(i) && Cur.range ? ' rng' : ''));
    const th = frameThumb(f.id, i); c.append(th, el('span', '', String(i + 1))); c.dataset.frame = i;
    c.classList.add('rv'); c.dataset.fk = 'f:' + i; c.dataset.row = 0; c.dataset.col = i;
    c.setAttribute('role', 'button'); c.setAttribute('aria-label', 'Frame ' + (i + 1) + (i === Cur.frame ? ' (current)' : '') + (sel.has(i) && Cur.range ? ', in range' : '')); c.setAttribute('aria-pressed', String(i === Cur.frame));
    c.onclick = e => { if (e.shiftKey) { Cur.range = [Cur.range ? Cur.range[0] : Cur.frame, i]; Cur.frame = i; syncCtx(); hooks.refresh(); } else gotoFrame(i); };
    c.activate = e => { c.onclick(e); announce('Frame ' + (i + 1) + (e.shiftKey ? ' (range)' : '')); };
    fr.appendChild(c);
  });
  g.appendChild(fr);
  d.animations.forEach((a, ai) => g.appendChild(animRow(d, a, ai)));
}
function animName(a, ai) {
  const nm = el('span', 'an' + (PvS.pvAnim === a.name ? ' sel' : '')); nm.tabIndex = 0; nm.setAttribute('role', 'button'); // OSH-22: span (not <button>) keeps the row's first <button> = mode toggle
  nm.textContent = a.name; nm.title = 'Click: preview. Double-click or F2: rename'; nm.dataset.fk = 'an:' + ai;
  nm.setAttribute('aria-label', 'Animation ' + a.name + ': preview (F2 renames)'); nm.setAttribute('aria-pressed', String(PvS.pvAnim === a.name));
  nm.onclick = () => { PvS.pvAnim = a.name; resetPreview(); hooks.refresh(); };
  nm.ondblclick = () => ask('Rename animation', a.name, v => { const ok = doOp({ op: 'set_animation', name: a.name, newName: v }); if (doOp.failed) return false; if (ok && PvS.pvAnim === a.name) PvS.pvAnim = v.trim(); hooks.refresh(); });
  nm.onkeydown = e => { if (e.key === 'F2') { e.preventDefault(); nm.ondblclick(); } else if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); e.stopPropagation(); nm.onclick(); } };
  return nm;
}
function animLabel(a, ai, color) {
  const lbl = el('div', 'lbl');
  const dot = el('span', 'dot'); dot.style.background = color;
  const nm = animName(a, ai);
  const mode = el('button', '', a.mode === 'pingpong' ? '&#x21C4;' : '&#x27F3;'); mode.title = a.mode === 'pingpong' ? 'Ping-pong (click for loop)' : 'Loop (click for ping-pong)'; mode.dataset.fk = 'am:' + ai;
  mode.setAttribute('aria-label', a.name + ': ' + mode.title); mode.onclick = () => doOp({ op: 'set_animation', name: a.name, mode: a.mode === 'pingpong' ? 'loop' : 'pingpong' });
  const del = el('button', '', '&times;'); del.title = 'Delete animation'; del.setAttribute('aria-label', 'Delete animation ' + a.name); del.dataset.fk = 'ad:' + ai; del.onclick = () => doOp({ op: 'remove_animation', name: a.name });
  lbl.append(dot, nm, mode, del);
  return lbl;
}
/** One timeline cell of an animation row: is frame i part of animation a. */
function animCell({ d, a, ai, color }, f, i) {
  const inA = a.frames.includes(f.id), prev = i > 0 && a.frames.includes(d.frames[i - 1].id), next = i < d.frames.length - 1 && a.frames.includes(d.frames[i + 1].id);
  const c = el('div', 'cell'), bar = el('div', 'bar' + (inA ? '' : ' off') + (inA && !prev ? ' start' : '') + (inA && !next ? ' end' : ''));
  bar.style.background = color; c.appendChild(bar); c.title = (inA ? 'Remove frame ' : 'Add frame ') + (i + 1) + (inA ? ' from "' : ' to "') + a.name + '"';
  c.classList.add('rv'); c.dataset.fk = 'a:' + ai + ':' + i; c.dataset.row = ai + 1; c.dataset.col = i; c.setAttribute('role', 'button');
  c.setAttribute('aria-label', `${a.name}, frame ${i + 1}: ${inA ? 'included' : 'not included'}`); c.setAttribute('aria-pressed', String(inA));
  c.onclick = () => doOp({ op: 'set_animation', name: a.name, frames: inA ? a.frames.filter(x => x !== f.id) : [...a.frames, f.id] });
  c.activate = () => { if (c.onclick()) announce(`Frame ${i + 1} ${inA ? 'removed from' : 'added to'} ${a.name}`); };
  return c;
}
function animRow(d, a, ai) {
  const color = ANIM_COLORS[ai % ANIM_COLORS.length], row = el('div', 'tlrow anim');
  row.appendChild(animLabel(a, ai, color));
  const ctx = { d, a, ai, color };
  d.frames.forEach((f, i) => { row.appendChild(animCell(ctx, f, i)); });
  return row;
}
$('#frAdd').onclick = () => act.frAdd(); $('#frDup').onclick = () => act.frDup();
$('#frDel').onclick = () => { if (doOp({ op: 'remove_frame', frame: curFrameId() })) { Cur.range = null; } };
$('#frLeft').onclick = () => { if (Cur.frame > 0 && doOp({ op: 'move_frame', frame: curFrameId(), index: Cur.frame - 1 })) { Cur.frame--; hooks.refresh(); } };
$('#frRight').onclick = () => { if (Cur.frame < doc().frames.length - 1 && doOp({ op: 'move_frame', frame: curFrameId(), index: Cur.frame + 1 })) { Cur.frame++; hooks.refresh(); } };
$('#anAdd').onclick = () => {
  const frames = selectedFrames().map(i => doc().frames[i].id), names = ['idle', 'walk', 'run', 'jump', 'attack', 'hurt', 'die'];
  const def = names.find(n => !doc().animations.some(a => a.name === n)) || 'anim' + (doc().animations.length + 1);
  ask(`New animation from frame${frames.length > 1 ? 's ' + (selectedFrames()[0] + 1) + '–' + (selectedFrames().slice(-1)[0] + 1) : ' ' + (Cur.frame + 1)}`, def, v => { if (!doOp({ op: 'add_animation', name: v, frames, mode: 'loop' }) && doOp.failed) return false; PvS.pvAnim = v.trim(); resetPreview(); hooks.refresh(); });
};
$('#layAdd').onclick = () => act.layAdd();
rovingKeys($('#tlgrid'), { grid: true });
$('#layDel').onclick = () => doOp({ op: 'remove_layer', layer: Cur.layer });
$('#layUp').onclick = () => { const i = Core.layerIndex(Cur.layer); if (i < doc().layers.length - 1) doOp({ op: 'move_layer', layer: Cur.layer, index: i + 1 }); };
$('#layDown').onclick = () => { const i = Core.layerIndex(Cur.layer); if (i > 0) doOp({ op: 'move_layer', layer: Cur.layer, index: i - 1 }); };

