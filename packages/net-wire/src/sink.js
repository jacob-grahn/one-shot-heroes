/** Reusable big-endian buffer. Writes past the end throw instead of truncating. */

import { fail } from "./error.js";

const enc = new TextEncoder();

/** @param {number} [cap] */
export function createSink(cap) {
  const raw = new Uint8Array(cap || 4096);
  const view = new DataView(raw.buffer);
  let n = 0;
  function need(k) {
    if (n + k > raw.length) fail("range", "sink overflow");
  }
  return {
    reset() {
      n = 0;
    },
    get length() {
      return n;
    },
    u8(v) {
      need(1);
      raw[n++] = v & 255;
    },
    u16(v) {
      need(2);
      view.setUint16(n, v);
      n += 2;
    },
    u32(v) {
      need(4);
      view.setUint32(n, v);
      n += 4;
    },
    i32(v) {
      need(4);
      view.setInt32(n, v | 0);
      n += 4;
    },
    f32(v) {
      need(4);
      view.setFloat32(n, v);
      n += 4;
    },
    patchU16(at, v) {
      if (at < 0 || at + 2 > n) fail("range", "sink overflow");
      view.setUint16(at, v);
    },
    bytes(u) {
      n = writeBytes(raw, n, u);
    },
    str16(s) {
      n = writeStr(raw, view, n, s);
    },
    finish() {
      return raw.subarray(0, n);
    },
  };
}

/** @param {Uint8Array} raw @param {number} n @param {Uint8Array} u */
function writeBytes(raw, n, u) {
  if (n + u.length > raw.length) fail("range", "sink overflow");
  raw.set(u, n);
  return n + u.length;
}

/** @param {Uint8Array} raw @param {DataView} view @param {number} n @param {string} s */
function writeStr(raw, view, n, s) {
  const u = enc.encode(s);
  if (u.length > 65535) fail("range", "string longer than 65535 bytes");
  if (n + 2 + u.length > raw.length) fail("range", "sink overflow");
  view.setUint16(n, u.length);
  raw.set(u, n + 2);
  return n + 2 + u.length;
}
