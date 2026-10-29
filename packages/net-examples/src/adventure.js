/** Vote-driven text adventure. Focus mode is none: relevance is uniform. */

import { defineManifest } from "@osh/net-core";

export const manifest = defineManifest({
  maxPlayers: 2,
  focus: "none",
  inputs: { vote: { type: "int", min: 0, max: 2 } },
  custom: {
    text: { type: "string", max: 80 },
    chapter: { type: "int", min: 0, max: 9 },
  },
  events: { chapter: { chapter: { type: "int", min: 0, max: 9 } } },
});

/** @param {any} world @param {any} net */
export function init(world, net) {
  if (!net.isHost) return;
  world.spawn("story", { custom: { text: "A door.", chapter: 0 } });
}

/** @param {number} _dt @param {Record<string, any>} inputs @param {any} world @param {any} net */
export function update(_dt, inputs, world, net) {
  const story = world.query("story")[0];
  if (!story || story.custom.chapter !== 0) return;
  if (votesFor(inputs, net, 1) !== net.players.length) return;
  story.custom.chapter = 1;
  story.custom.text = "The door opens.";
  net.emit("chapter", { chapter: 1 });
}

/** @param {Record<string, any>} inputs @param {any} net @param {number} want */
function votesFor(inputs, net, want) {
  let count = 0;
  for (const player of net.players) {
    const input = inputs[player.id];
    if (input && input.vote === want) count += 1;
  }
  return count;
}

/** @param {any} state @param {number} _alpha @param {(line: string) => void} draw */
export function render(state, _alpha, draw) {
  const story = state.entities.find((entity) => entity.type === "story");
  if (story) draw(plain(story.custom.text));
}

/** @param {any} value */
function plain(value) {
  return typeof value === "string" ? value : value.text;
}
