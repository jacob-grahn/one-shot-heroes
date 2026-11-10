/** Host-authoritative session. Clients send inputs and render; they do not run update. */

import { createNet } from "./api.js";
import { digestOf, runStep } from "./drive.js";
import { createLink } from "./peer.js";
import { renderFrame } from "./render.js";
import {
  announce,
  assertWelcome,
  rejectPeer,
  sendBye,
  sendDirect,
  sendHello,
  trackDespawn,
  trackSpawn,
} from "./relay.js";
import { mulberry32 } from "./rng.js";
import { finish, fireEnd, fireJoin, fireLeave } from "./lifecycle.js";
import { PROTOCOL, canon, decodePacket, defineManifest, quantize } from "./wire.js";
import { createWorld } from "./world.js";

/** @param {Record<string, any>} options */
export function createSession(options) {
  const opts = options || {};
  if (
    !opts.game ||
    typeof opts.game.init !== "function" ||
    typeof opts.game.update !== "function" ||
    typeof opts.game.render !== "function"
  )
    throw new Error("createSession needs a game with init, update, and render");
  if (!opts.isHost && !opts.hostPeerId)
    throw new Error("client needs hostPeerId; pass isHost: true to host the room");
  const s = blank(opts);
  initIds(s, options);
  s.world = createWorld(hooks(s));
  s.net = createNet(s);
  s.sendDirect = (message) => sendDirect(s, message);
  listen(s);
  if (!s.isHost) {
    sendHello(s);
    s.helloGap = s.manifest.tickHz;
    s.nextHello = s.helloGap;
  }
  s.game.init(s.world, s.net);
  return facade(s);
}

/** @param {Record<string, any>} options */
function blank(options) {
  const manifest = manifestOf(options);
  assertTransport(options.transport);
  const s = shell(options, manifest, byteId(options.playerId));
  wireSession(s);
  s.rng = mulberry32(s.seed);
  s.est = () => (s.isHost ? s.shownTick : s.lastHostTick + (s.steps - s.lastHostAt));
  s.clockTick = () => (s.isHost && s.inUpdate ? s.tick : s.est());
  if (!s.isHost && !s.hostPeerId)
    throw new Error("client needs hostPeerId; pass isHost: true to host the room");
  return s;
}

/** @param {Record<string, any>} options */
function manifestOf(options) {
  if (options.manifest && options.manifest.hash) return options.manifest;
  return defineManifest(options.manifest);
}

/** @param {Record<string, any>} options @param {any} manifest @param {number} playerId */
function shell(options, manifest, playerId) {
  return {
    manifest,
    transport: options.transport,
    playerId,
    peerId: String(options.peerId || "p" + playerId),
    isHost: !!options.isHost,
    hostPeerId: options.hostPeerId || "",
    game: options.game,
    dev: options.dev !== false,
    now: typeof options.now === "function" ? options.now : () => performance.now(),
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
}

/** @param {any} s */
function wireSession(s) {
  if (s.isHost) s.players.push({ id: s.playerId, host: true });
  assertWelcome(s);
  s.quantize = quantize;
  s.canon = canon;
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
  if (!peer || peer.leaving) return;
  peer.leaving = true;
  s.peers.delete(peerId);
  s.players = s.players.filter((player) => player.id !== peer.playerId);
  s.inputLog.delete(peer.playerId);
  s.hints.delete(peer.playerId);
  s.focus.delete(peer.playerId);
  s.seen.delete(peer.playerId);
  s.epochs.delete(peer.playerId);
  const code = reason === "version" ? 1 : reason === "dropped" ? 4 : 0;
  if (code) sendReject(s, peerId, code);
  announce(s);
  if (peer.live && s.fireLeave)
    s.fireLeave({ playerId: peer.playerId, reason: reason || "replaced" });
  fireEnd(s);
}

/** The peer is already gone, so a mediator that rejects this send cannot re-enter leave. */
function sendReject(s, peerId, code) {
  try {
    rejectPeer(s, peerId, code);
  } catch (err) {
    s.stats.sendErrors = (s.stats.sendErrors || 0) + 1;
    void err;
  }
  forget(s, peerId);
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
      runStep(s);
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
      return digestOf(s);
    },
  };
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
