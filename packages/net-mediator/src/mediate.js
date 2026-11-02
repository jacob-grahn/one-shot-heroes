/** Host-page gate in front of a transport. Caps are per peer and per direction. */

import { decodePacket } from "@osh/net-wire";
import { CAPS } from "./caps.js";
import { walk } from "./walk.js";

/** @param {{ caps?: Partial<import("./caps.js").CapTable>, now?: () => number, onDisconnect?: (peer: string, code: string) => void }} [options] */
export function createMediator(options) {
  const opts = options || {};
  const st = {
    caps: { ...CAPS, ...(opts.caps || {}) },
    now: opts.now || (() => Date.now()),
    onDisconnect: opts.onDisconnect || null,
    violations: [],
    entities: 0,
    seenSpawns: new Set(),
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
  const side = lane(st, ctx.peer, ctx.dir);
  const draft = {
    entities: st.entities,
    snapBytes: side.snapBytes,
    spawns: 0,
    joins: 0,
    spawnIds: [],
  };
  const code = walk(st.caps, draft, packet, bytes.length);
  if (code) return block(st, ctx, code);
  const rate = rates(st, side, draft, ctx);
  if (rate) return rate;
  const over = !room(side.bytes, st.now(), bytes.length, st.caps.bytesPerSecond);
  addBytes(side.bytes, st.now(), bytes.length);
  commit(st, side, draft);
  if (over && !(ctx.dir === "out" && ctx.reliable)) return block(st, ctx, "bytes");
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
  const disconnect = ctx.dir === "in" && ctx.reliable;
  if (disconnect && st.onDisconnect) st.onDisconnect(ctx.peer, code);
  return { ok: false, code, disconnect };
}

/** @param {any} st @param {any} side @param {any} draft @param {any} ctx */
function rates(st, side, draft, ctx) {
  const now = st.now();
  if (draft.joins && !charge(side.joins, now, draft.joins, st.caps.joinPerSecond))
    return block(st, ctx, "join_rate");
  const fresh = draft.spawnIds.filter((id) => !st.seenSpawns.has(id));
  const base = draft.snapEntities != null ? draft.snapEntities : st.entities;
  if (base + fresh.length > st.caps.maxEntities) return block(st, ctx, "entities");
  if (fresh.length && !charge(side.spawns, now, fresh.length, st.caps.spawnPerSecond))
    return block(st, ctx, "spawn_rate");
  draft.fresh = fresh;
  return null;
}

/** @param {any} st @param {any} side @param {any} draft */
function commit(st, side, draft) {
  for (const id of draft.fresh || []) st.seenSpawns.add(id);
  if (draft.snapEntities != null) st.entities = draft.snapEntities;
  if (draft.fresh) st.entities += draft.fresh.length;
  if (draft.snapBytes) side.snapBytes = draft.snapBytes;
}

/** @param {{ items: { t: number, n: number }[], sum: number }} win @param {number} now @param {number} n */
function addBytes(win, now, n) {
  trim(win, now);
  win.items.push({ t: now, n });
  win.sum += n;
}

/** @param {any} st @param {string} peer @param {string} dir */
function lane(st, peer, dir) {
  let row = st.lanes.get(peer);
  if (!row) {
    row = { in: side(), out: side() };
    st.lanes.set(peer, row);
  }
  return row[dir];
}

function side() {
  return { bytes: bucket(), spawns: bucket(), joins: bucket(), snapBytes: 0 };
}

/** @param {any} st @param {any} transport */
function wrap(st, transport) {
  return {
    send(to, bytes, reliable) {
      forward(st, transport, { peer: to, bytes, reliable, dir: "out" });
    },
    onMessage(handler) {
      transport.onMessage((from, bytes, reliable) => {
        if (forward(st, transport, { peer: from, bytes, reliable, dir: "in" }))
          handler(from, bytes, reliable);
      });
    },
    onPeerLeave(handler) {
      if (transport.onPeerLeave) transport.onPeerLeave(handler);
    },
    close() {
      if (transport.close) transport.close();
    },
  };
}

/** @param {any} st @param {any} transport @param {{ peer: string, bytes: Uint8Array, reliable: boolean, dir: string }} spec */
function forward(st, transport, spec) {
  const result = inspect(st, spec.bytes, spec);
  if (result.ok || keepFull(spec, result)) {
    if (spec.dir === "out") transport.send(spec.peer, spec.bytes, spec.reliable);
    return true;
  }
  // Inbound reliable failures already disconnect inside inspect. Outbound ones
  // must too: a dropped spawn or snapshot would desync that peer for good.
  if (spec.dir === "out" && spec.reliable && st.onDisconnect)
    st.onDisconnect(spec.peer, result.code);
  st.violations.push(result.code);
  return false;
}

/** Byte pressure still forwards host reliable traffic. Every other reliable failure does not. */
function keepFull(spec, result) {
  return spec.dir === "out" && spec.reliable && result.code === "bytes";
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
