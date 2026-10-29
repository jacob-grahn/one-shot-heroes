/** Example sprite (drawn entirely through the op API). */
import { markClean } from '../core/clean-state.js';
import { Core } from '../core/editor-core.js';
import { $ } from '../ui/dom.js';
import { hooks } from '../ui/hooks.js';
import { resetPreview } from '../ui/preview.js';
import { newDocument } from '../ui/recover.js';
import { Cur } from '../ui/state/context.js';
import { Paint } from '../ui/state/paint.js';
import { PvS } from '../ui/state/preview.js';
import { Tool } from '../ui/state/tool.js';
import { renderTools } from '../ui/tools-panel.js';
import { fitView } from '../ui/zoom.js';
import { Session } from './session.js';

// Sweetie 16 indices: 1 ink 2 plum 3 red 4 orange 5 yellow 6 lime 7 green 8 teal 9 navy 10 blue 11 sky 12 cyan 13 white 14 silver 15 slate 16 dusk
const K = { k: 1, h: 3, s: 5, o: 4, w: 13, b: 10, n: 9, y: 5, g: 16, l: 14, c: 3, r: 2, e: 1 };
const head = [
  '....kkkkkk....',
  '...khhhhhhk...',
  '..khhhhhhhhk..',
  '..khhhssssshk.',
  '..khhsssesesk.',
  '..khhsssssssk.',
  '...kssssosssk.',
  '....kkssssskk.',
  '.....kkkkkk...',
];
const body = [
  '...kcbbbbbbk..',
  '..kccbbwbbbbk.',
  '.kcskbbbbbksk.',
  '.kcskbbbbbksk.',
  '.kc.kyyyyyk.k.',
  '.kc.knnnnnk...',
];
const legs = [
  ['...knnk.knnk..', '...knnk..knk..', '..kgggk..kggk.', '..kkkk...kkkk.'], // contact
  ['....knnknnk...', '....knk.knk...', '....kgkkggk...', '....kkk.kkk...'], // pass
  ['..knnk..knnk..', '..knk...knnk..', '.kggk...kgggk.', '.kkkk....kkkk.'], // contact (other leg forward)
  ['....knnknnk...', '....knk.knk...', '....kggkkgk...', '....kkk.kkk...'], // pass
];
const art = rows => { const px = []; rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch !== '.') px.push([x, y, K[ch]]); })); return px; };
const shift = (px, dx, dy) => px.map(([x, y, c]) => [x + dx, y + dy, c]);

/** One walk frame f (adds the frame first, except frame 0): shadow, then the hero as one batch. */
function drawFrame(api, heroId, f) {
  if (f > 0) api.apply({ op: 'add_frame' });
  const bob = f % 2 === 1 ? -1 : 0, ox = 9, oy = 9;
  api.apply({ op: 'ellipse', layer: 'L1', frame: f, x0: 10, y0: 28, x1: 21, y1: 30, color: 16, filled: true });
  api.apply({ op: 'batch', ops: [
    { op: 'set_pixels', layer: heroId, frame: f, pixels: shift(art(head), ox, oy + bob) },
    { op: 'set_pixels', layer: heroId, frame: f, pixels: shift(art(body), ox, oy + 9 + bob) },
    { op: 'set_pixels', layer: heroId, frame: f, pixels: shift(art(legs[f]), ox, oy + 15) },
    { op: 'line', layer: heroId, frame: f, x0: ox + 13, y0: oy + 7 + bob, x1: ox + 13, y1: oy + 12 + bob, color: 14 }, // sword
    { op: 'set_pixels', layer: heroId, frame: f, pixels: [[ox + 12, oy + 12 + bob, 4], [ox + 14, oy + 12 + bob, 4], [ox + 13, oy + 13 + bob, 1]] },
  ] });
}

export function loadExample() {
  newDocument(32, 32, 'Sweetie 16');
  $('#docName').value = 'hero';
  const api = Session('user'); // the example is drawn as a human would (through a 'user' session)
  api.apply({ op: 'set_layer', layer: 0, name: 'Shadow' });
  const hero = api.apply({ op: 'add_layer', name: 'Hero' });
  for (let f = 0; f < 4; f++) drawFrame(api, hero.id, f);
  api.apply({ op: 'add_frame', copyOf: 0 });                                  // frame 5: blink
  api.apply({ op: 'set_pixels', layer: hero.id, frame: 4, pixels: [[17, 13, 5], [19, 13, 5]] }); // eyes closed
  const F = Core.doc.frames.map(f => f.id);
  api.apply({ op: 'add_animation', name: 'idle', frames: [F[0], F[4]], mode: 'loop' });
  api.apply({ op: 'add_animation', name: 'walk', frames: F.slice(0, 4), mode: 'loop' });
  Cur.layer = hero.id; Cur.frame = 0; Tool.tool = 'pencil'; renderTools(); PvS.pvAnim = 'walk'; Paint.primary = 10; resetPreview(); hooks.refreshNow(); fitView(); markClean();
}

