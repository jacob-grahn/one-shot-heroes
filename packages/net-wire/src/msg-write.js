/** Encode one reliable or unreliable message into a writer. */

import { writeShort } from "./bin.js";
import { encodeValue } from "./custom.js";
import { writeRecord, writeUpdate } from "./fields.js";

/** @type {Record<string, (w: ReturnType<import('./bin.js').createWriter>, m: any) => void>} */
export const WRITERS = {
  hello: writeHello,
  welcome: writeWelcome,
  reject: writeReject,
  spawn: writeSpawn,
  despawn: writeDespawn,
  event: writeEvent,
  snap: writeSnap,
  bye: writeBye,
  state: writeState,
  input: writeInput,
  hint: writeHint,
};

function writeHello(w, m) {
  w.u8(m.playerId);
  w.u16(m.proto);
  writeShort(w, m.hash);
  if (m.nonce) w.u32(m.nonce >>> 0);
}

function writeWelcome(w, m) {
  w.u8(m.you);
  w.u32(m.seed >>> 0);
  w.u8(m.hostId);
  w.u8(m.players.length);
  for (const id of m.players) w.u8(id);
  const cursors = m.cursors || [];
  w.u8(cursors.length);
  for (const cursor of cursors) {
    w.u8(cursor.origin);
    w.u16(cursor.epoch || 0);
    w.u32(cursor.next >>> 0);
  }
}

function writeReject(w, m) {
  w.u8(m.code);
}

function writeSpawn(w, m) {
  writeRecord(w, m.record);
}

function writeDespawn(w, m) {
  w.u32(m.id >>> 0);
}

function writeEvent(w, m) {
  w.u32(m.id >>> 0);
  w.u8(m.origin & 255);
  w.u16((m.epoch || 0) >>> 0);
  writeShort(w, m.name);
  encodeValue(w, m.payload, 0);
}

function writeSnap(w, m) {
  w.u16(m.index);
  w.u16(m.count);
  w.u16(m.total);
  w.u16(m.records.length);
  for (const rec of m.records) writeRecord(w, rec);
}

function writeBye() {
  return undefined;
}

function writeState(w, m) {
  w.u16(m.records.length);
  for (const rec of m.records) writeUpdate(w, rec);
}

function writeInput(w, m) {
  w.u8(m.samples.length);
  for (const sample of m.samples) writeSample(w, sample);
}

function writeSample(w, sample) {
  w.u32(sample.tick >>> 0);
  encodeValue(w, sample.values, 0);
}

function writeHint(w, m) {
  w.f32(m.x);
  w.f32(m.y);
}
