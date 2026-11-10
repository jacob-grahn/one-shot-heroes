/** A simulated room: one network and a peer endpoint per seat. Sessions stay in the game. */

import { createNetwork } from "./network.js";

/** @param {{ seed?: number, latency?: number, jitter?: number, loss?: number, reorder?: number, duplicate?: number }} [options] */
export function createRoom(options) {
  const opts = options || {};
  const net = createNetwork({
    seed: opts.seed ?? 1,
    latency: opts.latency ?? 0,
    jitter: opts.jitter ?? 0,
    loss: opts.loss ?? 0,
    reorder: opts.reorder ?? 0,
    duplicate: opts.duplicate ?? 0,
  });
  return {
    net,
    endpoint(index) {
      return net.endpoint("p" + index);
    },
    advance(ms) {
      net.advance(ms);
    },
    configure(next) {
      net.configure(next || {});
    },
  };
}
