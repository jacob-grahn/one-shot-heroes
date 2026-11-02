import assert from "node:assert/strict";
import test from "node:test";
import { createMediator } from "@osh/net-mediator";
import { decodePacket, defaultState, defineManifest, encodePacket } from "@osh/net-wire";
import { badKey } from "../../net-wire/test/craft.js";

const manifest = defineManifest({});
const base = defaultState(manifest.quant);

test("mediator enforces every cap, including prototype keys", () => {
  const entities = createMediator({ caps: { maxEntities: 1 }, now: () => 0 });
  assert.equal(entities.inspect(spawn(1, {})).ok, true);
  assert.equal(entities.inspect(spawn(2, {})).code, "entities");
  assert.equal(spawnRate(), "spawn_rate");
  assert.equal(inspect(eventPacket("n".repeat(40), { msg: "a" }), {}).code, "name");
  assert.equal(inspect(eventPacket("chat", fatEvent()), {}).code, "event");
  assert.equal(inspect(spawn(1, manyKeys(17)), {}).code, "keys");
  assert.equal(inspect(spawn(1, { name: "x".repeat(129) }), {}).code, "string");
  assert.equal(inspect(spawn(1, nest(5)), {}).code, "depth");
  assert.equal(inspect(spawn(1, fat()), {}).code, "custom");
  assert.equal(inspect(snap(3), { maxSnapshotBytes: 8 }).code, "snapshot");
  assert.equal(rate(hello(1), 5, "joinPerSecond", 4), "join_rate");
  assert.equal(rate(big(), 3, "bytesPerSecond", 50), "bytes");
  for (const key of ["__proto__", "constructor", "prototype"]) {
    const packet = badKey(key);
    const decoded = decodePacket(packet);
    if (decoded.ok === true) throw new Error("expected bad_key");
    assert.equal(decoded.error, "bad_key");
    assert.equal(inspect(packet, {}).code, "bad_key");
  }
  assert.equal(/** @type {any} */ ({}).polluted, undefined);
});

test("wrap does not forward a reliable packet that fails a cap", () => {
  const dropped = [];
  const mediator = createMediator({
    caps: { maxString: 4 },
    now: () => 0,
    onDisconnect(peer, code) {
      dropped.push(peer + ":" + code);
    },
  });
  const seen = [];
  const transport = {
    send(_to, bytes) {
      seen.push(bytes);
    },
  };
  const wrapped = mediator.wrap(transport);
  wrapped.send("p", spawn(1, { name: "hello" }), true);
  assert.equal(seen.length, 0);
  assert.deepEqual(dropped, ["p:string"]);
  assert.equal(mediator.violations[0], "string");
});

test("more than 64 peer ids are refused until an idle lane is evicted", () => {
  let now = 0;
  const mediator = createMediator({ now: () => now });
  for (let i = 0; i < 64; i++) {
    const peer = "p" + i;
    assert.equal(mediator.inspect(hello(i + 1), { peer, dir: "in", reliable: true }).ok, true);
    assert.equal(mediator.inspect(welcome(i + 1), { peer, dir: "out", reliable: true }).ok, true);
  }
  const refused = mediator.inspect(hello(80), { peer: "p64", dir: "in", reliable: true });
  assert.equal(refused.code, "lanes");
  assert.ok(mediator.violations.includes("lanes"));
  now = 1500;
  const held = mediator.inspect(hello(80), { peer: "p64", dir: "in", reliable: true });
  assert.equal(held.code, "lanes");
  now = 10000;
  const again = mediator.inspect(hello(80), { peer: "p64", dir: "in", reliable: true });
  assert.equal(again.ok, true);
});

test("64 rejected hellos do not block an honest peer", () => {
  let now = 0;
  const mediator = createMediator({ now: () => now });
  for (let i = 0; i < 64; i++) {
    const peer = "bad" + i;
    assert.equal(mediator.inspect(hello(i + 1), { peer, dir: "in", reliable: true }).ok, true);
    mediator.inspect(encodePacket({ tick: 1 }, [{ type: "reject", code: 2 }]), {
      peer,
      dir: "out",
      reliable: true,
    });
  }
  const honest = mediator.inspect(hello(99), { peer: "honest", dir: "in", reliable: true });
  assert.equal(honest.ok, true);
});

