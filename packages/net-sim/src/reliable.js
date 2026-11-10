/** Reliable-ordered send, receive, and retransmission for one endpoint. */

/** @param {Map<string, any>} lanes @param {string} key @param {() => any} make */
export function lane(lanes, key, make) {
  let found = lanes.get(key);
  if (!found) {
    found = make();
    lanes.set(key, found);
  }
  return found;
}

/** @param {any} state @param {string} to @param {Uint8Array} bytes */
export function sendReliable(state, to, bytes) {
  const out = lane(state.outbound, to, () => ({ seq: 0, unacked: new Map() }));
  out.seq += 1;
  const frame = { kind: "data", from: state.id, to, reliable: true, seq: out.seq, bytes };
  out.unacked.set(out.seq, { frame, sentAt: state.now() });
  state.schedule(frame);
}

/** @param {any} state @param {any} frame */
export function acceptReliable(state, frame) {
  const inbound = lane(state.inbound, frame.from, () => ({ next: 1, buf: new Map() }));
  if (frame.seq >= inbound.next) inbound.buf.set(frame.seq, frame);
  drain(state, inbound, frame.from);
  state.schedule({ kind: "ack", from: state.id, to: frame.from, ack: inbound.next - 1 });
}

/** @param {any} state @param {{ next: number, buf: Map<number, any> }} inbound @param {string} from */
function drain(state, inbound, from) {
  while (inbound.buf.has(inbound.next)) {
    const frame = inbound.buf.get(inbound.next);
    inbound.buf.delete(inbound.next);
    inbound.next += 1;
    state.onMessage?.(from, frame.bytes, true);
  }
}

/** @param {any} state @param {any} frame */
export function onAck(state, frame) {
  const out = state.outbound.get(frame.from);
  if (!out) return;
  for (const seq of [...out.unacked.keys()]) {
    if (seq <= frame.ack) out.unacked.delete(seq);
  }
}

/** @param {Map<string, any>} outbound @param {number} rto */
export function earliestRetx(outbound, rto) {
  const wait = Math.max(1, rto);
  let due = /** @type {number | null} */ (null);
  for (const out of outbound.values()) due = sooner(due, out, wait);
  return due;
}

/** @param {number | null} due @param {any} out @param {number} rto */
function sooner(due, out, rto) {
  let next = due;
  for (const slot of out.unacked.values()) {
    const at = slot.sentAt + rto;
    if (next === null || at < next) next = at;
  }
  return next;
}

/** @param {any} state @param {number} rto */
export function retransmitDue(state, rto) {
  const now = state.now();
  const wait = Math.max(1, rto);
  for (const out of state.outbound.values()) retransmitLane(state, out, now, wait);
}

/** @param {any} state @param {any} out @param {number} now @param {number} rto */
function retransmitLane(state, out, now, rto) {
  for (const slot of out.unacked.values()) {
    if (now - slot.sentAt < rto) continue;
    slot.sentAt = now;
    state.schedule(slot.frame);
  }
}
