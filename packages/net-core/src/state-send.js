/** One quantize per entity per tick, then a sized priority select and a single encode. */

import { ackHeader, nextSeq, rememberSent } from "./ack.js";
import { avatarFocus, relevance } from "./focus.js";
import { acceptedCustom, commitCustom, isCustomDirty } from "./entity.js";
import { emit } from "./relay.js";
import { planPackets } from "./select.js";
import {
  EMPTY,
  MSG,
  PROTOCOL,
  createSink,
  checkValue,
  customDeltaLen,
  customStamp,
  diffMask,
  fillPose,
  updateBytes,
  writeUpdate,
} from "./wire.js";

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
  const fresh = !slot;
  if (!slot) {
    slot = { custom: EMPTY };
    s.slots.set(entity.id, slot);
  }
  const prev = slot.custom;
  const pose = poseOf(slot);
  fillPose(slot, entity, quant);
  if (fresh || isCustomDirty(entity)) keepCustom(s, slot, entity, prev);
  if (fresh || poseChanged(pose, slot) || slot.custom !== prev) slot.rev = (slot.rev || 0) + 1;
  slot.plan = null;
}

/** @param {any} slot */
function poseOf(slot) {
  return [slot.x, slot.y, slot.rotation, slot.scale, slot.anim, slot.animStart];
}

/** @param {number[]} pose @param {any} slot */
function poseChanged(pose, slot) {
  return (
    pose[0] !== slot.x ||
    pose[1] !== slot.y ||
    pose[2] !== slot.rotation ||
    pose[3] !== slot.scale ||
    pose[4] !== slot.anim ||
    pose[5] !== slot.animStart
  );
}

/** Size-check and copy custom only after a write. Unchanged entities keep the last snapshot. */
function keepCustom(s, slot, entity, prev) {
  let verdict = "skip";
  try {
    verdict = commitCustom(entity, prev);
  } catch (err) {
    s.stats.customReverted = (s.stats.customReverted || 0) + 1;
    warnRevert(s, err);
    try {
      entity.custom = acceptedCustom(entity);
    } catch (again) {
      void again;
    }
    return;
  }
  if (verdict === "same") return;
  if (verdict === "empty") {
    slot.custom = EMPTY;
    return;
  }
  if (verdict === "reverted") s.stats.customReverted += 1;
  slot.custom = acceptedCustom(entity);
  reviewCustom(s, entity);
}

/** @param {any} s @param {unknown} err */
function warnRevert(s, err) {
  const message = err instanceof Error ? err.message : String(err);
  const warn = s.game && s.game.warn;
  const text = "custom write reverted: " + message;
  if (s.dev && typeof warn === "function") warn(text);
  else if (s.dev) console.warn(text);
}

/** @param {any} s @param {any} entity */
function reviewCustom(s, entity) {
  if (!s.dev || !entity || entity.local) return;
  const warn = s.game && s.game.warn;
  if (typeof warn !== "function") return;
  const fields = s.manifest.custom || [];
  const custom = entity.custom || {};
  for (const key of Object.keys(custom)) warnField(warn, fields, key, custom[key]);
}

/** @param {(message: string) => void} warn @param {any[]} fields @param {string} key @param {unknown} value */
function warnField(warn, fields, key, value) {
  const field = fields.find((item) => item.name === key);
  if (!field) {
    warn("undeclared custom key " + key);
    return;
  }
  if (!checkValue(field, value, 0)) warn("custom field " + key + " is outside the schema");
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
  const acked = peer.confirmed.get(entity.id);
  if (!cur || !acked || held(peer, entity.id, cur.rev)) return null;
  if (quiet(s, peer, { id: entity.id, cur, q: acked.q, ackVer: acked.version || 0 })) return null;
  return dirtyItem(s, peer, entity, cur);
}

/** @param {any} peer @param {number} id @param {number} rev */
function held(peer, id, rev) {
  if (!peer.ackRev) peer.ackRev = new Map();
  return peer.ackRev.get(id) === rev;
}

