import assert from "node:assert/strict";
import test from "node:test";
import { createMediator } from "../../net-mediator/src/mediate.js";
import { createNetwork } from "../../net-sim/src/network.js";
import { defineManifest } from "../../net-wire/src/manifest.js";
import { decodePacket, encodePacket } from "../../net-wire/src/packet.js";
import { createSession } from "../src/session.js";

const quiet = { init() {}, update() {}, render() {} };

test("a reload with the same id rejoins within 1 second", () => {
  const manifest = defineManifest({ maxPlayers: 2, tickHz: 20, joinTimeoutMs: 5000 });
  let now = 0;
  const net = createNetwork({ seed: 1, latency: 0 });
  const clientEp = net.endpoint("p1");
  const host = createSession({
    manifest,
    game: {
      init(world, api) {
        if (api.isHost) {
          for (let i = 0; i < 8; i++) world.spawn("box", { x: i });
        }
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
  const first = createSession({
    manifest,
    game: quiet,
    transport: clientEp,
    playerId: 1,
    peerId: "p1",
    isHost: false,
    hostPeerId: "p0",
    now: () => now,
  });
  for (let i = 0; i < 8; i++) {
    now += 50;
    host.step();
    first.step();
    net.advance(50);
  }
  assert.equal(first.joined, true);
  now += 1500;
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
  let joined = false;
  for (let i = 0; i < 20; i++) {
    now += 50;
    host.step();
    again.step();
    net.advance(50);
    if (again.joined && again.world.query("box").length === 8) joined = true;
  }
  assert.equal(joined, true);
  assert.equal(again.ended, false);
  assert.equal(host.ended, false);
});

test("one lost packet is resent at most twice", () => {
  const manifest = defineManifest({ maxPlayers: 2, tickHz: 20 });
  const net = createNetwork({ seed: 1, latency: 0 });
  const raw = net.endpoint("p0");
  let arm = false;
  let dropped = false;
  let copies = 0;
  const host = createSession({
    manifest,
    game: {
      init(world, api) {
        if (api.isHost) {
          world.spawn("a", { x: 0 });
          world.spawn("b", { x: 0 });
        }
      },
      update() {},
      render() {},
    },
    transport: {
      send(to, bytes, reliable) {
        if (!reliable && arm && !dropped) {
          dropped = true;
          arm = false;
          return;
        }
        if (!reliable && dropped) copies += countId(bytes, 1);
        raw.send(to, bytes, reliable);
      },
      onMessage(handler) {
        raw.onMessage(handler);
      },
    },
    playerId: 0,
    peerId: "p0",
    isHost: true,
  });
  const client = createSession({
    manifest,
    game: quiet,
    transport: net.endpoint("p1"),
    playerId: 1,
    peerId: "p1",
    isHost: false,
    hostPeerId: "p0",
  });
  for (let i = 0; i < 8; i++) {
    host.step();
    client.step();
    net.advance(20);
  }
  arm = true;
  host.world.query("a")[0].x = 5;
  host.step();
  client.step();
  net.advance(20);
  for (let i = 0; i < 70; i++) {
    host.world.query("b")[0].x += 1;
    host.step();
    client.step();
    net.advance(20);
  }
  for (let i = 0; i < 8; i++) {
    host.step();
    client.step();
    net.advance(20);
  }
  assert.ok(copies <= 2, String(copies));
  assert.equal(client.digest(), host.digest());
});

test("rotating version ids share one refusal budget", () => {
  const manifest = defineManifest({ maxPlayers: 2 });
  const net = createNetwork({ seed: 1, latency: 0 });
  const mediator = createMediator({ now: () => 0 });
  let refuses = 0;
  const raw = net.endpoint("p0");
  const host = createSession({
    manifest,
    game: quiet,
    transport: mediator.wrap({
      send(to, bytes, reliable) {
        if (bytes.length > 18 && bytes[15] === 3 && bytes[18] === 1) refuses += 1;
        raw.send(to, bytes, reliable);
      },
      onMessage(handler) {
        raw.onMessage(handler);
      },
    }),
    playerId: 0,
    peerId: "p0",
    isHost: true,
  });
  for (let i = 0; i < 40; i++) {
    const stranger = net.endpoint("s" + i);
    const hello = encodePacket({ tick: 1, flags: 1 }, [
      { type: "hello", playerId: 4, proto: 8, hash: manifest.hash },
    ]);
    hello[0] = 8;
    stranger.send("p0", hello, true);
    host.step();
    net.advance(1);
  }
  assert.ok(refuses <= 8, String(refuses));
  assert.equal(host.ended, false);
});

test("a same-session hello flood does not snapshot 200 entities", () => {
  const manifest = defineManifest({ maxPlayers: 2, tickHz: 20, maxEntities: 400 });
  const net = createNetwork({ seed: 1, latency: 0 });
  const clientEp = net.endpoint("p1");
  const host = createSession({
    manifest,
    game: {
      init(world, api) {
        if (api.isHost) {
          for (let i = 0; i < 200; i++) world.spawn("box", { x: i });
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
  const client = createSession({
    manifest,
    game: quiet,
    transport: clientEp,
    playerId: 1,
    peerId: "p1",
    isHost: false,
    hostPeerId: "p0",
  });
  for (let i = 0; i < 10; i++) {
    host.step();
    client.step();
    net.advance(20);
  }
  const before = host.stats.bytes;
  const hello = encodePacket({ tick: 1, flags: 1 }, [
    { type: "hello", playerId: 1, proto: 4, hash: manifest.hash },
  ]);
  for (let i = 0; i < 20; i++) {
    clientEp.send("p0", hello, true);
    host.step();
    net.advance(5);
  }
  assert.ok(host.stats.bytes - before < 8000, String(host.stats.bytes - before));
  assert.equal(client.ended, false);
});

/** @param {Uint8Array} bytes @param {number} id */
function countId(bytes, id) {
  const packet = decodePacket(bytes);
  if (!packet.ok) return 0;
  let n = 0;
  for (const message of packet.messages) {
    if (message.type !== "state") continue;
    for (const record of message.records) if (record.id === id) n += 1;
  }
  return n;
}
