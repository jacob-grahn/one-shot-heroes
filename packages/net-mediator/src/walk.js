/** Structural checks on a decoded packet. Policy lives here, not in the game bundle. */

import { isUserText, valueBytes } from "@osh/net-wire";

const CUSTOM = 64;
const BAD = new Set(["__proto__", "constructor", "prototype"]);

/** @param {any} caps @param {any} draft @param {any} packet @param {number} size */
export function walk(caps, draft, packet, size) {
  for (const message of packet.messages) {
    const code = one(caps, draft, message, size);
    if (code) return code;
  }
  return "";
}

/** @param {any} caps @param {any} draft @param {any} message @param {number} size */
function one(caps, draft, message, size) {
  if (message.type === "hello") return hello(draft);
  if (message.type === "spawn") return spawn(caps, draft, message.record);
  if (message.type === "despawn") return despawn(draft);
  if (message.type === "snap") return snap(caps, draft, message, size);
  if (message.type === "state") return records(caps, message.records);
  if (message.type === "input") return samples(caps, message.samples);
  if (message.type === "event") return walkValue(message.payload, 1, caps);
  return "";
}

/** @param {any} draft */
function hello(draft) {
  draft.joins += 1;
  return "";
}

/** @param {any} draft */
function despawn(draft) {
  draft.entities = Math.max(0, draft.entities - 1);
  return "";
}

/** @param {any} caps @param {any} draft @param {any} record */
function spawn(caps, draft, record) {
  draft.entities += 1;
  draft.spawns += 1;
  if (draft.entities > caps.maxEntities) return "entities";
  return patch(caps, record.patch);
}

/** @param {any} caps @param {any} draft @param {any} message @param {number} size */
function snap(caps, draft, message, size) {
  if (message.index === 0) draft.snapBytes = 0;
  draft.snapBytes += size;
  if (draft.snapBytes > caps.maxSnapshotBytes) return "snapshot";
  if (message.total > caps.maxEntities) return "entities";
  draft.entities = message.total;
  return records(caps, message.records);
}

/** @param {any} caps @param {any[]} list */
function records(caps, list) {
  for (const record of list || []) {
    const code = patch(caps, record.patch);
    if (code) return code;
  }
  return "";
}

/** @param {any} caps @param {any[]} samples */
function samples(caps, samples) {
  for (const sample of samples || []) {
    const code = walkValue(sample.values, 1, caps);
    if (code) return code;
  }
  return "";
}

/** @param {any} caps @param {any} body */
function patch(caps, body) {
  if (!body || (body.mask & CUSTOM) === 0) return "";
  const custom = body.custom || {};
  if (Object.keys(custom).length > caps.maxKeys) return "keys";
  if (valueBytes(custom) > caps.maxCustomBytes) return "custom";
  return walkValue(custom, 1, caps);
}

/** @param {any} value @param {number} depth @param {any} caps */
function walkValue(value, depth, caps) {
  if (depth > caps.maxDepth) return "depth";
  if (typeof value === "string") return text(value, caps);
  if (isUserText(value)) return text(value.text, caps);
  if (Array.isArray(value)) return list(value, depth, caps);
  if (value && typeof value === "object") return obj(value, depth, caps);
  return "";
}

/** @param {string} value @param {any} caps */
function text(value, caps) {
  return value.length > caps.maxString ? "string" : "";
}

/** @param {any[]} value @param {number} depth @param {any} caps */
function list(value, depth, caps) {
  for (const item of value) {
    const code = walkValue(item, depth + 1, caps);
    if (code) return code;
  }
  return "";
}

/** @param {Record<string, unknown>} value @param {number} depth @param {any} caps */
function obj(value, depth, caps) {
  const keys = Object.keys(value);
  if (keys.length > caps.maxKeys) return "keys";
  for (const key of keys) {
    if (BAD.has(key)) return "bad_key";
    const code = walkValue(value[key], depth + 1, caps);
    if (code) return code;
  }
  return "";
}
