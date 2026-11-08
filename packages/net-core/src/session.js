/** Host-authoritative session. Clients send inputs and render; they do not run update. */

import { noteAnims, stampAnims } from "./anim.js";
import { createNet } from "./api.js";
import { drain } from "./inbox.js";
import { inputsFor, pruneInputs, pushHist, rememberLocal } from "./input.js";
import { createLink } from "./peer.js";
import { renderFrame } from "./render.js";
import {
  announce,
  assertWelcome,
  flushReliable,
  rejectPeer,
  sendBye,
  sendClient,
  sendDirect,
  sendHello,
  trackDespawn,
  trackSpawn,
} from "./relay.js";
import { refreshSlots, sendDirty } from "./state-send.js";
import { mulberry32 } from "./rng.js";
import { finish, fireEnd, fireJoin, fireLeave } from "./lifecycle.js";
import { PROTOCOL, canon, decodePacket, defineManifest, quantize } from "./wire.js";
import { createWorld } from "./world.js";

/** @param {Record<string, any>} options */
export function createSession(options) {
  const opts = options || {};
  if (!opts.game || typeof opts.game.init !== "function" || typeof opts.game.update !== "function")
    throw new Error("createSession needs a game with init, update, and render");
  if (!opts.isHost && !opts.hostPeerId)
    throw new Error("client needs hostPeerId; pass isHost: true to host the room");
  const s = blank(opts);
  initIds(s, options);
  s.world = createWorld(hooks(s));
  s.net = createNet(s);
  s.sendDirect = (message) => sendDirect(s, message);
  listen(s);
  if (!s.isHost) sendHello(s);
  s.game.init(s.world, s.net);
  return facade(s);
}

/** @param {Record<string, any>} options */
function blank(options) {
  const manifest =
    options.manifest && options.manifest.hash ? options.manifest : defineManifest(options.manifest);
  assertTransport(options.transport);
  const playerId = byteId(options.playerId);
  const s = {
    manifest,
    transport: options.transport,
    playerId,
    peerId: String(options.peerId || "p" + playerId),
    isHost: !!options.isHost,
    hostPeerId: options.hostPeerId || "",
    game: options.game,
    dev: options.dev !== false,
    trace: !!options.trace,
    seed: options.seed == null ? freshSeed() : options.seed >>> 0,
    proto: PROTOCOL,
    tick: 0,
    shownTick: 0,
    inUpdate: false,
    steps: 0,
    lastHostTick: 0,
    lastHostAt: 0,
    haveSeed: !!options.isHost,
    joined: !!options.isHost,
    ended: false,
    reason: "",
    players: [],
    peers: new Map(),
    link: createLink(),
    inbox: [],
    focus: new Map(),
    hints: new Map(),
    hint: null,
    pendingLocal: null,
    inputHist: [],
    inputLog: new Map(),
    listeners: new Map(),
    seen: new Map(),
    cursors: new Map(),
    eventSeq: 0,
    versions: new Map(),
    shown: new Map(),
    quants: new Map(),
    pending: new Map(),
    tomb: new Set(),
    samples: new Map(),
    decode: decodePacket,
    slots: new Map(),
    sink: null,
    stats: freshStats(),
  };
  wireSession(s);
  s.rng = mulberry32(s.seed);
  s.est = () => (s.isHost ? s.shownTick : s.lastHostTick + (s.steps - s.lastHostAt));
  s.clockTick = () => (s.isHost && s.inUpdate ? s.tick : s.est());
  if (!s.isHost && !s.hostPeerId)
    throw new Error("client needs hostPeerId; pass isHost: true to host the room");
  return s;
}

/** @param {any} s */
function wireSession(s) {
  if (s.isHost) s.players.push({ id: s.playerId, host: true });
  assertWelcome(s);
  s.dropPeer = (peerId) => leave(s, peerId, "dropped");
  s.releasePeer = (peerId) => leave(s, peerId, "replaced");
  s.dropFor = (peerId, reason) => leave(s, peerId, reason);
  s.fireJoin = (info) => fireJoin(s, info);
  s.fireEnd = () => fireEnd(s);
  s.fireLeave = (info) => fireLeave(s, info);
}

/** @param {any} s @param {Record<string, any>} options */
function initIds(s, options) {
  s.nextNetId = startId(options.idStart);
  s.epochs = new Map();
  s.nextEpoch = 0;
}

