import assert from "node:assert/strict";
import test from "node:test";
import { animFrame, blend, clampFocus, createSession, defineManifest } from "@osh/net-core";
import { createNetwork } from "@osh/net-sim";
import { encodePacket } from "@osh/net-wire";
import { connect, party, run, settle } from "./party.js";

const dt = 50;

test("anim frames follow the 15 fps clock", () => {
  assert.equal(animFrame(0, 0, 4, 15), 0);
  assert.equal(animFrame(0, 5, 4, 15), 1);
  assert.equal(animFrame(0, 4, 4, 20), 3);
  assert.equal(animFrame(2, 2, 8, 20), 0);
});

test("interpolation snaps across a teleport and lerps short moves", () => {
  const rest = { y: 0, rotation: 0, scale: 1, anim: 0, animStart: 0, custom: {} };
  const snapped = blend(
    [
      { tick: 0, x: 0, ...rest },
      { tick: 1, x: 100, ...rest },
    ],
    0.5,
    48,
  );
  assert.equal(snapped.x, 100);
  const mid = blend(
    [
      { tick: 0, x: 0, ...rest },
      { tick: 1, x: 10, ...rest },
    ],
    0.5,
    48,
  );
  assert.equal(mid.x, 5);
  const clamped = clampFocus({ x: 0, y: 0 }, { x: 1000, y: 0 }, 64);
  assert.ok(Math.abs(clamped.x - 64) < 1e-6);
});

test("random is seeded and render state is read-only", () => {
  const manifest = defineManifest({});
  const seen = [];
  const game = {
    init() {},
    update() {},
    render(state) {
      seen.push(state);
      state.entities.push({});
    },
  };
  const dummy = { send() {}, onMessage() {} };
  const first = createSession({
    manifest,
    game,
    transport: dummy,
    isHost: true,
    playerId: 0,
    seed: 4,
  });
  const second = createSession({
    manifest,
    game,
    transport: { send() {}, onMessage() {} },
    isHost: true,
    playerId: 0,
    seed: 4,
  });
  assert.equal(first.net.random(), second.net.random());
  assert.throws(() => first.render(() => {}), /read-only/);
});

test("only the host runs update, and clients cannot spawn networked entities", () => {
  let updates = 0;
  const manifest = defineManifest({ inputs: { dx: { type: "int", min: -1, max: 1 } } });
  const game = {
    init(world, net) {
      if (net.isHost) world.spawn("box", { x: 1, y: 2 });
    },
    update() {
      updates += 1;
    },
    render() {},
  };
  const group = party({ manifest, game, n: 2, loss: 0.2, latency: 10, seed: 3 });
  connect(group, dt);
  const before = updates;
  run(group, 5, dt);
  assert.equal(updates - before, 5);
  assert.throws(() => group.clients[0].world.spawn("nope", {}), /only the host/);
  group.clients[0].world.spawn("spark", { x: 9 }, { local: true });
  settle(group, dt);
  assert.equal(group.clients[0].digest(), group.host.digest());
  assert.equal(group.host.world.query("spark").length, 0);
  assert.ok(group.host.stats.maxPacket <= manifest.budget);
});

test("after quiescence every client matches the host", () => {
  for (let seed = 1; seed <= 8; seed++) {
    const manifest = boxManifest();
    const game = boxGame();
    const group = party({
      manifest,
      game,
      n: 2,
      seed,
      loss: 0.05 * (seed % 5),
      latency: 12,
      jitter: 6,
      reorder: 0.25,
      duplicate: 0.1,
    });
    connect(group, dt);
    run(group, 24, dt, (g, i) => {
      g.host.setInput({ dx: ((i + seed) % 3) - 1 });
      g.clients[0].setInput({ dx: (seed + i) % 2 === 0 ? 1 : -1 });
    });
    settle(group, dt);
    assert.equal(group.clients[0].digest(), group.host.digest(), "seed " + seed);
    assert.ok(group.host.stats.maxPacket <= manifest.budget, "budget seed " + seed);
  }
});

test("a late joiner gets exactly the full state", () => {
  const manifest = boxManifest();
  const game = boxGame();
  const group = party({ manifest, game, n: 2, seed: 4, latency: 8, loss: 0.1 });
  connect(group, dt);
  run(group, 12, dt, (g, i) => g.host.setInput({ dx: i % 2 === 0 ? 1 : -1 }));
  const late = createSession({
    manifest,
    game,
    transport: group.net.endpoint("p2"),
    playerId: 2,
    peerId: "p2",
    isHost: false,
    hostPeerId: "p0",
    trace: true,
  });
  group.sessions.push(late);
  group.clients.push(late);
  connect(group, dt);
  settle(group, dt);
  assert.equal(late.digest(), group.host.digest());
  assert.equal(group.clients[0].digest(), group.host.digest());
});

