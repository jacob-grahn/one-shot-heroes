/** Entity field blocks shared by spawn, snapshot, and unreliable state. */

import { writeShort, readShort } from "./bin.js";
import { encodeOps, decodeOps } from "./custom.js";
import { F_ANIM, F_CUSTOM, F_ROT, F_SCALE, F_START, F_X, F_Y } from "./defaults.js";
import { customOps, diffMask } from "./state.js";

/** @param {ReturnType<import('./bin.js').createWriter>} w @param {Record<string, any>} cur @param {Record<string, any>} base */
export function writeFields(w, cur, base) {
  const mask = diffMask(cur, base);
  w.u8(mask);
  if (mask & F_X) w.u16(cur.x);
  if (mask & F_Y) w.u16(cur.y);
  if (mask & F_ROT) w.u16(cur.rotation);
  if (mask & F_SCALE) w.u16(cur.scale);
  if (mask & F_ANIM) w.u16(cur.anim);
  if (mask & F_START) w.u32(cur.animStart);
  if (mask & F_CUSTOM) encodeOps(w, customOps(cur.custom, base.custom));
  return mask;
}

/** @param {ReturnType<import('./bin.js').createReader>} r */
export function readFields(r) {
  const mask = r.u8();
  const patch = { mask, dels: /** @type {string[]} */ ([]) };
  if (mask & F_X) patch.x = r.u16();
  if (mask & F_Y) patch.y = r.u16();
  if (mask & F_ROT) patch.rotation = r.u16();
  if (mask & F_SCALE) patch.scale = r.u16();
  if (mask & F_ANIM) patch.anim = r.u16();
  if (mask & F_START) patch.animStart = r.u32();
  if (mask & F_CUSTOM) readCustom(r, patch);
  return patch;
}

/** @param {ReturnType<import('./bin.js').createReader>} r @param {Record<string, any>} patch */
function readCustom(r, patch) {
  const ops = decodeOps(r);
  patch.custom = ops.obj;
  patch.dels = ops.dels;
}

/** @param {ReturnType<import('./bin.js').createWriter>} w @param {Record<string, any>} rec */
export function writeRecord(w, rec) {
  w.u16(rec.id);
  writeShort(w, rec.type);
  writeIds(w, rec);
  writeFields(w, rec.cur, rec.base);
}

/** @param {ReturnType<import('./bin.js').createWriter>} w @param {Record<string, any>} rec */
export function writeUpdate(w, rec) {
  w.u16(rec.id);
  writeIds(w, rec);
  writeFields(w, rec.cur, rec.base);
}

/** @param {ReturnType<import('./bin.js').createWriter>} w @param {Record<string, any>} rec */
function writeIds(w, rec) {
  w.u32(rec.version >>> 0);
  w.u32(rec.baseVersion >>> 0);
}

/** @param {ReturnType<import('./bin.js').createReader>} r */
export function readRecord(r) {
  const id = r.u16();
  const type = readShort(r);
  const ids = readIds(r);
  return { id, type, ...ids, patch: readFields(r) };
}

/** @param {ReturnType<import('./bin.js').createReader>} r */
export function readUpdate(r) {
  const id = r.u16();
  const ids = readIds(r);
  return { id, ...ids, patch: readFields(r) };
}

/** @param {ReturnType<import('./bin.js').createReader>} r */
function readIds(r) {
  return { version: r.u32(), baseVersion: r.u32() };
}
