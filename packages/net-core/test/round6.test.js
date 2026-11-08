import assert from "node:assert/strict";
import test from "node:test";
import { createMediator } from "../../net-mediator/src/mediate.js";
import { createNetwork } from "../../net-sim/src/network.js";
import { createRoom } from "../../net-sim/src/room.js";
import { defineManifest } from "../../net-wire/src/manifest.js";
import { decodePacket, encodePacket } from "../../net-wire/src/packet.js";
import { createSession } from "../src/session.js";

const quiet = { init() {}, update() {}, render() {} };

test("manifest.tickHz names the field, the range, and the value", () => {
  assert.throws(
    () => defineManifest({ tickHz: 120 }),
    /manifest\.tickHz must be 1\.\.60 \(got 120\)/,
  );
});

test("a missing game and a client without hostPeerId fail up front", () => {
  const transport = { send() {}, onMessage() {} };
  assert.throws(() => createSession({ transport, isHost: true, playerId: 0 }), /game with init/);
  assert.throws(
    () =>
      createSession({
        manifest: defineManifest({}),
        game: quiet,
        transport,
        playerId: 1,
        isHost: false,
      }),
    /hostPeerId/,
  );
});

test("3, 8, and 15 second blackouts recover when silenceMs allows them", () => {
  for (const seconds of [3, 8, 15]) {
    const group = duo({ silenceMs: seconds === 15 ? 20000 : 12000 });
    group.run(6);
    group.blackout(seconds);
    group.run(8);
    assert.equal(group.client.ended, false, seconds + "s " + group.client.reason);
    assert.equal(group.client.joined, true);
    group.host.world.spawn("box", { x: seconds });
    group.run(6);
    assert.equal(group.client.world.query("box").length, 1);
  }
});

test("the default 12 second silence drops a longer blackout", () => {
  const group = duo({});
  group.run(4);
  assert.equal(group.manifest.silenceMs, 12000);
  group.blackout(13);
  group.net.advance(20);
  group.client.step();
  assert.equal(group.client.reason, "dropped");
  const before = group.host.stats.packets;
  group.host.world.spawn("late", { x: 1 });
  group.host.step();
  assert.equal(group.host.stats.packets, before);
  const rejoined = createSession({
    manifest: group.manifest,
    game: quiet,
    transport: group.clientEp,
    playerId: 1,
    peerId: "p1",
    isHost: false,
    hostPeerId: "p0",
  });
  for (let i = 0; i < 8; i++) {
    group.host.step();
    rejoined.step();
    group.net.advance(20);
  }
  assert.equal(group.host.ended, false);
  assert.equal(rejoined.joined, true);
  assert.equal(rejoined.ended, false);
  group.host.world.spawn("back", { x: 2 });
  for (let i = 0; i < 6; i++) {
    group.host.step();
    rejoined.step();
    group.net.advance(20);
  }
  assert.equal(rejoined.world.query("back").length, 1);
});

test("a 600±300 ms 40% loss link keeps both clients across 10 seeds", () => {
  for (let seed = 1; seed <= 10; seed++) {
    const manifest = defineManifest({
      maxPlayers: 3,
      tickHz: 20,
      inputs: { dx: { type: "int", min: -1, max: 1 } },
    });
    const net = createNetwork({ seed, latency: 600, jitter: 300, loss: 0.4 });
    const sessions = [0, 1, 2].map((index) =>
      createSession({
        manifest,
        game: mover(),
        transport: net.endpoint("p" + index),
        playerId: index,
        peerId: "p" + index,
        isHost: index === 0,
        hostPeerId: index === 0 ? "" : "p0",
      }),
    );
    const dt = 50;
    for (let i = 0; i < 80 && sessions.some((session, n) => n > 0 && !session.joined); i++) {
      for (const session of sessions) session.step();
      net.advance(dt);
    }
    for (let i = 0; i < 400; i++) {
      sessions[0].setInput({ dx: i % 2 === 0 ? 1 : -1 });
      for (const session of sessions) session.step();
      net.advance(dt);
    }
    net.configure({ loss: 0, latency: 0, jitter: 0 });
    for (let i = 0; i < 80; i++) {
      for (const session of sessions) session.step();
      net.advance(dt);
    }
    for (const session of sessions) {
      assert.equal(session.ended, false, "seed " + seed + " " + session.reason);
      assert.equal(session.joined, true, "seed " + seed);
      assert.equal(session.digest(), sessions[0].digest(), "seed " + seed);
    }
  }
});

test("protocol 2 hello and a version byte mismatch end with version", () => {
  const group = duo({});
  group.run(4);
  const old = group.net.endpoint("old");
  let reason = "";
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
      { type: "hello", playerId: 2, proto: 2, hash: group.manifest.hash },
    ]),
    true,
  );
  group.net.advance(20);
  group.host.step();
  group.net.advance(20);
  assert.equal(reason, "version");
  assert.equal(group.host.ended, false);
  const bad = encodePacket({ tick: 1, flags: 1 }, [{ type: "bye" }]);
  bad[0] = 2;
  group.clientEp.send("p0", bad, true);
  group.net.advance(20);
  group.host.step();
  group.net.advance(20);
  group.client.step();
  assert.equal(group.client.reason, "version");
  assert.equal(group.host.ended, false);
});

