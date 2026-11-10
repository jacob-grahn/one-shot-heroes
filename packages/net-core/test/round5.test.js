import assert from "node:assert/strict";
import test from "node:test";
import { createSession, defineManifest } from "@osh/net-core";
import { createMediator } from "@osh/net-mediator";
import { createNetwork } from "@osh/net-sim";
import { customStamp, decodePacket, defaultState, encodePacket, userText } from "@osh/net-wire";

const quiet = { init() {}, update() {}, render() {} };

test("a late joiner still receives events past id 64", () => {
  const manifest = defineManifest({
    maxPlayers: 2,
    events: { ping: { n: { type: "int", min: 0, max: 1000 } } },
  });
  const net = createNetwork({ seed: 1, latency: 0 });
  const got = [];
  const host = createSession({
    manifest,
    game: quiet,
    transport: net.endpoint("p0"),
    playerId: 0,
    peerId: "p0",
    isHost: true,
  });
  for (let i = 0; i < 70; i++) host.net.emit("ping", { n: i });
  const client = createSession({
    manifest,
    game: {
      init(_w, api) {
        api.on("ping", (payload) => got.push(payload.n));
      },
      update() {},
      render() {},
    },
    transport: net.endpoint("p1"),
    playerId: 1,
    peerId: "p1",
    isHost: false,
    hostPeerId: "p0",
  });
  for (let t = 0; t < 8; t++) {
    host.step();
    client.step();
    net.advance(20);
  }
  host.net.emit("ping", { n: 70 });
  for (let t = 0; t < 4; t++) {
    host.step();
    client.step();
    net.advance(20);
  }
  assert.ok(got.includes(70), "late event " + got.join(","));
});

test("an event gap does not stall the dedupe window", () => {
  const manifest = defineManifest({
    maxPlayers: 2,
    events: { ping: { n: { type: "int", min: 0, max: 1000 } } },
  });
  const net = createNetwork({ seed: 2, latency: 0 });
  const got = [];
  const hostEp = net.endpoint("p0");
  const client = createSession({
    manifest,
    game: {
      init(_w, api) {
        api.on("ping", (payload) => got.push(payload.n));
      },
      update() {},
      render() {},
    },
    transport: net.endpoint("p1"),
    playerId: 1,
    peerId: "p1",
    isHost: false,
    hostPeerId: "p0",
  });
  createSession({
    manifest,
    game: quiet,
    transport: hostEp,
    playerId: 0,
    peerId: "p0",
    isHost: true,
  });
  for (let t = 0; t < 6; t++) {
    client.step();
    net.advance(20);
  }
  hostEp.send(
    "p1",
    encodePacket({ tick: 1, flags: 1 }, [
      { type: "event", id: 80, origin: 0, epoch: 0, name: "ping", payload: { n: 80 } },
    ]),
    true,
  );
  net.advance(20);
  client.step();
  assert.deepEqual(got, [80]);
});

test("dropPeer tells the client it is gone", () => {
  const group = pair();
  let reason = "";
  group.client.net.onEnd((value) => {
    reason = value;
  });
  group.run(6);
  assert.equal(group.client.joined, true);
  group.host.dropPeer("p1");
  group.net.advance(20);
  group.client.step();
  assert.equal(group.client.ended, true);
  assert.equal(group.client.reason, "dropped");
  assert.equal(reason, "dropped");
});

test("the same peer id can rejoin after a reload", () => {
  const group = pair();
  group.run(6);
  const before = group.host.stats.packets;
  group.clientEp.send(
    "p0",
    encodePacket({ tick: 1, flags: 1 }, [
      { type: "hello", playerId: 1, proto: 4, hash: group.manifest.hash },
    ]),
    true,
  );
  group.run(4);
  assert.ok(group.host.stats.packets > before);
  assert.equal(group.client.ended, false);
  group.host.world.spawn("box", { x: 4 });
  group.run(4);
  assert.equal(group.client.world.query("box").length, 1);
});

test("a silent peer is dropped and stops receiving state", () => {
  const group = pair();
  group.run(4);
  const limit = Math.ceil((group.manifest.silenceMs / 1000) * group.manifest.tickHz) + 2;
  group.hostOnly(limit);
  group.net.advance(20);
  group.client.step();
  assert.equal(group.client.reason, "dropped");
  const packets = group.host.stats.packets;
  group.host.world.spawn("box", { x: 1 });
  group.host.step();
  assert.equal(group.host.stats.packets, packets);
});

