/** Reusable big-endian buffer. Callers copy out before the next reset. */

const enc = new TextEncoder();

/** @param {number} [cap] */
export function createSink(cap) {
  const raw = new Uint8Array(cap || 4096);
  const view = new DataView(raw.buffer);
  let n = 0;
  return {
    reset() {
      n = 0;
    },
    get length() {
      return n;
    },
    u8(v) {
      raw[n++] = v & 255;
    },
    u16(v) {
      view.setUint16(n, v);
      n += 2;
    },
    u32(v) {
      view.setUint32(n, v);
      n += 4;
    },
    i32(v) {
      view.setInt32(n, v | 0);
      n += 4;
    },
    f32(v) {
      view.setFloat32(n, v);
      n += 4;
    },
    patchU16(at, v) {
      view.setUint16(at, v);
    },
    bytes(u) {
      raw.set(u, n);
      n += u.length;
    },
    str16(s) {
      const u = enc.encode(s);
      view.setUint16(n, u.length);
      n += 2;
      raw.set(u, n);
      n += u.length;
    },
    finish() {
      return raw.subarray(0, n);
    },
  };
}
