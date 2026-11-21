import assert from "node:assert/strict";
import test from "node:test";
import { encodePacket } from "../../net-wire/src/packet.js";
import { defineManifest } from "../../net-wire/src/manifest.js";
import { defaultState } from "../../net-wire/src/state.js";
import { createMediator } from "../src/mediate.js";

const room = defineManifest({ maxEntities: 1000 });
const base = defaultState(room.quant);

test("a full bucket allows 120 spawns and refuses the 121st", () => {
  let now = 0;
  const mediator = createMediator({ manifest: room, now: () => now });
  for (let id = 1; id <= 120; id++) {
    const result = mediator.inspect(spawn(id), { peer: "a", dir: "out", reliable: true });
    assert.equal(result.ok, true, id + " " + result.code);
  }
  const extra = mediator.inspect(spawn(121), { peer: "b", dir: "out", reliable: true });
  assert.equal(extra.ok, false);
  assert.equal(extra.code, "spawn_rate");
});

test("a drained bucket refills at about 30 spawns per second", () => {
  let now = 0;
  const mediator = createMediator({ manifest: room, now: () => now });
  for (let id = 1; id <= 120; id++) mediator.inspect(spawn(id), { peer: "a", dir: "out" });
  const counts = [];
  for (let second = 0; second < 3; second++) {
    now += 1000;
    let n = 0;
    while (mediator.inspect(spawn(1000 + second * 40 + n), { peer: "a", dir: "out" }).ok) n += 1;
    counts.push(n);
  }
  for (const n of counts) assert.ok(n >= 28 && n <= 32, counts.join(","));
});

test("four idle seconds refill the bucket to 120 and not past it", () => {
  let now = 0;
  const mediator = createMediator({ manifest: room, now: () => now });
  for (let id = 1; id <= 120; id++) mediator.inspect(spawn(id), { peer: "a", dir: "out" });
  now += 10000;
  let n = 0;
  while (mediator.inspect(spawn(500 + n), { peer: "a", dir: "out" }).ok) n += 1;
  assert.equal(n, 120);
});

test("a 100 per second attempt averages 30 per second after the burst", () => {
  let now = 0;
  const mediator = createMediator({ manifest: room, now: () => now });
  let accepted = 0;
  for (let i = 0; i < 1000; i++) {
    if (mediator.inspect(spawn(i + 1), { peer: "a", dir: "out" }).ok) accepted += 1;
    now += 10;
  }
  assert.ok(accepted >= 120 + 30 * 9, String(accepted));
  assert.ok(accepted <= 120 + 30 * 10 + 2, String(accepted));
});

test("manifest spawn settings are honored and invalid values are rejected", () => {
  let now = 0;
  const manifest = defineManifest({ maxEntities: 50, spawnPerSecond: 4, spawnBurst: 10 });
  const mediator = createMediator({ manifest, now: () => now });
  assert.equal(mediator.caps.spawnPerSecond, 4);
  assert.equal(mediator.caps.spawnBurst, 10);
  for (let id = 1; id <= 10; id++)
    assert.equal(mediator.inspect(spawn(id), { peer: "a", dir: "out" }).ok, true);
  assert.equal(mediator.inspect(spawn(11), { peer: "a", dir: "out" }).code, "spawn_rate");
  now += 1000;
  let n = 0;
  while (mediator.inspect(spawn(20 + n), { peer: "a", dir: "out" }).ok) n += 1;
  assert.equal(n, 4);
  assert.throws(
    () => createMediator({ manifest, caps: { spawnBurst: 9 }, now: () => 0 }),
    /spawnBurst/,
  );
  assert.throws(() => defineManifest({ spawnBurst: 0 }), /spawnBurst/);
  assert.throws(() => defineManifest({ spawnPerSecond: 1.5 }), /spawnPerSecond/);
  assert.throws(() => defineManifest({ spawnBurst: -1 }), /spawnBurst/);
});

test("a client spawn is host_only and does not spend the room", () => {
  const mediator = createMediator({ manifest: room, now: () => 0 });
  const client = mediator.inspect(spawn(1), { peer: "c", dir: "in", reliable: true });
  assert.equal(client.ok, false);
  assert.equal(client.code, "host_only");
  for (let id = 1; id <= 120; id++) {
    const result = mediator.inspect(spawn(id), { peer: "h", dir: "out", reliable: true });
    assert.equal(result.ok, true, String(id));
  }
  assert.equal(mediator.inspect(spawn(121), { peer: "h", dir: "out" }).code, "spawn_rate");
});

test("120 then 30 per second through multi-spawn packets does not kick", () => {
  const kicks = pace(30, 10);
  assert.deepEqual(kicks, []);
});

test("120 then 31 per second through multi-spawn packets is kicked", () => {
  const kicks = pace(31, 15);
  assert.ok(kicks.length > 0, "expected a kick");
  assert.equal(kicks[0].code, "spawn_rate");
  assert.ok(kicks[0].now >= 800, String(kicks[0].now));
});

/** @param {number} perSecond @param {number} seconds */
function pace(perSecond, seconds) {
  let now = 0;
  /** @type {{ code: string, now: number }[]} */
  const kicks = [];
  const mediator = createMediator({
    manifest: defineManifest({ maxEntities: 5000, tickHz: 20 }),
    now: () => now,
    onDisconnect(_peer, code) {
      if (!kicks.length) kicks.push({ code, now });
    },
  });
  const wrapped = mediator.wrap({
    send() {},
    onMessage() {},
  });
  let id = 1;
  const send = (count) => {
    const ids = [];
    for (let i = 0; i < count; i++) ids.push(id++);
    wrapped.send("c", many(ids), true);
  };
  for (let i = 0; i < 60; i++) send(2);
  const steps = seconds * 20;
  for (let t = 0; t < steps && !kicks.length; t++) {
    now += 50;
    const base = t % 2 === 0 ? 2 : 1;
    send(perSecond > 30 && t % 20 === 19 ? base + 1 : base);
  }
  return kicks;
}

/** @param {number[]} ids */
function many(ids) {
  return encodePacket(
    { tick: 1 },
    ids.map((id) => ({
      type: "spawn",
      record: { id, type: "e", version: 0, baseVersion: 0, cur: { ...base, custom: {} }, base },
    })),
  );
}

/** @param {number} id */
function spawn(id) {
  const cur = { ...base, custom: {} };
  return encodePacket({ tick: 1 }, [
    { type: "spawn", record: { id, type: "e", version: 0, baseVersion: 0, cur, base } },
  ]);
}
