/** Demux decoded packets into the session. */

import { confirmSent, noteRecv } from "./ack.js";
import { applyUpdate, beginSnap, dropEntity, installRecord } from "./apply.js";
import { acceptPeerEvent, applyCursors, deliverEvent, queueEvent } from "./events.js";
import { rememberRemote } from "./input.js";
import { mulberry32 } from "./rng.js";
import { acceptPeer, refreshWelcome, rejectPeer } from "./relay.js";
import { PROTOCOL, isFrozenRefusal } from "./wire.js";

/** @param {any} s */
export function drain(s) {
  const batch = s.inbox.splice(0);
  for (const item of batch) dispatch(s, item);
}

/** @param {any} s @param {{ from: string, bytes: Uint8Array }} item */
function dispatch(s, item) {
  const packet = s.decode(item.bytes);
  if (!packet.ok) {
    if (packet.error === "version" || isFrozenRefusal(item.bytes)) rejectVersion(s, item.from);
    return;
  }
  route(s, item, packet);
}

/** @param {any} s @param {{ from: string, bytes: Uint8Array }} item @param {any} packet */
function route(s, item, packet) {
  if (!fromPeer(s, item.from)) {
    const hello = packet.messages.filter((message) => message.type === "hello");
    if (!hello.length) return;
    packet.messages = hello;
  }
  const peer = s.isHost ? s.peers.get(item.from) : s.link;
  if (s.isHost && s.peers.has(item.from)) heard(s, item.from);
  if (peer) confirmSent(peer, packet.ack, packet.ackBits, s.tick);
  if (!s.isHost) noteTick(s, packet.tick);
  const ready = stateReady(s, packet);
  for (const message of packet.messages) handle(s, message, item.from, packet.tick);
  if (peer && ready) noteRecv(peer, packet.seq);
}

/** A state delta whose baseline is missing must not be acked, or the host stops resending it. */
function stateReady(s, packet) {
  for (const message of packet.messages) {
    if (message.type !== "state") continue;
    for (const rec of message.records) if (!recordReady(s, rec)) return false;
  }
  return true;
}

/** @param {any} s @param {any} rec */
function recordReady(s, rec) {
  if (s.tomb.has(rec.id)) return true;
  const versions = s.versions.get(rec.id);
  if (!versions) return true;
  if (versions.has(rec.baseVersion)) return true;
  return (s.shown.get(rec.id) ?? -1) >= rec.version;
}

/** Host takes hello from strangers. Clients take traffic only from the host. */
function fromPeer(s, from) {
  if (s.isHost) return s.peers.has(from);
  return from === s.hostPeerId;
}

/** @param {any} s @param {number} tick */
function noteTick(s, tick) {
  if (tick < s.lastHostTick) return;
  s.lastHostTick = tick;
  s.lastHostAt = s.steps;
}

/** @param {any} s @param {any} message @param {string} from @param {number} tick */
function handle(s, message, from, tick) {
  const fn = HANDLERS[message.type];
  if (fn) fn(s, message, from, tick);
}

const HANDLERS = {
  hello: onHello,
  welcome: onWelcome,
  reject: onReject,
  spawn: onSpawn,
  despawn: onDespawn,
  event: onEvent,
  snap: onSnap,
  bye: onBye,
  state: onState,
  input: onInput,
  hint: onHint,
};

/** @param {any} s @param {any} message @param {string} from */
function onHello(s, message, from) {
  if (!s.isHost || s.ended) return;
  const peer = s.peers.get(from);
  if (peer && peer.live && peer.playerId === message.playerId) return refreshWelcome(s, peer);
  if (peer && s.releasePeer) s.releasePeer(from);
  if (message.proto !== PROTOCOL) return rejectJoin(s, from, 1);
  if (message.hash !== s.manifest.hash) return rejectJoin(s, from, 2);
  if (s.players.some((player) => player.id === message.playerId)) return rejectJoin(s, from, 3);
  if (s.players.length >= s.manifest.maxPlayers) return rejectJoin(s, from, 5);
  acceptPeer(s, from, message.playerId);
}

