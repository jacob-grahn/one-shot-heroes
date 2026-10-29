/** One quantize per entity per tick, then a sized priority select and a single encode. */

import { ackHeader, nextSeq, rememberSent } from "./ack.js";
import { avatarFocus, relevance } from "./focus.js";
import { emit } from "./relay.js";
import { planPackets } from "./select.js";
import {
  EMPTY,
  MSG,
  PROTOCOL,
  createSink,
  customOps,
  diffMask,
  encodeOps,
  fillQuant,
  updateBytes,
  writeUpdate,
} from "./wire.js";

const text = new TextEncoder();

/** @param {any} s */
export function refreshSlots(s) {
  const t = performance.now();
  const quant = s.manifest.quant;
  const list = s.world.live();
  for (let i = 0; i < list.length; i++) fillOne(s, list[i], quant);
  s.stats.phases.diff += performance.now() - t;
}

/** @param {any} s @param {any} entity @param {any} quant */
function fillOne(s, entity, quant) {
  if (entity.local) return;
  let slot = s.slots.get(entity.id);
  if (!slot) {
    slot = { custom: EMPTY };
    s.slots.set(entity.id, slot);
  }
  fillQuant(slot, entity, quant);
}

/** @param {any} s @param {any} peer */
export function sendDirty(s, peer) {
  const dirty = collect(s, peer);
  const t = performance.now();
  const packets = planPackets(dirty, s.manifest.starvationK, s.manifest.budget);
  s.stats.phases.priority += performance.now() - t;
  for (const group of packets) writeGroup(s, peer, group);
}

/** @param {any} s @param {any} peer */
function collect(s, peer) {
  const t = performance.now();
  const dirty = [];
  const list = s.world.live();
  for (let i = 0; i < list.length; i++) {
    const item = consider(s, peer, list[i]);
    if (item) dirty.push(item);
  }
  s.stats.phases.diff += performance.now() - t;
  score(s, peer, dirty);
  return dirty;
}

/** @param {any} s @param {any} peer @param {any} entity */
function consider(s, peer, entity) {
  if (entity.local) return null;
  const cur = s.slots.get(entity.id);
  const conf = peer.confirmed.get(entity.id);
  if (!cur || !conf) return null;
  const mask = diffMask(cur, conf.q);
  if (!mask) {
    peer.dirtyAt.delete(entity.id);
    return null;
  }
  if (!peer.dirtyAt.has(entity.id)) peer.dirtyAt.set(entity.id, s.tick);
  const customLen = mask & 64 ? customSize(cur, conf.q) : 0;
  return itemOf(entity, cur, conf, {
    age: s.tick - peer.dirtyAt.get(entity.id),
    size: updateBytes(mask, customLen),
  });
}

/** @param {any} entity @param {any} cur @param {any} conf @param {{ age: number, size: number }} meta */
function itemOf(entity, cur, conf, meta) {
  return {
    id: entity.id,
    entity,
    cur,
    base: conf.q,
    baseVersion: conf.version,
    age: meta.age,
    size: meta.size,
    pri: 0,
  };
}

/** @param {any} cur @param {any} base */
function customSize(cur, base) {
  const w = counter();
  encodeOps(w, customOps(cur.custom, base.custom));
  return w.n;
}

function counter() {
  return {
    n: 0,
    u8() {
      this.n += 1;
    },
    u16() {
      this.n += 2;
    },
    u32() {
      this.n += 4;
    },
    i32() {
      this.n += 4;
    },
    f32() {
      this.n += 4;
    },
    bytes(u) {
      this.n += u.length;
    },
    str16(s) {
      this.n += 2 + text.encode(s).length;
    },
  };
}

/** @param {any} s @param {any} peer @param {any[]} dirty */
function score(s, peer, dirty) {
  const focus = focusFor(s, peer.playerId);
  const ctx = { dt: 1 / s.manifest.tickHz, k: s.manifest.starvationK, s };
  const t = performance.now();
  for (let i = 0; i < dirty.length; i++) dirty[i].rel = gridOf(s, dirty[i].entity, focus);
  s.stats.phases.grid += performance.now() - t;
  const p = performance.now();
  for (let i = 0; i < dirty.length; i++) dirty[i].pri = bump(peer, dirty[i], ctx);
  s.stats.phases.priority += performance.now() - p;
}

