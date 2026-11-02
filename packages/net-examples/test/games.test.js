import assert from "node:assert/strict";
import test from "node:test";
import { animFrame } from "@osh/net-core";
import {
  adventureInit,
  adventureManifest,
  adventureRender,
  adventureUpdate,
  dotsInit,
  dotsManifest,
  dotsRender,
  dotsUpdate,
} from "@osh/net-examples";
import { connect, party, run, settle } from "../../net-core/test/party.js";

const dt = 1000 / 20;

test("dots arena stays in sync and derives animation frames", () => {
  const game = { init: dotsInit, update: dotsUpdate, render: dotsRender };
  const group = party({
    manifest: dotsManifest,
    game,
    n: 2,
    seed: 5,
    loss: 0.15,
    latency: 20,
    jitter: 5,
    reorder: 0.2,
  });
  connect(group, dt);
  run(group, 30, dt, (g) => {
    g.host.setInput({ dx: 1, dy: 0 });
    g.clients[0].setInput({ dx: 0, dy: 1 });
  });
  settle(group, dt);
  assert.equal(group.clients[0].digest(), group.host.digest());
  const hostDot = group.host.world.query("dot").find((dot) => dot.custom.owner === 0);
  const clientDot = group.clients[0].world.query("dot").find((dot) => owner(dot) === 0);
  assert.equal(hostDot.anim, 1);
  assert.equal(clientDot.anim, 1);
  assert.equal(
    animFrame(hostDot.animStart, group.host.tick, 4, dotsManifest.tickHz),
    animFrame(clientDot.animStart, group.host.tick, 4, dotsManifest.tickHz),
  );
  const drawn = [];
  group.clients[0].render((cmd) => drawn.push(cmd));
  assert.ok(drawn.length >= 2);
  assert.ok(group.host.stats.maxPacket <= dotsManifest.budget);
});

test("vote-driven adventure delivers one chapter event and user-content text", () => {
  const game = { init: adventureInit, update: adventureUpdate, render: adventureRender };
  const group = party({
    manifest: adventureManifest,
    game,
    n: 2,
    seed: 3,
    loss: 0.2,
    latency: 15,
    reorder: 0.3,
  });
  const chapters = [];
  group.clients[0].net.on("chapter", (payload) => chapters.push(payload.chapter));
  connect(group, dt);
  run(group, 20, dt, (g) => {
    g.host.setInput({ vote: 1 });
    g.clients[0].setInput({ vote: 1 });
  });
  settle(group, dt);
  assert.equal(group.clients[0].digest(), group.host.digest());
  const story = group.clients[0].world.query("story")[0];
  assert.equal(story.custom.chapter, 1);
  assert.equal(story.custom.text.userContent, true);
  assert.equal(story.custom.text.text, "The door opens.");
  assert.deepEqual(chapters, [1]);
  const lines = [];
  group.clients[0].render((line) => lines.push(line));
  assert.deepEqual(lines, ["The door opens."]);
});

/** @param {any} dot */
function owner(dot) {
  const value = dot.custom.owner;
  return typeof value === "number" ? value : Number(value.text);
}
