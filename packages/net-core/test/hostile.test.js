import assert from "node:assert/strict";
import test from "node:test";
import { createSession, defineManifest } from "@osh/net-core";
import { createNetwork } from "@osh/net-sim";
import { encodePacket } from "@osh/net-wire";
import { createMediator } from "@osh/net-mediator";
import { rememberRemote } from "../src/input.js";

const dt = 50;

function manifest() {
  return defineManifest({
    maxPlayers: 8,
    inputs: { dx: { type: "int", min: -1, max: 1 } },
    events: {
      chat: { relay: true, msg: { type: "string", max: 80 } },
      local: { note: { type: "string", max: 40 } },
    },
    custom: { inv: { type: "array", max: 8, item: { type: "int", min: 0, max: 9 } } },
  });
}

/** @param {any} [game] @param {number} [n] */
function setup(game, n = 3) {
  const net = createNetwork({ seed: 1 });
  const sessions = [];
  for (let i = 0; i < n; i++) {
    sessions.push(
      createSession({
        manifest: manifest(),
        game: game || quiet(),
        transport: net.endpoint("p" + i),
        playerId: i,
        peerId: "p" + i,
        isHost: i === 0,
        hostPeerId: i ? "p0" : "",
      }),
    );
  }
  const atk = net.endpoint("evil");
  atk.onMessage(() => {});
  const run = (k) => {
    for (let j = 0; j < k; j++) {
      for (const session of sessions) session.step();
      net.advance(dt);
    }
  };
  run(12);
  return { net, sessions, atk, run, host: sessions[0] };
}

function quiet() {
  return { init() {}, update() {}, render() {} };
}

/** @param {any[]} messages */
function pkt(messages) {
  return encodePacket({ tick: 0, flags: 1 }, messages);
}

test("a stranger bye or reject does not end the host", () => {
  const group = setup();
  group.atk.send("p0", pkt([{ type: "bye" }]), true);
  group.run(3);
  assert.equal(group.host.ended, false);
  assert.equal(
    group.sessions.slice(1).every((session) => session.ended === false),
    true,
  );
  group.atk.send("p0", pkt([{ type: "reject", code: 2 }]), true);
  group.run(2);
  assert.equal(group.host.ended, false);
  group.host.close();
  group.run(4);
  assert.equal(
    group.sessions.slice(1).every((session) => session.reason === "host_left"),
    true,
  );
});

test("a joined bye removes that peer and forgets its input", () => {
  const got = [];
  const game = {
    init() {},
    update(_dt, inputs) {
      got.push(inputs[4] ? inputs[4].dx : null);
    },
    render() {},
  };
  const group = setup(game, 2);
  group.atk.send(
    "p0",
    pkt([{ type: "hello", playerId: 4, proto: 1, hash: manifest().hash }]),
    true,
  );
  group.run(3);
  assert.equal(
    group.host.net.players.some((player) => player.id === 4),
    true,
  );
  group.atk.send(
    "p0",
    encodePacket({ tick: 1 }, [
      { type: "input", samples: [{ tick: group.host.tick, values: { dx: 1 } }] },
    ]),
    false,
  );
  group.run(2);
  assert.ok(got.includes(1));
  group.atk.send("p0", pkt([{ type: "bye" }]), true);
  group.run(2);
  assert.equal(group.host.ended, false);
  assert.equal(group.sessions[1].ended, false);
  assert.equal(
    group.host.net.players.some((player) => player.id === 4),
    false,
  );
  const mark = got.length;
  group.atk.send(
    "p0",
    encodePacket({ tick: 1 }, [
      { type: "input", samples: [{ tick: group.host.tick, values: { dx: 1 } }] },
    ]),
    false,
  );
  group.run(2);
  assert.equal(
    got.slice(mark).every((dx) => dx == null),
    true,
  );
});

test("33 spawns in one tick reach the client", () => {
  let burst = 0;
  const game = {
    init() {},
    update(_dt, _inputs, world) {
      for (let i = 0; i < burst; i++) world.spawn("b", { x: i, y: 0 });
      burst = 0;
    },
    render() {},
  };
  const group = setup(game, 2);
  burst = 33;
  assert.doesNotThrow(() => group.run(4));
  assert.equal(group.sessions[1].world.query("b").length, 33);
});

test("36 client events do not crash the host and strings stay user content", () => {
  const group = setup();
  const got = [];
  group.sessions[1].net.on("chat", (payload) => got.push(payload));
  group.sessions[1].net.on("zzz", (payload) => got.push(payload));
  group.atk.send(
    "p0",
    pkt([{ type: "hello", playerId: 4, proto: 1, hash: manifest().hash }]),
    true,
  );
  group.run(4);
  for (let batch = 0; batch < 3; batch++) {
    const events = [];
    for (let i = 1; i <= 12; i++) {
      const id = batch * 12 + i;
      events.push({ type: "event", id, origin: 0, name: "chat", payload: { msg: "a" + id } });
    }
    group.atk.send("p0", pkt(events), true);
  }
  assert.doesNotThrow(() => group.run(4));
  assert.equal(group.host.ended, false);
  assert.equal(got.length, 36);
  assert.equal(got[0].msg.userContent, true);
  assert.equal(got[0].msg.text, "a1");
});

