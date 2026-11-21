/** Interpolated, frozen views for render. The host draws the latest simulated tick. */

import { blend } from "./interp.js";
import { readOnly } from "./view.js";

/** @param {any} s @param {any} draw */
export function renderFrame(s, draw) {
  const view = buildView(s);
  s.game.render(readOnly(view, s.dev), view.alpha, draw, s.net);
}

/** @param {any} s */
function buildView(s) {
  const renderTick = s.isHost ? s.shownTick : Math.max(0, s.est() - delayTicks(s));
  const built = collect(s, renderTick);
  return { tick: renderTick, alpha: built.alpha, entities: built.entities };
}

/** @param {any} s */
function delayTicks(s) {
  return (s.manifest.interpMs / 1000) * s.manifest.tickHz;
}

/** @param {any} s @param {number} renderTick */
function collect(s, renderTick) {
  const entities = [];
  let alpha = 1;
  for (const entity of s.world.query()) {
    const shown = present(s, entity, renderTick);
    alpha = shown.alpha;
    entities.push(shown.fields);
  }
  return { entities, alpha };
}

/** @param {any} s @param {any} entity @param {number} renderTick */
function present(s, entity, renderTick) {
  if (s.isHost || entity.local) return { alpha: 1, fields: live(entity) };
  const mixed = blend(s.samples.get(entity.id), renderTick, s.manifest.teleport);
  if (!mixed) return { alpha: 1, fields: live(entity) };
  return { alpha: mixed.alpha, fields: strip(mixed) };
}

/** @param {any} entity */
function live(entity) {
  return strip(entity);
}

/** @param {any} src */
function strip(src) {
  return {
    id: src.id,
    type: src.type,
    x: src.x,
    y: src.y,
    rotation: src.rotation,
    scale: src.scale,
    anim: src.anim,
    animStart: src.animStart,
    custom: src.custom,
  };
}