/** @param {any} s @param {any} entity @param {any} focus */
function gridOf(s, entity, focus) {
  return relevance(s.manifest.focus, entity, focus, s.manifest.cell);
}

/** @param {any} peer @param {any} item @param {{ dt: number, k: number, s: any }} ctx */
function bump(peer, item, ctx) {
  const acc = (peer.acc.get(item.id) || 0) + priorityOf(ctx.s, item.entity.type) * item.rel * ctx.dt;
  peer.acc.set(item.id, acc);
  return item.age >= ctx.k ? 1e12 + item.age : acc;
}

/** @param {any} s @param {number} playerId */
function focusFor(s, playerId) {
  if (s.manifest.focus === "none") return null;
  if (s.manifest.focus === "game") return s.focus.get(playerId) || { x: 0, y: 0 };
  return avatarFocus(findAvatar(s, playerId), s.hints.get(playerId), s.manifest.focusClamp);
}

/** @param {any} s @param {number} playerId */
function findAvatar(s, playerId) {
  const key = s.manifest.avatarOwnerKey;
  const list = s.world.live();
  for (let i = 0; i < list.length; i++) {
    const entity = list[i];
    if (entity.type === s.manifest.avatarType && entity.custom && entity.custom[key] === playerId)
      return entity;
  }
  return null;
}

/** @param {any} s @param {string} type */
function priorityOf(s, type) {
  const spec = s.manifest.types[type];
  const pri = spec && spec.priority;
  return typeof pri === "number" && pri > 0 ? pri : 1;
}

/** @param {any} s @param {any} peer @param {any[]} group */
function writeGroup(s, peer, group) {
  const records = [];
  const ents = [];
  const alloc = performance.now();
  for (const item of group) {
    records.push(commit(s, peer, item));
    ents.push({ id: item.id, version: item.version, full: freeze(item.cur) });
  }
  s.stats.phases.alloc += performance.now() - alloc;
  const sink = s.sink || (s.sink = createSink(4096));
  const seq = nextSeq(peer);
  const enc = performance.now();
  const bytes = writePacket(sink, headOf(s, peer, seq), records);
  s.stats.phases.encode += performance.now() - enc;
  if (bytes.length > s.manifest.budget) throw new Error("packet exceeds byte budget");
  emit(s, peer.peerId, bytes, { ids: idsOf(records) });
  rememberSent(peer, seq, ents);
}

/** @param {any[]} records */
function idsOf(records) {
  const ids = [];
  for (const rec of records) ids.push(rec.id);
  return ids;
}

/** @param {any} s @param {any} peer @param {any} item */
function commit(s, peer, item) {
  const version = (peer.ver.get(item.id) || 0) + 1;
  peer.ver.set(item.id, version);
  peer.acc.set(item.id, 0);
  peer.dirtyAt.set(item.id, s.tick);
  item.version = version;
  return { id: item.id, version, baseVersion: item.baseVersion, cur: item.cur, base: item.base };
}

/** @param {any} slot */
function freeze(slot) {
  return {
    x: slot.x,
    y: slot.y,
    rotation: slot.rotation,
    scale: slot.scale,
    anim: slot.anim,
    animStart: slot.animStart,
    custom: slot.custom === EMPTY ? EMPTY : slot.custom,
  };
}

/** @param {any} s @param {any} peer @param {number} seq */
function headOf(s, peer, seq) {
  const ack = ackHeader(peer);
  return { tick: s.tick >>> 0, seq, ack: ack.ack, bits: ack.ackBits >>> 0 };
}

/** @param {any} sink @param {{ tick: number, seq: number, ack: number, bits: number }} head @param {any[]} records */
function writePacket(sink, head, records) {
  sink.reset();
  sink.u8(PROTOCOL);
  sink.u8(0);
  sink.u32(head.tick);
  sink.u16(head.seq);
  sink.u16(head.ack);
  sink.u32(head.bits);
  sink.u8(1);
  sink.u8(MSG.state);
  const at = sink.length;
  sink.u16(0);
  const start = sink.length;
  sink.u16(records.length);
  for (const rec of records) writeUpdate(sink, rec);
  sink.patchU16(at, sink.length - start);
  return sink.finish();
}
