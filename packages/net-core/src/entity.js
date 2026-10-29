/** Plain entity records. Nested custom data is read by snapshotting, not by a Proxy. */

import { plainClone } from "./wire.js";

const BAD = new Set(["__proto__", "constructor", "prototype"]);

/** @param {number} id @param {string} type @param {Record<string, any>} init @param {boolean} local */
export function createEntity(id, type, init, local) {
  if (typeof type !== "string" || !type || type.length > 32) throw new Error("bad entity type");
  const src = init || {};
  return {
    id,
    type,
    local: !!local,
    x: finite(src.x, 0),
    y: finite(src.y, 0),
    rotation: finite(src.rotation, 0),
    scale: src.scale == null ? 1 : finite(src.scale, 1),
    anim: finite(src.anim, 0) & 65535,
    animStart: finite(src.animStart, 0) >>> 0,
    custom: copyCustom(src.custom),
  };
}

/** @param {number} value @param {number} fallback */
function finite(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** @param {Record<string, unknown>} [src] */
function copyCustom(src) {
  const out = Object.create(null);
  for (const key of Object.keys(src || {})) {
    if (BAD.has(key)) throw new Error("bad custom key");
    out[key] = plainClone(/** @type {Record<string, unknown>} */ (src)[key]);
  }
  return out;
}
