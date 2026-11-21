import assert from "node:assert/strict";
import test from "node:test";
import { encodePacket } from "../../net-wire/src/packet.js";
import { defineManifest } from "../../net-wire/src/manifest.js";
import { defaultState } from "../../net-wire/src/state.js";
import { createMediator } from "../src/mediate.js";

const room = defineManifest({ maxEntities: 1000 });
const base = defaultState(room.quant);

test("one tick allows the burst and refuses once the debt slack is spent", () => {
  const mediator = createMediator({ manifest: room, now: () => 0 });
  let n = 0;
  while (mediator.inspect(spawn(n + 1, 0), { peer: "a", dir: "out", reliable: true }).ok) n += 1;
  const slack = room.spawnPerSecond / 4;
  assert.ok(n >= 120, String(n));
  assert.ok(n <= 120 + slack + 1, String(n));
  assert.equal(mediator.inspect(spawn(n + 1, 0), { peer: "b", dir: "out" }).code, "spawn_rate");
});

test("a drained bucket refills at about 30 spawns per second", () => {
  let now = 0;
  const mediator = createMediator({ manifest: room, now: () => now });
  for (let id = 1; id <= 120; id++) mediator.inspect(spawn(id), { peer: "a", dir: "out" });
  const counts = [];
  for (let second = 0; second < 3; second++) {
    now += 1000;
    let n = 0;
    const tick = gameTick(now);
    while (mediator.inspect(spawn(1000 + second * 40 + n, tick), { peer: "a", dir: "out" }).ok)
      n += 1;
    counts.push(n);
  }
  const slack = room.spawnPerSecond / 4 + 1;
  for (const n of counts) assert.ok(n >= 30 && n <= 30 + slack, counts.join(","));
});

test("four idle seconds refill the bucket to 120 and not past it", () => {
  let now = 0;
  const mediator = createMediator({ manifest: room, now: () => now });
  for (let id = 1; id <= 120; id++) mediator.inspect(spawn(id), { peer: "a", dir: "out" });
  now += 10000;
  let n = 0;
  const tick = gameTick(now);
  while (mediator.inspect(spawn(500 + n, tick), { peer: "a", dir: "out" }).ok) n += 1;
  const slack = room.spawnPerSecond / 4 + 1;
  assert.ok(n >= 120 && n <= 120 + slack, String(n));
});

test("a 100 per second attempt averages 30 per second after the burst", () => {
  let now = 0;
  const mediator = createMediator({ manifest: room, now: () => now });
  let accepted = 0;
  for (let i = 0; i < 1000; i++) {
    if (mediator.inspect(spawn(i + 1, gameTick(now)), { peer: "a", dir: "out" }).ok) accepted += 1;
    now += 10;
  }
  assert.ok(accepted >= 120 + 30 * 9, String(accepted));
  assert.ok(accepted <= 120 + 30 * 10 + room.spawnPerSecond / 4 + 2, String(accepted));
});

test("manifest spawn settings are honored and invalid values are rejected", () => {
  let now = 0;
  const manifest = defineManifest({ maxEntities: 50, spawnPerSecond: 4, spawnBurst: 10 });
  const mediator = createMediator({ manifest, now: () => now });
  assert.equal(mediator.caps.spawnPerSecond, 4);
  assert.equal(mediator.caps.spawnBurst, 10);
  for (let id = 1; id <= 10; id++)
    assert.equal(mediator.inspect(spawn(id, 0), { peer: "a", dir: "out" }).ok, true);
  assert.equal(mediator.inspect(spawn(11, 0), { peer: "a", dir: "out" }).ok, true);
  assert.equal(mediator.inspect(spawn(12, 0), { peer: "a", dir: "out" }).code, "spawn_rate");
  now += 1000;
  let n = 0;
  const tick = gameTick(now);
  while (mediator.inspect(spawn(20 + n, tick), { peer: "a", dir: "out" }).ok) n += 1;
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
    const result = mediator.inspect(spawn(id, 0), { peer: "h", dir: "out", reliable: true });
    assert.equal(result.ok, true, String(id));
  }
});

test("a client despawn, snapshot, state, welcome, or reject is host_only", () => {
  const mediator = createMediator({ manifest: room, now: () => 0 });
  const inbound = { peer: "c", dir: "in", reliable: true };
  for (const packet of [despawn(1), snap(), state(1), welcome(1), reject()]) {
    const result = mediator.inspect(packet, inbound);
    assert.equal(result.ok, false);
    assert.equal(result.code, "host_only");
  }
  assert.equal(mediator.inspect(spawn(1, 0), { peer: "h", dir: "out" }).ok, true);
});

test("120 then 30 per second through multi-spawn packets does not kick", () => {
  const run = pace(30, 10);
  assert.deepEqual(run.kicks, []);
  assert.equal(run.drops, 0);
});

