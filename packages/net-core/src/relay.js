/** Host send path: reliable spawn/snapshot and unreliable prioritized deltas. */

import { ackHeader, nextSeq, rememberSent } from "./ack.js";
import { takeBatches } from "./pack.js";
import { createPeer } from "./peer.js";
import { MAX_MESSAGES, cloneState, defaultState, encodePacket, quantize } from "./wire.js";

/** @param {any} s @param {string} to @param {Uint8Array} bytes @param {{ reliable?: boolean, ids?: number[] }} [opts] */
export function emit(s, to, bytes, opts) {
  const reliable = !!(opts && opts.reliable);
  const ids = (opts && opts.ids) || [];
  if (bytes.length > s.manifest.budget) throw new Error("packet exceeds byte budget");
  s.transport.send(to, bytes, reliable);
  s.stats.packets += 1;
  s.stats.bytes += bytes.length;
  if (bytes.length > s.stats.maxPacket) s.stats.maxPacket = bytes.length;
  if (s.trace) s.stats.sends.push({ to, bytes: bytes.length, reliable, tick: s.tick, ids });
}

/** @param {any} s @param {number} flags */
function head(s, flags) {
  return { tick: s.isHost ? s.tick : s.est(), flags, seq: 0, ack: 0, ackBits: 0 };
}

/** @param {any} s @param {any} entity */
export function trackSpawn(s, entity) {
  const cur = cloneState(quantize(entity, s.manifest.quant));
  for (const peer of s.peers.values()) {
    if (!peer.live) continue;
    peer.confirmed.set(entity.id, { version: 0, q: cloneState(cur) });
    peer.ver.set(entity.id, 0);
    peer.pendingSpawns.set(entity.id, spawnRecord(s, entity, cur));
  }
}

/** @param {any} s @param {any} entity */
export function trackDespawn(s, entity) {
  let waiting = false;
  for (const peer of s.peers.values()) {
    if (!peer.live) continue;
    if (dropQueuedSpawn(peer, entity.id)) {
      clearPeerEntity(s, peer, entity.id);
      continue;
    }
    peer.queue.push({ type: "despawn", id: entity.id });
    clearPeerEntity(s, peer, entity.id);
    let grave = s.grave.get(entity.id);
    if (!grave) s.grave.set(entity.id, (grave = new Set()));
    grave.add(peer.peerId);
    waiting = true;
  }
  if (!waiting) s.unsentFree.push(entity.id);
}

/** @param {any} peer @param {number} id */
function dropQueuedSpawn(peer, id) {
  if (!peer.pendingSpawns || !peer.pendingSpawns.has(id)) return false;
  peer.pendingSpawns.delete(id);
  return true;
}

/** @param {any} peer */
function flushSpawns(peer) {
  if (!peer.pendingSpawns || !peer.pendingSpawns.size) return;
  for (const record of peer.pendingSpawns.values()) peer.queue.push({ type: "spawn", record });
  peer.pendingSpawns.clear();
}

/** @param {any} s @param {any} peer @param {number} id */
function clearPeerEntity(s, peer, id) {
  peer.confirmed.delete(id);
  peer.ver.delete(id);
  peer.acc.delete(id);
  peer.dirtyAt.delete(id);
  if (s.slots) s.slots.delete(id);
}

/** @param {any} s @param {any} entity @param {any} cur */
function spawnRecord(s, entity, cur) {
  return {
    id: entity.id,
    type: entity.type,
    version: 0,
    baseVersion: 0,
    cur,
    base: defaultState(s.manifest.quant),
  };
}

/** @param {any} s @param {string} peerId @param {number[]} ids */
function releaseAcked(s, peerId, ids) {
  for (const id of ids) {
    const wait = s.grave.get(id);
    if (!wait) continue;
    wait.delete(peerId);
    if (wait.size) continue;
    s.grave.delete(id);
    s.freeIds.push(id);
  }
}

/** @param {any} s @param {string} from @param {number} playerId */
export function acceptPeer(s, from, playerId) {
  const peer = createPeer(from, playerId);
  peer.noteFree = (ids) => releaseAcked(s, from, ids);
  peer.epoch = s.nextEpoch += 1;
  s.epochs.set(playerId, peer.epoch);
  s.peers.set(from, peer);
  s.players.push({ id: playerId, host: false });
  const records = baseline(s, peer);
  peer.queue.push(welcomeMessage(s, playerId));
  for (const snap of snapMessages(s, records)) peer.queue.push(snap);
  peer.live = true;
  for (const other of s.peers.values()) {
    if (other !== peer && other.live) other.queue.push(welcomeMessage(s, other.playerId));
  }
  return peer;
}

