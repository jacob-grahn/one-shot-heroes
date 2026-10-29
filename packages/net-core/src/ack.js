/** Unreliable sequence numbers and a 32-packet ack window. Seq 0 is reserved. */

/** @param {{ seq: number }} peer */
export function nextSeq(peer) {
  peer.seq = (peer.seq + 1) & 65535;
  if (peer.seq === 0) peer.seq = 1;
  return peer.seq;
}

/** @param {{ recv: Set<number>, recvMax: number }} peer @param {number} seq */
export function noteRecv(peer, seq) {
  if (!seq) return;
  peer.recv.add(seq);
  if (isNewer(seq, peer.recvMax)) peer.recvMax = seq;
  for (const old of [...peer.recv]) {
    if (behind(peer.recvMax, old) > 64) peer.recv.delete(old);
  }
}

/** @param {{ recv: Set<number>, recvMax: number }} peer */
export function ackHeader(peer) {
  const ack = peer.recvMax;
  let bits = 0;
  for (let i = 1; i <= 32; i++) {
    const seq = (ack - i) & 65535;
    if (seq && peer.recv.has(seq)) bits |= 1 << (i - 1);
  }
  return { ack, ackBits: bits >>> 0 };
}

/** @param {number} ack @param {number} bits */
export function seqsFromAck(ack, bits) {
  const out = [];
  if (ack) out.push(ack & 65535);
  for (let i = 1; i <= 32; i++) {
    if ((bits & (1 << (i - 1))) !== 0) out.push((ack - i) & 65535);
  }
  return out;
}

/** @param {{ sent: Map<number, any>, confirmed: Map<number, any> }} peer @param {number} ack @param {number} bits */
export function confirmSent(peer, ack, bits) {
  if (!peer.sent) return;
  for (const seq of seqsFromAck(ack, bits)) applySeq(peer, seq);
}

/** @param {{ sent: Map<number, any>, confirmed: Map<number, any> }} peer @param {number} seq */
function applySeq(peer, seq) {
  const pkt = peer.sent.get(seq);
  if (!pkt) return;
  for (const ent of pkt.ents) advance(peer, ent);
  peer.sent.delete(seq);
}

/** @param {{ confirmed: Map<number, any> }} peer @param {{ id: number, version: number, full: any }} ent */
function advance(peer, ent) {
  const cur = peer.confirmed.get(ent.id);
  if (cur && ent.version < cur.version) return;
  peer.confirmed.set(ent.id, { version: ent.version, q: ent.full });
}

/** @param {any} peer @param {number} seq @param {any[]} ents */
export function rememberSent(peer, seq, ents) {
  peer.sent.set(seq, { ents });
  for (const old of [...peer.sent.keys()]) {
    if (behind(seq, old) > 64) peer.sent.delete(old);
  }
}

/** @param {number} seq @param {number} max */
function isNewer(seq, max) {
  if (!max) return true;
  return seq !== max && ((seq - max) & 65535) < 32768;
}

/** @param {number} newer @param {number} older */
function behind(newer, older) {
  return (newer - older) & 65535;
}
