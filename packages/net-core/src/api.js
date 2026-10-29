/** The `net` object passed into init, update, and render. */

import { emitEvent, onEvent } from "./events.js";

/** @param {any} s */
export function createNet(s) {
  return {
    get isHost() {
      return s.isHost;
    },
    get me() {
      return s.playerId;
    },
    get players() {
      return s.players.map((player) => ({ id: player.id, host: player.host }));
    },
    get time() {
      return s.clockTick() / s.manifest.tickHz;
    },
    get tick() {
      return s.clockTick();
    },
    random() {
      return s.rng();
    },
    emit(name, payload) {
      emitEvent(s, name, payload);
    },
    on(name, fn) {
      onEvent(s, name, fn);
    },
    setFocus(playerId, x, y) {
      setFocus(s, playerId, x, y);
    },
    setFocusHint(x, y) {
      setHint(s, x, y);
    },
  };
}

/** @param {any} s @param {number} playerId @param {number} x @param {number} y */
function setFocus(s, playerId, x, y) {
  if (!s.isHost) throw new Error("setFocus is host-only");
  s.focus.set(playerId, point(x, y));
}

/** @param {any} s @param {number} x @param {number} y */
function setHint(s, x, y) {
  s.hint = point(x, y);
  if (s.isHost) s.hints.set(s.playerId, s.hint);
}

/** @param {number} x @param {number} y */
function point(x, y) {
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    throw new Error("focus needs finite coordinates");
  }
  return { x, y };
}