test("a throw in update does not stop the host", () => {
  const warnings = [];
  let ticks = 0;
  const manifest = defineManifest({ maxPlayers: 2 });
  const net = createNetwork({ seed: 3, latency: 0 });
  const host = createSession({
    manifest,
    game: {
      init() {},
      update() {
        ticks += 1;
        if (ticks === 1) throw new Error("boom");
      },
      render() {},
      warn(message) {
        warnings.push(message);
      },
    },
    transport: net.endpoint("h"),
    playerId: 0,
    peerId: "h",
    isHost: true,
  });
  assert.doesNotThrow(() => host.step());
  assert.doesNotThrow(() => host.step());
  assert.equal(ticks, 2);
  assert.equal(host.ended, false);
  assert.ok(warnings.some((message) => message.includes("boom")));
  assert.equal(host.stats.updateErrors, 1);
});

test("budget 48 cannot hold a welcome for 8 players", () => {
  assert.throws(
    () =>
      createSession({
        manifest: defineManifest({ maxPlayers: 8, budget: 48 }),
        game: quiet,
        transport: { send() {}, onMessage() {} },
        playerId: 0,
        peerId: "h",
        isHost: true,
      }),
    /welcome size/,
  );
});

test("the host warns when custom data breaks the schema", () => {
  const warnings = [];
  const manifest = defineManifest({
    maxPlayers: 2,
    custom: { hp: { type: "int", min: 0, max: 10 } },
  });
  const net = createNetwork({ seed: 4, latency: 0 });
  const host = createSession({
    manifest,
    game: {
      init() {},
      update() {},
      render() {},
      warn(message) {
        warnings.push(message);
      },
    },
    transport: net.endpoint("h"),
    playerId: 0,
    peerId: "h",
    isHost: true,
  });
  const blob = host.world.spawn("blob", { custom: { hp: 1 } });
  blob.custom.hp = 50;
  blob.custom.extra = 1;
  host.step();
  assert.ok(warnings.some((message) => message.includes("hp")));
  assert.ok(warnings.some((message) => message.includes("extra")));
});

test("custom writes cannot bypass the proxy traps", () => {
  const manifest = defineManifest({
    maxPlayers: 2,
    custom: { hp: { type: "int", min: 0, max: 10 } },
  });
  const host = createSession({
    manifest,
    game: quiet,
    transport: { send() {}, onMessage() {} },
    playerId: 0,
    peerId: "h",
    isHost: true,
  });
  const blob = host.world.spawn("blob", { custom: { hp: 1 } });
  Object.defineProperty(blob.custom, "hp", { value: 4 });
  assert.equal(blob.custom.hp, 4);
  assert.throws(() => Object.setPrototypeOf(blob.custom, {}));
  assert.throws(() => Object.preventExtensions(blob.custom));
  assert.throws(() => host.world.spawn("bad", { custom: { ["__proto__"]: 1 } }), /bad custom key/);
});

test("decoded strings stringify as their text", () => {
  assert.equal(String(userText("hi")), "hi");
  assert.equal(userText("hi") + "", "hi");
});

test("onJoin fires when a client joins", () => {
  let joins = 0;
  const group = pair({
    init(_w, api) {
      api.onJoin(() => {
        joins += 1;
      });
    },
  });
  group.run(6);
  assert.ok(joins >= 1);
});

test("mutated packets do not throw or pollute Object.prototype", () => {
  const before = Object.getOwnPropertyNames(Object.prototype).slice();
  const packet = encodePacket({ tick: 1, flags: 1 }, [
    { type: "event", id: 1, origin: 1, epoch: 0, name: "ping", payload: { n: 1 } },
  ]);
  for (let i = 0; i < packet.length; i++) {
    const copy = packet.slice();
    copy[i] ^= 255;
    assert.doesNotThrow(() => decodePacket(copy));
  }
  assert.deepEqual(Object.getOwnPropertyNames(Object.prototype).slice(), before);
});

test("a legal 150-spawn tick does not disconnect anyone", () => {
  const dropped = [];
  const mediator = createMediator({
    caps: { spawnPerSecond: 30, maxEntities: 400 },
    now: () => 0,
    onDisconnect(_peer, code) {
      dropped.push(code);
    },
  });
  for (let id = 1; id <= 150; id++) {
    const result = mediator.inspect(spawnOf(id), { peer: "h", dir: "out", reliable: true });
    assert.equal(result.ok, true, result.code);
  }
  assert.deepEqual(dropped, []);
});

