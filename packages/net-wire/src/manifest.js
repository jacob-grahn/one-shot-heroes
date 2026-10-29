/** Normalize a game manifest and hash it for the handshake. */

import { LIMITS } from "./defaults.js";
import { fail } from "./error.js";
import { fnv1a, stable } from "./hash.js";
import { assertKey } from "./keys.js";
import { normEvents, normMap } from "./schema.js";

const FOCUS = new Set(["none", "game", "avatar"]);

/** @param {Record<string, any>} [input] */
export function defineManifest(input) {
  const src = input || {};
  const focus = src.focus || "none";
  if (!FOCUS.has(focus)) fail("range", "focus must be none, game, or avatar");
  const body = manifestBody(src, focus);
  body.hash = fnv1a(stable(body));
  return deepFreeze(body);
}

/** @param {any} value */
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return value;
}

/** @param {Record<string, any>} src @param {string} focus */
function manifestBody(src, focus) {
  return {
    maxPlayers: optInt(src.maxPlayers, 1, LIMITS.maxPlayers, LIMITS.maxPlayers),
    focus,
    tickHz: optInt(src.tickHz, 1, 60, LIMITS.tickHz),
    budget: optInt(src.budget, 48, 1400, LIMITS.budget),
    starvationK: optInt(src.starvationK, 1, 120, LIMITS.starvationK),
    interpMs: optInt(src.interpMs, 0, 1000, LIMITS.interpMs),
    teleport: optNum(src.teleport, LIMITS.teleport),
    cell: optNum(src.cell, LIMITS.cell),
    focusClamp: optNum(src.focusClamp, LIMITS.focusClamp),
    inputRedundancy: optInt(src.inputRedundancy, 1, 16, LIMITS.inputRedundancy),
    avatarType: src.avatarType || "",
    avatarOwnerKey: ownerKey(src.avatarOwnerKey),
    quant: normQuant(src.quant),
    inputs: normMap(src.inputs),
    custom: normMap(src.custom),
    events: normEvents(src.events),
    types: plainDict(src.types),
  };
}

/** @param {string} [key] */
function ownerKey(key) {
  const name = key || "owner";
  assertKey(name);
  return name;
}

/** @param {Record<string, any>} [src] */
function normQuant(src) {
  const q = src || {};
  const quant = {
    posMin: optNum(q.posMin, LIMITS.posMin),
    posMax: optNum(q.posMax, LIMITS.posMax),
    scaleMin: optNum(q.scaleMin, LIMITS.scaleMin),
    scaleMax: optNum(q.scaleMax, LIMITS.scaleMax),
  };
  if (quant.posMin >= quant.posMax || quant.scaleMin >= quant.scaleMax)
    fail("range", "quant range");
  return quant;
}

/** @param {Record<string, any>} [obj] */
function plainDict(obj) {
  const out = Object.create(null);
  if (!obj) return out;
  for (const k of Object.keys(obj)) {
    assertKey(k);
    out[k] = obj[k];
  }
  return out;
}

/** @param {number} v @param {number} min @param {number} max @param {number} fallback */
function optInt(v, min, max, fallback) {
  if (v == null) return fallback;
  if (!Number.isInteger(v) || v < min || v > max) fail("range");
  return v;
}

/** @param {number} v @param {number} fallback */
function optNum(v, fallback) {
  if (v == null) return fallback;
  if (typeof v !== "number" || !Number.isFinite(v)) fail("range");
  return v;
}
