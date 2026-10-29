/** Manifest field schemas. They validate values and name the types the codec compresses. */

import { BAD_KEYS } from "./defaults.js";
import { fail } from "./error.js";
import { assertKey } from "./keys.js";

const TYPES = new Set(["int", "bool", "string", "float", "array", "object"]);

/** @param {string} name @param {Record<string, any>} src */
export function normField(name, src) {
  assertKey(name);
  const type = src && src.type;
  if (!TYPES.has(type)) fail("range", "bad field type " + type);
  return fill(name, type, src);
}

/** @param {string} name @param {string} type @param {Record<string, any>} src */
function fill(name, type, src) {
  const field = { name, type };
  if (type === "int") intBounds(field, src);
  if (type === "string") field.max = req(src.max, 0, 65535);
  if (type === "array") arrayField(field, name, src);
  if (type === "object") field.fields = normMap(src.fields);
  return field;
}

/** @param {Record<string, any>} field @param {Record<string, any>} src */
function intBounds(field, src) {
  field.min = req(src.min, -0x80000000, 0x7fffffff);
  field.max = req(src.max, field.min, 0x7fffffff);
}

/** @param {Record<string, any>} field @param {string} name @param {Record<string, any>} src */
function arrayField(field, name, src) {
  field.max = src.max == null ? 255 : req(src.max, 0, 255);
  field.item = normField(name + "[]", src.item);
}

/** @param {Record<string, any>} [obj] */
export function normMap(obj) {
  if (!obj) return [];
  return Object.keys(obj)
    .sort()
    .map((name) => normField(name, obj[name]));
}

/** @param {Record<string, any>} [obj] */
export function normEvents(obj) {
  if (!obj) return [];
  return Object.keys(obj)
    .sort()
    .map((name) => ({ name, fields: normMap(obj[name]) }));
}

/** @param {number} v @param {number} min @param {number} max */
function req(v, min, max) {
  if (!Number.isInteger(v) || v < min || v > max) fail("range", "schema bound");
  return v;
}

/** @param {{ name: string, type: string }[]} fields @param {unknown} obj @param {boolean} partial */
export function checkRecord(fields, obj, partial) {
  return checkRecordAt(fields, obj, partial, 0);
}

/** @param {{ name: string, type: string }[]} fields @param {unknown} obj @param {boolean} partial @param {number} depth */
function checkRecordAt(fields, obj, partial, depth) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  const rec = /** @type {Record<string, unknown>} */ (obj);
  if (!keysOk(fields, rec, depth)) return false;
  if (partial) return true;
  return fields.every((f) => Object.prototype.hasOwnProperty.call(rec, f.name));
}

/** @param {{ name: string, type: string }[]} fields @param {Record<string, unknown>} rec @param {number} depth */
function keysOk(fields, rec, depth) {
  for (const k of Object.keys(rec)) {
    if (BAD_KEYS.has(k)) return false;
    const field = fields.find((f) => f.name === k);
    if (!field || !checkValue(field, rec[k], depth)) return false;
  }
  return true;
}

/** @param {Record<string, any>} field @param {unknown} value @param {number} depth */
export function checkValue(field, value, depth) {
  if (depth > 8) return false;
  if (field.type === "bool") return typeof value === "boolean";
  if (field.type === "float") return typeof value === "number" && Number.isFinite(value);
  if (field.type === "string") return typeof value === "string" && value.length <= field.max;
  if (field.type === "int") return checkInt(field, value);
  if (field.type === "array") return checkArr(field, value, depth);
  if (field.type === "object") return checkRecordAt(field.fields, value, false, depth + 1);
  return false;
}

/** @param {Record<string, any>} field @param {unknown} value */
function checkInt(field, value) {
  return Number.isInteger(value) && value >= field.min && value <= field.max;
}

/** @param {Record<string, any>} field @param {unknown} value @param {number} depth */
function checkArr(field, value, depth) {
  if (!Array.isArray(value) || value.length > field.max) return false;
  return value.every((item) => checkValue(field.item, item, depth + 1));
}
