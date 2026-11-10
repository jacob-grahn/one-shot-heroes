import assert from "node:assert/strict";
import test from "node:test";
import { createMediator } from "../../net-mediator/src/mediate.js";
import { createNetwork } from "../../net-sim/src/network.js";
import { PROTOCOL } from "../../net-wire/src/defaults.js";
import { defineManifest } from "../../net-wire/src/manifest.js";
import { encodePacket } from "../../net-wire/src/packet.js";
import { createSession } from "../src/session.js";

const quiet = { init() {}, update() {}, render() {} };

test("rotating ids through one seat accept at most burst plus two", () => {
  const manifest = defineManifest({ maxPlayers: 2, tickHz: 20 });
  let now = 0;
  const net = createNetwork({ seed: 1, latency: 0 });
  let joins = 0;
  const host = createSession({
    manifest,
    game: quiet,
    transport: net.endpoint("p0"),
    playerId: 0,
    peerId: "p0",
    isHost: true,
    now: () => now,
  });
  host.net.onPeerJoin(() => {
    joins += 1;
  });
  for (let i = 0; i < 20; i++) {
    const ep = net.endpoint("s" + i);
    const hello = encodePacket({ tick: 1, flags: 1 }, [
      { type: "hello", playerId: 1, proto: PROTOCOL, hash: manifest.hash },
    ]);
    ep.send("p0", hello, true);
    ep.send("p0", encodePacket({ tick: 1, flags: 1 }, [{ type: "bye" }]), true);
    host.step();
    net.advance(1);
    now += 50;
  }
  assert.ok(joins <= manifest.maxPlayers + 2, String(joins));
  assert.equal(host.ended, false);
});

test("a new nonce within a second keeps the live peer", () => {
  const manifest = defineManifest({ maxPlayers: 2, tickHz: 20 });
  let now = 0;
  const net = createNetwork({ seed: 1, latency: 0 });
  const clientEp = net.endpoint("p1");
  let leaves = 0;
  const host = createSession({
    manifest,
    game: quiet,
    transport: net.endpoint("p0"),
    playerId: 0,
    peerId: "p0",
    isHost: true,
    now: () => now,
  });
  host.net.onPeerLeave(() => {
    leaves += 1;
  });
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
  for (let i = 0; i < 8 && !client.joined; i++) {
    now += 50;
    host.step();
    client.step();
    net.advance(50);
  }
  assert.equal(client.joined, true);
  leaves = 0;
  clientEp.send(
    "p0",
    encodePacket({ tick: 1, flags: 1 }, [
      { type: "hello", playerId: 1, proto: PROTOCOL, hash: manifest.hash, nonce: 0xabcdef01 },
    ]),
    true,
  );
  net.advance(20);
  host.step();
  assert.equal(leaves, 0);
  assert.equal(
    host.net.players.some((player) => player.id === 1),
    true,
  );
  assert.equal(host.ended, false);
});

test("a join-hold sweep does not walk every id on every packet", () => {
  let now = 0;
  const mediator = createMediator({ now: () => now });
  const bye = encodePacket({ tick: 1 }, [{ type: "bye" }]);
  const hello = encodePacket({ tick: 1 }, [
    { type: "hello", playerId: 1, proto: PROTOCOL, hash: "abcd" },
  ]);
  const orig = Map.prototype[Symbol.iterator];
  let visits = 0;
  Map.prototype[Symbol.iterator] = function () {
    visits += this.size;
    return orig.call(this);
  };
  try {
    for (let i = 0; i < 2000; i++) {
      mediator.inspect(hello, { peer: "p" + i, dir: "in", reliable: true });
      mediator.inspect(bye, { peer: "p" + i, dir: "in", reliable: true });
      if (i % 100 === 99) now += 50;
    }
  } finally {
    Map.prototype[Symbol.iterator] = orig;
  }
  assert.ok(visits < 80000, String(visits));
});
