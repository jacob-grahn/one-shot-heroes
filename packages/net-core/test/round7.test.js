import assert from "node:assert/strict";
import test from "node:test";
import { createMediator } from "../../net-mediator/src/mediate.js";
import { createNetwork } from "../../net-sim/src/network.js";
import { defineManifest } from "../../net-wire/src/manifest.js";
import { encodePacket, isFrozenRefusal } from "../../net-wire/src/packet.js";
import { createSession } from "../src/session.js";

const quiet = { init() {}, update() {}, render() {} };

test("a quiet world stops uploading, and A to B to A still converges", () => {
  const group = duo();
  group.run(8);
  const box = group.host.world.query("box")[0];
  box.x = 8;
  group.run(4);
  box.x = 0;
  group.run(12);
  assert.equal(group.client.digest(), group.host.digest());
  const before = group.host.stats.bytes;
  group.run(30);
  assert.equal(group.host.stats.bytes, before);
  assert.equal(group.client.world.query("box")[0].x, 0);
});

test("protocol 8 through the mediator ends the mismatched client with version", () => {
  const seen = foreignPair(8);
  seen.run(20);
  assert.equal(seen.stranger.ended, true);
  assert.equal(seen.stranger.reason, "version");
  assert.equal(seen.host.ended, false);
  assert.equal(seen.refusal, true);
  const back = foreignPair(3, 8);
  back.run(20);
  assert.equal(back.stranger.ended, true);
  assert.equal(back.stranger.reason, "version");
  assert.equal(back.host.ended, false);
});

test("a non-JSON custom write is reverted and the host keeps stepping", () => {
  const group = duo();
  group.run(4);
  const box = group.host.world.query("box")[0];
  assert.throws(() => {
    box.custom.tag = undefined;
  }, /JSON/);
  assert.equal(box.custom.tag, "ok");
  assert.throws(() => {
    box.custom.tag = NaN;
  }, /range|JSON/);
  assert.equal(box.custom.tag, "ok");
  assert.throws(() => {
    box.custom.tag = () => 1;
  });
  assert.equal(box.custom.tag, "ok");
  const hole = [1, 0, 2];
  delete hole[1];
  assert.throws(() => {
    box.custom.nums = hole;
  });
  assert.equal(box.custom.nums, undefined);
  assert.doesNotThrow(() => group.run(6));
  const late = group.net.endpoint("p2");
  const joiner = createSession({
    manifest: group.manifest,
    game: quiet,
    transport: late,
    playerId: 2,
    peerId: "p2",
    isHost: false,
    hostPeerId: "p0",
    now: group.clock,
  });
  for (let i = 0; i < 8; i++) {
    group.now += 50;
    group.host.step();
    joiner.step();
    group.net.advance(50);
  }
  assert.equal(joiner.joined, true);
  assert.equal(joiner.ended, false);
});

test("a lossy hello retry does not trip the join limit", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const manifest = defineManifest({ maxPlayers: 3, tickHz: 20, silenceMs: 30000 });
    const net = createNetwork({ seed, latency: 600, jitter: 300, loss: 0.4 });
    const mediator = createMediator({
      onDisconnect(peerId) {
        host.dropPeer(peerId);
      },
    });
    const sessions = [0, 1, 2].map((index) =>
      createSession({
        manifest,
        game: quiet,
        transport: index === 0 ? mediator.wrap(net.endpoint("p0")) : net.endpoint("p" + index),
        playerId: index,
        peerId: "p" + index,
        isHost: index === 0,
        hostPeerId: index === 0 ? "" : "p0",
      }),
    );
    const host = sessions[0];
    for (let i = 0; i < 400 && sessions.some((session, n) => n > 0 && !session.joined); i++) {
      for (const session of sessions) session.step();
      net.advance(50);
    }
    for (const session of sessions) {
      assert.equal(session.ended, false, "seed " + seed + " " + session.reason);
      assert.equal(session.joined, true, "seed " + seed);
    }
  }
});

