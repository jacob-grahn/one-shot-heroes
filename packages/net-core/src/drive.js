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
  return Math.ceil((s.manifest.silenceMs / 1000) * s.manifest.tickHz);
}

/** One silence tick per real frame. A same-timestamp catch-up burst counts as one. */
function creditSilence(s) {
  const now = s.now();
  const tickMs = 1000 / s.manifest.tickHz;
  if (s.silenceAt == null || now - s.silenceAt >= tickMs * 0.5) {
    s.silenceTick = (s.silenceTick || 0) + 1;
    s.silenceAt = now;
  }
}

/** Drop a joined peer that has sent nothing for silenceMs of host time. */
function sweepSilent(s) {
  const limit = joinLimit(s);
  for (const peer of [...s.peers.values()]) {
    if (!peer.live) continue;
    if (s.silenceTick - (peer.heardTick || 0) < limit) continue;
    s.dropFor(peer.peerId, "dropped");
  }
}

/** @param {any} s */
function noteStale(s) {
  let stale = 0;
  const quiet = Math.max(s.manifest.starvationK, Math.ceil(s.manifest.tickHz / 2));
  for (const peer of s.peers.values()) {
    if (!peer.live || s.tick - (peer.lastHeard || 0) > quiet) continue;
    for (const at of peer.dirtyAt.values()) {
      const age = s.tick - at;
      if (age > stale) stale = age;
    }
  }
  s.stats.staleness = stale;
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
