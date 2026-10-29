/** Host send path: reliable spawn/snapshot and unreliable prioritized deltas. */

import { ackHeader, nextSeq, rememberSent } from "./ack.js";
import { avatarFocus, relevance } from "./focus.js";
import { packBudget, takeBatches } from "./pack.js";
import { createPeer } from "./peer.js";
import { cloneState, defaultState, encodePacket, quantize, sameState } from "./wire.js";

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
    peer.queue.push({ type: "spawn", record: spawnRecord(s, entity, cur) });
  }
}

/** @param {any} s @param {any} entity */
export function trackDespawn(s, entity) {
  for (const peer of s.peers.values()) {
    if (!peer.live) continue;
    peer.queue.push({ type: "despawn", id: entity.id });
    clearPeerEntity(peer, entity.id);
  }
}

/** @param {any} peer @param {number} id */
function clearPeerEntity(peer, id) {
  peer.confirmed.delete(id);
  peer.ver.delete(id);
  peer.acc.delete(id);
  peer.dirtyAt.delete(id);
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

/** @param {any} s @param {string} from @param {number} playerId */
export function acceptPeer(s, from, playerId) {
  const peer = createPeer(from, playerId);
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
  if (split.overflow) throw new Error("entity exceeds byte budget");
  return split.batches.map((group, index) => ({
    type: "snap",
    index,
    count: split.batches.length,
    total: records.length,
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
  const pending = peer.queue;
  if (!pending.length) return;
  peer.queue = [];
  const fit = (group) => encodePacket(head(s, 1), group).length <= s.manifest.budget;
  const split = takeBatches(pending, fit);
  if (split.overflow) throw new Error("reliable message exceeds byte budget");
  for (const batch of split.batches) sendReliable(s, peer, batch);
}

/** @param {any} s @param {any} peer @param {any[]} batch */
function sendReliable(s, peer, batch) {
  const bytes = encodePacket({ ...head(s, 1), ...ackHeader(peer) }, batch);
  emit(s, peer.peerId, bytes, { reliable: true });
}

/** @param {any} s @param {any} peer */
export function sendState(s, peer) {
  const packets = packBudget(candidates(s, peer), s.manifest.starvationK, (group) =>
    fitsState(s, group),
  );
  for (const group of packets) sendGroup(s, peer, group);
}

/** @param {any} s @param {any} peer */
function candidates(s, peer) {
  const list = [];
  for (const entity of s.world.query()) {
    const item = consider(s, peer, entity);
    if (item) list.push(item);
  }
  list.sort((a, b) => b.pri - a.pri || a.id - b.id);
  return list;
}

/** @param {any} s @param {any} peer @param {any} entity */
function consider(s, peer, entity) {
  if (entity.local) return null;
  const cur = quantize(entity, s.manifest.quant);
  const conf = peer.confirmed.get(entity.id);
  if (!conf) return null;
  if (sameState(cur, conf.q)) {
    peer.dirtyAt.delete(entity.id);
    return null;
  }
  return dirtyItem(s, peer, { entity, cur, conf });
}

/** @param {any} s @param {any} peer @param {{ entity: any, cur: any, conf: any }} bag */
function dirtyItem(s, peer, bag) {
  const entity = bag.entity;
  if (!peer.dirtyAt.has(entity.id)) peer.dirtyAt.set(entity.id, s.tick);
  const age = s.tick - peer.dirtyAt.get(entity.id);
  const acc = bump(s, peer, entity);
  const pri = age >= s.manifest.starvationK ? 1e12 + age : acc;
  return { id: entity.id, cur: bag.cur, base: bag.conf.q, baseVersion: bag.conf.version, age, pri };
}

/** @param {any} s @param {any} peer @param {any} entity */
function bump(s, peer, entity) {
  const rel = relevance(s.manifest.focus, entity, focusFor(s, peer.playerId), s.manifest.cell);
  const base = priorityOf(s, entity.type);
  const acc = (peer.acc.get(entity.id) || 0) + base * rel * (1 / s.manifest.tickHz);
  peer.acc.set(entity.id, acc);
  return acc;
}

/** @param {any} s @param {number} playerId */
function focusFor(s, playerId) {
  if (s.manifest.focus === "none") return null;
  if (s.manifest.focus === "game") return s.focus.get(playerId) || { x: 0, y: 0 };
  return avatarFocus(findAvatar(s, playerId), s.hints.get(playerId), s.manifest.focusClamp);
}

/** @param {any} s @param {number} playerId */
function findAvatar(s, playerId) {
  const key = s.manifest.avatarOwnerKey;
  for (const entity of s.world.query(s.manifest.avatarType)) {
    if (entity.custom && entity.custom[key] === playerId) return entity;
  }
  return null;
}

/** @param {any} s @param {string} type */
function priorityOf(s, type) {
  const spec = s.manifest.types[type];
  const pri = spec && spec.priority;
  return typeof pri === "number" && pri > 0 ? pri : 1;
}

/** @param {any} s @param {any[]} group */
function fitsState(s, group) {
  if (!group.length) return true;
  return (
    encodePacket(head(s, 0), [{ type: "state", records: group.map(preview) }]).length <=
    s.manifest.budget
  );
}

/** @param {any} item */
function preview(item) {
  return { id: item.id, version: 1, baseVersion: item.baseVersion, cur: item.cur, base: item.base };
}

/** @param {any} s @param {any} peer @param {any[]} group */
function sendGroup(s, peer, group) {
  const records = group.map((item) => commit(s, peer, item));
  const seq = nextSeq(peer);
  const ids = records.map((rec) => rec.id);
  const bytes = encodePacket({ ...head(s, 0), seq, ...ackHeader(peer) }, [
    { type: "state", records },
  ]);
  emit(s, peer.peerId, bytes, { ids });
  rememberSent(
    peer,
    seq,
    records.map((rec) => ({ id: rec.id, version: rec.version, full: cloneState(rec.cur) })),
  );
}

/** @param {any} s @param {any} peer @param {any} item */
function commit(s, peer, item) {
  const version = (peer.ver.get(item.id) || 0) + 1;
  peer.ver.set(item.id, version);
  peer.acc.set(item.id, 0);
  peer.dirtyAt.set(item.id, s.tick);
  return { id: item.id, version, baseVersion: item.baseVersion, cur: item.cur, base: item.base };
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
