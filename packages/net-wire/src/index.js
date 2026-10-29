/** @osh/net-wire — binary protocol for the realtime sync engine. No DOM, no transport. */

export { PROTOCOL, HEADER_BYTES, LIMITS, BAD_KEYS, MSG } from "./defaults.js";
export { WireError } from "./error.js";
export { defineManifest } from "./manifest.js";
export { checkRecord, checkValue } from "./schema.js";
export { encodePacket, decodePacket } from "./packet.js";
export {
  quantize,
  defaultState,
  applyState,
  cloneState,
  sameState,
  diffMask,
  materialize,
} from "./state.js";
export { userText, isUserText, asPlain } from "./keys.js";
export { canon, plainClone, valueBytes, encodeValue } from "./custom.js";
export { createWriter, createReader } from "./bin.js";
export { toU16, fromU16, wrapAngle } from "./quant.js";
export { fnv1a, stable } from "./hash.js";
