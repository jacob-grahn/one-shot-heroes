import assert from "node:assert/strict";
import test from "node:test";
import { createMediator } from "@osh/net-mediator";
import { createSession } from "../src/session.js";
import { defineManifest } from "../../net-wire/src/manifest.js";
import { createNetwork } from "@osh/net-sim";
import { encodePacket } from "../../net-wire/src/packet.js";
import { defaultState } from "../../net-wire/src/state.js";

const quiet = { init() {}, update() {}, render() {} };

test("a host spawning at 200/s is refused, stays in sync, and kicks nobody", () => {
  const run = flood(120, 10);
  assert.equal(run.kicks.length, 0);
  assert.ok(run.refused > 0, "the game should see spawn_rate");
  assert.equal(run.accepted, run.expected);
  assert.ok(run.accepted >= 120 + 30 * 5, String(run.accepted));
  assert.ok(run.accepted <= 120 + 30 * 6 + 2, String(run.accepted));
  assert.equal(run.host.world.query("mob").length, run.accepted);
  assert.equal(run.host.stats.spawnRefused, run.refused);
  for (const client of run.clients) {
    assert.equal(client.ended, false);
    assert.equal(client.digest(), run.host.digest());
    assert.equal(client.world.query("mob").length, run.accepted);
  }
});

test("step does not throw when a spawn_rate error leaves update", () => {
  const warns = [];
  const host = lone(warns);
  assert.doesNotThrow(() => host.step());
  assert.equal(host.world.query("mob").length, 120);
  assert.equal(host.stats.spawnRefused, 1);
  assert.equal(host.stats.updateErrors, 1);
  assert.ok(warns.some((msg) => String(msg).includes("spawn_rate")));
});

test("custom spawn burst and rate are honored on the host and the mediator", () => {
  const manifest = defineManifest({
    maxPlayers: 1,
    spawnBurst: 5,
    spawnPerSecond: 2,
    tickHz: 20,
    maxEntities: 100,
  });
  const host = customHost(manifest);
  assert.deepEqual(host.play(0, 10), { accepted: 5, refused: 5 });
  assert.deepEqual(host.play(1000, 10), { accepted: 2, refused: 8 });
  const wire = customWire(manifest);
  for (let id = 1; id <= 8; id++) wire.send(id);
  assert.equal(wire.sent, 5);
  assert.equal(wire.drops, 3);
  assert.deepEqual(wire.kicks, []);
});

test("a non-conforming host has extra spawns dropped with no kick", () => {
  const run = bypass();
  assert.deepEqual(run.kicks, []);
  assert.ok(run.drops >= 1);
  assert.equal(run.clients[0].digest(), run.clients[1].digest());
  for (const client of run.clients) {
    assert.equal(client.ended, false);
    assert.equal(client.world.query("mob").length, 120);
    assert.equal(client.world.get(121), null);
  }
});

/** @param {number} ticks @param {number} perTick */
function flood(ticks, perTick) {
  let now = 0;
  const clock = () => now;
  const manifest = defineManifest({
    maxPlayers: 3,
    maxEntities: 2000,
    tickHz: 20,
  });
  const kicks = [];
  const net = createNetwork({ seed: 1, latency: 0 });
  const mediator = gate(manifest, clock, kicks);
  let on = false;
  let accepted = 0;
  let refused = 0;
  const game = {
    init() {},
    update(_dt, _inputs, world) {
      if (!on) return;
      for (let i = 0; i < perTick; i++)
        catchSpawn(
          world,
          () => (accepted += 1),
          () => (refused += 1),
        );
    },
    render() {},
  };
  const host = open(manifest, game, mediator.wrap(net.endpoint("p0")), 0, clock);
  const clients = [1, 2].map((id) => open(manifest, quiet, net.endpoint("p" + id), id, clock));
  for (let i = 0; i < 20; i++) turn(host, clients, net, () => (now += 50));
  assert.equal(
    clients.every((client) => client.joined),
    true,
  );
  on = true;
  const times = [];
  for (let i = 0; i < ticks; i++) {
    times.push(now);
    assert.doesNotThrow(() => turn(host, clients, net, () => (now += 50)));
  }
  on = false;
  for (let i = 0; i < 8; i++) turn(host, clients, net, () => (now += 50));
  return {
    kicks,
    accepted,
    refused,
    expected: predicted(times, perTick, manifest.spawnBurst, manifest.spawnPerSecond),
    host,
    clients,
  };
}

/** @param {string[]} warns */
function lone(warns) {
  const manifest = defineManifest({
    maxPlayers: 1,
    maxEntities: 1000,
    tickHz: 20,
  });
  const net = createNetwork({ seed: 2, latency: 0 });
  return open(
    manifest,
    {
      init() {},
      update(_dt, _inputs, world) {
        for (let i = 0; i < 200; i++) world.spawn("mob", { x: i });
      },
      render() {},
      warn(msg) {
        warns.push(msg);
      },
    },
    net.endpoint("p0"),
    0,
    () => 0,
  );
}

