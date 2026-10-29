/** In-process network. Latency, jitter, loss, reorder, and duplication are seeded. */

import { createClock } from "./clock.js";
import { createEndpoint } from "./endpoint.js";
import { mulberry32 } from "./rng.js";

/**
 * @param {{
 *   seed?: number, latency?: number, jitter?: number, loss?: number,
 *   reorder?: number, reorderMs?: number, duplicate?: number, dupMs?: number,
 *   rto?: number, clock?: ReturnType<typeof createClock>,
 * }} [opts]
 */
export function createNetwork(opts) {
  const options = opts || {};
  const clock = options.clock || createClock();
  const rand = mulberry32(options.seed ?? 1);
  const ctx = {
    clock,
    rand,
    latency: options.latency ?? 0,
    jitter: options.jitter ?? 0,
    loss: options.loss ?? 0,
    reorder: options.reorder ?? 0,
    reorderMs: options.reorderMs ?? 40,
    duplicate: options.duplicate ?? 0,
    dupMs: options.dupMs ?? 5,
    rto: options.rto ?? defaultRto(options),
    pinRto: options.rto != null,
    /** @type {any[]} */
    lane: [],
    seq: 0,
    /** @type {Map<string, ReturnType<typeof createEndpoint>>} */
    peers: new Map(),
    schedule(frame) {
      schedule(ctx, frame);
    },
    drop(id) {
      dropPeer(ctx, id);
    },
  };
  return {
    clock,
    endpoint(id) {
      return addPeer(ctx, id);
    },
    advance(ms) {
      advance(ctx, ms);
    },
    configure(next) {
      configure(ctx, next || {});
    },
  };
}

/** @param {Record<string, any>} options */
function defaultRto(options) {
  return Math.max(20, (options.latency ?? 0) * 2 + (options.jitter ?? 0) + 10);
}

/** @param {any} ctx @param {string} id */
function addPeer(ctx, id) {
  if (ctx.peers.has(id)) throw new Error("duplicate peer " + id);
  const endpoint = createEndpoint(id, ctx);
  ctx.peers.set(id, endpoint);
  return endpoint;
}

/** @param {any} ctx @param {string} id */
function dropPeer(ctx, id) {
  ctx.peers.delete(id);
  for (const endpoint of ctx.peers.values()) endpoint.notifyLeave(id);
}

/** @param {any} ctx @param {any} frame */
function schedule(ctx, frame) {
  if (ctx.rand() < ctx.loss) return;
  const delay = delayOf(ctx);
  enqueue(ctx, frame, delay);
  if (ctx.rand() < ctx.duplicate) enqueue(ctx, frame, delay + ctx.dupMs);
}

/** @param {any} ctx */
function delayOf(ctx) {
  let delay = ctx.latency + (ctx.rand() * 2 - 1) * ctx.jitter;
  if (delay < 0) delay = 0;
  if (ctx.rand() < ctx.reorder) delay += ctx.reorderMs;
  return delay;
}

/** @param {any} ctx @param {any} frame @param {number} delay */
function enqueue(ctx, frame, delay) {
  ctx.seq += 1;
  const bytes = frame.bytes ? new Uint8Array(frame.bytes) : undefined;
  ctx.lane.push({ at: ctx.clock.now() + delay, n: ctx.seq, frame: { ...frame, bytes } });
}

/** @param {any} ctx @param {number} ms */
function advance(ctx, ms) {
  const end = ctx.clock.now() + ms;
  for (let guard = 0; guard < 100000; guard++) {
    const due = nextDue(ctx, end);
    if (due === null) break;
    ctx.clock.set(due);
    deliverDue(ctx, due);
    for (const endpoint of ctx.peers.values()) endpoint.retransmit(ctx.rto);
  }
  ctx.clock.set(end);
}

/** @param {any} ctx @param {number} end */
function nextDue(ctx, end) {
  let due = /** @type {number | null} */ (null);
  for (const item of ctx.lane) if (item.at <= end && (due === null || item.at < due)) due = item.at;
  for (const endpoint of ctx.peers.values()) {
    const at = endpoint.nextRetx(ctx.rto);
    if (at != null && at <= end && (due === null || at < due)) due = at;
  }
  return due;
}

/** @param {any} ctx @param {number} now */
function deliverDue(ctx, now) {
  const ready = ctx.lane.filter((item) => item.at <= now);
  ctx.lane = ctx.lane.filter((item) => item.at > now);
  ready.sort((a, b) => a.at - b.at || a.n - b.n);
  for (const item of ready) {
    const endpoint = ctx.peers.get(item.frame.to);
    if (endpoint) endpoint.receive(item.frame);
  }
}

/** @param {any} ctx @param {Record<string, number>} next */
function configure(ctx, next) {
  const keys = ["latency", "jitter", "loss", "reorder", "reorderMs", "duplicate", "dupMs"];
  for (const key of keys) if (next[key] != null) ctx[key] = next[key];
  if (!ctx.pinRto) ctx.rto = Math.max(20, ctx.latency * 2 + ctx.jitter + 10);
}
