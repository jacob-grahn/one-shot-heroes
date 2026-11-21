import assert from "node:assert/strict";
import test from "node:test";
import { encodePacket } from "../../net-wire/src/packet.js";
import { defineManifest } from "../../net-wire/src/manifest.js";
import { defaultState } from "../../net-wire/src/state.js";
import { createMediator } from "../src/mediate.js";

const room = defineManifest({ maxEntities: 1000 });
const base = defaultState(room.quant);

test("one tick forwards the burst and logs once the debt slack is spent", () => {
  const mediator = createMediator({ manifest: room, now: () => 0 });
  const n = untilNoted(mediator, (i) => spawn(i + 1, 0), 200);
  const slack = room.spawnPerSecond / 4;
  assert.ok(n >= 120, String(n));
  assert.ok(n <= 120 + slack + 1, String(n));
  assert.ok(mediator.violations.includes("spawn_rate"));
});

test("a drained bucket refills at about 30 spawns per second", () => {
  let now = 0;
  const mediator = createMediator({ manifest: room, now: () => now });
  for (let id = 1; id <= 120; id++) mediator.inspect(spawn(id), { peer: "a", dir: "out" });
  const counts = [];
  for (let second = 0; second < 3; second++) {
    now += 1000;
    const tick = gameTick(now);
    const n = untilNoted(mediator, (i) => spawn(1000 + second * 40 + i, tick), 80);
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
  const tick = gameTick(now);
  const n = untilNoted(mediator, (i) => spawn(500 + i, tick), 200);
  const slack = room.spawnPerSecond / 4 + 1;
  assert.ok(n >= 120 && n <= 120 + slack, String(n));
});

test("a 100 per second attempt averages 30 per second after the burst", () => {
  let now = 0;
  const mediator = createMediator({ manifest: room, now: () => now });
  let noted = -1;
  for (let i = 0; i < 1000; i++) {
    const result = mediator.inspect(spawn(i + 1, gameTick(now)), { peer: "a", dir: "out" });
    assert.equal(result.ok, true, String(i));
    if (noted < 0 && mediator.violations.includes("spawn_rate")) noted = i;
    now += 10;
  }
  assert.ok(noted >= 120, String(noted));
  assert.ok(noted <= 120 + 30 * 10 + room.spawnPerSecond / 4 + 2, String(noted));
});

test("manifest spawn settings are honored and invalid values are rejected", () => {
  let now = 0;
  const manifest = defineManifest({ maxEntities: 50, spawnPerSecond: 4, spawnBurst: 10 });
  const mediator = createMediator({ manifest, now: () => now });
  assert.equal(mediator.caps.spawnPerSecond, 4);
  assert.equal(mediator.caps.spawnBurst, 10);
  for (let id = 1; id <= 10; id++)
    assert.equal(mediator.inspect(spawn(id, 0), { peer: "a", dir: "out" }).ok, true);
  assert.equal(mediator.violations.includes("spawn_rate"), false);
  now += 1000;
  const tick = gameTick(now);
  for (let id = 20; id < 24; id++)
    assert.equal(mediator.inspect(spawn(id, tick), { peer: "a", dir: "out" }).ok, true);
  assert.equal(mediator.violations.includes("spawn_rate"), false);
  mediator.inspect(spawn(24, tick), { peer: "a", dir: "out" });
  mediator.inspect(spawn(25, tick), { peer: "a", dir: "out" });
  assert.ok(mediator.violations.includes("spawn_rate"));
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
  assert.equal(run.violations.includes("spawn_rate"), false);
  assert.equal(run.sent, run.attempts);
});

test("120 then 31 per second is logged and still forwarded", () => {
  const run = pace(31, 15);
  assert.deepEqual(run.kicks, []);
  assert.ok(run.violations.includes("spawn_rate"));
  assert.equal(run.sent, run.attempts);
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
  let sent = 0;
  const wrapped = mediator.wrap({
    send() {
      sent += 1;
    },
    onMessage() {},
  });
  let id = 1;
  let tick = 0;
  let attempts = 0;
  const send = (count) => {
    const ids = [];
    for (let i = 0; i < count; i++) ids.push(id++);
    attempts += 1;
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
  return { kicks, violations: mediator.violations, sent, attempts };
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
  assert.equal(run.violations.includes("spawn_rate"), false);
});

test("a stall of 500, 1000, or 1500 ms does not log spawn_rate", () => {
  for (const late of [500, 1000, 1500]) {
    const run = catchUp(late);
    assert.equal(run.violations.includes("spawn_rate"), false, String(late));
    assert.equal(run.kicks.length, 0, String(late));
    assert.equal(run.sent, 120 + run.extra, late + " " + run.sent);
  }
});

test("a 1 Hz wake forwards each second without a spawn_rate log", () => {
  let now = 0;
  const run = wire(wide, () => now);
  let id = 1;
  for (; id <= 120; id++) run.send(spawn(id, 0));
  let tick = 0;
  for (let sec = 0; sec < 3; sec++) {
    for (let step = 0; step < 20; step++) {
      tick += 1;
      const n = step % 2 === 0 ? 2 : 1;
      for (let i = 0; i < n; i++) run.send(spawn(id++, tick));
    }
    now += 1000;
  }
  assert.equal(run.violations.includes("spawn_rate"), false);
  assert.equal(run.kicks.length, 0);
});

test("tick 0 opens a fresh spawn budget", () => {
  let now = 0;
  const run = wire(wide, () => now);
  for (let id = 1; id <= 120; id++) run.send(spawn(id, 40));
  now = 5000;
  for (let id = 200; id < 320; id++) run.send(spawn(id, 0));
  assert.equal(run.violations.includes("spawn_rate"), false);
  assert.equal(run.sent, 240);
  assert.equal(run.kicks.length, 0);
});

test("late jitter at or under 30/s never kicks or refuses", () => {
  for (const average of [25, 28, 29.5, 30]) {
    for (const burst of [0, 60, 120]) {
      for (let seed = 1; seed <= 40; seed++) {
        const run = jitterRun(average, burst, seed);
        assert.equal(run.kicks, 0, average + " " + burst + " " + seed);
        assert.equal(run.noted, 0, average + " " + burst + " " + seed);
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
  assert.equal(run.violations.includes("spawn_rate"), false);
});

test("a jumped header tick cannot mint a second burst", () => {
  let now = 0;
  const run = wire(wide, () => now);
  for (let id = 1; id <= 120; id++) run.send(spawn(id, 0));
  const before = run.sent;
  now = 10;
  for (let id = 121; id <= 320; id++) run.send(spawn(id, 5000));
  assert.deepEqual(run.kicks, []);
  assert.equal(run.sent - before, 200);
  assert.ok(run.violations.includes("spawn_rate"));
});

test("violations stay a short ring", () => {
  const mediator = createMediator({ manifest: wide, now: () => 0 });
  for (let id = 1; id <= 200; id++)
    mediator.inspect(spawn(id, 0), { peer: "h", dir: "out", reliable: true });
  assert.ok(mediator.violations.length <= 32, String(mediator.violations.length));
  assert.equal(mediator.violations[mediator.violations.length - 1], "spawn_rate");
});

/** @param {number} late */
function catchUp(late) {
  let now = 0;
  const run = wire(wide, () => now);
  for (let id = 1; id <= 120; id++) run.send(spawn(id, 0));
  const steps = Math.round((late / 1000) * wide.tickHz);
  let id = 121;
  let extra = 0;
  for (let tick = 1; tick <= steps; tick++) {
    const n = tick % 2 === 0 ? 1 : 2;
    for (let i = 0; i < n; i++) {
      run.send(spawn(id++, tick));
      extra += 1;
    }
  }
  return { violations: run.violations, kicks: run.kicks, sent: run.sent, extra };
}

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
    get violations() {
      return mediator.violations;
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
  return { kicks: run.kicks.length, noted: run.violations.length };
}

/** @param {any} mediator @param {(i: number) => Uint8Array} at @param {number} limit */
function untilNoted(mediator, at, limit) {
  let n = 0;
  for (; n < limit; n++) {
    const before = mediator.violations.length;
    const result = mediator.inspect(at(n), { peer: "a", dir: "out" });
    assert.equal(result.ok, true, String(n));
    if (mediator.violations.length > before) return n;
  }
  return n;
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