/** @param {any} manifest */
function customHost(manifest) {
  let now = 0;
  let left = 0;
  let accepted = 0;
  let refused = 0;
  const net = createNetwork({ seed: 3, latency: 0 });
  const host = open(
    manifest,
    {
      init() {},
      update(_dt, _inputs, world) {
        for (let i = 0; i < left; i++)
          catchSpawn(
            world,
            () => (accepted += 1),
            () => (refused += 1),
          );
      },
      render() {},
    },
    net.endpoint("p0"),
    0,
    () => now,
  );
  return {
    play(at, n) {
      now = at;
      left = n;
      accepted = 0;
      refused = 0;
      host.step();
      return { accepted, refused };
    },
  };
}

/** @param {any} manifest */
function customWire(manifest) {
  const kicks = [];
  let sent = 0;
  const mediator = gate(manifest, () => 0, kicks);
  const wrapped = mediator.wrap({
    send() {
      sent += 1;
    },
    onMessage() {},
  });
  const base = defaultState(manifest.quant);
  return {
    get sent() {
      return sent;
    },
    get drops() {
      return mediator.spawnDrops;
    },
    kicks,
    send(id) {
      wrapped.send("p", spawnPacket(base, id, id), true);
    },
  };
}

function bypass() {
  let now = 0;
  const clock = () => now;
  const manifest = defineManifest({
    maxPlayers: 3,
    maxEntities: 1000,
    tickHz: 20,
  });
  const kicks = [];
  const net = createNetwork({ seed: 4, latency: 0 });
  const mediator = gate(manifest, clock, kicks);
  const wrapped = mediator.wrap(net.endpoint("p0"));
  const host = open(manifest, quiet, wrapped, 0, clock);
  const clients = [1, 2].map((id) => open(manifest, quiet, net.endpoint("p" + id), id, clock));
  for (let i = 0; i < 20; i++) turn(host, clients, net, () => (now += 50));
  const base = defaultState(manifest.quant);
  for (let id = 1; id <= 120; id++) {
    wrapped.send("p1", spawnPacket(base, id, id), true);
    wrapped.send("p2", spawnPacket(base, id, id + 1000), true);
  }
  const extra = encodePacket({ tick: 2, seq: 2000, flags: 1 }, [
    { type: "spawn", record: record(base, 121) },
    {
      type: "state",
      records: [{ id: 121, version: 1, baseVersion: 0, cur: pose(base), base }],
    },
  ]);
  wrapped.send("p1", extra, true);
  wrapped.send("p2", extra, true);
  for (let i = 0; i < 6; i++) turn(host, clients, net, () => (now += 50));
  return { kicks, drops: mediator.spawnDrops, clients };
}

/** @param {any} world @param {() => void} ok @param {() => void} no */
function catchSpawn(world, ok, no) {
  try {
    world.spawn("mob", { x: 1 });
    ok();
  } catch (err) {
    if (!err || err.code !== "spawn_rate") throw err;
    no();
  }
}

/** @param {number[]} times @param {number} per @param {number} burst @param {number} rate */
function predicted(times, per, burst, rate) {
  let tokens = burst;
  let at = times[0];
  let accepted = 0;
  const half = 500 / 20;
  for (const t of times) {
    if (t - at >= half) {
      tokens = Math.min(burst, tokens + ((t - at) / 1000) * rate);
      at = t;
    }
    for (let i = 0; i < per && tokens >= 1; i++) {
      tokens -= 1;
      accepted += 1;
    }
  }
  return accepted;
}

/** @param {any} manifest @param {() => number} now @param {string[]} kicks */
function gate(manifest, now, kicks) {
  return createMediator({
    manifest,
    now,
    onDisconnect(peer, code) {
      kicks.push(peer + ":" + code);
    },
  });
}

/** @param {any} manifest @param {any} game @param {any} transport @param {number} id @param {() => number} now */
function open(manifest, game, transport, id, now) {
  return createSession({
    manifest,
    game,
    transport,
    playerId: id,
    peerId: "p" + id,
    isHost: id === 0,
    hostPeerId: id === 0 ? "" : "p0",
    now,
  });
}

/** @param {any} host @param {any[]} clients @param {any} net @param {() => void} after */
function turn(host, clients, net, after) {
  host.step();
  for (const client of clients) client.step();
  net.advance(50);
  after();
}

/** @param {any} base @param {number} id @param {number} seq */
function spawnPacket(base, id, seq) {
  return encodePacket({ tick: 1, seq, flags: 1 }, [{ type: "spawn", record: record(base, id) }]);
}

/** @param {any} base @param {number} id */
function record(base, id) {
  return { id, type: "mob", version: 0, baseVersion: 0, cur: pose(base), base };
}

/** @param {any} base */
function pose(base) {
  return { ...base, custom: {} };
}
