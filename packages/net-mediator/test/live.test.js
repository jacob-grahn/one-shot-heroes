import assert from "node:assert/strict";
import test from "node:test";
import { createSession, defineManifest } from "@osh/net-core";
import { createNetwork } from "@osh/net-sim";
import { createMediator } from "@osh/net-mediator";

test("mediator in front of an 8-player 400-entity session survives loss and churn", () => {
  const manifest = defineManifest({ maxPlayers: 8 });
  let move = true;
  let churn = false;
  const game = {
    init(world, net) {
      if (!net.isHost) return;
      for (let i = 0; i < 400; i++)
        world.spawn("mob", { x: (i % 25) * 3, y: Math.floor(i / 25) * 3 });
    },
    update(_dt, _inputs, world) {
      const mobs = world.query("mob");
      if (churn && mobs[0]) {
        world.despawn(mobs[0]);
        world.spawn("mob", { x: mobs.length, y: 1 });
      }
      if (!move) return;
      let n = 0;
      for (const entity of world.query("mob")) {
        if (n % 10 < 3) entity.x += 0.25;
        n += 1;
      }
    },
    render() {},
  };
  let clock = 0;
  const dropped = [];
  /** @type {any} */
  let host = null;
  const net = createNetwork({
    seed: 1,
    loss: 0.05,
    latency: 20,
    jitter: 15,
    reorder: 0.3,
    reorderMs: 30,
  });
  const mediator = createMediator({
    now: () => clock,
    manifest,
    onDisconnect(peer, code) {
      dropped.push(peer + ":" + code);
      if (host) host.dropPeer(peer);
    },
  });
  const sessions = [];
  for (let i = 0; i < 8; i++) {
    const endpoint = net.endpoint("p" + i);
    sessions.push(
      createSession({
        manifest,
        game,
        transport: i === 0 ? mediator.wrap(endpoint) : endpoint,
        playerId: i,
        peerId: "p" + i,
        isHost: i === 0,
        hostPeerId: i ? "p0" : "",
      }),
    );
  }
  host = sessions[0];
  for (let t = 0; t < 40; t++) round(sessions, net, () => (clock += 50));
  churn = true;
  for (let t = 0; t < 45; t++) round(sessions, net, () => (clock += 50));
  churn = false;
  move = false;
  for (let t = 0; t < 300; t++) round(sessions, net, () => (clock += 50));
  assert.equal(
    sessions.slice(1).every((session) => session.joined),
    true,
  );
  for (const session of sessions.slice(1)) assert.equal(session.digest(), host.digest());
  assert.equal(host.world.query("mob").length, 400);
  assert.deepEqual(mediator.violations, []);
  assert.deepEqual(dropped, []);
});

/** @param {any[]} sessions @param {any} net @param {() => void} tick */
function round(sessions, net, tick) {
  for (const session of sessions) session.step();
  net.advance(50);
  tick();
}
