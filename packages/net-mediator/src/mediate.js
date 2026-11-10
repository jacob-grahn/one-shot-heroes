/** Host-page gate in front of a transport. Caps are per peer and per direction. */

import { decodePacket } from "@osh/net-wire";
import { forgetHello, helloBook, helloCharge, pruneHellos, versionBudget } from "./joins.js";
import {
  byteLimit,
  bypass,
  forgetPeer,
  lane,
  noteCeiling,
  openLane,
  resolveCaps,
  takeSpawns,
} from "./lanes.js";
import { walk } from "./walk.js";
import { addBytes, charge, room } from "./window.js";

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
  if (bytes.length > st.caps.maxSnapshotBytes) return block(st, ctx, "budget");
  const packet = decodePacket(bytes);
  if (packet.ok === false) {
    if (packet.error === "version") return permitVersion(st, ctx);
    return block(st, ctx, packet.error === "bad_key" ? "bad_key" : "malformed");
  }
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

/** One version packet per peer per second, and a global cap across rotating ids. */
function permitVersion(st, ctx) {
  if (!openLane(st, ctx)) {
    st.violations.push("lanes");
    return { ok: false, code: "lanes", logged: true };
  }
  if (ctx.dir !== "in") return { ok: true };
  const now = st.now();
  pruneHellos(st, now);
  const key = "v:" + ctx.peer;
  const seen = helloBook(st);
  const row = seen.get(key);
  if (row && now - row.at < 1000)
    return { ok: false, code: "join_rate", ignore: true, logged: true };
  if (!versionBudget(st, now)) return { ok: false, code: "join_rate", ignore: true, logged: true };
  const side = lane(st, ctx.peer, ctx.dir);
  if (!charge(side.joins, now, 1, st.caps.joinPerSecond)) return block(st, ctx, "join_rate");
  seen.set(key, { at: now, free: 0 });
  return { ok: true };
}

/** @param {any} st @param {{ side: any, draft: any, ctx: any, size: number }} bag */
function rates(st, bag) {
  const now = st.now();
  const { side, draft, ctx } = bag;
  if (draft.joins && !helloCharge(st, { side, ctx, now, helloId: draft.helloId }, draft.joins))
    return block(st, ctx, "join_rate");
  if (draft.helloId != null) {
    if (!st.seat) st.seat = new Map();
    st.seat.set(ctx.peer, draft.helloId);
  }
  const relay = relayCharge(st, bag, now);
  if (relay) return relay;
  const live = liveAfter(st, draft);
  if (live == null) return block(st, ctx, "entities");
  draft.live = live;
  const fresh = freshIds(st, draft);
  if (fresh.length && !takeSpawns(st, side, now, fresh.length)) return block(st, ctx, "spawn_rate");
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
  if (draft.welcome && ctx.dir === "out") {
    st.joined.add(ctx.peer);
    forgetHello(st, ctx.peer);
  }
  if (draft.reject && ctx.dir === "out") forgetHello(st, ctx.peer);
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
