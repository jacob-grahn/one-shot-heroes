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
  s.acceptedTick = -1;
  grantQueued(s);
  const batch = s.inbox.splice(0);
  for (const item of batch) dispatch(s, item);
}

/** One queued hello per tick. It is checked again, so a bye can drop it first. */
function grantQueued(s) {
  if (!s.isHost || !s.pendingHellos || !s.pendingHellos.size) return;
  const next = s.pendingHellos.entries().next().value;
  s.pendingHellos.delete(next[0]);
  onHello(s, next[1], next[0]);
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
  if (message.type === "bye" && s.pendingHellos) s.pendingHellos.delete(from);
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
  if (skipHello(s, peer, message, from)) return;
  const code = helloCode(s, message, peer);
  if (code) return rejectJoin(s, from, code);
  if (s.acceptedTick === 0) return holdHello(s, from, message);
  if (!grantAccept(s, from, peer)) return;
  s.acceptedTick = 0;
  if (peer && s.releasePeer) s.releasePeer(from);
  acceptPeer(s, from, message.playerId, message.nonce || 0);
}

/** @param {any} s @param {any} peer @param {any} message @param {string} from */
function skipHello(s, peer, message, from) {
  if (sameSeat(s, peer, message)) {
    refreshWelcome(s, peer);
    return true;
  }
  if (otherSeat(peer, message)) {
    rejectJoin(s, from, 3);
    return true;
  }
  if (acceptedRecently(s, from)) return true;
  return fastNonce(s, from, peer, message);
}

/** Keep a valid hello for a later tick. The queue holds at most one per player cap. */
function holdHello(s, from, message) {
  if (!s.pendingHellos) s.pendingHellos = new Map();
  if (s.pendingHellos.has(from) || s.pendingHellos.size < s.manifest.maxPlayers)
    s.pendingHellos.set(from, message);
}

/** True when this peer id was granted a seat less than a second ago. */
function acceptedRecently(s, from) {
  const at = s.acceptAt && s.acceptAt.get(from);
  return at != null && s.now() - at < 1000;
}

/** Spend a room token only once version, hash, and the seat have already passed. */
function grantAccept(s, from, peer) {
  const now = s.now();
  const settled = peer && peer.live && now - (peer.joinedAt || 0) >= 10000;
  if (!takeAcceptToken(s, now) && !settled) return false;
  if (!s.acceptAt) s.acceptAt = new Map();
  pruneStamps(s.acceptAt, now);
  pruneStamps(s.rejoinAt, now);
  s.acceptAt.set(from, now);
  return true;
}

/** Burst of maxPlayers, then two full accepts per second for the whole room. */
function takeAcceptToken(s, now) {
  const cap = s.manifest.maxPlayers;
  const bucket = s.acceptBucket || (s.acceptBucket = { tokens: cap, at: now });
  const gained = ((now - bucket.at) / 1000) * 2;
  bucket.tokens = Math.min(cap, bucket.tokens + gained);
  bucket.at = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

/** @param {Map<string, number> | undefined} map @param {number} now */
function pruneStamps(map, now) {
  if (!map || map.size <= 256) return;
  for (const [id, t] of map) if (now - t >= 10000) map.delete(id);
}

/** @param {any} s @param {any} message @param {any} peer */
function helloCode(s, message, peer) {
  if (message.proto !== PROTOCOL) return 1;
  if (message.hash !== s.manifest.hash) return 2;
  const own = peer && peer.live && peer.playerId === message.playerId ? 1 : 0;
  if (!own && s.players.some((player) => player.id === message.playerId)) return 3;
  if (s.players.length - own >= s.manifest.maxPlayers) return 5;
  return 0;
}

/** A hello from the session we just accepted only needs the welcome repeated. */
function sameSeat(s, peer, message) {
  if (!peer || !peer.live || peer.playerId !== message.playerId) return false;
  const nonce = message.nonce || 0;
  if (nonce && peer.nonce && nonce !== peer.nonce) return false;
  return s.now() - (peer.joinedAt || 0) < 1000;
}

/** @param {any} peer @param {any} message */
function otherSeat(peer, message) {
  return !!(peer && peer.live && peer.playerId !== message.playerId);
}

/** A second new session for this peer id inside one second is ignored. */
function fastNonce(s, from, peer, message) {
  if (!peer || !peer.live) return false;
  const nonce = message.nonce || 0;
  if (!nonce || !peer.nonce || nonce === peer.nonce) return false;
  const at = s.rejoinAt && s.rejoinAt.get(from);
  if (at == null || s.now() - at >= 1000) {
    if (!s.rejoinAt) s.rejoinAt = new Map();
    pruneStamps(s.rejoinAt, s.now());
    s.rejoinAt.set(from, s.now());
    return false;
  }
  return true;
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
