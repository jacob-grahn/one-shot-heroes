import assert from "node:assert/strict";
import test from "node:test";
import { createNetwork } from "../../net-sim/src/network.js";
import { defineManifest } from "../../net-wire/src/manifest.js";
import { encodePacket } from "../../net-wire/src/packet.js";
import { createSession } from "../src/session.js";

const quiet = { init() {}, update() {}, render() {} };

test("junk hellos do not lock out a joiner or a reload", () => {
  for (const rate of [5, 50]) assert.equal(throughJunk(rate), true, String(rate));
});

test("a 7-player fill grants one seat per host step", () => {
  const manifest = defineManifest({
    maxPlayers: 8,
    maxEntities: 1000,
    spawnBurst: 1000,
    tickHz: 20,
  });
  const net = createNetwork({ seed: 1, latency: 0 });
  const host = createSession({
    manifest,
    game: {
      init(world, api) {
        if (api.isHost) {
          for (let i = 0; i < 1000; i++) world.spawn("box", { x: i });
        }
      },
      update() {},
      render() {},
    },
    transport: net.endpoint("p0"),
    playerId: 0,
    peerId: "p0",
    isHost: true,
  });
  const clients = [];
  const seats = [];
  for (let id = 1; id <= 7; id++) {
    const seat = net.endpoint("p" + id);
    seats.push(seat);
    clients.push(
      createSession({
        manifest,
        game: quiet,
        transport: seat,
        playerId: id,
        peerId: "p" + id,
        isHost: false,
        hostPeerId: "p0",
      }),
    );
  }
  let joins = 0;
  const perStep = [];
  host.net.onPeerJoin(() => {
    joins += 1;
  });
  net.advance(1);
  const limit = manifest.maxPlayers + 2;
  let ticks = 0;
  for (; ticks < limit; ticks++) {
    seats.forEach((seat, index) => {
      seat.send(
        "p0",
        encodePacket({ tick: 1, flags: 1 }, [
          { type: "hello", playerId: index + 1, proto: 4, hash: manifest.hash },
        ]),
        true,
      );
    });
    net.advance(1);
    const before = joins;
    host.step();
    perStep.push(joins - before);
    for (const client of clients) client.step();
    if (filled(clients)) break;
  }
  assert.ok(
    perStep.every((n) => n <= 1),
    perStep.join(","),
  );
  assert.ok(perStep.some((n) => n === 1));
  assert.ok(ticks < limit, String(ticks));
  assert.equal(filled(clients), true);
  assert.equal(host.ended, false);
});

test("a queued reload is accepted on the next tick", () => {
  const manifest = defineManifest({ maxPlayers: 4, tickHz: 20 });
  let now = 0;
  const net = createNetwork({ seed: 1, latency: 0 });
  const host = createSession({
    manifest,
    game: quiet,
    transport: net.endpoint("p0"),
    playerId: 0,
    peerId: "p0",
    isHost: true,
    now: () => now,
  });
  const firstEp = net.endpoint("p1");
  const first = createSession({
    manifest,
    game: quiet,
    transport: firstEp,
    playerId: 1,
    peerId: "p1",
    isHost: false,
    hostPeerId: "p0",
    now: () => now,
  });
  for (let i = 0; i < 8 && !first.joined; i++) {
    now += 50;
    host.step();
    first.step();
    net.advance(50);
  }
  assert.equal(first.joined, true);
  now += 1500;
  host.step();
  net.advance(1);
  const second = createSession({
    manifest,
    game: quiet,
    transport: net.endpoint("p2"),
    playerId: 2,
    peerId: "p2",
    isHost: false,
    hostPeerId: "p0",
    now: () => now,
  });
  firstEp.send(
    "p0",
    encodePacket({ tick: 1, flags: 1 }, [
      { type: "hello", playerId: 1, proto: 4, hash: manifest.hash, nonce: 0xabc123 },
    ]),
    true,
  );
  net.advance(1);
  let joins = 0;
  host.net.onPeerJoin(() => {
    joins += 1;
  });
  host.step();
  host.step();
  second.step();
  net.advance(20);
  second.step();
  assert.equal(second.joined, true);
  assert.equal(joins, 2);
  assert.equal(host.ended, false);
});

/** @param {any[]} clients */
function filled(clients) {
  return clients.every((client) => client.joined && client.world.query("box").length === 1000);
}

/** @param {number} rate */
function throughJunk(rate) {
  const manifest = defineManifest({ maxPlayers: 4, tickHz: 20, joinTimeoutMs: 5000 });
  let now = 0;
  const net = createNetwork({ seed: rate, latency: 0 });
  const host = createSession({
    manifest,
    game: {
      init(world, api) {
        if (api.isHost) world.spawn("box", { x: 1 });
      },
      update() {},
      render() {},
    },
    transport: net.endpoint("p0"),
    playerId: 0,
    peerId: "p0",
    isHost: true,
    now: () => now,
  });
  let n = 0;
  const junk = () => {
    n += 1;
    net.endpoint("j" + rate + "-" + n).send("p0", badHello(manifest), true);
  };
  const perTick = Math.max(1, Math.round(rate / 20));
  for (let tick = 0; tick < 20; tick++) {
    now += 50;
    for (let i = 0; i < perTick; i++) junk();
    host.step();
    net.advance(20);
  }
  const clientEp = net.endpoint("p1");
  const client = createSession({
    manifest,
    game: quiet,
    transport: clientEp,
    playerId: 1,
    peerId: "p1",
    isHost: false,
    hostPeerId: "p0",
    now: () => now,
  });
  if (
    !seenWithin(
      host,
      client,
      net,
      junk,
      () => now,
      (value) => (now = value),
      1000,
    )
  )
    return false;
  const mark = now;
  while (now - mark < 1100) {
    now += 50;
    junk();
    host.step();
    client.step();
    net.advance(50);
  }
  const again = createSession({
    manifest,
    game: quiet,
    transport: clientEp,
    playerId: 1,
    peerId: "p1",
    isHost: false,
    hostPeerId: "p0",
    now: () => now,
  });
  return seenWithin(
    host,
    again,
    net,
    junk,
    () => now,
    (value) => (now = value),
    1000,
  );
}

/** @param {any} host @param {any} client @param {any} net @param {() => void} junk @param {() => number} read @param {(n: number) => void} write @param {number} limit */
function seenWithin(host, client, net, junk, read, write, limit) {
  const started = read();
  while (read() - started < limit) {
    write(read() + 50);
    junk();
    host.step();
    client.step();
    net.advance(50);
    if (client.joined && client.world.query("box").length === 1 && !client.ended) return true;
  }
  return false;
}

/** @param {any} manifest */
function badHello(manifest) {
  return encodePacket({ tick: 1, flags: 1 }, [
    { type: "hello", playerId: 3, proto: 9, hash: manifest.hash + "x" },
  ]);
}
