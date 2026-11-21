/** Peer lanes, idle eviction, and the spawn token bucket. */

import { CAPS } from "./caps.js";
import { forgetHello, pruneHellos } from "./joins.js";
import { addBytes, bucket } from "./window.js";

const MAX_LANES = 64;
const IDLE_MS = 10000;
const PENDING_MS = 1500;
const HOST_AUTH = new Set(["spawn", "despawn", "snap"]);

/** @param {any} ctx @param {any} packet */
export function bypass(ctx, packet) {
  return ctx.dir === "out" && ctx.reliable && hostAuth(packet);
}

/** @param {any} st @param {any} ctx @param {any} packet */
export function byteLimit(st, ctx, packet) {
  if (ctx.dir === "out" && ctx.reliable && !hostAuth(packet))
    return Math.floor(st.caps.bytesPerSecond * 0.75);
  return st.caps.bytesPerSecond;
}

/** @param {any} packet */
function hostAuth(packet) {
  return packet.messages.every((message) => HOST_AUTH.has(message.type));
}

/** @param {any} st @param {any} side @param {any} ctx @param {number} n */
export function noteCeiling(st, side, ctx, n) {
  if (!(ctx.dir === "out" && ctx.reliable)) return false;
  const now = st.now();
  addBytes(side.hot, now, n);
  const cap = st.caps.bytesPerSecond * 2;
  if (side.hot.sum <= cap) {
    side.overSince = 0;
    return false;
  }
  if (!side.overSince) side.overSince = now;
  return now - side.overSince > 1000;
}

/** @param {any} st @param {any} ctx */
export function openLane(st, ctx) {
  sweepIdle(st);
  if (st.lanes.has(ctx.peer) || ctx.peer === "*") return true;
  if (st.lanes.size >= MAX_LANES) evictLane(st);
  return st.lanes.size < MAX_LANES;
}

/** @param {any} st */
function sweepIdle(st) {
  const now = st.now();
  pruneHellos(st, now);
  if (st.joinHold && now - (st.holdSweptAt || 0) >= 1000) {
    st.holdSweptAt = now;
    for (const [peer, hold] of st.joinHold) if (now >= hold.until) st.joinHold.delete(peer);
  }
  const idle = [];
  for (const [peer, row] of st.lanes) {
    if (peer !== "*" && now - row.at >= idleLimit(st, peer)) idle.push(peer);
  }
  for (const peer of idle) forgetPeer(st, peer);
}

/** @param {any} st @param {string} peer */
function idleLimit(st, peer) {
  return st.joined.has(peer) ? IDLE_MS : PENDING_MS;
}

/** @param {{ caps?: Partial<import("./caps.js").CapTable>, manifest?: { maxEntities?: number, spawnPerSecond?: number, spawnBurst?: number } }} opts */
export function resolveCaps(opts) {
  const caps = { ...CAPS, ...(opts.caps || {}) };
  const manifest = opts.manifest;
  if (!manifest) return caps;
  copyCap(caps, opts.caps, manifest, "maxEntities");
  copyCap(caps, opts.caps, manifest, "spawnPerSecond");
  copyCap(caps, opts.caps, manifest, "spawnBurst");
  const declared = stringMax(manifest);
  if (declared > caps.maxString) caps.maxString = declared;
  return caps;
}

/** @param {any} caps @param {any} explicit @param {any} manifest @param {string} key */
function copyCap(caps, explicit, manifest, key) {
  if (manifest[key] == null) return;
  if (explicit && explicit[key] != null && explicit[key] !== manifest[key])
    throw new Error("mediator " + key + " does not match the manifest");
  caps[key] = manifest[key];
}

/** @param {any} manifest */
function stringMax(manifest) {
  let n = 0;
  visit(manifest.custom);
  visit(manifest.inputs);
  for (const event of manifest.events || []) visit(event.fields);
  return n;

  /** @param {any[] | undefined} fields */
  function visit(fields) {
    for (const field of fields || []) {
      if (field.type === "string" && field.max > n) n = field.max;
      if (field.item) visit([field.item]);
      if (field.fields) visit(field.fields);
    }
  }
}

/** @param {any} st */
function evictLane(st) {
  let oldest = "";
  let at = Infinity;
  for (const [peer, row] of st.lanes) {
    if (st.joined.has(peer)) continue;
    if (row.at < at) {
      at = row.at;
      oldest = peer;
    }
  }
  if (oldest) forgetPeer(st, oldest);
}

/** One room bucket. A gap shorter than half a tick does not refill, matching silence. */
export function takeSpawns(st, _side, now, n) {
  const rate = st.caps.spawnPerSecond;
  const burst = st.caps.spawnBurst;
  const bag = st.spawnBucket || (st.spawnBucket = { tokens: burst, at: now });
  const gap = now - bag.at;
  const half = 500 / (st.tickHz || 20);
  if (gap >= half) {
    bag.tokens = Math.min(burst, bag.tokens + (gap / 1000) * rate);
    bag.at = now;
  }
  if (bag.tokens < 1) return false;
  bag.tokens -= n;
  return true;
}

/** @param {any} st @param {string} peer */
export function forgetPeer(st, peer) {
  const row = st.lanes.get(peer);
  if (row) {
    if (!st.joinHold) st.joinHold = new Map();
    st.joinHold.set(peer, { in: row.in.joins, out: row.out.joins, until: st.now() + 10000 });
  }
  st.joined.delete(peer);
  st.lanes.delete(peer);
  if (st.seat) st.seat.delete(peer);
  forgetHello(st, peer);
}

/** @param {any} st @param {string} peer @param {string} dir */
export function lane(st, peer, dir) {
  let row = st.lanes.get(peer);
  if (!row) {
    row = { in: side(), out: side(), at: st.now() };
    const hold = st.joinHold && st.joinHold.get(peer);
    if (hold && st.now() < hold.until) {
      row.in.joins = hold.in;
      row.out.joins = hold.out;
    }
    st.lanes.set(peer, row);
  }
  row.at = st.now();
  return row[dir];
}

function side() {
  return {
    bytes: bucket(),
    spawns: bucket(),
    joins: bucket(),
    relay: bucket(),
    hot: bucket(),
    snapBytes: 0,
    overSince: 0,
  };
}