test("a catch-up burst does not drop a live peer", () => {
  const group = duo();
  group.run(6);
  const frozen = group.now;
  for (let i = 0; i < 400; i++) group.host.step();
  assert.equal(group.now, frozen);
  assert.equal(group.client.ended, false);
  group.host.world.spawn("late", { x: 3 });
  group.run(8);
  assert.equal(group.client.world.query("late").length, 1);
  assert.notEqual(group.client.reason, "dropped");
});

test("render and event strings stringify", () => {
  const manifest = defineManifest({
    maxPlayers: 2,
    custom: { name: { type: "string", max: 20 } },
    events: { chat: { relay: true, msg: { type: "string", max: 20 } } },
  });
  let rendered = "";
  let heard = "";
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
    game: {
      init(_w, api) {
        api.on("chat", (payload) => {
          heard = `${payload.msg}`;
        });
      },
      update() {},
      render(view) {
        const mob = view.entities.find((entity) => entity.type === "mob");
        if (mob) rendered = `${mob.custom.name}`;
      },
    },
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
  client.render();
  assert.equal(rendered, "ada");
  host.net.emit("chat", { msg: "hi" });
  host.step();
  net.advance(20);
  client.step();
  assert.equal(heard, "hi");
});

test("a throwing onEnd does not escape step", () => {
  const warnings = [];
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
  const client = createSession({
    manifest,
    game: {
      init(_w, api) {
        api.onEnd(() => {
          throw new Error("end broke");
        });
      },
      update() {},
      render() {},
      warn(message) {
        warnings.push(message);
      },
    },
    transport: net.endpoint("p1"),
    playerId: 1,
    peerId: "p1",
    isHost: false,
    hostPeerId: "p0",
  });
  for (let i = 0; i < 6; i++) {
    host.step();
    client.step();
    net.advance(20);
  }
  host.dropPeer("p1");
  net.advance(20);
  assert.doesNotThrow(() => client.step());
  assert.equal(client.reason, "dropped");
  assert.ok(warnings.some((message) => message.includes("end broke")));
});

test("staleness follows the last acked version", () => {
  const manifest = defineManifest({ maxPlayers: 2, tickHz: 20, starvationK: 8 });
  const net = createNetwork({ seed: 2, latency: 0 });
  const raw = net.endpoint("p0");
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
        if (reliable) raw.send(to, bytes, reliable);
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
  host.world.query("box")[0].x = 6;
  for (let i = 0; i < 24; i++) {
    client.setInput({});
    host.step();
    client.step();
    net.advance(20);
  }
  assert.ok(host.stats.staleness > manifest.starvationK);
  const frozen = createNetwork({ seed: 3, latency: 0 });
  const alone = createSession({
    manifest,
    game: {
      init(world, api) {
        if (api.isHost) world.spawn("box", { x: 0 });
      },
      update() {},
      render() {},
    },
    transport: frozen.endpoint("h"),
    playerId: 0,
    peerId: "h",
    isHost: true,
  });
  const quietPeer = createSession({
    manifest,
    game: quiet,
    transport: frozen.endpoint("c"),
    playerId: 1,
    peerId: "c",
    isHost: false,
    hostPeerId: "h",
  });
  for (let i = 0; i < 6; i++) {
    alone.step();
    quietPeer.step();
    frozen.advance(20);
  }
  for (let i = 0; i < 30; i++) alone.step();
  alone.world.query("box")[0].x = 4;
  for (let i = 0; i < 20; i++) alone.step();
  assert.ok(alone.stats.staleness > manifest.starvationK);
});

test("onPeerLeave uses playerId and skips a hello that never joined", () => {
  const group = duo();
  const left = [];
  group.host.net.onPeerLeave((info) => left.push(info));
  group.run(4);
  const extra = group.net.endpoint("p9");
  extra.send("p0", hello(2, group.manifest.hash), true);
  group.net.advance(20);
  group.host.step();
  assert.equal(left.length, 0);
  group.host.dropPeer("p1");
  assert.equal(left.length, 1);
  assert.equal(left[0].playerId, 1);
  assert.equal(left[0].reason, "dropped");
});

