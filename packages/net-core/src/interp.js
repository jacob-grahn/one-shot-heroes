/** Client interpolation about 100 ms behind. Large jumps snap instead of lerping. */

/** @param {any} s @param {any} entity @param {number} tick */
export function pushSample(s, entity, tick) {
  const list = s.samples.get(entity.id) || [];
  list.push(sampleOf(entity, tick));
  while (list.length > 32) list.shift();
  s.samples.set(entity.id, list);
}

/** @param {any} entity @param {number} tick */
function sampleOf(entity, tick) {
  return {
    id: entity.id,
    type: entity.type,
    tick,
    x: entity.x,
    y: entity.y,
    rotation: entity.rotation,
    scale: entity.scale,
    anim: entity.anim,
    animStart: entity.animStart,
    custom: entity.custom,
  };
}

/** @param {any[] | undefined} samples @param {number} renderTick @param {number} teleport */
export function blend(samples, renderTick, teleport) {
  const pair = surround(samples || [], renderTick);
  if (!pair.a) return pair.b ? done(pair.b) : null;
  if (!pair.b || pair.b === pair.a) return done(pair.a);
  if (Math.hypot(pair.b.x - pair.a.x, pair.b.y - pair.a.y) > teleport) return done(pair.b);
  const alpha = (renderTick - pair.a.tick) / (pair.b.tick - pair.a.tick);
  return mix(pair.a, pair.b, alpha);
}

/** @param {any[]} samples @param {number} renderTick */
function surround(samples, renderTick) {
  let a = null;
  let b = null;
  for (const sample of samples) {
    if (sample.tick <= renderTick) a = sample;
    if (sample.tick >= renderTick && !b) b = sample;
  }
  return { a, b };
}

/** @param {any} sample */
function done(sample) {
  return { ...sample, alpha: 1 };
}

/** @param {any} a @param {any} b @param {number} alpha */
function mix(a, b, alpha) {
  return {
    ...a,
    x: a.x + (b.x - a.x) * alpha,
    y: a.y + (b.y - a.y) * alpha,
    rotation: lerpAngle(a.rotation, b.rotation, alpha),
    scale: a.scale + (b.scale - a.scale) * alpha,
    alpha,
  };
}

/** @param {number} a @param {number} b @param {number} alpha */
function lerpAngle(a, b, alpha) {
  let delta = b - a;
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * alpha;
}
