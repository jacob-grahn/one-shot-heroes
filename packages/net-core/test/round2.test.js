import assert from "node:assert/strict";
import test from "node:test";
import { createSession, defineManifest } from "@osh/net-core";
import { createNetwork } from "@osh/net-sim";
import { encodePacket } from "@osh/net-wire";
import { createMediator } from "@osh/net-mediator";
import { rememberRemote } from "../src/input.js";

const quiet = { init() {}, update() {}, render() {} };

function manifest() {
  return defineManifest({
    maxPlayers: 8,
    inputs: { dx: { type: "int", min: -1, max: 1 } },
    events: { chat: { relay: true, msg: { type: "string", max: 1000 } } },
  });
}

/** @param {any} [game] @param {any} [spec] @param {boolean} [useMediator] */
function setup(game = quiet, spec = manifest(), useMediator = false) {
  let clock = 0;
  const net = createNetwork({ seed: 1, latency: 0 });
  const dropped = [];
  /** @type {any} */
  let host = null;
  const mediator = useMediator
    ? createMediator({
        now: () => clock,
        manifest: spec,
        onDisconnect(peer, code) {
          dropped.push(peer + ":" + code);
          if (host) host.dropPeer(peer);
        },
      })
    : null;
  const sessions = [];
  for (let i = 0; i < 3; i++) {
    const endpoint = net.endpoint("p" + i);
    sessions.push(
      createSession({
        manifest: spec,
        game,
        transport: i === 0 && mediator ? mediator.wrap(endpoint) : endpoint,
        playerId: i,
        peerId: "p" + i,
        isHost: i === 0,
        hostPeerId: i ? "p0" : "",
        trace: true,
      }),
    );
  }
  host = sessions[0];
  const atk = net.endpoint("evil");
  atk.onMessage(() => {});
  const run = (k) => {
    for (let j = 0; j < k; j++) {
      for (const session of sessions) session.step();
      net.advance(50);
      clock += 50;
    }
  };
  run(12);
  return { net, sessions, atk, run, host, mediator, dropped, spec, clock: () => clock };
}

/** @param {any[]} messages */
function pkt(messages) {
  return encodePacket({ tick: 0, flags: 1 }, messages);
}

/** @param {any} group @param {number} id @param {any} [ep] */
function join(group, id, ep = group.atk) {
  ep.send("p0", pkt([{ type: "hello", playerId: id, proto: 2, hash: group.spec.hash }]), true);
  group.run(3);
}

test("a rejoin with the same playerId delivers the new events", () => {
  const group = setup();
  const ep2 = group.net.endpoint("evil2");
  ep2.onMessage(() => {});
  join(group, 5);
  const got = [];
  group.sessions[1].net.on("chat", (payload) => got.push(payload.msg.text));
  const hostGot = [];
  group.host.net.on("chat", (payload) => hostGot.push(payload.msg.text));
  for (let i = 1; i <= 3; i++) {
    group.atk.send(
      "p0",
      pkt([{ type: "event", id: i, origin: 5, name: "chat", payload: { msg: "old" + i } }]),
      true,
    );
  }
  group.run(3);
  group.atk.send("p0", pkt([{ type: "bye" }]), true);
  group.run(3);
  join(group, 5, ep2);
  ep2.send(
    "p0",
    pkt([{ type: "event", id: 1, origin: 5, name: "chat", payload: { msg: "new1" } }]),
    true,
  );
  group.run(4);
  assert.deepEqual(got, ["old1", "old2", "old3", "new1"]);
  assert.deepEqual(hostGot, ["old1", "old2", "old3", "new1"]);
});

test("custom data over 1024 bytes is rejected at the assignment", () => {
  const group = setup();
  const blob = group.host.world.spawn("blob", {});
  group.run(2);
  assert.throws(() => {
    blob.custom = { s: "x".repeat(1190) };
  }, /custom data exceeds 1024 bytes/);
  assert.equal(Object.keys(blob.custom).length, 0);
  const late = group.net.endpoint("late");
  late.onMessage(() => {});
  assert.doesNotThrow(() => {
    group.run(2);
    join(group, 6, late);
  });
  assert.equal(group.sessions[1].world.query("blob").length, 1);
  assert.equal(group.host.ended, false);
});

