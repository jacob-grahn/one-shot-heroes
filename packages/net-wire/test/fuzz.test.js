import assert from "node:assert/strict";
import test from "node:test";
import {
  createWriter,
  decodePacket,
  defaultState,
  defineManifest,
  encodePacket,
  quantize,
} from "@osh/net-wire";

const protoNames = Object.getOwnPropertyNames(Object.prototype);

test("quantized defaults round-trip", () => {
  const manifest = defineManifest({});
  const entity = { x: 0, y: 0, rotation: 0, scale: 1, anim: 0, animStart: 0, custom: {} };
  const q = quantize(entity, manifest.quant);
  const d = defaultState(manifest.quant);
  assert.equal(q.x, d.x);
  assert.equal(q.scale, d.scale);
  assert.equal(q.rotation, 0);
});

test("spawn packet round-trips a non-default position", () => {
  const manifest = defineManifest({});
  const base = defaultState(manifest.quant);
  const cur = quantize(
    { x: 12.5, y: -3, rotation: 0, scale: 1, anim: 2, animStart: 4, custom: { hp: 3 } },
    manifest.quant,
  );
  const packet = encodePacket({ tick: 7, seq: 1 }, [
    { type: "spawn", record: { id: 4, type: "pawn", version: 0, baseVersion: 0, cur, base } },
  ]);
  const decoded = decodePacket(packet);
  assert.equal(decoded.ok, true);
  assert.equal(decoded.tick, 7);
  assert.equal(decoded.messages[0].record.id, 4);
  assert.equal(decoded.messages[0].record.patch.x, cur.x);
});

test("decoder fuzz does not throw or touch Object.prototype", () => {
  let state = 3;
  const rand = () => {
    state = (state + 0x6d2b79f5) | 0;
    return (state >>> 0) / 4294967296;
  };
  for (let i = 0; i < 300; i++) {
    const len = Math.floor(rand() * 80);
    const bytes = new Uint8Array(len);
    for (let b = 0; b < len; b++) bytes[b] = Math.floor(rand() * 256);
    const decoded = decodePacket(bytes);
    assert.equal(typeof decoded.ok, "boolean");
  }
  for (const key of ["__proto__", "constructor", "prototype"]) {
    const decoded = decodePacket(badKey(key));
    assert.equal(decoded.ok, false);
    assert.equal(decoded.error, "bad_key");
  }
  assert.deepEqual(Object.getOwnPropertyNames(Object.prototype), protoNames);
  assert.equal(/** @type {any} */ ({}).polluted, undefined);
});

/** @param {string} key */
function badKey(key) {
  const body = createWriter();
  body.u16(1);
  body.u8(1);
  body.bytes(new TextEncoder().encode("e"));
  body.u32(0);
  body.u32(0);
  body.u8(64);
  body.u8(1);
  body.u8(key.length);
  body.bytes(new TextEncoder().encode(key));
  body.u8(2);
  body.i32(1);
  const payload = body.finish();
  const packet = createWriter();
  packet.u8(1);
  packet.u8(0);
  packet.u32(1);
  packet.u16(1);
  packet.u16(0);
  packet.u32(0);
  packet.u8(1);
  packet.u8(4);
  packet.u16(payload.length);
  packet.bytes(payload);
  return packet.finish();
}