/** @param {any} start */
function startId(start) {
  if (start == null) return 1;
  const id = /** @type {number} */ (start);
  if (!Number.isInteger(id) || id < 1 || id > 0x100000000) throw new Error("bad id start");
  return id;
}

/** Last id is 2^32-1. The next spawn ends the session instead of wrapping. */
function takeId(s) {
  if (s.nextNetId > 0xffffffff) {
    exhaustIds(s);
    throw new Error("entity ids exhausted");
  }
  return s.nextNetId++;
}

/** @param {any} s */
function exhaustIds(s) {
  if (s.ended) return;
  sendBye(s);
  finish(s, "ids");
}

function freshStats() {
  return {
    packets: 0,
    bytes: 0,
    maxPacket: 0,
    reliableDrops: 0,
    skipped: 0,
    customReverted: 0,
    updateErrors: 0,
    staleness: 0,
    sends: [],
    phases: { diff: 0, grid: 0, priority: 0, encode: 0, alloc: 0, other: 0 },
  };
}

/** @param {any} transport */
function assertTransport(transport) {
  if (
    !transport ||
    typeof transport.send !== "function" ||
    typeof transport.onMessage !== "function"
  ) {
    throw new Error("transport needs send(to, bytes, reliable) and onMessage(handler)");
  }
}

/** @param {number} id */
function byteId(id) {
  if (!Number.isInteger(id) || id < 0 || id > 255) throw new Error("playerId must be a byte");
  return id;
}

/** @param {any} s */
function hooks(s) {
  return {
    canSpawn: (local) => local || s.isHost,
    canDespawn: () => s.isHost,
    allocId: () => takeId(s),
    entityCap: () => s.manifest.maxEntities,
    onSpawn: (entity) => {
      if (s.isHost) trackSpawn(s, entity);
    },
    onDespawn: (entity) => {
      if (s.isHost) trackDespawn(s, entity);
    },
  };
}

function freshSeed() {
  const cryptoRef = /** @type {{ getRandomValues?: (array: Uint32Array) => Uint32Array }} */ (
    /** @type {any} */ (globalThis).crypto
  );
  if (cryptoRef && cryptoRef.getRandomValues) {
    const buf = new Uint32Array(1);
    cryptoRef.getRandomValues(buf);
    return buf[0] || 1;
  }
  return (Math.random() * 0x100000000) >>> 0 || 1;
}

/** @param {any} s */
function listen(s) {
  s.transport.onMessage((from, bytes) => s.inbox.push({ from, bytes }));
  if (s.transport.onPeerLeave) s.transport.onPeerLeave((peerId) => leave(s, peerId, "dropped"));
}

/** @param {any} s @param {string} peerId @param {string} [reason] */
function leave(s, peerId, reason) {
  if (!s.isHost && peerId === s.hostPeerId) {
    finish(s, "host_left");
    return;
  }
  const peer = s.peers.get(peerId);
  if (!peer) return;
  const code = reason === "version" ? 1 : reason === "dropped" ? 4 : 0;
  if (code) rejectPeer(s, peerId, code);
  s.peers.delete(peerId);
  s.players = s.players.filter((player) => player.id !== peer.playerId);
  s.inputLog.delete(peer.playerId);
  s.hints.delete(peer.playerId);
  s.focus.delete(peer.playerId);
  s.seen.delete(peer.playerId);
  s.epochs.delete(peer.playerId);
  if (code) forget(s, peerId);
  announce(s);
  if (s.fireLeave) s.fireLeave({ peerId, reason: reason || "replaced" });
  fireEnd(s);
}

/** @param {any} s @param {string} peerId */
function forget(s, peerId) {
  if (s.transport && typeof s.transport.forget === "function") s.transport.forget(peerId);
}

/** @param {any} s */
function facade(s) {
  return {
    get world() {
      return s.world;
    },
    get net() {
      return s.net;
    },
    get joined() {
      return s.joined;
    },
    get ended() {
      return s.ended;
    },
    get reason() {
      return s.reason;
    },
    get stats() {
      return s.stats;
    },
    get tick() {
      return s.est();
    },
    setInput(input) {
      s.pendingLocal = input;
    },
    step() {
      step(s);
    },
    render(draw) {
      renderFrame(s, draw);
    },
    close() {
      close(s);
    },
    dropPeer(peerId) {
      s.dropPeer(String(peerId));
    },
    digest() {
      return digest(s);
    },
  };
}

