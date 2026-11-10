/** One host or client tick: inputs, silence, simulation, and send. */

import { noteAnims, stampAnims } from "./anim.js";
import { drain } from "./inbox.js";
import { inputsFor, pruneInputs, pushHist, rememberLocal } from "./input.js";
import { finish, fireEnd } from "./lifecycle.js";
import { flushReliable, sendClient, sendHello } from "./relay.js";
import { refreshSlots, sendDirty } from "./state-send.js";

/** @param {any} s */
export function runStep(s) {
  if (s.ended) {
    fireEnd(s);
    return;
  }
  if (s.isHost) stepHost(s);
  else stepClient(s);
  fireEnd(s);
}

/** @param {any} s */
export function digestOf(s) {
  const rows = [];
  for (const entity of s.world.query()) {
    if (entity.local) continue;
    const q = s.isHost ? s.quantize(entity, s.manifest.quant) : s.quants.get(entity.id);
    if (q) rows.push(row(s, entity, q));
  }
  rows.sort((a, b) => a.id - b.id);
  return rows.map((item) => item.text).join("|");
}

/** @param {any} s */
function stepHost(s) {
  const t = performance.now();
  creditSilence(s);
  drain(s);
  sweepSilent(s);
  rememberLocal(s);
  const prev = noteAnims(s);
  runUpdate(s);
  stampAnims(s, prev);
  s.stats.phases.other += performance.now() - t;
  refreshSlots(s);
  for (const peer of s.peers.values()) sendPeer(s, peer);
  noteStale(s);
  pruneInputs(s);
  s.shownTick = s.tick;
  s.tick += 1;
}

/** @param {any} s */
function runUpdate(s) {
  s.inUpdate = true;
  try {
    s.game.update(1 / s.manifest.tickHz, inputsFor(s), s.world, s.net);
  } catch (err) {
    if (customCap(err)) {
      s.stats.customReverted += 1;
      warnPartial(s);
    } else reportUpdate(s, err);
  } finally {
    s.inUpdate = false;
  }
}

/** @param {any} s @param {unknown} err */
function reportUpdate(s, err) {
  s.stats.updateErrors = (s.stats.updateErrors || 0) + 1;
  const message = err instanceof Error ? err.message : String(err);
  const warn = s.game && s.game.warn;
  if (s.dev && typeof warn === "function") warn("update failed: " + message);
  else if (s.dev) console.warn("update failed: " + message);
}

/** The oversize write is reverted. Earlier edits in the tick stay, and dev games are told. */
function warnPartial(s) {
  const message = "custom data exceeds 1024 bytes; this tick was left partial";
  const warn = s.game && s.game.warn;
  if (s.dev && typeof warn === "function") warn(message);
  else if (s.dev) console.warn(message);
}

/** @param {any} s @param {any} peer */
function sendPeer(s, peer) {
  try {
    flushReliable(s, peer);
    if (peer.live) sendDirty(s, peer);
  } catch (err) {
    s.stats.sendErrors = (s.stats.sendErrors || 0) + 1;
    const message = err instanceof Error ? err.message : String(err);
    const warn = s.game && s.game.warn;
    if (s.dev && typeof warn === "function") warn("send failed: " + message);
    else if (s.dev) console.warn("send failed: " + message);
  }
}

/** @param {any} s */
function stepClient(s) {
  s.steps += 1;
  drain(s);
  if (s.pendingLocal) {
    pushHist(s, s.est(), s.pendingLocal);
    s.pendingLocal = null;
  }
  if (!s.joined && !s.ended && s.steps >= (s.nextHello || 0)) sendHelloLater(s);
  if (!s.joined && !s.ended && s.steps > joinLimit(s)) finish(s, "timeout");
  if (s.joined && !s.ended) sendClient(s);
}

/** Hello retries back off so a lossy link does not dump a dozen joins at once. */
function sendHelloLater(s) {
  sendHello(s);
  const gap = Math.min((s.helloGap || s.manifest.tickHz) * 2, s.manifest.tickHz * 2);
  s.helloGap = gap;
  s.nextHello = s.steps + gap;
}

/** @param {any} s */
function joinLimit(s) {
  const ms = s.manifest.joinTimeoutMs == null ? 20000 : s.manifest.joinTimeoutMs;
  return Math.ceil((ms / 1000) * s.manifest.tickHz);
}

/** Remember the last real frame so a same-timestamp catch-up burst is skipped. */
function creditSilence(s) {
  const now = s.now();
  s.silenceGap = s.silenceAt == null ? 1000 : now - s.silenceAt;
  s.silenceAt = now;
}

/** Silence is wall time since the last packet, except during a catch-up burst. */
function sweepSilent(s) {
  const tickMs = 1000 / s.manifest.tickHz;
  if (s.silenceGap < tickMs * 0.5) return;
  const now = s.now();
  for (const peer of [...s.peers.values()]) {
    if (!peer.live) continue;
    const heard = peer.heardAt == null ? now : peer.heardAt;
    if (now - heard < s.manifest.silenceMs) continue;
    s.dropFor(peer.peerId, "dropped");
  }
}

/** Age of the newest version the peer has not acked. A moving entity stays near zero. */
function noteStale(s) {
  let stale = 0;
  for (const peer of s.peers.values()) {
    if (!peer.live) continue;
    for (const [id, acked] of peer.confirmed) {
      const age = ackAge(s, peer, id, acked.version || 0);
      if (age > stale) stale = age;
    }
  }
  s.stats.staleness = stale;
}

/** @param {any} s @param {any} peer @param {number} id @param {number} version */
function ackAge(s, peer, id, version) {
  if (version >= (peer.ver.get(id) || 0)) return 0;
  const at = peer.ackAt && peer.ackAt.get(id);
  return at == null ? s.tick : s.tick - at;
}

/** @param {unknown} err */
function customCap(err) {
  const message = err instanceof Error ? err.message : "";
  return message.includes("custom data exceeds 1024");
}

/** @param {any} s @param {any} entity @param {any} q */
function row(s, entity, q) {
  const text = [
    entity.id,
    entity.type,
    q.x,
    q.y,
    q.rotation,
    q.scale,
    q.anim,
    q.animStart,
    s.canon(q.custom),
  ].join(",");
  return { id: entity.id, text };
}