/** True when this description is already sent and not yet due for a retry. */
function quiet(s, peer, bag) {
  if (peer.missed && peer.missed.has(bag.id)) return false;
  const sent = peer.sentState && peer.sentState.get(bag.id);
  const ackMatch = sameContent(bag.cur, bag.q);
  const sentMatch = sent ? sameContent(bag.cur, sent) : ackMatch;
  if (ackMatch && sentMatch && covered(peer, bag))
    return settled(peer, bag.id, bag.cur.rev) === null;
  return !!(sent && sentMatch && !starved(s, peer, bag.id));
}

/** Settle only after the peer has acked the newest version we sent. */
function covered(peer, bag) {
  return (bag.ackVer || 0) >= (peer.ver.get(bag.id) || 0);
}

/** Content matches what this peer has already acked. Stop sending it. */
function settled(peer, id, rev) {
  peer.ackRev.set(id, rev);
  peer.dirtyAt.delete(id);
  return null;
}

/** An in-flight description is resent only after starvationK ticks with no ack. */
function starved(s, peer, id) {
  const at = peer.sentAt && peer.sentAt.get(id);
  if (at == null) return false;
  return s.tick - at >= s.manifest.starvationK;
}

/** @param {any} cur @param {any} q */
function sameContent(cur, q) {
  return samePose(cur, q) && sameCustom(cur.custom, q.custom);
}

/** @param {any} a @param {any} b */
function samePose(a, b) {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.rotation === b.rotation &&
    a.scale === b.scale &&
    a.anim === b.anim &&
    a.animStart === b.animStart
  );
}

/** @param {any} a @param {any} b */
function sameCustom(a, b) {
  return a === b || customStamp(a).gen === customStamp(b).gen;
}

/** Patch against the spawn snapshot so a lost intermediate update cannot stick. */
function patchBase(peer, entity, acked) {
  const spawn = peer.spawnQ && peer.spawnQ.get(entity.id);
  return spawn ? { version: 0, q: spawn } : acked;
}

/** An empty mask is still a send: the entity returned to the spawn pose and the client must hear it. */
function dirtyItem(s, peer, entity, cur) {
  const base = patchBase(peer, entity, peer.confirmed.get(entity.id));
  if (!peer.dirtyAt.has(entity.id)) peer.dirtyAt.set(entity.id, s.tick);
  const plan = planOf(cur, base.q);
  if (plan.size + 20 > s.manifest.budget) {
    s.stats.skipped += 1;
    return null;
  }
  return itemOf(entity, cur, base, { age: sendAge(s, peer, entity.id), size: plan.size });
}

/** Priority age is time since the last send. Staleness keeps the original dirty tick. */
function sendAge(s, peer, id) {
  const sent = peer.sentAt && peer.sentAt.get(id);
  if (sent != null) return s.tick - sent;
  const at = peer.dirtyAt.get(id);
  return at == null ? 0 : s.tick - at;
}

/** One pose-and-custom diff per distinct baseline. Later peers with the same spawn reuse it. */
function planOf(cur, base) {
  const gen = customStamp(base.custom).gen;
  const hit = cur.plan;
  if (hit && hit.gen === gen && samePose(hit, base)) return hit;
  const mask = diffMask(cur, base);
  const customLen = mask & 64 ? customDeltaLen(cur.custom, base.custom) : 0;
  const plan = {
    gen,
    x: base.x,
    y: base.y,
    rotation: base.rotation,
    scale: base.scale,
    anim: base.anim,
    animStart: base.animStart,
    size: updateBytes(mask, customLen),
  };
  cur.plan = plan;
  return plan;
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
  const acc =
    (peer.acc.get(item.id) || 0) + priorityOf(ctx.s, item.entity.type) * item.rel * ctx.dt;
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
  if (!peer.sentAt) peer.sentAt = new Map();
  if (!peer.sentState) peer.sentState = new Map();
  peer.sentAt.set(item.id, s.tick);
  peer.sentState.set(item.id, freeze(item.cur));
  if (peer.missed) peer.missed.delete(item.id);
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
