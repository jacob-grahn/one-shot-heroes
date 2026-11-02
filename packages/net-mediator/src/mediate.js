/** Host-page gate in front of a transport. Caps are per peer and per direction. */

import { decodePacket } from "@osh/net-wire";
import { CAPS } from "./caps.js";
import { walk } from "./walk.js";

const MAX_LANES = 64;
const IDLE_MS = 10000;
const PENDING_MS = 1500;
const HOST_AUTH = new Set(["spawn", "despawn", "snap"]);

/** @param {{ caps?: Partial<import("./caps.js").CapTable>, manifest?: { maxEntities?: number }, now?: () => number, onDisconnect?: (peer: string, code: string) => void }} [options] */
export function createMediator(options) {
  const opts = options || {};
  const st = {
    caps: resolveCaps(opts),
    now: opts.now || (() => Date.now()),
    onDisconnect: opts.onDisconnect || null,
    violations: [],
    entities: 0,
    seenSpawns: new Set(),
    joined: new Set(),
    lanes: new Map(),
  };
  return {
    get caps() {
      return st.caps;
    },
    get violations() {
      return st.violations;
    },
    inspect(bytes, meta) {
      return inspect(st, bytes, meta || {});
    },
    wrap(transport) {
      return wrap(st, transport);
    },
  };
}

/** @param {any} st @param {Uint8Array} bytes @param {{ peer?: string, dir?: string, reliable?: boolean }} meta */
function inspect(st, bytes, meta) {
  const ctx = context(meta);
  if (!(bytes instanceof Uint8Array)) return block(st, ctx, "malformed");
  const packet = decodePacket(bytes);
  if (packet.ok === false)
    return block(st, ctx, packet.error === "bad_key" ? "bad_key" : "malformed");
  if (!openLane(st, ctx)) {
    st.violations.push("lanes");
    return { ok: false, code: "lanes", logged: true };
  }
  const side = lane(st, ctx.peer, ctx.dir);
  const draft = {
    entities: st.entities,
    snapBytes: side.snapBytes,
    spawns: 0,
    joins: 0,
    spawnIds: [],
    despawnIds: [],
    events: 0,
  };
  const code = walk(st.caps, draft, packet, bytes.length);
  if (code) return block(st, ctx, code);
  const rate = rates(st, { side, draft, ctx, size: bytes.length });
  if (rate) return rate;
  const limited = byteLimit(st, ctx, packet);
  const over = !room(side.bytes, st.now(), bytes.length, limited);
  addBytes(side.bytes, st.now(), bytes.length);
  const ceiling = noteCeiling(st, side, ctx, bytes.length);
  commit(st, side, draft, ctx);
  if (ceiling) return block(st, ctx, "reliable_ceiling");
  if (over && !bypass(ctx, packet)) return block(st, ctx, "bytes");
  return { ok: true };
}

/** @param {{ peer?: string, dir?: string, reliable?: boolean }} meta */
function context(meta) {
  return {
    peer: meta.peer || "*",
    dir: meta.dir === "out" ? "out" : "in",
    reliable: !!meta.reliable,
  };
}

/** @param {any} st @param {any} ctx @param {string} code */
function block(st, ctx, code) {
  const disconnect = ctx.dir === "in" && ctx.reliable && ctx.peer !== "*";
  if (disconnect && st.onDisconnect) st.onDisconnect(ctx.peer, code);
  return { ok: false, code, disconnect };
}

/** @param {any} st @param {{ side: any, draft: any, ctx: any, size: number }} bag */
function rates(st, bag) {
  const now = st.now();
  const { side, draft, ctx } = bag;
  if (draft.joins && !charge(side.joins, now, draft.joins, st.caps.joinPerSecond))
    return block(st, ctx, "join_rate");
  const relay = relayCharge(st, bag, now);
  if (relay) return relay;
  const live = liveAfter(st, draft);
  if (live == null) return block(st, ctx, "entities");
  draft.live = live;
  const fresh = freshIds(st, draft);
  if (fresh.length && !charge(side.spawns, now, fresh.length, st.caps.spawnPerSecond))
    return block(st, ctx, "spawn_rate");
  draft.fresh = fresh;
  return null;
}

