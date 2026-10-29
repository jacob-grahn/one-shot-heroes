/** Self-describing custom values. Objects decode into Object.create(null). */

import { createWriter, encodeUtf8, readShort, writeShort } from "./bin.js";
import { KEY_BYTES, MAX_DEPTH_SAFETY, TAG } from "./defaults.js";
import { fail } from "./error.js";
import { asPlain, assertKey, isUserText, userText } from "./keys.js";

/** @param {any} w @param {unknown} v @param {number} depth */
export function encodeValue(w, v, depth) {
  if (depth > MAX_DEPTH_SAFETY) fail("depth");
  if (typeof v === "boolean") return writeBool(w, v);
  if (typeof v === "number") return writeNum(w, v);
  if (typeof v === "string" || isUserText(v)) return writeStr(w, v);
  if (Array.isArray(v)) return writeArr(w, v, depth);
  if (v && typeof v === "object") return writeObj(w, v, depth);
  fail("range", "custom value is not JSON data");
}

/** @param {any} w @param {boolean} v */
function writeBool(w, v) {
  w.u8(TAG.bool);
  w.u8(v ? 1 : 0);
}

/** @param {any} w @param {number} v */
function writeNum(w, v) {
  if (!Number.isFinite(v)) fail("range");
  if (Number.isInteger(v)) {
    w.u8(TAG.int);
    w.i32(v);
    return;
  }
  w.u8(TAG.f32);
  w.f32(v);
}

/** @param {any} w @param {unknown} v */
function writeStr(w, v) {
  w.u8(TAG.str);
  w.str16(textOf(v));
}

/** @param {any} w @param {unknown[]} v @param {number} depth */
function writeArr(w, v, depth) {
  if (v.length > KEY_BYTES) fail("range");
  w.u8(TAG.arr);
  w.u8(v.length);
  for (const item of v) encodeValue(w, item, depth + 1);
}

/** @param {any} w @param {object} v @param {number} depth */
function writeObj(w, v, depth) {
  const keys = Object.keys(v);
  if (keys.length > KEY_BYTES) fail("range");
  w.u8(TAG.obj);
  w.u8(keys.length);
  for (const k of keys) writeField(w, k, /** @type {Record<string, unknown>} */ (v)[k], depth);
}

/** @param {any} w @param {string} key @param {unknown} val @param {number} depth */
function writeField(w, key, val, depth) {
  assertKey(key);
  const bytes = encodeUtf8(key);
  if (bytes.length > KEY_BYTES) fail("range");
  w.u8(bytes.length);
  w.bytes(bytes);
  encodeValue(w, val, depth + 1);
}

/** @param {unknown} v */
function textOf(v) {
  return typeof v === "string" ? v : /** @type {{ text: string }} */ (v).text;
}

/** @param {ReturnType<import('./bin.js').createReader>} r @param {number} depth */
export function decodeValue(r, depth) {
  return decodeTag(r, r.u8(), depth);
}

/** @param {ReturnType<import('./bin.js').createReader>} r @param {number} tag @param {number} depth */
export function decodeTag(r, tag, depth) {
  if (depth > MAX_DEPTH_SAFETY) fail("depth");
  if (tag === TAG.bool) return r.u8() !== 0;
  if (tag === TAG.int) return r.i32();
  if (tag === TAG.str) return userText(r.str16());
  if (tag === TAG.f32) return r.f32();
  if (tag === TAG.arr) return decodeArr(r, depth);
  if (tag === TAG.obj) return decodeObj(r, depth);
  fail("malformed", "bad custom tag");
}

/** @param {ReturnType<import('./bin.js').createReader>} r @param {number} depth */
function decodeArr(r, depth) {
  const n = r.u8();
  const out = [];
  for (let i = 0; i < n; i++) out.push(decodeValue(r, depth + 1));
  return out;
}

/** @param {ReturnType<import('./bin.js').createReader>} r @param {number} depth */
function decodeObj(r, depth) {
  const n = r.u8();
  const out = Object.create(null);
  for (let i = 0; i < n; i++) {
    const key = readKey(r);
    out[key] = decodeValue(r, depth + 1);
  }
  return out;
}

/** @param {ReturnType<import('./bin.js').createReader>} r */
function readKey(r) {
  const key = new TextDecoder().decode(r.take(r.u8()));
  assertKey(key);
  return key;
}

/**
 * Changed keys are sent whole. `del` removes a key the baseline still has.
 * @param {any} w
 * @param {{ key: string, del?: boolean, value?: unknown }[]} ops
 */
export function encodeOps(w, ops) {
  if (ops.length > KEY_BYTES) fail("range");
  w.u8(ops.length);
  for (const op of ops) writeOp(w, op);
}

/** @param {any} w @param {{ key: string, del?: boolean, value?: unknown }} op */
function writeOp(w, op) {
  assertKey(op.key);
  writeShort(w, op.key);
  if (op.del) w.u8(TAG.del);
  else encodeValue(w, op.value, 1);
}

/** @param {ReturnType<import('./bin.js').createReader>} r */
export function decodeOps(r) {
  const n = r.u8();
  const obj = Object.create(null);
  const dels = [];
  for (let i = 0; i < n; i++) readOp(r, obj, dels);
  return { obj, dels };
}

/** @param {ReturnType<import('./bin.js').createReader>} r @param {Record<string, unknown>} obj @param {string[]} dels */
function readOp(r, obj, dels) {
  const key = readShort(r);
  assertKey(key);
  const tag = r.u8();
  if (tag === TAG.del) dels.push(key);
  else obj[key] = decodeTag(r, tag, 1);
}

/** @param {unknown} v */
export function canon(v) {
  const plain = asPlain(v);
  if (Array.isArray(plain)) return "[" + plain.map(canon).join(",") + "]";
  if (plain && typeof plain === "object")
    return canonObj(/** @type {Record<string, unknown>} */ (plain));
  return JSON.stringify(plain);
}

/** @param {Record<string, unknown>} v */
function canonObj(v) {
  const keys = Object.keys(v).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
}

/** @param {Record<string, unknown>} src */
export function cloneCustom(src) {
  const out = Object.create(null);
  for (const k of Object.keys(src || {})) out[k] = cloneVal(src[k]);
  return out;
}

/** @param {unknown} v */
function cloneVal(v) {
  const plain = asPlain(v);
  if (Array.isArray(plain)) return plain.map(cloneVal);
  if (plain && typeof plain === "object")
    return cloneCustom(/** @type {Record<string, unknown>} */ (plain));
  return plain;
}

/** Deep-clone a custom value into plain JSON data (user-text boxes become strings). */
export function plainClone(v) {
  return cloneVal(v);
}

/** Byte size of one custom value, used by the mediator's size cap. */
export function valueBytes(v) {
  const w = createWriter();
  encodeValue(w, v, 0);
  return w.length;
}
