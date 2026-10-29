/** Protocol defaults. Jacob can change these; DESIGN.md lists each one. */

export const PROTOCOL = 1;
export const HEADER_BYTES = 15;
export const MAX_MESSAGES = 32;
export const MAX_DEPTH_SAFETY = 8;
export const KEY_BYTES = 255;
export const SHORT_BYTES = 255;

export const F_X = 1;
export const F_Y = 2;
export const F_ROT = 4;
export const F_SCALE = 8;
export const F_ANIM = 16;
export const F_START = 32;
export const F_CUSTOM = 64;

export const MSG = Object.freeze({
  hello: 1,
  welcome: 2,
  reject: 3,
  spawn: 4,
  despawn: 5,
  event: 6,
  snap: 7,
  bye: 8,
  state: 9,
  input: 10,
  hint: 11,
});

export const MSG_NAME = Object.freeze({
  1: "hello",
  2: "welcome",
  3: "reject",
  4: "spawn",
  5: "despawn",
  6: "event",
  7: "snap",
  8: "bye",
  9: "state",
  10: "input",
  11: "hint",
});

export const TAG = Object.freeze({
  del: 0,
  bool: 1,
  int: 2,
  str: 3,
  arr: 4,
  obj: 5,
  f32: 6,
});

export const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export const LIMITS = Object.freeze({
  maxPlayers: 8,
  tickHz: 20,
  budget: 1200,
  starvationK: 8,
  interpMs: 100,
  teleport: 48,
  cell: 32,
  focusClamp: 64,
  inputRedundancy: 4,
  posMin: -2048,
  posMax: 2048,
  scaleMin: 0,
  scaleMax: 8,
  angleBits: 16,
});
