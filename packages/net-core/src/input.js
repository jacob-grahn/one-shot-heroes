/** Input history, redundancy, and manifest checks. Invalid samples never reach update. */

import { checkRecord } from "./wire.js";

/** @param {any} s */
export function rememberLocal(s) {
  if (!s.pendingLocal) return;
  if (checkRecord(s.manifest.inputs, s.pendingLocal, false))
    log(s, s.playerId).set(s.tick, s.pendingLocal);
  s.pendingLocal = null;
}

/** @param {any} s @param {number} playerId @param {{ tick: number, values: any }} sample */
export function rememberRemote(s, playerId, sample) {
  if (!checkRecord(s.manifest.inputs, sample.values, false)) return;
  const bag = log(s, playerId);
  if (!bag.has(sample.tick)) bag.set(sample.tick, sample.values);
}

/** @param {any} s */
export function inputsFor(s) {
  const out = Object.create(null);
  for (const player of s.players) out[player.id] = pick(s, player.id);
  return out;
}

/** @param {any} s @param {number} playerId */
function pick(s, playerId) {
  const bag = s.inputLog.get(playerId);
  if (!bag) return null;
  if (bag.has(s.tick)) return bag.get(s.tick);
  return newest(bag, s.tick, s.manifest.inputRedundancy);
}

/** @param {Map<number, any>} bag @param {number} tick @param {number} window */
function newest(bag, tick, window) {
  let best = null;
  let at = -1;
  for (const [stamp, values] of bag) {
    if (stamp < tick && tick - stamp <= window && stamp > at) {
      best = values;
      at = stamp;
    }
  }
  return best;
}

/** @param {any} s @param {number} playerId */
function log(s, playerId) {
  let bag = s.inputLog.get(playerId);
  if (!bag) {
    bag = new Map();
    s.inputLog.set(playerId, bag);
  }
  return bag;
}

/** @param {any} s @param {number} stamp @param {any} values */
export function pushHist(s, stamp, values) {
  if (!checkRecord(s.manifest.inputs, values, false)) return;
  const found = s.inputHist.find((sample) => sample.tick === stamp);
  if (found) found.values = values;
  else s.inputHist.push({ tick: stamp, values });
  while (s.inputHist.length > s.manifest.inputRedundancy) s.inputHist.shift();
}

/** @param {any} s */
export function pruneInputs(s) {
  const keep = s.manifest.inputRedundancy + 2;
  for (const bag of s.inputLog.values()) dropOld(bag, s.tick, keep);
}

/** @param {Map<number, any>} bag @param {number} tick @param {number} keep */
function dropOld(bag, tick, keep) {
  for (const stamp of [...bag.keys()]) {
    if (tick - stamp > keep) bag.delete(stamp);
  }
}
