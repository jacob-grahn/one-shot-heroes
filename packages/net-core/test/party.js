import { createSession } from "@osh/net-core";
import { createNetwork } from "@osh/net-sim";

/** @param {any} options */
export function party(options) {
  const net = createNetwork({
    seed: options.seed ?? 1,
    latency: options.latency ?? 0,
    jitter: options.jitter ?? 0,
    loss: options.loss ?? 0,
    reorder: options.reorder ?? 0,
    duplicate: options.duplicate ?? 0,
  });
  const sessions = [];
  for (let i = 0; i < options.n; i++) sessions.push(open(net, options, i));
  return { net, sessions, host: sessions[0], clients: sessions.slice(1) };
}

/** @param {any} net @param {any} options @param {number} index */
function open(net, options, index) {
  const peerId = "p" + index;
  return createSession({
    manifest: options.manifest,
    game: options.game,
    transport: net.endpoint(peerId),
    playerId: index,
    peerId,
    isHost: index === 0,
    hostPeerId: index === 0 ? "" : "p0",
    trace: options.trace !== false,
    seed: options.gameSeed ?? 1,
    dev: options.dev !== false,
  });
}

/** @param {any} group @param {number} count @param {number} dt @param {(group: any, i: number) => void} [fn] */
export function run(group, count, dt, fn) {
  for (let i = 0; i < count; i++) {
    if (fn) fn(group, i);
    for (const session of group.sessions) session.step();
    group.net.advance(dt);
  }
}

/** @param {any} group @param {number} dt */
export function connect(group, dt) {
  for (let i = 0; i < 120 && group.clients.some((client) => !client.joined); i++) run(group, 1, dt);
  if (group.clients.some((client) => !client.joined)) throw new Error("join timeout");
}

/** @param {any} group @param {number} dt */
export function settle(group, dt) {
  group.net.configure({ loss: 0, latency: 0, jitter: 0, reorder: 0, duplicate: 0 });
  run(group, 60, dt);
}