test("an occupied seat inside the silence window is reason seat", () => {
  const group = duo({});
  const taken = [];
  group.host.net.onPeerLeave((info) => taken.push(info.reason));
  group.run(4);
  const other = group.net.endpoint("p2");
  let reason = "";
  other.onMessage((_from, bytes) => {
    const packet = decodePacket(bytes);
    if (!packet.ok) return;
    const reject = packet.messages.find((message) => message.type === "reject");
    if (reject) reason = reject.code === 3 ? "seat" : "code " + reject.code;
  });
  other.send(
    "p0",
    encodePacket({ tick: 1, flags: 1 }, [
      { type: "hello", playerId: 1, proto: 3, hash: group.manifest.hash },
    ]),
    true,
  );
  group.net.advance(20);
  group.host.step();
  group.net.advance(20);
  assert.equal(reason, "seat");
  assert.equal(group.client.ended, false);
});

test("a full room rejects a new id with reason full", () => {
  const group = duo({});
  group.run(4);
  const extra = group.net.endpoint("p2");
  let reason = "";
  extra.onMessage((_from, bytes) => {
    const packet = decodePacket(bytes);
    if (!packet.ok) return;
    const reject = packet.messages.find((message) => message.type === "reject");
    if (reject) reason = reject.code === 5 ? "full" : "code " + reject.code;
  });
  extra.send(
    "p0",
    encodePacket({ tick: 1, flags: 1 }, [
      { type: "hello", playerId: 2, proto: 3, hash: group.manifest.hash },
    ]),
    true,
  );
  group.net.advance(20);
  group.host.step();
  group.net.advance(20);
  assert.equal(reason, "full");
  assert.equal(group.client.ended, false);
  assert.equal(group.host.ended, false);
});

test("a throwing onJoin does not escape step", () => {
  const warnings = [];
  const manifest = defineManifest({ maxPlayers: 2 });
  const net = createNetwork({ seed: 1, latency: 0 });
  const host = createSession({
    manifest,
    game: {
      init(_w, api) {
        api.onPeerJoin(() => {
          throw new Error("join broke");
        });
      },
      update() {},
      render() {},
      warn(message) {
        warnings.push(message);
      },
    },
    transport: net.endpoint("p0"),
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
  assert.doesNotThrow(() => {
    for (let i = 0; i < 6; i++) {
      host.step();
      client.step();
      net.advance(20);
    }
  });
  assert.equal(client.joined, true);
  assert.ok(warnings.some((message) => message.includes("join broke")));
});

test("a packet over the snapshot budget is rejected before it is trusted", () => {
  const mediator = createMediator({ now: () => 0 });
  const huge = new Uint8Array(mediator.caps.maxSnapshotBytes + 1);
  const result = mediator.inspect(huge, { peer: "p", dir: "in", reliable: true });
  assert.equal(result.ok, false);
  assert.equal(result.code, "budget");
});

test("createRoom hands out seat endpoints", () => {
  const room = createRoom({ seed: 2, latency: 0 });
  const a = room.endpoint(0);
  const b = room.endpoint(1);
  let got = "";
  b.onMessage((_from, bytes) => {
    got = new TextDecoder().decode(bytes);
  });
  a.send("p1", new TextEncoder().encode("hi"), false);
  room.advance(1);
  assert.equal(got, "hi");
});

test("a client custom string stringifies", () => {
  const manifest = defineManifest({
    maxPlayers: 2,
    custom: { name: { type: "string", max: 20 } },
  });
  const net = createNetwork({ seed: 1, latency: 0 });
  const host = createSession({
    manifest,
    game: {
      init(world, api) {
        if (api.isHost) world.spawn("mob", { custom: { name: "ada" } });
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
  const mob = client.world.query("mob")[0];
  assert.equal(`${mob.custom.name}`, "ada");
});

/** @param {{ silenceMs?: number }} opts */
function duo(opts) {
  const manifest = defineManifest({ maxPlayers: 2, tickHz: 20, silenceMs: opts.silenceMs });
  const net = createNetwork({ seed: 1, latency: 0 });
  const clientEp = net.endpoint("p1");
  const host = createSession({
    manifest,
    game: quiet,
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
  return {
    manifest,
    net,
    host,
    client,
    clientEp,
    run(k) {
      for (let i = 0; i < k; i++) {
        host.step();
        client.step();
        net.advance(20);
      }
    },
    blackout(seconds) {
      const steps = Math.round(seconds * manifest.tickHz);
      for (let i = 0; i < steps; i++) host.step();
    },
  };
}

function mover() {
  return {
    init(world, api) {
      if (api.isHost) world.spawn("box", { x: 0 });
    },
    update(_dt, inputs, world) {
      const input = inputs[0];
      if (!input) return;
      for (const box of world.query("box")) box.x += input.dx;
    },
    render() {},
  };
}
