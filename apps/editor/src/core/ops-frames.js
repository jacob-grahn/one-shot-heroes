/** Frame, animation and canvas op handlers. Mixed into OPS (`this` is Core). */
import { celBudget } from '@osh/format/document';
import { ID_FRAME, LIMITS } from '@osh/format/limits';
import { fail, intArg, nameArg } from '@osh/format/validate';

/** New cels (and tags) of frame id for every layer: copies of frame copyOf, or blank. */
function addFrameCels(d, id, copyOf) {
  const blank = () => new Uint8Array(d.width * d.height);
  for (const l of d.layers) { const src = l.id + ':' + copyOf, k = l.id + ':' + id; d.cels[k] = copyOf ? d.cels[src].slice() : blank(); d.tags[k] = copyOf ? d.tags[src].slice() : blank(); }
}
const checkMode = mode => { if (mode !== 'loop' && mode !== 'pingpong') fail('bad_arg', 'mode must be "loop" or "pingpong"'); };
/** Validated changes of a set_animation op: {nn, mode, frames} (undefined = unchanged). */
function animationChanges(core, op, a) {
  const d = core.doc; let nn, mode, frames;
  if (op.newName !== undefined) { nn = nameArg(op.newName, 'animation name'); if (nn !== a.name && d.animations.some(b => b.name === nn)) fail('exists', 'animation "' + nn + '" exists'); }
  if (op.mode !== undefined) { checkMode(op.mode); mode = op.mode; }
  if (op.frames !== undefined) { if (!Array.isArray(op.frames)) fail('bad_arg', 'frames must be an array'); frames = op.frames.map(f => core.resolveFrame(f)); op.frames = frames; }
  return { nn, mode, frames };
}

/** Mixin: `this` is the composed host object. @type {Record<string, any>} */
export const frameOps = {
  // --- frames ---
  add_frame(op) {
    const d = this.doc; if (d.frames.length >= LIMITS.maxFrames) fail('too_many', 'max ' + LIMITS.maxFrames + ' frames');
    celBudget(d.width, d.height, d.layers.length, d.frames.length + 1);
    const copyOf = op.copyOf === undefined || op.copyOf === null ? null : this.resolveFrame(op.copyOf);
    const idx = op.index === undefined ? d.frames.length : intArg(op.index, 'index', 0, d.frames.length);
    op.id = this.claimId(op.id, ID_FRAME, 'F'); if (copyOf) op.copyOf = copyOf; else delete op.copyOf;
    d.frames.splice(idx, 0, { id: op.id });
    addFrameCels(d, op.id, copyOf);
    if (copyOf && op.inheritAnimations !== false) for (const a of d.animations) if (a.frames.includes(copyOf)) a.frames.push(op.id);
  },
  remove_frame(op) {
    const d = this.doc; op.frame = this.resolveFrame(op.frame);
    if (d.frames.length <= 1) fail('last_frame', 'cannot remove the last frame');
    d.frames.splice(this.frameIndex(op.frame), 1);
    for (const l of d.layers) { delete d.cels[l.id + ':' + op.frame]; delete d.tags[l.id + ':' + op.frame]; }
    for (const a of d.animations) a.frames = a.frames.filter(f => f !== op.frame);
  },
  move_frame(op) {
    const d = this.doc; op.frame = this.resolveFrame(op.frame);
    const to = intArg(op.index, 'index', 0, d.frames.length - 1), i = this.frameIndex(op.frame);
    const [f] = d.frames.splice(i, 1); d.frames.splice(to, 0, f);
  },
  // --- named animations: {name, frames:[frameIds], mode:'loop'|'pingpong'}; play order = timeline order ---
  add_animation(op) {
    const d = this.doc, name = nameArg(op.name, 'animation name');
    if (d.animations.length >= LIMITS.maxAnimations) fail('too_many', 'too many animations');
    if (d.animations.some(a => a.name === name)) fail('exists', 'animation "' + name + '" exists');
    const mode = op.mode === undefined ? 'loop' : op.mode; if (mode !== 'loop' && mode !== 'pingpong') fail('bad_arg', 'mode must be "loop" or "pingpong"');
    if (op.frames !== undefined && !Array.isArray(op.frames)) fail('bad_arg', 'frames must be an array');
    const frames = (op.frames || [this.ctx.frame]).map(f => this.resolveFrame(f));
    op.name = name; op.frames = frames; op.mode = mode;
    d.animations.push({ name, frames: [...new Set(frames)], mode });
  },
  set_animation(op) {
    const d = this.doc, a = d.animations.find(a => a.name === op.name);
    if (!a) fail('no_animation', 'no animation ' + JSON.stringify(String(op.name).slice(0, 40)));
    const { nn, mode, frames } = animationChanges(this, op, a);
    if (nn !== undefined) a.name = nn; if (mode !== undefined) a.mode = mode; if (frames !== undefined) a.frames = [...new Set(frames)];
  },
  remove_animation(op) {
    const d = this.doc, i = d.animations.findIndex(a => a.name === op.name);
    if (i < 0) fail('no_animation', 'no animation ' + JSON.stringify(String(op.name).slice(0, 40))); d.animations.splice(i, 1);
  },
  // --- canvas ---
  resize(op) {
    const d = this.doc, W = intArg(op.width, 'width', LIMITS.minSize, LIMITS.maxSize), H = intArg(op.height, 'height', LIMITS.minSize, LIMITS.maxSize);
    if (op.anchor !== undefined && op.anchor !== 'center' && op.anchor !== 'topleft') fail('bad_arg', 'anchor must be center or topleft');
    celBudget(W, H, d.layers.length, d.frames.length);
    // OSH-26: centre = pixel floor(size/2) stays on pixel floor(newSize/2), so offsets telescope and any round trip (8→11→8) is exact
    const ox = op.anchor === 'topleft' ? 0 : (W >> 1) - (d.width >> 1), oy = op.anchor === 'topleft' ? 0 : (H >> 1) - (d.height >> 1);
    const move = a => { const b = new Uint8Array(W * H); for (let y = 0; y < d.height; y++) for (let x = 0; x < d.width; x++) { const nx = x + ox, ny = y + oy; if (nx >= 0 && ny >= 0 && nx < W && ny < H) b[ny * W + nx] = a[y * d.width + x]; } return b; };
    for (const k in d.cels) { d.cels[k] = move(d.cels[k]); d.tags[k] = move(d.tags[k]); }
    d.width = W; d.height = H;
  },
};
