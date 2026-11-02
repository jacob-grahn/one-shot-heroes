/** Plain entity records. Nested custom data is read by snapshotting, not by a Proxy. */

import { isUserText, plainClone, valueBytes } from "./wire.js";

const BAD = new Set(["__proto__", "constructor", "prototype"]);
const CAP = 1024;
const lastGood = new WeakMap();

/** @param {number} id @param {string} type @param {Record<string, any>} init @param {boolean} local */
export function createEntity(id, type, init, local) {
  if (typeof type !== "string" || !type || type.length > 32) throw new Error("bad entity type");
  const src = init || {};
  const custom = storeCustom(src.custom);
  if (!local && valueBytes(custom) > CAP) throw new Error("custom data exceeds 1024 bytes");
  const entity = {
    id,
    type,
    local: !!local,
    x: finite(src.x, 0),
    y: finite(src.y, 0),
    rotation: finite(src.rotation, 0),
    scale: src.scale == null ? 1 : finite(src.scale, 1),
    anim: finite(src.anim, 0) & 65535,
    animStart: finite(src.animStart, 0) >>> 0,
  };
  bindCustom(entity, custom, !!local);
  return entity;
}

/** Revert an in-place edit that grew past the cap. Send paths never see it. */
export function recheckCustom(entity) {
  if (!entity || entity.local) return;
  if (valueBytes(entity.custom) <= CAP) {
    lastGood.set(entity, storeCustom(entity.custom));
    return;
  }
  entity.custom = lastGood.get(entity) || {};
  throw new Error("custom data exceeds 1024 bytes");
}

/** @param {any} entity @param {Record<string, unknown>} initial @param {boolean} local */
function bindCustom(entity, initial, local) {
  let box = initial;
  let view = watch(local, box);
  Object.defineProperty(entity, "custom", {
    enumerable: true,
    configurable: true,
    get() {
      return view;
    },
    set(next) {
      const copied = storeCustom(next);
      if (!local && valueBytes(copied) > CAP) throw new Error("custom data exceeds 1024 bytes");
      box = copied;
      view = watch(local, box);
      lastGood.set(entity, storeCustom(copied));
    },
  });
  lastGood.set(entity, storeCustom(initial));
}

/** @param {boolean} local @param {Record<string, unknown>} box */
function watch(local, box) {
  if (local) return box;
  return new Proxy(box, {
    set(target, key, value) {
      return assign(target, key, value);
    },
  });
}

/** @param {Record<string, unknown>} target @param {string | symbol} key @param {unknown} value */
function assign(target, key, value) {
  if (typeof key !== "string") return false;
  const had = Object.prototype.hasOwnProperty.call(target, key);
  const prev = target[key];
  target[key] = keep(value);
  if (valueBytes(target) <= CAP) return true;
  if (had) target[key] = prev;
  else delete target[key];
  throw new Error("custom data exceeds 1024 bytes");
}

/** @param {number} value @param {number} fallback */
function finite(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** @param {unknown} src */
function storeCustom(src) {
  const out = Object.create(null);
  const obj = src && typeof src === "object" ? /** @type {Record<string, unknown>} */ (src) : {};
  for (const key of Object.keys(obj)) {
    if (BAD.has(key)) throw new Error("bad custom key");
    out[key] = keep(obj[key]);
  }
  return out;
}

/** @param {unknown} value */
function keep(value) {
  if (isUserText(value))
    return { text: /** @type {{ text: string }} */ (value).text, userContent: true };
  if (Array.isArray(value)) return value.map(keep);
  if (value && typeof value === "object") return storeCustom(value);
  return plainClone(value);
}
