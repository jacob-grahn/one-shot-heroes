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
    maxPlayers: optInt(src.maxPlayers, LIMITS.maxPlayers, {
      min: 1,
      max: LIMITS.maxPlayers,
      name: "manifest.maxPlayers",
    }),
    focus,
    tickHz: optInt(src.tickHz, LIMITS.tickHz, { min: 1, max: 60, name: "manifest.tickHz" }),
    budget: optInt(src.budget, LIMITS.budget, { min: 48, max: 1400, name: "manifest.budget" }),
    starvationK: optInt(src.starvationK, LIMITS.starvationK, {
      min: 1,
      max: 120,
      name: "manifest.starvationK",
    }),
    interpMs: optInt(src.interpMs, LIMITS.interpMs, {
      min: 0,
      max: 1000,
      name: "manifest.interpMs",
    }),
    teleport: optNum(src.teleport, LIMITS.teleport, "manifest.teleport"),
    cell: optNum(src.cell, LIMITS.cell, "manifest.cell"),
    focusClamp: optNum(src.focusClamp, LIMITS.focusClamp, "manifest.focusClamp"),
    inputRedundancy: optInt(src.inputRedundancy, LIMITS.inputRedundancy, {
      min: 1,
      max: 16,
      name: "manifest.inputRedundancy",
    }),
    silenceMs: optInt(src.silenceMs, 12000, { min: 1000, max: 120000, name: "manifest.silenceMs" }),
    joinTimeoutMs: optInt(src.joinTimeoutMs, 20000, {
      min: 1000,
      max: 120000,
      name: "manifest.joinTimeoutMs",
    }),
    maxEntities: optInt(src.maxEntities, 400, {
      min: 1,
      max: 100000,
      name: "manifest.maxEntities",
    }),
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
    posMin: optNum(q.posMin, LIMITS.posMin, "manifest.quant.posMin"),
    posMax: optNum(q.posMax, LIMITS.posMax, "manifest.quant.posMax"),
    scaleMin: optNum(q.scaleMin, LIMITS.scaleMin, "manifest.quant.scaleMin"),
    scaleMax: optNum(q.scaleMax, LIMITS.scaleMax, "manifest.quant.scaleMax"),
  };
  if (quant.posMin >= quant.posMax)
    fail(
      "range",
      "manifest.quant.posMin must be below posMax (got " + quant.posMin + ".." + quant.posMax + ")",
    );
  if (quant.scaleMin >= quant.scaleMax)
    fail(
      "range",
      "manifest.quant.scaleMin must be below scaleMax (got " +
        quant.scaleMin +
        ".." +
        quant.scaleMax +
        ")",
    );
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

/** @param {number} v @param {number} fallback @param {{ min: number, max: number, name: string }} rule */
function optInt(v, fallback, rule) {
  if (v == null) return fallback;
  if (!Number.isInteger(v) || v < rule.min || v > rule.max)
    fail("range", rule.name + " must be " + rule.min + ".." + rule.max + " (got " + v + ")");
  return v;
}

/** @param {number} v @param {number} fallback @param {string} name */
function optNum(v, fallback, name) {
  if (v == null) return fallback;
  if (typeof v !== "number" || !Number.isFinite(v))
    fail("range", name + " must be a finite number (got " + v + ")");
  return v;
}
