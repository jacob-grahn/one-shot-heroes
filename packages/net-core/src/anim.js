/**
 * Map a synced host tick onto a 15 fps animation frame.
 * frame = floor((hostTick - animStart) * 15 / tickHz) mod frameCount.
 * At tickHz 15 this is exactly one frame per sim tick. The frame is never transmitted.
 */

import { FPS } from "@osh/timing";

/** @param {any} s */
export function noteAnims(s) {
  const prev = new Map();
  for (const entity of s.world.query())
    prev.set(entity.id, { anim: entity.anim, animStart: entity.animStart });
  return prev;
}

/** @param {any} s @param {Map<number, { anim: number, animStart: number }>} prev */
export function stampAnims(s, prev) {
  for (const entity of s.world.query()) stampOne(entity, prev.get(entity.id), s.tick);
}

/** @param {any} entity @param {{ anim: number, animStart: number } | undefined} prev @param {number} tick */
function stampOne(entity, prev, tick) {
  if (prev && entity.anim !== prev.anim && entity.animStart === prev.animStart)
    entity.animStart = tick;
}

/** @param {number} animStart @param {number} hostTick @param {number} frameCount @param {number} tickHz */
export function animFrame(animStart, hostTick, frameCount, tickHz) {
  const count = frameCount | 0;
  if (count <= 0 || tickHz <= 0) return 0;
  const advanced = ((hostTick - animStart) * FPS) / tickHz;
  const index = Math.floor(advanced) % count;
  return index < 0 ? index + count : index;
}