test("the string cap follows the manifest", () => {
  const manifest = defineManifest({ custom: { name: { type: "string", max: 200 } } });
  const mediator = createMediator({ manifest, now: () => 0 });
  assert.equal(mediator.caps.maxString, 200);
  const result = mediator.inspect(spawnOf(1, "n".repeat(150)));
  assert.equal(result.ok, true, result.code);
});

test("a snapshot larger than 64 KiB still lets a late joiner in", () => {
  const manifest = defineManifest({
    maxPlayers: 2,
    maxEntities: 400,
    custom: { tag: { type: "string", max: 200 } },
  });
  const stem = "z".repeat(170);
  let clock = 0;
  const net = createNetwork({ seed: 6, latency: 0 });
  const mediator = createMediator({ manifest, now: () => clock });
  const host = createSession({
    manifest,
    game: {
      init(world, api) {
        if (!api.isHost) return;
        for (let i = 0; i < 400; i++) world.spawn("mob", { x: i, custom: { tag: stem + "-" + i } });
      },
      update() {},
      render() {},
    },
    transport: mediator.wrap(net.endpoint("p0")),
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
  for (let t = 0; t < 30 && !client.joined && !client.ended; t++) {
    host.step();
    client.step();
    net.advance(20);
    clock += 20;
  }
  assert.equal(client.ended, false, client.reason);
  assert.equal(client.joined, true);
  const mobs = client.world.query("mob");
  assert.equal(mobs.length, 400);
  const seen = new Set();
  let payload = 0;
  for (const mob of mobs) {
    const tag = String(mob.custom.tag);
    seen.add(tag);
    payload += tag.length;
  }
  assert.equal(seen.size, 400);
  assert.ok(payload > 65536, "snapshot payload " + payload);
});

test("shared custom stamps keep interning after 4096 distinct values", () => {
  for (let i = 0; i < 4096; i++) customStamp({ n: i });
  const first = customStamp({ n: 9000 });
  const second = customStamp({ n: 9000 });
  assert.equal(first.gen, second.gen);
});

test("a rejected input names the field", () => {
  const warnings = [];
  const manifest = defineManifest({
    maxPlayers: 2,
    inputs: { dx: { type: "int", min: -1, max: 1 } },
  });
  const net = createNetwork({ seed: 5, latency: 0 });
  const host = createSession({
    manifest,
    game: {
      init() {},
      update() {},
      render() {},
      warn(message) {
        warnings.push(message);
      },
    },
    transport: net.endpoint("h"),
    playerId: 0,
    peerId: "h",
    isHost: true,
  });
  host.setInput({ dx: 9 });
  host.step();
  assert.ok(warnings.some((message) => message.includes("dx")));
});

/** @param {number} id @param {string} [text] */
function spawnOf(id, text) {
  const base = defaultState(defineManifest({}).quant);
  const cur = { ...base, custom: text ? { name: text } : {} };
  return encodePacket({ tick: 1, seq: 1 }, [
    { type: "spawn", record: { id, type: "e", version: 0, baseVersion: 0, cur, base } },
  ]);
}

/** @param {{ init?: (world: any, net: any) => void }} [hooks] */
function pair(hooks) {
  const manifest = defineManifest({ maxPlayers: 2, tickHz: 20 });
  const net = createNetwork({ seed: 1, latency: 0 });
  const clientEp = net.endpoint("p1");
  let now = 0;
  const clock = () => now;
  const tickMs = 1000 / manifest.tickHz;
  const host = createSession({
    manifest,
    game: quiet,
    transport: net.endpoint("p0"),
    playerId: 0,
    peerId: "p0",
    isHost: true,
    now: clock,
  });
  const client = createSession({
    manifest,
    game: {
      init: hooks && hooks.init ? hooks.init : () => {},
      update() {},
      render() {},
    },
    transport: clientEp,
    playerId: 1,
    peerId: "p1",
    isHost: false,
    hostPeerId: "p0",
    now: clock,
  });
  return {
    manifest,
    net,
    host,
    client,
    clientEp,
    run(k) {
      for (let i = 0; i < k; i++) {
        now += tickMs;
        host.step();
        client.step();
        net.advance(tickMs);
      }
    },
    hostOnly(k) {
      for (let i = 0; i < k; i++) {
        now += tickMs;
        host.step();
      }
    },
  };
}
