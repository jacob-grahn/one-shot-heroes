import assert from "node:assert/strict";
import test from "node:test";
import { createNetwork } from "../../net-sim/src/network.js";
import { defineManifest } from "../../net-wire/src/manifest.js";
import { PROTOCOL } from "../../net-wire/src/defaults.js";
import { decodePacket, encodePacket } from "../../net-wire/src/packet.js";
import { createSession } from "../src/session.js";

const quiet = { init() {}, update() {}, render() {} };

test("a bye and hello in one packet accepts at most once", () => {
  const manifest = defineManifest({ maxPlayers: 2, tickHz: 20 });
  const net = createNetwork({ seed: 1, latency: 0 });
  const clientEp = net.endpoint("p1");
  let joins = 0;
  const host = createSession({
    manifest,
    game: quiet,
    transport: net.endpoint("p0"),
    playerId: 0,
    peerId: "p0",
    isHost: true,
  });
  host.net.onPeerJoin(() => {
    joins += 1;
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
  for (let i = 0; i < 8 && !client.joined; i++) {
    host.step();
    client.step();
    net.advance(20);
  }
  assert.equal(client.joined, true);
  joins = 0;
  for (let i = 0; i < 20; i++) {
    const hello = { type: "hello", playerId: 1, proto: PROTOCOL, hash: manifest.hash };
    const messages = i % 2 === 0 ? [{ type: "bye" }, hello] : [hello, { type: "bye" }];
    clientEp.send("p0", encodePacket({ tick: 1, flags: 1 }, messages), true);
    host.step();
    net.advance(5);
  }
  assert.ok(joins <= 1, String(joins));
  assert.equal(host.ended, false);
});

test("a reload still rejoins within about 1.1 seconds", () => {
  const manifest = defineManifest({ maxPlayers: 2, tickHz: 20, joinTimeoutMs: 5000 });
  let now = 0;
  const net = createNetwork({ seed: 1, latency: 0 });
  const clientEp = net.endpoint("p1");
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
  for (let i = 0; i < 8 && !first.joined; i++) {
    now += 50;
    host.step();
    first.step();
    net.advance(50);
  }
  assert.equal(first.joined, true);
  const started = now;
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
  let joinedAt = -1;
  while (now - started < 1200) {
    now += 50;
    host.step();
    again.step();
    net.advance(50);
    if (again.joined && again.world.query("box").length === 1) {
      joinedAt = now - started;
      break;
    }
  }
  assert.ok(joinedAt >= 0 && joinedAt <= 1200, String(joinedAt));
  assert.equal(again.ended, false);
});

test("a protocol 3 hello is refused as version", () => {
  const manifest = defineManifest({ maxPlayers: 2 });
  const net = createNetwork({ seed: 1, latency: 0 });
  const host = createSession({
    manifest,
    game: quiet,
    transport: net.endpoint("p0"),
    playerId: 0,
    peerId: "p0",
    isHost: true,
  });
  let reason = "";
  const old = net.endpoint("old");
  old.onMessage((_from, bytes) => {
    const packet = decodePacket(bytes);
    if (packet.ok === false && packet.error === "version") reason = "version";
    if (packet.ok) {
      const reject = packet.messages.find((message) => message.type === "reject");
      if (reject && reject.code === 1) reason = "version";
    }
  });
  old.send(
    "p0",
    encodePacket({ tick: 1, flags: 1 }, [
      { type: "hello", playerId: 2, proto: 3, hash: manifest.hash },
    ]),
    true,
  );
  net.advance(20);
  host.step();
  net.advance(20);
  assert.equal(reason, "version");
  assert.equal(host.ended, false);
});