/** Charge fan-out to the sender. Each sender may relay at most 1/8 of the byte cap. */
function relayCharge(st, bag, now) {
  const { side, draft, ctx, size } = bag;
  if (!draft.events || ctx.dir !== "in" || st.joined.size === 0) return null;
  const share = Math.floor(st.caps.bytesPerSecond / 8);
  if (!charge(side.relay, now, size, share)) return block(st, ctx, "relay_rate");
  const others = Math.max(0, st.joined.size - (st.joined.has(ctx.peer) ? 1 : 0));
  if (others && !room(side.bytes, now, size * others, st.caps.bytesPerSecond))
    return block(st, ctx, "bytes");
  if (others) addBytes(side.bytes, now, size * others);
  return null;
}

/** @param {any} st @param {any} draft */
function liveAfter(st, draft) {
  if (draft.snapEntities != null)
    return draft.snapEntities <= st.caps.maxEntities ? draft.snapEntities : null;
  const leaving = draft.despawnIds.filter((id) => st.seenSpawns.has(id));
  const fresh = freshIds(st, draft);
  const live = st.entities - leaving.length + fresh.length;
  return live <= st.caps.maxEntities ? live : null;
}

/** @param {any} st @param {any} draft */
function freshIds(st, draft) {
  const drop = new Set(draft.despawnIds);
  return draft.spawnIds.filter((id) => !st.seenSpawns.has(id) && !drop.has(id));
}

/** @param {any} st @param {any} side @param {any} draft @param {any} ctx */
function commit(st, side, draft, ctx) {
  if (draft.snapEntities != null) applySnap(st, draft);
  else applySpawns(st, draft);
  if (draft.snapBytes) side.snapBytes = draft.snapBytes;
  if (draft.welcome && ctx.dir === "out") st.joined.add(ctx.peer);
  if (draft.bye) forgetPeer(st, ctx.peer);
}

/** @param {any} st @param {any} draft */
function applySpawns(st, draft) {
  for (const id of draft.despawnIds) st.seenSpawns.delete(id);
  for (const id of draft.fresh || []) st.seenSpawns.add(id);
  st.entities = draft.live;
}

/** @param {any} st @param {any} draft */
function applySnap(st, draft) {
  if (draft.snapReset) st.snapSeen = new Set();
  const seen = st.snapSeen || new Set();
  for (const id of draft.snapIds || []) seen.add(id);
  st.snapSeen = seen;
  if (!draft.snapDone) return;
  st.seenSpawns = seen;
  st.snapSeen = null;
  st.entities = draft.snapEntities;
}

/** Reliable host spawn, snapshot, and despawn may pass the byte window. */
function bypass(ctx, packet) {
  return ctx.dir === "out" && ctx.reliable && hostAuth(packet);
}

/** Other reliable traffic leaves a quarter of the link for unreliable state. */
function byteLimit(st, ctx, packet) {
  if (ctx.dir === "out" && ctx.reliable && !hostAuth(packet))
    return Math.floor(st.caps.bytesPerSecond * 0.75);
  return st.caps.bytesPerSecond;
}

/** @param {any} packet */
function hostAuth(packet) {
  return packet.messages.every((message) => HOST_AUTH.has(message.type));
}

