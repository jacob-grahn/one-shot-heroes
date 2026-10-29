/** Reliable one-shot events. The host relays them in order; late joiners do not get a replay. */

import { checkRecord, plainClone } from "./wire.js";

/** @param {any} s @param {string} name @param {any} fn */
export function onEvent(s, name, fn) {
  const list = s.listeners.get(name) || [];
  list.push(fn);
  s.listeners.set(name, list);
}

/** @param {any} s @param {string} name @param {any} payload */
export function emitEvent(s, name, payload) {
  const fields = fieldsOf(s, name);
  if (!fields || !checkRecord(fields, payload, false)) throw new Error("bad event " + name);
  const message = { type: "event", id: (s.eventSeq += 1), origin: s.playerId, name, payload };
  deliverEvent(s, message);
  if (s.isHost) queueEvent(s, message, "");
  else s.sendDirect(message);
}

/** @param {any} s @param {any} message @param {string} [skip] */
export function queueEvent(s, message, skip) {
  for (const peer of s.peers.values()) {
    if (peer.live && peer.peerId !== skip) peer.queue.push(message);
  }
}

/** @param {any} s @param {any} message */
export function deliverEvent(s, message) {
  const key = message.origin + ":" + message.id;
  if (s.seen.has(key)) return;
  s.seen.add(key);
  const list = s.listeners.get(message.name) || [];
  const payload = plainClone(message.payload);
  for (const fn of list) fn(payload);
}

/** @param {any} s @param {string} name */
function fieldsOf(s, name) {
  const found = s.manifest.events.find((event) => event.name === name);
  return found ? found.fields : null;
}
