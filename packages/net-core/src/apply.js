/** Apply spawn, snapshot, and unreliable deltas on a client. */

import { pushSample } from "./interp.js";
import { createEntity } from "./entity.js";
import { applyState, cloneState, defaultState, materialize } from "./wire.js";

/** @param {any} s */
export function beginSnap(s) {
  for (const entity of s.world.query()) {
    if (!entity.local) s.world.remove(entity.id);
  }
  s.versions = new Map();
  s.shown = new Map();
  s.quants = new Map();
  s.pending = new Map();
  s.tomb = new Set();
  s.samples = new Map();
}

/** @param {any} s @param {any} rec @param {number} tick */
export function installRecord(s, rec, tick) {
  if (s.tomb.has(rec.id)) return;
  const quant = s.manifest.quant;
  const q = applyState(defaultState(quant), rec.patch);
  const entity = ensure(s, rec);
  materialize(entity, q, quant);
  const versions = new Map();
  versions.set(rec.version, cloneState(q));
  s.versions.set(rec.id, versions);
  s.shown.set(rec.id, rec.version);
  s.quants.set(rec.id, cloneState(q));
  pushSample(s, entity, tick);
  flushPending(s, rec.id, tick);
}

/** @param {any} s @param {any} rec */
function ensure(s, rec) {
  let entity = s.world.get(rec.id);
  if (entity) return entity;
  entity = createEntity(rec.id, rec.type || "entity", {}, false);
  s.world.ingest(entity);
  return entity;
}

/** @param {any} s @param {any} rec @param {number} tick */
export function applyUpdate(s, rec, tick) {
  if (s.tomb.has(rec.id)) return;
  const versions = s.versions.get(rec.id);
  if (!versions) return hold(s, rec, tick);
  const base = versions.get(rec.baseVersion);
  if (!base) return;
  const next = applyState(base, rec.patch);
  versions.set(rec.version, cloneState(next));
  prune(versions, rec.baseVersion);
  show(s, rec, next, tick);
}

/** @param {any} s @param {any} rec @param {any} next @param {number} tick */
function show(s, rec, next, tick) {
  if (rec.version <= (s.shown.get(rec.id) ?? -1)) return;
  const entity = s.world.get(rec.id);
  if (!entity) return;
  materialize(entity, next, s.manifest.quant);
  s.shown.set(rec.id, rec.version);
  s.quants.set(rec.id, cloneState(next));
  pushSample(s, entity, tick);
}

/** @param {Map<number, any>} versions @param {number} baseVersion */
function prune(versions, baseVersion) {
  for (const version of [...versions.keys()]) {
    if (version < baseVersion) versions.delete(version);
  }
}

/** @param {any} s @param {any} rec @param {number} tick */
function hold(s, rec, tick) {
  const list = s.pending.get(rec.id) || [];
  list.push({ rec, tick });
  s.pending.set(rec.id, list);
}

/** @param {any} s @param {number} id @param {number} tick */
function flushPending(s, id, tick) {
  const list = s.pending.get(id);
  if (!list) return;
  s.pending.delete(id);
  list.sort((a, b) => a.rec.version - b.rec.version);
  for (const item of list) applyUpdate(s, item.rec, item.tick ?? tick);
}

/** @param {any} s @param {number} id */
export function dropEntity(s, id) {
  s.world.remove(id);
  s.tomb.add(id);
  s.versions.delete(id);
  s.shown.delete(id);
  s.quants.delete(id);
  s.pending.delete(id);
  s.samples.delete(id);
}