test("undeclared or non-relay events do not fan out", () => {
  const group = setup();
  const got = [];
  group.sessions[1].net.on("zzz", (payload) => got.push(payload));
  group.sessions[1].net.on("local", (payload) => got.push(payload));
  group.atk.send(
    "p0",
    pkt([{ type: "hello", playerId: 4, proto: 1, hash: manifest().hash }]),
    true,
  );
  group.run(3);
  group.atk.send(
    "p0",
    pkt([{ type: "event", id: 1, origin: 4, name: "zzz", payload: { msg: "x", junk: 1 } }]),
    true,
  );
  group.atk.send(
    "p0",
    pkt([{ type: "event", id: 1, origin: 0, name: "local", payload: { note: "secret" } }]),
    true,
  );
  group.run(4);
  assert.deepEqual(got, []);
});

test("a forged event id cannot block the host", () => {
  const group = setup();
  const got = [];
  group.sessions[1].net.on("chat", (payload) => got.push(payload.msg.text || payload.msg));
  group.atk.send(
    "p0",
    pkt([{ type: "hello", playerId: 4, proto: 1, hash: manifest().hash }]),
    true,
  );
  group.run(3);
  group.atk.send(
    "p0",
    pkt([{ type: "event", id: 1, origin: 0, name: "chat", payload: { msg: "spoof" } }]),
    true,
  );
  group.atk.send(
    "p0",
    pkt([{ type: "event", id: 100000, origin: 4, name: "chat", payload: { msg: "far" } }]),
    true,
  );
  group.run(3);
  group.host.net.emit("chat", { msg: "host" });
  group.run(4);
  assert.ok(got.includes("host"));
  assert.equal(got.includes("far"), false);
});

test("future input ticks are discarded", () => {
  const spec = defineManifest({
    inputs: { dx: { type: "int", min: -1, max: 1 } },
    inputRedundancy: 4,
  });
  const session = {
    tick: 20,
    manifest: spec,
    inputLog: new Map(),
  };
  for (let i = 0; i < 500; i++) rememberRemote(session, 3, { tick: 1e6 + i, values: { dx: 1 } });
  rememberRemote(session, 3, { tick: 20, values: { dx: -1 } });
  const bag = session.inputLog.get(3);
  assert.ok(bag.size <= spec.inputRedundancy + 8);
  assert.deepEqual(bag.get(20), { dx: -1 });
  assert.equal(bag.has(1e6), false);
});

test("a NaN focus hint is ignored", () => {
  const group = setup();
  group.atk.send(
    "p0",
    pkt([{ type: "hello", playerId: 4, proto: 1, hash: manifest().hash }]),
    true,
  );
  group.run(3);
  group.atk.send("p0", encodePacket({ tick: 1 }, [{ type: "hint", x: NaN, y: Infinity }]), false);
  assert.doesNotThrow(() => group.run(2));
  assert.equal(group.host.ended, false);
});

test("oversized custom data is rejected at spawn and when it is set", () => {
  const group = setup();
  const huge = {};
  for (let i = 0; i < 16; i++) huge["k" + i] = "x".repeat(80);
  assert.throws(
    () => group.host.world.spawn("blob", { custom: huge }),
    /custom data exceeds 1024 bytes/,
  );
  const blob = group.host.world.spawn("blob", {});
  blob.custom = huge;
  assert.throws(() => group.host.step(), /custom data exceeds the byte budget/);
  assert.equal(group.host.ended, false);
});

test("an oversize event is dropped and does not throw", () => {
  const group = setup();
  const payload = {};
  for (let i = 0; i < 9; i++) payload["k" + i] = "x".repeat(120);
  const bytes = pkt([{ type: "event", id: 1, origin: 4, name: "n".repeat(200), payload }]);
  const verdict = createMediator({ now: () => 0 }).inspect(bytes);
  assert.equal(verdict.ok, false);
  group.atk.send(
    "p0",
    pkt([{ type: "hello", playerId: 4, proto: 1, hash: manifest().hash }]),
    true,
  );
  group.run(3);
  group.atk.send("p0", bytes, true);
  assert.doesNotThrow(() => group.run(2));
  assert.equal(group.host.ended, false);
});

test("nested custom edits are synced", () => {
  let push = false;
  const game = {
    init(world, net) {
      if (net.isHost) world.spawn("bag", { custom: { inv: [1] } });
    },
    update(_dt, _inputs, world) {
      if (!push) return;
      const bag = world.query("bag")[0];
      bag.custom.inv.push(2);
      push = false;
    },
    render() {},
  };
  const group = setup(game, 2);
  push = true;
  group.run(8);
  const inv = group.sessions[1].world.query("bag")[0].custom.inv;
  assert.deepEqual(
    inv.map((item) => item),
    [1, 2],
  );
});
