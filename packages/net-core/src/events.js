/** Reliable one-shot events. Peer relays are opt-in and deduped with a sliding window. */

import { encodePacket, fieldIssue, isUserText } from "./wire.js";

const WINDOW = 64;

/** @param {any} s @param {string} name @param {any} fn */
export function onEvent(s, name, fn) {
  const list = s.listeners.get(name) || [];
  list.push(fn);
  s.listeners.set(name, list);
}

/** @param {any} s @param {string} name @param {any} payload */
export function emitEvent(s, name, payload) {
  const spec = specOf(s, name);
  const issue = !spec ? "name" : fieldIssue(spec.fields, payload);
  if (issue) throw new Error("bad event " + name + " field " + issue);
  const message = {
    type: "event",
    id: (s.eventSeq += 1),
    origin: s.playerId,
    epoch: 0,
    name,
    payload,
  };
  deliverEvent(s, message);
  noteCursor(s, s.playerId, message.id, 0);
  if (s.isHost) queueEvent(s, message, "");
  else s.sendDirect(message);
}

/**
 * Host path for an event from a joined peer. Origin is the sender, not the packet field.
 * @param {any} s @param {any} message @param {number} playerId
 */
export function acceptPeerEvent(s, message, playerId) {
  const spec = specOf(s, message.name);
  const issue = !spec ? "name" : fieldIssue(spec.fields, message.payload);
  if (issue) {
    warnIssue(s, "event " + message.name + " field " + issue);
    return null;
  }
  const clean = {
    type: "event",
    id: message.id >>> 0,
    origin: playerId,
    epoch: (s.epochs.get(playerId) || 0) >>> 0,
    name: message.name,
    payload: message.payload,
  };
  if (eventBytes(clean) > s.manifest.budget) return null;
  if (!deliverEvent(s, clean)) return null;
  noteCursor(s, playerId, clean.id, clean.epoch);
  return spec.relay ? clean : null;
}

/** @param {any} s @param {any} message @param {string} [skip] */
export function queueEvent(s, message, skip) {
  for (const peer of s.peers.values()) {
    if (peer.live && peer.peerId !== skip) peer.queue.push(message);
  }
}

/** @param {any} s @param {any} message */
export function deliverEvent(s, message) {
  if (!admit(s, message.origin >>> 0, message.epoch >>> 0, message.id >>> 0)) return false;
  const list = s.listeners.get(message.name) || [];
  const payload = copyPayload(message.payload);
  for (const fn of list) fn(payload);
  return true;
}

/** @param {any} s @param {number} origin @param {number} epoch @param {number} id */
function admit(s, origin, epoch, id) {
  if (!id) return false;
  const slot = slotFor(s, origin, epoch, id);
  if (!s.isHost && id >= slot.next + WINDOW) slide(slot, id + 1 - WINDOW);
  if (id < slot.next || id >= slot.next + WINDOW || slot.have.has(id)) return false;
  slot.have.add(id);
  while (slot.have.has(slot.next)) {
    slot.have.delete(slot.next);
    slot.next += 1;
  }
  return true;
}

/** @param {any} s @param {number} origin @param {number} epoch @param {number} id */
function slotFor(s, origin, epoch, id) {
  let slot = s.seen.get(origin);
  if (slot && slot.epoch === epoch) return slot;
  const seeded = cursorNext(s, origin, epoch);
  slot = { epoch, next: seeded || id, have: new Set() };
  s.seen.set(origin, slot);
  return slot;
}

/** @param {any} s @param {number} origin @param {number} epoch */
function cursorNext(s, origin, epoch) {
  const cursor = s.cursors && s.cursors.get(origin);
  if (!cursor || cursor.epoch !== epoch) return 0;
  return cursor.next >>> 0;
}

/** @param {{ next: number, have: Set<number> }} slot @param {number} floor */
function slide(slot, floor) {
  const next = floor > 0 ? floor : 1;
  for (const old of slot.have) if (old < next) slot.have.delete(old);
  if (next > slot.next) slot.next = next;
}

/** @param {any} s @param {{ origin: number, epoch: number, next: number }[]} cursors */
export function applyCursors(s, cursors) {
  if (!s.cursors) s.cursors = new Map();
  for (const cursor of cursors || []) {
    const epoch = cursor.epoch >>> 0;
    const next = cursor.next >>> 0;
    s.cursors.set(cursor.origin, { epoch, next });
    s.seen.set(cursor.origin, { epoch, next, have: new Set() });
  }
}

/** @param {any} s */
export function cursorList(s) {
  const list = [];
  if (s.cursors) {
    for (const [origin, cursor] of s.cursors) list.push({ origin, epoch: cursor.epoch, next: cursor.next });
  }
  if (!s.cursors || !s.cursors.has(s.playerId))
    list.push({ origin: s.playerId, epoch: 0, next: (s.eventSeq || 0) + 1 });
  return list;
}

/** @param {any} s @param {number} origin @param {number} id @param {number} epoch */
export function noteCursor(s, origin, id, epoch) {
  if (!s.cursors) s.cursors = new Map();
  const next = (id >>> 0) + 1;
  const prev = s.cursors.get(origin);
  if (!prev || prev.epoch !== (epoch >>> 0) || next > prev.next)
    s.cursors.set(origin, { epoch: epoch >>> 0, next });
}

/** @param {any} s @param {string} message */
function warnIssue(s, message) {
  const warn = s.game && s.game.warn;
  if (s.dev && typeof warn === "function") warn(message);
}

/** @param {any} message */
function eventBytes(message) {
  try {
    return encodePacket({ tick: 0 }, [message]).length;
  } catch (e) {
    return Infinity;
  }
}

/** @param {any} s @param {string} name */
function specOf(s, name) {
  return s.manifest.events.find((event) => event.name === name) || null;
}

/** @param {unknown} value */
function copyPayload(value) {
  if (isUserText(value))
    return { text: /** @type {{ text: string }} */ (value).text, userContent: true };
  if (Array.isArray(value)) return value.map(copyPayload);
  if (value && typeof value === "object")
    return copyObj(/** @type {Record<string, unknown>} */ (value));
  return value;
}

/** @param {Record<string, unknown>} value */
function copyObj(value) {
  const out = Object.create(null);
  for (const key of Object.keys(value)) out[key] = copyPayload(value[key]);
  return out;
}
