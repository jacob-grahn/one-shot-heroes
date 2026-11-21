/** A simulated peer. Implements the transport interface. */

import { acceptReliable, earliestRetx, onAck, retransmitDue, sendReliable } from "./reliable.js";

/** @param {string} id @param {{ schedule: Function, clock: { now: () => number }, drop: Function, rto?: number }} ctx */
export function createEndpoint(id, ctx) {
  const state = {
    id,
    outbound: new Map(),
    inbound: new Map(),
    /** @type {((from: string, bytes: Uint8Array, reliable: boolean) => void) | null} */
    onMessage: null,
    /** @type {((peerId: string) => void) | null} */
    onLeave: null,
    now: () => ctx.clock.now(),
    schedule: ctx.schedule,
  };
  return {
    id,
    send(to, bytes, reliable) {
      send(state, to, bytes, reliable);
    },
    onMessage(handler) {
      state.onMessage = handler;
    },
    onPeerLeave(handler) {
      state.onLeave = handler;
    },
    close() {
      ctx.drop(id);
    },
    receive(frame) {
      receive(state, frame);
    },
    notifyLeave(peerId) {
      state.onLeave?.(peerId);
    },
    nextRetx() {
      return earliestRetx(state.outbound, ctx.rto || 20);
    },
    retransmit() {
      retransmitDue(state, ctx.rto || 20);
    },
  };
}

/** @param {any} state @param {string} to @param {Uint8Array} bytes @param {boolean} reliable */
function send(state, to, bytes, reliable) {
  const copy = copyBytes(bytes);
  if (!reliable) {
    state.schedule({ kind: "data", from: state.id, to, reliable: false, bytes: copy });
    return;
  }
  sendReliable(state, to, copy);
}

/** @param {any} state @param {any} frame */
function receive(state, frame) {
  if (frame.kind === "ack") return onAck(state, frame);
  if (!frame.reliable) return state.onMessage?.(frame.from, frame.bytes, false);
  acceptReliable(state, frame);
}

/** @param {Uint8Array} bytes */
function copyBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new Error("transport payload must be Uint8Array");
  return new Uint8Array(bytes);
}
