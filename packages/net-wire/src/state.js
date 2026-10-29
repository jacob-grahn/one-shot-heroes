/** Quantized entity snapshots, deltas against a baseline, and exact default restoration. */

import { EMPTY, canon, cloneCustom, customEqual, plainClone } from "./custom.js";
import { F_ANIM, F_CUSTOM, F_ROT, F_SCALE, F_START, F_X, F_Y } from "./defaults.js";
import { userText } from "./keys.js";
import { fromU16, toU16, wrapAngle } from "./quant.js";

/** @param {{ posMin: number, posMax: number, scaleMin: number, scaleMax: number }} q */
export function defaultState(q) {
  return {
    x: toU16(0, q.posMin, q.posMax),
    y: toU16(0, q.posMin, q.posMax),
    rotation: 0,
    scale: toU16(1, q.scaleMin, q.scaleMax),
    anim: 0,
    animStart: 0,
    custom: EMPTY,
  };
}

/** @param {Record<string, any>} entity @param {{ posMin: number, posMax: number, scaleMin: number, scaleMax: number }} q */
export function quantize(entity, q) {
  const slot = { custom: EMPTY };
  fillQuant(slot, entity, q);
  return slot;
}

/** Mutates a reused slot. One quantize per entity per tick, shared by every recipient. */
export function fillQuant(slot, entity, q) {
  slot.x = toU16(num(entity.x), q.posMin, q.posMax);
  slot.y = toU16(num(entity.y), q.posMin, q.posMax);
  slot.rotation = toU16(wrapAngle(num(entity.rotation)), 0, Math.PI * 2);
  slot.scale = toU16(entity.scale == null ? 1 : entity.scale, q.scaleMin, q.scaleMax);
  slot.anim = (entity.anim || 0) & 65535;
  slot.animStart = (entity.animStart || 0) >>> 0;
  slot.custom = customSnap(entity.custom);
}

/** Byte size of one unreliable entity record, excluding the packet header. */
export function updateBytes(mask, customLen) {
  let n = 11;
  if (mask & F_X) n += 2;
  if (mask & F_Y) n += 2;
  if (mask & F_ROT) n += 2;
  if (mask & F_SCALE) n += 2;
  if (mask & F_ANIM) n += 2;
  if (mask & F_START) n += 4;
  return n + (customLen || 0);
}

/** @param {Record<string, unknown>} [src] */
function customSnap(src) {
  if (!src || src === EMPTY) return EMPTY;
  for (const key in src) {
    if (Object.prototype.hasOwnProperty.call(src, key)) return cloneCustom(src);
  }
  return EMPTY;
}

/** @param {number} [v] */
function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** @param {Record<string, any>} cur @param {Record<string, any>} base */
export function diffMask(cur, base) {
  let mask = 0;
  if (cur.x !== base.x) mask |= F_X;
  if (cur.y !== base.y) mask |= F_Y;
  if (cur.rotation !== base.rotation) mask |= F_ROT;
  if (cur.scale !== base.scale) mask |= F_SCALE;
  if (cur.anim !== base.anim) mask |= F_ANIM;
  if (cur.animStart !== base.animStart) mask |= F_START;
  if (cur.custom !== base.custom && !customEqual(cur.custom, base.custom)) mask |= F_CUSTOM;
  return mask;
}

/** @param {Record<string, any>} a @param {Record<string, any>} b */
export function sameState(a, b) {
  return diffMask(a, b) === 0;
}

/** @param {Record<string, unknown>} cur @param {Record<string, unknown>} base */
export function customOps(cur, base) {
  const ops = [];
  const seen = new Set();
  for (const k of Object.keys(cur).concat(Object.keys(base))) {
    if (seen.has(k)) continue;
    seen.add(k);
    pushOp(ops, k, cur, base);
  }
  return ops;
}

/** @param {{ key: string, del?: boolean, value?: unknown }[]} ops @param {string} key @param {Record<string, unknown>} cur @param {Record<string, unknown>} base */
function pushOp(ops, key, cur, base) {
  const has = Object.prototype.hasOwnProperty.call(cur, key);
  const had = Object.prototype.hasOwnProperty.call(base, key);
  if (has && (!had || canon(cur[key]) !== canon(base[key]))) ops.push({ key, value: cur[key] });
  else if (!has && had) ops.push({ key, del: true });
}

/** @param {Record<string, any>} q */
export function cloneState(q) {
  return {
    x: q.x,
    y: q.y,
    rotation: q.rotation,
    scale: q.scale,
    anim: q.anim,
    animStart: q.animStart,
    custom: cloneCustom(q.custom),
  };
}

/** @param {Record<string, any>} base @param {Record<string, any>} patch */
export function applyState(base, patch) {
  const next = cloneState(base);
  if (patch.mask & F_X) next.x = patch.x;
  if (patch.mask & F_Y) next.y = patch.y;
  if (patch.mask & F_ROT) next.rotation = patch.rotation;
  if (patch.mask & F_SCALE) next.scale = patch.scale;
  if (patch.mask & F_ANIM) next.anim = patch.anim;
  if (patch.mask & F_START) next.animStart = patch.animStart;
  if (patch.mask & F_CUSTOM) mergeCustom(next, patch);
  return next;
}

/** @param {Record<string, any>} next @param {Record<string, any>} patch */
function mergeCustom(next, patch) {
  if (next.custom === EMPTY) next.custom = Object.create(null);
  for (const k of patch.dels || []) delete next.custom[k];
  for (const k of Object.keys(patch.custom || {})) next.custom[k] = plainClone(patch.custom[k]);
}

/**
 * Write quantized fields onto an entity. Values that quantize to the default
 * are restored as the exact default (0, 1, …) so both peers agree.
 * @param {Record<string, any>} entity
 * @param {Record<string, any>} q
 * @param {{ posMin: number, posMax: number, scaleMin: number, scaleMax: number }} quant
 */
export function materialize(entity, q, quant) {
  const d = defaultState(quant);
  entity.x = q.x === d.x ? 0 : fromU16(q.x, quant.posMin, quant.posMax);
  entity.y = q.y === d.y ? 0 : fromU16(q.y, quant.posMin, quant.posMax);
  entity.rotation = q.rotation === 0 ? 0 : fromU16(q.rotation, 0, Math.PI * 2);
  entity.scale = q.scale === d.scale ? 1 : fromU16(q.scale, quant.scaleMin, quant.scaleMax);
  entity.anim = q.anim;
  entity.animStart = q.animStart;
  entity.custom = toUser(q.custom);
}

/** @param {Record<string, unknown>} custom */
function toUser(custom) {
  const out = Object.create(null);
  for (const k of Object.keys(custom || {})) out[k] = toUserVal(custom[k]);
  return out;
}

/** @param {unknown} v */
function toUserVal(v) {
  if (typeof v === "string") return userText(v);
  if (Array.isArray(v)) return v.map(toUserVal);
  if (v && typeof v === "object") return toUser(/** @type {Record<string, unknown>} */ (v));
  return v;
}
