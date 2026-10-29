/** Per-recipient baseline, priority, and reliable queue. */

/** @param {string} peerId @param {number} playerId */
export function createPeer(peerId, playerId) {
  return {
    peerId,
    playerId,
    live: false,
    /** @type {any[]} */
    queue: [],
    confirmed: new Map(),
    ver: new Map(),
    acc: new Map(),
    dirtyAt: new Map(),
    sent: new Map(),
    seq: 0,
    recv: new Set(),
    recvMax: 0,
  };
}

/** Link state for the single host a client talks to. */
export function createLink() {
  return { seq: 0, recv: new Set(), recvMax: 0, sent: new Map(), confirmed: new Map() };
}