/** @param {any} s @param {any} message */
function onWelcome(s, message) {
  if (s.isHost) return;
  if (!s.haveSeed) {
    s.seed = message.seed;
    s.rng = mulberry32(message.seed);
    s.haveSeed = true;
  }
  s.players = message.players.map((id) => ({ id, host: id === message.hostId }));
  s.welcomeCursors = message.cursors || [];
  applyCursors(s, s.welcomeCursors);
}

/** @param {any} s @param {any} message @param {string} from */
function onReject(s, message, from) {
  if (s.isHost || from !== s.hostPeerId) return;
  s.ended = true;
  s.reason = reasonOf(message.code);
  if (s.fireEnd) s.fireEnd();
}

/** @param {number} code */
function reasonOf(code) {
  if (code === 1) return "version";
  if (code === 2) return "hash";
  if (code === 3) return "seat";
  if (code === 4) return "dropped";
  if (code === 5) return "full";
  return "reject";
}

/** @param {any} s @param {string} from @param {number} code */
function rejectJoin(s, from, code) {
  rejectPeer(s, from, code);
}

/** A packet from another build cannot be applied. End that side instead of ignoring it. */
function rejectVersion(s, from) {
  if (!s.isHost) {
    if (from !== s.hostPeerId) return;
    s.ended = true;
    s.reason = "version";
    if (s.fireEnd) s.fireEnd();
    return;
  }
  if (s.peers.has(from) && s.dropFor) s.dropFor(from, "version");
  else rejectJoin(s, from, 1);
}

/** @param {any} s @param {any} message @param {string} _from @param {number} tick */
function onSpawn(s, message, _from, tick) {
  if (!s.isHost) installRecord(s, message.record, tick);
}

/** @param {any} s @param {any} message */
function onDespawn(s, message) {
  if (!s.isHost) dropEntity(s, message.id);
}

/** @param {any} s @param {any} message @param {string} from */
function onEvent(s, message, from) {
  if (!s.isHost) return deliverEvent(s, message);
  const peer = s.peers.get(from);
  if (!peer || !peer.live) return;
  const relayed = acceptPeerEvent(s, message, peer.playerId);
  if (relayed) queueEvent(s, relayed, from);
}

/** @param {any} s @param {any} message @param {string} _from @param {number} tick */
function onSnap(s, message, _from, tick) {
  if (s.isHost) return;
  if (message.index === 0) {
    beginSnap(s);
    s.snapGot = new Set();
    s.snapCount = message.count;
    if (s.welcomeCursors) applyCursors(s, s.welcomeCursors);
  }
  if (!s.snapGot) s.snapGot = new Set();
  s.snapGot.add(message.index);
  for (const rec of message.records) installRecord(s, rec, tick);
  const count = message.count || s.snapCount || 0;
  if (s.snapGot.size === count && count > 0 && !s.joined) {
    s.joined = true;
    if (s.fireJoin) s.fireJoin({ playerId: s.playerId });
  }
}

/** @param {any} s @param {any} _message @param {string} from */
function onBye(s, _message, from) {
  if (s.isHost) {
    if (s.peers.has(from) && s.dropPeer) s.dropPeer(from);
    return;
  }
  if (from !== s.hostPeerId) return;
  s.ended = true;
  s.reason = "host_left";
  if (s.fireEnd) s.fireEnd();
}

/** @param {any} s @param {string} from */
function heard(s, from) {
  const peer = s.peers.get(from);
  if (!peer) return;
  peer.lastHeard = s.tick;
  peer.heardAt = s.now();
  peer.heardTick = s.silenceTick || 0;
}

/** @param {any} s @param {any} message @param {string} _from @param {number} tick */
function onState(s, message, _from, tick) {
  if (s.isHost) return;
  for (const rec of message.records) applyUpdate(s, rec, tick);
}

/** @param {any} s @param {any} message @param {string} from */
function onInput(s, message, from) {
  const peer = s.isHost ? s.peers.get(from) : null;
  if (!peer) return;
  for (const sample of message.samples) rememberRemote(s, peer.playerId, sample);
}

/** @param {any} s @param {any} message @param {string} from */
function onHint(s, message, from) {
  if (!Number.isFinite(message.x) || !Number.isFinite(message.y)) return;
  const peer = s.peers.get(from);
  if (peer) s.hints.set(peer.playerId, { x: message.x, y: message.y });
}