test("a client gives up on a silent host", () => {
  const manifest = defineManifest({ maxPlayers: 2, tickHz: 20, joinTimeoutMs: 1000 });
  const net = createNetwork({ seed: 1, latency: 0 });
  const client = createSession({
    manifest,
    game: quiet,
    transport: net.endpoint("c"),
    playerId: 1,
    peerId: "c",
    isHost: false,
    hostPeerId: "h",
  });
  const limit = Math.ceil((manifest.silenceMs / 1000) * manifest.tickHz) + 2;
  for (let i = 0; i < limit; i++) client.step();
  assert.equal(client.ended, true);
  assert.equal(client.reason, "timeout");
});

/** @param {number} remote @param {number} [local] */
function foreignPair(remote, local) {
  const manifest = defineManifest({ maxPlayers: 2 });
  const net = createNetwork({ seed: 1, latency: 0 });
  const mediator = createMediator({ now: () => 0 });
  let refusal = false;
  const hostEp = speak(mediator.wrap(net.endpoint("p0")), local || 3, (bytes) => {
    if (isFrozenRefusal(bytes) || bytes[0] !== (local || 3)) refusal = true;
  });
  const host = createSession({
    manifest,
    game: quiet,
    transport: hostEp,
    playerId: 0,
    peerId: "p0",
    isHost: true,
  });
  const stranger = createSession({
    manifest,
    game: quiet,
    transport: speak(net.endpoint("p1"), remote, () => {}),
    playerId: 1,
    peerId: "p1",
    isHost: false,
    hostPeerId: "p0",
  });
  return {
    host,
    stranger,
    get refusal() {
      return refusal;
    },
    run(k) {
      for (let i = 0; i < k; i++) {
        host.step();
        stranger.step();
        net.advance(20);
      }
    },
  };
}

/** @param {any} ep @param {number} version @param {(bytes: Uint8Array) => void} see */
function speak(ep, version, see) {
  return {
    send(to, bytes, reliable) {
      const copy = new Uint8Array(bytes);
      copy[0] = version;
      ep.send(to, copy, reliable);
    },
    onMessage(handler) {
      ep.onMessage((from, bytes, reliable) => {
        see(bytes);
        if (bytes[0] === version) {
          handler(from, bytes, reliable);
          return;
        }
        const foreign = new Uint8Array(bytes);
        foreign[0] = version === 3 ? 8 : 3;
        handler(from, foreign, reliable);
      });
    },
    onPeerLeave(handler) {
      if (ep.onPeerLeave) ep.onPeerLeave(handler);
    },
    forget(peerId) {
      if (ep.forget) ep.forget(peerId);
    },
  };
}

function duo() {
  const manifest = defineManifest({
    maxPlayers: 4,
    tickHz: 20,
    custom: { tag: { type: "string", max: 8 } },
  });
  const net = createNetwork({ seed: 1, latency: 0 });
  let now = 0;
  const clock = () => now;
  const host = createSession({
    manifest,
    game: {
      init(world, api) {
        if (api.isHost) world.spawn("box", { x: 0, custom: { tag: "ok" } });
      },
      update() {},
      render() {},
    },
    transport: net.endpoint("p0"),
    playerId: 0,
    peerId: "p0",
    isHost: true,
    now: clock,
  });
  const client = createSession({
    manifest,
    game: quiet,
    transport: net.endpoint("p1"),
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
    clock,
    get now() {
      return now;
    },
    set now(value) {
      now = value;
    },
    run(k) {
      for (let i = 0; i < k; i++) {
        now += 50;
        host.step();
        client.step();
        net.advance(50);
      }
    },
  };
}

/** @param {number} playerId @param {string} hash */
function hello(playerId, hash) {
  return encodePacket({ tick: 1, flags: 1 }, [{ type: "hello", playerId, proto: 4, hash }]);
}
