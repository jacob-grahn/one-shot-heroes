/** Input history, redundancy, and manifest checks. Invalid samples never reach update. */

import { fieldIssue } from "./wire.js";

/** @param {any} s */
export function rememberLocal(s) {
  if (!s.pendingLocal) return;
  if (inputOk(s, s.pendingLocal)) log(s, s.playerId).set(s.tick, s.pendingLocal);
  s.pendingLocal = null;
}

/** @param {any} s @param {number} playerId @param {{ tick: number, values: any }} sample */
export function rememberRemote(s, playerId, sample) {
  if (!inWindow(s, sample.tick) || !inputOk(s, sample.values)) return;
  const bag = log(s, playerId);
  const cap = behindOf(s) + LEAD + 2;
  if (!bag.has(sample.tick) && bag.size >= cap) return;
  if (!bag.has(sample.tick)) bag.set(sample.tick, sample.values);
}

const LEAD = 4;

/** @param {any} s @param {number} stamp */
function inWindow(s, stamp) {
  return stamp >= s.tick - behindOf(s) && stamp <= s.tick + LEAD;
}

/** Two seconds of ticks, so a round trip longer than the repeated history still applies. */
function behindOf(s) {
  return Math.max(s.manifest.inputRedundancy, s.manifest.tickHz * 2);
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
  return newest(bag, s.tick, behindOf(s));
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

/** @param {any} s @param {any} values */
function inputOk(s, values) {
  const issue = fieldIssue(s.manifest.inputs, values);
  if (!issue) return true;
  const message = "rejected input field " + issue;
  const warn = s.game && s.game.warn;
  if (s.dev && typeof warn === "function") warn(message);
  else if (s.dev) console.warn(message);
  return false;
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
  if (!inputOk(s, values)) return;
  const found = s.inputHist.find((sample) => sample.tick === stamp);
  if (found) found.values = values;
  else s.inputHist.push({ tick: stamp, values });
  while (s.inputHist.length > s.manifest.inputRedundancy) s.inputHist.shift();
}

/** @param {any} s */
export function pruneInputs(s) {
  const behind = behindOf(s) + 2;
  for (const bag of s.inputLog.values()) dropOld(bag, s.tick, behind);
}

/** @param {Map<number, any>} bag @param {number} tick @param {number} behind */
function dropOld(bag, tick, behind) {
  for (const stamp of [...bag.keys()]) {
    if (stamp < tick - behind || stamp > tick + LEAD) bag.delete(stamp);
  }
}
