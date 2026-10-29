/** Packet envelope. decodePacket never throws; malformed input returns { ok: false }. */

import { createReader, createWriter } from "./bin.js";
import { HEADER_BYTES, MAX_MESSAGES, MSG, MSG_NAME, PROTOCOL } from "./defaults.js";
import { READERS } from "./msg-read.js";
import { WRITERS } from "./msg-write.js";
import { fail } from "./error.js";

export { HEADER_BYTES };

/** @param {{ flags?: number, tick: number, seq?: number, ack?: number, ackBits?: number }} header @param {any[]} messages */
export function encodePacket(header, messages) {
  if (messages.length > MAX_MESSAGES) fail("range", "too many messages");
  const w = createWriter();
  w.u8(PROTOCOL);
  w.u8(header.flags || 0);
  w.u32(header.tick >>> 0);
  w.u16(header.seq || 0);
  w.u16(header.ack || 0);
  w.u32(header.ackBits >>> 0);
  w.u8(messages.length);
  for (const message of messages) writeMessage(w, message);
  return w.finish();
}

/** @param {any} w @param {any} message */
function writeMessage(w, message) {
  const fn = WRITERS[message.type];
  if (!fn) fail("malformed", "unknown message");
  const body = createWriter();
  fn(body, message);
  const bytes = body.finish();
  if (bytes.length > 65535) fail("range", "message too large");
  w.u8(MSG[message.type]);
  w.u16(bytes.length);
  w.bytes(bytes);
}

/** @param {Uint8Array} bytes */
export function decodePacket(bytes) {
  try {
    return { ok: true, ...parsePacket(bytes) };
  } catch (e) {
    return { ok: false, error: (e && /** @type {{ code?: string }} */ (e).code) || "malformed" };
  }
}

/** @param {Uint8Array} bytes */
function parsePacket(bytes) {
  const r = createReader(bytes);
  const version = r.u8();
  if (version !== PROTOCOL) fail("version");
  const flags = r.u8();
  const tick = r.u32();
  const seq = r.u16();
  const ack = r.u16();
  const ackBits = r.u32();
  const count = r.u8();
  if (count > MAX_MESSAGES) fail("range");
  const messages = readMessages(r, count);
  if (r.left !== 0) fail("malformed");
  return { version, flags, tick, seq, ack, ackBits, messages };
}

/** @param {ReturnType<typeof createReader>} r @param {number} count */
function readMessages(r, count) {
  const messages = [];
  for (let i = 0; i < count; i++) messages.push(readMessage(r));
  return messages;
}

/** @param {ReturnType<typeof createReader>} r */
function readMessage(r) {
  const type = r.u8();
  const slice = r.take(r.u16());
  const name = MSG_NAME[type];
  const fn = name && READERS[name];
  if (!fn) fail("malformed");
  const inner = createReader(slice);
  const msg = fn(inner);
  if (inner.left !== 0) fail("malformed");
  msg.type = name;
  return msg;
}
