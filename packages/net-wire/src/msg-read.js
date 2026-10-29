/** Decode one message body. Throws WireError on a bad key, depth, or truncation. */

import { readShort } from "./bin.js";
import { decodeValue, plainClone } from "./custom.js";
import { readRecord, readUpdate } from "./fields.js";

/** @type {Record<string, (r: ReturnType<import('./bin.js').createReader>) => any>} */
export const READERS = {
  hello: readHello,
  welcome: readWelcome,
  reject: readReject,
  spawn: readSpawn,
  despawn: readDespawn,
  event: readEvent,
  snap: readSnap,
  bye: readBye,
  state: readState,
  input: readInput,
  hint: readHint,
};

function readHello(r) {
  return { playerId: r.u8(), proto: r.u16(), hash: readShort(r) };
}

function readWelcome(r) {
  const you = r.u8();
  const seed = r.u32();
  const hostId = r.u8();
  const n = r.u8();
  const players = [];
  for (let i = 0; i < n; i++) players.push(r.u8());
  return { you, seed, hostId, players };
}

function readReject(r) {
  return { code: r.u8() };
}

function readSpawn(r) {
  return { record: readRecord(r) };
}

function readDespawn(r) {
  return { id: r.u16() };
}

function readEvent(r) {
  const id = r.u32();
  const origin = r.u8();
  const name = readShort(r);
  return { id, origin, name, payload: plainClone(decodeValue(r, 0)) };
}

function readSnap(r) {
  const index = r.u16();
  const count = r.u16();
  const total = r.u16();
  const n = r.u16();
  const records = [];
  for (let i = 0; i < n; i++) records.push(readRecord(r));
  return { index, count, total, records };
}

function readBye() {
  return {};
}

function readState(r) {
  const n = r.u16();
  const records = [];
  for (let i = 0; i < n; i++) records.push(readUpdate(r));
  return { records };
}

function readInput(r) {
  const n = r.u8();
  const samples = [];
  for (let i = 0; i < n; i++) samples.push(readSample(r));
  return { samples };
}

function readSample(r) {
  return { tick: r.u32(), values: plainClone(decodeValue(r, 0)) };
}

function readHint(r) {
  return { x: r.f32(), y: r.f32() };
}
