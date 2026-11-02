/** Reliable one-shot events. Peer relays are opt-in and deduped with a sliding window. */

import { checkRecord, encodePacket, isUserText } from "./wire.js";

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
  if (!spec || !checkRecord(spec.fields, payload, false)) throw new Error("bad event " + name);
  const message = { type: "event", id: (s.eventSeq += 1), origin: s.playerId, name, payload };
  deliverEvent(s, message);
  if (s.isHost) queueEvent(s, message, "");
  else s.sendDirect(message);
}

/**
 * Host path for an event from a joined peer. Origin is the sender, not the packet field.
 * @param {any} s @param {any} message @param {number} playerId
 */
export function acceptPeerEvent(s, message, playerId) {
  const spec = specOf(s, message.name);
  if (!spec || !checkRecord(spec.fields, message.payload, false)) return null;
  const clean = {
    type: "event",
    id: message.id >>> 0,
    origin: playerId,
    name: message.name,
    payload: message.payload,
  };
  if (eventBytes(clean) > s.manifest.budget) return null;
  if (!deliverEvent(s, clean)) return null;
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
  if (!admit(s, message.origin >>> 0, message.id >>> 0)) return false;
  const list = s.listeners.get(message.name) || [];
  const payload = copyPayload(message.payload);
  for (const fn of list) fn(payload);
  return true;
}

/** @param {any} s @param {number} origin @param {number} id */
function admit(s, origin, id) {
  if (!id) return false;
  let slot = s.seen.get(origin);
  if (!slot) {
    slot = { next: 1, have: new Set() };
    s.seen.set(origin, slot);
  }
  if (id < slot.next || id >= slot.next + WINDOW) return false;
  if (slot.have.has(id)) return false;
  slot.have.add(id);
  while (slot.have.has(slot.next)) {
    slot.have.delete(slot.next);
    slot.next += 1;
  }
  return true;
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
