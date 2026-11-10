/** Structural checks on a decoded packet. Policy lives here, not in the game bundle. */

import { isUserText, valueBytes } from "@osh/net-wire";

const CUSTOM = 64;
const BAD = new Set(["__proto__", "constructor", "prototype"]);

/** @param {any} caps @param {any} draft @param {any} packet @param {number} size */
export function walk(caps, draft, packet, size) {
  if (!draft.spawnIds) draft.spawnIds = [];
  for (const message of packet.messages) {
    const code = one(caps, draft, message, size);
    if (code) return code;
  }
  return "";
}

/** @param {any} caps @param {any} draft @param {any} message @param {number} size */
function one(caps, draft, message, size) {
  if (message.type === "hello") return hello(draft);
  if (message.type === "reject") return reject(draft);
  if (message.type === "welcome") return welcome(draft);
  if (message.type === "spawn") return spawn(caps, draft, message.record);
  if (message.type === "despawn") return despawn(draft, message);
  if (message.type === "bye") return bye(draft);
  if (message.type === "snap") return snap(caps, draft, message, size);
  if (message.type === "state") return records(caps, message.records);
  if (message.type === "input") return samples(caps, message.samples);
  if (message.type === "event") return eventCap(caps, draft, message);
  return "";
}

/** @param {any} caps @param {any} draft @param {any} message */
function eventCap(caps, draft, message) {
  const name = typeof message.name === "string" ? message.name : "";
  if (!name || name.length > caps.maxName) return "name";
  if (name.length + valueBytes(message.payload) > caps.maxEventBytes) return "event";
  draft.events = (draft.events || 0) + 1;
  return walkValue(message.payload, 1, caps);
}

/** @param {any} draft */
function hello(draft) {
  draft.joins += 1;
  return "";
}

/** @param {any} draft */
function reject(draft) {
  draft.reject = true;
  return "";
}

/** @param {any} draft */
function welcome(draft) {
  draft.welcome = true;
  return "";
}

/** @param {any} draft @param {any} message */
function despawn(draft, message) {
  if (!draft.despawnIds) draft.despawnIds = [];
  draft.despawnIds.push(message.id >>> 0);
  return "";
}

/** @param {any} draft */
function bye(draft) {
  draft.bye = true;
  return "";
}

/** @param {any} caps @param {any} draft @param {any} record */
function spawn(caps, draft, record) {
  draft.spawnIds.push(record.id);
  if (draft.spawnIds.length > caps.maxEntities) return "entities";
  return patch(caps, record.patch);
}

/** @param {any} caps @param {any} draft @param {any} message @param {number} size */
function snap(caps, draft, message, size) {
  if (message.index === 0) draft.snapReset = true;
  if (size > caps.maxSnapshotBytes) return "snapshot";
  draft.snapBytes = size;
  if (message.total > caps.maxEntities) return "entities";
  draft.snapEntities = message.total;
  draft.snapDone = message.index + 1 === message.count;
  if (!draft.snapIds) draft.snapIds = [];
  for (const record of message.records || []) draft.snapIds.push(record.id);
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
