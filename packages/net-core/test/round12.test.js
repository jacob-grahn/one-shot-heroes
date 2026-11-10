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

test("seven players fill without a tick over 100 ms", () => {
  const manifest = defineManifest({ maxPlayers: 8, maxEntities: 1000, tickHz: 20 });
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
  for (let id = 1; id <= 7; id++) {
    clients.push(
      createSession({
        manifest,
        game: quiet,
        transport: net.endpoint("p" + id),
        playerId: id,
        peerId: "p" + id,
        isHost: false,
        hostPeerId: "p0",
      }),
    );
  }
  net.advance(1);
  let worst = 0;
  for (let tick = 0; tick < 12; tick++) {
    const started = performance.now();
    host.step();
    worst = Math.max(worst, performance.now() - started);
    for (const client of clients) client.step();
    net.advance(20);
  }
  assert.ok(worst < 100, worst.toFixed(1));
  assert.equal(
    clients.every((client) => client.joined && client.world.query("box").length === 1000),
    true,
  );
  assert.equal(host.ended, false);
});

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
