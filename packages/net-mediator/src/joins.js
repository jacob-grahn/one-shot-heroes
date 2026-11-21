/** Hello retries and the global version-refusal budget. */

import { charge } from "./window.js";

const HELLO_FREE = 3;
const VERSION_BUDGET = 8;

/** @param {any} st @param {{ ctx: any, helloId?: number }} bag */
export function seatChanged(st, bag) {
  if (bag.helloId == null || !st.seat) return false;
  const prev = st.seat.get(bag.ctx.peer);
  return prev != null && prev !== bag.helloId;
}

/** Three free retries per join attempt. A joined peer that changes id still pays. */
export function helloCharge(st, bag, n) {
  if (st.joined.has(bag.ctx.peer) && !seatChanged(st, bag) && !bag.bye) return true;
  pruneHellos(st, bag.now);
  const key = bag.ctx.peer + ":" + bag.ctx.dir;
  const seen = helloBook(st);
  const row = seen.get(key);
  if (row && n === 1 && bag.now - row.at < 1000 && row.free > 0) {
    row.free -= 1;
    return true;
  }
  if (!charge(bag.side.joins, bag.now, n, st.caps.joinPerSecond)) return false;
  if (!row || bag.now - row.at >= 1000) seen.set(key, { at: bag.now, free: HELLO_FREE });
  return true;
}

/** @param {any} st @param {number} now */
export function versionBudget(st, now) {
  const bag = st.verBudget || (st.verBudget = { at: now, n: 0 });
  if (now - bag.at >= 1000) {
    bag.at = now;
    bag.n = 0;
  }
  if (bag.n >= VERSION_BUDGET) return false;
  bag.n += 1;
  return true;
}

/** @param {any} st */
export function helloBook(st) {
  return st.helloTry || (st.helloTry = new Map());
}

/** @param {any} st @param {string} peer */
export function forgetHello(st, peer) {
  const seen = st.helloTry;
  if (!seen) return;
  seen.delete(peer + ":in");
  seen.delete(peer + ":out");
}

/** @param {any} st @param {number} now */
export function pruneHellos(st, now) {
  const seen = st.helloTry;
  if (!seen) return;
  for (const [key, row] of seen) if (now - row.at > 10000) seen.delete(key);
}