test("ids past 65535 are delivered and are not reused", () => {
  let burst = 0;
  const game = {
    init() {},
    update(_dt, _inputs, world) {
      for (let i = 0; i < burst; i++) {
        const entity = world.spawn("b", { x: 1 });
        world.despawn(entity);
      }
      if (burst) world.spawn("live", { x: 5 });
      burst = 0;
    },
    render() {},
  };
  const group = setup(game, defineManifest({ maxPlayers: 2 }), false);
  burst = 65540;
  assert.doesNotThrow(() => group.run(1));
  group.run(6);
  const host = group.host.world.query("live");
  const client = group.sessions[1].world.query("live");
  assert.equal(host.length, 1);
  assert.equal(client.length, 1);
  assert.equal(client[0].id, host[0].id);
  assert.ok(host[0].id > 65535);
  const next = group.host.world.spawn("live", { x: 1 });
  assert.equal(next.id, host[0].id + 1);
});

test("relayed events are charged to the sender", () => {
  const group = setup(quiet, manifest(), true);
  const ep2 = group.net.endpoint("evil2");
  ep2.onMessage(() => {});
  group.host.world.spawn("mob", { x: 3, y: 4 });
  join(group, 5);
  join(group, 6, ep2);
  for (let t = 0; t < 40; t++) {
    group.atk.send(
      "p0",
      pkt([
        { type: "event", id: t + 1, origin: 5, name: "chat", payload: { msg: "m".repeat(950) } },
      ]),
      true,
    );
    ep2.send(
      "p0",
      pkt([
        { type: "event", id: t + 1, origin: 6, name: "chat", payload: { msg: "m".repeat(950) } },
      ]),
      true,
    );
    group.run(1);
  }
  assert.ok(group.dropped.length > 0);
  group.run(8);
  assert.equal(group.sessions[1].world.query("mob").length, 1);
});

test("inputs survive a round trip longer than the redundancy window", () => {
  const spec = defineManifest({
    maxPlayers: 2,
    inputs: { dx: { type: "int", min: -1, max: 1 } },
    inputRedundancy: 4,
    tickHz: 20,
  });
  const seen = [];
  const game = {
    init() {},
    update(_dt, inputs) {
      seen.push(inputs[1] ? inputs[1].dx : null);
    },
    render() {},
  };
  const net = createNetwork({ seed: 2, latency: 500 });
  const sessions = [0, 1].map((i) =>
    createSession({
      manifest: spec,
      game,
      transport: net.endpoint("p" + i),
      playerId: i,
      peerId: "p" + i,
      isHost: i === 0,
      hostPeerId: i ? "p0" : "",
    }),
  );
  for (let t = 0; t < 50; t++) {
    sessions[1].setInput({ dx: 1 });
    for (const session of sessions) session.step();
    net.advance(50);
  }
  assert.ok(seen.includes(1));
  const late = { tick: 100, manifest: spec, inputLog: new Map() };
  rememberRemote(late, 1, { tick: 59, values: { dx: 1 } });
  rememberRemote(late, 1, { tick: 60, values: { dx: 1 } });
  rememberRemote(late, 1, { tick: 104, values: { dx: 1 } });
  rememberRemote(late, 1, { tick: 105, values: { dx: 1 } });
  const bag = late.inputLog.get(1);
  assert.equal(bag.has(59), false);
  assert.equal(bag.has(60), true);
  assert.equal(bag.has(104), true);
  assert.equal(bag.has(105), false);
});

