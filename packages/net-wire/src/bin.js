/** Big-endian readers and writers. Readers throw WireError instead of returning sentinels. */

import { fail } from "./error.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

export function createWriter() {
  const parts = [];
  const w = {
    get length() {
      return parts.length;
    },
    u8(v) {
      parts.push(v & 255);
    },
    u16(v) {
      parts.push((v >> 8) & 255, v & 255);
    },
    u32(v) {
      parts.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
    },
    i32(v) {
      w.u32(v | 0);
    },
    f32(v) {
      const b = new Uint8Array(4);
      new DataView(b.buffer).setFloat32(0, v);
      w.bytes(b);
    },
    bytes(u8) {
      for (let i = 0; i < u8.length; i++) parts.push(u8[i]);
    },
    str16(s) {
      const u = enc.encode(s);
      if (u.length > 65535) fail("range", "string longer than 65535 bytes");
      w.u16(u.length);
      w.bytes(u);
    },
    finish() {
      return Uint8Array.from(parts);
    },
  };
  return w;
}

/** @param {Uint8Array} bytes */
export function createReader(bytes) {
  if (!(bytes instanceof Uint8Array)) fail("malformed");
  let n = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  function need(k) {
    if (n + k > bytes.length) fail("truncated");
  }
  return {
    get left() {
      return bytes.length - n;
    },
    u8() {
      need(1);
      return bytes[n++];
    },
    u16() {
      need(2);
      const v = view.getUint16(n);
      n += 2;
      return v;
    },
    u32() {
      need(4);
      const v = view.getUint32(n);
      n += 4;
      return v;
    },
    i32() {
      need(4);
      const v = view.getInt32(n);
      n += 4;
      return v;
    },
    f32() {
      need(4);
      const v = view.getFloat32(n);
      n += 4;
      return v;
    },
    take(len) {
      need(len);
      const slice = bytes.subarray(n, n + len);
      n += len;
      return slice;
    },
    str16() {
      return dec.decode(this.take(this.u16()));
    },
  };
}

/** @param {any} w @param {string} s */
export function writeShort(w, s) {
  const u = enc.encode(s);
  if (u.length > 255) fail("range", "string longer than 255 bytes");
  w.u8(u.length);
  w.bytes(u);
}

/** @param {ReturnType<typeof createReader>} r */
export function readShort(r) {
  return dec.decode(r.take(r.u8()));
}

export function encodeUtf8(s) {
  return enc.encode(s);
}
