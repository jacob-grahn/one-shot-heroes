/** Plain entity records. Custom writes mark the entity dirty; the tick snapshots only those. */

import {
  EMPTY,
  customStamp,
  isUserText,
  plainClone,
  sealBytes,
  stampSnapshot,
  clearSeal,
  userText,
  valueBytes,
} from "./wire.js";

const BAD = new Set(["__proto__", "constructor", "prototype"]);
const CAP = 1024;
const lastGood = new WeakMap();
const boxes = new WeakMap();
const dirty = new WeakSet();
const views = new WeakMap();

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

/** @param {any} entity */
export function isCustomDirty(entity) {
  return !!(entity && dirty.has(entity));
}

/**
 * Snapshot custom that was written since the last commit.
 * Empty and unchanged customs are not measured again.
 * @param {any} entity @param {any} prev
 * @returns {"skip" | "empty" | "same" | "ok" | "reverted"}
 */
export function commitCustom(entity, prev) {
  if (!entity || entity.local) return "skip";
  dirty.delete(entity);
  const live = boxes.get(entity);
  const snap = snapshot(live);
  if (snap === EMPTY) return remember(entity, EMPTY, "empty");
  const stamp = stampSnapshot(live, snap);
  if (stamp.len > CAP) {
    entity.custom = lastGood.get(entity) || {};
    dirty.delete(entity);
    return "reverted";
  }
  if (prev && prev !== EMPTY && customStamp(prev).gen === stamp.gen) return "same";
  return remember(entity, snap, "ok");
}

/** @param {any} entity */
export function acceptedCustom(entity) {
  return lastGood.get(entity) || EMPTY;
}

/** @param {any} entity @param {any} snap @param {"empty" | "ok"} verdict */
function remember(entity, snap, verdict) {
  lastGood.set(entity, snap);
  return verdict;
}

/** @param {any} entity @param {Record<string, unknown>} initial @param {boolean} local */
function bindCustom(entity, initial, local) {
  let box = initial;
  boxes.set(entity, box);
  lastGood.set(entity, storeCustom(initial));
  Object.defineProperty(entity, "custom", {
    enumerable: true,
    configurable: true,
    get() {
      return local ? box : watch(entity, box, box);
    },
    set(next) {
      box = replaceCustom(entity, next, local);
    },
  });
}

/** @param {any} entity @param {unknown} next @param {boolean} local */
function replaceCustom(entity, next, local) {
  const copied = storeCustom(next);
  if (!local && valueBytes(copied) > CAP) throw new Error("custom data exceeds 1024 bytes");
  boxes.set(entity, copied);
  if (!local) dirty.add(entity);
  return copied;
}

/** @param {any} entity @param {Record<string, unknown>} box @param {Record<string, unknown>} root */
function watch(entity, box, root) {
  let view = views.get(box);
  if (view) return view;
  const scope = { entity, root };
  view = new Proxy(box, {
    get(target, key) {
      return readKey(target, key, entity, root);
    },
    set(target, key, value) {
      return writeKey(scope, target, key, value);
    },
    deleteProperty(target, key) {
      return dropKey(scope, target, key);
    },
    defineProperty(target, key, desc) {
      return defineKey(scope, target, key, desc);
    },
    setPrototypeOf() {
      return false;
    },
    preventExtensions() {
      return false;
    },
  });
  views.set(box, view);
  return view;
}

/** @param {Record<string, unknown>} target @param {string | symbol} key @param {any} entity @param {Record<string, unknown>} root */
function readKey(target, key, entity, root) {
  if (typeof key !== "string") return Reflect.get(target, key);
  const value = target[key];
  if (value && typeof value === "object")
    return watch(entity, /** @type {Record<string, unknown>} */ (value), root);
  return value;
}

/** @param {{ entity: any, root: Record<string, unknown> }} scope @param {Record<string, unknown>} target @param {string | symbol} key @param {unknown} value */
function writeKey(scope, target, key, value) {
  if (typeof key !== "string") return false;
  const prior = {
    had: Object.prototype.hasOwnProperty.call(target, key),
    prev: target[key],
    len: Array.isArray(target) ? target.length : -1,
  };
  target[key] = keep(value);
  if (sealBytes(scope.root) <= CAP) {
    dirty.add(scope.entity);
    return true;
  }
  restoreKey(target, key, prior);
  throw new Error("custom data exceeds 1024 bytes");
}

/** Setting an array index grows length; a rejected write puts that length back. */
function restoreKey(target, key, prior) {
  if (prior.had) target[key] = prior.prev;
  else delete target[key];
  if (prior.len >= 0) target.length = prior.len;
}

/** @param {{ entity: any, root: Record<string, unknown> }} scope @param {Record<string, unknown>} target @param {string | symbol} key @param {PropertyDescriptor} desc */
function defineKey(scope, target, key, desc) {
  if (!desc || !Object.prototype.hasOwnProperty.call(desc, "value")) return false;
  return writeKey(scope, target, key, desc.value);
}

/** @param {{ entity: any, root: Record<string, unknown> }} scope @param {Record<string, unknown>} target @param {string | symbol} key */
function dropKey(scope, target, key) {
  if (typeof key !== "string") return false;
  delete target[key];
  clearSeal(scope.root);
  dirty.add(scope.entity);
  return true;
}

/** @param {Record<string, unknown>} [box] */
function snapshot(box) {
  if (!box || !Object.keys(box).length) return EMPTY;
  return storeCustom(box);
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
    if (BAD.has(key)) throw new Error("bad custom key " + key);
    out[key] = keep(obj[key]);
  }
  return out;
}

/** @param {unknown} value */
function keep(value) {
  if (isUserText(value)) return userText(/** @type {{ text: string }} */ (value).text);
  if (Array.isArray(value)) return value.map(keep);
  if (value && typeof value === "object") return storeCustom(value);
  return plainClone(value);
}