test("dropPeer forgets the mediator lane so a later peer can join", () => {
  const spec = defineManifest({ maxPlayers: 8 });
  const net = createNetwork({ seed: 4, latency: 0 });
  const mediator = createMediator({ now: () => 0 });
  const host = createSession({
    manifest: spec,
    game: quiet,
    transport: mediator.wrap(net.endpoint("p0")),
    playerId: 0,
    peerId: "p0",
    isHost: true,
  });
  const client = createSession({
    manifest: spec,
    game: quiet,
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
  assert.equal(client.joined, true);
  for (let i = 0; i < 63; i++) {
    const result = mediator.inspect(
      encodePacket({ tick: 1, flags: 1 }, [
        { type: "hello", playerId: i + 2, proto: 2, hash: "abcd" },
      ]),
      { peer: "x" + i, dir: "in", reliable: true },
    );
    assert.equal(result.ok, true);
  }
  const blocked = mediator.inspect(
    encodePacket({ tick: 1, flags: 1 }, [{ type: "hello", playerId: 200, proto: 2, hash: "abcd" }]),
    { peer: "extra", dir: "in", reliable: true },
  );
  assert.equal(blocked.code, "lanes");
  host.dropPeer("p1");
  const opened = mediator.inspect(
    encodePacket({ tick: 1, flags: 1 }, [{ type: "hello", playerId: 200, proto: 2, hash: "abcd" }]),
    { peer: "extra", dir: "in", reliable: true },
  );
  assert.equal(opened.ok, true);
});

test("spawn refuses entity 401 instead of disconnecting clients", () => {
  const spec = defineManifest({ maxPlayers: 2, maxEntities: 2 });
  const net = createNetwork({ seed: 5, latency: 0 });
  const host = createSession({
    manifest: spec,
    game: quiet,
    transport: net.endpoint("h"),
    playerId: 0,
    peerId: "h",
    isHost: true,
  });
  const client = createSession({
    manifest: spec,
    game: quiet,
    transport: net.endpoint("c"),
    playerId: 1,
    peerId: "c",
    isHost: false,
    hostPeerId: "h",
  });
  for (let t = 0; t < 6; t++) {
    host.step();
    client.step();
    net.advance(20);
  }
  host.world.spawn("a", {});
  host.world.spawn("b", {});
  assert.throws(() => host.world.spawn("c", {}), /entity cap is 2/);
  assert.doesNotThrow(() => host.step());
  assert.equal(host.ended, false);
  assert.equal(client.ended, false);
  assert.equal(host.world.query().length, 2);
  host.world.despawn(host.world.query()[0]);
  assert.doesNotThrow(() => host.world.spawn("d", {}));
  assert.equal(host.world.query().length, 2);
});

test("an oversize nested custom edit does not abort the host step", () => {
  const warnings = [];
  let armed = false;
  const game = {
    init(world, net) {
      if (net.isHost) world.spawn("blob", { custom: { inv: [1] } });
    },
    update(_dt, _inputs, world) {
      if (!armed) return;
      const blob = world.query("blob")[0];
      blob.x = 4;
      blob.custom.inv.push("y".repeat(2000));
      armed = false;
    },
    render() {},
    warn(message) {
      warnings.push(message);
    },
  };
  const group = setup(game);
  const blob = group.host.world.query("blob")[0];
  assert.throws(() => blob.custom.inv.push("y".repeat(2000)), /custom data exceeds 1024/);
  assert.equal(blob.custom.inv.length, 1);
  armed = true;
  const tick = group.host.tick;
  assert.doesNotThrow(() => group.run(1));
  assert.ok(group.host.tick > tick);
  assert.equal(blob.custom.inv.length, 1);
  assert.equal(blob.x, 4);
  assert.ok(warnings.some((message) => message.includes("partial")));
  assert.equal(group.host.ended, false);
});

test("entity ids stop at 2^32", () => {
  const spec = defineManifest({ maxPlayers: 2 });
  const net = createNetwork({ seed: 9, latency: 0 });
  const host = createSession({
    manifest: spec,
    game: quiet,
    transport: net.endpoint("h"),
    playerId: 0,
    peerId: "h",
    isHost: true,
    idStart: 0xffffffff,
  });
  const client = createSession({
    manifest: spec,
    game: quiet,
    transport: net.endpoint("c"),
    playerId: 1,
    peerId: "c",
    isHost: false,
    hostPeerId: "h",
  });
  for (let t = 0; t < 6; t++) {
    host.step();
    client.step();
    net.advance(20);
  }
  const last = host.world.spawn("a", {});
  assert.equal(last.id, 0xffffffff);
  assert.throws(() => host.world.spawn("b", {}), /entity ids exhausted/);
  assert.equal(host.ended, true);
  assert.equal(host.reason, "ids");
  net.advance(20);
  client.step();
  assert.equal(client.ended, true);
  assert.equal(client.reason, "host_left");
});

test("the host picks a random seed when the page does not", () => {
  const spec = defineManifest({ maxPlayers: 2 });
  const net = createNetwork({ seed: 3, latency: 0 });
  const make = (peer, host) =>
    createSession({
      manifest: spec,
      game: quiet,
      transport: net.endpoint(peer),
      playerId: host ? 0 : 1,
      peerId: peer,
      isHost: host,
      hostPeerId: host ? "" : "h",
    });
  const host = make("h", true);
  const other = createSession({
    manifest: spec,
    game: quiet,
    transport: { send() {}, onMessage() {} },
    playerId: 0,
    peerId: "other",
    isHost: true,
  });
  const client = make("c", false);
  for (let t = 0; t < 6; t++) {
    host.step();
    client.step();
    net.advance(20);
  }
  assert.equal(client.joined, true);
  const hostDraw = host.net.random();
  assert.equal(client.net.random(), hostDraw);
  assert.notEqual(other.net.random(), hostDraw);
});