/** @param {any} s @param {any} peer */
function baseline(s, peer) {
  const records = [];
  for (const entity of s.world.query()) {
    if (entity.local) continue;
    const cur = cloneState(quantize(entity, s.manifest.quant));
    peer.confirmed.set(entity.id, { version: 0, q: cloneState(cur) });
    peer.ver.set(entity.id, 0);
    records.push(spawnRecord(s, entity, cur));
  }
  return records;
}

/** @param {any} s @param {number} playerId */
function welcomeMessage(s, playerId) {
  return {
    type: "welcome",
    you: playerId,
    seed: s.seed >>> 0,
    hostId: s.playerId,
    players: s.players.map((player) => player.id),
  };
}

/** @param {any} s @param {any[]} records */
function snapMessages(s, records) {
  if (!records.length) return [{ type: "snap", index: 0, count: 1, total: 0, records: [] }];
  const fit = (group) => snapSize(s, group, records.length) <= s.manifest.budget;
  const split = takeBatches(records, fit);
  if (split.overflow.length) s.stats.reliableDrops += split.overflow.length;
  const batches = split.batches.length ? split.batches : [[]];
  const included = batches.reduce((sum, group) => sum + group.length, 0);
  return batches.map((group, index) => ({
    type: "snap",
    index,
    count: batches.length,
    total: included,
    records: group,
  }));
}

/** @param {any} s @param {any[]} group @param {number} total */
function snapSize(s, group, total) {
  const message = { type: "snap", index: 0, count: 1, total, records: group };
  return encodePacket(head(s, 1), [message]).length;
}

/** @param {any} s @param {any} peer */
export function flushReliable(s, peer) {
  flushSpawns(peer);
  if (!peer.queue.length) return;
  const pending = peer.queue.splice(0);
  let batch = [];
  for (const message of pending) batch = pushReliable(s, peer, batch, message);
  if (batch.length) sendReliable(s, peer, batch);
}

/** @param {any} s @param {any} peer @param {any[]} batch @param {any} message */
function pushReliable(s, peer, batch, message) {
  if (!fitsReliable(s, [message])) {
    s.stats.reliableDrops += 1;
    if (s.dropPeer) s.dropPeer(peer.peerId);
    return batch;
  }
  if (batch.length && !fitsReliable(s, batch.concat([message]))) {
    sendReliable(s, peer, batch);
    return [message];
  }
  const next = batch.concat([message]);
  if (next.length >= MAX_MESSAGES) {
    sendReliable(s, peer, next);
    return [];
  }
  return next;
}

/** @param {any} s @param {any[]} group */
function fitsReliable(s, group) {
  if (!group.length || group.length > MAX_MESSAGES) return false;
  try {
    return encodePacket(head(s, 1), group).length <= s.manifest.budget;
  } catch (e) {
    return false;
  }
}

/** @param {any} s @param {any} peer @param {any[]} batch */
function sendReliable(s, peer, batch) {
  const seq = nextSeq(peer);
  const free = [];
  for (const message of batch) if (message.type === "despawn") free.push(message.id);
  rememberSent(peer, seq, [], free);
  const bytes = encodePacket({ ...head(s, 1), seq, ...ackHeader(peer) }, batch);
  emit(s, peer.peerId, bytes, { reliable: true });
}

/** @param {any} s */
export function sendHello(s) {
  const message = { type: "hello", playerId: s.playerId, proto: s.proto, hash: s.manifest.hash };
  emit(s, s.hostPeerId, encodePacket({ ...head(s, 1), ...ackHeader(s.link) }, [message]), {
    reliable: true,
  });
}

/** @param {any} s @param {any} message */
export function sendDirect(s, message) {
  emit(s, s.hostPeerId, encodePacket({ ...head(s, 1), ...ackHeader(s.link) }, [message]), {
    reliable: true,
  });
}

/** @param {any} s */
export function sendClient(s) {
  const messages = /** @type {any[]} */ ([{ type: "input", samples: s.inputHist.slice() }]);
  if (s.hint) messages.push({ type: "hint", x: s.hint.x, y: s.hint.y });
  const seq = nextSeq(s.link);
  emit(s, s.hostPeerId, encodePacket({ ...head(s, 0), seq, ...ackHeader(s.link) }, messages), {
    reliable: false,
  });
}

/** @param {any} s @param {string} to @param {number} code */
export function rejectPeer(s, to, code) {
  emit(s, to, encodePacket(head(s, 1), [{ type: "reject", code }]), { reliable: true });
}

/** @param {any} s */
export function announce(s) {
  for (const peer of s.peers.values()) {
    if (peer.live) peer.queue.push(welcomeMessage(s, peer.playerId));
  }
}

/** @param {any} s */
export function sendBye(s) {
  for (const peer of s.peers.values()) peer.queue.push({ type: "bye" });
  for (const peer of s.peers.values()) flushReliable(s, peer);
}