/** @param {any} s */
function step(s) {
  if (s.ended) {
    fireEnd(s);
    return;
  }
  if (s.isHost) stepHost(s);
  else stepClient(s);
  fireEnd(s);
}

/** @param {any} s */
function stepHost(s) {
  const t = performance.now();
  drain(s);
  sweepSilent(s);
  rememberLocal(s);
  const prev = noteAnims(s);
  runUpdate(s);
  stampAnims(s, prev);
  s.stats.phases.other += performance.now() - t;
  refreshSlots(s);
  for (const peer of s.peers.values()) sendPeer(s, peer);
  noteStale(s);
  pruneInputs(s);
  s.shownTick = s.tick;
  s.tick += 1;
}

/** @param {any} s */
function runUpdate(s) {
  s.inUpdate = true;
  try {
    s.game.update(1 / s.manifest.tickHz, inputsFor(s), s.world, s.net);
  } catch (err) {
    if (customCap(err)) {
      s.stats.customReverted += 1;
      warnPartial(s);
    } else reportUpdate(s, err);
  } finally {
    s.inUpdate = false;
  }
}

/** @param {any} s @param {unknown} err */
function reportUpdate(s, err) {
  s.stats.updateErrors = (s.stats.updateErrors || 0) + 1;
  const message = err instanceof Error ? err.message : String(err);
  const warn = s.game && s.game.warn;
  if (s.dev && typeof warn === "function") warn("update failed: " + message);
  else if (s.dev) console.warn("update failed: " + message);
}

/** The oversize write is reverted. Earlier edits in the tick stay, and dev games are told. */
function warnPartial(s) {
  const message = "custom data exceeds 1024 bytes; this tick was left partial";
  const warn = s.game && s.game.warn;
  if (s.dev && typeof warn === "function") warn(message);
  else if (s.dev) console.warn(message);
}

/** @param {any} s @param {any} peer */
function sendPeer(s, peer) {
  flushReliable(s, peer);
  if (peer.live) sendDirty(s, peer);
}

/** @param {any} s */
function stepClient(s) {
  s.steps += 1;
  drain(s);
  if (s.pendingLocal) {
    pushHist(s, s.est(), s.pendingLocal);
    s.pendingLocal = null;
  }
  if (!s.joined && !s.ended && s.steps % 10 === 0) sendHello(s);
  if (s.joined && !s.ended) sendClient(s);
}

/** @param {any} s */
function close(s) {
  if (!s.ended) {
    if (s.isHost) {
      sendBye(s);
      for (const peerId of [...s.peers.keys()]) forget(s, peerId);
    } else sendDirect(s, { type: "bye" });
  }
  finish(s, s.reason || "close");
}

/** Drop a joined peer that has sent nothing for silenceMs of host time. */
function sweepSilent(s) {
  const limit = Math.ceil((s.manifest.silenceMs / 1000) * s.manifest.tickHz);
  for (const peer of [...s.peers.values()]) {
    if (!peer.live) continue;
    if (s.tick - (peer.lastHeard || 0) < limit) continue;
    leave(s, peer.peerId, "dropped");
  }
}

/** @param {any} s */
function noteStale(s) {
  let stale = 0;
  for (const peer of s.peers.values()) {
    for (const at of peer.dirtyAt.values()) {
      const age = s.tick - at;
      if (age > stale) stale = age;
    }
  }
  s.stats.staleness = stale;
}

/** @param {unknown} err */
function customCap(err) {
  return !!(err && String(/** @type {Error} */ (err).message).includes("custom data exceeds 1024"));
}

/** @param {any} s */
function digest(s) {
  const rows = [];
  for (const entity of s.world.query()) {
    if (entity.local) continue;
    const q = s.isHost ? quantize(entity, s.manifest.quant) : s.quants.get(entity.id);
    if (q) rows.push(row(entity, q));
  }
  rows.sort((a, b) => a.id - b.id);
  return rows.map((item) => item.text).join("|");
}

/** @param {any} entity @param {any} q */
function row(entity, q) {
  const text = [
    entity.id,
    entity.type,
    q.x,
    q.y,
    q.rotation,
    q.scale,
    q.anim,
    q.animStart,
    canon(q.custom),
  ].join(",");
  return { id: entity.id, text };
}