test("spawn and despawn survive loss", () => {
  let mode = "hold";
  const manifest = boxManifest();
  const game = {
    init(world, net) {
      if (net.isHost) world.spawn("box", { x: 0, y: 0, custom: { n: 1 } });
    },
    update(_dt, _inputs, world) {
      if (mode === "spawn") world.spawn("ghost", { x: 4, y: 4, custom: { n: 2 } });
      if (mode === "despawn") {
        const ghost = world.query("ghost")[0];
        if (ghost) world.despawn(ghost);
      }
    },
    render() {},
  };
  const group = party({
    manifest,
    game,
    n: 2,
    seed: 6,
    loss: 0.35,
    latency: 15,
    reorder: 0.4,
    duplicate: 0.2,
  });
  connect(group, dt);
  mode = "spawn";
  run(group, 1, dt);
  mode = "hold";
  run(group, 8, dt);
  mode = "despawn";
  run(group, 1, dt);
  mode = "hold";
  settle(group, dt);
  assert.equal(group.clients[0].digest(), group.host.digest());
  assert.equal(group.host.world.query("ghost").length, 0);
  assert.equal(group.clients[0].world.query("ghost").length, 0);
});

test("events are delivered once, in order", () => {
  const manifest = defineManifest({
    events: { ping: { n: { type: "int", min: 0, max: 20 } } },
  });
  const game = { init() {}, update() {}, render() {} };
  const group = party({
    manifest,
    game,
    n: 2,
    seed: 2,
    loss: 0.3,
    latency: 10,
    reorder: 0.7,
    duplicate: 0.4,
  });
  const got = [];
  const echoed = [];
  group.clients[0].net.on("ping", (payload) => got.push(payload.n));
  group.host.net.on("ping", (payload) => echoed.push(payload.n));
  connect(group, dt);
  for (let n = 1; n <= 5; n++) group.host.net.emit("ping", { n });
  group.clients[0].net.emit("ping", { n: 9 });
  run(group, 30, dt);
  assert.deepEqual(got, [9, 1, 2, 3, 4, 5]);
  assert.deepEqual(echoed, [1, 2, 3, 4, 5, 9]);
});

test("invalid inputs never reach update", () => {
  const manifest = defineManifest({ inputs: { dx: { type: "int", min: -1, max: 1 } } });
  const seen = [];
  const game = {
    init() {},
    update(_dt, inputs) {
      seen.push(inputs[1] ?? null);
    },
    render() {},
  };
  const net = createNetwork({ seed: 1, latency: 0 });
  const host = createSession({
    manifest,
    game,
    transport: net.endpoint("h"),
    isHost: true,
    playerId: 0,
    peerId: "h",
  });
  const raw = net.endpoint("c");
  raw.send(
    "h",
    encodePacket({ tick: 0 }, [{ type: "hello", playerId: 1, proto: 1, hash: manifest.hash }]),
    true,
  );
  for (let i = 0; i < 5; i++) {
    host.step();
    net.advance(dt);
  }
  assert.equal(host.net.players.length, 2);
  raw.send("h", inputPacket(99), false);
  host.step();
  net.advance(dt);
  host.step();
  assert.equal(seen.at(-1), null);
  raw.send("h", inputPacket(1), false);
  host.step();
  net.advance(dt);
  host.step();
  assert.equal(seen.at(-1).dx, 1);
});

test("a hash mismatch ends the join", () => {
  const hostManifest = defineManifest({ custom: { a: { type: "int", min: 0, max: 1 } } });
  const clientManifest = defineManifest({ custom: { b: { type: "int", min: 0, max: 1 } } });
  const game = { init() {}, update() {}, render() {} };
  const net = createNetwork({ seed: 1, latency: 0 });
  const host = createSession({
    manifest: hostManifest,
    game,
    transport: net.endpoint("h"),
    isHost: true,
    playerId: 0,
    peerId: "h",
  });
  const client = createSession({
    manifest: clientManifest,
    game,
    transport: net.endpoint("c"),
    isHost: false,
    playerId: 1,
    peerId: "c",
    hostPeerId: "h",
  });
  for (let i = 0; i < 6; i++) {
    host.step();
    client.step();
    net.advance(dt);
  }
  assert.equal(client.ended, true);
  assert.equal(client.reason, "hash");
});

