import assert from "node:assert/strict";
import test from "node:test";
import { createSession, defineManifest } from "@osh/net-core";
import { createNetwork } from "@osh/net-sim";
import { createMediator } from "@osh/net-mediator";

test("mediator in front of an 8-player 300-entity session lets everyone converge", () => {
  const manifest = defineManifest({ maxPlayers: 8 });
  let move = true;
  const game = {
    init(world, net) {
      if (!net.isHost) return;
      for (let i = 0; i < 300; i++)
        world.spawn("mob", { x: (i % 25) * 3, y: Math.floor(i / 25) * 3 });
    },
    update(_dt, _inputs, world) {
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
  const net = createNetwork({ seed: 1 });
  const mediator = createMediator({ now: () => clock });
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
  for (let t = 0; t < 40; t++) {
    for (const session of sessions) session.step();
    net.advance(50);
    clock += 50;
  }
  move = false;
  for (let t = 0; t < 40; t++) {
    for (const session of sessions) session.step();
    net.advance(50);
    clock += 50;
  }
  assert.equal(
    sessions.slice(1).every((session) => session.joined),
    true,
  );
  for (const session of sessions.slice(1)) assert.equal(session.digest(), sessions[0].digest());
  assert.equal(sessions[0].world.query("mob").length, 300);
  const reliable = mediator.violations.filter((code) => code === "bytes" || code === "spawn_rate");
  assert.deepEqual(reliable, []);
});
