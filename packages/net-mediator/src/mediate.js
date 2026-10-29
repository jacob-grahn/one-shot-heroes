/** Host-page gate in front of a transport. The in-game library must not import this. */

import { decodePacket } from "@osh/net-wire";
import { CAPS } from "./caps.js";
import { walk } from "./walk.js";

/** @param {{ caps?: Partial<typeof CAPS>, now?: () => number }} [options] */
export function createMediator(options) {
  const opts = options || {};
  const st = {
    caps: { ...CAPS, ...(opts.caps || {}) },
    now: opts.now || (() => Date.now()),
    violations: [],
    entities: 0,
    snapBytes: 0,
    bytes: bucket(),
    spawns: bucket(),
    joins: bucket(),
  };
  return {
    get caps() {
      return st.caps;
    },
    get violations() {
      return st.violations;
    },
    inspect(bytes) {
      return inspect(st, bytes);
    },
    wrap(transport) {
      return wrap(st, transport);
    },
  };
}

/** @param {any} st @param {Uint8Array} bytes */
function inspect(st, bytes) {
  if (!(bytes instanceof Uint8Array)) return fail("malformed");
  const now = st.now();
  if (!charge(st.bytes, now, bytes.length, st.caps.bytesPerSecond)) return fail("bytes");
  const packet = decodePacket(bytes);
  if (!packet.ok) return fail(packet.error === "bad_key" ? "bad_key" : "malformed");
  const draft = { entities: st.entities, snapBytes: st.snapBytes, spawns: 0, joins: 0 };
  const code = walk(st.caps, draft, packet, bytes.length);
  if (code) return fail(code);
  if (!charge(st.spawns, now, draft.spawns, st.caps.spawnPerSecond)) return fail("spawn_rate");
  if (!charge(st.joins, now, draft.joins, st.caps.joinPerSecond)) return fail("join_rate");
  st.entities = draft.entities;
  st.snapBytes = draft.snapBytes;
  return { ok: true };
}

/** @param {string} code */
function fail(code) {
  return { ok: false, code };
}

/** @param {any} st @param {any} transport */
function wrap(st, transport) {
  return {
    send(to, bytes, reliable) {
      if (!forward(st, bytes)) return;
      transport.send(to, bytes, reliable);
    },
    onMessage(handler) {
      transport.onMessage((from, bytes, reliable) => {
        if (forward(st, bytes)) handler(from, bytes, reliable);
      });
    },
    onPeerLeave(handler) {
      if (transport.onPeerLeave) transport.onPeerLeave(handler);
    },
    close() {
      if (transport.close) transport.close();
    },
  };
}

/** @param {any} st @param {Uint8Array} bytes */
function forward(st, bytes) {
  const result = inspect(st, bytes);
  if (result.ok) return true;
  st.violations.push(result.code);
  return false;
}

function bucket() {
  return { items: [], sum: 0 };
}

/** @param {{ items: { t: number, n: number }[], sum: number }} bucket @param {number} now @param {number} n @param {number} limit */
function charge(bucket, now, n, limit) {
  if (!n) return true;
  trim(bucket, now);
  if (bucket.sum + n > limit) return false;
  bucket.items.push({ t: now, n });
  bucket.sum += n;
  return true;
}

/** @param {{ items: { t: number, n: number }[], sum: number }} bucket @param {number} now */
function trim(bucket, now) {
  while (bucket.items.length && now - bucket.items[0].t >= 1000)
    bucket.sum -= bucket.items.shift().n;
}
