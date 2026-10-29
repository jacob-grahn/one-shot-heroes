/** Host-authoritative session. Clients send inputs and render; they do not run update. */

import { noteAnims, stampAnims } from "./anim.js";
import { createNet } from "./api.js";
import { drain } from "./inbox.js";
import { inputsFor, pruneInputs, pushHist, rememberLocal } from "./input.js";
import { createLink } from "./peer.js";
import { renderFrame } from "./render.js";
import {
  announce,
  flushReliable,
  sendBye,
  sendClient,
  sendDirect,
  sendHello,
  sendState,
  trackDespawn,
  trackSpawn,
} from "./relay.js";
import { mulberry32 } from "./rng.js";
import { PROTOCOL, canon, decodePacket, defineManifest, quantize } from "./wire.js";
import { createWorld } from "./world.js";

/** @param {Record<string, any>} options */
export function createSession(options) {
  const s = blank(options);
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
    seed: options.seed ?? 1,
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
    seen: new Set(),
    eventSeq: 0,
    versions: new Map(),
    shown: new Map(),
    quants: new Map(),
    pending: new Map(),
    tomb: new Set(),
    samples: new Map(),
    decode: decodePacket,
    stats: { packets: 0, bytes: 0, maxPacket: 0, sends: [] },
  };
  s.rng = mulberry32(s.seed);
  s.est = () => (s.isHost ? s.shownTick : s.lastHostTick + (s.steps - s.lastHostAt));
  s.clockTick = () => (s.isHost && s.inUpdate ? s.tick : s.est());
  if (s.isHost) s.players.push({ id: playerId, host: true });
  if (!s.isHost && !s.hostPeerId) throw new Error("client needs hostPeerId");
  return s;
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
    onSpawn: (entity) => {
      if (s.isHost) trackSpawn(s, entity);
    },
    onDespawn: (entity) => {
      if (s.isHost) trackDespawn(s, entity);
    },
  };
}

/** @param {any} s */
function listen(s) {
  s.transport.onMessage((from, bytes) => s.inbox.push({ from, bytes }));
  if (s.transport.onPeerLeave) s.transport.onPeerLeave((peerId) => leave(s, peerId));
}

/** @param {any} s @param {string} peerId */
function leave(s, peerId) {
  if (!s.isHost && peerId === s.hostPeerId) {
    s.ended = true;
    s.reason = "host_left";
    return;
  }
  const peer = s.peers.get(peerId);
  if (!peer) return;
  s.peers.delete(peerId);
  s.players = s.players.filter((player) => player.id !== peer.playerId);
  announce(s);
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
    digest() {
      return digest(s);
    },
  };
}

/** @param {any} s */
function step(s) {
  if (s.ended) return;
  if (s.isHost) stepHost(s);
  else stepClient(s);
}

/** @param {any} s */
function stepHost(s) {
  drain(s);
  rememberLocal(s);
  const prev = noteAnims(s);
  s.inUpdate = true;
  try {
    s.game.update(1 / s.manifest.tickHz, inputsFor(s), s.world, s.net);
  } finally {
    s.inUpdate = false;
  }
  stampAnims(s, prev);
  for (const peer of s.peers.values()) sendPeer(s, peer);
  pruneInputs(s);
  s.shownTick = s.tick;
  s.tick += 1;
}

/** @param {any} s @param {any} peer */
function sendPeer(s, peer) {
  flushReliable(s, peer);
  if (peer.live) sendState(s, peer);
}

/** @param {any} s */
function stepClient(s) {
  s.steps += 1;
  drain(s);
  if (s.pendingLocal) {
    pushHist(s, s.est(), s.pendingLocal);
    s.pendingLocal = null;
  }
  if (s.joined && !s.ended) sendClient(s);
}

/** @param {any} s */
function close(s) {
  if (s.isHost && !s.ended) sendBye(s);
  s.ended = true;
  if (!s.reason) s.reason = "close";
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
