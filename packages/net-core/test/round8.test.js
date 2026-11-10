import assert from "node:assert/strict";
import test from "node:test";
import { createMediator } from "../../net-mediator/src/mediate.js";
import { createNetwork } from "../../net-sim/src/network.js";
import { defineManifest } from "../../net-wire/src/manifest.js";
import { encodePacket } from "../../net-wire/src/packet.js";
import { createSession } from "../src/session.js";

const quiet = { init() {}, update() {}, render() {} };

test("a delayed B does not stick after a lost return to A", () => {
  const manifest = defineManifest({ maxPlayers: 2, tickHz: 20 });
  const net = createNetwork({ seed: 1, latency: 0 });
  const raw = net.endpoint("p0");
  const held = [];
  let mode = "pass";
  const host = createSession({
    manifest,
    game: {
      init(world, api) {
        if (api.isHost) world.spawn("box", { x: 0 });
      },
      update() {},
      render() {},
    },
    transport: {
      send(to, bytes, reliable) {
        if (!reliable && mode === "hold") {
          held.push([to, bytes]);
          return;
        }
        if (!reliable && mode === "drop") {
          mode = "pass";
          return;
        }
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
  pump(host, client, net, 8);
  const box = host.world.query("box")[0];
  mode = "hold";
  box.x = 10;
  pump(host, client, net, 1);
  mode = "drop";
  box.x = 0;
  pump(host, client, net, 1);
  for (const [to, bytes] of held) raw.send(to, bytes, false);
  net.advance(20);
  client.step();
  pump(host, client, net, 24);
  assert.equal(client.digest(), host.digest());
  assert.equal(client.world.query("box")[0].x, 0);
});

test("seeded loss and reorder do not desync", () => {
  const profiles = [
    { loss: 0.2, jitter: 80, reorder: 0 },
    { loss: 0.1, jitter: 0, reorder: 0.2 },
    { loss: 0.05, jitter: 0, reorder: 0.1 },
  ];
  for (const profile of profiles) {
    let bad = 0;
    for (let seed = 1; seed <= 40; seed++) if (!fuzzOne(seed, profile)) bad += 1;
    assert.equal(bad, 0, JSON.stringify(profile));
  }
});

test("a repeated hello does not rebuild the session", () => {
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
  pump(host, client, net, 6);
  const before = host.stats.bytes;
  const hello = encodePacket({ tick: 1, flags: 1 }, [
    { type: "hello", playerId: 1, proto: 3, hash: manifest.hash },
  ]);
  for (let i = 0; i < 20; i++) {
    clientEp.send("p0", hello, true);
    host.step();
    net.advance(20);
  }
  assert.ok(host.stats.bytes - before < 4000, String(host.stats.bytes - before));
  assert.equal(client.ended, false);
});

test("hello flooders are kicked after the retry allowance", () => {
  const kicked = [];
  const mediator = createMediator({
    now: () => 0,
    onDisconnect(peerId) {
      kicked.push(peerId);
    },
  });
  const hello = encodePacket({ tick: 1 }, [{ type: "hello", playerId: 1, proto: 3, hash: "abcd" }]);
  for (let peer = 0; peer < 64; peer++) {
    let failed = false;
    for (let n = 0; n < 20; n++) {
      const result = mediator.inspect(hello, { peer: "f" + peer, dir: "in", reliable: true });
      if (!result.ok) failed = true;
    }
    assert.equal(failed, true, "f" + peer);
  }
  assert.equal(new Set(kicked).size, 64);
});

test("dropPeer does not recurse when the reject send disconnects", () => {
  const manifest = defineManifest({ maxPlayers: 2 });
  const net = createNetwork({ seed: 1, latency: 0 });
  const raw = net.endpoint("p0");
  let host;
  let armed = false;
  let sends = 0;
  host = createSession({
    manifest,
    game: quiet,
    transport: {
      send(to, bytes, reliable) {
        sends += 1;
        if (sends > 30) throw new Error("reject send recursed");
        raw.send(to, bytes, reliable);
        if (armed) host.dropPeer(to);
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
  pump(host, client, net, 6);
  armed = true;
  assert.doesNotThrow(() => host.dropPeer("p1"));
  assert.equal(host.ended, false);
  assert.ok(sends < 30);
});

test("a throttled host still drops silence in about 12 seconds", () => {
  const manifest = defineManifest({ maxPlayers: 2, tickHz: 20, silenceMs: 12000 });
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
  const client = createSession({
    manifest,
    game: quiet,
    transport: net.endpoint("p1"),
    playerId: 1,
    peerId: "p1",
    isHost: false,
    hostPeerId: "p0",
    now: () => now,
  });
  for (let i = 0; i < 4; i++) {
    now += 50;
    host.step();
    client.step();
    net.advance(50);
  }
  assert.equal(client.joined, true);
  for (let i = 0; i < 13; i++) {
    now += 1000;
    host.step();
  }
  net.advance(20);
  client.step();
  assert.equal(client.reason, "dropped");
});

test("a version flood gets one refusal", () => {
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
        const packet = encodeSeen(bytes);
        if (packet) refuses += 1;
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
  const stranger = net.endpoint("p8");
  const hello = encodePacket({ tick: 1, flags: 1 }, [
    { type: "hello", playerId: 4, proto: 8, hash: manifest.hash },
  ]);
  hello[0] = 8;
  for (let i = 0; i < 30; i++) {
    stranger.send("p0", hello, true);
    host.step();
    net.advance(1);
  }
  assert.ok(refuses <= 1, String(refuses));
  assert.equal(host.ended, false);
});

test("joinTimeoutMs defaults to 20 seconds", () => {
  assert.equal(defineManifest({}).joinTimeoutMs, 20000);
});

test("a moving entity on a clean link stays fresh", () => {
  const manifest = defineManifest({ maxPlayers: 2, tickHz: 20 });
  const net = createNetwork({ seed: 4, latency: 0 });
  const host = createSession({
    manifest,
    game: {
      init(world, api) {
        if (api.isHost) world.spawn("box", { x: 0 });
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
  pump(host, client, net, 8);
  for (let i = 0; i < 40; i++) {
    host.world.query("box")[0].x += 1;
    pump(host, client, net, 1);
  }
  assert.ok(host.stats.staleness < 5, String(host.stats.staleness));
});

test("deleting an array element warns and restores it", () => {
  const warnings = [];
  const manifest = defineManifest({
    maxPlayers: 2,
    custom: { nums: { type: "array", max: 4, item: { type: "int", min: 0, max: 9 } } },
  });
  const net = createNetwork({ seed: 1, latency: 0 });
  let host;
  host = createSession({
    manifest,
    game: {
      init(world, api) {
        if (api.isHost) world.spawn("box", { custom: { nums: [1, 2, 3] } });
      },
      update(_dt, _inputs, world) {
        const box = world.query("box")[0];
        if (box && box.custom.nums && box.custom.nums.length === 3 && warnings.length === 0)
          delete box.custom.nums[0];
      },
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
  assert.doesNotThrow(() => host.step());
  assert.equal(host.world.query("box")[0].custom.nums[0], 1);
  assert.ok(warnings.some((message) => message.includes("reverted") || message.includes("failed")));
});

test("render text cannot be edited", () => {
  const manifest = defineManifest({
    maxPlayers: 2,
    custom: { name: { type: "string", max: 20 } },
  });
  const net = createNetwork({ seed: 1, latency: 0 });
  let threw = false;
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
    game: {
      init() {},
      update() {},
      render(view) {
        const mob = view.entities.find((entity) => entity.type === "mob");
        if (!mob) return;
        assert.equal(`${mob.custom.name}`, "ada");
        try {
          mob.custom.name.text = "no";
        } catch (err) {
          threw = true;
        }
      },
    },
    transport: net.endpoint("p1"),
    playerId: 1,
    peerId: "p1",
    isHost: false,
    hostPeerId: "p0",
  });
  pump(host, client, net, 8);
  client.render();
  assert.equal(threw, true);
});

/** @param {number} seed @param {{ loss: number, jitter: number, reorder: number }} profile */
function fuzzOne(seed, profile) {
  const manifest = defineManifest({ maxPlayers: 2, tickHz: 20 });
  const net = createNetwork({
    seed,
    latency: 40,
    jitter: profile.jitter,
    loss: profile.loss,
    reorder: profile.reorder,
  });
  const host = createSession({
    manifest,
    game: {
      init(world, api) {
        if (api.isHost) world.spawn("box", { x: 0 });
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
  for (let i = 0; i < 120 && !client.joined && !client.ended; i++) pump(host, client, net, 1);
  if (!client.joined || client.ended) return false;
  for (let i = 0; i < 50; i++) {
    host.world.query("box")[0].x = (i * 3 + seed) % 40;
    pump(host, client, net, 1);
  }
  net.configure({ loss: 0, jitter: 0, reorder: 0, latency: 0 });
  pump(host, client, net, 40);
  return client.digest() === host.digest() && !client.ended && !host.ended;
}

/** @param {any} host @param {any} client @param {any} net @param {number} n */
function pump(host, client, net, n) {
  for (let i = 0; i < n; i++) {
    host.step();
    client.step();
    net.advance(20);
  }
}

/** @param {Uint8Array} bytes */
function encodeSeen(bytes) {
  if (bytes.length < 19 || bytes[15] !== 3) return false;
  return bytes[18] === 1;
}