/** @param {any} st @param {any} side @param {any} ctx @param {number} n */
function noteCeiling(st, side, ctx, n) {
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

/** @param {{ items: { t: number, n: number }[], sum: number }} win @param {number} now @param {number} n */
function addBytes(win, now, n) {
  trim(win, now);
  win.items.push({ t: now, n });
  win.sum += n;
}

/** Lanes are created on demand. Idle peers are dropped even if they joined. */
function openLane(st, ctx) {
  sweepIdle(st);
  if (st.lanes.has(ctx.peer) || ctx.peer === "*") return true;
  if (st.lanes.size >= MAX_LANES) evictLane(st);
  return st.lanes.size < MAX_LANES;
}

/** Joined peers last 10s. A hello the host has not accepted lasts about 1.5s. */
function sweepIdle(st) {
  const now = st.now();
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

/** @param {{ caps?: Partial<import("./caps.js").CapTable>, manifest?: { maxEntities?: number } }} opts */
function resolveCaps(opts) {
  const caps = { ...CAPS, ...(opts.caps || {}) };
  const fromManifest = opts.manifest && opts.manifest.maxEntities;
  if (fromManifest == null) return caps;
  if (opts.caps && opts.caps.maxEntities != null && opts.caps.maxEntities !== fromManifest)
    throw new Error("mediator maxEntities does not match the manifest");
  caps.maxEntities = fromManifest;
  return caps;
}

/** Drop the oldest pending lane whose hello grace has ended. Joined peers stay. */
function evictLane(st) {
  const now = st.now();
  let oldest = "";
  let at = Infinity;
  for (const [peer, row] of st.lanes) {
    if (st.joined.has(peer) || now - row.at < PENDING_MS) continue;
    if (row.at < at) {
      at = row.at;
      oldest = peer;
    }
  }
  if (oldest) forgetPeer(st, oldest);
}

/** @param {any} st @param {string} peer */
function forgetPeer(st, peer) {
  st.joined.delete(peer);
  st.lanes.delete(peer);
}

/** @param {any} st @param {string} peer @param {string} dir */
function lane(st, peer, dir) {
  let row = st.lanes.get(peer);
  if (!row) {
    row = { in: side(), out: side(), at: st.now() };
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

/** @param {any} st @param {any} transport */
function wrap(st, transport) {
  return {
    send(to, bytes, reliable) {
      forward(st, transport, { peer: String(to), bytes, reliable: !!reliable, dir: "out" });
    },
    onMessage(handler) {
      transport.onMessage((from, bytes, reliable) => {
        if (forward(st, transport, { peer: from, bytes, reliable: !!reliable, dir: "in" }))
          handler(from, bytes, reliable);
      });
    },
    onPeerLeave(handler) {
      if (transport.onPeerLeave) transport.onPeerLeave(handler);
    },
    close() {
      if (transport.close) transport.close();
    },
    forget(peerId) {
      forgetPeer(st, String(peerId));
    },
  };
}

/** @param {any} st @param {any} transport @param {{ peer: string, bytes: Uint8Array, reliable: boolean, dir: string }} spec */
function forward(st, transport, spec) {
  const result = inspect(st, spec.bytes, spec);
  if (result.ignore) return false;
  if (result.ok) {
    if (spec.dir === "out") transport.send(spec.peer, spec.bytes, spec.reliable);
    return true;
  }
  if (spec.dir === "out" && spec.reliable && st.onDisconnect)
    st.onDisconnect(spec.peer, result.code);
  if (!result.logged) st.violations.push(result.code);
  return false;
}

function bucket() {
  return { items: [], sum: 0 };
}

/** @param {{ items: { t: number, n: number }[], sum: number }} win @param {number} now @param {number} n @param {number} limit */
function charge(win, now, n, limit) {
  if (!room(win, now, n, limit)) return false;
  win.items.push({ t: now, n });
  win.sum += n;
  return true;
}

/** @param {{ items: { t: number, n: number }[], sum: number }} win @param {number} now @param {number} n @param {number} limit */
function room(win, now, n, limit) {
  trim(win, now);
  return win.sum + n <= limit;
}

/** @param {{ items: { t: number, n: number }[], sum: number }} win @param {number} now */
function trim(win, now) {
  while (win.items.length && now - win.items[0].t >= 1000) win.sum -= win.items.shift().n;
}