test("the session ends when the host leaves", () => {
  const manifest = boxManifest();
  const group = party({ manifest, game: boxGame(), n: 2 });
  connect(group, dt);
  group.host.close();
  run(group, 6, dt);
  assert.equal(group.clients[0].ended, true);
  assert.equal(group.clients[0].reason, "host_left");
});

test("nothing starves and no packet exceeds the budget", () => {
  const manifest = defineManifest({
    maxPlayers: 2,
    budget: 96,
    starvationK: 2,
    focus: "none",
    tickHz: 20,
    custom: { n: { type: "int", min: 0, max: 20 } },
  });
  let bump = false;
  const game = {
    init(world, net) {
      if (!net.isHost) return;
      for (let i = 0; i < 5; i++) world.spawn("box", { x: i * 4, y: 1, custom: { n: i } });
    },
    update(_dt, _inputs, world) {
      if (!bump) return;
      for (const box of world.query("box")) box.x += 1;
    },
    render() {},
  };
  const group = party({ manifest, game, n: 2, trace: true });
  connect(group, dt);
  const mark = group.host.stats.sends.length;
  bump = true;
  run(group, 1, dt);
  const dirtyTick = group.host.tick;
  run(group, 3, dt);
  const first = new Map();
  for (const packet of group.host.stats.sends.slice(mark)) {
    assert.ok(packet.bytes <= manifest.budget);
    for (const id of packet.ids) if (!first.has(id)) first.set(id, packet.tick);
  }
  for (let id = 1; id <= 5; id++) {
    assert.ok(first.has(id), "unsent " + id);
    assert.ok(first.get(id) - dirtyTick <= manifest.starvationK);
  }
  assert.ok(group.host.stats.maxPacket <= manifest.budget);
});

test("all three focus modes order relevance", () => {
  const none = focusOrder("none", () => {});
  assert.equal(none[0], 1);
  assert.ok(none.includes(4));
  const game = focusOrder("game", (group) => group.host.net.setFocus(1, 0, 0));
  assert.equal(game[0], 2);
  const avatar = focusOrder("avatar", (group) => group.clients[0].net.setFocusHint(900, 0));
  assert.equal(avatar[0], 2);
});

/** @param {string} mode @param {(group: any) => void} setup */
function focusOrder(mode, setup) {
  const manifest = defineManifest({
    maxPlayers: 2,
    focus: mode,
    avatarType: "dot",
    avatarOwnerKey: "owner",
    budget: 64,
    starvationK: 100,
    tickHz: 20,
    custom: { owner: { type: "int", min: 0, max: 7 } },
  });
  let live = false;
  const game = {
    init(world, net) {
      if (!net.isHost) return;
      world.spawn("prop", { x: 700, y: 0, custom: { owner: 0 } });
      world.spawn("dot", { x: 0, y: 0, custom: { owner: 1 } });
      world.spawn("prop", { x: 8, y: 0, custom: { owner: 0 } });
      world.spawn("box", { x: 4, y: 0, custom: { owner: 0 } });
    },
    update(_dt, _inputs, world) {
      if (!live) return;
      for (const entity of world.query()) entity.x += 0.1;
    },
    render() {},
  };
  const group = party({ manifest, game, n: 2, trace: true });
  connect(group, dt);
  setup(group);
  run(group, 2, dt);
  live = true;
  const mark = group.host.stats.sends.length;
  run(group, 6, dt);
  const order = [];
  for (const packet of group.host.stats.sends.slice(mark)) {
    if (packet.ids && packet.ids.length) order.push(packet.ids[0]);
  }
  return order;
}

function boxManifest() {
  return defineManifest({
    maxPlayers: 4,
    inputs: { dx: { type: "int", min: -1, max: 1 } },
    custom: { n: { type: "int", min: 0, max: 20 } },
  });
}

function boxGame() {
  return {
    init(world, net) {
      if (!net.isHost) return;
      for (let i = 0; i < 3; i++) world.spawn("box", { x: i, y: 0, custom: { n: i } });
    },
    update(dt, inputs, world) {
      const input = inputs[0];
      if (!input) return;
      for (const box of world.query("box")) box.x += input.dx * dt * 8;
    },
    render() {},
  };
}

/** @param {number} dx */
function inputPacket(dx) {
  const samples = [];
  for (let tick = 0; tick <= 8; tick++) samples.push({ tick, values: { dx } });
  return encodePacket({ tick: 1, seq: 1 }, [{ type: "input", samples }]);
}