test("120 then 31 per second is dropped and nobody is kicked", () => {
  const run = pace(31, 15);
  assert.deepEqual(run.kicks, []);
  assert.ok(run.drops > 0, String(run.drops));
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
  let tick = 0;
  const send = (count) => {
    const ids = [];
    for (let i = 0; i < count; i++) ids.push(id++);
    wrapped.send("c", many(ids, tick), true);
  };
  for (let i = 0; i < 60; i++) send(2);
  const steps = seconds * 20;
  for (let t = 0; t < steps && !kicks.length; t++) {
    tick += 1;
    now += 50;
    const baseCount = t % 2 === 0 ? 2 : 1;
    send(perSecond > 30 && t % 20 === 19 ? baseCount + 1 : baseCount);
  }
  return { kicks, drops: mediator.spawnDrops };
}

/** @param {number[]} ids */
/** @param {number[]} ids @param {number} tick */
function many(ids, tick) {
  return encodePacket(
    { tick },
    ids.map((id) => ({
      type: "spawn",
      record: { id, type: "e", version: 0, baseVersion: 0, cur: { ...base, custom: {} }, base },
    })),
  );
}

/** @param {number} id @param {number} [tick] */
function spawn(id, tick = 0) {
  const cur = { ...base, custom: {} };
  return encodePacket({ tick }, [
    { type: "spawn", record: { id, type: "e", version: 0, baseVersion: 0, cur, base } },
  ]);
}

/** @param {number} now @param {number} [hz] */
function gameTick(now, hz = 20) {
  return Math.round((now * hz) / 1000);
}

/** @param {number} id */
function despawn(id) {
  return encodePacket({ tick: 0 }, [{ type: "despawn", id }]);
}

function snap() {
  return encodePacket({ tick: 0 }, [{ type: "snap", index: 0, count: 1, total: 0, records: [] }]);
}

/** @param {number} id */
function state(id) {
  const cur = { ...base, custom: {} };
  return encodePacket({ tick: 0 }, [
    { type: "state", records: [{ id, version: 1, baseVersion: 0, cur, base }] },
  ]);
}

/** @param {number} id */
function welcome(id) {
  return encodePacket({ tick: 0 }, [
    { type: "welcome", you: id, seed: 1, hostId: 0, players: [0, id] },
  ]);
}

function reject() {
  return encodePacket({ tick: 0 }, [{ type: "reject", code: 1 }]);
}

const wide = defineManifest({ maxEntities: 5000, tickHz: 20 });

test("a burst that arrives 20 ms late still accepts the next tick", () => {
  let now = 20;
  const run = wire(wide, () => now);
  for (let id = 1; id <= 120; id++) run.send(spawn(id, 0));
  now = 50;
  run.send(spawn(121, 1));
  assert.deepEqual(run.kicks, []);
  assert.equal(run.drops, 0);
});

test("late jitter at or under 30/s never kicks or refuses", () => {
  for (const average of [25, 28, 29.5, 30]) {
    for (const burst of [0, 60, 120]) {
      for (let seed = 1; seed <= 40; seed++) {
        const run = jitterRun(average, burst, seed);
        assert.equal(run.kicks, 0, average + " " + burst + " " + seed);
        assert.equal(run.refused, 0, average + " " + burst + " " + seed);
      }
    }
  }
});

test("a 1 Hz host still delivers 30 spawns each second", () => {
  let now = 0;
  const run = wire(wide, () => now);
  for (let id = 1; id <= 120; id++) run.send(spawn(id, 0));
  let id = 121;
  for (let sec = 1; sec <= 30; sec++) {
    now = sec * 1000;
    const tick = sec * wide.tickHz;
    for (let n = 0; n < wide.spawnPerSecond; n++) run.send(spawn(id++, tick));
  }
  assert.deepEqual(run.kicks, []);
  assert.equal(run.drops, 0);
});

test("a jumped header tick cannot mint a second burst", () => {
  let now = 0;
  const run = wire(wide, () => now);
  for (let id = 1; id <= 120; id++) run.send(spawn(id, 0));
  const before = run.sent;
  now = 10;
  for (let id = 121; id <= 150; id++) run.send(spawn(id, 5000));
  assert.deepEqual(run.kicks, []);
  assert.ok(run.sent - before < 15, String(run.sent - before));
  assert.ok(run.drops > 0);
});

test("violations stay a short ring", () => {
  const mediator = createMediator({ manifest: wide, now: () => 0 });
  for (let id = 1; id <= 200; id++)
    mediator.inspect(spawn(id, 0), { peer: "h", dir: "out", reliable: true });
  assert.ok(mediator.violations.length <= 32, String(mediator.violations.length));
  assert.equal(mediator.violations[mediator.violations.length - 1], "spawn_rate");
});

/** @param {any} manifest @param {() => number} now */
function wire(manifest, now) {
  const kicks = [];
  let sent = 0;
  const mediator = createMediator({
    manifest,
    now,
    onDisconnect(_peer, code) {
      kicks.push(code);
    },
  });
  const wrapped = mediator.wrap({
    send() {
      sent += 1;
    },
    onMessage() {},
  });
  return {
    kicks,
    get drops() {
      return mediator.spawnDrops;
    },
    get sent() {
      return sent;
    },
    send(bytes) {
      wrapped.send("c", bytes, true);
    },
  };
}

/** @param {number} average @param {number} burst @param {number} seed */
function jitterRun(average, burst, seed) {
  const rand = mulberry(seed);
  let now = 0;
  const run = wire(wide, () => now);
  let id = 1;
  const sendCount = (tick, count) => {
    const ids = [];
    for (let i = 0; i < count; i++) ids.push(id++);
    now = tick * 50 + 10 + rand() * 35;
    run.send(many(ids, tick));
  };
  let left = burst;
  while (left > 0) {
    const n = Math.min(16, left);
    sendCount(0, n);
    left -= n;
  }
  let acc = 0;
  for (let tick = 1; tick <= 8 * wide.tickHz; tick++) {
    acc += average / wide.tickHz;
    let count = Math.floor(acc);
    acc -= count;
    while (count > 0) {
      const n = Math.min(1 + Math.floor(rand() * 6), count);
      sendCount(tick, n);
      count -= n;
    }
  }
  return { kicks: run.kicks.length, refused: run.drops };
}

/** @param {number} seed */
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