test("hellos resent inside the grace period cannot starve a new peer", () => {
  let now = 0;
  const mediator = createMediator({ now: () => now });
  for (let i = 0; i < 64; i++) {
    assert.equal(
      mediator.inspect(hello(i + 1), { peer: "bad" + i, dir: "in", reliable: true }).ok,
      true,
    );
  }
  now = 1400;
  for (let i = 0; i < 64; i++) {
    assert.equal(
      mediator.inspect(hello(i + 1), { peer: "bad" + i, dir: "in", reliable: true }).ok,
      true,
    );
  }
  const honest = mediator.inspect(hello(99), { peer: "honest", dir: "in", reliable: true });
  assert.equal(honest.ok, true);
});

test("mediator maxEntities follows the manifest", () => {
  const manifest = defineManifest({ maxEntities: 7 });
  const mediator = createMediator({ manifest, now: () => 0 });
  assert.equal(mediator.caps.maxEntities, 7);
  assert.throws(
    () => createMediator({ manifest, caps: { maxEntities: 3 }, now: () => 0 }),
    /does not match the manifest/,
  );
});

test("despawn frees a live entity slot", () => {
  const mediator = createMediator({
    caps: { maxEntities: 300, spawnPerSecond: 100000, bytesPerSecond: 100000000 },
    now: () => 0,
  });
  for (let n = 1; n <= 5000; n++) {
    assert.equal(mediator.inspect(spawn(n, {})).ok, true);
    assert.equal(mediator.inspect(despawn(n)).ok, true);
  }
  assert.deepEqual(mediator.violations, []);
  const capped = createMediator({ caps: { maxEntities: 1 }, now: () => 0 });
  assert.equal(capped.inspect(spawn(1, {})).ok, true);
  assert.equal(capped.inspect(spawn(2, {})).code, "entities");
  assert.equal(capped.inspect(despawn(1)).ok, true);
  assert.equal(capped.inspect(spawn(2, {})).ok, true);
});

test("byte and join windows are per peer and per direction", () => {
  const fat = big();
  const limit = fat.length + 8;
  const mediator = createMediator({ caps: { bytesPerSecond: limit }, now: () => 0 });
  assert.equal(mediator.inspect(fat, { peer: "a", dir: "in" }).ok, true);
  assert.equal(mediator.inspect(fat, { peer: "a", dir: "in" }).code, "bytes");
  assert.equal(mediator.inspect(fat, { peer: "b", dir: "in" }).ok, true);
  assert.equal(mediator.inspect(fat, { peer: "a", dir: "out" }).ok, true);
  const joins = createMediator({ caps: { joinPerSecond: 1 }, now: () => 0 });
  assert.equal(joins.inspect(hello(1), { peer: "a", dir: "in" }).ok, true);
  assert.equal(joins.inspect(hello(2), { peer: "a", dir: "in" }).code, "join_rate");
  assert.equal(joins.inspect(hello(3), { peer: "b", dir: "in" }).ok, true);
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

/** @param {number} id */
function despawn(id) {
  return encodePacket({ tick: 1, seq: 1 }, [{ type: "despawn", id }]);
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
  return encodePacket({ tick: 1 }, [{ type: "hello", playerId: id, proto: 2, hash: "abcd" }]);
}

/** @param {number} id */
function welcome(id) {
  return encodePacket({ tick: 1 }, [
    { type: "welcome", you: id, seed: 1, hostId: 0, players: [0, id] },
  ]);
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
  /** @type {any} */
  let value = { leaf: 1 };
  for (let i = 0; i < levels; i++) value = { child: value };
  return value;
}

function fat() {
  const custom = {};
  for (let i = 0; i < 16; i++) custom["k" + i] = "x".repeat(80);
  return custom;
}

function spawnRate() {
  const mediator = createMediator({
    caps: { spawnPerSecond: 30, maxEntities: 40 },
    now: () => 0,
  });
  let code = "";
  for (let id = 1; id <= 40; id++) {
    const result = mediator.inspect(spawn(id, {}));
    if (!result.ok) code = result.code;
  }
  mediator.inspect(despawn(1));
  const extra = mediator.inspect(spawn(41, {}));
  if (!extra.ok) code = extra.code;
  return code;
}

/** @param {string} name @param {any} payload */
function eventPacket(name, payload) {
  return encodePacket({ tick: 1 }, [{ type: "event", id: 1, origin: 1, name, payload }]);
}

function fatEvent() {
  const payload = {};
  for (let i = 0; i < 12; i++) payload["k" + i] = "x".repeat(120);
  return payload;
}
