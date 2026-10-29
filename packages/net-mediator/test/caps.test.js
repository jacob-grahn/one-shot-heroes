import assert from "node:assert/strict";
import test from "node:test";
import { createMediator } from "@osh/net-mediator";
import {
  createWriter,
  decodePacket,
  defaultState,
  defineManifest,
  encodePacket,
} from "@osh/net-wire";

const manifest = defineManifest({});
const base = defaultState(manifest.quant);

test("mediator enforces every cap, including prototype keys", () => {
  const entities = createMediator({ caps: { maxEntities: 1 }, now: () => 0 });
  assert.equal(entities.inspect(spawn(1, {})).ok, true);
  assert.equal(entities.inspect(spawn(2, {})).code, "entities");
  assert.equal(rate(spawn(1, {}), 31, "spawnPerSecond", 30), "spawn_rate");
  assert.equal(inspect(spawn(1, manyKeys(17)), {}).code, "keys");
  assert.equal(inspect(spawn(1, { name: "x".repeat(129) }), {}).code, "string");
  assert.equal(inspect(spawn(1, nest(5)), {}).code, "depth");
  assert.equal(inspect(spawn(1, fat()), {}).code, "custom");
  assert.equal(inspect(snap(3), { maxSnapshotBytes: 8 }).code, "snapshot");
  assert.equal(rate(hello(1), 5, "joinPerSecond", 4), "join_rate");
  assert.equal(rate(big(), 3, "bytesPerSecond", 50), "bytes");
  for (const key of ["__proto__", "constructor", "prototype"]) {
    const packet = badKey(key);
    assert.equal(decodePacket(packet).error, "bad_key");
    assert.equal(inspect(packet, {}).code, "bad_key");
  }
  assert.equal(/** @type {any} */ ({}).polluted, undefined);
});

test("wrap drops a packet that fails a cap", () => {
  const mediator = createMediator({ caps: { maxString: 4 }, now: () => 0 });
  const seen = [];
  const transport = {
    send(_to, bytes) {
      seen.push(bytes);
    },
  };
  const wrapped = mediator.wrap(transport);
  wrapped.send("p", spawn(1, { name: "hello" }), true);
  assert.equal(seen.length, 0);
  assert.equal(mediator.violations[0], "string");
});

/** @param {Uint8Array} bytes @param {Record<string, number>} caps */
function inspect(bytes, caps) {
  return createMediator({ caps, now: () => 0 }).inspect(bytes);
}

/** @param {Uint8Array} bytes @param {number} times @param {string} cap @param {number} limit */
function rate(bytes, times, cap, limit) {
  const mediator = createMediator({ caps: { [cap]: limit, maxEntities: 1000 }, now: () => 0 });
  let code = "";
  for (let i = 0; i < times; i++) {
    const result = mediator.inspect(bytes);
    if (!result.ok) code = result.code;
  }
  return code;
}

/** @param {number} id @param {any} custom */
function spawn(id, custom) {
  const cur = { ...base, custom };
  return encodePacket({ tick: 1, seq: 1 }, [
    { type: "spawn", record: { id, type: "e", version: 0, baseVersion: 0, cur, base } },
  ]);
}

/** @param {number} total */
function snap(total) {
  const records = [];
  for (let i = 1; i <= total; i++)
    records.push({
      id: i,
      type: "e",
      version: 0,
      baseVersion: 0,
      cur: { ...base, custom: {} },
      base,
    });
  return encodePacket({ tick: 1 }, [{ type: "snap", index: 0, count: 1, total, records }]);
}

/** @param {number} id */
function hello(id) {
  return encodePacket({ tick: 1 }, [{ type: "hello", playerId: id, proto: 1, hash: "abcd" }]);
}

function big() {
  return encodePacket({ tick: 1 }, [
    { type: "event", id: 1, origin: 0, name: "e", payload: { t: "x".repeat(40) } },
  ]);
}

/** @param {number} n */
function manyKeys(n) {
  const custom = {};
  for (let i = 0; i < n; i++) custom["k" + i] = i;
  return custom;
}

/** @param {number} levels */
function nest(levels) {
  let value = { leaf: 1 };
  for (let i = 0; i < levels; i++) value = { child: value };
  return value;
}

function fat() {
  const custom = {};
  for (let i = 0; i < 16; i++) custom["k" + i] = "x".repeat(80);
  return custom;
}

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
