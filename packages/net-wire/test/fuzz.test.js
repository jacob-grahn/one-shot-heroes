import assert from "node:assert/strict";
import test from "node:test";
import { decodePacket, defaultState, defineManifest, encodePacket, quantize } from "@osh/net-wire";
import { badKey } from "./craft.js";

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
  if (decoded.ok === false) throw new Error("round trip failed");
  assert.equal(decoded.tick, 7);
  assert.equal(decoded.messages[0].record.id, 4);
  assert.equal(decoded.messages[0].record.patch.x, cur.x);
});

test("mutated valid packets do not throw or pollute", () => {
  const manifest = defineManifest({
    inputs: { dx: { type: "int", min: -1, max: 1 } },
    events: { chat: { msg: { type: "string", max: 40 } } },
  });
  const seeds = [
    encodePacket({ tick: 5, flags: 1 }, [
      { type: "hello", playerId: 1, proto: 2, hash: manifest.hash },
    ]),
    encodePacket({ tick: 5, flags: 1 }, [
      { type: "event", id: 3, origin: 1, name: "chat", payload: { msg: "hi" } },
    ]),
    encodePacket({ tick: 5, seq: 3 }, [
      { type: "input", samples: [{ tick: 4, values: { dx: 1 } }] },
    ]),
  ];
  let state = 99;
  const rnd = () => {
    state = (state * 1103515245 + 12345) >>> 0;
    return state / 4294967296;
  };
  for (let i = 0; i < 50000; i++) {
    const decoded = decodePacket(mutate(seeds[i % seeds.length], rnd));
    assert.equal(typeof decoded.ok, "boolean");
  }
  for (const key of ["__proto__", "constructor", "prototype"]) {
    const decoded = decodePacket(badKey(key));
    if (decoded.ok === true) throw new Error("expected bad_key");
    assert.equal(decoded.error, "bad_key");
  }
  assert.deepEqual(Object.getOwnPropertyNames(Object.prototype), protoNames);
  assert.equal(/** @type {any} */ ({}).polluted, undefined);
});

/** @param {Uint8Array} bytes @param {() => number} rnd */
function mutate(bytes, rnd) {
  const copy = new Uint8Array(bytes);
  const flips = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < flips; i++) copy[Math.floor(rnd() * copy.length)] = Math.floor(rnd() * 256);
  if (rnd() < 0.2) return copy.slice(0, Math.floor(rnd() * copy.length));
  return copy;
}
