/** Animation timing for One Shot Heroes: the fixed 15 fps engine rate and animation play order. */

export const FPS = 15;                    // fixed engine animation rate
export const FRAME_MS = 1000 / FPS;       // 66.67 ms per frame
/** Frame play order for an animation (timeline order), or all frames when name is null. */
export function animSequence(doc, name) {
  let idxs;
  const a = name ? doc.animations.find(a => a.name === name) : null;
  if (a) idxs = doc.frames.map((f, i) => a.frames.includes(f.id) ? i : -1).filter(i => i >= 0);
  else idxs = doc.frames.map((f, i) => i);
  if (a && a.mode === 'pingpong' && idxs.length > 2) idxs = idxs.concat(idxs.slice(1, -1).reverse());
  return idxs;
}
