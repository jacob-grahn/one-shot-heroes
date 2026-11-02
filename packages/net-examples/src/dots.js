/** Two-player dots. The host moves each avatar from that player's input. */

import { defineManifest } from "@osh/net-core";

export const manifest = defineManifest({
  maxPlayers: 2,
  focus: "avatar",
  avatarType: "dot",
  avatarOwnerKey: "owner",
  inputs: {
    dx: { type: "int", min: -1, max: 1 },
    dy: { type: "int", min: -1, max: 1 },
  },
  custom: { owner: { type: "int", min: 0, max: 7 } },
  types: { dot: { priority: 1 } },
});

export function init() {}

/** @param {number} dt @param {Record<string, any>} inputs @param {any} world @param {any} net */
export function update(dt, inputs, world, net) {
  reap(world, net);
  ensure(world, net);
  for (const dot of world.query("dot")) stepDot(dot, inputs[dot.custom.owner], dt);
}

/** @param {any} world @param {any} net */
function reap(world, net) {
  for (const dot of world.query("dot")) {
    if (!net.players.some((player) => player.id === dot.custom.owner)) world.despawn(dot);
  }
}

/** @param {any} world @param {any} net */
function ensure(world, net) {
  const dots = world.query("dot");
  for (const player of net.players) {
    if (!dots.some((dot) => dot.custom.owner === player.id)) spawnDot(world, player.id);
  }
}

/** @param {any} world @param {number} id */
function spawnDot(world, id) {
  world.spawn("dot", { x: id * 8, y: 0, custom: { owner: id } });
}

/** @param {any} dot @param {any} input @param {number} dt */
function stepDot(dot, input, dt) {
  if (!input) return;
  dot.x += input.dx * 40 * dt;
  dot.y += input.dy * 40 * dt;
  const moving = input.dx !== 0 || input.dy !== 0;
  const next = moving ? 1 : 0;
  if (dot.anim !== next) dot.anim = next;
}

/** @param {any} state @param {number} alpha @param {(cmd: any) => void} draw */
export function render(state, alpha, draw) {
  for (const entity of state.entities) draw(dotCmd(entity, alpha));
}

/** @param {any} entity @param {number} alpha */
function dotCmd(entity, alpha) {
  return {
    id: entity.id,
    x: entity.x,
    y: entity.y,
    anim: entity.anim,
    animStart: entity.animStart,
    alpha,
  };
}
